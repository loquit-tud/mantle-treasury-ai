import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  TrendingUp,
  AlertTriangle,
  RefreshCw,
  DollarSign,
  Users,
  BarChart3,
  Wallet,
  PauseCircle,
  Activity,
  CheckCircle2,
  Shield,
  ArrowLeft,
} from 'lucide-react';
import { BonusFeatures } from '../components/BonusFeatures';
import { AgentChat } from '../components/AgentChat';
import { FundFlowDiagram } from '../components/FundFlowDiagram';
import { DecisionTimeline } from '../components/DecisionTimeline';
import { useDashboard } from '../hooks/useDashboard';
import { useWebSocket } from '../hooks/useWebSocket';
import { formatAmount, formatPercentage } from '../utils/format';
import type {
  AgentStatusData,
  AgentDecision,
  DashboardData,
  TreasuryState,
  YieldPosition,
  PendingTransaction
} from '../types';
import { AgentStatus } from '../components/AgentStatus';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
} from 'recharts';

import { apiUrl, wsUrl } from '../utils/api';

const WS_URL = wsUrl();

// API helpers for Quick Actions

const pauseAgents = async () => {
  try {
    const res = await fetch(apiUrl('/api/emergency/pause'), { method: 'POST' });
    if (!res.ok) throw new Error('Failed to pause agents');
  } catch (err) {
    console.error(err);
  }
};

type HealthData = {
  score: number;
  rating: string;
  breakdown: Record<string, { score: number; weight: number; weighted: number }>;
};

