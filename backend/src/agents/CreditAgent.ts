/**
 * CreditAgent - On-chain credit scoring and lending
 * Uses WDK for wallet operations, ethers for contract reads
 */

import { ethers } from 'ethers';
import type WDK from '@tetherto/wdk';
import type { WdkAccount } from '../services/wdk';
import { LLMClient } from '../services/LLMClient';
import { predictDefault, type DefaultPrediction } from '../services/DefaultPredictor';
import EventBus from '../orchestrator/EventBus';
import logger from '../utils/logger';
import {
  AgentStatus,
  AgentDecision,
  CreditProfile,
  CreditHistory,
  Loan,
  AgentConfig,
  CreditTier,
} from '../types';
import { saveCreditState, loadCreditState } from '../services/StatePersistence';
import { sendWriteTx } from '../services/TransactionService';
import { generateProof, verifyProof, getBestProvableTier } from '../services/ZKCreditProof';
import type { RevenueTracker } from '../services/RevenueTracker';
import type { DebtRestructuring } from '../services/DebtRestructuring';

// LLM Configuration
const CREDIT_SYSTEM_PROMPT = `You are the Credit Agent for AgentTreasury, an autonomous DAO CFO system.

Your role:
- Evaluate on-chain credit profiles for DeFi borrowers
- Score wallets 0-1000 based on tx history, volume, age, and repayment
- Make binary APPROVE/DECLINE decisions on borrow requests
- Protect the treasury from over-extension and defaults

Your personality:
- Fair but cautious: give credit where earned, deny when risk is high
- Data-driven: cite specific numbers from the profile
- Protective: treasury capital preservation is your #1 concern
- Concise: keep reasoning to 1-3 sentences

Always respond in valid JSON matching the requested schema.`;

// Contract ABIs (simplified)
const CREDIT_LINE_ABI = [
  'function updateProfile(address user, uint256 transactionCount, uint256 volumeUSD, uint256 accountAge, uint256 repaidLoans, uint256 defaults)',
  'function borrow(uint256 amount)',
  'function borrowFor(address borrower, uint256 amount)',
  'function borrowForCustom(address borrower, uint256 amount, uint256 customRateBps, uint256 customDurationSec)',
  'function repay(uint256 loanId, uint256 amount)',
  'function repayFor(address borrower, uint256 loanId, uint256 amount)',
  'function markDefaulted(uint256 loanId)',
  'function calculateInterest(uint256 loanId) view returns (uint256)',
  'function getAmountDue(uint256 loanId) view returns (uint256)',
  'function getActiveLoans(address user) view returns (uint256[])',
  'function profiles(address) view returns (uint256 score, uint256 limit, uint256 rate, uint256 borrowed, uint256 repaid, uint256 defaults, uint256 lastUpdated, uint256 transactionCount, uint256 volumeUSD, uint256 accountAge, uint256 repaidLoans, bool exists)',
  'function loans(uint256) view returns (address borrower, uint256 principal, uint256 interestRate, uint256 borrowedAt, uint256 dueDate, uint256 repaid, bool active)',
  'function loanCount() view returns (uint256)',
  'event ProfileUpdated(address indexed user, uint256 score, uint256 limit, uint256 rate)',
  'event LoanCreated(uint256 indexed loanId, address indexed borrower, uint256 principal, uint256 interestRate, uint256 dueDate)',
  'event LoanRepaid(uint256 indexed loanId, address indexed borrower, uint256 amount, uint256 interest)',
  'event LoanDefaulted(uint256 indexed loanId, address indexed borrower, uint256 amount)',
];

// Credit tiers
const CREDIT_TIERS: CreditTier[] = [
  { minScore: 800, limit: ethers.parseUnits('5000', 6).toString(), rate: 500, name: 'Excellent' },
  { minScore: 600, limit: ethers.parseUnits('2000', 6).toString(), rate: 1000, name: 'Good' },
  { minScore: 0, limit: ethers.parseUnits('500', 6).toString(), rate: 1500, name: 'Poor' },
];

// ABI helpers for WDK encoding
const CREDIT_LINE_IFACE = new ethers.Interface(CREDIT_LINE_ABI);
const ERC20_IFACE = new ethers.Interface([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
]);

// Penalty rate tiers (annualized basis points, added on top of base interest)
const PENALTY_TIERS = [
  { maxOverdueDays: 7, penaltyBps: 500 },   // 5% for 1-7 days overdue
  { maxOverdueDays: 14, penaltyBps: 1000 },  // 10% for 8-14 days overdue
  { maxOverdueDays: Infinity, penaltyBps: 1500 }, // 15% for 15+ days overdue
];

// Idle capital thresholds for autonomous lending (kept for reference)
// Lowered to match real testnet/mainnet balances (vault has ~4-10 USDt)
// const _IDLE_CAPITAL_THRESHOLD = ethers.parseUnits('0.5', 6);    // 0.5 USDt — start proactive lending
// const IDLE_CAPITAL_AGGRESSIVE = ethers.parseUnits('2', 6);     // 2 USDt — aggressive lending mode

export class CreditAgent {
  private status: AgentStatus = 'idle';
  private provider: ethers.Provider;
  private wdkAccount: WdkAccount;
  private creditContract: ethers.Contract;
  private llm: LLMClient;
  private config: AgentConfig;
  private profiles: Map<string, CreditProfile> = new Map();
  private loans: Map<number, Loan> = new Map();
  private monitoringInterval: NodeJS.Timeout | null = null;
  private decisionMemory: Array<{ role: string; action: string; reasoning: string; timestamp: number }> = [];
  private borrowLocks: Set<string> = new Set();
  private pendingBorrowRequests: Array<{ address: string; amount: string; source: string; timestamp: number }> = [];
  private static readonly GRACE_PERIOD_SECONDS = 24 * 3600; // 24h grace before default
  // Admin-cancelled loan IDs: erroneous on-chain records to exclude from active display.
  // These loans have no real funds disbursed and will be marked defaulted on-chain after due date.
  private cancelledLoanIds: Set<number> = new Set([6]);
  private revenueTracker: RevenueTracker | null = null;
  private debtRestructuring: DebtRestructuring | null = null;

  constructor(
    config: AgentConfig,
    provider: ethers.Provider,
    _wdk: WDK,
    wdkAccount: WdkAccount,
    llmClient: LLMClient,
  ) {
    this.config = config;
    this.provider = provider;
    this.wdkAccount = wdkAccount;
    this.llm = llmClient;
    this.creditContract = new ethers.Contract(
      config.creditLineAddress,
      CREDIT_LINE_ABI,
      provider
    );

    this.setupEventListeners();
  }

  /** Inject RevenueTracker (set from index.ts after construction) */
  setRevenueTracker(tracker: RevenueTracker): void {
    this.revenueTracker = tracker;
  }

  /** Inject DebtRestructuring (set from index.ts after construction) */
  setDebtRestructuring(restructuring: DebtRestructuring): void {
    this.debtRestructuring = restructuring;
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
    logger.info('CreditAgent starting...');
    this.status = 'active';

    // Restore persisted state if available
    const persisted = loadCreditState();
    if (persisted) {
      for (const [key, val] of persisted.profiles) {
        this.profiles.set(key, val as unknown as CreditProfile);
      }
      for (const [id, val] of persisted.loans) {
        this.loans.set(id, val as unknown as Loan);
      }
      this.decisionMemory = persisted.decisionMemory;
      logger.info('Restored CreditAgent state from disk', {
        profiles: this.profiles.size,
        loans: this.loans.size,
        decisions: this.decisionMemory.length,
        savedAt: new Date(persisted.savedAt).toISOString(),
      });
    }

    // Sync existing data (merges on-chain state)
    await this.syncLoans();

    // Seed known borrowers so proactive lending has candidates
    await this.seedKnownBorrowers();

    // Start monitoring loop
    this.monitoringInterval = setInterval(
      () => this.monitor(),
      120_000 // 120 seconds — fits Groq free-tier 30 RPM
    );

    EventBus.emitEvent('agent:started', 'credit', {
      creditLine: this.config.creditLineAddress,
    });

    logger.info('CreditAgent started successfully');
  }

