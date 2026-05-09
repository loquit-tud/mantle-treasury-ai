/**
 * Frontend Types - mirrors backend/src/types/index.ts
 */

export type AgentType = 'treasury' | 'credit' | 'risk';
export type AgentStatus = 'idle' | 'active' | 'error' | 'paused';

export interface AgentStatusData {
  treasury: AgentStatus;
  credit: AgentStatus;
  risk: AgentStatus;
}

export interface AgentDecision {
  id: string;
  agentType: AgentType;
  timestamp: number;
  action: string;
  reasoning: string;
  data: Record<string, unknown>;
  txHash?: string;
  status: 'pending' | 'executed' | 'failed';
}

export interface TreasuryState {
  balance: string;
  dailyVolume: string;
  pendingTransactions: PendingTransaction[];
  yieldPositions: YieldPosition[];
  lastUpdated: number;
}

export interface PendingTransaction {
  txHash: string;
  to: string;
  amount: string;
  proposedAt: number;
  executeAfter: number;
  signatures: number;
  executed: boolean;
}

export interface YieldPosition {
  protocol: string;
  amount: string;
  apy: number;
  investedAt: number;
  harvested: string;
}

export interface CreditProfile {
  address: string;
  score: number;
  limit: string;
  rate: number;
  borrowed: string;
  available: string;
  lastUpdated: number;
  exists: boolean;
}

export interface Loan {
  id: number;
  borrower: string;
  principal: string;
  interestRate: number;
  borrowedAt: number;
  dueDate: number;
  repaid: string;
  interest: string;
  totalDue: string;
  active: boolean;
  penaltyRateBps?: number;
  penaltyAccrued?: string;
  creditFrozen?: boolean;
  loanType?: 'standard' | 'revenue_backed';
}

export interface DialogueRound {
  topic: string;
  topicPrompt?: string;
  turns: { speaker: string; message: string; timestamp: number }[];
  consensus: string;
  timestamp: number;
}

export interface DashboardData {
  treasury: TreasuryState;
  creditProfiles: CreditProfile[];
  activeLoans: Loan[];
  agentDecisions: AgentDecision[];
  agentStatus: Record<AgentType, AgentStatus>;
  dialogueRounds?: DialogueRound[];
  mntVaultStatus?: {
    address: string;
    /** USDT0 reserves available to lend (6 decimals, raw units) */
    usdtReserves: string;
  } | null;
}

export interface WebSocketMessage {
  type: string;
  data: unknown;
  timestamp: number;
}

// ========== Bonus Feature Types ==========

export interface DefaultPrediction {
  probability: number;
  confidence: number;
  riskBucket: 'low' | 'medium' | 'high' | 'critical';
  featureImportance: { feature: string; contribution: number }[];
  modelVersion: string;
}

export interface ZKProof {
  commitment: string;
  tierName: string;
  tierThreshold: number;
  rangeProof: {
    bitCommitments: string[];
    challenge: string;
    responses: string[];
  };
}

export interface InterAgentLoan {
  id: string;
  amount: string;
  reason: string;
  status: 'pending' | 'allocated' | 'repaid' | 'declined';
  requestedAt: number;
  resolvedAt?: number;
}

export interface InterAgentSummary {
  totalAllocated: string;
  totalRepaid: string;
  activeLoans: number;
  declinedRequests: number;
}

export interface InterAgentPoolStatus {
  availableCapital: string;
  outstandingLoans: string;
  poolUtilization: number;
}

export interface DialogueTurn {
  agent: string;
  message: string;
  timestamp: number;
}
