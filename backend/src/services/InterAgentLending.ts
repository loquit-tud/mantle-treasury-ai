/**
 * Inter-Agent Lending — Enables the Credit Agent to borrow capital from the Treasury Agent.
 *
 * Flow:
 *   1. Credit Agent's lending pool drops below threshold (or explicit API call)
 *   2. InterAgentLending requests capital via EventBus → `credit:capital_request`
 *   3. Treasury Agent evaluates, proposes on-chain withdrawal via TreasuryVault
 *   4. Both sides record the inter-agent loan for tracking
 *
 * On-chain integration: capital allocations trigger `proposeWithdrawal` on-chain
 * so the transfer is recorded in the TreasuryVault contract (Arbitrum One).
 */

import EventBus from '../orchestrator/EventBus';
import logger from '../utils/logger';
import { saveInterAgentLoans, loadInterAgentLoans } from './StatePersistence';

export interface InterAgentLoan {
  id: string;
  fromAgent: 'treasury';
  toAgent: 'credit';
  amount: string;          // USDt raw units (6 dec)
  requestedAt: number;
  allocatedAt?: number;
  txHash?: string;         // on-chain proposeWithdrawal tx hash
  status: 'pending' | 'allocated' | 'repaid' | 'declined';
  reason: string;
}

interface PoolStatus {
  availableCapital: string;     // treasury balance (raw units)
  outstandingLoans: string;     // total borrowed from credit pool
  poolUtilization: number;      // 0-1
}

/**
 * Returns a pool-status evaluator function for the treasury.
 * We use a simple heuristic: allocate up to 20% of current treasury balance.
 */
function evaluateAllocation(
  requestedAmount: bigint,
  treasuryBalance: bigint,
): { approved: boolean; allocated: bigint; reason: string } {
  const MAX_ALLOCATION_PCT = 20n; // max 20% of treasury per allocation
  const maxAllocation = (treasuryBalance * MAX_ALLOCATION_PCT) / 100n;

  if (treasuryBalance === 0n) {
    return { approved: false, allocated: 0n, reason: 'Treasury balance is zero' };
  }
  if (requestedAmount <= 0n) {
    return { approved: false, allocated: 0n, reason: 'Invalid request amount' };
  }

  const allocated = requestedAmount > maxAllocation ? maxAllocation : requestedAmount;
  if (allocated === 0n) {
    return { approved: false, allocated: 0n, reason: 'Allocation would be zero' };
  }

  return {
    approved: true,
    allocated,
    reason: allocated < requestedAmount
      ? `Partial allocation: capped at 20% of treasury (${allocated.toString()} of ${requestedAmount.toString()} requested)`
      : `Full allocation of ${allocated.toString()} USDt approved`,
  };
}

export class InterAgentLending {
  private loans: InterAgentLoan[] = [];
  private getters: {
    getTreasuryBalance: () => bigint;
    getCreditPoolOutstanding: () => bigint;
    proposeWithdrawal: (to: string, amount: bigint) => Promise<string | null>;
  };

  constructor(deps: {
    getTreasuryBalance: () => bigint;
    getCreditPoolOutstanding: () => bigint;
    proposeWithdrawal: (to: string, amount: bigint) => Promise<string | null>;
  }) {
    this.getters = deps;

    // Restore persisted loans
    const persisted = loadInterAgentLoans();
    if (persisted && Array.isArray(persisted.loans)) {
      this.loans = persisted.loans as InterAgentLoan[];
      logger.info('Restored inter-agent loans from disk', {
        count: this.loans.length,
        savedAt: new Date(persisted.savedAt).toISOString(),
      });
    }

    this.setupListeners();
    logger.info('InterAgentLending module initialized');
  }

  /** Wire EventBus listeners */
  private setupListeners(): void {
    // Credit Agent requests capital
    EventBus.subscribe('credit:capital_request', (event) => {
      const { amount, reason } = event.payload as { amount: string; reason: string };
      this.handleCapitalRequest(amount, reason).catch(err =>
        logger.error('handleCapitalRequest error', { error: err instanceof Error ? err.message : String(err) }),
      );
    });

    // Treasury Agent harvests yield → auto-service outstanding inter-agent debt
    EventBus.subscribe('treasury:yield_harvested', (event) => {
      const { amount } = event.payload as { amount: string };
      this.serviceDebtFromRevenue(amount);
    });
  }

