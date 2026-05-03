/**
 * RiskRadar — Visual radar chart + gauges for 6 risk dimensions
 * Data from /api/treasury/health breakdown
 */

import { useState, useEffect } from 'react';
import { ShieldAlert, Activity } from 'lucide-react';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, Tooltip,
} from 'recharts';
import { apiUrl } from '../utils/api';

interface HealthBreakdown {
  liquidity:    { score: number; value: string };
  utilization:  { score: number; value: string };
  overdue:      { score: number; value: string };
  yield:        { score: number; value: string };
  volume:       { score: number; value: string };
  debt:         { score: number; value: string };
}

interface HealthData {
  health: number;
  rating: string;
  breakdown: HealthBreakdown;
}

const DIMENSION_LABELS: Record<string, string> = {
  liquidity: 'Liquidity',
  utilization: 'Utilization',
  overdue: 'Repayment',
  yield: 'Yield',
  volume: 'Volume',
  debt: 'Debt Health',
};

const RATING_COLORS: Record<string, { bg: string; text: string; glow: string }> = {
  Excellent: { bg: 'bg-green-900/30', text: 'text-green-400', glow: '#22c55e' },
  Good:      { bg: 'bg-green-900/20', text: 'text-green-500', glow: '#22c55e' },
  Fair:      { bg: 'bg-amber-900/20', text: 'text-amber-400', glow: '#f59e0b' },
  Poor:      { bg: 'bg-orange-900/20', text: 'text-orange-400', glow: '#f97316' },
  Critical:  { bg: 'bg-red-900/20', text: 'text-red-400', glow: '#ef4444' },
};

function getScoreColor(score: number): string {
  if (score >= 80) return '#22c55e';
  if (score >= 60) return '#84cc16';
  if (score >= 40) return '#f59e0b';
  if (score >= 20) return '#f97316';
  return '#ef4444';
}

// Animated arc gauge component
function ScoreGauge({ score, size = 120 }: { score: number; size?: number }) {
  const radius = (size - 16) / 2;
  const center = size / 2;
  const circumference = Math.PI * radius; // Half circle
  const progress = (score / 100) * circumference;
  const color = getScoreColor(score);

  return (
    <svg width={size} height={size / 2 + 20} viewBox={`0 0 ${size} ${size / 2 + 20}`}>
      <defs>
        <filter id="score-glow">
          <feGaussianBlur stdDeviation="2" result="coloredBlur" />
          <feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      {/* Background arc */}
      <path
        d={`M ${center - radius} ${center} A ${radius} ${radius} 0 0 1 ${center + radius} ${center}`}
        fill="none" stroke="#1f2937" strokeWidth="8" strokeLinecap="round"
      />
      {/* Progress arc */}
      <path
        d={`M ${center - radius} ${center} A ${radius} ${radius} 0 0 1 ${center + radius} ${center}`}
        fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
        strokeDasharray={`${progress} ${circumference}`}
        filter="url(#score-glow)"
      >
        <animate attributeName="stroke-dasharray" from={`0 ${circumference}`}
          to={`${progress} ${circumference}`} dur="1.2s" fill="freeze" />
      </path>
      {/* Score text */}
      <text x={center} y={center - 8} textAnchor="middle" fill={color}
        fontSize="24" fontWeight="700" fontFamily="monospace">
        {score}
      </text>
      <text x={center} y={center + 8} textAnchor="middle" fill="#6b7280"
        fontSize="9" fontWeight="500">
        / 100
      </text>
    </svg>
  );
}

export function RiskRadar() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const resp = await fetch(apiUrl('/api/treasury/health'));
        const json = await resp.json();
        const d = json.data ?? json;
        if (!cancelled && d.health != null) setHealth(d);
      } catch {
        // retry on next interval
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const iv = setInterval(load, 10_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  if (loading) {
    return (
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-8 text-center text-gray-500 text-sm">
        Loading risk analysis…
      </div>
    );
  }

  if (!health) {
    return (
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-8 text-center text-gray-500 text-sm">
        Risk data unavailable
      </div>
    );
  }

  const radarData = Object.entries(health.breakdown).map(([key, val]) => ({
    dimension: DIMENSION_LABELS[key] || key,
    score: val.score,
    fullMark: 100,
  }));

  const ratingStyle = RATING_COLORS[health.rating] || RATING_COLORS.Fair;

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden shadow-sm">
      <div className="px-5 py-4 border-b border-gray-700 flex items-center justify-between bg-gray-800/80">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-semibold text-gray-200">Risk Radar</h3>
        </div>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${ratingStyle.bg} ${ratingStyle.text}`}>
          {health.rating}
        </span>
      </div>

      <div className="p-4">
        {/* Top section: Gauge + Radar side by side */}
        <div className="flex items-center gap-4 mb-4">
          {/* Score gauge */}
          <div className="flex flex-col items-center flex-shrink-0">
            <ScoreGauge score={health.health} size={130} />
            <span className="text-[10px] text-gray-500 mt-1">Treasury Health</span>
          </div>

          {/* Radar chart */}
          <div className="flex-1 min-w-0">
            <ResponsiveContainer width="100%" height={200}>
              <RadarChart data={radarData} outerRadius="70%">
                <PolarGrid stroke="#374151" />
                <PolarAngleAxis
                  dataKey="dimension"
                  tick={{ fill: '#9ca3af', fontSize: 9 }}
                />
                <PolarRadiusAxis
                  angle={90}
                  domain={[0, 100]}
                  tick={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 11 }}
                  formatter={(value: number) => [`${value}/100`, 'Score']}
                />
                <Radar
                  name="Risk"
                  dataKey="score"
                  stroke={ratingStyle.glow}
                  fill={ratingStyle.glow}
                  fillOpacity={0.15}
                  strokeWidth={2}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Breakdown bars */}
        <div className="space-y-2">
          {Object.entries(health.breakdown).map(([key, val]) => {
            const color = getScoreColor(val.score);
            return (
              <div key={key} className="flex items-center gap-3">
                <span className="text-[10px] text-gray-400 w-16 text-right flex-shrink-0">
                  {DIMENSION_LABELS[key] || key}
                </span>
                <div className="flex-1 h-2 bg-gray-900 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-1000"
                    style={{ width: `${val.score}%`, backgroundColor: color }}
                  />
                </div>
                <span className="text-[10px] font-mono w-8 text-right" style={{ color }}>
                  {val.score}
                </span>
                <span className="text-[9px] text-gray-600 w-28 truncate">
                  {val.value}
                </span>
              </div>
            );
          })}
        </div>

        {/* Risk alerts */}
        {Object.entries(health.breakdown).some(([, val]) => val.score < 30) && (
          <div className="mt-4 px-3 py-2 bg-red-900/10 border border-red-900/30 rounded-lg">
            <div className="flex items-center gap-2 text-red-400 text-[11px] font-medium mb-1">
              <Activity className="w-3 h-3" /> Attention Required
            </div>
            <div className="space-y-0.5">
              {Object.entries(health.breakdown)
                .filter(([, val]) => val.score < 30)
                .map(([key, val]) => (
                  <p key={key} className="text-[10px] text-red-300/80">
                    • {DIMENSION_LABELS[key]}: {val.value} (score {val.score}/100)
                  </p>
                ))
              }
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
