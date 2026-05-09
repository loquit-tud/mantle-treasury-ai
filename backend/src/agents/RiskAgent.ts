/**
 * RiskAgent — Portfolio-level risk monitoring, concentration limits, and borrow veto.
 *
 * Subscribes to credit/treasury events. Maintains live portfolio metrics
 * (total exposure, per-borrower concentration, default rate). Emits risk:alert
 * and risk:veto events that other agents listen to.
 */

import { ethers } from 'ethers';
import EventBus from '../orchestrator/EventBus';
import { predictDefault } from '../services/DefaultPredictor';
import logger from '../utils/logger';
import type {
  AgentStatus,
  AgentConfig,
  AgentEvent,
  CreditProfile,
  CreditHistory,
  Loan,
} from '../types';

interface PortfolioMetrics {
  totalExposure: bigint;
  borrowerExposures: Map<string, bigint>;
  activeLoans: number;
  defaultedLoans: number;
  totalDefaulted: bigint;
  vaultBalance: bigint;
  lastUpdated: number;
}

interface RiskAlert {
  level: 'warning' | 'critical';
  rule: string;
  message: string;
  data: Record<string, unknown>;
}

const RISK_LIMITS = {
  MAX_PORTFOLIO_UTILIZATION: 0.80,
  MAX_SINGLE_BORROWER_CONCENTRATION: 0.20,
  MAX_DEFAULT_RATE: 0.15,
  HIGH_RISK_PROBABILITY_THRESHOLD: 0.50,
  MONITORING_INTERVAL_MS: 180_000,
};

export class RiskAgent {
  private status: AgentStatus = 'idle';
  private config: AgentConfig;
  private provider: ethers.Provider;
  private metrics: PortfolioMetrics;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private alerts: RiskAlert[] = [];
  private vetoedAddresses: Set<string> = new Set();
  private knownProfiles: Map<string, CreditProfile> = new Map();
  private knownHistories: Map<string, CreditHistory> = new Map();
  private knownLoans: Map<number, Loan> = new Map();

  constructor(config: AgentConfig, provider?: ethers.Provider) {
    this.config = config;
    this.provider = provider || new ethers.JsonRpcProvider(config.rpcUrl);
    this.metrics = {
      totalExposure: 0n,
      borrowerExposures: new Map(),
      activeLoans: 0,
      defaultedLoans: 0,
      totalDefaulted: 0n,
      vaultBalance: 0n,
      lastUpdated: 0,
    };
    logger.info('RiskAgent initialized');
  }

  getStatus(): AgentStatus {
    return this.status;
  }

  getMetrics(): Record<string, unknown> {
    return {
      totalExposure: this.metrics.totalExposure.toString(),
      activeLoans: this.metrics.activeLoans,
      defaultedLoans: this.metrics.defaultedLoans,
      totalDefaulted: this.metrics.totalDefaulted.toString(),
      vaultBalance: this.metrics.vaultBalance.toString(),
      borrowerCount: this.metrics.borrowerExposures.size,
      trackedLoans: this.knownLoans.size,
      portfolioUtilization: this.metrics.vaultBalance > 0n
        ? Number((this.metrics.totalExposure * 10000n) / this.metrics.vaultBalance) / 10000
        : 0,
      vetoedAddresses: Array.from(this.vetoedAddresses),
      recentAlerts: this.alerts.slice(-10),
      lastUpdated: this.metrics.lastUpdated,
    };
  }

  start(): void {
    this.status = 'active';
    this.setupEventListeners();

    this.monitoringInterval = setInterval(
      () => this.runRiskScan(),
      RISK_LIMITS.MONITORING_INTERVAL_MS,
    );

    EventBus.emitEvent('agent:status', 'risk', {
      action: 'status_change',
      reasoning: 'Risk Agent online — monitoring portfolio exposure, concentration, and default risk',
      data: { status: 'active', limits: RISK_LIMITS },
      status: 'executed',
    });
    logger.info('RiskAgent started — monitoring active');
  }

  stop(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    this.status = 'idle';
    logger.info('RiskAgent stopped');
  }

