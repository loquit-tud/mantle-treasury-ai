/**
 * AgentTreasury Core Types
 */

// Agent Types
export type AgentType = 'treasury' | 'credit' | 'risk' | 'yield';

export type AgentStatus = 'idle' | 'active' | 'error' | 'paused';

export interface AgentDecision {
  id: string;
  agentType: AgentType;
  timestamp: number;
  action: string;
  reasoning: string;
  data: Record<string, unknown>;
  txHash?: string;
  status: 'pending' | 'executed' | 'failed';
  [key: string]: unknown;
}

// Treasury Types
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

export interface YieldOpportunity {
  protocol: string;
  apy: number;
  tvl: string;
  risk: 'low' | 'medium' | 'high';
}

// Credit Types
export interface CreditProfile {
  address: string;
  score: number;
  limit: string;
  rate: number; // APR in basis points
  borrowed: string;
  available: string;
  lastUpdated: number;
  exists: boolean;
}

export interface CreditHistory {
  transactionCount: number;
  volumeUSD: number;
  accountAge: number;
  repaidLoans: number;
  defaults: number;
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
  /** Revenue-backed loans use projected agent income as collateral instead of crypto */
  loanType?: 'standard' | 'revenue_backed' | 'restructured';
  /** For revenue-backed: the projected 30d revenue at time of issuance */
  revenueProjection?: string;
  /** For restructured loans: reference to restructuring proposal */
  restructuredFrom?: number;
  restructuringId?: string;
  /** Penalty rate applied when loan is overdue (basis points, added on top of base interest) */
  penaltyRateBps?: number;
  /** Total penalty accrued so far (raw USDt units) */
  penaltyAccrued?: string;
  /** Whether the borrower's credit is frozen due to this loan defaulting */
  creditFrozen?: boolean;
}

export interface CreditTier {
  minScore: number;
  limit: string;
  rate: number;
  name: string;
}

// WDK Types
export interface WDKWallet {
  address: string;
  balance: string;
  chainId: number;
}

export interface WDKTransaction {
  to: string;
  value: string;
  data?: string;
  gasLimit?: string;
}

// Event Bus Types
export interface AgentEvent {
  type: string;
  payload: Record<string, unknown>;
  timestamp: number;
  source: AgentType;
}

export type EventHandler = (event: AgentEvent) => void | Promise<void>;

// API Types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface DialogueTurn {
  speaker: 'treasury' | 'credit' | 'risk' | 'consensus';
  message: string;
  timestamp: number;
}

export interface DialogueRound {
  topic: string;
  topicPrompt: string;
  turns: DialogueTurn[];
  consensus: string;
  timestamp: number;
}

export interface DashboardData {
  treasury: TreasuryState;
  creditProfiles: CreditProfile[];
  activeLoans: Loan[];
  agentDecisions: AgentDecision[];
  agentStatus: Record<AgentType, AgentStatus>;
  dialogueRounds: DialogueRound[];
  revenueTracking?: Record<string, unknown> | null;
  debtRestructuring?: Record<string, unknown> | null;
  crossChainBridge?: Record<string, unknown> | null;
}

// Configuration Types
export interface AgentConfig {
  openaiApiKey: string;
  llmModel: string;
  llmBaseUrl?: string;
  llmFallbackApiKey?: string;
  llmFallbackModel?: string;
  llmFallbackBaseUrl?: string;
  llmFallbackName?: string;
  seedPhrase: string;
  privateKey?: string;
  rpcUrl: string;
  chainId: number;
  treasuryVaultAddress: string;
  creditLineAddress: string;
  usdtAddress: string;
  aavePoolAddress?: string;
  /** Ethereum mainnet RPC for cross-chain bridge + yield comparison */
  ethereumRpcUrl?: string;
  /** Polygon RPC for cross-chain bridge + yield comparison */
  polygonRpcUrl?: string;
}

// Risk Assessment
export interface RiskAssessment {
  score: number; // 0-100
  factors: RiskFactor[];
  recommendation: 'proceed' | 'caution' | 'reject';
}

export interface RiskFactor {
  name: string;
  impact: number; // -10 to +10
  description: string;
}

// Yield Strategy
export interface YieldStrategy {
  name: string;
  targetApy: number;
  maxExposure: number; // percentage of treasury
  protocols: string[];
  rebalanceThreshold: number; // percentage difference to trigger rebalance
}