  /** Handle an incoming capital request from the Credit Agent */
  private async handleCapitalRequest(rawAmount: string, _reason: string): Promise<void> {
    const requestedAmount = BigInt(rawAmount);
    const treasuryBalance = this.getters.getTreasuryBalance();

    const evaluation = evaluateAllocation(requestedAmount, treasuryBalance);

    const loan: InterAgentLoan = {
      id: `ial-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      fromAgent: 'treasury',
      toAgent: 'credit',
      amount: evaluation.allocated.toString(),
      requestedAt: Date.now(),
      status: evaluation.approved ? 'allocated' : 'declined',
      reason: evaluation.reason,
    };

    // On-chain: propose withdrawal through TreasuryVault for approved allocations
    let txHash: string | null = null;
    if (evaluation.approved) {
      loan.allocatedAt = Date.now();
      try {
        // CreditLine contract address is the recipient — capital flows Treasury → CreditLine
        txHash = await this.getters.proposeWithdrawal(
          process.env.CREDIT_LINE_ADDRESS || '0x0000000000000000000000000000000000000000',
          evaluation.allocated,
        );
        if (txHash) {
          loan.txHash = txHash;
          logger.info('Inter-agent capital transfer proposed on-chain', { loanId: loan.id, txHash });
        }
      } catch (err) {
        logger.warn('On-chain inter-agent transfer failed (allocation tracked off-chain)', {
          loanId: loan.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    this.loans.push(loan);
    saveInterAgentLoans(this.loans);

    // Emit the response so both agents see it
    EventBus.emitEvent(
      evaluation.approved ? 'treasury:capital_allocated' : 'treasury:capital_declined',
      'treasury',
      {
        loanId: loan.id,
        requestedAmount: rawAmount,
        allocatedAmount: evaluation.allocated.toString(),
        reason: evaluation.reason,
        txHash: txHash || undefined,
        poolStatus: this.getPoolStatus(),
      },
    );

    logger.info(`Inter-agent capital ${evaluation.approved ? 'allocated' : 'declined'}`, {
      loanId: loan.id,
      requested: rawAmount,
      allocated: evaluation.allocated.toString(),
      reason: evaluation.reason,
      txHash: txHash || 'none',
    });
  }

  /** Public API: Credit Agent explicitly requests capital (also emits event) */
  requestCapital(amount: string, reason: string): void {
    EventBus.emitEvent('credit:capital_request', 'credit', { amount, reason });
  }

  /** Mark an inter-agent loan as repaid */
  repayLoan(loanId: string): boolean {
    const loan = this.loans.find(l => l.id === loanId);
    if (!loan || loan.status !== 'allocated') return false;

    loan.status = 'repaid';
    saveInterAgentLoans(this.loans);
    EventBus.emitEvent('credit:capital_repaid', 'credit', {
      loanId,
      amount: loan.amount,
    });
    return true;
  }

  /** Total outstanding inter-agent debt (allocated but not yet repaid) */
  getOutstandingDebt(): bigint {
    return this.loans
      .filter(l => l.status === 'allocated')
      .reduce((sum, l) => sum + BigInt(l.amount), 0n);
  }

  /**
   * Auto-service inter-agent debt from harvested yield revenue.
   * Iterates outstanding loans oldest-first and repays until revenue is exhausted.
   */
  serviceDebtFromRevenue(rawRevenue: string): void {
    let remaining = BigInt(rawRevenue);
    if (remaining <= 0n) return;

    const outstanding = this.loans.filter(l => l.status === 'allocated');
    if (outstanding.length === 0) return;

    let totalRepaid = 0n;
    const repaidIds: string[] = [];

    // Oldest-first repayment
    for (const loan of outstanding) {
      if (remaining <= 0n) break;
      const loanAmount = BigInt(loan.amount);
      if (remaining >= loanAmount) {
        loan.status = 'repaid';
        remaining -= loanAmount;
        totalRepaid += loanAmount;
        repaidIds.push(loan.id);
      }
      // Partial repayment not supported — skip to next loan
    }

    if (repaidIds.length > 0) {
      saveInterAgentLoans(this.loans);
      EventBus.emitEvent('treasury:debt_serviced', 'treasury', {
        repaidLoans: repaidIds,
        totalRepaid: totalRepaid.toString(),
        remainingRevenue: remaining.toString(),
        outstandingDebt: this.getOutstandingDebt().toString(),
      });

      logger.info('Inter-agent debt serviced from yield revenue', {
        repaidLoans: repaidIds.length,
        totalRepaid: totalRepaid.toString(),
        remainingRevenue: remaining.toString(),
      });
    }
  }

  /** Current pool status */
  getPoolStatus(): PoolStatus {
    const treasuryBalance = this.getters.getTreasuryBalance();
    const outstanding = this.getters.getCreditPoolOutstanding();
    const utilization = treasuryBalance > 0n
      ? Number((outstanding * 10000n) / treasuryBalance) / 10000
      : 0;

    return {
      availableCapital: treasuryBalance.toString(),
      outstandingLoans: outstanding.toString(),
      poolUtilization: Math.round(utilization * 10000) / 10000,
    };
  }

  /** Get all inter-agent loans */
  getLoans(): InterAgentLoan[] {
    return [...this.loans];
  }

  /** Get summary stats */
  getSummary(): {
    totalAllocated: string;
    totalRepaid: string;
    activeLoans: number;
    declinedRequests: number;
  } {
    let totalAllocated = 0n;
    let totalRepaid = 0n;
    let active = 0;
    let declined = 0;

    for (const loan of this.loans) {
      switch (loan.status) {
        case 'allocated':
          totalAllocated += BigInt(loan.amount);
          active++;
          break;
        case 'repaid':
          totalAllocated += BigInt(loan.amount);
          totalRepaid += BigInt(loan.amount);
          break;
        case 'declined':
          declined++;
          break;
      }
    }

    return {
      totalAllocated: totalAllocated.toString(),
      totalRepaid: totalRepaid.toString(),
      activeLoans: active,
      declinedRequests: declined,
    };
  }
}
