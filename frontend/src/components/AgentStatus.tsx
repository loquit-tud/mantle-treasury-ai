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
        return 'text-green-400';
      case 'idle':
        return 'text-gray-400';
      case 'error':
        return 'text-red-400';
      case 'paused':
        return 'text-yellow-400';
      default:
        return 'text-gray-400';
    }
  };

  const getStatusBg = (agentStatus: string) => {
    switch (agentStatus) {
      case 'active':
        return 'bg-green-500/20';
      case 'idle':
        return 'bg-gray-500/20';
      case 'error':
        return 'bg-red-500/20';
      case 'paused':
        return 'bg-yellow-500/20';
      default:
        return 'bg-gray-500/20';
    }
  };

  return (
    <div className="flex items-center gap-3">
      {/* Connection Status */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 rounded-lg">
        {wsConnected ? (
          <Wifi className="w-4 h-4 text-green-400" />
        ) : (
          <WifiOff className="w-4 h-4 text-red-400" />
        )}
        <span className={`text-xs font-medium ${wsConnected ? 'text-green-400' : 'text-red-400'}`}>
          {wsConnected ? 'Live' : 'Connecting...'}
        </span>
      </div>

      {/* Agent Status */}
      {status && (
        <div className="flex items-center gap-2">
          <div className={`flex items-center gap-1.5 px-2 py-1 rounded ${getStatusBg(status.treasury)}`}>
            <Activity className={`w-3 h-3 ${getStatusColor(status.treasury)}`} />
            <span className={`text-xs font-medium capitalize ${getStatusColor(status.treasury)}`}>
              Treasury
            </span>
          </div>
          <div className={`flex items-center gap-1.5 px-2 py-1 rounded ${getStatusBg(status.credit)}`}>
            <Activity className={`w-3 h-3 ${getStatusColor(status.credit)}`} />
            <span className={`text-xs font-medium capitalize ${getStatusColor(status.credit)}`}>
              Credit
            </span>
          </div>
          <div className={`flex items-center gap-1.5 px-2 py-1 rounded ${getStatusBg(status.risk)}`}>
            <Activity className={`w-3 h-3 ${getStatusColor(status.risk)}`} />
            <span className={`text-xs font-medium capitalize ${getStatusColor(status.risk)}`}>
              Risk
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
