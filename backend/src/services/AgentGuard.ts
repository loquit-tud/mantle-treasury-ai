import { sumExecutedAmountSince } from './AuditTrail';

export type GuardAction =
  | 'treasury.withdraw.propose'
  | 'treasury.yield.invest'
  | 'treasury.yield.withdraw'
  | 'credit.borrow'
  | 'bridge.execute'
  | 'emergency.pause'
  | 'emergency.unpause';

export type GuardDecision = {
  ok: boolean;
  reason: string;
  policy: {
    enabled: boolean;
    maxTxRaw: bigint;
    maxDailyRaw: bigint;
    allowTo: string[] | null;
    denyTo: string[] | null;
  };
  usage: {
    usedTodayRaw: bigint;
  };
};

function parseUsdToRaw(usdt: string, fallbackRaw: bigint): bigint {
  const n = Number(usdt);
  if (!Number.isFinite(n) || n < 0) return fallbackRaw;
  return BigInt(Math.floor(n * 1e6));
}

function splitCsvLower(input?: string): string[] {
  return (input ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => s.toLowerCase());
}

function startOfUtcDayMs(now: number): number {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

export async function evaluateGuard(args: {
  action: GuardAction;
  amountRaw?: bigint;
  toAddress?: string;
}): Promise<GuardDecision> {
  const enabled = (process.env.GUARD_ENABLED ?? '1') !== '0';

  const maxTxRaw = enabled
    ? parseUsdToRaw(process.env.GUARD_MAX_TX_USDT ?? '2500', 2_500_000_000n)
    : 0n;
  const maxDailyRaw = enabled
    ? parseUsdToRaw(process.env.GUARD_MAX_DAILY_USDT ?? '10000', 10_000_000_000n)
    : 0n;

  const allowTo = splitCsvLower(process.env.GUARD_ALLOWLIST_TO);
  const denyTo = splitCsvLower(process.env.GUARD_DENYLIST_TO);

  const toLower = args.toAddress?.toLowerCase();
  const amount = args.amountRaw ?? 0n;

  const usedTodayRaw = enabled ? sumExecutedAmountSince(startOfUtcDayMs(Date.now())) : 0n;

  const decision: GuardDecision = {
    ok: true,
    reason: 'ok',
    policy: {
      enabled,
      maxTxRaw,
      maxDailyRaw,
      allowTo: allowTo.length ? allowTo : null,
      denyTo: denyTo.length ? denyTo : null,
    },
    usage: {
      usedTodayRaw,
    },
  };

  if (!enabled) {
    decision.ok = true;
    decision.reason = 'guard_disabled';
    return decision;
  }

  if (toLower && denyTo.includes(toLower)) {
    decision.ok = false;
    decision.reason = 'recipient_denied';
    return decision;
  }

  if (toLower && allowTo.length > 0 && !allowTo.includes(toLower)) {
    decision.ok = false;
    decision.reason = 'recipient_not_allowlisted';
    return decision;
  }

  // Amount-based checks only apply to actions that move value
  const amountSensitiveActions: GuardAction[] = [
    'treasury.withdraw.propose',
    'treasury.yield.invest',
    'treasury.yield.withdraw',
    'credit.borrow',
    'bridge.execute',
  ];

  if (amountSensitiveActions.includes(args.action)) {
    if (amount <= 0n) {
      decision.ok = false;
      decision.reason = 'invalid_amount';
      return decision;
    }
    if (amount > maxTxRaw) {
      decision.ok = false;
      decision.reason = 'exceeds_max_tx';
      return decision;
    }
    if (usedTodayRaw + amount > maxDailyRaw) {
      decision.ok = false;
      decision.reason = 'exceeds_daily_limit';
      return decision;
    }
  }

  // Emergency actions are always allowed by guard (they are protective).
  return decision;
}

