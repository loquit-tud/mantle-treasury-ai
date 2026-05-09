import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Trophy, TrendingUp, TrendingDown, Zap, Users, MessageSquare, Coins } from 'lucide-react';
import { apiUrl } from '../utils/api';

interface AgentReputationData {
  agentType: string;
  score: number;
  wins: number;
  losses: number;
  streak: number;
  lastUpdated: number;
  history: { round: number; topic: string; aligned: boolean; delta: number; timestamp: number }[];
}

interface ReputationSummary {
  agents: AgentReputationData[];
  totalRounds: number;
  leaderboard: { agent: string; score: number; winRate: number }[];
}

const AGENT_COLORS: Record<string, { border: string; bg: string; text: string; glow: string }> = {
  treasury: { border: 'border-indigo-500/30', bg: 'bg-indigo-500/10', text: 'text-indigo-300', glow: 'shadow-indigo-500/10' },
  credit: { border: 'border-sky-500/30', bg: 'bg-sky-500/10', text: 'text-sky-300', glow: 'shadow-sky-500/10' },
  risk: { border: 'border-amber-500/30', bg: 'bg-amber-500/10', text: 'text-amber-300', glow: 'shadow-amber-500/10' },
};

export default function Agents() {
  const [reputation, setReputation] = useState<ReputationSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchReputation = async () => {
      try {
        const res = await fetch(apiUrl('/api/agents/reputation'));
        if (res.ok) {
          const d = await res.json();
          setReputation(d.data ?? null);
        }
      } catch { /* ignore */ }
      setLoading(false);
    };
    fetchReputation();
    const interval = setInterval(fetchReputation, 15000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <Link to="/dashboard" className="inline-flex items-center gap-1.5 text-xs text-slate-500 transition-colors hover:text-indigo-300">
            <ArrowLeft className="w-3.5 h-3.5" /> Dashboard
          </Link>
          <h2 className="text-2xl font-semibold tracking-tight text-gradient-brand">Agent Competition</h2>
        </div>
        <p className="text-sm text-slate-400">
          Stake-weighted consensus: agents earn reputation for aligned decisions, lose it for misaligned ones.
        </p>
      </div>

      {loading && !reputation ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin h-8 w-8 rounded-full border-2 border-indigo-400 border-t-transparent" />
        </div>
      ) : !reputation ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-8 text-center">
          <Users className="mx-auto h-10 w-10 text-slate-600 mb-3" />
          <p className="text-sm text-slate-400">No Board Meetings have been held yet. Reputation data will appear after the first consensus round.</p>
        </div>
      ) : (
        <>
          {/* Leaderboard */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <Trophy className="h-5 w-5 text-amber-400" />
              <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">
                Leaderboard · {reputation.totalRounds} rounds
              </span>
            </div>
            <div className="space-y-3">
              {reputation.leaderboard.map((entry, idx) => {
                const colors = AGENT_COLORS[entry.agent] || AGENT_COLORS.treasury;
                return (
                  <div
                    key={entry.agent}
                    className={`flex items-center gap-4 rounded-xl border ${colors.border} ${colors.bg} p-4 shadow-lg ${colors.glow}`}
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-950/60 text-lg font-bold text-white">
                      {idx === 0 ? '🥇' : idx === 1 ? '🥈' : '🥉'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-bold capitalize ${colors.text}`}>{entry.agent} Agent</span>
                        <span className="text-[10px] text-slate-500">{entry.winRate}% win rate</span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-800/80">
                        <div
                          className="h-full rounded-full transition-all duration-1000"
                          style={{
                            width: `${entry.score}%`,
                            backgroundColor: entry.score >= 70 ? '#818cf8' : entry.score >= 40 ? '#fbbf24' : '#f87171',
                          }}
                        />
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-2xl font-bold tabular-nums text-white">{entry.score}</span>
                      <span className="text-sm text-slate-500">/100</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Agent Detail Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {reputation.agents.map((agent) => {
              const colors = AGENT_COLORS[agent.agentType] || AGENT_COLORS.treasury;
              const winRate = agent.wins + agent.losses > 0
                ? Math.round((agent.wins / (agent.wins + agent.losses)) * 100) : 50;
              return (
                <div key={agent.agentType} className={`rounded-xl border ${colors.border} bg-slate-900/60 p-5`}>
                  <div className="flex items-center justify-between mb-3">
                    <span className={`text-sm font-bold capitalize ${colors.text}`}>{agent.agentType}</span>
                    {agent.streak > 0 ? (
                      <span className="flex items-center gap-1 text-[11px] text-emerald-300">
                        <TrendingUp className="h-3 w-3" /> {agent.streak} streak
                      </span>
                    ) : agent.streak < 0 ? (
                      <span className="flex items-center gap-1 text-[11px] text-red-300">
                        <TrendingDown className="h-3 w-3" /> {Math.abs(agent.streak)} streak
                      </span>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center mb-3">
                    <div>
                      <p className="text-[10px] text-slate-500">Score</p>
                      <p className="text-lg font-bold text-white">{agent.score}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500">W / L</p>
                      <p className="text-lg font-bold text-white">{agent.wins}<span className="text-slate-500">/</span>{agent.losses}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500">Win %</p>
                      <p className="text-lg font-bold text-white">{winRate}%</p>
                    </div>
                  </div>
                  {/* Recent history */}
                  <div className="flex gap-1 flex-wrap">
                    {agent.history.slice(-15).map((h, i) => (
                      <div
                        key={i}
                        title={`Round ${h.round}: ${h.topic} (${h.aligned ? '+' : ''}${h.delta})`}
                        className={`h-3 w-3 rounded-sm ${h.aligned ? 'bg-emerald-500/70' : 'bg-red-500/70'}`}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Inter-Agent Payments Log */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <Coins className="h-5 w-5 text-teal-400" />
              <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">
                Inter-agent service payments
              </span>
            </div>
            <p className="text-xs text-slate-400 mb-3">
              Agents pay each other 0.01 USDT0 per intelligence contribution during Board Meetings — creating a self-sustaining micro-economy.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {reputation.agents.map((agent) => {
                const totalPaid = (agent.wins + agent.losses) * 0.01;
                const colors = AGENT_COLORS[agent.agentType] || AGENT_COLORS.treasury;
                return (
                  <div key={agent.agentType} className="rounded-lg border border-slate-800/80 bg-slate-950/40 px-4 py-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Zap className={`h-3 w-3 ${colors.text}`} />
                      <span className={`text-xs font-semibold capitalize ${colors.text}`}>{agent.agentType}</span>
                    </div>
                    <p className="text-sm font-semibold text-white">{totalPaid.toFixed(2)} USDT0 earned</p>
                    <p className="text-[10px] text-slate-500">{agent.wins + agent.losses} contributions</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Consensus Round History */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-indigo-400" />
              <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">
                Recent consensus rounds
              </span>
            </div>
            {reputation.agents[0]?.history.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-4">No consensus rounds recorded yet.</p>
            ) : (
              <div className="space-y-2">
                {(() => {
                  const roundMap = new Map<number, { topic: string; timestamp: number; results: Record<string, boolean> }>();
                  for (const agent of reputation.agents) {
                    for (const h of agent.history) {
                      if (!roundMap.has(h.round)) {
                        roundMap.set(h.round, { topic: h.topic, timestamp: h.timestamp, results: {} });
                      }
                      roundMap.get(h.round)!.results[agent.agentType] = h.aligned;
                    }
                  }
                  return Array.from(roundMap.entries())
                    .sort(([a], [b]) => b - a)
                    .slice(0, 10)
                    .map(([round, data]) => (
                      <div key={round} className="flex items-center justify-between gap-3 rounded-lg border border-slate-800/70 bg-slate-950/20 px-4 py-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-slate-300">Round {round}</span>
                            <span className="rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400">
                              {data.topic.replace(/_/g, ' ')}
                            </span>
                          </div>
                          <div className="mt-1 flex gap-2">
                            {Object.entries(data.results).map(([agent, aligned]) => (
                              <span
                                key={agent}
                                className={`text-[10px] font-semibold capitalize ${aligned ? 'text-emerald-400' : 'text-red-400'}`}
                              >
                                {agent}: {aligned ? 'aligned' : 'misaligned'}
                              </span>
                            ))}
                          </div>
                        </div>
                        <span className="text-[10px] text-slate-500 shrink-0">
                          {new Date(data.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    ));
                })()}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
