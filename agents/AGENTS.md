# AGENTS — AgentTreasury Agent Roster

## Active Agents

### Treasury Agent
- **Role**: Manages DAO treasury funds — deposits, withdrawals, yield optimization
- **Wallet**: Agent-managed EVM wallet
- **Contracts**: TreasuryVault.sol
- **Skill file**: `treasury/SKILL.md`

### Credit Agent
- **Role**: On-chain credit scoring and micro-lending
- **Data source**: Real on-chain transaction history
- **Contracts**: CreditLine.sol
- **Skill file**: `credit/SKILL.md`

### Risk Agent
- **Role**: Compliance & systemic risk oversight (advisory)
- **Mode**: Advisory only — does not execute transactions
- **Function**: Participates in Board Meetings as the third voice, focused on systemic risk, regulatory compliance, and portfolio protection

## Communication Pattern
- Agents communicate via EventBus (pub/sub)
- Treasury Agent listens for `credit:loan_requested` → verifies funds → disburses
- Credit Agent listens for `credit:evaluate_requested` → scores → updates on-chain
- Risk Agent monitors all events, flags risk in Board Meetings
- All three emit decisions that feed the real-time dashboard

## Constraints
- All write operations go through the agent wallet `sendTransaction()`
- Maximum daily volume: 10,000 USDt
- Maximum single transaction: 1,000 USDt
- Emergency pause available to Guardian role
