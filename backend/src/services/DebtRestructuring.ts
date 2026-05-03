/**
 * DebtRestructuring — Autonomous, ML-triggered, LLM-negotiated debt restructuring.
 *
 * Innovation: In DeFi, default = liquidation (brutal). This module does what a good bank does:
 * proactively detects distress signals and restructures loans BEFORE default happens.
 *
 * Flow:
 *   1. ML DefaultPredictor flags loan with high default probability (>0.5)
 *   2. DebtRestructuring proposes restructured terms via LLM negotiation
 *   3. New terms: extend duration, reduce rate, convert to tranches, or partial forgiveness
 *   4. If accepted, original loan is marked restructured and new loan terms apply
 *
 * This is UNIQUE in DeFi — no protocol does proactive autonomous restructuring.
 */

import { ethers } from 'ethers';
import EventBus from '../orchestrator/EventBus';
import { LLMClient } from './LLMClient';
import { predictDefault, type DefaultPrediction } from './DefaultPredictor';
import { saveRestructuringData, loadRestructuringData } from './StatePersistence';
import logger from '../utils/logger';
import type { Loan, CreditProfile, CreditHistory } from '../types';

export interface RestructuringProposal {
  id: string;
  originalLoanId: number;
  borrower: string;
  originalTerms: {
    principal: string;
    rateBps: number;
    dueDate: number;
    totalDue: string;
  };
  proposedTerms: {
    newDueDate: number;
    newRateBps: number;
    /** Optional partial forgiveness (USDt raw) — 0 if none */
    forgiveness: string;
    /** Split into tranches? */
    tranches: number;
  };
  mlPrediction: {
    probability: number;
    riskBucket: string;
  };
  reasoning: string;
  status: 'proposed' | 'accepted' | 'declined' | 'expired';
  proposedAt: number;
  resolvedAt?: number;
}

/** Trigger restructuring when ML default probability exceeds this */
const RESTRUCTURE_THRESHOLD = 0.5;
/** Proposals expire after 24h if not acted on */
const PROPOSAL_TTL_MS = 24 * 3600_000;

const RESTRUCTURING_SYSTEM_PROMPT = `You are the Debt Restructuring Agent for AgentTreasury.

Your role: When a loan is at risk of default, you propose restructured terms that:
1. Extend the repayment period to reduce pressure
2. Adjust interest rates based on the borrower's situation
3. Optionally forgive a small portion to ensure recovery
4. Split into tranches if the amount is large

Your goal: MAXIMIZE RECOVERY while being fair to borrowers.

Key principle: Getting 80% back through restructuring is better than getting 0% from a default.

Always respond in valid JSON matching the requested schema.`;

export class DebtRestructuring {
  private proposals: RestructuringProposal[] = [];
  private llm: LLMClient;
  private processedLoanIds: Set<number> = new Set();

  constructor(llmClient: LLMClient) {
    this.llm = llmClient;

    // Restore persisted data
    const persisted = loadRestructuringData();
    if (persisted && Array.isArray(persisted.proposals)) {
      this.proposals = persisted.proposals as RestructuringProposal[];
      // Rebuild processed set from accepted/proposed
      for (const p of this.proposals) {
        if (p.status === 'proposed' || p.status === 'accepted') {
          this.processedLoanIds.add(p.originalLoanId);
        }
      }
      logger.info('Restored DebtRestructuring from disk', { proposals: this.proposals.length });
    }

    logger.info('DebtRestructuring initialized — autonomous restructuring enabled');
  }

  /**
   * Evaluate a loan for potential restructuring.
   * Called from CreditAgent's monitoring loop.
   *
   * Returns a proposal if restructuring is warranted, null otherwise.
   */
  async evaluateLoan(
    loan: Loan,
    profile: CreditProfile | null,
    history: CreditHistory,
  ): Promise<RestructuringProposal | null> {
    // Don't re-process already restructured loans
    if (this.processedLoanIds.has(loan.id)) return null;

    // Run ML prediction
    const prediction = predictDefault(history, profile ?? null);

    if (prediction.probability < RESTRUCTURE_THRESHOLD) {
      return null; // Loan is healthy
    }

    logger.info(`Loan #${loan.id} flagged for restructuring`, {
      defaultProbability: prediction.probability,
      riskBucket: prediction.riskBucket,
      borrower: loan.borrower,
    });

    // Use LLM to negotiate restructured terms
    const proposal = await this.proposeRestructuring(loan, profile, prediction);

    if (proposal) {
      this.proposals.push(proposal);
      this.processedLoanIds.add(loan.id);
      saveRestructuringData(this.proposals);

      EventBus.emitEvent('credit:restructuring_proposed', 'credit', {
        proposalId: proposal.id,
        loanId: loan.id,
        borrower: loan.borrower,
        defaultProbability: prediction.probability,
        originalDueDate: loan.dueDate,
        newDueDate: proposal.proposedTerms.newDueDate,
        originalRate: loan.interestRate,
        newRate: proposal.proposedTerms.newRateBps,
        forgiveness: proposal.proposedTerms.forgiveness,
        reasoning: proposal.reasoning,
      });

      logger.info('Restructuring proposal created', {
        proposalId: proposal.id,
        loanId: loan.id,
        extension: `${Math.floor((proposal.proposedTerms.newDueDate - loan.dueDate) / 86400)}d`,
        rateChange: `${loan.interestRate}→${proposal.proposedTerms.newRateBps} bps`,
      });
    }

    return proposal;
  }

