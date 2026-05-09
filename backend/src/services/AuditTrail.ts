import { getDB } from './StateDB';

export type AuditStage = 'intent' | 'guard' | 'execution';

export type AuditEventRow = {
  id: number;
  correlationId: string;
  stage: AuditStage;
  action: string;
  actor: 'api' | 'agent';
  timestamp: number;
  ok: boolean | null;
  reason: string | null;
  amountRaw: string | null;
  toAddress: string | null;
  txHash: string | null;
  data: Record<string, unknown> | null;
};

export type AuditChain = {
  correlationId: string;
  action: string;
  latestTimestamp: number;
  events: AuditEventRow[];
};

function parseJsonOrNull(input: string | null): Record<string, unknown> | null {
  if (!input) return null;
  try {
    return JSON.parse(input) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function insertAuditEvent(args: {
  correlationId: string;
  stage: AuditStage;
  action: string;
  actor: 'api' | 'agent';
  timestamp?: number;
  ok?: boolean;
  reason?: string;
  amountRaw?: string;
  toAddress?: string;
  txHash?: string;
  data?: Record<string, unknown>;
}): void {
  const db = getDB();
  const ts = args.timestamp ?? Date.now();
  db.prepare(`
    INSERT INTO audit_events
      (correlation_id, stage, action, actor, timestamp, ok, reason, amount_raw, to_address, tx_hash, data_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    args.correlationId,
    args.stage,
    args.action,
    args.actor,
    ts,
    args.ok == null ? null : (args.ok ? 1 : 0),
    args.reason ?? null,
    args.amountRaw ?? null,
    args.toAddress ?? null,
    args.txHash ?? null,
    args.data ? JSON.stringify(args.data) : null,
  );
}

export function listRecentAuditChains(limitChains: number = 25): AuditChain[] {
  const db = getDB();
  const rows = db.prepare(`
    SELECT
      correlation_id as correlationId,
      MAX(timestamp) as latestTimestamp,
      MIN(action) as action
    FROM audit_events
    GROUP BY correlation_id
    ORDER BY latestTimestamp DESC
    LIMIT ?
  `).all(limitChains) as Array<{ correlationId: string; latestTimestamp: number; action: string }>;

  const eventStmt = db.prepare(`
    SELECT
      id,
      correlation_id as correlationId,
      stage,
      action,
      actor,
      timestamp,
      ok,
      reason,
      amount_raw as amountRaw,
      to_address as toAddress,
      tx_hash as txHash,
      data_json as dataJson
    FROM audit_events
    WHERE correlation_id = ?
    ORDER BY timestamp ASC, id ASC
  `);

  return rows.map((r) => {
    const events = eventStmt.all(r.correlationId) as Array<{
      id: number;
      correlationId: string;
      stage: AuditStage;
      action: string;
      actor: 'api' | 'agent';
      timestamp: number;
      ok: number | null;
      reason: string | null;
      amountRaw: string | null;
      toAddress: string | null;
      txHash: string | null;
      dataJson: string | null;
    }>;

    const normalized: AuditEventRow[] = events.map((e) => ({
      id: e.id,
      correlationId: e.correlationId,
      stage: e.stage,
      action: e.action,
      actor: e.actor,
      timestamp: e.timestamp,
      ok: e.ok == null ? null : e.ok === 1,
      reason: e.reason,
      amountRaw: e.amountRaw,
      toAddress: e.toAddress,
      txHash: e.txHash,
      data: parseJsonOrNull(e.dataJson),
    }));

    return {
      correlationId: r.correlationId,
      action: r.action,
      latestTimestamp: r.latestTimestamp,
      events: normalized,
    };
  });
}

export function sumExecutedAmountSince(timestampMs: number): bigint {
  const db = getDB();
  const row = db.prepare(`
    SELECT COALESCE(SUM(CAST(amount_raw AS INTEGER)), 0) AS total
    FROM audit_events
    WHERE stage = 'execution'
      AND ok = 1
      AND amount_raw IS NOT NULL
      AND timestamp >= ?
  `).get(timestampMs) as { total: number | string };

  const total = typeof row.total === 'number' ? row.total.toString() : row.total;
  try {
    return BigInt(total);
  } catch {
    return 0n;
  }
}

