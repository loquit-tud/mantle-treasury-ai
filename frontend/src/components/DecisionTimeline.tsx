import { CheckCircle2, XCircle, Clock, ExternalLink } from 'lucide-react';
import type { AgentDecision } from '../types';

const AGENT_COLORS: Record<string, { dot: string; badge: string; text: string }> = {
  treasury: { dot: 'bg-cyan-500', badge: 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400', text: 'text-cyan-400' },
  credit:   { dot: 'bg-emerald-500', badge: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400', text: 'text-emerald-400' },
  risk:     { dot: 'bg-amber-500', badge: 'bg-amber-500/10 border-amber-500/30 text-amber-400', text: 'text-amber-400' },
  yield:    { dot: 'bg-purple-500', badge: 'bg-purple-500/10 border-purple-500/30 text-purple-400', text: 'text-purple-400' },
};

function StatusIcon({ status }: { status: string }) {
  if (status === 'executed') return <CheckCircle2 className="w-3 h-3 text-green-400" />;
  if (status === 'failed') return <XCircle className="w-3 h-3 text-red-400" />;
  return <Clock className="w-3 h-3 text-yellow-400" />;
}

export function DecisionTimeline({ decisions }: { decisions: AgentDecision[] }) {
  // Show latest first
  const sorted = [...decisions].sort((a, b) => b.timestamp - a.timestamp).slice(0, 25);

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden shadow-sm">
      <div className="px-5 py-4 border-b border-gray-700 flex items-center gap-2 bg-gray-800/80">
        <svg className="w-4 h-4 text-yellow-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
        <h3 className="text-sm font-semibold text-gray-200">Decision Audit Trail</h3>
        <span className="ml-auto text-[10px] text-gray-500 font-mono">{sorted.length} decisions</span>
      </div>
      <div className="p-4 h-[450px] overflow-y-auto overflow-x-hidden custom-scrollbar">
        {sorted.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-sm text-gray-500">No decisions recorded yet</p>
          </div>
        ) : (
          <div className="relative pl-6 border-l border-gray-700/50 ml-2 space-y-4">
            {sorted.map((d, i) => {
              const colors = AGENT_COLORS[d.agentType] || AGENT_COLORS.treasury;
              const isLatest = i === 0;
              return (
                <div key={d.id || i} className={`relative group ${isLatest ? 'animate-in slide-in-from-top-2 duration-300' : ''}`}>
                  {/* Timeline dot */}
                  <span className={`absolute -left-[29px] top-2 flex h-2.5 w-2.5 rounded-full ring-[3px] ring-gray-800 ${colors.dot} ${isLatest ? 'ring-4' : ''}`} />

                  {/* Card */}
                  <div className={`rounded-lg border border-gray-700/50 p-3 transition-colors ${isLatest ? 'bg-gray-750/50 border-gray-600/50' : 'hover:bg-gray-750/30'}`}>
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${colors.badge}`}>
                        {d.agentType}
                      </span>
                      <StatusIcon status={d.status} />
                      <span className="text-[10px] text-gray-500 capitalize">{d.status}</span>
                      <span className="text-[10px] text-gray-600 font-mono ml-auto">
                        {new Date(d.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                    </div>

                    <h4 className="text-sm font-semibold text-white/90 capitalize leading-tight mb-1">
                      {(d.action || 'unknown').replace(/_/g, ' ')}
                    </h4>

                    {d.reasoning && (
                      <p className="text-[12px] text-gray-400 leading-relaxed line-clamp-2 group-hover:line-clamp-none transition-all">
                        {d.reasoning}
                      </p>
                    )}

                    {d.txHash && (
                      <div className="mt-2 flex items-center gap-1.5">
                        <ExternalLink className="w-3 h-3 text-gray-500" />
                        <a
                          href={`https://arbiscan.io/tx/${d.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] font-mono text-blue-400 hover:text-blue-300 truncate"
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
