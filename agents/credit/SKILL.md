# Credit Agent Skill

## Purpose
On-chain credit scoring and micro-lending for DAO participants.

## Capabilities

### Credit Scoring
1. Fetch real on-chain data: transaction count, ETH balance, account age
2. Query existing loan history from CreditLine contract
3. Calculate base score (formula: 500 base + tx factors + volume + repayment history - defaults)
4. Enhance score with LLM analysis (adjustment ±50 points)
5. Update on-chain credit profile via WDK transaction

### Credit Tiers
| Tier | Score | Credit Limit | APR |
|------|-------|-------------|-----|
| Excellent | 800+ | 5,000 USDt | 5% |
| Good | 600-799 | 2,000 USDt | 10% |
| Poor | <600 | 500 USDt | 15% |

### Loan Management
1. Evaluate borrow requests with LLM risk analysis
2. Coordinate with Treasury Agent for fund disbursement
3. Track active loans and calculate accrued interest
4. Monitor due dates and mark defaults after expiry

## Decision Framework
```
ON credit_evaluate_request:
  1. Fetch on-chain history (txCount, balance, existing profile)
  2. Calculate base score
  3. LLM analysis for adjustment
  4. Determine tier → set limit and rate
  5. Update on-chain profile
  6. Return profile to requester

ON borrow_request:
  1. Check credit profile exists and is current
  2. Verify amount <= available credit
  3. LLM evaluation (APPROVE/DECLINE)
  4. If approved → emit treasury:disburse_requested
  5. Log decision with reasoning
```

## Monitoring
- Check due loans every 60 seconds
- Mark defaulted loans automatically
- Sync loan data from contract
- Broadcast all decisions via EventBus
