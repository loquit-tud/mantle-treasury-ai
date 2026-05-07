import type { TreasuryState } from '../types';

const NODES = [
  { id: 'wallet', label: 'Wallet', x: 50, y: 120, icon: 'W', color: '#818cf8' },
  { id: 'treasury', label: 'Treasury', x: 220, y: 120, icon: 'V', color: '#38bdf8' },
  { id: 'yield', label: 'Yield', x: 390, y: 50, icon: 'Y', color: '#2dd4bf' },
  { id: 'credit', label: 'Credit', x: 390, y: 190, icon: 'C', color: '#a5b4fc' },
  { id: 'borrower', label: 'Borrowers', x: 540, y: 190, icon: 'B', color: '#fbbf24' },
];

const EDGES = [
  { from: 'wallet', to: 'treasury', label: 'Deposit' },
  { from: 'treasury', to: 'yield', label: 'Invest' },
  { from: 'yield', to: 'treasury', label: 'Harvest' },
  { from: 'treasury', to: 'credit', label: 'Fund' },
  { from: 'credit', to: 'borrower', label: 'Lend' },
  { from: 'borrower', to: 'credit', label: 'Repay' },
];

function getNode(id: string) {
  return NODES.find(n => n.id === id)!;
}

function formatUSDt(raw: string | number): string {
  const n = Number(raw) / 1e6;
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

export function FundFlowDiagram({ treasury, loanCount }: { treasury: TreasuryState; loanCount: number }) {
  const totalYield = treasury.yieldPositions.reduce((s, p) => s + Number(p.amount), 0);
  const totalHarvested = treasury.yieldPositions.reduce((s, p) => s + Number(p.harvested || 0), 0);

  return (
    <div className="overflow-hidden glass-card">
      <div className="flex items-center gap-2 border-b border-slate-800/60 bg-slate-950/30 px-5 py-4">
        <svg className="h-4 w-4 text-indigo-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
        <h3 className="text-sm font-semibold text-slate-200">Capital flow</h3>
        <span className="ml-auto flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-200">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Live
        </span>
      </div>
      <div className="p-4">
        <svg viewBox="0 0 620 240" className="w-full h-auto" style={{ minHeight: 180 }}>
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse" fill="#64748b">
              <path d="M 0 0 L 10 5 L 0 10 z" />
            </marker>
            {/* Animated particle */}
            {EDGES.map((e, i) => {
              const f = getNode(e.from);
              const t = getNode(e.to);
              return (
                <linearGradient key={`grad-${i}`} id={`edgeGrad${i}`} x1={f.x} y1={f.y} x2={t.x} y2={t.y} gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor={f.color} stopOpacity="0.6" />
                  <stop offset="100%" stopColor={t.color} stopOpacity="0.6" />
                </linearGradient>
              );
            })}
          </defs>

          {/* Edges with animated particles */}
          {EDGES.map((e, i) => {
            const f = getNode(e.from);
            const t = getNode(e.to);
            const dx = t.x - f.x;
            const dy = t.y - f.y;
            // Offset for bidirectional edges
            const offset = (e.from === 'yield' && e.to === 'treasury') || (e.from === 'borrower' && e.to === 'credit') ? 12 : 0;
            const mx = (f.x + t.x) / 2;
            const my = (f.y + t.y) / 2;
            const perpX = -dy / Math.sqrt(dx*dx + dy*dy) * offset;
            const perpY = dx / Math.sqrt(dx*dx + dy*dy) * offset;

            return (
              <g key={`edge-${i}`}>
                <line
                  x1={f.x + 30} y1={f.y + perpY}
                  x2={t.x - 30} y2={t.y + perpY}
                  stroke={`url(#edgeGrad${i})`}
                  strokeWidth="1.5"
                  strokeDasharray="4 3"
                  markerEnd="url(#arrow)"
                  opacity={0.5}
                />
                {/* Animated dot along edge */}
                <circle r="3" fill={t.color} opacity="0.8">
                  <animateMotion
                    dur={`${2 + i * 0.4}s`}
                    repeatCount="indefinite"
                    path={`M${f.x + 30},${f.y + perpY} L${t.x - 30},${t.y + perpY}`}
                  />
                </circle>
                {/* Edge label */}
                <text x={mx + perpX} y={my + perpY - 6} textAnchor="middle" fill="#64748b" fontSize="9" fontWeight="500">
                  {e.label}
                </text>
              </g>
            );
          })}

          {/* Nodes */}
          {NODES.map(node => (
            <g key={node.id}>
              <rect
                x={node.x - 40} y={node.y - 28}
                width="80" height="56"
                rx="12"
                fill="#0f172a"
                stroke={node.color}
                strokeWidth="1.5"
                opacity="0.9"
              />
              <text x={node.x} y={node.y - 8} textAnchor="middle" fill="#cbd5e1" fontSize="11" fontWeight="700">
                {node.icon}
              </text>
              <text x={node.x} y={node.y + 10} textAnchor="middle" fill="#e2e8f0" fontSize="9" fontWeight="600">
                {node.label}
              </text>
              {/* Live amounts */}
              {node.id === 'treasury' && (
                <text x={node.x} y={node.y + 22} textAnchor="middle" fill={node.color} fontSize="8" fontWeight="700">
                  {formatUSDt(treasury.balance)}
                </text>
              )}
              {node.id === 'yield' && (
                <text x={node.x} y={node.y + 22} textAnchor="middle" fill={node.color} fontSize="8" fontWeight="700">
                  {formatUSDt(totalYield)} invested
                </text>
              )}
              {node.id === 'credit' && (
                <text x={node.x} y={node.y + 22} textAnchor="middle" fill={node.color} fontSize="8" fontWeight="700">
                  {loanCount} active loan{loanCount !== 1 ? 's' : ''}
                </text>
              )}
              {node.id === 'yield' && totalHarvested > 0 && (
                <text x={node.x} y={node.y + 32} textAnchor="middle" fill="#2dd4bf" fontSize="7" opacity="0.75">
                  +{formatUSDt(totalHarvested)} harvested
                </text>
              )}
            </g>
          ))}

          {/* Pulsing glow on treasury node */}
          <circle cx={220} cy={120} r="38" fill="none" stroke="#818cf8" strokeWidth="1" opacity="0.25">
            <animate attributeName="r" values="38;46;38" dur="3s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.3;0.1;0.3" dur="3s" repeatCount="indefinite" />
          </circle>
        </svg>
      </div>
    </div>
  );
}
