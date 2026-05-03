/**
 * RevenueTracker — Tracks agent revenue streams and enables revenue-backed lending.
 *
 * Innovation: AI agents can borrow against their projected future earnings,
 * similar to invoice factoring in TradFi ($3.5T market) but for the AI agent economy.
 *
 * Revenue sources tracked:
 *   - Task completions (scraping, analysis, trading signals)
 *   - Protocol fees earned
 *   - Yield harvests
 *   - Inter-agent service payments
 *
 * The tracker computes:
 *   - 24h / 7d / 30d rolling revenue
 *   - Revenue velocity (trend: accelerating or decelerating)
 *   - Projected future revenue (linear + decay model)
 *   - Borrowing capacity (% of projected revenue)
 */

import EventBus from '../orchestrator/EventBus';
import logger from '../utils/logger';
import { saveRevenueData, loadRevenueData } from './StatePersistence';

export interface RevenueEvent {
  id: string;
  agentAddress: string;
  amount: string;           // USDt raw units (6 dec)
  source: RevenueSource;
  description: string;
  timestamp: number;
  txHash?: string;
}

export type RevenueSource =
  | 'task_completion'
  | 'protocol_fee'
  | 'yield_harvest'
  | 'inter_agent_payment'
  | 'service_fee'
  | 'trading_profit';

export interface RevenueProfile {
  agentAddress: string;
  revenue24h: string;       // USDt raw
  revenue7d: string;
  revenue30d: string;
  revenueVelocity: number;  // -1 to +1 trend indicator
  projectedRevenue30d: string;
  borrowCapacity: string;   // max borrowable against projected revenue
  eventCount: number;
  lastEventAt: number;
  consistency: number;      // 0-1 how regular the revenue stream is
}

/** Max borrowing = 50% of 30d projected revenue */
const BORROW_CAPACITY_PCT = 50n;
/** Revenue events older than 90 days are archived */
const MAX_HISTORY_DAYS = 90;

export class RevenueTracker {
  private events: RevenueEvent[] = [];

  constructor() {
    // Restore persisted data
    const persisted = loadRevenueData();
    if (persisted && Array.isArray(persisted.events)) {
      this.events = persisted.events as RevenueEvent[];
      logger.info('Restored RevenueTracker from disk', { events: this.events.length });
    }

    this.setupListeners();
    logger.info('RevenueTracker initialized — revenue-backed lending enabled');
  }

  /** Wire EventBus listeners for automatic revenue tracking */
  private setupListeners(): void {
    // Yield harvests → revenue event (only on-chain confirmed, with txHash)
    EventBus.subscribe('treasury:yield_harvested', (event) => {
      const payload = event.payload as { amount?: string; protocol?: string; txHash?: string; expectedAmount?: string };
      // Only record if there's a real on-chain txHash — skip off-chain fallbacks
      if (!payload.txHash) return;
      const amount = payload.expectedAmount ?? payload.amount;
      if (!amount) return;
      this.recordRevenue({
        agentAddress: 'treasury',
        amount,
        source: 'yield_harvest',
        description: `Yield harvested from ${payload.protocol || 'DeFi protocol'}`,
        txHash: payload.txHash,
      });
    });

    // Loan interest earned → credit agent revenue
    EventBus.subscribe('credit:loan_repaid', (event) => {
      const data = event.payload as { data?: { amount?: string }; reasoning?: string };
      const amount = data.data?.amount;
      if (amount && BigInt(amount) > 0n) {
        this.recordRevenue({
          agentAddress: 'credit',
          amount,
          source: 'service_fee',
          description: 'Loan repayment interest earned',
        });
      }
    });
  }