export default function Dashboard() {
  const { data, isLoading, error, refresh } = useDashboard();
  const { isConnected, lastMessage } = useWebSocket(WS_URL);

  const [decisions, setDecisions] = useState<AgentDecision[]>([]);
  const [dialogueRounds, setDialogueRounds] = useState<DashboardData['dialogueRounds']>();
  const [agentStatus, setAgentStatus] = useState<AgentStatusData>({
    treasury: 'idle',
    credit: 'idle',
    risk: 'idle',
  });
  
  // Historical balance data for the chart (last 24 updates)
  const [balanceHistory, setBalanceHistory] = useState<{ time: string, balance: number }[]>([]);

  // Treasury Health
  const [healthData, setHealthData] = useState<HealthData | null>(null);
  const [syncing, setSyncing] = useState(false);

  // Revenue-Backed Lending & Debt Restructuring
  const [revenueSummary, setRevenueSummary] = useState<Record<string, unknown> | null>(null);
  const [restructuringSummary, setRestructuringSummary] = useState<Record<string, unknown> | null>(null);

  // Fetch treasury health
  const fetchHealth = async () => {
    try {
      const res = await fetch(apiUrl('/api/treasury/health'));
      if (res.ok) {
        const d = await res.json();
        const h = d.data ?? d;
        setHealthData({ score: h.health ?? h.score, rating: h.rating, breakdown: h.breakdown });
      }
    } catch { /* ignore */ }
  };

  const syncTreasury = async () => {
    setSyncing(true);
    try {
      const res = await fetch(apiUrl('/api/treasury/sync'), { method: 'POST' });
      if (!res.ok) throw new Error('Failed to sync treasury');
      await refresh();
      await fetchHealth();
    } catch (err) {
      console.error(err);
    } finally {
      setSyncing(false);
    }
  };

  const fetchInnovation = async () => {
    try {
      const [revRes, restRes] = await Promise.all([
        fetch(apiUrl('/api/revenue/summary')),
        fetch(apiUrl('/api/restructuring/proposals')),
      ]);
      if (revRes.ok) { const d = await revRes.json(); setRevenueSummary(d.data ?? null); }
      if (restRes.ok) { const d = await restRes.json(); setRestructuringSummary(d.data?.summary ?? null); }
    } catch { /* ignore */ }
  };



  useEffect(() => {
    fetchHealth();
    fetchInnovation();
    const interval = setInterval(() => { fetchHealth(); fetchInnovation(); }, 15000);
    return () => clearInterval(interval);
  }, []);

  // Live "seconds ago" counter
  const [lastFetch, setLastFetch] = useState<number>(Date.now());
  const [secondsAgo, setSecondsAgo] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSecondsAgo(Math.floor((Date.now() - lastFetch) / 1000)), 1000);
    return () => clearInterval(t);
  }, [lastFetch]);

  // Normalize raw EventBus events ({ type, source, payload }) into AgentDecision shape
  const normalizeDecision = (raw: Record<string, unknown>): AgentDecision => {
    if (raw.action && raw.agentType) return raw as unknown as AgentDecision;
    // payload may contain { action, reasoning, data, status } from enhanced events
    const payload = (raw.payload || {}) as Record<string, unknown>;
    return {
      id: (raw.id as string) || `${raw.type || 'event'}-${raw.timestamp || Date.now()}`,
      agentType: (raw.agentType || raw.source || 'treasury') as AgentDecision['agentType'],
      action: (payload.action || raw.action || raw.type || 'unknown') as string,
      reasoning: (payload.reasoning || raw.reasoning || '') as string,
      data: (payload.data || raw.data || raw.payload || {}) as Record<string, unknown>,
      txHash: (payload.txHash || raw.txHash) as string | undefined,
      status: (payload.status || raw.status || 'executed') as AgentDecision['status'],
      timestamp: (raw.timestamp || Date.now()) as number,
    };
  };

  // Merge REST + WS data
  useEffect(() => {
    if (data) {
      const normalized = (data.agentDecisions || []).map((d: AgentDecision) => normalizeDecision(d as unknown as Record<string, unknown>));
      setDecisions(normalized);
      setLastFetch(Date.now());
      setAgentStatus({
        treasury: data.agentStatus?.treasury || 'idle',
        credit: data.agentStatus?.credit || 'idle',
        risk: data.agentStatus?.risk || 'idle',
      });
      // Seed dialogue rounds from REST
      if (data.dialogueRounds?.length && !dialogueRounds?.length) {
        setDialogueRounds(data.dialogueRounds);
      }
      // Initialize balance history with current if empty
      if (balanceHistory.length === 0 && data.treasury) {
        setBalanceHistory([{ 
          time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}), 
          balance: Number(data.treasury.balance) / 1e6 
        }]);
      }
    }
  }, [data]);

  // Handle real-time WS updates
  useEffect(() => {
    if (!lastMessage) return;
    const msg = lastMessage as { type: string; data: DashboardData };
    if (
      msg.type === 'dashboard:initial' ||
      msg.type === 'dashboard:update'
    ) {
      const wsNormalized = (msg.data.agentDecisions || []).map((d: AgentDecision) => normalizeDecision(d as unknown as Record<string, unknown>));
      setDecisions(wsNormalized);
      setAgentStatus({
        treasury: msg.data.agentStatus?.treasury || 'idle',
        credit: msg.data.agentStatus?.credit || 'idle',
        risk: msg.data.agentStatus?.risk || 'idle',
      });

      // Seed dialogue rounds from WS initial payload
      if (msg.data.dialogueRounds?.length) {
        setDialogueRounds(msg.data.dialogueRounds);
      }
      
      if (msg.data.treasury) {
        const newBalance = Number(msg.data.treasury.balance) / 1e6;
        const timeStr = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        
        setBalanceHistory(prev => {
          const updated = [...prev, { time: timeStr, balance: newBalance }];
          return updated.slice(-24); // Keep last 24 points
        });
      }
    }
    if (msg.type === 'agent:event') {
      // Append live event as decision
      const event = normalizeDecision(msg.data as unknown as Record<string, unknown>);
      if (event?.id) {
        setDecisions((prev) => [...prev, event].slice(-50));
      }
    }
  }, [lastMessage]);

  const treasury: TreasuryState = data?.treasury || {
    balance: '0',
    dailyVolume: '0',
    pendingTransactions: [],
    yieldPositions: [],
    lastUpdated: 0,
  };
  
  // Prepare Credit Score Distribution data
  const scoreDistribution = [
    { name: 'Poor (<600)', count: 0, color: '#ef4444' },     // red-500
    { name: 'Fair (600-699)', count: 0, color: '#eab308' },  // yellow-500
    { name: 'Good (700-799)', count: 0, color: '#3b82f6' },  // blue-500
    { name: 'Excellent (800+)', count: 0, color: '#22c55e' } // green-500
  ];
  
  if (data?.creditProfiles) {
    data.creditProfiles.forEach(p => {
      if (p.score < 600) scoreDistribution[0].count++;
      else if (p.score < 700) scoreDistribution[1].count++;
      else if (p.score < 800) scoreDistribution[2].count++;
      else scoreDistribution[3].count++;
    });
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-2">
         <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3">
              <Link to="/" className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-green-400 transition-colors">
                <ArrowLeft className="w-3.5 h-3.5" /> Home
              </Link>
              <h2 className="text-2xl font-bold text-white tracking-tight">Mission Control</h2>
            </div>
            <div className="flex items-center gap-3">
              <p className="text-sm text-gray-400">Quorum real-time overview and health</p>
               <div className="h-4 w-px bg-gray-800" />
               <AgentStatus status={agentStatus} wsConnected={isConnected || !!data} />
               <div className="h-4 w-px bg-gray-800" />
               <span className="text-[11px] text-gray-500 font-mono tabular-nums">
                 updated {secondsAgo}s ago
               </span>
            </div>
         </div>
         {/* Quick Actions Panel */}
         <div className="flex gap-3">
             <button
               onClick={syncTreasury}
               disabled={syncing}
               className="inline-flex items-center gap-2 rounded-lg bg-gray-900 border border-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 hover:border-gray-700 transition-colors disabled:opacity-50"
             >
               <RefreshCw className={`w-4 h-4 text-green-400 ${syncing ? 'animate-spin' : ''}`} />
               {syncing ? 'Syncing...' : 'Sync Treasury'}
             </button>
             <button
               onClick={() => {
                 if (window.confirm('Are you sure you want to pause all agent activities? This action requires multi-sig to resume.')) {
                   pauseAgents();
                 }
               }}
               className="inline-flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-2 text-sm font-medium text-red-500 hover:bg-red-500/20 transition-all hover:scale-105"
             >
               <PauseCircle className="w-4 h-4" />
               Emergency Pause
             </button>
         </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded-xl p-4 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-red-400" />
          <span className="text-red-300 text-sm">{error}</span>
          <button
            onClick={refresh}
            className="ml-auto text-xs text-red-400 hover:text-red-300 flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" /> Retry
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          icon={<DollarSign className="w-5 h-5 text-cyan-400" />}
          label="Treasury Balance"
          value={`$${(Number(treasury.balance) / 1e6).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} USDt`}
          sub="Vault holdings"
        />
        <KPICard
          icon={<BarChart3 className="w-5 h-5 text-blue-400" />}
          label="Daily Volume"
          value={`$${(Number(treasury.dailyVolume) / 1e6).toLocaleString('en-US')} USDt`}
          sub="In / Out today"
        />
        <KPICard
          icon={<TrendingUp className="w-5 h-5 text-purple-400" />}
          label="Yield Positions"
          value={String(treasury.yieldPositions.length)}
          sub={
            treasury.yieldPositions.length > 0
              ? `Avg ${formatPercentage(
                  treasury.yieldPositions.reduce(
                    (s: number, p: YieldPosition) => s + p.apy,
                    0,
                  ) / treasury.yieldPositions.length,
                )} APY`
              : 'No active positions'
          }
        />
        <KPICard
          icon={<Users className="w-5 h-5 text-yellow-400" />}
          label="Credit Profiles"
          value={String(data?.creditProfiles?.length ?? 0)}
          sub={`${data?.activeLoans?.length ?? 0} active loans`}
        />
      </div>

      {/* Treasury Health */}
      <div className="grid grid-cols-1 gap-4">
        {/* Health Score */}
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <Shield className="w-5 h-5" style={{ color: healthData ? (healthData.score >= 80 ? '#22c55e' : healthData.score >= 60 ? '#eab308' : healthData.score >= 40 ? '#f97316' : '#ef4444') : '#6b7280' }} />
            <span className="text-xs text-gray-400 uppercase tracking-widest font-semibold">Treasury Health Score</span>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex items-baseline gap-2">
              <span className="text-5xl font-black tabular-nums" style={{ color: healthData ? (healthData.score >= 80 ? '#22c55e' : healthData.score >= 60 ? '#eab308' : healthData.score >= 40 ? '#f97316' : '#ef4444') : '#6b7280' }}>
                {healthData?.score ?? '—'}
              </span>
              <span className="text-lg text-gray-500 font-medium">/100</span>
            </div>
            <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
              !healthData ? 'bg-gray-700 text-gray-400'
              : healthData.score >= 80 ? 'bg-green-500/20 text-green-400 border border-green-500/30'
              : healthData.score >= 60 ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
              : healthData.score >= 40 ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
              : 'bg-red-500/20 text-red-400 border border-red-500/30'
            }`}>
              {healthData?.rating ?? 'Loading...'}
            </span>
            {/* Health bar */}
            <div className="flex-1 hidden sm:block">
              <div className="h-3 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-1000 ease-out"
                  style={{
                    width: `${healthData?.score ?? 0}%`,
                    backgroundColor: healthData ? (healthData.score >= 80 ? '#22c55e' : healthData.score >= 60 ? '#eab308' : healthData.score >= 40 ? '#f97316' : '#ef4444') : '#6b7280'
                  }}
                />
              </div>
              {healthData?.breakdown && (
                <div className="flex gap-3 mt-2 text-[10px] text-gray-500">
                  {Object.entries(healthData.breakdown).slice(0, 4).map(([key, val]) => (
                    <span key={key} className="capitalize">{key.replace(/_/g, ' ')}: {Math.round(val.score)}%</span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Panel title="Treasury Balance History (Last 24 updates)" icon={<Activity className="w-4 h-4 text-green-400" />}>
          <div className="h-[250px] w-full pt-4">
            {balanceHistory.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={balanceHistory} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorBalance" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#22d3ee" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1f2937" />
                  <XAxis dataKey="time" stroke="#4b5563" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="#4b5563" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `$${value}`} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#1f2937', borderColor: '#374151', borderRadius: '0.5rem', color: '#fff' }}
                    itemStyle={{ color: '#22d3ee' }}
                  />
                  <Area type="monotone" dataKey="balance" stroke="#22d3ee" strokeWidth={2} fillOpacity={1} fill="url(#colorBalance)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
               <div className="h-full flex items-center justify-center">
                 <EmptyState text="Waiting for initial data..." />
               </div>
            )}
          </div>
        </Panel>
        
        <Panel title="Credit Score Distribution" icon={<BarChart3 className="w-4 h-4 text-blue-400" />}>
            <div className="h-[250px] w-full pt-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={scoreDistribution} margin={{ top: 5, right: 0, left: 0, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1f2937" />
                <XAxis dataKey="name" stroke="#4b5563" fontSize={11} tickLine={false} axisLine={false} angle={-15} textAnchor="end" />
                <YAxis stroke="#4b5563" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip 
                  cursor={{ fill: '#374151', opacity: 0.4 }}
                  contentStyle={{ backgroundColor: '#1f2937', borderColor: '#374151', borderRadius: '0.5rem', color: '#fff' }}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {scoreDistribution.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      {/* Agent Chat + Fund Flow Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AgentChat lastMessage={lastMessage} initialDialogues={dialogueRounds} />
        <FundFlowDiagram treasury={treasury} loanCount={data?.activeLoans?.length ?? 0} />
      </div>

      {/* Main Content Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Treasury + Credit panels */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Active Loans */}
          <Panel title="Active Loans" icon={<Users className="w-4 h-4 text-emerald-400" />}>
            {(!data?.activeLoans || data.activeLoans.length === 0) ? (
              <EmptyState text="No active loans" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-500 text-xs uppercase border-b border-gray-800">
                      <th className="py-2 text-left">Borrower</th>
                      <th className="py-2 text-right">Principal</th>
                      <th className="py-2 text-right">Rate</th>
                      <th className="py-2 text-right">Due</th>
                      <th className="py-2 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {data.activeLoans.map((loan) => {
                      const now = Date.now() / 1000;
                      const isOverdue = loan.dueDate < now;
                      const overdueDays = isOverdue ? Math.ceil((now - loan.dueDate) / 86400) : 0;
                      return (
                      <tr key={loan.id} className={`hover:bg-gray-800/20 transition-colors ${loan.creditFrozen ? 'opacity-60' : ''}`}>
                        <td className="py-3 font-mono text-gray-300">
                          <div className="flex items-center gap-2">
                            {loan.borrower.slice(0, 6)}...{loan.borrower.slice(-4)}
                            {loan.loanType === 'revenue_backed' && (
                              <span className="text-[9px] bg-green-900/30 text-green-400 px-1.5 py-0.5 rounded-full">REV</span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 text-right text-white font-medium">
                          {formatAmount(loan.principal)} USDt
                        </td>
                        <td className="py-3 text-right text-gray-400">
                          <div>
                            {formatPercentage(loan.interestRate / 100)}
                            {loan.penaltyRateBps ? (
                              <span className="text-[10px] text-red-400 block">+{(loan.penaltyRateBps / 100).toFixed(0)}% penalty</span>
                            ) : null}
                          </div>
                        </td>
                        <td className="py-3 text-right text-gray-400">
                          {new Date(loan.dueDate * 1000).toLocaleDateString()}
                        </td>
                        <td className="py-3 text-right">
                          {loan.creditFrozen ? (
                            <span className="text-[10px] bg-red-900/40 text-red-400 px-2 py-1 rounded-full font-semibold">🔒 FROZEN</span>
                          ) : isOverdue ? (
                            <div>
                              <span className="text-[10px] bg-amber-900/30 text-amber-400 px-2 py-1 rounded-full font-semibold">{overdueDays}d overdue</span>
                              {loan.penaltyAccrued && BigInt(loan.penaltyAccrued) > 0n && (
                                <p className="text-[9px] text-red-400 mt-1">+{formatAmount(loan.penaltyAccrued)} penalty</p>
                              )}
                            </div>
                          ) : (
                            <span className="text-[10px] bg-green-900/30 text-green-400 px-2 py-1 rounded-full font-semibold">Current</span>
                          )}
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          {/* Pending Transactions */}
          <Panel title="Pending Transactions (Multi-sig)" icon={<Wallet className="w-4 h-4 text-cyan-400" />}>
            {treasury.pendingTransactions.length === 0 ? (
              <EmptyState text="No pending transactions" />
            ) : (
              <div className="divide-y divide-gray-800">
                {treasury.pendingTransactions.map((tx: PendingTransaction) => (
                  <div
                    key={tx.txHash}
                    className="py-4 flex items-center justify-between hover:bg-gray-800/10 transition-colors px-2 rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                       <div className="w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center">
                          <CheckCircle2 className="w-4 h-4 text-gray-400" />
                       </div>
                       <div>
                        <p className="text-sm font-mono text-gray-300">
                          {tx.to.slice(0, 6)}...{tx.to.slice(-4)}
                        </p>
                        <p className="text-xs text-gray-500">
                          {tx.signatures} sig(s) &middot;{' '}
                          <span className={tx.executed ? "text-green-500" : "text-yellow-500"}>
                            {tx.executed ? 'Executed' : 'Pending'}
                          </span>
                        </p>
                      </div>
                    </div>
                    <span className="text-sm font-semibold text-white bg-gray-900 px-3 py-1 rounded-full border border-gray-800">
                      {formatAmount(tx.amount)} USDt
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          {/* Yield Positions */}
          <Panel title="Yield Positions" icon={<TrendingUp className="w-4 h-4 text-purple-400" />}>
            {treasury.yieldPositions.length === 0 ? (
              <EmptyState text="No active yield positions" />
            ) : (
              <div className="divide-y divide-gray-800">
                {treasury.yieldPositions.map((pos: YieldPosition, i: number) => (
                  <div
                    key={i}
                    className="py-4 flex items-center justify-between hover:bg-gray-800/10 transition-colors px-2 rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                       <div className="w-8 h-8 rounded-full bg-purple-900/30 flex items-center justify-center border border-purple-500/20">
                          <TrendingUp className="w-4 h-4 text-purple-400" />
                       </div>
                       <div>
                        <p className="text-sm font-medium text-white capitalize">
                          {pos.protocol}
                        </p>
                        <p className="text-xs text-purple-400 font-medium">
                          {formatPercentage(pos.apy)} APY
                        </p>
                      </div>
                    </div>
                    <span className="text-sm font-semibold text-white">
                      {formatAmount(pos.amount)} USDt
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Panel>

        </div>

        {/* Right: Decision Audit Trail */}
        <div className="lg:col-span-1 space-y-6">
           <DecisionTimeline decisions={decisions} />
        </div>
      </div>

      {/* ── Innovation: Revenue-Backed Lending + Debt Restructuring ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Panel title="Revenue-Backed Lending" icon={<TrendingUp className="w-4 h-4 text-green-400" />}>
          {!revenueSummary || (revenueSummary as any).totalRevenue === '0' ? (
            <div className="text-center space-y-3">
              <EmptyState text="No revenue events tracked yet" />
              <p className="text-xs text-gray-500 mt-1">Revenue events are tracked automatically when agents earn from tasks, yield, or services</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-700">
                  <p className="text-xs text-gray-500 uppercase">Total Revenue</p>
                  <p className="text-lg font-bold text-green-400">{formatAmount((revenueSummary as any).totalRevenue)} USDt</p>
                </div>
                <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-700">
                  <p className="text-xs text-gray-500 uppercase">Tracked Agents</p>
                  <p className="text-lg font-bold text-white">{(revenueSummary as any).agents?.length ?? 0}</p>
                </div>
              </div>
              {((revenueSummary as any).agents ?? []).map((a: any) => (
                <div key={a.agentAddress} className="bg-gray-900/30 rounded-lg p-3 border border-gray-700/50 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-mono text-gray-400">{a.agentAddress.slice(0, 8)}...{a.agentAddress.slice(-6)}</span>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${a.revenueVelocity >= 0 ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}>
                      {a.revenueVelocity >= 0 ? '↑' : '↓'} {(a.revenueVelocity * 100).toFixed(0)}% velocity
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div><p className="text-[10px] text-gray-500">24h</p><p className="text-xs text-white font-semibold">{formatAmount(a.revenue24h)}</p></div>
                    <div><p className="text-[10px] text-gray-500">7d</p><p className="text-xs text-white font-semibold">{formatAmount(a.revenue7d)}</p></div>
                    <div><p className="text-[10px] text-gray-500">Borrow Cap</p><p className="text-xs text-green-400 font-semibold">{formatAmount(a.borrowCapacity)}</p></div>
                  </div>
                  <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                    <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${Math.min(a.consistency * 100, 100)}%` }} />
                  </div>
                  <p className="text-[10px] text-gray-500 text-right">Consistency: {(a.consistency * 100).toFixed(0)}%</p>
                </div>
              ))}

            </div>
          )}
        </Panel>

        <Panel title="Autonomous Debt Restructuring" icon={<Shield className="w-4 h-4 text-amber-400" />}>
          {!restructuringSummary || (restructuringSummary as any).totalProposals === 0 ? (
            <div className="text-center space-y-2">
              <EmptyState text="No restructuring proposals yet" />
              <p className="text-xs text-gray-500">ML detects at-risk loans → LLM negotiates new terms autonomously</p>
              <div className="flex justify-center gap-2 mt-2">
                <span className="text-[10px] bg-gray-700 text-gray-400 px-2 py-1 rounded-full">ML Default Prediction</span>
                <span className="text-[10px] bg-gray-700 text-gray-400 px-2 py-1 rounded-full">LLM Negotiation</span>
                <span className="text-[10px] bg-gray-700 text-gray-400 px-2 py-1 rounded-full">Auto-Accept</span>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-amber-900/20 rounded-lg p-3 border border-amber-700/30 text-center">
                  <p className="text-xs text-gray-500">Proposed</p>
                  <p className="text-lg font-bold text-amber-400">{(restructuringSummary as any).pending}</p>
                </div>
                <div className="bg-green-900/20 rounded-lg p-3 border border-green-700/30 text-center">
                  <p className="text-xs text-gray-500">Accepted</p>
                  <p className="text-lg font-bold text-green-400">{(restructuringSummary as any).accepted}</p>
                </div>
                <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-700 text-center">
                  <p className="text-xs text-gray-500">Forgiven</p>
                  <p className="text-lg font-bold text-purple-400">{formatAmount((restructuringSummary as any).totalForgivenAmount ?? '0')} USDt</p>
                </div>
              </div>
              <p className="text-xs text-gray-400 text-center">Total proposals: {(restructuringSummary as any).totalProposals} • Declined: {(restructuringSummary as any).declined} • Expired: {(restructuringSummary as any).expired}</p>
            </div>
          )}
        </Panel>
      </div>

      {/* ── Bonus Features Section ── */}
      <BonusFeatures />

      {/* Loading overlay */}
      {isLoading && !data && (
        <div className="fixed inset-0 bg-gray-950/80 flex items-center justify-center z-50">
          <div className="flex flex-col items-center gap-3">
            <RefreshCw className="w-8 h-8 text-green-400 animate-spin" />
            <p className="text-sm text-gray-400">
              Connecting to agents...
            </p>
          </div>
        </div>
      )}

    </div>
  );
}

/* ── Reusable helper components ──────────────────────── */

function KPICard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl p-5 hover:bg-gray-750 transition-colors shadow-sm">
      <div className="flex items-center gap-3 mb-3">
        {icon}
        <span className="text-xs text-gray-400 uppercase tracking-widest font-semibold">
          {label}
        </span>
      </div>
      <p className="text-2xl font-black text-white tracking-tight">{value}</p>
      <p className="text-xs text-gray-500 mt-2 font-medium">{sub}</p>
    </div>
  );
}

function Panel({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden shadow-sm flex flex-col">
      <div className="px-5 py-4 border-b border-gray-700 flex items-center gap-2 bg-gray-800/80">
        {icon}
        <h3 className="text-sm font-semibold text-gray-200">{title}</h3>
      </div>
      <div className="p-5 flex-1">{children}</div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="py-8 flex flex-col items-center justify-center text-center">
       <div className="w-12 h-12 rounded-full bg-gray-800/50 flex items-center justify-center mb-3">
          <Activity className="w-5 h-5 text-gray-600" />
       </div>
       <p className="text-sm font-medium text-gray-500">{text}</p>
    </div>
  );
}


