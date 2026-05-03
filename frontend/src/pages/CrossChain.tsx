/**
 * CrossChain — Cross-Chain Analytics page
 * Combines ChainMap, YieldComparison, AgentActivityFeed, and RiskRadar
 */

import { Globe } from 'lucide-react';
import { ChainMap } from '../components/ChainMap';
import { YieldComparison } from '../components/YieldComparison';
import { AgentActivityFeed } from '../components/AgentActivityFeed';
import { RiskRadar } from '../components/RiskRadar';
import { useDashboard } from '../hooks/useDashboard';

export default function CrossChain() {
  const { data } = useDashboard();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Globe className="w-6 h-6 text-cyan-400" />
        <div>
          <h2 className="text-xl font-bold text-white">Cross-Chain Analytics</h2>
          <p className="text-xs text-gray-500">
            Live USD₮ flows, yield comparison, agent decisions & risk analysis
          </p>
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