  /** Use LLM to create restructured terms */
  private async proposeRestructuring(
    loan: Loan,
    profile: CreditProfile | null,
    prediction: DefaultPrediction,
  ): Promise<RestructuringProposal | null> {
    const now = Math.floor(Date.now() / 1000);
    const daysOverdue = Math.max(0, Math.floor((now - loan.dueDate) / 86400));
    const daysRemaining = Math.max(0, Math.floor((loan.dueDate - now) / 86400));
    const principalUsd = ethers.formatUnits(loan.principal, 6);
    const repaidUsd = ethers.formatUnits(loan.repaid, 6);
    const totalDueUsd = ethers.formatUnits(loan.totalDue, 6);

    try {
      const prompt = `A loan is at risk of default. Propose restructured terms to maximize recovery.

LOAN DETAILS:
- Loan ID: #${loan.id}
- Borrower: ${loan.borrower}
- Principal: ${principalUsd} USDt
- Current Rate: ${loan.interestRate / 100}% APR
- Already Repaid: ${repaidUsd} USDt
- Total Due: ${totalDueUsd} USDt
- ${daysOverdue > 0 ? `OVERDUE by ${daysOverdue} days` : `${daysRemaining} days until due`}

BORROWER PROFILE:
- Credit Score: ${profile?.score ?? 'unknown'}/1000
- Total Borrowed: ${profile ? ethers.formatUnits(profile.borrowed, 6) : '?'} USDt

ML DEFAULT PREDICTION:
- Probability: ${(prediction.probability * 100).toFixed(1)}%
- Risk Bucket: ${prediction.riskBucket}
- Top Risk Factor: ${prediction.featureImportance[0]?.feature ?? 'N/A'}

RESTRUCTURING OPTIONS:
1. Extend duration (add 7-90 days)
2. Reduce rate (min 1% APR = 100 bps)
3. Partial forgiveness (max 20% of principal for critical risk)
4. Split into tranches (2-4)

Respond in JSON:
{
  "extensionDays": <7-90>,
  "newRateBps": <100-2500>,
  "forgivenessPct": <0-20>,
  "tranches": <1-4>,
  "reasoning": "<2-3 sentences explaining the proposal>"
}`;

      const response = await this.llm.chat({
        messages: [
          { role: 'system', content: RESTRUCTURING_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 200,
      });

      const content = response.choices[0]?.message?.content?.trim() || '';
      const json = JSON.parse(content.replace(/```json?\n?|```/g, ''));

      const extensionDays = Math.max(7, Math.min(90, Number(json.extensionDays) || 30));
      const newRateBps = Math.max(100, Math.min(2500, Number(json.newRateBps) || loan.interestRate));
      const forgivenessPct = Math.max(0, Math.min(20, Number(json.forgivenessPct) || 0));
      const tranches = Math.max(1, Math.min(4, Number(json.tranches) || 1));
      const reasoning = json.reasoning || 'Restructuring proposed to prevent default.';

      const forgivenessAmount = (BigInt(loan.principal) * BigInt(forgivenessPct)) / 100n;

      return {
        id: `rst-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        originalLoanId: loan.id,
        borrower: loan.borrower,
        originalTerms: {
          principal: loan.principal,
          rateBps: loan.interestRate,
          dueDate: loan.dueDate,
          totalDue: loan.totalDue,
        },
        proposedTerms: {
          newDueDate: loan.dueDate + extensionDays * 86400,
          newRateBps: newRateBps,
          forgiveness: forgivenessAmount.toString(),
          tranches,
        },
        mlPrediction: {
          probability: prediction.probability,
          riskBucket: prediction.riskBucket,
        },
        reasoning,
        status: 'proposed',
        proposedAt: Date.now(),
      };
    } catch (error) {
      logger.error('LLM restructuring proposal failed', { error });

      // Deterministic fallback
      const extensionDays = prediction.riskBucket === 'critical' ? 60 : 30;
      const newRateBps = Math.max(100, loan.interestRate - 200);
      const forgivenessPct = prediction.riskBucket === 'critical' ? 10 : 0;
      const forgivenessAmount = (BigInt(loan.principal) * BigInt(forgivenessPct)) / 100n;

      return {
        id: `rst-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        originalLoanId: loan.id,
        borrower: loan.borrower,
        originalTerms: {
          principal: loan.principal,
          rateBps: loan.interestRate,
          dueDate: loan.dueDate,
          totalDue: loan.totalDue,
        },
        proposedTerms: {
          newDueDate: loan.dueDate + extensionDays * 86400,
          newRateBps: newRateBps,
          forgiveness: forgivenessAmount.toString(),
          tranches: 1,
        },
        mlPrediction: {
          probability: prediction.probability,
          riskBucket: prediction.riskBucket,
        },
        reasoning: `[deterministic] Extending ${extensionDays}d, rate ${loan.interestRate}→${newRateBps}bps` +
          (forgivenessPct > 0 ? `, ${forgivenessPct}% forgiveness` : '') +
          ` to prevent ${prediction.riskBucket}-risk default.`,
        status: 'proposed',
        proposedAt: Date.now(),
      };
    }
  }

  /**
   * Accept a restructuring proposal — updates the loan terms.
   * Returns the new loan terms to be applied by CreditAgent.
   */
  acceptProposal(proposalId: string): RestructuringProposal | null {
    const proposal = this.proposals.find(p => p.id === proposalId);
    if (!proposal || proposal.status !== 'proposed') return null;

    proposal.status = 'accepted';
    proposal.resolvedAt = Date.now();
    saveRestructuringData(this.proposals);

    EventBus.emitEvent('credit:restructuring_accepted', 'credit', {
      proposalId: proposal.id,
      loanId: proposal.originalLoanId,
      borrower: proposal.borrower,
      newDueDate: proposal.proposedTerms.newDueDate,
      newRate: proposal.proposedTerms.newRateBps,
      forgiveness: proposal.proposedTerms.forgiveness,
    });

    logger.info('Restructuring proposal accepted', { proposalId, loanId: proposal.originalLoanId });
    return proposal;
  }

  /** Decline a proposal */
  declineProposal(proposalId: string): boolean {
    const proposal = this.proposals.find(p => p.id === proposalId);
    if (!proposal || proposal.status !== 'proposed') return false;

    proposal.status = 'declined';
    proposal.resolvedAt = Date.now();
    this.processedLoanIds.delete(proposal.originalLoanId);
    saveRestructuringData(this.proposals);

    EventBus.emitEvent('credit:restructuring_declined', 'credit', {
      proposalId, loanId: proposal.originalLoanId,
    });
    return true;
  }

  /** Auto-accept proposals for demonstration (autonomous behavior) */
  autoAcceptProposals(): RestructuringProposal[] {
    const pending = this.proposals.filter(p => p.status === 'proposed');
    const accepted: RestructuringProposal[] = [];

    for (const p of pending) {
      // Auto-expire old proposals
      if (Date.now() - p.proposedAt > PROPOSAL_TTL_MS) {
        p.status = 'expired';
        continue;
      }
      // Auto-accept: the borrower agent "agrees" to restructured terms
      this.acceptProposal(p.id);
      accepted.push(p);
    }

    if (accepted.length > 0) {
      saveRestructuringData(this.proposals);
    }
    return accepted;
  }

  /** Get all proposals */
  getProposals(status?: RestructuringProposal['status']): RestructuringProposal[] {
    if (status) return this.proposals.filter(p => p.status === status);
    return [...this.proposals];
  }

  /** Get proposal for a specific loan */
  getProposalForLoan(loanId: number): RestructuringProposal | undefined {
    return this.proposals.find(p => p.originalLoanId === loanId && p.status !== 'expired');
  }

  /** Summary for dashboard */
  getSummary(): {
    totalProposals: number;
    pending: number;
    accepted: number;
    declined: number;
    avgExtensionDays: number;
    totalForgiven: string;
  } {
    const accepted = this.proposals.filter(p => p.status === 'accepted');
    const avgExtension = accepted.length > 0
      ? accepted.reduce((s, p) =>
          s + (p.proposedTerms.newDueDate - p.originalTerms.dueDate) / 86400, 0
        ) / accepted.length
      : 0;
    const totalForgiven = accepted.reduce((s, p) => s + BigInt(p.proposedTerms.forgiveness), 0n);

    return {
      totalProposals: this.proposals.length,
      pending: this.proposals.filter(p => p.status === 'proposed').length,
      accepted: accepted.length,
      declined: this.proposals.filter(p => p.status === 'declined').length,
      avgExtensionDays: Math.round(avgExtension),
      totalForgiven: totalForgiven.toString(),
    };
  }
}
