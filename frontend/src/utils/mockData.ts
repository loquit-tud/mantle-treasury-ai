/**
 * Mock data for demo / static deployment (no backend required)
 */

import { DashboardData } from '../types';

const now = Date.now();

export const MOCK_DASHBOARD: DashboardData = {
  treasury: {
    balance: '47832.50',
    dailyVolume: '12400.00',
    lastUpdated: now,
    pendingTransactions: [
      {
        txHash: '0xabc123def456abc123def456abc123def456abc123def456abc123def456abc1',
        to: '0x3a2B4c5D6e7F8a9B0c1D2e3F4a5B6c7D8e9F0a1B',
        amount: '5000.00',
        proposedAt: now - 3600000,
        executeAfter: now + 3600000,
        signatures: 2,
        executed: false,
      },
    ],
    yieldPositions: [
      {
        protocol: 'USDY (Ondo)',
        amount: '20000.00',
        apy: 4.85,
        investedAt: now - 86400000 * 7,
        harvested: '187.32',
      },
      {
        protocol: 'mETH (Mantle)',
        amount: '10000.00',
        apy: 3.12,
        investedAt: now - 86400000 * 3,
        harvested: '25.64',
      },
    ],
  },

  creditProfiles: [
    {
      address: '0x1a2B3c4D5e6F7a8B9c0D1e2F3a4B5c6D7e8F9a0B',
      score: 820,
      limit: '25000.00',
      rate: 8.5,
      borrowed: '10000.00',
      available: '15000.00',
      lastUpdated: now - 120000,
      exists: true,
    },
    {
      address: '0x2b3C4d5E6f7A8b9C0d1E2f3A4b5C6d7E8f9A0b1C',
      score: 650,
      limit: '8000.00',
      rate: 14.2,
      borrowed: '3200.00',
      available: '4800.00',
      lastUpdated: now - 300000,
      exists: true,
    },
    {
      address: '0x3c4D5e6F7a8B9c0D1e2F3a4B5c6D7e8F9a0B1c2D',
      score: 910,
      limit: '50000.00',
      rate: 6.0,
      borrowed: '0.00',
      available: '50000.00',
      lastUpdated: now - 600000,
      exists: true,
    },
  ],

  activeLoans: [
    {
      id: 1,
      borrower: '0x1a2B3c4D5e6F7a8B9c0D1e2F3a4B5c6D7e8F9a0B',
      principal: '10000.00',
      interestRate: 850,
      borrowedAt: now - 86400000 * 14,
      dueDate: now + 86400000 * 16,
      repaid: '0.00',
      interest: '328.77',
      totalDue: '10328.77',
      active: true,
      loanType: 'standard',
    },
    {
      id: 2,
      borrower: '0x2b3C4d5E6f7A8b9C0d1E2f3A4b5C6d7E8f9A0b1C',
      principal: '3200.00',
      interestRate: 1420,
      borrowedAt: now - 86400000 * 5,
      dueDate: now + 86400000 * 25,
      repaid: '0.00',
      interest: '62.41',
      totalDue: '3262.41',
      active: true,
      loanType: 'revenue_backed',
    },
  ],

  agentDecisions: [
    {
      id: 'dec-001',
      agentType: 'treasury',
      timestamp: now - 60000,
      action: 'INVEST_YIELD',
      reasoning: 'USDY (Ondo) APY (4.85%) exceeds risk-adjusted threshold. Allocating idle USDT to maximize yield while maintaining 30% liquidity buffer.',
      data: { protocol: 'USDY (Ondo)', amount: '5000', apy: 4.85 },
      txHash: '0xf1725084abc123def456abc123def456abc123def456abc123def456abc12345',
      status: 'executed',
    },
    {
      id: 'dec-002',
      agentType: 'credit',
      timestamp: now - 180000,
      action: 'APPROVE_LOAN',
      reasoning: 'Borrower credit score 820 exceeds minimum threshold 700. Debt-to-limit ratio 40% within acceptable range. Approving at standard rate 8.5%.',
      data: { borrower: '0x1a2B3c4D...', amount: '10000', score: 820 },
      txHash: '0x9c9a2ff5abc123def456abc123def456abc123def456abc123def456abc12345',
      status: 'executed',
    },
    {
      id: 'dec-003',
      agentType: 'risk',
      timestamp: now - 420000,
      action: 'RISK_ASSESSMENT',
      reasoning: 'Portfolio risk score: 34/100 (LOW). Concentration risk acceptable. Liquidity coverage ratio 156%. No immediate action required.',
      data: { riskScore: 34, lcr: 156, concentration: 0.42 },
      status: 'executed',
    },
    {
      id: 'dec-004',
      agentType: 'treasury',
      timestamp: now - 900000,
      action: 'HARVEST_YIELD',
      reasoning: 'Accumulated yield from USDY position reaches harvest threshold. Compounding 187.32 USDT back into treasury.',
      data: { harvested: '187.32', source: 'USDY (Ondo)' },
      txHash: '0xe48480b7abc123def456abc123def456abc123def456abc123def456abc12345',
      status: 'executed',
    },
  ],

  agentStatus: {
    treasury: 'active',
    credit: 'idle',
    risk: 'active',
  },

  dialogueRounds: [
    {
      topic: 'Yield Strategy Optimization Q2',
      timestamp: now - 3600000,
      consensus: 'Increase USDY allocation to 45% of liquid assets. Monitor mETH rates weekly. Maintain 30% liquidity buffer.',
      turns: [
        {
          speaker: 'TreasuryAgent',
          message: 'Current yield from USDY (Ondo) at 4.85% APY. Recommend increasing allocation from 42% to 45% given stable rate environment on Mantle.',
          timestamp: now - 3660000,
        },
        {
          speaker: 'RiskAgent',
          message: 'Agreed on allocation increase. However, ensure liquidity buffer remains above 30%. Current ratio at 38% provides adequate headroom.',
          timestamp: now - 3640000,
        },
        {
          speaker: 'CreditAgent',
          message: 'Credit demand forecast for next 30 days: ~$18K. Treasury should retain at least $20K liquid for loan origination.',
          timestamp: now - 3620000,
        },
        {
          speaker: 'TreasuryAgent',
          message: 'Confirmed. Will allocate additional $5K to USDY while maintaining $22K liquid reserve. Proceeding with rebalance.',
          timestamp: now - 3600000,
        },
      ],
    },
  ],
};
