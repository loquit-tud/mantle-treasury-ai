/**
 * ChainMap — Animated USD₮ flow visualization between chains
 * Shows LayerZero bridge paths with live APY data per chain
 */

import { useState, useEffect } from 'react';
import { Globe, ArrowRight } from 'lucide-react';
import { apiUrl } from '../utils/api';

interface ChainInfo {
  chain: string;
  apy: number;
  tvl: string;
  protocol: string;
}

interface BridgeData {
  wallet: { address: string; usdtBalance: string };
  chains: ChainInfo[];
  supportedChains: string[];
  infrastructure: { bridgeProtocol: string };
  safetyCaps: { maxBridgeAmount: string; minApyAdvantage: string };
  decision: { bestChain: string; currentChain: string; apyAdvantage: number; shouldBridge: boolean; reason: string };
}

interface BridgeDemoEnvelope {
  success?: boolean;
  data?: BridgeData;
}

function isBridgeDemoEnvelope(payload: BridgeDemoEnvelope | BridgeData): payload is BridgeDemoEnvelope {
  return 'success' in payload || 'data' in payload;
}

function unwrapBridgeData(payload: BridgeDemoEnvelope | BridgeData | null): BridgeData | null {
  if (!payload) return null;
  return isBridgeDemoEnvelope(payload) ? payload.data ?? null : payload;
}

const CHAIN_META: Record<string, { color: string; icon: string; x: number; y: number }> = {
  arbitrum:  { color: '#28a0f0', icon: '🔵', x: 310, y: 60 },
  ethereum:  { color: '#627eea', icon: '⟠',  x: 100, y: 180 },
  polygon:   { color: '#8247e5', icon: '🟣', x: 520, y: 180 },
};

const BRIDGE_PATHS = [
  { from: 'arbitrum', to: 'ethereum' },
  { from: 'ethereum', to: 'polygon' },
  { from: 'polygon', to: 'arbitrum' },
];

