/**
 * StatePersistence — JSON file-based state persistence for restart recovery.
 *
 * Saves agent state to backend/data/ directory:
 *   - treasury-state.json  (yield positions, history snapshots, decisions)
 *   - credit-state.json    (profiles, loans, decisions)
 *   - events.json          (EventBus decision log)
 *   - inter-agent-loans.json (inter-agent lending history)
 *   - dialogues.json       (board meeting transcripts)
 *
 * Each save is atomic: write to .tmp then rename.
 */

import * as fs from 'fs';
import * as path from 'path';
import logger from '../utils/logger';
import type { CreditProfile, Loan } from '../types';
import {
  syncAllProfiles, syncAllLoans, syncYieldPositions, insertSnapshot,
} from './StateDB';

const DATA_DIR = path.resolve(__dirname, '../../data');

/** Ensure data directory exists */
function ensureDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/** Atomic write: write to .tmp then rename */
function atomicWrite(filename: string, data: unknown): void {
  ensureDir();
  const filePath = path.join(DATA_DIR, filename);
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

/** Read JSON file, return null if not found */
function readJSON<T>(filename: string): T | null {
  const filePath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch (err) {
    logger.warn(`Failed to read ${filename}, starting fresh`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ─── Treasury State ────────────────────────────────────────────

export interface PersistedTreasuryState {
  yieldPositions: Array<{
    protocol: string;
    amount: string;
    apy: number;
    investedAt: number;
    harvested: string;
  }>;
  historySnapshots: Array<{
    timestamp: number;
    balance: number;
    volume: number;
    yieldTotal: number;
  }>;
  decisionMemory: Array<{
    role: string;
    action: string;
    reasoning: string;
    timestamp: number;
  }>;
  savedAt: number;
}

export function saveTreasuryState(state: Omit<PersistedTreasuryState, 'savedAt'>): void {
  atomicWrite('treasury-state.json', { ...state, savedAt: Date.now() });
  // Sync to SQLite
  try {
    syncYieldPositions(state.yieldPositions);
    for (const snap of state.historySnapshots.slice(-5)) {
      insertSnapshot(snap.timestamp, snap.balance, snap.volume, snap.yieldTotal);
    }
  } catch (err) {
    logger.warn('SQLite sync failed for treasury state', { error: err instanceof Error ? err.message : String(err) });
  }
}

export function loadTreasuryState(): PersistedTreasuryState | null {
  return readJSON<PersistedTreasuryState>('treasury-state.json');
}

// ─── Credit State ──────────────────────────────────────────────

export interface PersistedCreditState {
  profiles: Array<[string, unknown]>;
  loans: Array<[number, unknown]>;
  decisionMemory: Array<{
    role: string;
    action: string;
    reasoning: string;
    timestamp: number;
  }>;
  savedAt: number;
}

export function saveCreditState(state: Omit<PersistedCreditState, 'savedAt'>): void {
  atomicWrite('credit-state.json', { ...state, savedAt: Date.now() });
  // Sync to SQLite
  try {
    const profileMap = new Map<string, CreditProfile>();
    for (const [key, val] of state.profiles) {
      profileMap.set(key, val as CreditProfile);
    }
    syncAllProfiles(profileMap);

    const loanMap = new Map<number, Loan>();
    for (const [id, val] of state.loans) {
      loanMap.set(id, val as Loan);
    }
    syncAllLoans(loanMap);
  } catch (err) {
    logger.warn('SQLite sync failed for credit state', { error: err instanceof Error ? err.message : String(err) });
  }
}

export function loadCreditState(): PersistedCreditState | null {
  return readJSON<PersistedCreditState>('credit-state.json');
}

// ─── Events ────────────────────────────────────────────────────

export function saveEvents(events: unknown[]): void {
  atomicWrite('events.json', { events, savedAt: Date.now() });
}

export function loadEvents(): { events: unknown[]; savedAt: number } | null {
  return readJSON<{ events: unknown[]; savedAt: number }>('events.json');
}

// ─── Inter-Agent Loans ─────────────────────────────────────────

export function saveInterAgentLoans(loans: unknown[]): void {
  atomicWrite('inter-agent-loans.json', { loans, savedAt: Date.now() });
}

export function loadInterAgentLoans(): { loans: unknown[]; savedAt: number } | null {
  return readJSON<{ loans: unknown[]; savedAt: number }>('inter-agent-loans.json');
}

// ─── Dialogues ─────────────────────────────────────────────────

export function saveDialogues(dialogues: unknown[], roundCount: number): void {
  atomicWrite('dialogues.json', { dialogues, roundCount, savedAt: Date.now() });
}

export function loadDialogues(): { dialogues: unknown[]; roundCount: number; savedAt: number } | null {
  return readJSON<{ dialogues: unknown[]; roundCount: number; savedAt: number }>('dialogues.json');
}

// ─── Revenue Tracker ───────────────────────────────────────────

export function saveRevenueData(events: unknown[]): void {
  atomicWrite('revenue-events.json', { events, savedAt: Date.now() });
}

export function loadRevenueData(): { events: unknown[]; savedAt: number } | null {
  return readJSON<{ events: unknown[]; savedAt: number }>('revenue-events.json');
}

// ─── Debt Restructuring ───────────────────────────────────────

export function saveRestructuringData(proposals: unknown[]): void {
  atomicWrite('restructuring-proposals.json', { proposals, savedAt: Date.now() });
}

export function loadRestructuringData(): { proposals: unknown[]; savedAt: number } | null {
  return readJSON<{ proposals: unknown[]; savedAt: number }>('restructuring-proposals.json');
}

logger.info(`StatePersistence: data directory → ${DATA_DIR}`);

// Re-export SQLite functions for direct access
export {
  getDB, closeDB,
  loadAllProfiles as loadProfilesFromDB,
  loadAllLoans as loadLoansFromDB,
  loadYieldPositions as loadYieldFromDB,
  loadSnapshots as loadSnapshotsFromDB,
} from './StateDB';
