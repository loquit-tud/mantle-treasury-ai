/**
 * Live Logs Component - Shows recent agent decisions
 */

import { useState, useEffect, useRef } from 'react';
import { 
  Terminal, 
  Bot, 
  Wallet, 
  User, 
  CheckCircle, 
  XCircle, 
  Clock,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { AgentDecision } from '../types';
import { timeAgo } from '../utils/format';

interface LiveLogsProps {
  decisions?: AgentDecision[];
}

export function LiveLogs({ decisions = [] }: LiveLogsProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [decisions]);

  const getAgentIcon = (agentType: string) => {
    switch (agentType) {
      case 'treasury':
        return <Wallet className="w-4 h-4 text-green-400" />;
      case 'credit':
        return <User className="w-4 h-4 text-blue-400" />;
      default:
        return <Bot className="w-4 h-4 text-gray-400" />;
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'executed':
        return <CheckCircle className="w-4 h-4 text-green-400" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-400" />;
      default:
        return <Clock className="w-4 h-4 text-yellow-400" />;
    }
  };

  const getActionColor = (action: string | undefined) => {
    if (!action) return 'text-gray-400';
    if (action.includes('yield') || action.includes('invest')) return 'text-green-400';
    if (action.includes('borrow') || action.includes('credit') || action.includes('portfolio')) return 'text-blue-400';
    if (action.includes('risk')) return 'text-orange-400';
    if (action.includes('sync') || action.includes('state')) return 'text-cyan-400';
    if (action.includes('withdraw')) return 'text-yellow-400';
    if (action.includes('monitor')) return 'text-purple-400';
    return 'text-gray-400';
  };

  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-purple-400" />
          <h3 className="text-sm font-medium text-white">Agent Logs</h3>
        </div>
        <span className="text-xs text-gray-500">{decisions.length} entries</span>
      </div>

      <div 
        ref={scrollRef}
        className="max-h-96 overflow-y-auto"
      >
        {decisions.length === 0 ? (
          <div className="p-8 text-center">
            <Bot className="w-8 h-8 text-gray-600 mx-auto mb-2" />
            <p className="text-sm text-gray-500">No agent activity yet</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-800">
            {decisions.map((decision) => (
              <div 
                key={decision.id} 
                className="p-3 hover:bg-gray-800/30 transition-colors cursor-pointer"
                onClick={() => setExpandedId(expandedId === decision.id ? null : decision.id)}
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5">
                    {getAgentIcon(decision.agentType || 'treasury')}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className={`text-sm font-medium ${getActionColor(decision.action)}`}>
                        {decision.action || 'event'}
                      </p>
                      <div className="flex items-center gap-2">
                        {getStatusIcon(decision.status || 'pending')}
                        {expandedId === decision.id ? (
                          <ChevronUp className="w-4 h-4 text-gray-500" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-gray-500" />
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      {timeAgo(decision.timestamp)}
                    </p>
                    
                    {expandedId === decision.id && (
                      <div className="mt-3 p-3 bg-gray-800/50 rounded-lg">
                        <p className="text-xs text-gray-400 mb-2">
                          <span className="text-gray-500">Reasoning:</span> {decision.reasoning}
                        </p>
                        {decision.txHash && (
                          <p className="text-xs text-gray-400">
                            <span className="text-gray-500">Tx:</span>{' '}
                            <a 
                              href={`https://arbiscan.io/tx/${decision.txHash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-400 hover:underline"
                            >
                              {decision.txHash.slice(0, 10)}...{decision.txHash.slice(-8)}
                            </a>
                          </p>
                        )}
                        {decision.data && Object.keys(decision.data).length > 0 && (
                          <div className="mt-2">
                            <p className="text-xs text-gray-500 mb-1">Data:</p>
                            <pre className="text-xs text-gray-400 bg-gray-900/50 p-2 rounded overflow-x-auto">
                              {JSON.stringify(decision.data, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
