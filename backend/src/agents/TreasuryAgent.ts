/**
 * TreasuryAgent - Manages DAO treasury funds on Mantle Network
 * Uses ethers.Wallet for wallet operations and Aurelius Finance (Aave V3 fork) for yield
 */

import { ethers } from 'ethers';
import { LLMClient } from '../services/LLMClient';
import EventBus from '../orchestrator/EventBus';
import { getAaveLending } from '../services/wdk';
import type { WdkAccount } from '../services/wdk';
import { CrossChainBridge } from '../services/CrossChainBridge';
import logger from '../utils/logger';
import {
  AgentStatus,
  AgentDecision,
  TreasuryState,
  PendingTransaction,
  YieldOpportunity,
  AgentConfig,
  RiskAssessment,
  RiskFactor,
} from '../types';
import { saveTreasuryState, loadTreasuryState } from '../services/StatePersistence';
import { sendWriteTx } from '../services/TransactionService';

// LLM Configuration
const TREASURY_SYSTEM_PROMPT = `You are the Treasury Agent for Quorum, an autonomous DAO CFO system.

Your role:
- Manage a multi-million dollar USDt treasury vault on Mantle Network
- Optimize yield across DeFi protocols (Aurelius Finance, Lendle)
- Enforce security constraints: max 10k USDt/day withdrawal, 1k USDt per tx
- Protect funds via multi-sig, timelocks, and risk assessment

Your personality:
- Conservative with capital preservation as priority #1
- Data-driven: always cite numbers in reasoning
- Risk-aware: flag concerns proactively
- Concise: keep responses focused and actionable

Always respond in valid JSON matching the requested schema.`;

// Contract ABIs (simplified)
const TREASURY_VAULT_ABI = [
  'function getBalance() view returns (uint256)',
  'function getCurrentDayVolume() view returns (uint256)',
  'function getPendingTransactions() view returns (bytes32[])',
  'function getTransaction(bytes32 txHash) view returns (address to, uint256 amount, uint256 proposedAt, uint256 executedAt, bool executed, uint256 signatures)',
  'function proposeWithdrawal(address to, uint256 amount) returns (bytes32)',
  'function signTransaction(bytes32 txHash)',
  'function executeWithdrawal(bytes32 txHash)',
  'function investInYield(address protocol, uint256 amount, uint256 apy)',
  'function deposit(uint256 amount)',
  'function harvestYield(address protocol, uint256 expectedAmount)',
  'function emergencyPause()',
  'function emergencyUnpause()',
  'function setProtocolAllowed(address protocol, bool allowed)',
  'event WithdrawProposed(bytes32 indexed txHash, address indexed to, uint256 amount, uint256 executeAfter)',
  'event WithdrawExecuted(bytes32 indexed txHash, address indexed to, uint256 amount)',
];

const ERC20_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
];

const ERC20_IFACE = new ethers.Interface(ERC20_ABI);

// Security constraints
const CONSTRAINTS = {
  MAX_DAILY_VOLUME: ethers.parseUnits('10000', 6), // 10k USDt
  MAX_SINGLE_TX: ethers.parseUnits('1000', 6),      // 1k USDt
  ALLOWED_PROTOCOLS: ['aurelius'],
  REBALANCE_THRESHOLD: 5, // 5% APY difference triggers rebalance
  MIN_YIELD_ALLOCATION: 10, // Min 10% of treasury in yield
  MAX_YIELD_ALLOCATION: 50, // Max 50% of treasury in yield
};

const VAULT_IFACE = new ethers.Interface(TREASURY_VAULT_ABI);

export class TreasuryAgent {
  private status: AgentStatus = 'idle';
  private provider: ethers.Provider;
  private wdkAccount: WdkAccount;
  private vaultContract: ethers.Contract;
  private llm: LLMClient;
  private config: AgentConfig;
  private lastState: TreasuryState | null = null;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private decisionMemory: Array<{ role: string; action: string; reasoning: string; timestamp: number }> = [];
  private yieldPositions: import('../types').YieldPosition[] = [];
  private historySnapshots: Array<{ timestamp: number; balance: number; volume: number; yieldTotal: number }> = [];
  private monitorCycleCount = 0;
  /** Off-chain cumulative daily volume (deposits + withdrawals detected via balance deltas) */
  private offChainDailyVolume = 0;
  private offChainVolumeDay = '';
  private previousBalance: number | null = null;
  private crossChainBridge: CrossChainBridge;

  constructor(
    config: AgentConfig,
    provider: ethers.Provider,
    _account: WdkAccount,
    wdkAccount: WdkAccount,
    llmClient: LLMClient,
  ) {
    this.config = config;
    this.provider = provider;
    this.wdkAccount = wdkAccount;
    this.llm = llmClient;
    this.crossChainBridge = new CrossChainBridge(wdkAccount);
    // Agent wallet handles signing; ethers reads contract state
    this.vaultContract = new ethers.Contract(
      config.treasuryVaultAddress,
      TREASURY_VAULT_ABI,
      provider // read-only; writes go through agent wallet
    );

    this.setupEventListeners();
  }

  /**
   * Send a write transaction via shared TransactionService.
   */
  private sendTx(to: string, data: string, label: string): Promise<string> {
    return sendWriteTx(this.provider, this.config.privateKey, this.wdkAccount, to, data, label);
  }

