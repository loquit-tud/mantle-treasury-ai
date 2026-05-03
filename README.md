# Quorum

**Autonomous DAO CFO system built on Mantle Network.**

Three AI agents (Treasury, Credit, Risk) manage on-chain capital — yield optimization, lending, and risk monitoring — without human intervention. They communicate through a pub/sub EventBus and hold structured debates every 45 seconds (Board Meetings) to reach consensus on capital allocation.

## What It Does

| Agent | Role |
|-------|------|
| **Treasury Agent** | Yields idle capital via Aurelius Finance (Aave V3 fork on Mantle), proposes withdrawals, detects opportunities |
| **Credit Agent** | Scores borrowers on-chain, approves loans, monitors repayments, restructures at-risk loans autonomously |
| **Risk Agent** | Monitors systemic risk, enforces exposure limits, flags anomalies to other agents |

### Feature Highlights
- ✅ **Inter-agent lending** — Credit Agent borrows capital from Treasury's pool via EventBus (`credit:capital_request` → `treasury:capital_allocated`). Treasury evaluates and caps at 20% of balance per request.
- ✅ **ML default prediction** — Logistic regression predicts default probability (0–100%) from 7 features. Critical risk (>60%) auto-blocks loans before LLM evaluation.
- ✅ **ZK credit proofs** — Prove credit score meets a tier threshold without revealing the exact score. SHA-256 commitments + Fiat-Shamir range proofs + replay prevention.
- ✅ **Revenue-backed lending** — Borrow against projected future earnings (invoice factoring for the agent economy). Tracks 24h/7d/30d rolling revenue and borrow capacity.
- ✅ **Autonomous debt restructuring** — ML-triggered, LLM-negotiated term modification. Extend duration, reduce rate, partial forgiveness, split into tranches.
- ✅ **Idle capital detection** — Agent reads vault balance on-chain, detects idle capital, and proactively extends loans in aggressive mode (>2000 USDt idle).
- ✅ **Tiered penalty interest** — Overdue loans accrue 5/10/15% penalty by age. Credit freeze on default.

### Key Stack

| Technology | Role |
|-----------|------|
| **Mantle Network** | L2 for all on-chain operations (chain ID 5000) |
| **Aurelius Finance** | Yield protocol (Aave V3 fork on Mantle) |
| **Ethers.js v6** | Contract interactions + wallet (HDNodeWallet) |
| **Foundry** | Smart contract tests (31 tests) & deployment |
| **Groq** (LLaMA 3.3 70B) | Primary LLM for agent reasoning |
| **OpenClaw** | Agent identity (SOUL.md), skills, MCP tool definitions |
| **MCP Server** | 15 tools for external agent access (stdio transport) |
| **SQLite (WAL)** | Persistent state: loans, profiles, decisions, ZK proof log |

## Architecture

```
quorum/
├── agents/                       # OpenClaw agent workspace
│   ├── SOUL.md                   # Behavioral identity & safety constraints
│   ├── AGENTS.md                 # Agent roster & communication rules
│   ├── TOOLS.md                  # Available MCP tools (15)
│   ├── treasury/SKILL.md         # Treasury agent skill
│   └── credit/SKILL.md           # Credit agent skill
├── contracts/                    # Solidity 0.8.20 (Foundry, 31 tests)
│   ├── TreasuryVault.sol         # Multi-sig vault + yield (RBAC, timelock)
│   ├── CreditLine.sol            # Credit scoring + lending (3 tiers)
│   ├── MockUSDT.sol              # Test token for local dev
│   └── script/Deploy.s.sol
├── backend/                      # Node.js + Express + WebSocket
│   └── src/
│       ├── agents/
│       │   ├── TreasuryAgent.ts  # Yield optimization, withdrawal proposals
│       │   ├── CreditAgent.ts    # Credit scoring, lending, repayment
│       │   └── RiskAgent.ts      # Compliance & systemic risk (advisory)
│       ├── orchestrator/
│       │   ├── EventBus.ts       # Pub/sub for inter-agent communication
│       │   └── AgentDialogue.ts  # Board Meetings (LLM-driven debate)
│       ├── services/
│       │   ├── wdk.ts                 # Agent wallet (ethers HDNodeWallet)
│       │   ├── LLMClient.ts           # Failover LLM wrapper (primary + fallback)
│       │   ├── DefaultPredictor.ts    # ML logistic regression for default prediction
│       │   ├── InterAgentLending.ts   # Inter-agent capital allocation via EventBus
│       │   ├── ZKCreditProof.ts       # ZK range proofs for credit tier privacy
│       │   ├── RevenueTracker.ts      # Revenue-backed lending
│       │   ├── DebtRestructuring.ts   # Autonomous debt restructuring (ML+LLM)
│       │   ├── StateDB.ts             # SQLite (WAL) persistence layer
│       │   ├── CrossChainBridge.ts    # Cross-chain bridge (disabled in v1)
│       │   └── StatePersistence.ts    # Dual-write: JSON + SQLite
│       ├── mcp-server.ts         # MCP server (stdio, 15 tools)
│       └── index.ts              # Express API + WebSocket server
├── frontend/                     # React 18 + Vite + Tailwind
│   └── src/
│       ├── pages/Dashboard.tsx   # Main dashboard (timeline, agents, loans)
│       ├── components/           # AgentStatus, LiveLogs, WalletButton
│       └── hooks/                # useDashboard, useWebSocket (real-time)
├── openclaw.config.json          # OpenClaw MCP server config
└── foundry.toml                  # Forge configuration (Mantle RPC endpoints)
```

