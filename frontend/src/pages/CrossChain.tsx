/**
 * CrossChain — Mantle-first cross-chain analytics page
 * Combines ChainMap, YieldComparison, AgentActivityFeed, and RiskRadar
 */

import { Link } from 'react-router-dom';
import { ArrowLeft, Globe, Shield } from 'lucide-react';
import { ChainMap } from '../components/ChainMap';
import { YieldComparison } from '../components/YieldComparison';
import { AgentActivityFeed } from '../components/AgentActivityFeed';
import { RiskRadar } from '../components/RiskRadar';
import { useDashboard } from '../hooks/useDashboard';
import { apiUrl } from '../utils/api';

export default function CrossChain() {
  const { data } = useDashboard();

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <Link to="/dashboard" className="inline-flex items-center gap-1.5 text-xs text-slate-500 transition-colors hover:text-indigo-300">
              <ArrowLeft className="w-3.5 h-3.5" /> Dashboard
            </Link>
            <h2 className="text-2xl font-semibold tracking-tight text-gradient-brand">Cross-chain</h2>
          </div>
          <p className="text-sm text-slate-400">
            Mantle is the primary execution chain. External chains are used only for comparing yield options and routing capital under guardrails.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <a
            href={apiUrl('/api/bridge/demo')}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:border-slate-600 hover:bg-slate-800"
          >
            <Globe className="h-4 w-4 text-cyan-300" />
            Bridge demo (JSON)
          </a>
          <Link
            to="/dashboard?proof=1"
            className="inline-flex items-center gap-2 rounded-lg border border-indigo-500/25 bg-indigo-950/30 px-4 py-2 text-sm font-medium text-indigo-200 transition-colors hover:border-indigo-400/40 hover:bg-indigo-950/50"
          >
            <Shield className="h-4 w-4 text-indigo-200" />
            AI proof
          </Link>
        </div>
      </div>

      {/* Row 1: Chain Map + Risk Radar */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChainMap />
        <RiskRadar />
      </div>

      {/* Row 2: Yield Comparison (full width) */}
      <YieldComparison yieldPositions={data?.treasury?.yieldPositions} />

      {/* Row 3: Agent Activity Feed (full width) */}
      <AgentActivityFeed />
    </div>
  );
}