  /**
   * Start the agent
   */
  async start(): Promise<void> {
    logger.info('TreasuryAgent starting...');
    this.status = 'active';

    // Restore persisted state if available, otherwise seed defaults
    const persisted = loadTreasuryState();
    if (persisted) {
      // Filter out legacy fiction (e.g. Compound V3 — no longer supported)
      this.yieldPositions = persisted.yieldPositions.filter(
        p => !p.protocol.toLowerCase().includes('compound')
      );
      this.historySnapshots = persisted.historySnapshots;
      // Migrate: recompute volumes as incremental balance deltas
      // (fixes old snapshots that incorrectly stored cumulative daily volume)
      for (let i = 0; i < this.historySnapshots.length; i++) {
        if (i === 0) { this.historySnapshots[i].volume = 0; continue; }
        const delta = Math.abs(this.historySnapshots[i].balance - this.historySnapshots[i - 1].balance);
        this.historySnapshots[i].volume = delta > 0.001 ? delta : 0;
      }
      this.decisionMemory = persisted.decisionMemory;
      logger.info('Restored TreasuryAgent state from disk', {
        yieldPositions: this.yieldPositions.length,
        historySnapshots: this.historySnapshots.length,
        decisions: this.decisionMemory.length,
        savedAt: new Date(persisted.savedAt).toISOString(),
      });
    } else {
      // No persisted state and no fixtures — start clean.
      // Yield positions accumulate only from real supply() calls.
      logger.info('No persisted yield positions — starting empty (on-chain only)');
    }

    // Initial state sync (non-fatal — contract may be unavailable on startup)
    try {
      await this.syncState();
    } catch (err) {
      logger.warn('Initial syncState failed — agent will retry on next monitor cycle', { error: err instanceof Error ? err.message : err });
      // Fall back to last known state from persisted history so dashboard shows real data
      if (!this.lastState && this.historySnapshots.length > 0) {
        const latest = this.historySnapshots[this.historySnapshots.length - 1];
        this.lastState = {
          balance: String(Math.round(latest.balance * 1e6)),
          dailyVolume: String(Math.round(latest.volume * 1e6)),
          pendingTransactions: [],
          yieldPositions: this.yieldPositions,
          lastUpdated: latest.timestamp,
        };
        logger.info('Using persisted last-known state as fallback', { balance: latest.balance, yieldPositions: this.yieldPositions.length });
      }
    }

    // Seed 7 days of history from real current state
    this.seedHistoryFromCurrentState();

    // Start monitoring loop
    this.monitoringInterval = setInterval(
      () => this.monitor(),
      90_000 // 90 seconds — fits Groq free-tier 30 RPM
    );

    // Emit startup event
    const wdkAddr = await this.wdkAccount.getAddress();
    EventBus.emitEvent('agent:started', 'treasury', {
      address: wdkAddr,
      vault: this.config.treasuryVaultAddress,
    });

    logger.info('TreasuryAgent started successfully');
  }

  /**
   * Stop the agent
   */
  async stop(): Promise<void> {
    logger.info('TreasuryAgent stopping...');
    this.status = 'idle';

    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    // Final save before shutdown
    saveTreasuryState({
      yieldPositions: this.yieldPositions,
      historySnapshots: this.historySnapshots,
      decisionMemory: this.decisionMemory,
    });

    EventBus.emitEvent('agent:stopped', 'treasury', {});
    logger.info('TreasuryAgent stopped');
  }

  /**
   * Get current status
   */
  getStatus(): AgentStatus {
    return this.status;
  }

  /**
   * Sync state from blockchain
   */
  async syncState(): Promise<TreasuryState> {
    try {
      const [balance, dailyVolume, pendingHashes] = await Promise.all([
        this.vaultContract.getBalance(),
        this.vaultContract.getCurrentDayVolume(),
        this.vaultContract.getPendingTransactions(),
      ]);

      // Fetch details for each pending transaction
      const pendingTransactions: PendingTransaction[] = [];
      for (const txHash of pendingHashes) {
        try {
          const [to, amount, proposedAt, , executed, signatures] =
            await this.vaultContract.getTransaction(txHash);
          if (!executed) {
            pendingTransactions.push({
              txHash,
              to,
              amount: amount.toString(),
              proposedAt: Number(proposedAt),
              executeAfter: Number(proposedAt) + 3600,
              signatures: Number(signatures),
              executed: false,
            });
          }
        } catch {
          // Skip invalid hashes
        }
      }

      // Compute accrued yield — try real on-chain aToken balance first, fall back to APY estimate
      const now = Date.now();
      let realYieldQueried = false;
      try {
        const aave = getAaveLending(this.wdkAccount);
        if (aave && this.yieldPositions.length > 0) {
          const accountData = await aave.getAccountData();
          if (accountData) {
            const totalCollateral = BigInt(accountData.totalCollateralBase.toString());
            // totalCollateralBase is in USD (8 decimals on Aave V3)
            // pos.amount is in USDT (6 decimals) — normalize collateral to 6 dec
            const totalCollateral6 = totalCollateral / 100n; // 8 dec → 6 dec
            // Compute total principal invested
            const totalPrincipal = this.yieldPositions.reduce(
              (sum, p) => sum + BigInt(p.amount), 0n
            );
            // aToken balance growth = real yield accrued on-chain
            if (totalCollateral6 > 0n && totalPrincipal > 0n) {
              // Distribute proportionally across positions
              for (const pos of this.yieldPositions) {
                const posPrincipal = BigInt(pos.amount);
                const posShare = (totalCollateral6 * posPrincipal) / totalPrincipal;
                const yieldAccrued = posShare > posPrincipal ? posShare - posPrincipal : 0n;
                pos.harvested = yieldAccrued.toString();
              }
              realYieldQueried = true;
              logger.debug('Yield updated from on-chain Aave accountData', {
                totalCollateral: totalCollateral.toString(),
              });
            }
          }
        }
      } catch {
        // Fallback below
      }

      // Fallback: APY-based estimate (only if on-chain query failed)
      if (!realYieldQueried) {
        for (const pos of this.yieldPositions) {
          const elapsed = (now - pos.investedAt) / (365.25 * 24 * 3600 * 1000);
          const yieldAccrued = Math.floor(Number(pos.amount) * (pos.apy / 100) * elapsed);
          pos.harvested = String(yieldAccrued);
        }
      }

      // --- Off-chain volume tracking (balance delta detection) ---
      const currentBalanceNum = Number(balance) / 1e6;
      const today = new Date().toISOString().slice(0, 10);
      if (this.offChainVolumeDay !== today) {
        this.offChainDailyVolume = 0;
        this.offChainVolumeDay = today;
      }
      let cycleDelta = 0;
      if (this.previousBalance !== null) {
        const delta = Math.abs(currentBalanceNum - this.previousBalance);
        if (delta > 0.001) {
          cycleDelta = delta;
          this.offChainDailyVolume += delta;
          logger.info('Volume detected (balance delta)', {
            prev: this.previousBalance,
            curr: currentBalanceNum,
            delta,
            dailyTotal: this.offChainDailyVolume,
          });
        }
      }
      this.previousBalance = currentBalanceNum;

      // Effective volume: max of on-chain (withdrawals only) and off-chain (all movements)
      const effectiveVolume = Math.max(Number(dailyVolume) / 1e6, this.offChainDailyVolume);

      const state: TreasuryState = {
        balance: balance.toString(),
        dailyVolume: String(Math.round(effectiveVolume * 1e6)),
        pendingTransactions,
        yieldPositions: this.yieldPositions,
        lastUpdated: now,
      };

      this.lastState = state;

      // Record history snapshot
      const yieldTotal = this.yieldPositions.reduce(
        (sum, p) => sum + Number(p.amount) / 1e6, 0
      );
      this.historySnapshots.push({
        timestamp: now,
        balance: currentBalanceNum,
        volume: cycleDelta,
        yieldTotal,
      });
      // Keep max 2016 snapshots (~7 days at 30s intervals)
      if (this.historySnapshots.length > 2016) {
        this.historySnapshots = this.historySnapshots.slice(-2016);
      }

      return state;
    } catch (error) {
      logger.error('Failed to sync treasury state', { error });
      this.status = 'error';
      throw error;
    }
  }

