/**
 * Quorum MCP Server — stdio transport
 *
 * Exposes Treasury + Credit tools via MCP protocol for OpenClaw integration.
 * Proxies requests to the running backend API (default http://localhost:3001).
 *
 * Usage:
 *   node dist/mcp-server.js                      # default port 3001
 *   BACKEND_URL=http://localhost:4000 node dist/mcp-server.js
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`);
  if (!res.ok) throw new Error(`API ${path} returned ${res.status}`);
  return res.json() as Promise<T>;
}

async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API POST ${path} returned ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: 'quorum',
  version: '1.0.0',
});

// ========================== Treasury Tools ==================================

server.tool(
  'treasury_get_balance',
  'Get the current USDt balance of the DAO treasury vault',
  {},
  async () => {
    const data = await apiGet<{ success: boolean; data: { balance: string; dailyVolume: string } }>('/api/treasury');
    const bal = data.data;
    const formatted = (Number(bal.balance) / 1e6).toFixed(2);
    const vol = (Number(bal.dailyVolume) / 1e6).toFixed(2);
    return {
      content: [{
        type: 'text' as const,
        text: `Treasury Vault Balance: ${formatted} USDt\nDaily Volume Used: ${vol} USDt`,
      }],
    };
  },
);

server.tool(
  'treasury_get_state',
  'Get full treasury state including balance, pending transactions, and yield positions',
  {},
  async () => {
    const data = await apiGet<{ success: boolean; data: Record<string, unknown> }>('/api/treasury');
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(data.data, null, 2),
      }],
    };
  },
);

server.tool(
  'treasury_sync',
  'Force a state sync from on-chain data',
  {},
  async () => {
    const data = await apiPost<{ success: boolean; data: Record<string, unknown> }>('/api/treasury/sync');
    return {
      content: [{
        type: 'text' as const,
        text: `State synced successfully.\n${JSON.stringify(data.data, null, 2)}`,
      }],
    };
  },
);

const withdrawalSchema = {
  to: z.string().describe('Recipient Ethereum address'),
  amount: z.string().describe('Amount in USDt raw units (6 decimals, e.g. "1000000" = 1 USDt)'),
};

// @ts-expect-error TS2589 — MCP SDK deep generic; runtime correct
server.tool(
  'treasury_propose_withdrawal',
  'Propose a withdrawal from the treasury vault (starts timelock)',
  withdrawalSchema,
  async ({ to, amount }) => {
    const data = await apiPost<{ success: boolean; data?: { txHash: string }; error?: string }>(
      '/api/treasury/withdrawal/propose',
      { to, amount },
    );
    if (!data.success) {
      return { content: [{ type: 'text' as const, text: `Withdrawal rejected: ${data.error}` }] };
    }
    return {
      content: [{ type: 'text' as const, text: `Withdrawal proposed. TX hash: ${data.data!.txHash}\nTimelock: 1 hour before execution.` }],
    };
  },
);

server.tool(
  'treasury_invest_yield',
  'Invest treasury funds into an approved yield protocol (e.g. Aave)',
  {
    protocol: z.string().describe('Protocol name (e.g. "aave")'),
    amount: z.string().describe('Amount in USDt raw units (6 decimals)'),
    apy: z.number().optional().describe('Expected APY percentage'),
  },
  async ({ protocol, amount, apy }) => {
    const data = await apiPost<{ success: boolean; data?: { txHash: string }; error?: string }>(
      '/api/yield/invest',
      { protocol, amount, apy: apy ?? 0 },
    );
    if (!data.success) {
      return { content: [{ type: 'text' as const, text: `Investment rejected: ${data.error}` }] };
    }
    return {
      content: [{ type: 'text' as const, text: `Yield investment executed via ${protocol}. TX: ${data.data!.txHash}` }],
    };
  },
);

server.tool(
  'treasury_get_yield_opportunities',
  'Scan available yield opportunities across DeFi protocols',
  {},
  async () => {
    const data = await apiGet<{ success: boolean; data: Array<{ protocol: string; apy: number; tvl: string; risk: string }> }>('/api/yield/opportunities');
    if (!data.data?.length) {
      return { content: [{ type: 'text' as const, text: 'No yield opportunities found.' }] };
    }
    const table = data.data.map(o =>
      `${o.protocol}: ${o.apy}% APY | TVL: $${(Number(o.tvl) / 1e6).toFixed(0)}M | Risk: ${o.risk}`
    ).join('\n');
    return { content: [{ type: 'text' as const, text: `Yield Opportunities:\n${table}` }] };
  },
);

server.tool(
  'treasury_emergency_pause',
  'Activate emergency pause on the treasury vault — freezes ALL operations',
  {},
  async () => {
    const data = await apiPost<{ success: boolean; error?: string }>('/api/emergency/pause');
    return {
      content: [{
        type: 'text' as const,
        text: data.success
          ? 'EMERGENCY PAUSE ACTIVATED — all vault operations frozen.'
          : `Emergency pause failed: ${data.error}`,
      }],
    };
  },
);

server.tool(
  'treasury_emergency_unpause',
  'Resume vault operations after an emergency pause',
  {},
  async () => {
    const data = await apiPost<{ success: boolean; error?: string }>('/api/emergency/unpause');
    return {
      content: [{
        type: 'text' as const,
        text: data.success
          ? 'VAULT UNPAUSED — all operations resumed.'
          : `Unpause failed: ${data.error}`,
      }],
    };
  },
);

// ========================== Credit Tools ====================================

server.tool(
  'credit_evaluate',
  'Evaluate on-chain credit score for an Ethereum address',
  { address: z.string().describe('Ethereum address to evaluate') },
  async ({ address }) => {
    const data = await apiPost<{ success: boolean; data?: Record<string, unknown>; error?: string }>(
      `/api/credit/${address}/evaluate`,
    );
    if (!data.success) {
      return { content: [{ type: 'text' as const, text: `Credit evaluation failed: ${data.error}` }] };
    }
    const p = data.data as { score?: number; limit?: string; rate?: number } | undefined;
    const limit = p?.limit ? (Number(p.limit) / 1e6).toFixed(2) : '0';
    const rate = p?.rate ? (p.rate / 100).toFixed(1) : '0';
    return {
      content: [{
        type: 'text' as const,
        text: `Credit Profile for ${address}:\n  Score: ${p?.score ?? 'N/A'} / 1000\n  Limit: ${limit} USDt\n  Rate: ${rate}% APR`,
      }],
    };
  },
);

server.tool(
  'credit_get_profile',
  'Get existing credit profile for an address',
  { address: z.string().describe('Ethereum address') },
  async ({ address }) => {
    const data = await apiGet<{ success: boolean; data?: Record<string, unknown>; error?: string }>(
      `/api/credit/${address}`,
    );
    if (!data.success) {
      return { content: [{ type: 'text' as const, text: `Profile not found for ${address}` }] };
    }
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(data.data, null, 2) }],
    };
  },
);

server.tool(
  'credit_borrow',
  'Borrow USDt against on-chain credit profile',
  {
    address: z.string().describe('Borrower Ethereum address'),
    amount: z.string().describe('Amount in USDt raw units (6 decimals)'),
  },
  async ({ address, amount }) => {
    const data = await apiPost<{ success: boolean; data?: Record<string, unknown>; error?: string }>(
      `/api/credit/${address}/borrow`,
      { amount },
    );
    if (!data.success) {
      return { content: [{ type: 'text' as const, text: `Borrow declined: ${data.error}` }] };
    }
    return {
      content: [{ type: 'text' as const, text: `Loan approved:\n${JSON.stringify(data.data, null, 2)}` }],
    };
  },
);

const repaySchema = {
  address: z.string().describe('Borrower Ethereum address'),
  loanId: z.number().describe('Loan ID to repay'),
  amount: z.string().describe('Repayment amount in USDt raw units (6 decimals)'),
};

// @ts-expect-error TS2589 — MCP SDK deep generic; runtime correct
server.tool(
  'credit_repay',
  'Repay an active loan',
  repaySchema,
  async ({ address, loanId, amount }) => {
    const data = await apiPost<{ success: boolean; error?: string }>(
      `/api/credit/${address}/repay`,
      { loanId, amount },
    );
    return {
      content: [{
        type: 'text' as const,
        text: data.success
          ? `Loan ${loanId} repayment processed successfully.`
          : `Repayment failed: ${data.error}`,
      }],
    };
  },
);

server.tool(
  'credit_get_loans',
  'Get active loans for an address',
  { address: z.string().describe('Ethereum address') },
  async ({ address }) => {
    const data = await apiGet<{ success: boolean; data?: unknown[] }>(`/api/credit/${address}/loans`);
    if (!data.data?.length) {
      return { content: [{ type: 'text' as const, text: `No active loans for ${address}` }] };
    }
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(data.data, null, 2) }],
    };
  },
);

// ========================== Dashboard Tools ==================================

server.tool(
  'dashboard_get_data',
  'Get full dashboard data — treasury state, credit profiles, loans, and agent decisions',
  {},
  async () => {
    const data = await apiGet<{ success: boolean; data: Record<string, unknown> }>('/api/dashboard');
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(data.data, null, 2) }],
    };
  },
);

server.tool(
  'agent_get_decisions',
  'Get recent agent decisions with reasoning',
  { limit: z.number().optional().describe('Max number of decisions (default 15)') },
  async ({ limit }) => {
    const l = limit ?? 15;
    const data = await apiGet<{ success: boolean; data: Array<{ source: string; type: string; payload: { action?: string; reasoning?: string } }> }>(
      `/api/decisions?limit=${l}`,
    );
    if (!data.data?.length) {
      return { content: [{ type: 'text' as const, text: 'No agent decisions yet.' }] };
    }
    const lines = data.data.map((d, i) =>
      `${i + 1}. [${d.source}] ${d.type} — ${d.payload?.reasoning || d.payload?.action || 'no reasoning'}`
    ).join('\n');
    return {
      content: [{ type: 'text' as const, text: `Recent Agent Decisions:\n${lines}` }],
    };
  },
);

server.tool(
  'health_check',
  'Check if the Quorum backend is running and agents are active',
  {},
  async () => {
    const data = await apiGet<{ status: string; agents: Record<string, string> }>('/health');
    return {
      content: [{
        type: 'text' as const,
        text: `Status: ${data.status}\nTreasury Agent: ${data.agents.treasury}\nCredit Agent: ${data.agents.credit}`,
      }],
    };
  },
);

server.tool(
  'agent_dialogue_rounds',
  'Get recent inter-agent dialogue rounds where Treasury and Credit agents discuss strategy via LLM',
  { limit: z.number().optional().describe('Number of dialogue rounds to return (default: 3)') },
  async ({ limit }) => {
    const data = await apiGet<{ data: { dialogueRounds: Array<{ topic: string; topicPrompt: string; turns: Array<{ speaker: string; message: string }>; consensus: string; timestamp: number }> } }>('/api/dashboard');
    const rounds = (data.data?.dialogueRounds || []).slice(0, limit || 3);
    if (rounds.length === 0) {
      return { content: [{ type: 'text' as const, text: 'No dialogue rounds yet — agents discuss every ~45 seconds.' }] };
    }
    const text = rounds.map((r, i) => {
      const header = `=== Round ${i + 1}: ${r.topic} ===\nQ: ${r.topicPrompt}`;
      const turns = r.turns.map(t => `  [${t.speaker.toUpperCase()}]: ${t.message}`).join('\n');
      return `${header}\n${turns}\n  CONSENSUS: ${r.consensus}`;
    }).join('\n\n');
    return { content: [{ type: 'text' as const, text }] };
  },
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server is now running via stdio — OpenClaw or any MCP client can interact
}

main().catch((err) => {
  process.stderr.write(`MCP server fatal: ${err}\n`);
  process.exit(1);
});
