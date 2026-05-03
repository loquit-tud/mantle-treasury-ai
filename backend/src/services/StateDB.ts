/**
 * StateDB — SQLite persistent storage for agent state.
 *
 * Replaces JSON-file persistence with a real database:
 *   - ACID transactions (no partial writes on crash)
 *   - Query capability (search loans by borrower, filter by status)
 *   - WAL mode for concurrent reads + single writer
 *   - Automatic schema migrations
 *
 * Tables:
 *   credit_profiles  — borrower credit profiles (score, limits, rates)
 *   loans            — active/closed loans with penalty tracking
 *   yield_positions  — DeFi yield positions (Aave, Compound)
 *   ai_decisions     — agent decision audit trail
 *   revenue_events   — revenue tracking for revenue-backed lending
 *   restructuring    — debt restructuring proposals
 *   zk_proofs        — used proof commitments (replay prevention)
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import logger from '../utils/logger';
import type { CreditProfile, Loan, YieldPosition } from '../types';

// ── Database path ─────────────────────────────────────────────────────────────

const DATA_DIR = path.resolve(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'agent-treasury.db');

// ── Singleton ─────────────────────────────────────────────────────────────────

let db: Database.Database | null = null;

export function getDB(): Database.Database {
  if (db) return db;

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');     // concurrent reads + crash safety
  db.pragma('synchronous = NORMAL');   // good balance of safety + speed
  db.pragma('foreign_keys = ON');

  runMigrations(db);

  logger.info('StateDB initialized (SQLite WAL)', { path: DB_PATH });
  return db;
}

export function closeDB(): void {
  if (db) {
    db.close();
    db = null;
    logger.info('StateDB closed');
  }
}

// ── Schema Migrations ─────────────────────────────────────────────────────────

function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS credit_profiles (
      address       TEXT PRIMARY KEY,
      score         INTEGER NOT NULL DEFAULT 0,
      credit_limit  TEXT NOT NULL DEFAULT '0',
      rate_bps      INTEGER NOT NULL DEFAULT 1500,
      borrowed      TEXT NOT NULL DEFAULT '0',
      available     TEXT NOT NULL DEFAULT '0',
      last_updated  INTEGER NOT NULL DEFAULT 0,
      exists_flag   INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS loans (
      id              INTEGER PRIMARY KEY,
      borrower        TEXT NOT NULL,
      principal       TEXT NOT NULL,
      interest_rate   INTEGER NOT NULL,
      borrowed_at     INTEGER NOT NULL,
      due_date        INTEGER NOT NULL,
      repaid          TEXT NOT NULL DEFAULT '0',
      interest        TEXT NOT NULL DEFAULT '0',
      total_due       TEXT NOT NULL DEFAULT '0',
      active          INTEGER NOT NULL DEFAULT 1,
      loan_type       TEXT DEFAULT 'standard',
      revenue_projection TEXT,
      restructured_from INTEGER,
      restructuring_id TEXT,
      penalty_rate_bps INTEGER DEFAULT 0,
      penalty_accrued  TEXT DEFAULT '0',
      credit_frozen    INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_loans_borrower ON loans(borrower);
    CREATE INDEX IF NOT EXISTS idx_loans_active ON loans(active);

    CREATE TABLE IF NOT EXISTS yield_positions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      protocol    TEXT NOT NULL,
      amount      TEXT NOT NULL,
      apy         REAL NOT NULL,
      invested_at INTEGER NOT NULL,
      harvested   TEXT NOT NULL DEFAULT '0'
    );

    CREATE TABLE IF NOT EXISTS ai_decisions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_type  TEXT NOT NULL,
      action      TEXT NOT NULL,
      reasoning   TEXT NOT NULL,
      timestamp   INTEGER NOT NULL,
      tx_hash     TEXT,
      data_json   TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_decisions_ts ON ai_decisions(timestamp);

    CREATE TABLE IF NOT EXISTS revenue_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      type        TEXT NOT NULL,
      agent_id    TEXT NOT NULL,
      amount      TEXT NOT NULL,
      timestamp   INTEGER NOT NULL,
      source      TEXT,
      metadata    TEXT
    );

    CREATE TABLE IF NOT EXISTS restructuring_proposals (
      id                TEXT PRIMARY KEY,
      original_loan_id  INTEGER NOT NULL,
      borrower          TEXT NOT NULL,
      status            TEXT NOT NULL DEFAULT 'proposed',
      proposed_at       INTEGER NOT NULL,
      original_terms    TEXT NOT NULL,
      proposed_terms    TEXT NOT NULL,
      llm_reasoning     TEXT,
      resolved_at       INTEGER
    );

    CREATE TABLE IF NOT EXISTS zk_proof_log (
      commitment  TEXT PRIMARY KEY,
      tier_name   TEXT NOT NULL,
      verified_at INTEGER NOT NULL,
      expires_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS history_snapshots (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp   INTEGER NOT NULL,
      balance     REAL NOT NULL,
      volume      REAL NOT NULL,
      yield_total REAL NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_snapshots_ts ON history_snapshots(timestamp);
  `);

  logger.info('StateDB migrations complete');
}

// ── Credit Profiles ───────────────────────────────────────────────────────────

export function upsertProfile(p: CreditProfile): void {
  const db = getDB();
  db.prepare(`
    INSERT INTO credit_profiles (address, score, credit_limit, rate_bps, borrowed, available, last_updated, exists_flag)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(address) DO UPDATE SET
      score = excluded.score,
      credit_limit = excluded.credit_limit,
      rate_bps = excluded.rate_bps,
      borrowed = excluded.borrowed,
      available = excluded.available,
      last_updated = excluded.last_updated,
      exists_flag = excluded.exists_flag
  `).run(p.address, p.score, p.limit, p.rate, p.borrowed, p.available, p.lastUpdated, p.exists ? 1 : 0);
}

export function loadAllProfiles(): Map<string, CreditProfile> {
  const db = getDB();
  const rows = db.prepare('SELECT * FROM credit_profiles').all() as Array<{
    address: string; score: number; credit_limit: string; rate_bps: number;
    borrowed: string; available: string; last_updated: number; exists_flag: number;
  }>;

  const map = new Map<string, CreditProfile>();
  for (const r of rows) {
    map.set(r.address, {
      address: r.address,
      score: r.score,
      limit: r.credit_limit,
      rate: r.rate_bps,
      borrowed: r.borrowed,
      available: r.available,
      lastUpdated: r.last_updated,
      exists: r.exists_flag === 1,
    });
  }
  return map;
}

// ── Loans ─────────────────────────────────────────────────────────────────────

export function upsertLoan(l: Loan): void {
  const db = getDB();
  db.prepare(`
    INSERT INTO loans (id, borrower, principal, interest_rate, borrowed_at, due_date, repaid, interest, total_due, active,
                       loan_type, revenue_projection, restructured_from, restructuring_id,
                       penalty_rate_bps, penalty_accrued, credit_frozen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?,  ?, ?, ?, ?,  ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      repaid = excluded.repaid,
      interest = excluded.interest,
      total_due = excluded.total_due,
      active = excluded.active,
      penalty_rate_bps = excluded.penalty_rate_bps,
      penalty_accrued = excluded.penalty_accrued,
      credit_frozen = excluded.credit_frozen
  `).run(
    l.id, l.borrower, l.principal, l.interestRate, l.borrowedAt, l.dueDate,
    l.repaid, l.interest, l.totalDue, l.active ? 1 : 0,
    l.loanType || 'standard', l.revenueProjection || null,
    l.restructuredFrom ?? null, l.restructuringId || null,
    l.penaltyRateBps ?? 0, l.penaltyAccrued || '0', l.creditFrozen ? 1 : 0,
  );
}

export function loadAllLoans(): Map<number, Loan> {
  const db = getDB();
  const rows = db.prepare('SELECT * FROM loans').all() as Array<Record<string, unknown>>;

  const map = new Map<number, Loan>();
  for (const r of rows) {
    map.set(r.id as number, {
      id: r.id as number,
      borrower: r.borrower as string,
      principal: r.principal as string,
      interestRate: r.interest_rate as number,
      borrowedAt: r.borrowed_at as number,
      dueDate: r.due_date as number,
      repaid: r.repaid as string,
      interest: r.interest as string,
      totalDue: r.total_due as string,
      active: (r.active as number) === 1,
      loanType: (r.loan_type as string) === 'revenue_backed' ? 'revenue_backed' : 'standard',
      revenueProjection: r.revenue_projection as string | undefined,
      restructuredFrom: r.restructured_from as number | undefined,
      restructuringId: r.restructuring_id as string | undefined,
      penaltyRateBps: r.penalty_rate_bps as number | undefined,
      penaltyAccrued: r.penalty_accrued as string | undefined,
      creditFrozen: (r.credit_frozen as number) === 1,
    });
  }
  return map;
}

// ── Yield Positions ───────────────────────────────────────────────────────────

export function upsertYieldPosition(protocol: string, amount: string, apy: number, investedAt: number, harvested: string): void {
  const db = getDB();
  const existing = db.prepare('SELECT id FROM yield_positions WHERE protocol = ?').get(protocol) as { id: number } | undefined;
  if (existing) {
    db.prepare('UPDATE yield_positions SET amount = ?, apy = ?, harvested = ? WHERE id = ?')
      .run(amount, apy, harvested, existing.id);
  } else {
    db.prepare('INSERT INTO yield_positions (protocol, amount, apy, invested_at, harvested) VALUES (?, ?, ?, ?, ?)')
      .run(protocol, amount, apy, investedAt, harvested);
  }
}

export function loadYieldPositions(): YieldPosition[] {
  const db = getDB();
  const rows = db.prepare('SELECT * FROM yield_positions').all() as Array<{
    protocol: string; amount: string; apy: number; invested_at: number; harvested: string;
  }>;
  return rows.map(r => ({
    protocol: r.protocol,
    amount: r.amount,
    apy: r.apy,
    investedAt: r.invested_at,
    harvested: r.harvested,
  }));
}

// ── AI Decisions ──────────────────────────────────────────────────────────────

export function insertDecision(agentType: string, action: string, reasoning: string, timestamp: number, txHash?: string, data?: Record<string, unknown>): void {
  const db = getDB();
  db.prepare('INSERT INTO ai_decisions (agent_type, action, reasoning, timestamp, tx_hash, data_json) VALUES (?, ?, ?, ?, ?, ?)')
    .run(agentType, action, reasoning, timestamp, txHash || null, data ? JSON.stringify(data) : null);
}

export function loadRecentDecisions(agentType: string, limit: number): Array<{ role: string; action: string; reasoning: string; timestamp: number }> {
  const db = getDB();
  const rows = db.prepare(
    'SELECT agent_type, action, reasoning, timestamp FROM ai_decisions WHERE agent_type = ? ORDER BY timestamp DESC LIMIT ?'
  ).all(agentType, limit) as Array<{ agent_type: string; action: string; reasoning: string; timestamp: number }>;
  return rows.map(r => ({ role: r.agent_type, action: r.action, reasoning: r.reasoning, timestamp: r.timestamp }));
}

// ── History Snapshots ─────────────────────────────────────────────────────────

export function insertSnapshot(timestamp: number, balance: number, volume: number, yieldTotal: number): void {
  const db = getDB();
  db.prepare('INSERT INTO history_snapshots (timestamp, balance, volume, yield_total) VALUES (?, ?, ?, ?)')
    .run(timestamp, balance, volume, yieldTotal);

  // Keep max 2016 entries (7 days at ~5min intervals)
  db.prepare('DELETE FROM history_snapshots WHERE id NOT IN (SELECT id FROM history_snapshots ORDER BY timestamp DESC LIMIT 2016)').run();
}

export function loadSnapshots(): Array<{ timestamp: number; balance: number; volume: number; yieldTotal: number }> {
  const db = getDB();
  return db.prepare('SELECT timestamp, balance, volume, yield_total as yieldTotal FROM history_snapshots ORDER BY timestamp ASC').all() as Array<{
    timestamp: number; balance: number; volume: number; yieldTotal: number;
  }>;
}

// ── Revenue Events ────────────────────────────────────────────────────────────

export function insertRevenueEvent(type: string, agentId: string, amount: string, timestamp: number, source?: string, metadata?: string): void {
  const db = getDB();
  db.prepare('INSERT INTO revenue_events (type, agent_id, amount, timestamp, source, metadata) VALUES (?, ?, ?, ?, ?, ?)')
    .run(type, agentId, amount, timestamp, source || null, metadata || null);
}

export function loadRevenueEvents(): Array<{ type: string; agentId: string; amount: string; timestamp: number; source?: string }> {
  const db = getDB();
  return db.prepare('SELECT type, agent_id as agentId, amount, timestamp, source FROM revenue_events ORDER BY timestamp ASC').all() as Array<{
    type: string; agentId: string; amount: string; timestamp: number; source?: string;
  }>;
}

// ── Restructuring Proposals ───────────────────────────────────────────────────

export function upsertRestructuring(p: {
  id: string; originalLoanId: number; borrower: string; status: string;
  proposedAt: number; originalTerms: Record<string, unknown>; proposedTerms: Record<string, unknown>;
  llmReasoning?: string; resolvedAt?: number;
}): void {
  const db = getDB();
  db.prepare(`
    INSERT INTO restructuring_proposals (id, original_loan_id, borrower, status, proposed_at, original_terms, proposed_terms, llm_reasoning, resolved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      proposed_terms = excluded.proposed_terms,
      llm_reasoning = excluded.llm_reasoning,
      resolved_at = excluded.resolved_at
  `).run(
    p.id, p.originalLoanId, p.borrower, p.status, p.proposedAt,
    JSON.stringify(p.originalTerms), JSON.stringify(p.proposedTerms),
    p.llmReasoning || null, p.resolvedAt ?? null,
  );
}

export function loadRestructuringProposals(): Array<{
  id: string; originalLoanId: number; borrower: string; status: string;
  proposedAt: number; originalTerms: string; proposedTerms: string; llmReasoning?: string;
}> {
  const db = getDB();
  return db.prepare('SELECT id, original_loan_id as originalLoanId, borrower, status, proposed_at as proposedAt, original_terms as originalTerms, proposed_terms as proposedTerms, llm_reasoning as llmReasoning FROM restructuring_proposals ORDER BY proposed_at DESC').all() as Array<{
    id: string; originalLoanId: number; borrower: string; status: string;
    proposedAt: number; originalTerms: string; proposedTerms: string; llmReasoning?: string;
  }>;
}

// ── ZK Proof Replay Prevention ────────────────────────────────────────────────

export function isProofUsed(commitment: string): boolean {
  const db = getDB();
  const row = db.prepare('SELECT 1 FROM zk_proof_log WHERE commitment = ?').get(commitment);
  return !!row;
}

export function markProofUsed(commitment: string, tierName: string, verifiedAt: number, expiresAt: number): void {
  const db = getDB();
  db.prepare('INSERT OR IGNORE INTO zk_proof_log (commitment, tier_name, verified_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(commitment, tierName, verifiedAt, expiresAt);
}

export function cleanExpiredProofs(): void {
  const db = getDB();
  db.prepare('DELETE FROM zk_proof_log WHERE expires_at < ?').run(Date.now());
}

// ── Bulk sync (used by agents to persist their full in-memory state) ──────────

export function syncAllProfiles(profiles: Map<string, CreditProfile>): void {
  const db = getDB();
  const tx = db.transaction(() => {
    for (const p of profiles.values()) {
      upsertProfile(p);
    }
  });
  tx();
}

export function syncAllLoans(loans: Map<number, Loan>): void {
  const db = getDB();
  const tx = db.transaction(() => {
    for (const l of loans.values()) {
      upsertLoan(l);
    }
  });
  tx();
}

export function syncYieldPositions(positions: YieldPosition[]): void {
  const db = getDB();
  const tx = db.transaction(() => {
    for (const p of positions) {
      upsertYieldPosition(p.protocol, p.amount, p.apy, p.investedAt, p.harvested);
    }
  });
  tx();
}