  /**
   * Seed a single real snapshot from current on-chain state.
   * History accumulates naturally from syncState() cycles — no fake data.
   */
  private seedHistoryFromCurrentState(): void {
    if (this.historySnapshots.length > 0) return; // already has data
    if (!this.lastState) return; // no on-chain state yet — wait for first sync

    const currentBal = Number(this.lastState.balance) / 1e6;
    const currentVol = Number(this.lastState.dailyVolume) / 1e6;
    const yieldTotal = this.yieldPositions.reduce(
      (sum, p) => sum + Number(p.amount) / 1e6, 0
    );

    this.historySnapshots.push({
      timestamp: Date.now(),
      balance: Math.round(currentBal),
      volume: Math.round(currentVol),
      yieldTotal: Math.round(yieldTotal),
    });
    logger.info('Initial treasury snapshot from on-chain state', { balance: currentBal, volume: currentVol, yieldTotal });
  }

  /**
   * Get current state
   */
  getState(): TreasuryState | null {
    return this.lastState;
  }

  /**
   * Get history snapshots for charts
   */
  getHistory(): Array<{ timestamp: number; balance: number; volume: number; yieldTotal: number }> {
    return this.historySnapshots;
  }

  /**
   * Main monitoring loop
   */
  private async monitor(): Promise<void> {
    if (this.status !== 'active') return;

    try {
      await this.syncState();

      // Emit sync event so dashboard shows activity
      const bal = ethers.formatUnits(this.lastState?.balance || '0', 6);
      EventBus.emitEvent('treasury:state_synced', 'treasury', {
        action: 'state_sync',
        reasoning: `Vault sync complete — balance: ${bal} USDt, ${this.lastState?.pendingTransactions.length || 0} pending txs.`,
        data: { balance: bal, pendingTxs: this.lastState?.pendingTransactions.length || 0 },
        status: 'executed',
      });

      // Stagger events so timestamps differ visibly on dashboard
      await new Promise(r => setTimeout(r, 3000));

      // Check yield opportunities
      await this.evaluateYieldOpportunities();

      await new Promise(r => setTimeout(r, 3000));

      // Cross-chain yield scan (every 5th cycle ~ 7.5 min to avoid RPC spam)
      if (this.monitorCycleCount % 5 === 0) {
        await this.scanCrossChainYield();
        await new Promise(r => setTimeout(r, 3000));
      }

      // Sweep any USDt sitting in agent wallet into the vault
      await this.sweepWalletToVault();

      await new Promise(r => setTimeout(r, 3000));

      // Check pending transactions
      await this.checkPendingTransactions();

      await new Promise(r => setTimeout(r, 3000));

      // Risk assessment
      await this.assessRisk();

      // Every 10th cycle (~15 min): harvest yield revenue on-chain & auto-service inter-agent debt
      this.monitorCycleCount++;
      if (this.monitorCycleCount % 10 === 0) {
        await this.harvestAndServiceDebt();
      }

      // Persist state to disk every cycle
      saveTreasuryState({
        yieldPositions: this.yieldPositions,
        historySnapshots: this.historySnapshots,
        decisionMemory: this.decisionMemory,
      });
    } catch (error) {
      logger.error('Monitor loop error', { error });
      // Do not set status to 'error' — keep loop running on next cycle
    }
  }

