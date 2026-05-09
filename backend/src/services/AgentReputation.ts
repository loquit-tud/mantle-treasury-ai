/**
 * Agent Reputation System — tracks how well each agent's positions
 * align with final Board Meeting consensus over time.
 * Inspired by Galactica's stake-weighted consensus with slashing.
 */

interface AgentReputationData {
  agentType: 'treasury' | 'credit' | 'risk';
  score: number;       // 0-100 (starts at 70)
  wins: number;        // consensus aligned with agent's position
  losses: number;      // consensus contradicted agent's position
  streak: number;      // positive = win streak, negative = loss streak
  lastUpdated: number;
  history: { round: number; topic: string; aligned: boolean; delta: number; timestamp: number }[];
}

export interface ReputationSummary {
  agents: AgentReputationData[];
  totalRounds: number;
  leaderboard: { agent: string; score: number; winRate: number }[];
}

const WIN_REWARD = 3;   // +3 per aligned consensus
const LOSS_PENALTY = 5;  // -5 per misaligned consensus
const STREAK_BONUS = 1;  // extra +1 per consecutive win

export class AgentReputation {
  private data: Map<string, AgentReputationData>;
  private totalRounds = 0;

  constructor() {
    this.data = new Map();
    for (const agent of ['treasury', 'credit', 'risk'] as const) {
      this.data.set(agent, {
        agentType: agent,
        score: 70,
        wins: 0,
        losses: 0,
        streak: 0,
        lastUpdated: Date.now(),
        history: [],
      });
    }
  }

  /**
   * After each Board Meeting consensus, call this with each agent's alignment.
   * alignment is determined by keyword matching between agent's last statement and consensus.
   */
  recordRound(roundNumber: number, topic: string, alignments: Record<string, boolean>): void {
    this.totalRounds = roundNumber;
    for (const [agent, aligned] of Object.entries(alignments)) {
      const d = this.data.get(agent);
      if (!d) continue;

      let delta: number;
      if (aligned) {
        d.wins++;
        d.streak = d.streak > 0 ? d.streak + 1 : 1;
        delta = WIN_REWARD + (d.streak > 2 ? STREAK_BONUS : 0);
      } else {
        d.losses++;
        d.streak = d.streak < 0 ? d.streak - 1 : -1;
        delta = -LOSS_PENALTY;
      }

      d.score = Math.max(0, Math.min(100, d.score + delta));
      d.lastUpdated = Date.now();
      d.history.push({ round: roundNumber, topic, aligned, delta, timestamp: Date.now() });
      if (d.history.length > 50) d.history = d.history.slice(-50);
    }
  }

  /**
   * Simple heuristic to check if an agent's dialogue turn aligns with consensus.
   * Looks for agreement keywords vs disagreement keywords.
   */
  static checkAlignment(agentMessage: string, consensus: string): boolean {
    const msg = agentMessage.toLowerCase();
    const con = consensus.toLowerCase();

    const actionWords = con.match(/\b(increase|decrease|maintain|reduce|tighten|loosen|deploy|hold|invest|withdraw|conservative|aggressive|moderate)\b/g) || [];

    if (actionWords.length === 0) return true; // can't determine, assume aligned

    let matches = 0;
    for (const word of actionWords) {
      if (msg.includes(word)) matches++;
    }

    return matches / actionWords.length >= 0.3;
  }

  getSummary(): ReputationSummary {
    const agents = Array.from(this.data.values());
    const leaderboard = agents
      .map(a => ({
        agent: a.agentType,
        score: a.score,
        winRate: a.wins + a.losses > 0 ? Math.round((a.wins / (a.wins + a.losses)) * 100) : 50,
      }))
      .sort((a, b) => b.score - a.score);

    return { agents, totalRounds: this.totalRounds, leaderboard };
  }

  getAgentScore(agent: string): number {
    return this.data.get(agent)?.score ?? 0;
  }
}
