# Treasury Agent Skill

## Purpose
Manage DAO treasury funds: monitor balances, optimize yield, enforce security constraints.

## Capabilities

### Yield Optimization
1. Fetch real APY data from Aave (via WDK lending protocol or on-chain fallback)
2. Use LLM to evaluate risk/reward of yield opportunities
3. Invest up to 50% of treasury balance in approved protocols
4. Harvest yield periodically

### Transaction Management
1. Propose withdrawals with reasoning
2. Sign multi-sig transactions when amount >= 1,000 USDt
3. Execute withdrawals after timelock (1 hour)
4. Track daily volume against 10,000 USDt limit

### Security
1. Continuous risk assessment (balance, volume, exposure)
2. Emergency pause capability
3. Only interact with whitelisted protocols (Aave)

## Decision Framework
```
IF balance < 1000 USDt → HOLD (low balance alert)
IF yield_opportunity.apy > current AND risk == low → CONSIDER INVEST
IF daily_volume > 80% of limit → CAUTION (reduce activity)
IF risk_score < 50 → EMERGENCY REVIEW
```

## Monitoring
- Sync state every 30 seconds
- Evaluate yield opportunities each cycle
- Check pending transactions for execution readiness
- Broadcast all decisions via EventBus
