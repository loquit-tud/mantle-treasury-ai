/**
 * AgentActivityFeed — Scrollable real-time log of agent decisions with LLM reasoning
 */

import { useState, useEffect, useRef } from 'react';
import { Brain, Bot, Shield, ChevronDown, ChevronUp } from 'lucide-react';
import { apiUrl } from '../utils/api';

interface RawDecision {
  type: string;
  source: string;
  payload: {
    action: string;
    reasoning: string;
    score?: number;
    recommendation?: string;
    status?: string;
    data?: Record<string, unknown>;
  };
  timestamp: number;
}

const SOURCE_META: Record<string, { icon: typeof Brain; color: string; label: string }> = {
  treasury: { icon: Brain, color: 'text-cyan-400', label: 'Treasury Agent' },
  credit:   { icon: Bot,   color: 'text-green-400', label: 'Credit Agent' },
  risk:     { icon: Shield, color: 'text-amber-400', label: 'Risk Agent' },
};

const STATUS_BADGE: Record<string, string> = {
  executed: 'bg-green-900/40 text-green-400 border-green-800',
  pending:  'bg-amber-900/40 text-amber-400 border-amber-800',
  failed:   'bg-red-900/40 text-red-400 border-red-800',
};

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function formatType(type: string): string {
  // "treasury:risk_assessed" → "Risk Assessed"
  const part = type.split(':')[1] || type;
  return part.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function AgentActivityFeed() {
  const [decisions, setDecisions] = useState<RawDecision[]>([]);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const resp = await fetch(apiUrl('/api/decisions'));
        const json = await resp.json();
        if (!cancelled && json.success && Array.isArray(json.data)) {
          // Sort newest first
          const sorted = [...json.data].sort((a: RawDecision, b: RawDecision) => b.timestamp - a.timestamp);
          setDecisions(sorted);
        }
      } catch {
        // silent fail — will retry on next interval
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const iv = setInterval(load, 8_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  const toggleExpand = (idx: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const filtered = filter === 'all'
    ? decisions
    : decisions.filter(d => d.source === filter);

  const sources = [...new Set(decisions.map(d => d.source))];

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden shadow-sm flex flex-col">
      <div className="px-5 py-4 border-b border-gray-700 flex items-center justify-between bg-gray-800/80">
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-purple-400" />
          <h3 className="text-sm font-semibold text-gray-200">Agent Activity Feed</h3>
          <span className="text-[10px] text-gray-500 bg-gray-900 px-2 py-0.5 rounded-full ml-1">
            {filtered.length} events
          </span>
        </div>

        {/* Source filter pills */}
        <div className="flex gap-1">
          <button
            onClick={() => setFilter('all')}
            className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors ${
              filter === 'all' ? 'bg-gray-600 text-white' : 'bg-gray-900 text-gray-500 hover:text-gray-300'
            }`}
          >
            All
          </button>
          {sources.map(s => {
            const meta = SOURCE_META[s] || SOURCE_META.treasury;
            return (
              <button key={s}
                onClick={() => setFilter(s)}
                className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors ${
                  filter === s ? 'bg-gray-600 text-white' : 'bg-gray-900 text-gray-500 hover:text-gray-300'
                }`}
              >
                {meta.label}
              </button>
            );
          })}
        </div>
      </div>

      <div ref={scrollRef} className="overflow-y-auto max-h-[420px] divide-y divide-gray-700/50 custom-scrollbar">
        {loading ? (
          <div className="py-12 text-center text-gray-500 text-sm">Loading agent decisions…</div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-gray-500 text-sm">No agent activity yet</div>
        ) : (
          filtered.slice(0, 50).map((d, idx) => {
            const meta = SOURCE_META[d.source] || SOURCE_META.treasury;
            const Icon = meta.icon;
            const isExpanded = expanded.has(idx);
            const status = d.payload?.status || 'executed';

            return (
              <div key={idx}
                className="px-4 py-3 hover:bg-gray-750/50 transition-colors cursor-pointer"
                onClick={() => toggleExpand(idx)}
              >
                <div className="flex items-start gap-3">
                  {/* Source icon */}
                  <div className={`mt-0.5 ${meta.color}`}>
                    <Icon className="w-4 h-4" />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-semibold text-gray-200">
                        {formatType(d.type)}
                      </span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full border ${STATUS_BADGE[status] || STATUS_BADGE.executed}`}>
                        {status}
                      </span>
                      {d.payload?.score != null && (
                        <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded-full ${
                          d.payload.score >= 70 ? 'bg-green-900/30 text-green-400'
                          : d.payload.score >= 40 ? 'bg-amber-900/30 text-amber-400'
                          : 'bg-red-900/30 text-red-400'
                        }`}>
                          Score: {d.payload.score}
                        </span>
                      )}
                    </div>

                    {/* Reasoning preview or full */}
                    {d.payload?.reasoning && (
                      <p className={`text-[11px] text-gray-400 leading-relaxed ${
                        isExpanded ? '' : 'line-clamp-2'
                      }`}>
                        {d.payload.reasoning}
                      </p>
                    )}

                    {/* Expanded details */}
                    {isExpanded && d.payload?.data && (
                      <pre className="mt-2 text-[10px] text-gray-500 bg-gray-900 rounded-lg p-2 overflow-x-auto max-h-32">
                        {JSON.stringify(d.payload.data, null, 2)}
                      </pre>
                    )}
                  </div>

                  {/* Right side: time + expand */}
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className="text-[10px] text-gray-600 font-mono">
                      {relativeTime(d.timestamp)}
                    </span>
                    {isExpanded ? (
                      <ChevronUp className="w-3 h-3 text-gray-600" />
                    ) : (
                      <ChevronDown className="w-3 h-3 text-gray-600" />
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