  /** Record a revenue event */
  recordRevenue(params: Omit<RevenueEvent, 'id' | 'timestamp'>): void {
    const event: RevenueEvent = {
      id: `rev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      ...params,
    };

    this.events.push(event);
    this.cleanup();
    saveRevenueData(this.events);

    EventBus.emitEvent('revenue:recorded', 'treasury', {
      agentAddress: event.agentAddress,
      amount: event.amount,
      source: event.source,
      description: event.description,
      projectedCapacity: this.getProfile(event.agentAddress).borrowCapacity,
    });

    logger.info('Revenue event recorded', {
      agent: event.agentAddress,
      amount: event.amount,
      source: event.source,
    });
  }

  /** Simulate revenue for demo/testing — generates realistic agent revenue stream */
  simulateRevenue(agentAddress: string): void {
    const sources: Array<{ source: RevenueSource; desc: string; minUsd: number; maxUsd: number }> = [
      { source: 'task_completion', desc: 'Data scraping task completed', minUsd: 0.5, maxUsd: 5 },
      { source: 'service_fee', desc: 'API risk analysis service', minUsd: 0.1, maxUsd: 2 },
      { source: 'trading_profit', desc: 'Arbitrage profit captured', minUsd: 1, maxUsd: 10 },
      { source: 'protocol_fee', desc: 'Protocol usage fee earned', minUsd: 0.2, maxUsd: 3 },
    ];

    const pick = sources[Math.floor(Math.random() * sources.length)];
    const usd = pick.minUsd + Math.random() * (pick.maxUsd - pick.minUsd);
    const rawAmount = BigInt(Math.floor(usd * 1e6)).toString();

    this.recordRevenue({
      agentAddress,
      amount: rawAmount,
      source: pick.source,
      description: pick.desc,
    });
  }

  /** Get revenue profile for an agent */
  getProfile(agentAddress: string): RevenueProfile {
    const now = Date.now();
    const agentEvents = this.events.filter(e => e.agentAddress === agentAddress);

    const sum = (ms: number) => agentEvents
      .filter(e => now - e.timestamp < ms && e.amount != null)
      .reduce((s, e) => s + BigInt(e.amount), 0n);

    const revenue24h = sum(24 * 3600_000);
    const revenue7d = sum(7 * 24 * 3600_000);
    const revenue30d = sum(30 * 24 * 3600_000);

    // Revenue velocity: compare last 7d vs previous 7d
    const recent7d = agentEvents.filter(e => now - e.timestamp < 7 * 24 * 3600_000);
    const prev7d = agentEvents.filter(e =>
      now - e.timestamp >= 7 * 24 * 3600_000 &&
      now - e.timestamp < 14 * 24 * 3600_000
    );
    const recentSum = recent7d.filter(e => e.amount != null).reduce((s, e) => s + Number(BigInt(e.amount)), 0);
    const prevSum = prev7d.filter(e => e.amount != null).reduce((s, e) => s + Number(BigInt(e.amount)), 0);
    const velocity = prevSum === 0
      ? (recentSum > 0 ? 1 : 0)
      : Math.max(-1, Math.min(1, (recentSum - prevSum) / Math.max(prevSum, 1)));

    // Projected 30d revenue: extrapolate from 7d with velocity adjustment
    const weeklyRate = Number(revenue7d);
    const velocityMultiplier = 1 + velocity * 0.3; // ±30% adjustment
    const projected30d = BigInt(Math.floor(weeklyRate * 4.3 * velocityMultiplier));

    // Borrow capacity = 50% of projected 30d revenue
    const borrowCapacity = (projected30d * BORROW_CAPACITY_PCT) / 100n;

    // Consistency: how regular are the events? (std dev of inter-event gaps)
    let consistency = 0;
    if (agentEvents.length >= 3) {
      const timestamps = agentEvents.map(e => e.timestamp).sort();
      const gaps = timestamps.slice(1).map((t, i) => t - timestamps[i]);
      const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
      const variance = gaps.reduce((s, g) => s + (g - avgGap) ** 2, 0) / gaps.length;
      const cv = Math.sqrt(variance) / Math.max(avgGap, 1); // coefficient of variation
      consistency = Math.max(0, Math.min(1, 1 - cv)); // lower cv = higher consistency
    }

    return {
      agentAddress,
      revenue24h: revenue24h.toString(),
      revenue7d: revenue7d.toString(),
      revenue30d: revenue30d.toString(),
      revenueVelocity: Math.round(velocity * 100) / 100,
      projectedRevenue30d: projected30d.toString(),
      borrowCapacity: borrowCapacity.toString(),
      eventCount: agentEvents.length,
      lastEventAt: agentEvents.length > 0 ? agentEvents[agentEvents.length - 1].timestamp : 0,
      consistency,
    };
  }

  /** Check if an agent can borrow a given amount against revenue */
  canBorrowAgainstRevenue(agentAddress: string, amount: bigint): {
    allowed: boolean;
    capacity: string;
    utilization: number;
    reason: string;
  } {
    const profile = this.getProfile(agentAddress);
    const capacity = BigInt(profile.borrowCapacity);

    if (capacity === 0n) {
      return { allowed: false, capacity: '0', utilization: 0, reason: 'No revenue history — cannot back a loan' };
    }

    if (profile.eventCount < 3) {
      return { allowed: false, capacity: capacity.toString(), utilization: 0, reason: 'Insufficient revenue history (min 3 events)' };
    }

    if (profile.consistency < 0.1) {
      return { allowed: false, capacity: capacity.toString(), utilization: 0, reason: 'Revenue stream too irregular for backing' };
    }

    const utilization = Number((amount * 100n) / capacity) / 100;

    if (amount > capacity) {
      return {
        allowed: false,
        capacity: capacity.toString(),
        utilization,
        reason: `Requested ${amount} exceeds revenue-backed capacity ${capacity} (50% of projected 30d revenue)`,
      };
    }

    return {
      allowed: true,
      capacity: capacity.toString(),
      utilization,
      reason: `Approved: ${utilization * 100}% of revenue-backed capacity utilized`,
    };
  }

  /** Get all events for an agent */
  getEvents(agentAddress?: string, limit = 50): RevenueEvent[] {
    let events = this.events;
    if (agentAddress) {
      events = events.filter(e => e.agentAddress === agentAddress);
    }
    return events.slice(-limit);
  }

  /** Get summary for dashboard */
  getSummary(): {
    totalRevenue: string;
    agents: RevenueProfile[];
    recentEvents: RevenueEvent[];
  } {
    const agents = new Set(this.events.map(e => e.agentAddress));
    const profiles = Array.from(agents).map(a => this.getProfile(a));
    const totalRevenue = this.events.filter(e => e.amount != null).reduce((s, e) => s + BigInt(e.amount), 0n);

    return {
      totalRevenue: totalRevenue.toString(),
      agents: profiles,
      recentEvents: this.events.slice(-10),
    };
  }

  /** Remove events older than 90 days */
  private cleanup(): void {
    const cutoff = Date.now() - MAX_HISTORY_DAYS * 24 * 3600_000;
    const before = this.events.length;
    this.events = this.events.filter(e => e.timestamp > cutoff);
    if (this.events.length < before) {
      logger.info(`RevenueTracker cleanup: removed ${before - this.events.length} old events`);
    }
  }
}