  /**
   * Stop the agent
   */
  async stop(): Promise<void> {
    logger.info('CreditAgent stopping...');
    this.status = 'idle';

    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    // Final save before shutdown
    saveCreditState({
      profiles: Array.from(this.profiles.entries()),
      loans: Array.from(this.loans.entries()),
      decisionMemory: this.decisionMemory,
    });

    EventBus.emitEvent('agent:stopped', 'credit', {});
    logger.info('CreditAgent stopped');
  }

  /**
   * Get current status
   */
  getStatus(): AgentStatus {
    return this.status;
  }

  /**
   * Main monitoring loop
   */
  private async monitor(): Promise<void> {
    if (this.status !== 'active') return;

    try {
      // Check for due loans + autonomous repayment collection
      await this.checkDueLoans();

      // Evaluate active loans for restructuring (ML-triggered)
      await this.checkRestructuring();

      // Process autonomous lending decisions (borrow queue + proactive)
      await this.processAutonomousLending();

      // Sync loan data
      await this.syncLoans();

      // Active portfolio monitoring — emit decision events
      await this.monitorPortfolio();

      // Persist state to disk
      saveCreditState({
        profiles: Array.from(this.profiles.entries()),
        loans: Array.from(this.loans.entries()),
        decisionMemory: this.decisionMemory,
      });
    } catch (error) {
      logger.error('Monitor loop error', { error });
      this.status = 'error';
    }
  }

  /**
   * Active portfolio monitoring — generates visible decisions
   */
  private async monitorPortfolio(): Promise<void> {
    const activeLoans = this.getAllActiveLoans();
    const profileCount = this.profiles.size;

    // Emit portfolio scan event
    if (activeLoans.length > 0) {
      const totalBorrowed = activeLoans.reduce((sum, l) => sum + BigInt(l.principal), 0n);
      const overdueCount = activeLoans.filter(l => l.dueDate * 1000 < Date.now()).length;

      EventBus.emitEvent('credit:portfolio_scan', 'credit', {
        action: 'portfolio_scan',
        reasoning: `Monitoring ${activeLoans.length} active loan(s) — ` +
          `total exposure: ${ethers.formatUnits(totalBorrowed, 6)} USDt. ` +
          (overdueCount > 0
            ? `⚠ ${overdueCount} loan(s) overdue — escalating for collection.`
            : `All loans current — portfolio health: good.`),
        data: { activeLoans: activeLoans.length, totalBorrowed: ethers.formatUnits(totalBorrowed, 6), overdueCount },
        status: 'executed',
      });
    } else {
      // Vary the idle monitoring messages
      const cycleVar = Math.floor(Date.now() / 30000) % 4;
      const idleMessages = [
        `Credit pool idle — ${profileCount} profile(s) on file. Ready for new borrower evaluations.`,
        `Scanning on-chain activity for potential borrowers. No pending applications detected.`,
        `Credit utilization: 0%. Treasury funds fully available for lending operations.`,
        `Risk exposure review complete — no active loans, default probability: 0%.`,
      ];
      EventBus.emitEvent('credit:monitoring', 'credit', {
        action: 'credit_monitoring',
        reasoning: idleMessages[cycleVar],
        data: { profiles: profileCount, activeLoans: 0 },
        status: 'executed',
      });
    }
  }

  /**
   * Evaluate credit for a user
   */
  async evaluateCredit(address: string): Promise<CreditProfile> {
    try {
      logger.info(`Evaluating credit for ${address}`);

      // Fetch on-chain history
      const history = await this.fetchCreditHistory(address);

      // Calculate base score
      const baseScore = this.calculateBaseScore(history);

      // Use LLM for enhanced analysis
      const llmAnalysis = await this.analyzeWithLLM(address, history, baseScore);

      // Final score
      const finalScore = Math.min(Math.max(baseScore + llmAnalysis.adjustment, 0), 1000);

      // Determine tier
      const tier = this.getTier(finalScore);

      const profile: CreditProfile = {
        address,
        score: finalScore,
        limit: tier.limit,
        rate: tier.rate,
        borrowed: '0',
        available: tier.limit,
        lastUpdated: Date.now(),
        exists: true,
      };

      // Update on-chain profile
      await this.updateOnChainProfile(address, history, profile);

      // Store locally
      this.profiles.set(address.toLowerCase(), profile);

      // Emit decision
      const decision: AgentDecision = {
        id: `credit-${Date.now()}`,
        agentType: 'credit',
        timestamp: Date.now(),
        action: 'evaluate_credit',
        reasoning: llmAnalysis.reasoning,
        data: { address, score: finalScore, tier: tier.name },
        status: 'executed',
      };

      EventBus.emitEvent('credit:profile_updated', 'credit', decision);

      logger.info(`Credit evaluation complete for ${address}`, {
        score: finalScore,
        tier: tier.name,
      });

      return profile;
    } catch (error) {
      logger.error(`Credit evaluation failed for ${address}`, { error });
      throw error;
    }
  }

  /**
   * Fetch credit history from blockchain (real on-chain data)
   */
  async fetchCreditHistory(address: string): Promise<CreditHistory> {
    try {
      // Real on-chain data
      const [txCount, balance] = await Promise.all([
        this.provider.getTransactionCount(address),
        this.provider.getBalance(address),
      ]);

      // Check existing profile on contract
      let repaidLoans = 0;
      let defaults = 0;
      try {
        const profile = await this.creditContract.profiles(address);
        if (profile.exists) {
          repaidLoans = Number(profile.repaidLoans);
          defaults = Number(profile.defaults);
        }
      } catch {
        // No existing profile
      }

      // Estimate account age from first block interaction
      // (simplified: use tx count as proxy)
      const accountAge = Math.min(txCount * 2, 730); // rough estimate in days

      // Volume estimate from balance (ETH → USD rough conversion for scoring)
      const ethBalance = Number(ethers.formatEther(balance));
      const volumeUSD = Math.floor(ethBalance * 2500); // rough ETH/USD

      return {
        transactionCount: txCount,
        volumeUSD,
        accountAge,
        repaidLoans,
        defaults,
      };
    } catch (error) {
      logger.error(`Failed to fetch credit history for ${address}`, { error });
      return {
        transactionCount: 0,
        volumeUSD: 0,
        accountAge: 0,
        repaidLoans: 0,
        defaults: 0,
      };
    }
  }

  /**
   * Calculate base credit score
   * Formula:
   * - Base: 500
   * - + min(txCount * 2, 200)
   * - + min(volumeUSD / 100, 150)
   * - + repaidLoans * 100
   * - + min(accountAge / 10, 50)
   * - - defaults * 200
   */
  calculateBaseScore(history: CreditHistory): number {
    let score = 500;

    // Positive factors
    score += Math.min(history.transactionCount * 2, 200);
    score += Math.min(Math.floor(history.volumeUSD / 100), 150);
    score += history.repaidLoans * 100;
    score += Math.min(Math.floor(history.accountAge / 10), 50);

    // Negative factors
    score -= history.defaults * 200;

    return Math.min(Math.max(score, 0), 1000);
  }

