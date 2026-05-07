import { CheckCircle2, XCircle, Clock, ExternalLink } from 'lucide-react';
import type { AgentDecision } from '../types';

const AGENT_COLORS: Record<string, { dot: string; badge: string; text: string }> = {
  treasury: { dot: 'bg-indigo-400', badge: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-200', text: 'text-indigo-200' },
  credit: { dot: 'bg-sky-400', badge: 'border-sky-500/30 bg-sky-500/10 text-sky-200', text: 'text-sky-200' },
  risk: { dot: 'bg-amber-400', badge: 'border-amber-500/30 bg-amber-500/10 text-amber-200', text: 'text-amber-200' },
  yield: { dot: 'bg-teal-400', badge: 'border-teal-500/30 bg-teal-500/10 text-teal-200', text: 'text-teal-200' },
};

function StatusIcon({ status }: { status: string }) {
  if (status === 'executed') return <CheckCircle2 className="h-3 w-3 text-emerald-400" />;
  if (status === 'failed') return <XCircle className="w-3 h-3 text-red-400" />;
  return <Clock className="w-3 h-3 text-yellow-400" />;
}

export function DecisionTimeline({ decisions }: { decisions: AgentDecision[] }) {
  // Show latest first
  const sorted = [...decisions].sort((a, b) => b.timestamp - a.timestamp).slice(0, 25);

  return (
    <div className="overflow-hidden glass-card">
      <div className="flex items-center gap-2 border-b border-slate-800/60 bg-slate-950/30 px-5 py-4">
        <svg className="h-4 w-4 text-indigo-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
        <h3 className="text-sm font-semibold text-slate-200">Decision audit trail</h3>
        <span className="ml-auto rounded-full border border-slate-700/60 bg-slate-900/60 px-2 py-0.5 font-mono text-[10px] text-slate-400">{sorted.length} events</span>
      </div>
      <div className="custom-scrollbar h-[450px] overflow-y-auto overflow-x-hidden p-4">
        {sorted.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="brand-glow mb-3 flex h-12 w-12 items-center justify-center rounded-2xl">
              <Clock className="h-5 w-5 text-indigo-300" />
            </div>
            <p className="text-sm font-semibold text-slate-300">Audit trail is empty</p>
            <p className="mt-1 text-[11px] text-slate-500">Agent decisions will stream in here</p>
          </div>
        ) : (
          <div className="relative ml-2 space-y-3 pl-6">
            <span className="pointer-events-none absolute left-0 top-2 bottom-2 w-px bg-gradient-to-b from-indigo-500/40 via-slate-700/30 to-transparent" />
            {sorted.map((d, i) => {
              const colors = AGENT_COLORS[d.agentType] || AGENT_COLORS.treasury;
              const isLatest = i === 0;
              return (
                <div key={d.id || i} className={`relative group ${isLatest ? 'animate-in slide-in-from-top-2 fade-in duration-300' : ''}`}>
                  {/* Timeline dot */}
                  <span className={`absolute -left-[29px] top-2.5 flex h-2.5 w-2.5 rounded-full ring-[3px] ring-slate-950 ${colors.dot} ${isLatest ? 'shadow-[0_0_0_4px_rgba(99,102,241,0.18)]' : ''}`} />

                  {/* Card */}
                  <div className={`glass-tile rounded-lg p-3 transition-all ${isLatest ? 'border-indigo-500/30' : ''}`}>
                    <div className="mb-1.5 flex flex-wrap items-center gap-2">
                      <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${colors.badge}`}>
                        {d.agentType}
                      </span>
                      <StatusIcon status={d.status} />
                      <span className="text-[10px] capitalize text-slate-500">{d.status}</span>
                      <span className="ml-auto font-mono text-[10px] text-slate-600">
                        {new Date(d.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                    </div>

                    <h4 className="mb-1 text-sm font-semibold capitalize leading-tight text-white/95">
                      {(d.action || 'unknown').replace(/_/g, ' ')}
                    </h4>

                    {d.reasoning && (
                      <p className="line-clamp-2 text-[12px] leading-relaxed text-slate-400 transition-all group-hover:line-clamp-none">
                        {d.reasoning}
                      </p>
                    )}

                    {d.txHash && (
                      <div className="mt-2 flex items-center gap-1.5">
                        <ExternalLink className="h-3 w-3 text-slate-500" />
                        <a
                          href={`https://mantlescan.xyz/tx/${d.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="truncate font-mono text-[10px] text-indigo-300 hover:text-indigo-200"
                        >
                          {d.txHash.slice(0, 10)}...{d.txHash.slice(-6)}
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