export function ChainMap() {
  const [data, setData] = useState<BridgeData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const resp = await fetch(apiUrl('/api/bridge/demo'));
        const json = await resp.json() as BridgeDemoEnvelope | BridgeData;
        const bridgeData = unwrapBridgeData(json);
        if (!cancelled && (!isBridgeDemoEnvelope(json) || json.success !== false) && bridgeData) {
          setData(bridgeData);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError('Bridge data unavailable');
      }
    }
    load();
    const iv = setInterval(load, 15_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  const chainApys = new Map<string, number>();
  data?.chains?.forEach(c => chainApys.set(c.chain, c.apy));

  const bestChain = data?.decision?.bestChain;

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden shadow-sm">
      <div className="px-5 py-4 border-b border-gray-700 flex items-center justify-between bg-gray-800/80">
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-semibold text-gray-200">Cross-Chain USD₮ Map</h3>
        </div>
        {data?.infrastructure && (
          <span className="text-[10px] font-mono text-gray-500 bg-gray-900 px-2 py-0.5 rounded-full">
            {data.infrastructure.bridgeProtocol}
          </span>
        )}
      </div>

      <div className="p-4">
        {error && <p className="text-xs text-red-400 text-center mb-2">{error}</p>}

        <svg viewBox="0 0 620 280" className="w-full h-auto" style={{ minHeight: 200 }}>
          <defs>
            <marker id="chain-arrow" viewBox="0 0 10 10" refX="8" refY="5"
              markerWidth="5" markerHeight="5" orient="auto-start-reverse" fill="#4b5563">
              <path d="M 0 0 L 10 5 L 0 10 z" />
            </marker>
            {/* Glow filter */}
            <filter id="glow">
              <feGaussianBlur stdDeviation="3" result="coloredBlur" />
              <feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          {/* Bridge paths with animated particles */}
          {BRIDGE_PATHS.map((bp, i) => {
            const f = CHAIN_META[bp.from];
            const t = CHAIN_META[bp.to];
            if (!f || !t) return null;

            const dx = t.x - f.x;
            const dy = t.y - f.y;
            const len = Math.sqrt(dx * dx + dy * dy);
            const nx = dx / len;
            const ny = dy / len;
            // Offset start/end from node center
            const sx = f.x + nx * 50;
            const sy = f.y + ny * 30;
            const ex = t.x - nx * 50;
            const ey = t.y - ny * 30;

            // Curved path control point
            const mx = (sx + ex) / 2;
            const my = (sy + ey) / 2 - 20;
            const pathD = `M${sx},${sy} Q${mx},${my} ${ex},${ey}`;

            return (
              <g key={`bp-${i}`}>
                <path d={pathD}
                  fill="none" stroke="#374151" strokeWidth="1.5"
                  strokeDasharray="6 4" markerEnd="url(#chain-arrow)" opacity={0.4}
                />
                {/* Animated particles (3 per path for density) */}
                {[0, 0.33, 0.66].map((offset, j) => (
                  <circle key={j} r="2.5" fill={t.color} opacity="0.7" filter="url(#glow)">
                    <animateMotion
                      dur={`${3 + i * 0.5}s`}
                      repeatCount="indefinite"
                      begin={`${offset * (3 + i * 0.5)}s`}
                      path={pathD}
                    />
                  </circle>
                ))}
                {/* Bridge label */}
                <text x={mx} y={my - 8} textAnchor="middle" fill="#6b7280" fontSize="8" fontWeight="500">
                  LayerZero
                </text>
              </g>
            );
          })}

          {/* Chain nodes */}
          {Object.entries(CHAIN_META).map(([chain, meta]) => {
            const apy = chainApys.get(chain);
            const isBest = chain === bestChain;

            return (
              <g key={chain}>
                {/* Glow ring for best chain */}
                {isBest && (
                  <circle cx={meta.x} cy={meta.y} r="48" fill="none"
                    stroke={meta.color} strokeWidth="1.5" opacity="0.3" filter="url(#glow)">
                    <animate attributeName="r" values="48;54;48" dur="2.5s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.3;0.1;0.3" dur="2.5s" repeatCount="indefinite" />
                  </circle>
                )}

                {/* Node background */}
                <circle cx={meta.x} cy={meta.y} r="42"
                  fill="#111827" stroke={meta.color} strokeWidth={isBest ? 2.5 : 1.5}
                />

                {/* Chain icon */}
                <text x={meta.x} y={meta.y - 8} textAnchor="middle" fontSize="18">
                  {meta.icon}
                </text>

                {/* Chain name */}
                <text x={meta.x} y={meta.y + 10} textAnchor="middle"
                  fill="#e5e7eb" fontSize="10" fontWeight="600">
                  {chain.charAt(0).toUpperCase() + chain.slice(1)}
                </text>

                {/* APY badge */}
                {apy != null && (
                  <g>
                    <rect x={meta.x - 22} y={meta.y + 16} width="44" height="16" rx="8"
                      fill={isBest ? meta.color : '#1f2937'} opacity={isBest ? 0.2 : 1}
                      stroke={meta.color} strokeWidth="0.5"
                    />
                    <text x={meta.x} y={meta.y + 28} textAnchor="middle"
                      fill={isBest ? '#fff' : meta.color} fontSize="9" fontWeight="700">
                      {apy.toFixed(1)}% APY
                    </text>
                  </g>
                )}

                {/* Best badge */}
                {isBest && (
                  <g>
                    <rect x={meta.x - 14} y={meta.y - 54} width="28" height="14" rx="7"
                      fill="#22c55e" opacity="0.9"
                    />
                    <text x={meta.x} y={meta.y - 44} textAnchor="middle"
                      fill="#fff" fontSize="7" fontWeight="700">
                      BEST
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Wallet node at bottom center */}
          <g>
            <rect x="260" y="240" width="100" height="30" rx="15"
              fill="#1f2937" stroke="#6366f1" strokeWidth="1.5"
            />
            <text x="310" y="259" textAnchor="middle" fill="#e5e7eb" fontSize="9" fontWeight="600">
              👛 {data?.wallet ? `$${Number(data.wallet.usdtBalance).toFixed(2)}` : '—'} USDt
            </text>
          </g>

          {/* Connector lines from wallet to each chain */}
          {Object.entries(CHAIN_META).map(([chain, meta]) => (
            <line key={`w-${chain}`}
              x1="310" y1="240" x2={meta.x} y2={meta.y + 42}
              stroke="#374151" strokeWidth="0.8" strokeDasharray="3 3" opacity="0.3"
            />
          ))}
        </svg>

        {/* Decision banner */}
        {data?.decision && (
          <div className={`mt-3 px-4 py-2.5 rounded-lg border text-xs ${
            data.decision.shouldBridge
              ? 'bg-green-900/20 border-green-800 text-green-300'
              : 'bg-gray-900 border-gray-700 text-gray-400'
          }`}>
            <div className="flex items-center gap-2">
              <ArrowRight className="w-3 h-3 flex-shrink-0" />
              <span className="font-medium">{data.decision.reason}</span>
            </div>
            {data.decision.shouldBridge && (
              <span className="ml-5 text-green-400 font-semibold">
                +{data.decision.apyAdvantage.toFixed(2)}% APY advantage → {data.decision.bestChain}
              </span>
            )}
          </div>
        )}

        {/* Supported chains footer */}
        {data?.supportedChains && (
          <div className="mt-3 flex flex-wrap gap-1.5 justify-center">
            {data.supportedChains.map(c => (
              <span key={c} className="text-[10px] px-2 py-0.5 rounded-full bg-gray-900 text-gray-500 border border-gray-800">
                {c}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
