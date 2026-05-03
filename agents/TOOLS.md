# TOOLS — Available MCP Tools

> All tools below are exposed via the `agent-treasury` MCP server (`backend/src/mcp-server.ts`).
> The server proxies to the running backend API and requires no additional setup.

## Treasury Tools (MCP server: agent-treasury)

| Tool | Description |
|------|-------------|
| `treasury_get_balance` | Get USDt balance of the DAO treasury vault |
| `treasury_get_state` | Full treasury state: balance, pending txs, yield positions |
| `treasury_sync` | Force on-chain state sync |
| `treasury_propose_withdrawal` | Propose a withdrawal (starts 1h timelock) |
| `treasury_invest_yield` | Invest in approved yield protocol (Aave) |
| `treasury_get_yield_opportunities` | Scan DeFi protocols for yield |
| `treasury_emergency_pause` | Guardian: freeze all vault operations |

## Credit Tools (MCP server: agent-treasury)

| Tool | Description |
|------|-------------|
| `credit_evaluate` | Evaluate on-chain credit score for an address |
| `credit_get_profile` | Get existing credit profile |
| `credit_borrow` | Borrow USDt against credit profile |
| `credit_repay` | Repay an active loan |
| `credit_get_loans` | List active loans for an address |

## Dashboard / System Tools (MCP server: agent-treasury)

| Tool | Description |
|------|-------------|
| `dashboard_get_data` | Full dashboard: treasury, profiles, loans, decisions |
| `agent_get_decisions` | Recent agent decisions with LLM reasoning |
| `health_check` | Check backend status and agent health |