  /**
   * Analyze with LLM for enhanced scoring
   */
  async analyzeWithLLM(
    address: string,
    history: CreditHistory,
    baseScore: number
  ): Promise<{ adjustment: number; reasoning: string }> {
    try {
      const memoryContext = this.decisionMemory.slice(-5)
        .map(m => `[${new Date(m.timestamp).toISOString()}] ${m.action}: ${m.reasoning}`)
        .join('\n');

      const prompt = `Analyze this wallet's creditworthiness.

Wallet: ${address}
On-Chain History:
- Transaction Count: ${history.transactionCount}
- Total Volume: $${history.volumeUSD.toLocaleString()}
- Account Age: ${history.accountAge} days
- Repaid Loans: ${history.repaidLoans}
- Defaults: ${history.defaults}

Base Score: ${baseScore}/1000

Credit Tiers:
- 800+: Excellent (5k USDt, 5% APR)
- 600-799: Good (2k USDt, 10% APR)
- <600: Poor (500 USDt, 15% APR)

${memoryContext ? `Recent Decisions:\n${memoryContext}\n` : ''}
Respond in JSON: {"adjustment": <-50 to +50>, "reasoning": "<1-3 sentences>"}`;

      const response = await this.llm.chat({
        messages: [
          { role: 'system', content: CREDIT_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 200,
      });

      const content = response.choices[0]?.message?.content?.trim() || '';
      const json = JSON.parse(content.replace(/```json?\n?|```/g, ''));

      const adjustment = Math.min(Math.max(json.adjustment || 0, -50), 50);
      const reasoning = json.reasoning || 'Score based on on-chain activity analysis.';

      this.remember('credit_analysis', reasoning);

      return { adjustment, reasoning };
    } catch (error) {
      logger.error('LLM analysis error', { error });
      // Deterministic fallback with descriptive reasoning
      let reasoning = `Base score ${baseScore} used (LLM unavailable). `;
      if (history.defaults > 0) reasoning += `Warning: ${history.defaults} default(s) on record. `;
      if (history.repaidLoans > 0) reasoning += `Positive: ${history.repaidLoans} repaid loan(s). `;
      if (history.transactionCount > 50) reasoning += `Active wallet (${history.transactionCount} txs). `;
      return { adjustment: 0, reasoning: reasoning.trim() };
    }
  }

  /**
   * Get credit tier for score
   */
  getTier(score: number): CreditTier {
    for (const tier of CREDIT_TIERS) {
      if (score >= tier.minScore) {
        return tier;
      }
    }
    return CREDIT_TIERS[CREDIT_TIERS.length - 1];
  }

  /**
   * Update on-chain credit profile via WDK (fallback: ethers signer)
   */
  async updateOnChainProfile(
    address: string,
    history: CreditHistory,
    _profile: CreditProfile
  ): Promise<void> {
    try {
      const data = CREDIT_LINE_IFACE.encodeFunctionData('updateProfile', [
        address,
        history.transactionCount,
        history.volumeUSD,
        history.accountAge,
        history.repaidLoans,
        history.defaults,
      ]);

      const hash = await this.sendTx(this.config.creditLineAddress, data, 'updateProfile');
      logger.info(`On-chain profile updated for ${address}`, { hash });
    } catch (error) {
      logger.error(`Failed to update on-chain profile for ${address}`, { error: error instanceof Error ? error.message : String(error) });
      // Don't throw — profile evaluation can still succeed without on-chain write
    }
  }

  /**
   * Process borrow request
   */
  async processBorrow(address: string, amount: bigint): Promise<Loan | null> {
    try {
      logger.info(`Processing borrow request from ${address}`, {
        amount: amount.toString(),
      });

      // Mutex: prevent concurrent borrows for same address
      const addrLower = address.toLowerCase();
      if (this.borrowLocks.has(addrLower)) {
        logger.warn(`Borrow already in progress for ${address}`);
        return null;
      }
      this.borrowLocks.add(addrLower);

      try {
      // Check credit freeze — borrower cannot take new loans while frozen
      if (this.isCreditFrozen(addrLower)) {
        logger.warn(`Borrow rejected: credit frozen for ${address} due to prior default`);
        EventBus.emitEvent('credit:borrow_rejected_frozen', 'credit', {
          action: 'borrow_rejected',
          reasoning: `Borrow rejected — borrower ${address} has frozen credit due to prior loan default. Must resolve outstanding defaults first.`,
          data: { address, amount: amount.toString(), reason: 'credit_frozen' },
          status: 'executed',
        });
        return null;
      }

      // Get or evaluate credit profile
      let profile = this.profiles.get(addrLower);
      
      if (!profile) {
        profile = await this.evaluateCredit(address);
      }

      // Check available credit
      const available = BigInt(profile.available);
      
      if (amount > available) {
        logger.warn(`Borrow request exceeds credit limit`, {
          address,
          requested: amount.toString(),
          available: available.toString(),
        });
        return null;
      }

      // Use LLM to evaluate borrow request and negotiate terms
      const evaluation = await this.evaluateBorrowRequest(address, amount, profile);

      if (!evaluation.approved) {
        logger.info(`Borrow request declined by agent`, { address, reasoning: evaluation.reasoning });
        return null;
      }

      // Execute on-chain borrow with LLM-negotiated terms via borrowForCustom
      let txHash: string | undefined;
      let onChainLoanId: number | undefined;
      const customDurationSec = evaluation.durationDays * 86400;
      try {
        const data = CREDIT_LINE_IFACE.encodeFunctionData('borrowForCustom', [
          address, amount, evaluation.rateBps, customDurationSec,
        ]);
        txHash = await this.sendTx(this.config.creditLineAddress, data, `borrowForCustom(${address})`);
        // Read loanCount to get the new loan ID
        const loanCount = await this.creditContract.loanCount();
        onChainLoanId = Number(loanCount) - 1;
        logger.info('On-chain borrow succeeded with LLM terms', {
          txHash, onChainLoanId, rateBps: evaluation.rateBps, durationDays: evaluation.durationDays,
        });
      } catch (err) {
        logger.error('On-chain borrow tx failed', { err: err instanceof Error ? err.message : String(err) });
      }

      // Read actual dueDate from chain (now uses LLM-negotiated duration via borrowForCustom)
      const now = Math.floor(Date.now() / 1000);
      let dueDate = now + evaluation.durationDays * 86400; // fallback: LLM-negotiated
      if (onChainLoanId !== undefined) {
        try {
          const onChainLoan = await this.creditContract.loans(onChainLoanId);
          dueDate = Number(onChainLoan.dueDate);
          logger.info('Synced dueDate from chain', { onChainLoanId, dueDate, llmDueDate: now + evaluation.durationDays * 86400 });
        } catch (err) {
          logger.warn('Failed to read on-chain dueDate, using LLM-negotiated', { err: err instanceof Error ? err.message : String(err) });
        }
      }
      const loanId = onChainLoanId ?? this.loans.size;
      const loan: Loan = {
        id: loanId,
        borrower: address,
        principal: amount.toString(),
        interestRate: evaluation.rateBps,
        borrowedAt: now,
        dueDate,
        repaid: '0',
        interest: '0',
        totalDue: amount.toString(),
        active: true,
      };
      this.loans.set(loanId, loan);

      // Update profile available credit
      profile.borrowed = (BigInt(profile.borrowed) + amount).toString();
      profile.available = (BigInt(profile.limit) - BigInt(profile.borrowed)).toString();
      this.profiles.set(address.toLowerCase(), profile);

      const decision: AgentDecision = {
        id: `borrow-${Date.now()}`,
        agentType: 'credit',
        timestamp: Date.now(),
        action: 'approve_borrow',
        reasoning: `${evaluation.reasoning} | Term: ${evaluation.durationDays}d at ${evaluation.rateBps / 100}%`,
        data: { address, amount: amount.toString(), score: profile.score, loanId, durationDays: evaluation.durationDays, rateBps: evaluation.rateBps },
        txHash,
        status: 'executed',
      };

      EventBus.emitEvent('credit:borrow_approved', 'credit', decision);

      // Request treasury to disburse
      EventBus.emitEvent('treasury:disburse_requested', 'credit', {
        to: address,
        amount: amount.toString(),
        reason: 'loan_disbursement',
      });

      logger.info(`Borrow approved for ${address}`, { amount: amount.toString(), loanId });

      return loan;
      } finally {
        this.borrowLocks.delete(addrLower);
      }
    } catch (error) {
      this.borrowLocks.delete(address.toLowerCase());
      logger.error(`Borrow processing failed for ${address}`, { error });
      return null;
    }
  }

  /**
   * Evaluate borrow request with LLM — negotiates loan terms (duration, rate)
   */
  async evaluateBorrowRequest(
    address: string,
    amount: bigint,
    profile: CreditProfile
  ): Promise<{ approved: boolean; durationDays: number; rateBps: number; reasoning: string; mlPrediction?: DefaultPrediction }> {
    const defaultDuration = 30;
    const defaultRate = profile.rate;

    // ML default prediction
    const history = await this.fetchCreditHistory(address);
    const mlPrediction = predictDefault(history, profile);

    // Hard-decline if ML predicts critical default risk
    if (mlPrediction.riskBucket === 'critical') {
      const reasoning = `[ML-BLOCKED] Default probability ${(mlPrediction.probability * 100).toFixed(1)}% (${mlPrediction.riskBucket}) — exceeds risk tolerance`;
      this.remember('borrow_declined_ml', reasoning);
      EventBus.emitEvent('credit:ml_block', 'credit', {
        address, amount: amount.toString(), probability: mlPrediction.probability, riskBucket: mlPrediction.riskBucket,
      });
      return { approved: false, durationDays: 0, rateBps: 0, reasoning, mlPrediction };
    }

    // ZK Credit Proof — prove score meets tier threshold without revealing exact score
    let zkVerified = false;
    let zkTierName = 'Unknown';
    const bestTier = getBestProvableTier(profile.score);
    if (bestTier) {
      const result = generateProof(profile.score, bestTier.threshold, bestTier.tierName);
      if (result) {
        const verification = verifyProof(result.proof);
        zkVerified = verification.valid;
        zkTierName = verification.tierName;
        logger.info('ZK credit proof verified', {
          address, tierName: zkTierName, valid: zkVerified, reason: verification.reason,
        });
        EventBus.emitEvent('credit:zk_proof_verified', 'credit', {
          address, tierName: zkTierName, threshold: bestTier.threshold, valid: zkVerified,
        });
      }
    }

    try {
      const utilizationPct = BigInt(profile.limit) > 0n
        ? Number((BigInt(profile.borrowed) * 100n) / BigInt(profile.limit))
        : 0;

      const memoryContext = this.decisionMemory.slice(-3)
        .map(m => `[${new Date(m.timestamp).toISOString()}] ${m.action}: ${m.reasoning}`)
        .join('\n');

      const prompt = `Evaluate this borrow request and negotiate loan terms.

Borrower: ${address}
Requested: ${ethers.formatUnits(amount, 6)} USDt
Credit Score: ${profile.score}/1000
Limit: ${ethers.formatUnits(profile.limit, 6)} USDt
Already Borrowed: ${ethers.formatUnits(profile.borrowed, 6)} USDt (${utilizationPct}% utilization)
Available: ${ethers.formatUnits(profile.available, 6)} USDt
Default Interest Rate: ${profile.rate / 100}%

ML Default Prediction:
- Probability of default: ${(mlPrediction.probability * 100).toFixed(1)}%
- Risk bucket: ${mlPrediction.riskBucket}
- Confidence: ${(mlPrediction.confidence * 100).toFixed(0)}%
- Top risk factor: ${mlPrediction.featureImportance[0]?.feature ?? 'N/A'} (contribution: ${mlPrediction.featureImportance[0]?.contribution ?? 0})

ZK Credit Proof: ${zkVerified ? `VERIFIED — tier "${zkTierName}"` : 'NOT VERIFIED'}

Term Negotiation Rules:
- Excellent borrowers (score 800+): offer 7-60 day terms, consider rate discounts up to 2%
- Good borrowers (score 600-799): offer 14-45 day terms, rate ±1%
- Poor borrowers (score <600): shorter terms 7-21 days, rate premium up to +3%
- High utilization (>70%) = shorter terms and rate premium
- Low amounts relative to limit = more flexibility
- If ML default probability > 35%, add rate premium and shorten terms

${memoryContext ? `Recent Decisions:\n${memoryContext}\n` : ''}
Respond in JSON: {"decision": "APPROVE" or "DECLINE", "durationDays": <number 7-60>, "rateBps": <annual rate in basis points>, "reasoning": "<1-2 sentences including term justification>"}`;

      const response = await this.llm.chat({
        messages: [
          { role: 'system', content: CREDIT_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 150,
      });

      const content = response.choices[0]?.message?.content?.trim() || '';
      const json = JSON.parse(content.replace(/```json?\n?|```/g, ''));

      const approved = json.decision?.toUpperCase() === 'APPROVE';
      const durationDays = Math.max(7, Math.min(60, Number(json.durationDays) || defaultDuration));
      const rateBps = Math.max(100, Math.min(2500, Number(json.rateBps) || defaultRate));

      const reasoning = json.reasoning || `${approved ? 'Approved' : 'Declined'} ${ethers.formatUnits(amount, 6)} USDt — ${durationDays}d at ${rateBps / 100}%`;
      const zkSuffix = zkVerified ? ` [ZK: ${zkTierName} tier verified]` : '';
      this.remember(
        approved ? 'borrow_approved' : 'borrow_declined',
        reasoning + zkSuffix,
      );
      return { approved, durationDays, rateBps, reasoning: reasoning + zkSuffix, mlPrediction };
    } catch (error) {
      logger.error('LLM borrow evaluation error', { error });
      // Deterministic fallback: approve if within available credit, negotiate based on score
      const approved = amount <= BigInt(profile.available);
      let durationDays = defaultDuration;
      let rateBps = defaultRate;
      if (profile.score >= 800) {
        durationDays = 45;
        rateBps = Math.max(100, defaultRate - 100);
      } else if (profile.score < 600) {
        durationDays = 14;
        rateBps = defaultRate + 200;
      }

      const reasoning = `[deterministic] ${approved ? 'Approved' : 'Declined'}: ${approved ? 'within' : 'exceeds'} available credit — ${durationDays}d at ${rateBps / 100}%`;
      const zkSuffix = zkVerified ? ` [ZK: ${zkTierName} tier verified]` : '';
      this.remember(
        approved ? 'borrow_approved' : 'borrow_declined',
        reasoning + zkSuffix,
      );
      return { approved, durationDays, rateBps, reasoning: reasoning + zkSuffix, mlPrediction };
    }
  }

  /**
   * Process loan repayment via WDK (fallback: ethers signer)
   */
  async processRepayment(loanId: number, amount: bigint): Promise<{ ok: boolean; error?: string }> {
    try {
      logger.info(`Processing repayment for loan ${loanId}`, {
        amount: amount.toString(),
      });

      // Pre-validation: check local loan exists and is active
      const localLoanForRepay = this.loans.get(loanId);
      if (!localLoanForRepay) {
        return { ok: false, error: `Loan #${loanId} not found` };
      }
      if (!localLoanForRepay.active) {
        return { ok: false, error: `Loan #${loanId} is already closed` };
      }
      const borrower = localLoanForRepay.borrower;

      // Pre-validation: check amount doesn't exceed totalDue on-chain
      try {
        const onChainDue = await this.creditContract.getAmountDue(loanId);
        if (amount > BigInt(onChainDue)) {
          return { ok: false, error: `Amount exceeds total due (${ethers.formatUnits(onChainDue, 6)} USDt)` };
        }
      } catch {
        // If can't read chain, proceed anyway — tx will revert if invalid
      }

      // Step 1: Approve USDt for CreditLine
      const approveData = ERC20_IFACE.encodeFunctionData('approve', [this.config.creditLineAddress, amount]);
      await this.sendTx(this.config.usdtAddress, approveData, `approve USDt for repay #${loanId}`);

      // Step 2: Repay via operator pattern
      const repayData = CREDIT_LINE_IFACE.encodeFunctionData('repayFor', [borrower, loanId, amount]);
      const hash = await this.sendTx(this.config.creditLineAddress, repayData, `repayFor loan #${loanId}`);

      // Recalculate borrower's credit
      const loan = await this.creditContract.loans(loanId);

      // Update local loan state
      const localLoan = this.loans.get(loanId);
      let fullyRepaid = false;
      if (localLoan) {
        localLoan.repaid = (BigInt(localLoan.repaid) + amount).toString();
        const due = BigInt(localLoan.totalDue) - amount;
        localLoan.totalDue = (due > 0n ? due : 0n).toString();
        if (due <= 0n) {
          localLoan.active = false;
          fullyRepaid = true;
        }
      }

      // Update borrower profile: reduce borrowed, increase available
      const profile = this.profiles.get(borrower.toLowerCase());
      if (profile && fullyRepaid && localLoan) {
        const principal = BigInt(localLoan.principal);
        const borrowed = BigInt(profile.borrowed);
        profile.borrowed = (borrowed > principal ? borrowed - principal : 0n).toString();
        profile.available = (BigInt(profile.limit) - BigInt(profile.borrowed)).toString();
      }

      const decision: AgentDecision = {
        id: `repay-${Date.now()}`,
        agentType: 'credit',
        timestamp: Date.now(),
        action: 'repay_loan',
        reasoning: `Repaid ${ethers.formatUnits(amount, 6)} USDt on loan #${loanId}${fullyRepaid ? ' — loan fully closed' : ''}`,
        data: { loanId, amount: amount.toString(), borrower: loan.borrower, fullyRepaid },
        txHash: hash,
        status: 'executed',
      };
      EventBus.emitEvent('credit:loan_repaid', 'credit', decision);

      // Auto re-evaluate credit score after full repayment (improves score)
      if (fullyRepaid) {
        this.evaluateCredit(borrower).catch(err =>
          logger.warn('Post-repay credit re-eval failed', { err: err instanceof Error ? err.message : String(err) })
        );
      }

      logger.info(`Repayment processed for loan ${loanId}`, { hash, fullyRepaid });
      return { ok: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Repayment failed for loan ${loanId}`, { error: msg, stack: error instanceof Error ? error.stack : undefined });
      // Extract revert reason if available
      const revertMatch = msg.match(/reason="([^"]+)"/);
      const userMsg = revertMatch ? revertMatch[1] : 'On-chain transaction failed';
      return { ok: false, error: userMsg };
    }
  }

  /**
   * Sync local state after borrower executed repay() on-chain directly from their wallet.
   */
  syncRepaymentLocal(loanId: number, amount: bigint): void {
    const localLoan = this.loans.get(loanId);
    if (!localLoan) return;

    localLoan.repaid = (BigInt(localLoan.repaid) + amount).toString();
    const due = BigInt(localLoan.totalDue) - amount;
    localLoan.totalDue = (due > 0n ? due : 0n).toString();
    const fullyRepaid = due <= 0n;
    if (fullyRepaid) {
      localLoan.active = false;
    }

    const borrower = localLoan.borrower;
    const profile = this.profiles.get(borrower.toLowerCase());
    if (profile && fullyRepaid) {
      const principal = BigInt(localLoan.principal);
      const borrowed = BigInt(profile.borrowed);
      profile.borrowed = (borrowed > principal ? borrowed - principal : 0n).toString();
      profile.available = (BigInt(profile.limit) - BigInt(profile.borrowed)).toString();
    }

    const decision: AgentDecision = {
      id: `repay-sync-${Date.now()}`,
      agentType: 'credit',
      timestamp: Date.now(),
      action: 'repay_loan',
      reasoning: `Borrower repaid ${ethers.formatUnits(amount, 6)} USDt on loan #${loanId} (direct on-chain)${fullyRepaid ? ' — loan closed' : ''}`,
      data: { loanId, amount: amount.toString(), borrower, fullyRepaid },
      status: 'executed',
    };
    EventBus.emitEvent('credit:loan_repaid', 'credit', decision);

    if (fullyRepaid) {
      this.evaluateCredit(borrower).catch(() => {});
    }

    logger.info(`Synced repayment for loan ${loanId}`, { amount: amount.toString(), fullyRepaid });
  }

  /**
   * Check for due loans and mark defaults
   */
  async checkDueLoans(): Promise<void> {
    try {
      const now = Math.floor(Date.now() / 1000);

      for (const [loanId, loan] of this.loans) {
        if (!loan.active) continue;

        const overdueSec = now - loan.dueDate;
        if (overdueSec > 0 && overdueSec <= CreditAgent.GRACE_PERIOD_SECONDS) {
          // ── Penalty interest accrual ──
          const overdueDays = Math.ceil(overdueSec / 86400);
          const penaltyTier = PENALTY_TIERS.find(t => overdueDays <= t.maxOverdueDays) || PENALTY_TIERS[PENALTY_TIERS.length - 1];
          const penaltyBps = penaltyTier.penaltyBps;
          loan.penaltyRateBps = penaltyBps;

          // Calculate penalty: principal × penaltyRate × overdueDays / 365
          const principal = BigInt(loan.principal);
          const penaltyAmount = (principal * BigInt(penaltyBps) * BigInt(overdueDays)) / (10000n * 365n);
          loan.penaltyAccrued = penaltyAmount.toString();

          // Incremental credit score reduction: -10 per day overdue (cap at -100 during grace)
          const profile = this.profiles.get(loan.borrower.toLowerCase());
          if (profile) {
            const scoreReduction = Math.min(overdueDays * 10, 100);
            const baseScore = this.calculateBaseScore(await this.fetchCreditHistory(loan.borrower));
            profile.score = Math.max(0, baseScore - scoreReduction);
            profile.lastUpdated = Date.now();
          }

          // Grace period — attempt autonomous repayment collection, then warn
          logger.info(`Loan ${loanId} overdue by ${overdueDays}d — penalty ${penaltyBps/100}%, accrued ${ethers.formatUnits(penaltyAmount, 6)} USDt`);

          // Autonomous repayment: agent attempts repayFor on-chain
          try {
            const amountDue = await this.creditContract.getAmountDue(loanId);
            if (BigInt(amountDue) > 0n) {
              // Approve USDT to CreditLine for repayment
              const approveData = ERC20_IFACE.encodeFunctionData('approve', [this.config.creditLineAddress, amountDue]);
              await this.sendTx(this.config.usdtAddress, approveData, `approve USDt for auto-repay loan #${loanId}`);

              // Execute repayFor on-chain
              const repayData = CREDIT_LINE_IFACE.encodeFunctionData('repayFor', [loan.borrower, loanId, amountDue]);
              const txHash = await this.sendTx(this.config.creditLineAddress, repayData, `auto-repayFor loan #${loanId}`);

              // Update local state
              loan.repaid = (BigInt(loan.repaid) + BigInt(amountDue)).toString();
              loan.active = false;

              const profile = this.profiles.get(loan.borrower.toLowerCase());
              if (profile) {
                const principal = BigInt(loan.principal);
                profile.borrowed = (BigInt(profile.borrowed) > principal ? BigInt(profile.borrowed) - principal : 0n).toString();
                profile.available = (BigInt(profile.limit) - BigInt(profile.borrowed)).toString();
              }

              EventBus.emitEvent('credit:autonomous_repayment', 'credit', {
                action: 'autonomous_repayment',
                reasoning: `Autonomously collected ${ethers.formatUnits(amountDue, 6)} USDt repayment for overdue loan #${loanId} from ${loan.borrower}`,
                data: { loanId, borrower: loan.borrower, amount: amountDue.toString(), txHash },
                status: 'executed',
              });

              logger.info(`Autonomous repayment succeeded for loan ${loanId}`, { txHash });
              continue; // Loan handled — skip to next
            }
          } catch (repayErr) {
            // Repayment attempt failed (insufficient USDT, not approved, etc.) — fall through to warning
            logger.warn(`Autonomous repayment attempt failed for loan ${loanId}`, {
              err: repayErr instanceof Error ? repayErr.message : String(repayErr),
            });
          }

          EventBus.emitEvent('credit:loan_grace_warning', 'credit', {
            action: 'grace_warning',
            reasoning: `Loan #${loanId} is ${Math.floor(overdueSec / 3600)}h overdue — auto-collection attempted, grace period expires in ${Math.floor((CreditAgent.GRACE_PERIOD_SECONDS - overdueSec) / 3600)}h. Penalty rate: ${penaltyBps / 100}%`,
            data: { loanId, borrower: loan.borrower, overdueHours: Math.floor(overdueSec / 3600), penaltyBps, penaltyAccrued: ethers.formatUnits(loan.penaltyAccrued || '0', 6) },
            status: 'executed',
          });
        } else if (overdueSec > CreditAgent.GRACE_PERIOD_SECONDS) {
          logger.warn(`Loan ${loanId} is past grace period, marking as defaulted`);
          
          try {
            const data = CREDIT_LINE_IFACE.encodeFunctionData('markDefaulted', [loanId]);
            await this.sendTx(this.config.creditLineAddress, data, `markDefaulted loan #${loanId}`);
          } catch (err) {
            logger.error(`Failed to mark loan ${loanId} as defaulted on-chain`, { err: err instanceof Error ? err.message : String(err) });
          }

          // Deactivate locally, freeze borrower credit, update profile
          loan.active = false;
          loan.creditFrozen = true;
          const profile = this.profiles.get(loan.borrower.toLowerCase());
          if (profile) {
            const borrowed = BigInt(profile.borrowed);
            const principal = BigInt(loan.principal);
            profile.borrowed = (borrowed > principal ? borrowed - principal : 0n).toString();
            // Credit freeze: set available to 0 — borrower cannot take new loans until resolved
            profile.available = '0';
            // Credit score penalty: -200 per default (enforced floor at 0)
            profile.score = Math.max(0, profile.score - 200);
            profile.lastUpdated = Date.now();
          }
          
          EventBus.emitEvent('credit:loan_defaulted', 'credit', {
            action: 'loan_defaulted',
            reasoning: `Loan #${loanId} defaulted — borrower ${loan.borrower} failed to repay ${ethers.formatUnits(loan.principal, 6)} USDt within grace period. Credit FROZEN, score reduced by 200. Total penalty accrued: ${ethers.formatUnits(loan.penaltyAccrued || '0', 6)} USDt`,
            data: { loanId, borrower: loan.borrower, amount: loan.principal, penaltyAccrued: loan.penaltyAccrued || '0', creditFrozen: true },
            status: 'executed',
          });
        }
      }
    } catch (error) {
      logger.error('Due loan check failed', { error });
    }
  }

  /**
   * Sync loans from blockchain
   */
  async syncLoans(): Promise<void> {
    try {
      let loanCount: number;
      try {
        loanCount = Number(await this.creditContract.loanCount());
      } catch {
        loanCount = 0;
      }

      if (loanCount === 0) return;

      for (let i = 0; i < Math.min(loanCount, 100); i++) {
        try {
          const loan = await this.creditContract.loans(i);
          
          if (loan.borrower !== ethers.ZeroAddress) {
            const [interest, totalDue] = await Promise.all([
              this.creditContract.calculateInterest(i),
              this.creditContract.getAmountDue(i),
            ]);

            // Admin-cancelled loans: force active=false regardless of on-chain state
            const forcedInactive = this.cancelledLoanIds.has(i);

            this.loans.set(i, {
              id: i,
              borrower: loan.borrower,
              principal: loan.principal.toString(),
              interestRate: Number(loan.interestRate),
              borrowedAt: Number(loan.borrowedAt),
              dueDate: Number(loan.dueDate),
              repaid: loan.repaid.toString(),
              interest: interest.toString(),
              totalDue: totalDue.toString(),
              active: forcedInactive ? false : loan.active,
            });
          }
        } catch {
          // Loan might not exist
        }
      }
    } catch (error) {
      logger.error('Loan sync failed', { error });
    }
  }

  /**
   * Get all cached credit profiles
   */
  getProfiles(): CreditProfile[] {
    return Array.from(this.profiles.values());
  }

  /**
   * Get user's credit profile (reads from contract's public mapping)
   */
  async getProfile(address: string): Promise<CreditProfile | null> {
    const cached = this.profiles.get(address.toLowerCase());
    if (cached) return cached;

    try {
      const p = await this.creditContract.profiles(address);
      
      if (!p.exists) return null;

      const borrowed = BigInt(p.borrowed);
      const limit = BigInt(p.limit);

      const profile: CreditProfile = {
        address,
        score: Number(p.score),
        limit: p.limit.toString(),
        rate: Number(p.rate),
        borrowed: p.borrowed.toString(),
        available: (limit - borrowed).toString(),
        lastUpdated: Number(p.lastUpdated),
        exists: true,
      };

      this.profiles.set(address.toLowerCase(), profile);
      return profile;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get user's active loans
   */
  async getUserLoans(address: string): Promise<Loan[]> {
    try {
      const loanIds = await this.creditContract.getActiveLoans(address);
      const loans: Loan[] = [];

      for (const id of loanIds) {
        const loan = this.loans.get(Number(id));
        if (loan) {
          loans.push(loan);
        }
      }

      return loans;
    } catch (error) {
      logger.error(`Failed to get loans for ${address}`, { error });
      return [];
    }
  }

  /**
   * Get all active loans
   */
  getAllActiveLoans(): Loan[] {
    return Array.from(this.loans.values()).filter(l => l.active && !this.cancelledLoanIds.has(l.id));
  }

  /**
   * Get full loan history for a user (active + repaid + defaulted)
   */
  getUserLoanHistory(address: string): Loan[] {
    const addrLower = address.toLowerCase();
    return Array.from(this.loans.values()).filter(
      l => l.borrower.toLowerCase() === addrLower
    );
  }

  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    EventBus.subscribe('credit:evaluate_requested', async (event) => {
      const address = event.payload.address as string;
      if (address) {
        await this.evaluateCredit(address);
      }
    });

    EventBus.subscribe('credit:borrow_requested', async (event) => {
      const { address, amount } = event.payload as { address: string; amount: string };
      if (address && amount) {
        await this.processBorrow(address, BigInt(amount));
      }
    });

    // Listen for revenue-backed borrow requests
    EventBus.subscribe('credit:revenue_borrow_requested', async (event) => {
      const { agentAddress, amount } = event.payload as { agentAddress: string; amount: string };
      if (agentAddress && amount) {
        await this.processRevenueBackedBorrow(agentAddress, BigInt(amount));
      }
    });

    // Listen for restructuring acceptance
    EventBus.subscribe('credit:restructuring_accepted', async (event) => {
      const { loanId, newDueDate, newRate, forgiveness } = event.payload as {
        loanId: number; newDueDate: number; newRate: number; forgiveness: string;
      };
      await this.applyRestructuring(loanId, newDueDate, newRate, forgiveness);
    });

    // Listen for dialogue consensus actions (autonomous lending triggers)
    EventBus.subscribe('dialogue:consensus_action', async (event) => {
      const { action, params } = event.payload as { action: string; params?: Record<string, unknown> };

      if (action === 'extend_credit') {
        if (params?.address) {
          const addr = String(params.address);
          // Validate: must be a real Ethereum address (0x + 40 hex chars)
          if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
            logger.debug('Dialogue extend_credit skipped: invalid address', { address: addr });
            return;
          }
          // Sanitize amount: LLM may return floats
          let rawAmount: string;
          try {
            const parsed = parseFloat(String(params.amount || '0.5'));
            rawAmount = ethers.parseUnits(Math.min(parsed, 100).toFixed(6), 6).toString();
          } catch {
            rawAmount = '500000'; // 0.5 USDt fallback
          }
          this.pendingBorrowRequests.push({
            address: addr,
            amount: rawAmount,
            source: 'dialogue_consensus',
            timestamp: Date.now(),
          });
          logger.info('Queued autonomous borrow from dialogue consensus', { address: addr, amount: rawAmount });
        } else {
          // No specific address — trigger a full autonomous lending cycle immediately
          logger.info('Board Meeting consensus: extend_credit — triggering autonomous lending cycle');
          this.processAutonomousLending().catch(err =>
            logger.warn('Autonomous lending cycle (dialogue-triggered) failed', { err: err instanceof Error ? err.message : String(err) })
          );
        }
      }

      if (action === 'reduce_exposure') {
        // Tighten lending: raise effective minScore by 100 for next cycle (stored in memory)
        logger.info('Board Meeting consensus: reduce_exposure — tightening lending criteria');
        EventBus.emitEvent('credit:risk_tightened', 'credit', {
          action: 'reduce_exposure',
          reasoning: 'Board Meeting consensus: reduce_exposure triggered — lending criteria tightened.',
          data: { scoreAdjustment: +100 },
          status: 'executed',
        });
      }
    });
  }

  /**
   * Seed credit profiles for known on-chain addresses.
   * Disabled — proactive lending is off, seeding not needed.
   */
  private async seedKnownBorrowers(): Promise<void> {
    return; // disabled
    const SEED_ADDRESSES = [
      this.config.privateKey
        ? new ethers.Wallet(this.config.privateKey as string).address
        : null,
    ].filter((a): a is string => !!a && ethers.isAddress(a));

    for (const addr of SEED_ADDRESSES) {
      const key = addr.toLowerCase();
      if (this.profiles.has(key)) continue; // already loaded from persisted state
      try {
        logger.info('Seeding credit profile for known address', { address: addr });
        await this.evaluateCredit(addr);
      } catch (err: any) {
        logger.warn('Failed to seed credit profile', { address: addr, err: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  /**
   * Autonomous lending — process pending borrow requests and proactively scan for lending opportunities.
   * This is the core "agent makes lending decisions without human prompts" feature.
   *
   * Flow: detect idle capital → search borrowers → evaluate risk → lend
   */
  private async processAutonomousLending(): Promise<void> {
    // 1) Process queued borrow requests (from EventBus, dialogue consensus, etc.)
    while (this.pendingBorrowRequests.length > 0) {
      const request = this.pendingBorrowRequests.shift()!;
      // Skip stale requests (> 10 min old)
      if (Date.now() - request.timestamp > 600_000) continue;

      logger.info('Processing autonomous borrow request', { address: request.address, source: request.source });
      try {
        const loan = await this.processBorrow(request.address, BigInt(request.amount));
        if (loan) {
          EventBus.emitEvent('credit:autonomous_lending', 'credit', {
            action: 'autonomous_borrow_executed',
            reasoning: `Autonomous lending: approved ${ethers.formatUnits(request.amount, 6)} USDt to ${request.address} (source: ${request.source})`,
            data: { loanId: loan.id, address: request.address, amount: request.amount, source: request.source },
            status: 'executed',
          });
        }
      } catch (err) {
        logger.error('Autonomous borrow failed', { address: request.address, err: err instanceof Error ? err.message : String(err) });
      }
    }

    // Proactive lending (unsolicited loans) is intentionally disabled.
    // The agent only processes explicit borrow requests from the queue above.
  }

  /**
   * Check if a borrower's credit is frozen (has a defaulted loan with creditFrozen flag).
   */
  private isCreditFrozen(address: string): boolean {
    const addr = address.toLowerCase();
    return Array.from(this.loans.values()).some(
      l => !l.active && l.creditFrozen && l.borrower.toLowerCase() === addr
    );
  }

  /**
   * LLM-driven evaluation: should the agent proactively offer a loan to this borrower?
   */
  // @ts-ignore unused — kept for future proactive lending feature
  private async _evaluateProactiveLending(
    address: string,
    profile: CreditProfile,
  ): Promise<{ approved: boolean; amount: string; reasoning: string }> {
    const available = ethers.formatUnits(profile.available, 6);
    const tier = this.getTier(profile.score);

    try {
      const response = await this.llm.chat({
        messages: [
          { role: 'system', content: CREDIT_SYSTEM_PROMPT },
          {
            role: 'user',
            content: `Should we proactively extend a loan to this borrower?\n\nAddress: ${address}\nCredit Score: ${profile.score}/1000 (${tier.name})\nAvailable Credit: ${available} USDt\nCurrent Borrowed: ${ethers.formatUnits(profile.borrowed, 6)} USDt\n\nRules:\n- Only approve if score >= 750 and utilization < 30%\n- Suggest conservative amount (max 25% of available credit)\n- Consider current treasury health\n\nRespond JSON: {"decision": "EXTEND" or "SKIP", "amount": "<raw units 6 decimals>", "reasoning": "<1 sentence>"}`,
          },
        ],
        temperature: 0.2,
        max_tokens: 100,
      });

      const content = response.choices[0]?.message?.content?.trim() || '';
      const json = JSON.parse(content.replace(/```json?\n?|```/g, ''));
      const approved = json.decision?.toUpperCase() === 'EXTEND';
      const amount = String(BigInt(json.amount || '0'));
      return { approved, amount, reasoning: json.reasoning || 'Proactive lending evaluation' };
    } catch {
      // Deterministic fallback: extend 10% of available if score >= 800
      if (profile.score >= 800) {
        const amt = (BigInt(profile.available) * 10n) / 100n;
        if (amt >= ethers.parseUnits('1', 6)) {
          return { approved: true, amount: amt.toString(), reasoning: `[deterministic] Score ${profile.score} qualifies for proactive 10% credit extension` };
        }
      }
      return { approved: false, amount: '0', reasoning: 'Score or available credit insufficient for proactive lending' };
    }
  }

  /**
   * Evaluate active loans for restructuring (ML-triggered, LLM-negotiated).
   * Called from the monitor loop. For each active loan, runs ML default prediction;
   * if the probability exceeds the threshold, DebtRestructuring proposes new terms.
   * Accepted proposals are applied to local loan state immediately.
   */
  private async checkRestructuring(): Promise<void> {
    if (!this.debtRestructuring) return;

    try {
      for (const [loanId, loan] of this.loans) {
        if (!loan.active) continue;

        const profile = this.profiles.get(loan.borrower.toLowerCase()) ?? null;
        const history = await this.fetchCreditHistory(loan.borrower);

        // evaluateLoan runs ML + LLM internally; returns null if loan is healthy
        const proposal = await this.debtRestructuring.evaluateLoan(loan, profile, history);

        if (proposal) {
          logger.info(`Restructuring proposed for loan #${loanId}`, {
            probability: proposal.mlPrediction.probability,
            newDueDate: proposal.proposedTerms.newDueDate,
            newRate: proposal.proposedTerms.newRateBps,
          });
        }
      }

      // Auto-accept pending proposals (autonomous behavior)
      const accepted = this.debtRestructuring.autoAcceptProposals();
      for (const p of accepted) {
        await this.applyRestructuring(
          p.originalLoanId,
          p.proposedTerms.newDueDate,
          p.proposedTerms.newRateBps,
          p.proposedTerms.forgiveness,
        );
      }
    } catch (error) {
      logger.error('Restructuring check failed', { error });
    }
  }

  /**
   * Process a revenue-backed borrow request.
   * Instead of using traditional credit limits, the loan is backed by projected future revenue.
   */
  async processRevenueBackedBorrow(agentAddress: string, amount: bigint): Promise<Loan | null> {
    if (!this.revenueTracker) {
      logger.warn('Revenue-backed borrow rejected — RevenueTracker not available');
      return null;
    }

    const addrLower = agentAddress.toLowerCase();
    if (this.borrowLocks.has(addrLower)) {
      logger.warn(`Borrow already in progress for ${agentAddress}`);
      return null;
    }
    this.borrowLocks.add(addrLower);

    try {
      const check = this.revenueTracker.canBorrowAgainstRevenue(agentAddress, amount);

      if (!check.allowed) {
        logger.info('Revenue-backed borrow rejected', { agentAddress, reason: check.reason });
        EventBus.emitEvent('credit:revenue_borrow_rejected', 'credit', {
          agentAddress, amount: amount.toString(), reason: check.reason,
        });
        return null;
      }

      // Revenue-backed loans get favorable terms: lower rate, longer duration
      const rateBps = 300; // 3% — lower than standard (backed by revenue)
      const durationDays = 60; // 60 days — longer repayment window
      const now = Math.floor(Date.now() / 1000);

      // Execute on-chain borrow
      let txHash: string | undefined;
      let onChainLoanId: number | undefined;
      try {
        const data = CREDIT_LINE_IFACE.encodeFunctionData('borrowForCustom', [
          agentAddress, amount, rateBps, durationDays * 86400,
        ]);
        txHash = await this.sendTx(this.config.creditLineAddress, data, `revenueBackedBorrow(${agentAddress})`);
        const loanCount = await this.creditContract.loanCount();
        onChainLoanId = Number(loanCount) - 1;
      } catch (err) {
        logger.error('On-chain revenue-backed borrow failed', { err: err instanceof Error ? err.message : String(err) });
      }

      let dueDate = now + durationDays * 86400;
      if (onChainLoanId !== undefined) {
        try {
          const onChainLoan = await this.creditContract.loans(onChainLoanId);
          dueDate = Number(onChainLoan.dueDate);
        } catch { /* use calculated dueDate */ }
      }

      const profile = this.revenueTracker.getProfile(agentAddress);
      const loanId = onChainLoanId ?? this.loans.size;
      const loan: Loan = {
        id: loanId,
        borrower: agentAddress,
        principal: amount.toString(),
        interestRate: rateBps,
        borrowedAt: now,
        dueDate,
        repaid: '0',
        interest: '0',
        totalDue: amount.toString(),
        active: true,
        loanType: 'revenue_backed',
        revenueProjection: profile.projectedRevenue30d,
      };
      this.loans.set(loanId, loan);

      // Update credit profile if exists
      const creditProfile = this.profiles.get(addrLower);
      if (creditProfile) {
        creditProfile.borrowed = (BigInt(creditProfile.borrowed) + amount).toString();
        creditProfile.available = (BigInt(creditProfile.limit) - BigInt(creditProfile.borrowed)).toString();
        this.profiles.set(addrLower, creditProfile);
      }

      EventBus.emitEvent('credit:revenue_borrow_approved', 'credit', {
        action: 'revenue_backed_borrow',
        reasoning: `Revenue-backed loan approved: ${check.reason} | Utilization: ${(check.utilization * 100).toFixed(1)}%`,
        data: {
          agentAddress, amount: amount.toString(), loanId, rateBps, durationDays,
          revenueCapacity: check.capacity, utilization: check.utilization,
        },
        txHash,
        status: 'executed',
      });

      EventBus.emitEvent('treasury:disburse_requested', 'credit', {
        to: agentAddress, amount: amount.toString(), reason: 'revenue_backed_loan',
      });

      logger.info('Revenue-backed borrow approved', {
        agentAddress, amount: amount.toString(), loanId, capacity: check.capacity,
      });

      return loan;
    } catch (error) {
      logger.error('Revenue-backed borrow failed', { error });
      return null;
    } finally {
      this.borrowLocks.delete(addrLower);
    }
  }

  /**
   * Apply restructured terms to a loan.
   *
   * CreditLine V1 contract does not have a native `restructureLoan()` function.
   * Workaround: close old loan via markDefaulted() + issue new loan via borrowForCustom()
   * with the restructured terms. This is atomic from the agent's perspective.
   */
  private async applyRestructuring(loanId: number, newDueDate: number, newRateBps: number, forgiveness: string): Promise<void> {
    const loan = this.loans.get(loanId);
    if (!loan || !loan.active) return;

    const oldDueDate = loan.dueDate;
    const oldRate = loan.interestRate;
    const borrower = loan.borrower;
    const forgivenAmount = BigInt(forgiveness);
    const remainingPrincipal = BigInt(loan.principal) - forgivenAmount;

    if (remainingPrincipal <= 0n) {
      // Full forgiveness — just close the loan
      loan.active = false;
      loan.repaid = loan.principal;
      loan.totalDue = '0';
      logger.info(`Loan #${loanId} fully forgiven via restructuring`);
      this.remember('restructure_loan', `Loan #${loanId} fully forgiven (${ethers.formatUnits(forgiveness, 6)} USDt)`);
      return;
    }

    // Step 1: Close old loan on-chain via markDefaulted (only way to close in V1 contract)
    let oldLoanClosed = false;
    try {
      const data = CREDIT_LINE_IFACE.encodeFunctionData('markDefaulted', [loanId]);
      await this.sendTx(this.config.creditLineAddress, data, `markDefaulted loan #${loanId} for restructuring`);
      oldLoanClosed = true;
      logger.info(`Old loan #${loanId} closed on-chain for restructuring`);
    } catch (err) {
      logger.warn(`Failed to close old loan #${loanId} on-chain — applying locally only`, {
        err: err instanceof Error ? err.message : String(err),
      });
    }

    // Step 2: Issue new loan with restructured terms on-chain
    let newTxHash: string | undefined;
    let newOnChainLoanId: number | undefined;
    const newDurationSec = newDueDate - Math.floor(Date.now() / 1000);
    if (oldLoanClosed && newDurationSec > 0) {
      try {
        const data = CREDIT_LINE_IFACE.encodeFunctionData('borrowForCustom', [
          borrower, remainingPrincipal, newRateBps, newDurationSec,
        ]);
        newTxHash = await this.sendTx(this.config.creditLineAddress, data, `restructure-reissue(${borrower})`);
        const loanCount = await this.creditContract.loanCount();
        newOnChainLoanId = Number(loanCount) - 1;
        logger.info(`Restructured loan reissued on-chain`, { newLoanId: newOnChainLoanId, hash: newTxHash });
      } catch (err) {
        logger.warn(`Failed to reissue restructured loan on-chain`, {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Update local state
    loan.active = false;
    loan.repaid = (BigInt(loan.repaid) + forgivenAmount).toString();

    // Track new restructured loan locally
    if (newOnChainLoanId !== undefined) {
      const newLoan: Loan = {
        id: newOnChainLoanId,
        borrower,
        principal: remainingPrincipal.toString(),
        interestRate: newRateBps,
        borrowedAt: Math.floor(Date.now() / 1000),
        dueDate: newDueDate,
        repaid: '0',
        interest: '0',
        totalDue: remainingPrincipal.toString(),
        active: true,
        loanType: 'restructured',
      };
      this.loans.set(newOnChainLoanId, newLoan);
    } else {
      // Fallback: just update local loan terms
      loan.active = true;
      loan.dueDate = newDueDate;
      loan.interestRate = newRateBps;
      const newTotalDue = BigInt(loan.totalDue) - forgivenAmount;
      loan.totalDue = (newTotalDue > 0n ? newTotalDue : 0n).toString();
    }

    const onChain = !!newTxHash;
    logger.info(`Restructuring applied to loan #${loanId}${onChain ? ' (on-chain)' : ' (local only)'}`, {
      oldDueDate, newDueDate, oldRate, newRateBps,
      forgiveness, borrower, onChain,
    });

    EventBus.emitEvent('credit:loan_restructured', 'credit', {
      action: 'restructure_loan',
      reasoning: `Loan #${loanId} restructured: rate ${oldRate}→${newRateBps}bps, due date extended, forgiveness ${ethers.formatUnits(forgiveness, 6)} USDt${onChain ? ' — executed on-chain' : ''}`,
      data: { loanId, newLoanId: newOnChainLoanId, borrower, newRateBps, newDueDate, forgiveness, onChain, txHash: newTxHash },
      status: onChain ? 'executed' : 'local_only',
    });

    this.remember('restructure_loan', `Loan #${loanId} restructured${onChain ? ' on-chain' : ''}: rate ${oldRate}→${newRateBps}bps, forgiveness ${ethers.formatUnits(forgiveness, 6)} USDt`);
  }

  /**
   * Queue an external borrow request for autonomous processing
   */
  queueBorrowRequest(address: string, amount: string, source: string): void {
    this.pendingBorrowRequests.push({ address, amount, source, timestamp: Date.now() });
    logger.info('Borrow request queued for autonomous processing', { address, amount, source });
  }

  /**
   * Store a decision in short-term memory (last 10 entries)
   */
  private remember(action: string, reasoning: string): void {
    this.decisionMemory.push({ role: 'credit', action, reasoning, timestamp: Date.now() });
    if (this.decisionMemory.length > 10) {
      this.decisionMemory.shift();
    }
  }

  /**
   * Get recent decisions
   */
  getRecentDecisions(limit: number = 10): AgentDecision[] {
    return EventBus.getRecentEvents(limit, 'credit') as unknown as AgentDecision[];
  }
}

export default CreditAgent;