  private setupEventListeners(): void {
    EventBus.subscribe('credit:profile_updated', (event: AgentEvent) => {
      // NOTE: `credit:profile_updated` is emitted as an AgentDecision whose `data` is a small summary
      // (e.g. { address, score, tier }) — not a full CreditProfile. We only ingest full profiles via
      // CreditAgent.ingestProfile(...). Ignore partial payloads to avoid corrupting knownProfiles.
      const data = event.payload?.data as Record<string, unknown> | undefined;
      const maybeFullProfile =
        data &&
        typeof data.address === 'string' &&
        typeof data.limit === 'string' &&
        typeof data.borrowed === 'string' &&
        typeof data.score === 'number';
      if (maybeFullProfile) {
        this.onProfileUpdated(data as unknown as CreditProfile);
      }
    });

    EventBus.subscribe('credit:borrow_requested', (event: AgentEvent) => {
      const { address, amount } = event.payload as { address?: string; amount?: string };
      if (address && amount) {
        this.evaluateBorrowRisk(address, BigInt(amount));
      }
    });

    EventBus.subscribe('credit:loan_disbursed', (event: AgentEvent) => {
      const data = event.payload?.data as Record<string, unknown> | undefined;
      if (data) this.onLoanDisbursed(data);
    });

    EventBus.subscribe('credit:loan_repaid', (event: AgentEvent) => {
      const data = event.payload?.data as Record<string, unknown> | undefined;
      if (data) this.onLoanRepaid(data);
    });

    EventBus.subscribe('credit:loan_defaulted', (event: AgentEvent) => {
      const data = event.payload?.data as Record<string, unknown> | undefined;
      if (data) this.onLoanDefaulted(data);
    });

    EventBus.subscribe('treasury:state_synced', (event: AgentEvent) => {
      const balance = (event.payload?.data as Record<string, unknown>)?.balance as string
        ?? event.payload?.balance as string
        ?? undefined;
      if (balance) {
        this.metrics.vaultBalance = BigInt(Math.round(Number(balance) * 1e6));
      }
    });

    logger.info('RiskAgent event listeners active');
  }

  private onProfileUpdated(profile: CreditProfile): void {
    if (profile.address) {
      this.knownProfiles.set(profile.address.toLowerCase(), profile);
    }
  }

  private onLoanDisbursed(data: Record<string, unknown>): void {
    const borrower = (data.borrower as string || '').toLowerCase();
    const principal = BigInt(data.principal as string || '0');

    this.metrics.totalExposure += principal;
    this.metrics.activeLoans += 1;

    const current = this.metrics.borrowerExposures.get(borrower) || 0n;
    this.metrics.borrowerExposures.set(borrower, current + principal);
    this.metrics.lastUpdated = Date.now();

    this.checkPortfolioLimits();
  }

  private onLoanRepaid(data: Record<string, unknown>): void {
    const borrower = (data.borrower as string || '').toLowerCase();
    const amount = BigInt(data.amount as string || data.principal as string || '0');

    this.metrics.totalExposure = this.metrics.totalExposure > amount
      ? this.metrics.totalExposure - amount : 0n;

    const current = this.metrics.borrowerExposures.get(borrower) || 0n;
    const updated = current > amount ? current - amount : 0n;
    if (updated === 0n) {
      this.metrics.borrowerExposures.delete(borrower);
      this.vetoedAddresses.delete(borrower);
    } else {
      this.metrics.borrowerExposures.set(borrower, updated);
    }

    this.metrics.lastUpdated = Date.now();
  }

  private onLoanDefaulted(data: Record<string, unknown>): void {
    // CreditAgent emits `amount` (principal) in default events; accept both for compatibility.
    const principal = BigInt((data.principal as string) || (data.amount as string) || '0');
    this.metrics.defaultedLoans += 1;
    this.metrics.totalDefaulted += principal;
    this.metrics.activeLoans = Math.max(0, this.metrics.activeLoans - 1);
    this.metrics.lastUpdated = Date.now();

    this.checkDefaultRate();
  }