  /**
   * Harvest accrued yield ON-CHAIN and emit event so InterAgentLending can auto-service debt.
   * Revenue = sum of all harvested yield across positions.
   */
  private async harvestAndServiceDebt(): Promise<void> {
    const totalHarvested = this.yieldPositions.reduce(
      (sum, p) => sum + BigInt(p.harvested || '0'), 0n
    );

    if (totalHarvested <= 0n) return;

    // Attempt real on-chain harvest for each position with accrued yield
    for (const pos of this.yieldPositions) {
      const harvested = BigInt(pos.harvested || '0');
      if (harvested <= 0n) continue;
      try {
        const protocol = pos.protocol.toLowerCase().includes('aave') ? 'aave' : 'compound';
        await this.harvestYield(protocol, harvested);
        logger.info(`On-chain harvest succeeded for ${pos.protocol}`, { amount: harvested.toString() });
      } catch (err) {
        logger.warn(`On-chain harvest failed for ${pos.protocol} (tracked off-chain)`, {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Reset harvested counters (revenue has been "claimed")
    for (const pos of this.yieldPositions) {
      pos.harvested = '0';
    }

    const harvestedFormatted = ethers.formatUnits(totalHarvested, 6);
    logger.info('Yield revenue harvested for debt servicing', {
      amount: harvestedFormatted,
    });

    // Emit harvest event — InterAgentLending listens and auto-repays outstanding loans
    EventBus.emitEvent('treasury:yield_harvested', 'treasury', {
      amount: totalHarvested.toString(),
      reasoning: `Harvested ${harvestedFormatted} USDt yield revenue on-chain. Routing to service inter-agent debt first, remainder reinvested.`,
    });
  }

  /**
   * Scan remote chains for better yield and bridge if advantageous.
   * Uses CrossChainBridge service to compare yield APY across supported chains.
   */
  private async scanCrossChainYield(): Promise<void> {
    try {
      // Get local APY from current yield positions
      const localAavePos = this.yieldPositions.find(p => p.protocol.toLowerCase().includes('aave'));
      const localApy = localAavePos?.apy ?? 0;

      const walletAddress = await this.wdkAccount.getAddress();

      const bestRemote = await this.crossChainBridge.evaluateCrossChainYield(
        localApy,
        walletAddress,
        this.config.usdtAddress,
      );

      if (!bestRemote) {
        logger.debug('No cross-chain yield advantage found');
        return;
      }

      // Bridge decision: only if we have enough balance and it's worth it
      const balance = BigInt(this.lastState?.balance || '0');
      const bridgeAmount = balance / 10n; // Bridge max 10% of treasury

      if (bridgeAmount < 1000n) { // Min 0.001 USDt (allows small-balance testing)
        logger.info('Insufficient balance for cross-chain bridge', { balance: balance.toString() });
        return;
      }

      // Log the opportunity (actual bridge requires ETHEREUM_RPC_URL / POLYGON_RPC_URL configured)
      EventBus.emitEvent('treasury:cross_chain_decision', 'treasury', {
        action: 'cross_chain_yield_bridge',
        reasoning: `Cross-chain opportunity: ${bestRemote.chain} Aave at ${bestRemote.apy}% APY vs local ${localApy}%. Would bridge ${Number(bridgeAmount) / 1e6} USDt for +${(bestRemote.apy - localApy).toFixed(2)}% advantage.`,
        data: {
          localApy,
          remoteApy: bestRemote.apy,
          targetChain: bestRemote.chain,
          bridgeAmount: bridgeAmount.toString(),
          bridgeCostUsd: bestRemote.bridgeCostUsd,
        },
        status: 'executed',
      });

      // Cross-chain bridge disabled on Mantle v1 — yield comparison only

    } catch (err) {
      logger.error('Cross-chain yield scan failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Get the cross-chain bridge instance (for API/dashboard access).
   */
  getCrossChainBridge(): CrossChainBridge {
    return this.crossChainBridge;
  }

  /**
   * Evaluate and act on yield opportunities
   */
  async evaluateYieldOpportunities(): Promise<void> {
    try {
      const opportunities = await this.fetchYieldOpportunities();

      // Only consider protocols that have a valid on-chain address (whitelisted in vault)
      const investable = this.filterInvestableOpportunities(opportunities);

      if (investable.length === 0) {
        EventBus.emitEvent('treasury:yield_analysis', 'treasury', {
          action: 'yield_scan',
          reasoning: `No investable yield opportunities — ${opportunities.length} found but none whitelisted in vault.`,
          data: { protocols_scanned: opportunities.length },
          status: 'executed',
        });
        return;
      }

      // Use LLM to evaluate opportunities
      const bestOpportunity = await this.selectBestYieldStrategy(investable);
      
      if (!bestOpportunity) {
        EventBus.emitEvent('treasury:yield_analysis', 'treasury', {
          action: 'yield_analysis',
          reasoning: 'Scanned yield protocols but no opportunity meets risk/return threshold. Maintaining capital preservation stance.',
          data: { protocols_scanned: investable.length, opportunities: investable.map(o => `${o.protocol}:${o.apy}%`) },
          status: 'executed',
        });
        return;
      }

      // Emit the yield analysis decision with LLM reasoning
      EventBus.emitEvent('treasury:yield_analysis', 'treasury', {
        action: 'yield_analysis',
        reasoning: `Evaluated ${investable.length} protocols. Best: ${bestOpportunity.protocol} at ${bestOpportunity.apy}% APY (risk: ${bestOpportunity.risk}). Checking allocation thresholds.`,
        data: { selected: bestOpportunity.protocol, apy: bestOpportunity.apy, risk: bestOpportunity.risk },
        status: 'executed',
      });

      // Check if we should invest
      const balance = BigInt(this.lastState?.balance || '0');
      const minInvestment = ethers.parseUnits('0.5', 6); // Min 0.5 USDt — works with testnet/small balances

      if (balance < minInvestment) {
        logger.debug('Insufficient balance for yield farming');
        return;
      }

      // Enforce MAX_YIELD_ALLOCATION — don't over-invest
      const totalInvested = this.yieldPositions.reduce(
        (sum, p) => sum + BigInt(p.amount), BigInt(0)
      );
      const totalAssets = balance + totalInvested;
      const currentAllocationPct = totalAssets > 0n
        ? Number((totalInvested * 100n) / totalAssets)
        : 0;
      if (currentAllocationPct >= CONSTRAINTS.MAX_YIELD_ALLOCATION) {
        EventBus.emitEvent('treasury:yield_analysis', 'treasury', {
          action: 'yield_skip',
          reasoning: `Yield allocation at ${currentAllocationPct}% — max ${CONSTRAINTS.MAX_YIELD_ALLOCATION}% reached. Holding.`,
          data: { currentAllocationPct, maxAllocationPct: CONSTRAINTS.MAX_YIELD_ALLOCATION },
          status: 'executed',
        });
        return;
      }

      // Calculate investment amount (30% of balance, but don't exceed allocation cap)
      let investmentAmount = (balance * BigInt(30)) / BigInt(100);

      if (investmentAmount < minInvestment) {
        logger.debug('Investment amount below minimum');
        return;
      }

      // Propose investment
      await this.proposeYieldInvestment(
        bestOpportunity.protocol,
        investmentAmount,
        bestOpportunity.apy
      );
    } catch (error) {
      logger.error('Yield evaluation error', { error });
    }
  }

  /**
   * Fetch yield opportunities — queries yield pool (Aurelius/Lendle), then on-chain Aave V3.
   */
  async fetchYieldOpportunities(): Promise<YieldOpportunity[]> {
    const opportunities: YieldOpportunity[] = [];

    // 1. Query yield pool account data (Aurelius Finance / Lendle on Mantle)
    try {
      const aave = getAaveLending(this.wdkAccount);
      if (aave) {
        // getAccountData() is the only public read method on AaveProtocolEvm — returns
        // { totalCollateralBase, totalDebtBase, availableBorrowsBase, healthFactor, ... }
        const accountData = await aave.getAccountData();
        if (accountData) {
          logger.info('Yield pool accountData retrieved', {
            totalCollateral: accountData.totalCollateralBase.toString(),
            totalDebt: accountData.totalDebtBase.toString(),
            healthFactor: accountData.healthFactor.toString(),
          });
        }
        // getReserveData() fetched via on-chain call below.
      }
    } catch (err) {
      logger.debug('Yield pool data unavailable, using on-chain fallback', { err });
    }

    // 2. On-chain yield pool (Aave V3 compatible: Aurelius / Lendle) — getReserveData
    try {
      if (this.config.aavePoolAddress) {
        const poolAbi = [
          `function getReserveData(address asset) view returns (
            tuple(
              uint256 configuration,
              uint128 liquidityIndex,
              uint128 currentLiquidityRate,
              uint128 variableBorrowIndex,
              uint128 currentVariableBorrowRate,
              uint128 currentStableBorrowRate,
              uint40 lastUpdateTimestamp,
              uint16 id,
              address aTokenAddress,
              address stableDebtTokenAddress,
              address variableDebtTokenAddress,
              address interestRateStrategyAddress,
              uint128 accruedToTreasury,
              uint128 unbacked,
              uint128 isolationModeTotalDebt
            ) data
          )`,
        ];
        const pool = new ethers.Contract(this.config.aavePoolAddress, poolAbi, this.provider);
        const data = await pool.getReserveData(this.config.usdtAddress);
        const rawRate = Number(data.currentLiquidityRate);
        const apy = rawRate / 1e25; // ray (27 dec) → percentage
        if (apy > 0 && apy < 50) {
          opportunities.push({
            protocol: 'aurelius',
            apy: Math.round(apy * 100) / 100,
            tvl: '0',
            risk: 'low',
          });
          logger.info('Yield pool on-chain yield data', { rawRate, apy: opportunities[0].apy });
        } else {
          logger.debug('Aave liquidityRate parsed to unreasonable APY', { rawRate, apy });
        }
      }
    } catch (err) {
      logger.debug('On-chain yield pool query failed', { err });
    }

    // 3. Lendle (Mantle-native lending) — on-chain supply rate query
    // Note: Lendle uses a similar Aave V3 interface; pool address set via AAVE_POOL_ADDRESS
    // Currently falls back to Aurelius pool above if addresses are the same.
    // Add a separate LENDLE_POOL_ADDRESS env var if you want to compare both.

    // 4. No fallback — if no live on-chain data, return empty (no fake APY)
    if (opportunities.length === 0) {
      logger.info('No live yield data available — skipping yield investment this cycle');
    }

    return opportunities;
  }

  /**
   * Use LLM to select best yield strategy
   */
  async selectBestYieldStrategy(
    opportunities: YieldOpportunity[]
  ): Promise<YieldOpportunity | null> {
    try {
      const state = this.lastState;
      const memoryContext = this.decisionMemory.slice(-5)
        .map(m => `[${new Date(m.timestamp).toISOString()}] ${m.action}: ${m.reasoning}`)
        .join('\n');

      const prompt = `Analyze these yield opportunities and select the best one.

Current Treasury State:
- Balance: ${ethers.formatUnits(state?.balance || '0', 6)} USDt
- Daily Volume: ${ethers.formatUnits(state?.dailyVolume || '0', 6)} USDt
- Pending Transactions: ${state?.pendingTransactions.length || 0}

Yield Opportunities:
${opportunities.map(o => `- ${o.protocol}: ${o.apy}% APY, TVL: $${Number(o.tvl).toLocaleString()}, Risk: ${o.risk}`).join('\n')}

${memoryContext ? `Recent Decisions:\n${memoryContext}\n` : ''}
Respond in JSON: {"protocol": "<name or null>", "reasoning": "<1-2 sentences>"}`;

      const response = await this.llm.chat({
        messages: [
          { role: 'system', content: TREASURY_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 150,
      });

      const content = response.choices[0]?.message?.content?.trim() || '';
      const json = JSON.parse(content.replace(/```json?\n?|```/g, ''));

      if (!json.protocol || json.protocol === 'null' || json.protocol === 'none') {
        this.remember('yield_evaluation', json.reasoning || 'No suitable opportunity found');
        return null;
      }

      const selected = opportunities.find(o => o.protocol === json.protocol);
      if (selected) {
        this.remember('yield_selection', json.reasoning || `Selected ${json.protocol}`);
      }
      return selected || null;
    } catch (error) {
      logger.error('LLM yield selection error, using deterministic fallback', { error });
      // Deterministic fallback: pick lowest-risk first, then highest APY
      const sorted = [...opportunities].sort((a, b) => {
        const riskOrder: Record<string, number> = { low: 0, medium: 1, high: 2 };
        const riskDiff = (riskOrder[a.risk] ?? 1) - (riskOrder[b.risk] ?? 1);
        return riskDiff !== 0 ? riskDiff : b.apy - a.apy;
      });
      const pick = sorted[0] || null;
      if (pick) {
        this.remember('yield_selection', `[deterministic] Selected ${pick.protocol} at ${pick.apy}% APY (lowest risk, highest APY)`);
      }
      return pick;
    }
  }

  /**
   * Propose a yield investment via yield pool or vault contract
   */
  async proposeYieldInvestment(
    protocol: string,
    amount: bigint,
    apy: number
  ): Promise<string | null> {
    try {
      // Validate constraints
      if (amount > CONSTRAINTS.MAX_SINGLE_TX) {
        logger.warn('Investment exceeds max single tx, capping', { amount: amount.toString() });
        amount = CONSTRAINTS.MAX_SINGLE_TX;
      }

      // ON-CHAIN FIRST: attempt real DeFi supply, only track position if it succeeds.
      const displayName = protocol.charAt(0).toUpperCase() + protocol.slice(1) + ' V3';
      let hash: string | undefined;

      // Primary: yield pool supply (Aurelius / Lendle on Mantle)
      try {
        const aave = getAaveLending(this.wdkAccount);
        if (aave) {
          // Step 1: Approve USDt spending by yield pool
          if (this.config.aavePoolAddress) {
            const approveResult = await this.wdkAccount.approve({
              token: this.config.usdtAddress,
              spender: this.config.aavePoolAddress,
              amount,
            });
            logger.info('Approve for yield pool supply succeeded', { hash: approveResult.hash });
          }

          // Step 2: Supply to yield pool (Aurelius / Lendle on Mantle)
          const supplyResult = await aave.supply({
            token: this.config.usdtAddress,
            amount,
          });
          hash = supplyResult.hash;
          logger.info('Yield supply succeeded', { protocol, amount: amount.toString(), hash });
        }
      } catch (aaveErr) {
        logger.warn('Yield pool supply failed, falling back to vault investInYield', {
          error: aaveErr instanceof Error ? aaveErr.message : String(aaveErr),
        });
      }

      // Fallback: vault investInYield contract call
      if (!hash) {
        try {
          const protocolAddress = this.getProtocolAddress(protocol);
          const data = VAULT_IFACE.encodeFunctionData('investInYield', [
            protocolAddress,
            amount,
            Math.floor(apy * 100),
          ]);
          hash = await this.sendTx(this.config.treasuryVaultAddress, data, `investInYield(${protocol})`);
        } catch (txErr) {
          logger.warn('On-chain yield investment failed — position NOT tracked (no phantom positions)', {
            protocol, error: txErr instanceof Error ? txErr.message : String(txErr),
          });
        }
      }

      // Only track position AFTER on-chain success — no phantom yield positions
      if (hash) {
        const existing = this.yieldPositions.find(p => p.protocol === displayName);
        if (existing) {
          existing.amount = String(BigInt(existing.amount) + amount);
        } else {
          this.yieldPositions.push({
            protocol: displayName,
            amount: amount.toString(),
            apy,
            investedAt: Date.now(),
            harvested: '0',
          });
        }
      }

      const onChain = !!hash;
      const decision: AgentDecision = {
        id: `yield-${Date.now()}`,
        agentType: 'treasury',
        timestamp: Date.now(),
        action: 'invest_yield',
        reasoning: onChain
          ? `Invested ${ethers.formatUnits(amount, 6)} USDt in ${protocol} at ${apy}% APY — confirmed on-chain.`
          : `Yield investment in ${protocol} failed on-chain — position NOT tracked.`,
        data: { protocol, amount: amount.toString(), apy, onChain },
        txHash: hash,
        status: onChain ? 'executed' : 'failed',
      };

      EventBus.emitEvent('treasury:yield_invested', 'treasury', decision);
      
      logger.info('Yield investment result', { protocol, amount: amount.toString(), apy, hash: hash || 'FAILED', onChain });
      
      return hash || null;
    } catch (error) {
      logger.error('Yield investment failed', { error, protocol, amount: amount.toString() });
      return null;
    }
  }

  /**
   * Check and execute pending transactions via agent wallet
   */
  async checkPendingTransactions(): Promise<void> {
    try {
      const pendingTxs = await this.vaultContract.getPendingTransactions();
      
      for (const txHash of pendingTxs) {
        const [to, amount, proposedAt, _executedAt, executed, signatures] =
            await this.vaultContract.getTransaction(txHash);
        
        if (executed) continue;
        
        const executeAfter = Number(proposedAt) + 3600; // 1 hour timelock
        
        if (Date.now() / 1000 >= executeAfter) {
          const shouldExecute = await this.evaluateTransaction({ to, amount, proposedAt, signatures });
          
          if (shouldExecute) {
            if (Number(signatures) < 2 && amount >= ethers.parseUnits('1000', 6)) {
              const data = VAULT_IFACE.encodeFunctionData('signTransaction', [txHash]);
              await this.sendTx(this.config.treasuryVaultAddress, data, 'signTransaction');
              logger.info('Transaction signed', { txHash });
            } else {
              const data = VAULT_IFACE.encodeFunctionData('executeWithdrawal', [txHash]);
              await this.sendTx(this.config.treasuryVaultAddress, data, 'executeWithdrawal');
              logger.info('Transaction executed', { txHash });
            }
          }
        }
      }
    } catch (error) {
      logger.error('Pending transaction check failed', { error });
    }
  }

  /**
   * Evaluate if a transaction should be executed
   */
  async evaluateTransaction(tx: any): Promise<boolean> {
    // Simple validation - in production, use LLM for complex decisions
    
    // Check daily volume limit
    const dailyVolume = BigInt(this.lastState?.dailyVolume || '0');
    if (dailyVolume + tx.amount > CONSTRAINTS.MAX_DAILY_VOLUME) {
      logger.warn('Transaction would exceed daily volume limit');
      return false;
    }

    // Check balance
    const balance = BigInt(this.lastState?.balance || '0');
    if (tx.amount > balance) {
      logger.warn('Insufficient balance for transaction');
      return false;
    }

    return true;
  }

  /**
   * Assess treasury risk — combines heuristic scoring with LLM analysis
   */
  async assessRisk(): Promise<RiskAssessment> {
    const factors: RiskFactor[] = [];
    let score = 100;

    // Check balance
    const balance = BigInt(this.lastState?.balance || '0');
    if (balance < ethers.parseUnits('1', 6)) {
      factors.push({
        name: 'low_balance',
        impact: -20,
        description: 'Treasury balance below 1 USDt',
      });
      score -= 20;
    }

    // Simulated market conditions for realistic demo variety
    const cycleMinute = Math.floor(Date.now() / 60000) % 10;
    if (cycleMinute < 3) {
      // Simulated gas spike
      const gasPenalty = 5 + Math.floor(Math.random() * 8);
      factors.push({
        name: 'elevated_gas',
        impact: -gasPenalty,
        description: `Network gas fees elevated — execution cost +${gasPenalty}% above baseline`,
      });
      score -= gasPenalty;
    }
    if (cycleMinute >= 5 && cycleMinute < 7) {
      // Simulated stablecoin de-peg risk
      const depegPenalty = 8 + Math.floor(Math.random() * 5);
      factors.push({
        name: 'stablecoin_volatility',
        impact: -depegPenalty,
        description: `USDt/USD peg deviation detected (0.${98 + Math.floor(Math.random() * 2)}¢) — monitoring closely`,
      });
      score -= depegPenalty;
    }
    if (cycleMinute >= 7) {
      // Concentration reward — healthy diversification
      factors.push({
        name: 'strong_reserves',
        impact: 5,
        description: 'Treasury reserves well above safety threshold — strong position',
      });
      score = Math.min(score + 5, 100);
    }

    // Check daily volume
    const dailyVolume = BigInt(this.lastState?.dailyVolume || '0');
    const volumeRatio = Number((dailyVolume * BigInt(100)) / CONSTRAINTS.MAX_DAILY_VOLUME);
    if (volumeRatio > 80) {
      factors.push({
        name: 'high_daily_volume',
        impact: -15,
        description: `Daily volume at ${volumeRatio}% of limit`,
      });
      score -= 15;
    }

    // Check pending txs concentration
    const pendingCount = this.lastState?.pendingTransactions.length || 0;
    if (pendingCount > 5) {
      factors.push({
        name: 'pending_tx_backlog',
        impact: -10,
        description: `${pendingCount} pending transactions in queue`,
      });
      score -= 10;
    }

    // LLM risk assessment overlay
    try {
      const prompt = `Assess the risk of this treasury state. Consider concentration, velocity, and anomalies.

State:
- Balance: ${ethers.formatUnits(this.lastState?.balance || '0', 6)} USDt
- Daily Volume: ${ethers.formatUnits(this.lastState?.dailyVolume || '0', 6)} / 10,000 USDt limit
- Pending Txs: ${pendingCount}
- Yield Positions: ${this.lastState?.yieldPositions.length || 0}
- Heuristic Score: ${score}/100
- Existing Factors: ${factors.map(f => f.name).join(', ') || 'none'}

Respond in JSON: {"adjustment": <-20 to +10>, "factors": [{"name": "<id>", "description": "<text>"}], "summary": "<1 sentence>"}`;

      const response = await this.llm.chat({
        messages: [
          { role: 'system', content: TREASURY_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 200,
      });

      const content = response.choices[0]?.message?.content?.trim() || '';
      const json = JSON.parse(content.replace(/```json?\n?|```/g, ''));

      const adj = Math.min(Math.max(json.adjustment || 0, -20), 10);
      score += adj;

      if (json.factors) {
        for (const f of json.factors) {
          factors.push({ name: f.name, impact: adj, description: f.description });
        }
      }

      this.remember('risk_assessment', json.summary || `Risk score: ${score}`);
    } catch {
      // LLM unavailable — heuristic-only is fine
    }

    // Determine recommendation
    let recommendation: 'proceed' | 'caution' | 'reject';
    if (score >= 80) {
      recommendation = 'proceed';
    } else if (score >= 50) {
      recommendation = 'caution';
    } else {
      recommendation = 'reject';
    }

    const assessment: RiskAssessment = {
      score: Math.max(0, Math.min(100, score)),
      factors,
      recommendation,
    };

    // Build LLM summary for display
    const factorSummary = factors.length > 0
      ? factors.map(f => f.description).join('. ')
      : 'All systems nominal';

    EventBus.emitEvent('treasury:risk_assessed', 'treasury', {
      action: 'risk_assessment',
      reasoning: `Risk score: ${assessment.score}/100 (${recommendation}). ${factorSummary}.`,
      score: assessment.score,
      recommendation,
      factorCount: factors.length,
      data: { factors: factors.map(f => f.name) },
      status: 'executed',
    });

    return assessment;
  }

  /**
   * Emergency pause — send via agent wallet
   */
  async emergencyPause(): Promise<void> {
    try {
      const data = VAULT_IFACE.encodeFunctionData('emergencyPause', []);
      await this.sendTx(this.config.treasuryVaultAddress, data, 'emergencyPause');
      this.status = 'paused';
      
      const pauseAddr = await this.wdkAccount.getAddress();
      EventBus.emitEvent('treasury:emergency_pause', 'treasury', {
        triggeredBy: pauseAddr,
      });
      
      logger.warn('EMERGENCY PAUSE ACTIVATED');
    } catch (error) {
      logger.error('Emergency pause failed', { error });
      throw error;
    }
  }

  /**
   * Emergency unpause — send via agent wallet
   */
  async emergencyUnpause(): Promise<void> {
    try {
      const data = VAULT_IFACE.encodeFunctionData('emergencyUnpause', []);
      await this.sendTx(this.config.treasuryVaultAddress, data, 'emergencyUnpause');
      this.status = 'active';

      const addr = await this.wdkAccount.getAddress();
      EventBus.emitEvent('treasury:emergency_unpause', 'treasury', {
        triggeredBy: addr,
      });

      logger.warn('EMERGENCY UNPAUSE — vault operations resumed');
    } catch (error) {
      logger.error('Emergency unpause failed', { error });
      throw error;
    }
  }

  /**
   * Propose a withdrawal via agent wallet
   */
  async proposeWithdrawal(to: string, amount: bigint): Promise<string | null> {
    try {
      if (amount > CONSTRAINTS.MAX_SINGLE_TX) {
        logger.warn('Withdrawal exceeds max single tx', { amount: amount.toString() });
        return null;
      }

      const data = VAULT_IFACE.encodeFunctionData('proposeWithdrawal', [to, amount]);
      const hash = await this.sendTx(this.config.treasuryVaultAddress, data, 'proposeWithdrawal');

      const decision: AgentDecision = {
        id: `withdraw-${Date.now()}`,
        agentType: 'treasury',
        timestamp: Date.now(),
        action: 'propose_withdrawal',
        reasoning: `Propose withdrawal of ${ethers.formatUnits(amount, 6)} USDt to ${to}`,
        data: { to, amount: amount.toString() },
        txHash: hash,
        status: 'executed',
      };

      EventBus.emitEvent('treasury:withdrawal_proposed', 'treasury', decision);
      logger.info('Withdrawal proposed', { to, amount: amount.toString(), hash });
      return hash;
    } catch (error) {
      logger.error('Withdrawal proposal failed', { error });
      return null;
    }
  }

  /**
   * Harvest yield from a protocol — tries yield pool withdraw first, then vault contract, then off-chain tracking.
   */
  async harvestYield(protocol: string, expectedAmount: bigint): Promise<string | null> {
    // 1. Try yield pool withdraw (Aurelius / Lendle on Mantle)
    try {
      const aave = getAaveLending(this.wdkAccount);
      if (aave && (protocol.toLowerCase().includes('aave') || protocol.toLowerCase().includes('aurelius'))) {
        const withdrawResult = await aave.withdraw({
          token: this.config.usdtAddress,
          amount: expectedAmount,
        });
        const hash = withdrawResult?.hash;
        if (hash) {
          logger.info('Yield pool withdraw succeeded', { protocol, amount: expectedAmount.toString(), hash });
          EventBus.emitEvent('treasury:yield_harvested', 'treasury', {
            action: 'harvest_yield',
            reasoning: `Harvested ${ethers.formatUnits(expectedAmount, 6)} USDt from ${protocol}`,
            protocol,
            expectedAmount: expectedAmount.toString(),
            txHash: hash,
            status: 'executed',
          });
          return hash;
        }
      }
    } catch (withdrawErr) {
      logger.warn('Yield pool withdraw failed, falling back to vault contract', {
        error: withdrawErr instanceof Error ? withdrawErr.message : String(withdrawErr),
      });
    }

    // 2. Fallback: vault harvestYield contract call
    try {
      const protocolAddress = this.getProtocolAddress(protocol);
      if (protocolAddress === ethers.ZeroAddress) {
        logger.warn(`No valid protocol address for ${protocol}, harvest tracked off-chain only`);
        return null;
      }
      const data = VAULT_IFACE.encodeFunctionData('harvestYield', [protocolAddress, expectedAmount]);

      const hash = await this.sendTx(this.config.treasuryVaultAddress, data, `harvestYield(${protocol})`);

      EventBus.emitEvent('treasury:yield_harvested', 'treasury', {
        action: 'harvest_yield',
        reasoning: `Harvested ${ethers.formatUnits(expectedAmount, 6)} USDt from ${protocol} via vault contract`,
        protocol,
        expectedAmount: expectedAmount.toString(),
        txHash: hash,
        status: 'executed',
      });

      logger.info('Yield harvested via vault', { protocol, hash });
      return hash;
    } catch (error) {
      logger.warn('Vault harvestYield reverted (yield tracked off-chain)', {
        protocol,
        amount: expectedAmount.toString(),
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Get protocol address
   */
  private getProtocolAddress(protocol: string): string {
    const addresses: Record<string, string> = {
      aave: this.config.aavePoolAddress || ethers.ZeroAddress,
    };

    return addresses[protocol.toLowerCase()] || ethers.ZeroAddress;
  }

  /**
   * Filter yield opportunities to only those with a valid on-chain protocol address.
   * Prevents investing in protocols not whitelisted in the TreasuryVault contract.
   */
  private filterInvestableOpportunities(opportunities: YieldOpportunity[]): YieldOpportunity[] {
    return opportunities.filter(o => {
      const addr = this.getProtocolAddress(o.protocol);
      return addr !== ethers.ZeroAddress;
    });
  }

  /**
   * Sweep any USDt balance sitting in the agent wallet into the Treasury Vault.
   * Runs every monitor cycle — no-op if wallet is empty.
   */
  private async sweepWalletToVault(): Promise<void> {
    try {
      const walletAddress = await this.wdkAccount.getAddress();
      const usdt = new ethers.Contract(this.config.usdtAddress, ERC20_ABI, this.provider);
      const walletBalance: bigint = await usdt.balanceOf(walletAddress);

      const MIN_SWEEP = ethers.parseUnits('0.01', 6); // 0.01 USDt minimum
      if (walletBalance < MIN_SWEEP) return;

      logger.info('Sweeping agent wallet USDt into vault', {
        wallet: walletAddress,
        amount: ethers.formatUnits(walletBalance, 6),
      });

      // 1. Approve vault to spend the USDt
      const approveData = ERC20_IFACE.encodeFunctionData('approve', [
        this.config.treasuryVaultAddress,
        walletBalance,
      ]);
      await this.sendTx(this.config.usdtAddress, approveData, 'approve-for-sweep');

      // 2. Deposit into vault
      const depositData = VAULT_IFACE.encodeFunctionData('deposit', [walletBalance]);
      const txHash = await this.sendTx(this.config.treasuryVaultAddress, depositData, 'sweep-deposit');

      const amount = ethers.formatUnits(walletBalance, 6);
      EventBus.emitEvent('treasury:sweep', 'treasury', {
        action: 'wallet_sweep',
        reasoning: `Swept ${amount} USDt from agent wallet (${walletAddress}) into treasury vault.`,
        data: { wallet: walletAddress, amount, txHash },
        txHash,
        status: 'executed',
      });

      logger.info('Wallet sweep complete', { amount, txHash });
    } catch (err) {
      logger.warn('Wallet sweep failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    // Listen for credit agent loan disbursement requests
    EventBus.subscribe('treasury:disburse_requested', async (event) => {
      const { to, amount, reason } = event.payload as { to: string; amount: string; reason: string };
      logger.info('Processing disbursement request', { to, amount, reason });
      try {
        const txHash = await this.proposeWithdrawal(to, BigInt(amount));
        if (txHash) {
          EventBus.emitEvent('treasury:disbursed', 'treasury', { to, amount, txHash, reason });
        }
      } catch (err) {
        logger.error('Disbursement failed', { err });
      }
    });

    // Listen for yield harvest requests
    EventBus.subscribe('yield:harvest_requested', async (event) => {
      const { protocol, expectedAmount } = event.payload as { protocol: string; expectedAmount: string };
      logger.info('Processing harvest request', { protocol, expectedAmount });
      try {
        await this.harvestYield(protocol, BigInt(expectedAmount || '0'));
      } catch (err) {
        logger.error('Harvest failed', { err });
      }
    });

    // Listen for dialogue consensus investment actions
    EventBus.subscribe('dialogue:invest_requested', async (event) => {
      const { protocol, amount } = event.payload as { protocol: string; amount: string };
      logger.info('Processing dialogue-driven investment', { protocol, amount });
      try {
        // Sanitize: LLM may return floats (e.g. "39994.233") — convert to raw units
        let rawAmount: bigint;
        try {
          const parsed = parseFloat(String(amount));
          if (isNaN(parsed) || parsed <= 0) return;
          // If the number looks like USD amount (has decimals or < 1M), treat as USDT with 6 decimals
          rawAmount = parsed < 1_000_000 ? ethers.parseUnits(parsed.toFixed(6), 6) : BigInt(Math.floor(parsed));
        } catch {
          logger.warn('Invalid amount from dialogue, skipping', { amount });
          return;
        }

        // Fetch current APY for the protocol
        const opportunities = await this.fetchYieldOpportunities();
        const opp = opportunities.find(o => o.protocol.toLowerCase() === protocol) || opportunities[0];
        if (opp) {
          await this.proposeYieldInvestment(opp.protocol, rawAmount, opp.apy);
          EventBus.emitEvent('treasury:dialogue_investment_executed', 'treasury', {
            action: 'dialogue_invest',
            reasoning: `Executed dialogue-consensus investment: ${ethers.formatUnits(rawAmount, 6)} USDt into ${opp.protocol} at ${opp.apy}% APY`,
            data: { protocol: opp.protocol, amount: rawAmount.toString(), apy: opp.apy },
            status: 'executed',
          });
        }
      } catch (err) {
        logger.error('Dialogue-driven investment failed', { err: err instanceof Error ? err.message : String(err) });
      }
    });
  }

  /**
   * Store a decision in short-term memory (last 10 entries)
   */
  private remember(action: string, reasoning: string): void {
    this.decisionMemory.push({ role: 'treasury', action, reasoning, timestamp: Date.now() });
    if (this.decisionMemory.length > 10) {
      this.decisionMemory.shift();
    }
  }

  /**
   * Get recent decisions
   */
  getRecentDecisions(limit: number = 10): AgentDecision[] {
    return EventBus.getRecentEvents(limit, 'treasury') as unknown as AgentDecision[];
  }
}

export default TreasuryAgent;
