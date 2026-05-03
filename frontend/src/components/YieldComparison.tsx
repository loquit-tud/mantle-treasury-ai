/**
 * YieldComparison — Bar chart comparing APY across chains + protocols
 * with agent recommendation overlay
 */

import { useState, useEffect } from 'react';
import { TrendingUp, Zap } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine, LabelList,
} from 'recharts';
import { apiUrl } from '../utils/api';
import type { YieldPosition } from '../types';

interface ChainYield {
  chain: string;
  apy: number;
  tvl: string;
  protocol: string;
}

interface BridgeResponse {
  chains: ChainYield[];
  decision?: {
    bestChain?: string;
    bestRemoteChain?: string;
    shouldBridge?: boolean;
    wouldBridge?: boolean;
    apyAdvantage?: number;
  };
}

interface BridgeEnvelope {
  success?: boolean;
  data?: BridgeResponse;
}

function isBridgeEnvelope(payload: BridgeEnvelope | BridgeResponse): payload is BridgeEnvelope {
  return 'success' in payload || 'data' in payload;
}


function unwrapBridgeResponse(payload: BridgeEnvelope | BridgeResponse | null): BridgeResponse | null {
  if (!payload) return null;
  return isBridgeEnvelope(payload) ? payload.data ?? null : payload;
}

const CHAIN_COLORS: Record<string, string> = {
  arbitrum: '#28a0f0',
  ethereum: '#627eea',
  polygon: '#8247e5',
  aave: '#b6509e',
  compound: '#00d395',
};

function getColor(name: string): string {
  return CHAIN_COLORS[name.toLowerCase()] || '#6366f1';
}

export function YieldComparison({ yieldPositions: _yieldPositions }: { yieldPositions?: YieldPosition[] }) {
  const [chartData, setChartData] = useState<Array<{ name: string; apy: number; isBest: boolean; source: string }>>([]);
  const [bestChain, setBestChain] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const bridgeResp = await fetch(apiUrl('/api/bridge/demo')).then(r => r.json()).catch(() => null);
        if (cancelled) return;

        const bridge = unwrapBridgeResponse(bridgeResp as BridgeEnvelope | BridgeResponse | null);
        if (bridge?.chains) {
          // Deduplicate by chain name — keep highest APY per chain
          const chainMap = new Map<string, ChainYield>();
          bridge.chains.forEach(c => {
            const existing = chainMap.get(c.chain);
            if (!existing || c.apy > existing.apy) {
              chainMap.set(c.chain, c);
            }
          });

          // Extract best chain from decision (e.g. "polygon (Compound V3)" → "polygon")
          const bestRemote =
            bridge.decision?.bestRemoteChain?.split(' ')[0] ??
            bridge.decision?.bestChain ??
            '';
          if (bestRemote) setBestChain(bestRemote);

          const items = Array.from(chainMap.values()).map(c => ({
            name: c.chain.charAt(0).toUpperCase() + c.chain.slice(1),
            apy: c.apy,
            isBest: c.chain === bestRemote,
            source: 'cross-chain',
          }));
          items.sort((a, b) => b.apy - a.apy);
          setChartData(items);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const iv = setInterval(load, 20_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  const avgApy = chartData.length ? chartData.reduce((s, d) => s + d.apy, 0) / chartData.length : 0;

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden shadow-sm">
      <div className="px-5 py-4 border-b border-gray-700 flex items-center justify-between bg-gray-800/80">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-green-400" />
          <h3 className="text-sm font-semibold text-gray-200">Yield Comparison</h3>
        </div>
        {bestChain && (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-green-400 bg-green-900/30 px-2 py-0.5 rounded-full">
            <Zap className="w-3 h-3" />
            Agent picks: {bestChain.charAt(0).toUpperCase() + bestChain.slice(1)}
          </span>
        )}
      </div>

      <div className="p-4">
        {loading ? (
          <div className="h-48 flex items-center justify-center text-gray-500 text-sm">Loading yields…</div>
        ) : chartData.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-gray-500 text-sm">No yield data yet</div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} margin={{ top: 20, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} unit="%" />
              <Tooltip
                contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: '#e5e7eb' }}
                formatter={(value: number) => [`${value.toFixed(2)}%`, 'APY']}
              />
              <ReferenceLine y={avgApy} stroke="#6b7280" strokeDasharray="3 3"
                label={{ value: `avg ${avgApy.toFixed(1)}%`, fill: '#6b7280', fontSize: 10, position: 'right' }}
              />
              <Bar dataKey="apy" radius={[6, 6, 0, 0]} maxBarSize={48}>
                <LabelList
                  dataKey="apy"
                  position="top"
                  fill="#9ca3af"
                  fontSize={10}
                  formatter={(v: number) => `${v.toFixed(1)}%`}
                />
                {chartData.map((entry, idx) => (
                  <Cell
                    key={idx}
                    fill={getColor(entry.name)}
                    opacity={entry.isBest ? 1 : 0.7}
                    stroke={entry.isBest ? '#22c55e' : 'none'}
                    strokeWidth={entry.isBest ? 2 : 0}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}

        {/* Legend */}
        <div className="mt-3 flex flex-wrap gap-3 justify-center">
          {chartData.map((d, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[10px] text-gray-400">
              <div className="w-2 h-2 rounded-full" style={{ background: getColor(d.name) }} />
              <span>{d.name}</span>
              {d.isBest && <span className="text-green-400 font-semibold">★</span>}
              <span className="text-gray-600">({d.source})</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