  /**
   * Pre-borrow risk gate — can veto a borrow before CreditAgent processes it.
   */
  private evaluateBorrowRisk(address: string, amount: bigint): void {
    const addr = address.toLowerCase();
    const alerts: RiskAlert[] = [];

    // 1. Concentration check
    const currentExposure = this.metrics.borrowerExposures.get(addr) || 0n;
    const projectedExposure = currentExposure + amount;
    const projectedTotal = this.metrics.totalExposure + amount;

    if (this.metrics.vaultBalance > 0n) {
      const concentration = Number(projectedExposure * 10000n / this.metrics.vaultBalance) / 10000;
      if (concentration > RISK_LIMITS.MAX_SINGLE_BORROWER_CONCENTRATION) {
        alerts.push({
          level: 'critical',
          rule: 'concentration_limit',
          message: `Borrower ${addr.slice(0, 10)}... would hold ${(concentration * 100).toFixed(1)}% of vault (limit: ${RISK_LIMITS.MAX_SINGLE_BORROWER_CONCENTRATION * 100}%)`,
          data: { address: addr, concentration, limit: RISK_LIMITS.MAX_SINGLE_BORROWER_CONCENTRATION },
        });
      }

      // 2. Portfolio utilization check
      const utilization = Number(projectedTotal * 10000n / this.metrics.vaultBalance) / 10000;
      if (utilization > RISK_LIMITS.MAX_PORTFOLIO_UTILIZATION) {
        alerts.push({
          level: 'critical',
          rule: 'portfolio_utilization',
          message: `Portfolio utilization would reach ${(utilization * 100).toFixed(1)}% (limit: ${RISK_LIMITS.MAX_PORTFOLIO_UTILIZATION * 100}%)`,
          data: { utilization, limit: RISK_LIMITS.MAX_PORTFOLIO_UTILIZATION },
        });
      }
    }

    // 3. ML default risk for this borrower
    const profile = this.knownProfiles.get(addr);
    const history = this.knownHistories.get(addr);
    if (history) {
      const prediction = predictDefault(history, profile || null);
      if (prediction.riskBucket === 'critical' || prediction.probability > RISK_LIMITS.HIGH_RISK_PROBABILITY_THRESHOLD) {
        alerts.push({
          level: 'critical',
          rule: 'ml_default_risk',
          message: `ML model predicts ${(prediction.probability * 100).toFixed(1)}% default probability (bucket: ${prediction.riskBucket})`,
          data: { probability: prediction.probability, riskBucket: prediction.riskBucket },
        });
      }
    }

    // 4. Already vetoed
    if (this.vetoedAddresses.has(addr)) {
      alerts.push({
        level: 'critical',
        rule: 'previously_vetoed',
        message: `Borrower ${addr.slice(0, 10)}... is on risk veto list`,
        data: { address: addr },
      });
    }

    if (alerts.some(a => a.level === 'critical')) {
      this.vetoedAddresses.add(addr);
      this.alerts.push(...alerts);

      EventBus.emitEvent('risk:veto', 'risk', {
        action: 'borrow_vetoed',
        reasoning: alerts.map(a => a.message).join('; '),
        data: { address: addr, amount: amount.toString(), alerts },
        status: 'executed',
      });

      logger.warn('RiskAgent VETOED borrow', { address: addr, alerts: alerts.length });
    } else if (alerts.length > 0) {
      this.alerts.push(...alerts);
      EventBus.emitEvent('risk:alert', 'risk', {
        action: 'borrow_warning',
        reasoning: alerts.map(a => a.message).join('; '),
        data: { address: addr, amount: amount.toString(), alerts },
        status: 'executed',
      });
    }
  }

  private checkPortfolioLimits(): void {
    if (this.metrics.vaultBalance === 0n) return;

    const utilization = Number(this.metrics.totalExposure * 10000n / this.metrics.vaultBalance) / 10000;
    if (utilization > RISK_LIMITS.MAX_PORTFOLIO_UTILIZATION) {
      const alert: RiskAlert = {
        level: 'critical',
        rule: 'portfolio_utilization',
        message: `Portfolio utilization at ${(utilization * 100).toFixed(1)}% — exceeds ${RISK_LIMITS.MAX_PORTFOLIO_UTILIZATION * 100}% limit`,
        data: { utilization, totalExposure: this.metrics.totalExposure.toString(), vaultBalance: this.metrics.vaultBalance.toString() },
      };
      this.alerts.push(alert);
      EventBus.emitEvent('risk:alert', 'risk', {
        action: 'portfolio_limit_breach',
        reasoning: alert.message,
        data: alert.data,
        status: 'executed',
      });
    }

    for (const [borrower, exposure] of this.metrics.borrowerExposures) {
      const concentration = Number(exposure * 10000n / this.metrics.vaultBalance) / 10000;
      if (concentration > RISK_LIMITS.MAX_SINGLE_BORROWER_CONCENTRATION) {
        const alert: RiskAlert = {
          level: 'warning',
          rule: 'concentration_limit',
          message: `Borrower ${borrower.slice(0, 10)}... concentration at ${(concentration * 100).toFixed(1)}%`,
          data: { borrower, concentration, exposure: exposure.toString() },
        };
        this.alerts.push(alert);
        EventBus.emitEvent('risk:alert', 'risk', {
          action: 'concentration_warning',
          reasoning: alert.message,
          data: alert.data,
          status: 'executed',
        });
      }
    }
  }