### System Flow

```
                    ┌──────────────────────────┐
                    │      Smart Contracts      │
                    │    TreasuryVault.sol       │
                    │     CreditLine.sol         │
                    │    (Mantle Network L2)     │
                    └───────────▲───────────────┘
                                │ ethers.js
                    ┌───────────┴───────────────┐
                    │         Backend            │
                    │    Express + WS :3001      │
                    │    + MCP Server (stdio)    │
                    └──┬─────────┬──────────┬───┘
                       │         │          │
          ┌────────────▼──┐ ┌───▼────────┐ ┌▼──────────────┐
          │   Treasury    │ │   Credit   │ │     Risk      │
          │    Agent      │ │   Agent    │ │    Agent      │
          │ yield/invest  │ │ score/lend │ │  ML predict   │
          └───────┬───────┘ └─────┬──────┘ └───────┬───────┘
                  │               │                 │
                  └───────┬───────┴─────────────────┘
                          │
                   ┌──────▼───────────────────────┐
                   │          EventBus             │
                   │  + AgentDialogue (LLM 45s)    │
                   └──────┬───────────────────────┘
                          │
             ┌────────────▼─────────────────┐
             │       Services Layer          │
             │  CrossChainBridge │ ZKProof   │
             │  InterAgentLend  │ Revenue    │
             │  DebtRestructure │ StateDB    │
             └────────────┬─────────────────┘
                          │
                   ┌──────▼───────┐
                   │   Frontend    │
                   │  React+Vite   │
                   │   WebSocket   │
                   └──────────────┘
```

## Quick Start

### Prerequisites

