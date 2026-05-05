/**
 * Agent Status Component - Shows agent health and WebSocket connection
 */

import { Activity, Wifi, WifiOff } from 'lucide-react';
import { AgentStatusData } from '../types';

interface AgentStatusProps {
  status?: AgentStatusData;
  wsConnected: boolean;
}

export function AgentStatus({ status, wsConnected }: AgentStatusProps) {
  const getStatusColor = (agentStatus: string) => {
    switch (agentStatus) {
      case 'active':
        return 'text-emerald-300';
      case 'idle':
        return 'text-slate-400';
      case 'error':
        return 'text-red-300';
      case 'paused':
        return 'text-amber-300';
      default:
        return 'text-slate-400';
    }
  };

  const getStatusBg = (agentStatus: string) => {
    switch (agentStatus) {
      case 'active':
        return 'bg-emerald-500/15';
      case 'idle':
        return 'bg-slate-500/15';
      case 'error':
        return 'bg-red-500/15';
      case 'paused':
        return 'bg-amber-500/15';
      default:
        return 'bg-slate-500/15';
    }
  };

  return (
    <div className="flex items-center gap-3">
      {/* Connection Status */}
      <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-1.5">
        {wsConnected ? (
          <Wifi className="h-4 w-4 text-emerald-400" />
        ) : (
          <WifiOff className="h-4 w-4 text-red-400" />
        )}
        <span className={`text-xs font-medium ${wsConnected ? 'text-emerald-300' : 'text-red-300'}`}>
          {wsConnected ? 'Live' : 'Connecting...'}
        </span>
      </div>

      {/* Agent Status */}
      {status && (
        <div className="flex items-center gap-2">
          <div className={`flex items-center gap-1.5 rounded px-2 py-1 ${getStatusBg(status.treasury)}`}>
            <Activity className={`h-3 w-3 ${getStatusColor(status.treasury)}`} />
            <span className={`text-xs font-medium capitalize ${getStatusColor(status.treasury)}`}>
              Treasury
            </span>
          </div>
          <div className={`flex items-center gap-1.5 rounded px-2 py-1 ${getStatusBg(status.credit)}`}>
            <Activity className={`h-3 w-3 ${getStatusColor(status.credit)}`} />
            <span className={`text-xs font-medium capitalize ${getStatusColor(status.credit)}`}>
              Credit
            </span>
          </div>
          <div className={`flex items-center gap-1.5 rounded px-2 py-1 ${getStatusBg(status.risk)}`}>
            <Activity className={`h-3 w-3 ${getStatusColor(status.risk)}`} />
            <span className={`text-xs font-medium capitalize ${getStatusColor(status.risk)}`}>
              Risk
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