  private checkDefaultRate(): void {
    const total = this.metrics.activeLoans + this.metrics.defaultedLoans;
    if (total === 0) return;

    const defaultRate = this.metrics.defaultedLoans / total;
    if (defaultRate > RISK_LIMITS.MAX_DEFAULT_RATE) {
      const alert: RiskAlert = {
        level: 'critical',
        rule: 'default_rate',
        message: `Portfolio default rate ${(defaultRate * 100).toFixed(1)}% exceeds ${RISK_LIMITS.MAX_DEFAULT_RATE * 100}% limit — new lending should pause`,
        data: { defaultRate, defaulted: this.metrics.defaultedLoans, total },
      };
      this.alerts.push(alert);
      EventBus.emitEvent('risk:alert', 'risk', {
        action: 'default_rate_breach',
        reasoning: alert.message,
        data: alert.data,
        status: 'executed',
      });
      logger.error('DEFAULT RATE CRITICAL', { defaultRate, total });
    }
  }

  /**
   * Periodic scan: re-read vault balance, run ML on all known profiles.
   */
  private async runRiskScan(): Promise<void> {
    if (this.status !== 'active') return;

    try {
      // Refresh vault balance from on-chain USDt balance
      const ERC20_ABI = ['function balanceOf(address) view returns (uint256)'];
      const usdt = new ethers.Contract(this.config.usdtAddress, ERC20_ABI, this.provider);
      const vaultBal = await usdt.balanceOf(this.config.treasuryVaultAddress) as bigint;
      this.metrics.vaultBalance = vaultBal;

      // ML scan on known profiles
      let highRiskCount = 0;
      for (const [addr, profile] of this.knownProfiles) {
        const history = this.knownHistories.get(addr);
        if (!history) continue;
        const prediction = predictDefault(history, profile);
        if (prediction.riskBucket === 'critical' || prediction.riskBucket === 'high') {
          highRiskCount++;
          if (prediction.riskBucket === 'critical' && !this.vetoedAddresses.has(addr)) {
            this.vetoedAddresses.add(addr);
            EventBus.emitEvent('risk:alert', 'risk', {
              action: 'ml_high_risk_detected',
              reasoning: `Borrower ${addr.slice(0, 10)}... flagged as ${prediction.riskBucket} risk (${(prediction.probability * 100).toFixed(1)}% default probability)`,
              data: { address: addr, prediction },
              status: 'executed',
            });
          }
        }
      }

      this.checkPortfolioLimits();

      this.metrics.lastUpdated = Date.now();

      EventBus.emitEvent('risk:scan_complete', 'risk', {
        action: 'risk_scan',
        reasoning: `Portfolio scan complete — ${this.knownProfiles.size} profiles, ${highRiskCount} high-risk, vault balance ${ethers.formatUnits(vaultBal, 6)} USDt`,
        data: this.getMetrics(),
        status: 'executed',
      });
    } catch (error) {
      logger.error('Risk scan failed', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  /**
   * External API: feed loan data from CreditAgent so RiskAgent can track exposure.
   */
  ingestLoans(loans: Map<number, Loan>): void {
    this.knownLoans = new Map(loans);
    let exposure = 0n;
    let active = 0;
    let defaulted = 0;
    let totalDefaultedAmt = 0n;
    const borrowerExp = new Map<string, bigint>();

    for (const loan of loans.values()) {
      if (loan.active) {
        const principal = BigInt(loan.principal);
        exposure += principal;
        active++;
        const addr = loan.borrower.toLowerCase();
        borrowerExp.set(addr, (borrowerExp.get(addr) || 0n) + principal);
      }
      if (loan.creditFrozen) {
        defaulted++;
        totalDefaultedAmt += BigInt(loan.principal);
      }
    }

    this.metrics.totalExposure = exposure;
    this.metrics.activeLoans = active;
    this.metrics.defaultedLoans = defaulted;
    this.metrics.totalDefaulted = totalDefaultedAmt;
    this.metrics.borrowerExposures = borrowerExp;
    this.metrics.lastUpdated = Date.now();
  }

  ingestProfile(address: string, profile: CreditProfile, history: CreditHistory): void {
    this.knownProfiles.set(address.toLowerCase(), profile);
    this.knownHistories.set(address.toLowerCase(), history);
  }

  isVetoed(address: string): boolean {
    return this.vetoedAddresses.has(address.toLowerCase());
  }
}

export default RiskAgent;