- Node.js 22+
- Foundry (forge, anvil)
- LLM API key: [Groq](https://console.groq.com) (free) — agents fall back to deterministic logic without it

### Local Demo (No testnet needed)

```powershell
# 1. Start Anvil (local devnet)
anvil --host 127.0.0.1 --port 8545

# 2. Deploy contracts + seed vault with 50k USDt
forge script contracts/script/DeployLocal.s.sol:DeployLocal \
  --rpc-url http://127.0.0.1:8545 --broadcast

# 3. Copy .env.example → .env, fill in deployed addresses from step 2
cp backend/.env.example backend/.env

# 4. Start backend
cd backend && npx tsx src/index.ts

# 5. Test
curl http://localhost:3001/health
curl http://localhost:3001/api/dashboard
```

### Full Setup (Mantle Network)

#### 1. Install

```bash
git clone https://github.com/loquit-tud/mantle-treasury-ai
cd mantle-treasury-ai

npm run install:all
cd contracts && forge install OpenZeppelin/openzeppelin-contracts foundry-rs/forge-std --no-commit
```

#### 2. Environment

```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env`:
```bash
# LLM (Groq is free at console.groq.com)
OPENAI_API_KEY=gsk_...
LLM_MODEL=llama-3.3-70b-versatile
LLM_BASE_URL=https://api.groq.com/openai/v1

# Agent Wallet (12-word seed phrase — server holds custody)
AGENT_SEED_PHRASE=your twelve word seed phrase here

# Mantle Network
RPC_URL=https://rpc.mantle.xyz
CHAIN_ID=5000
USDT_ADDRESS=0x201EBa5CC46D216Ce6DC03F6a759e8E766e956aE
AAVE_POOL_ADDRESS=<aurelius-pool-address>

# Deployed contracts
TREASURY_VAULT_ADDRESS=<deployed>
CREDIT_LINE_ADDRESS=<deployed>
```

#### 3. Deploy Contracts

```bash
npm run contracts:test     # Run Forge tests first (31 tests)
npm run contracts:deploy   # Deploy to Mantle
```

#### 4. Run

```bash
# Terminal 1 — Backend (port 3001)
npm run dev:backend

# Terminal 2 — Frontend (port 3000)
npm run dev:frontend
```

Visit `http://localhost:3000` for the dashboard.

### MCP Server & OpenClaw Integration

```bash
cd backend && npm run build
npm run mcp
```

OpenClaw config (`openclaw.config.json`):
```json
{
  "agent": { "model": "groq/llama-3.3-70b-versatile" },
  "mcpServers": {
    "quorum": {
      "command": "node",
      "args": ["backend/dist/mcp-server.js"],
      "env": { "BACKEND_URL": "http://localhost:3001" }
    }
  }
}
```

## Smart Contracts

**TreasuryVault.sol** — Multi-sig vault with yield
- ReentrancyGuard + AccessControl + Pausable
- 1h timelock on all withdrawals
- 2-of-N multi-sig for amounts >= 1000 USDt
- Daily volume cap: 10,000 USDt
- Protocol allowlist for yield investments

**CreditLine.sol** — On-chain credit scoring
- Score formula: `500 + min(txCount*2, 200) + min(volume/100, 150) + repaidLoans*100 + min(age/10, 50) - defaults*200`
- 3 tiers: Excellent (800+, 5k, 5%), Good (600+, 2k, 10%), Poor (<600, 500, 15%)
- 30-day loan terms, automatic default detection
- Penalty interest tiers: +5% (1-7d overdue), +10% (8-14d), +15% (15+d)
- Credit freeze on default

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check + agent status |
| `/api/dashboard` | GET | Full dashboard data |
| `/api/treasury` | GET | Treasury state |
| `/api/treasury/sync` | POST | Force on-chain sync |
| `/api/treasury/withdrawal/propose` | POST | Propose USDt withdrawal |
| `/api/credit/:address` | GET | Credit profile |
| `/api/credit/:address/evaluate` | POST | Evaluate/update credit score |
| `/api/credit/:address/borrow` | POST | Borrow USDt |
| `/api/credit/:address/repay` | POST | Repay a loan |
| `/api/credit/:address/loans` | GET | User loans |
| `/api/loans` | GET | All active loans |
| `/api/decisions` | GET | Agent decision log |
| `/api/yield/opportunities` | GET | Current yield opportunities |
| `/api/yield/invest` | POST | Invest in yield protocol |
| `/api/credit/:address/default-prediction` | GET | ML default probability |
| `/api/credit/:address/zk-proof` | POST | Generate ZK credit proof |
| `/api/credit/verify-proof` | POST | Verify a ZK credit proof |
| `/api/inter-agent/lending` | GET | Inter-agent lending status |
| `/api/inter-agent/request-capital` | POST | Credit Agent requests capital |
| `/api/inter-agent/harvest` | POST | Yield harvest → auto debt service |
| `/api/revenue/summary` | GET | Revenue tracking summary |
| `/api/restructuring/proposals` | GET | Debt restructuring proposals |
| `/ws` | WS | Real-time events (decisions, dialogues, alerts) |

## Security

- Agent wallet uses a server-side seed phrase (`AGENT_SEED_PHRASE`) — keep `.env` out of version control
- All vault writes go through timelock + multi-sig
- ReentrancyGuard on every `external` function
- Daily volume + single-tx caps
- Emergency pause via GUARDIAN_ROLE
- OpenClaw SOUL.md constrains agent behavior (safety-first, conservative risk, on-chain verification)

## LLM Failover

```
Primary (Groq/LLaMA 3.3 70B) ──[429/5xx]──► Fallback (configurable)
         ▲                                            │
         └─── 60s cooldown ──────────────────────────┘
```

Configure via: `OPENAI_API_KEY` (primary), `LLM_FALLBACK_API_KEY` + `LLM_FALLBACK_MODEL` (fallback).

## Design Decisions

**Why three agents?** Separation of concerns: Treasury optimizes yield without credit risk pressure, Credit focuses on scoring without yield pressure, Risk monitors both. Board Meetings create productive tension and produce better allocation than single-agent designs.

**Why on-chain credit scoring?** The formula uses only publicly verifiable on-chain data — no off-chain oracles or trusted third parties.

**Why EventBus?** Agents communicate via pub/sub rather than direct calls. This decouples them, exposes all activity to WebSocket clients, and makes adding new subscribers trivial.

## License

MIT