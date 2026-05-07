import { useEffect, useRef, useState } from 'react';
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
  CalendarClock,
  Lock,
} from 'lucide-react';
import { AgentChat } from '../components/AgentChat';
import { FundFlowDiagram } from '../components/FundFlowDiagram';
import { DecisionTimeline } from '../components/DecisionTimeline';
import { ToastStack } from '../components/ToastStack';
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
const DUMMY_BORROWER_ADDRESS = '0x0000000000000000000000000000000000000001';

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

  // Next Board Meeting countdown — synced to server dialogue interval (300s)
  const [lastDialogueAt, setLastDialogueAt] = useState<number>(0);
  const [meetingSecsLeft, setMeetingSecsLeft] = useState(300);
  useEffect(() => {
    const t = setInterval(() => {
      if (lastDialogueAt === 0) {
        setMeetingSecsLeft(300);
        return;
      }
      const elapsed = Math.floor((Date.now() - lastDialogueAt) / 1000);
      const remaining = 300 - (elapsed % 300);
      setMeetingSecsLeft(remaining);
    }, 1000);
    return () => clearInterval(t);
  }, [lastDialogueAt]);

  // Inline confirm for Emergency Pause
  const [confirmingPause, setConfirmingPause] = useState(false);

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
      // Seed dialogue rounds from REST + sync board meeting countdown
      if (data.dialogueRounds?.length && !dialogueRounds?.length) {
        setDialogueRounds(data.dialogueRounds);
        const lastRound = data.dialogueRounds[data.dialogueRounds.length - 1];
        if (lastRound?.timestamp) setLastDialogueAt(lastRound.timestamp);
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

      // Seed dialogue rounds from WS initial payload + sync countdown
      if (msg.data.dialogueRounds?.length) {
        setDialogueRounds(msg.data.dialogueRounds);
        const lastRound = msg.data.dialogueRounds[msg.data.dialogueRounds.length - 1];
        if (lastRound?.timestamp) setLastDialogueAt(lastRound.timestamp);
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
      // Reset board meeting countdown on dialogue events
      const evtType = (msg.data as { type?: string }).type;
      if (evtType === 'dialogue:turn' || evtType === 'dialogue:consensus') {
        setLastDialogueAt(Date.now());
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
  const activeLoans = (data?.activeLoans ?? []).filter(
    (loan) => loan.borrower.toLowerCase() !== DUMMY_BORROWER_ADDRESS
  );
  
  // Prepare Credit Score Distribution data
  const scoreDistribution = [
    { name: 'Poor (<600)', count: 0, color: '#f87171' },
    { name: 'Fair (600-699)', count: 0, color: '#fbbf24' },
    { name: 'Good (700-799)', count: 0, color: '#38bdf8' },
    { name: 'Excellent (800+)', count: 0, color: '#818cf8' },
  ];
  
  if (data?.creditProfiles) {
    data.creditProfiles.forEach(p => {
      if (p.score < 600) scoreDistribution[0].count++;
      else if (p.score < 700) scoreDistribution[1].count++;
      else if (p.score < 800) scoreDistribution[2].count++;
      else scoreDistribution[3].count++;
    });
  }

  // Onboarding banner (dismiss once per session)
  const [showOnboarding, setShowOnboarding] = useState(() => !sessionStorage.getItem('onboarding-dismissed'));

  return (
    <div className="space-y-6 animate-in fade-in duration-500">

      {/* ── First-Visit Onboarding Banner ── */}
      {showOnboarding && (
        <div className="relative flex flex-col gap-4 rounded-2xl border border-indigo-500/25 bg-slate-900/60 p-5 sm:flex-row sm:items-center">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-indigo-500/30 bg-indigo-500/10">
            <Shield className="h-5 w-5 text-indigo-300" />
          </div>
          <div className="flex-1">
            <p className="mb-0.5 text-sm font-semibold text-slate-100">Dashboard overview</p>
            <p className="text-xs leading-relaxed text-slate-400">
              Three agents coordinate treasury allocation, credit decisions, and risk monitoring on Mantle.
              The <strong className="text-indigo-300">Board Meeting</strong> timer marks the next structured consensus cycle.
              KPI tiles summarize vault balances and portfolio exposure — tap <span className="rounded border border-slate-600 bg-slate-800 px-1 font-mono text-[10px] text-slate-300">?</span> on any metric for context.
            </p>
          </div>
          <button
            type="button"
            onClick={() => { setShowOnboarding(false); sessionStorage.setItem('onboarding-dismissed', '1'); }}
            className="shrink-0 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-400 transition-colors hover:border-slate-600 hover:text-white"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ── Next Board Meeting Countdown ── */}
      <div className={`flex flex-col gap-4 rounded-2xl border px-5 py-4 transition-all duration-300 sm:flex-row sm:items-center ${
        meetingSecsLeft <= 30
          ? 'border-indigo-400/40 bg-indigo-950/40 shadow-[0_0_24px_-8px_rgba(99,102,241,0.35)]'
          : 'border-slate-800 bg-slate-900/60'
      }`}>
        <div className="flex flex-1 items-center gap-3">
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border ${meetingSecsLeft <= 30 ? 'border-indigo-400/50 bg-indigo-500/20 countdown-glow' : 'border-slate-700 bg-slate-800'}`}>
            <CalendarClock className={`h-4 w-4 ${meetingSecsLeft <= 30 ? 'text-indigo-200' : 'text-slate-400'}`} />
          </div>
          <div>
            <p className={`text-xs font-semibold uppercase tracking-widest ${meetingSecsLeft <= 30 ? 'text-indigo-200' : 'text-slate-500'}`}>
              {meetingSecsLeft <= 30 ? 'Board meeting starting' : 'Next board meeting'}
            </p>
            <p className="text-[11px] text-slate-500">Treasury, Credit, and Risk align before on-chain execution.</p>
          </div>
        </div>
        <div className={`font-mono text-4xl font-semibold tabular-nums tracking-tight ${meetingSecsLeft <= 30 ? 'text-indigo-100' : 'text-white'}`}>
          {String(Math.floor(meetingSecsLeft / 60)).padStart(2, '0')}
          <span className="text-2xl opacity-60">:</span>
          {String(meetingSecsLeft % 60).padStart(2, '0')}
        </div>
        <div className="hidden flex-col items-end gap-1 text-[10px] text-slate-500 sm:flex">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-indigo-400/70" />Treasury</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-sky-400/70" />Credit</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400/70" />Risk</span>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-2">
         <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3">
              <Link to="/" className="inline-flex items-center gap-1.5 text-xs text-slate-500 transition-colors hover:text-indigo-300">
                <ArrowLeft className="w-3.5 h-3.5" /> Home
              </Link>
              <h2 className="text-2xl font-semibold tracking-tight text-gradient-brand">Dashboard</h2>
            </div>
            <div className="flex items-center gap-3">
              <p className="text-sm text-slate-400">Live treasury health and agent activity</p>
               <div className="h-4 w-px bg-slate-800" />
               <AgentStatus status={agentStatus} wsConnected={isConnected || !!data} />
               <div className="h-4 w-px bg-slate-800" />
               <span className="font-mono text-[11px] tabular-nums text-slate-500">
                 Updated {secondsAgo}s ago
               </span>
            </div>
         </div>
         {/* Quick Actions Panel */}
         <div className="flex gap-3">
             <button
               type="button"
               onClick={syncTreasury}
               disabled={syncing}
               className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:border-slate-600 hover:bg-slate-800 disabled:opacity-50"
             >
               <RefreshCw className={`h-4 w-4 text-indigo-300 ${syncing ? 'animate-spin' : ''}`} />
               {syncing ? 'Syncing...' : 'Sync treasury'}
             </button>
             {confirmingPause ? (
               <div className="flex animate-in items-center gap-2 rounded-lg border border-red-500/35 bg-red-950/40 px-3 py-2 fade-in duration-150">
                 <span className="text-xs font-medium text-red-200">Pause all agents?</span>
                 <button
                   type="button"
                   onClick={() => { pauseAgents(); setConfirmingPause(false); }}
                   className="rounded bg-red-600 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-red-500"
                 >
                   Confirm
                 </button>
                 <button
                   type="button"
                   onClick={() => setConfirmingPause(false)}
                   className="px-2 py-1 text-xs text-slate-400 transition-colors hover:text-white"
                 >
                   Cancel
                 </button>
               </div>
             ) : (
               <button
                 type="button"
                 onClick={() => setConfirmingPause(true)}
                 className="inline-flex items-center gap-2 rounded-lg border border-red-500/25 bg-red-950/30 px-4 py-2 text-sm font-medium text-red-300 transition-colors hover:border-red-400/40 hover:bg-red-950/50"
               >
                 <PauseCircle className="h-4 w-4" />
                 Emergency pause
               </button>
             )}
         </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-3 rounded-xl border border-red-800/60 bg-red-950/40 p-4">
          <AlertTriangle className="h-5 w-5 shrink-0 text-red-400" />
          <span className="text-sm text-red-200">{error}</span>
          <button
            type="button"
            onClick={refresh}
            className="ml-auto inline-flex items-center gap-1 text-xs text-red-300 hover:text-red-200"
          >
            <RefreshCw className="h-3 w-3" /> Retry
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          icon={<DollarSign className="h-5 w-5 text-indigo-300" />}
          label="Treasury Balance"
          tooltip="Total USDt held in the TreasuryVault smart contract on Mantle. Real on-chain capital managed by AI agents."
          value={`$${(Number(treasury.balance) / 1e6).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} USDt`}
          sub="Vault holdings"
        />
        <KPICard
          icon={<BarChart3 className="h-5 w-5 text-sky-300" />}
          label="Daily Volume"
          tooltip="Total USDt moved in/out of the vault today — deposits, loan disbursements, and yield harvests combined."
          value={`$${(Number(treasury.dailyVolume) / 1e6).toLocaleString('en-US')} USDt`}
          sub="In / Out today"
        />
        <KPICard
          icon={<TrendingUp className="h-5 w-5 text-teal-300" />}
          label="Yield Positions"
          tooltip="Active yield strategies (Aave V3). Treasury Agent auto-compounds returns. APY = annual percentage yield."
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
          icon={<Users className="h-5 w-5 text-amber-300" />}
          label="Credit Profiles"
          tooltip="Unique borrower wallets scored by the Credit Agent. Scores 500–1000 determine loan eligibility and interest rate."
          value={String(data?.creditProfiles?.length ?? 0)}
          sub={`${activeLoans.length} active loans`}
        />
      </div>

      {/* Treasury Health */}
      <div className="grid grid-cols-1 gap-4">
        {/* Health Score */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <Shield className="h-5 w-5" style={{ color: healthData ? (healthData.score >= 80 ? '#818cf8' : healthData.score >= 60 ? '#fbbf24' : healthData.score >= 40 ? '#fb923c' : '#f87171') : '#64748b' }} />
            <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">Treasury health score</span>
          </div>
          <div className="flex flex-wrap items-center gap-6">
            <div className="flex items-baseline gap-2">
              <span className="text-5xl font-semibold tabular-nums" style={{ color: healthData ? (healthData.score >= 80 ? '#818cf8' : healthData.score >= 60 ? '#fbbf24' : healthData.score >= 40 ? '#fb923c' : '#f87171') : '#64748b' }}>
                {healthData?.score ?? '—'}
              </span>
              <span className="text-lg font-medium text-slate-500">/100</span>
            </div>
            <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wider ${
              !healthData ? 'border-slate-700 bg-slate-800 text-slate-400'
              : healthData.score >= 80 ? 'border-indigo-500/35 bg-indigo-500/15 text-indigo-200'
              : healthData.score >= 60 ? 'border-amber-500/35 bg-amber-500/15 text-amber-200'
              : healthData.score >= 40 ? 'border-orange-500/35 bg-orange-500/15 text-orange-200'
              : 'border-red-500/35 bg-red-500/15 text-red-200'
            }`}>
              {healthData?.rating ?? 'Loading...'}
            </span>
            {/* Health bar */}
            <div className="hidden flex-1 sm:block">
              <div className="h-3 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full transition-all duration-1000 ease-out"
                  style={{
                    width: `${healthData?.score ?? 0}%`,
                    backgroundColor: healthData ? (healthData.score >= 80 ? '#818cf8' : healthData.score >= 60 ? '#fbbf24' : healthData.score >= 40 ? '#fb923c' : '#f87171') : '#64748b'
                  }}
                />
              </div>
              {healthData?.breakdown && (
                <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-slate-500">
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
        <Panel title="Treasury balance (last 24 updates)" icon={<Activity className="h-4 w-4 text-indigo-300" />}>
          <div className="h-[250px] w-full pt-4">
            {balanceHistory.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={balanceHistory} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorBalance" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#818cf8" stopOpacity={0.35}/>
                      <stop offset="95%" stopColor="#818cf8" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
                  <XAxis dataKey="time" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `$${value}`} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '0.5rem', color: '#f1f5f9' }}
                    itemStyle={{ color: '#a5b4fc' }}
                  />
                  <Area type="monotone" dataKey="balance" stroke="#818cf8" strokeWidth={2} fillOpacity={1} fill="url(#colorBalance)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
               <div className="h-full flex items-center justify-center">
                 <EmptyState text="Waiting for initial data..." />
               </div>
            )}
          </div>
        </Panel>
        
        <Panel title="Credit score distribution" icon={<BarChart3 className="h-4 w-4 text-sky-300" />}>
            <div className="h-[250px] w-full pt-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={scoreDistribution} margin={{ top: 5, right: 0, left: 0, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
                <XAxis dataKey="name" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} angle={-15} textAnchor="end" />
                <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip 
                  cursor={{ fill: '#334155', opacity: 0.35 }}
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '0.5rem', color: '#f1f5f9' }}
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
        <FundFlowDiagram treasury={treasury} loanCount={activeLoans.length} />
      </div>

      {/* Main Content Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Treasury + Credit panels */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Active Loans */}
          <Panel title="Active loans" icon={<Users className="h-4 w-4 text-indigo-300" />}>
            {activeLoans.length === 0 ? (
              <EmptyState text="No active loans" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 text-xs uppercase text-slate-500">
                      <th className="py-2 text-left">Borrower</th>
                      <th className="py-2 text-right">Principal</th>
                      <th className="py-2 text-right">Rate</th>
                      <th className="py-2 text-right">Due</th>
                      <th className="py-2 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {activeLoans.map((loan) => {
                      const now = Date.now() / 1000;
                      const isOverdue = loan.dueDate < now;
                      const overdueDays = isOverdue ? Math.ceil((now - loan.dueDate) / 86400) : 0;
                      return (
                      <tr key={loan.id} className={`transition-colors hover:bg-slate-900/50 ${loan.creditFrozen ? 'opacity-60' : ''}`}>
                        <td className="py-3 font-mono text-slate-300">
                          <div className="flex items-center gap-2">
                            {loan.borrower.slice(0, 6)}...{loan.borrower.slice(-4)}
                            {loan.loanType === 'revenue_backed' && (
                              <span className="rounded-full bg-indigo-500/15 px-1.5 py-0.5 text-[9px] font-medium text-indigo-200">REV</span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 text-right font-medium text-white">
                          {formatAmount(loan.principal)} USDt
                        </td>
                        <td className="py-3 text-right text-slate-400">
                          <div>
                            {formatPercentage(loan.interestRate / 100)}
                            {loan.penaltyRateBps ? (
                              <span className="text-[10px] text-red-400 block">+{(loan.penaltyRateBps / 100).toFixed(0)}% penalty</span>
                            ) : null}
                          </div>
                        </td>
                        <td className="py-3 text-right text-slate-400">
                          {new Date(loan.dueDate * 1000).toLocaleDateString()}
                        </td>
                        <td className="py-3 text-right">
                          {loan.creditFrozen ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-red-950/50 px-2 py-1 text-[10px] font-semibold text-red-300 ring-1 ring-red-500/30">
                              <Lock className="h-3 w-3" /> Frozen
                            </span>
                          ) : isOverdue ? (
                            <div>
                              <span className="rounded-full bg-amber-950/40 px-2 py-1 text-[10px] font-semibold text-amber-200 ring-1 ring-amber-500/25">{overdueDays}d overdue</span>
                              {loan.penaltyAccrued && BigInt(loan.penaltyAccrued) > 0n && (
                                <p className="text-[9px] text-red-400 mt-1">+{formatAmount(loan.penaltyAccrued)} penalty</p>
                              )}
                            </div>
                          ) : (
                            <span className="rounded-full bg-indigo-950/40 px-2 py-1 text-[10px] font-semibold text-indigo-200 ring-1 ring-indigo-500/25">Current</span>
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
          <Panel title="Pending transactions (multi-sig)" icon={<Wallet className="h-4 w-4 text-indigo-300" />}>
            {treasury.pendingTransactions.length === 0 ? (
              <EmptyState text="No pending transactions" />
            ) : (
              <div className="divide-y divide-slate-800">
                {treasury.pendingTransactions.map((tx: PendingTransaction) => (
                  <div
                    key={tx.txHash}
                    className="flex items-center justify-between rounded-lg px-2 py-4 transition-colors hover:bg-slate-900/40"
                  >
                    <div className="flex items-center gap-3">
                       <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-800">
                          <CheckCircle2 className="h-4 w-4 text-slate-500" />
                       </div>
                       <div>
                        <p className="font-mono text-sm text-slate-300">
                          {tx.to.slice(0, 6)}...{tx.to.slice(-4)}
                        </p>
                        <p className="text-xs text-slate-500">
                          {tx.signatures} sig(s) &middot;{' '}
                          <span className={tx.executed ? 'text-indigo-300' : 'text-amber-300'}>
                            {tx.executed ? 'Executed' : 'Pending'}
                          </span>
                        </p>
                      </div>
                    </div>
                    <span className="rounded-full border border-slate-800 bg-slate-950 px-3 py-1 text-sm font-semibold text-white">
                      {formatAmount(tx.amount)} USDt
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          {/* Yield Positions */}
          <Panel title="Yield positions" icon={<TrendingUp className="h-4 w-4 text-teal-300" />}>
            {treasury.yieldPositions.length === 0 ? (
              <EmptyState text="No active yield positions" />
            ) : (
              <div className="divide-y divide-slate-800">
                {treasury.yieldPositions.map((pos: YieldPosition, i: number) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-lg px-2 py-4 transition-colors hover:bg-slate-900/40"
                  >
                    <div className="flex items-center gap-3">
                       <div className="flex h-8 w-8 items-center justify-center rounded-full border border-teal-500/25 bg-teal-950/40">
                          <TrendingUp className="h-4 w-4 text-teal-300" />
                       </div>
                       <div>
                        <p className="text-sm font-medium text-white capitalize">
                          {pos.protocol}
                        </p>
                        <p className="text-xs font-medium text-teal-300">
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
        <Panel title="Revenue-backed lending" icon={<TrendingUp className="h-4 w-4 text-indigo-300" />}>
          {!revenueSummary || (revenueSummary as any).totalRevenue === '0' ? (
            <div className="text-center space-y-3">
              <EmptyState text="No revenue events tracked yet" />
              <p className="mt-1 text-xs text-slate-500">Revenue events are inferred from agent activity, yield, and fee flows.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                  <p className="text-xs uppercase text-slate-500">Total revenue</p>
                  <p className="text-lg font-semibold text-indigo-200">{formatAmount((revenueSummary as any).totalRevenue)} USDt</p>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                  <p className="text-xs uppercase text-slate-500">Tracked agents</p>
                  <p className="text-lg font-bold text-white">{(revenueSummary as any).agents?.length ?? 0}</p>
                </div>
              </div>
              {((revenueSummary as any).agents ?? []).map((a: any) => (
                <div key={a.agentAddress} className="space-y-2 rounded-lg border border-slate-800/80 bg-slate-950/40 p-3">
                  <div className="flex justify-between items-center">
                    <span className="font-mono text-xs text-slate-400">{a.agentAddress.slice(0, 8)}...{a.agentAddress.slice(-6)}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${a.revenueVelocity >= 0 ? 'bg-indigo-500/15 text-indigo-200' : 'bg-red-950/50 text-red-300'}`}>
                      {a.revenueVelocity >= 0 ? '↑' : '↓'} {(a.revenueVelocity * 100).toFixed(0)}% velocity
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div><p className="text-[10px] text-slate-500">24h</p><p className="text-xs font-semibold text-white">{formatAmount(a.revenue24h)}</p></div>
                    <div><p className="text-[10px] text-slate-500">7d</p><p className="text-xs font-semibold text-white">{formatAmount(a.revenue7d)}</p></div>
                    <div><p className="text-[10px] text-slate-500">Borrow cap</p><p className="text-xs font-semibold text-indigo-200">{formatAmount(a.borrowCapacity)}</p></div>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
                    <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${Math.min(a.consistency * 100, 100)}%` }} />
                  </div>
                  <p className="text-right text-[10px] text-slate-500">Consistency: {(a.consistency * 100).toFixed(0)}%</p>
                </div>
              ))}

            </div>
          )}
        </Panel>

        <Panel title="Debt restructuring" icon={<Shield className="h-4 w-4 text-amber-300" />}>
          {!restructuringSummary || (restructuringSummary as any).totalProposals === 0 ? (
            <div className="text-center space-y-2">
              <EmptyState text="No restructuring proposals yet" />
              <p className="text-xs text-slate-500">At-risk loans trigger structured term negotiation before write-down.</p>
              <div className="mt-2 flex flex-wrap justify-center gap-2">
                <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-1 text-[10px] text-slate-400">ML screening</span>
                <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-1 text-[10px] text-slate-400">LLM negotiation</span>
                <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-1 text-[10px] text-slate-400">Auto-accept</span>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border border-amber-500/25 bg-amber-950/30 p-3 text-center">
                  <p className="text-xs text-slate-500">Proposed</p>
                  <p className="text-lg font-semibold text-amber-200">{(restructuringSummary as any).pending}</p>
                </div>
                <div className="rounded-lg border border-indigo-500/25 bg-indigo-950/30 p-3 text-center">
                  <p className="text-xs text-slate-500">Accepted</p>
                  <p className="text-lg font-semibold text-indigo-200">{(restructuringSummary as any).accepted}</p>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-center">
                  <p className="text-xs text-slate-500">Forgiven</p>
                  <p className="text-lg font-semibold text-sky-200">{formatAmount((restructuringSummary as any).totalForgivenAmount ?? '0')} USDt</p>
                </div>
              </div>
              <p className="text-center text-xs text-slate-400">Total proposals: {(restructuringSummary as any).totalProposals} • Declined: {(restructuringSummary as any).declined} • Expired: {(restructuringSummary as any).expired}</p>
            </div>
          )}
        </Panel>
      </div>


      {/* Loading overlay */}
      {isLoading && !data && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md">
          <div className="glass-card flex flex-col items-center gap-4 px-10 py-8">
            <div className="brand-glow flex h-14 w-14 items-center justify-center rounded-2xl">
              <RefreshCw className="h-6 w-6 animate-spin text-indigo-200" />
            </div>
            <div className="flex flex-col items-center gap-1">
              <p className="text-sm font-semibold text-slate-200">Connecting to agents</p>
              <p className="text-[11px] text-slate-500">Loading treasury, credit & risk feeds…</p>
            </div>
          </div>
        </div>
      )}

      {/* Live event toasts */}
      <ToastStack lastMessage={lastMessage} />

    </div>
  );
}

/* ── Reusable helper components ──────────────────────── */

function KPICard({
  icon,
  label,
  value,
  sub,
  tooltip,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  tooltip?: string;
}) {
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);

  return (
    <div className="group glass-tile p-5">
      <div className="mb-3 flex items-center gap-3">
        {icon}
        <span className="flex-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {label}
        </span>
        {tooltip && (
          <div className={`tooltip-wrap ${isTooltipOpen ? 'tooltip-open' : ''}`}>
            <button
              type="button"
              className="flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-slate-600 bg-slate-800 text-[9px] font-bold text-slate-400 transition-colors hover:border-slate-500 hover:text-slate-200"
              aria-label={`Explain ${label}`}
              aria-expanded={isTooltipOpen}
              onClick={() => setIsTooltipOpen((v) => !v)}
              onBlur={() => setIsTooltipOpen(false)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setIsTooltipOpen(false);
                }
              }}
            >
              ?
            </button>
            <div className="tooltip-box">{tooltip}</div>
          </div>
        )}
      </div>
      <p className="text-2xl font-semibold tracking-tight text-white"><AnimatedValue value={value} /></p>
      <p className="mt-2 text-xs font-medium text-slate-500">{sub}</p>
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
    <div className="flex flex-col overflow-hidden glass-card">
      <div className="flex items-center gap-2 border-b border-slate-800/60 bg-slate-950/30 px-5 py-4">
        {icon}
        <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
      </div>
      <div className="flex-1 p-5">{children}</div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="py-8 flex flex-col items-center justify-center text-center">
       <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-slate-800 bg-slate-950/50">
          <Activity className="h-5 w-5 text-slate-600" />
       </div>
       <p className="text-sm font-medium text-slate-500">{text}</p>
    </div>
  );
}

/**
 * AnimatedValue — animates from previous to current numeric value when it changes.
 * Falls back to plain text if value is non-numeric.
 */
function AnimatedValue({ value, duration = 600 }: { value: string; duration?: number }) {
  const [displayed, setDisplayed] = useState<string>(value);
  const prevNumRef = useRef<number | null>(null);

  useEffect(() => {
    // Try to extract a leading number; preserve prefix/suffix (e.g. "$1,234.56 USDt", "12 USDt")
    const match = value.match(/^(\D*)([\d,]+(?:\.\d+)?)(.*)$/);
    if (!match) {
      setDisplayed(value);
      prevNumRef.current = null;
      return;
    }
    const prefix = match[1];
    const suffix = match[3];
    const target = parseFloat(match[2].replace(/,/g, ''));
    if (Number.isNaN(target)) {
      setDisplayed(value);
      return;
    }
    const start = prevNumRef.current ?? 0;
    if (start === target) {
      setDisplayed(value);
      prevNumRef.current = target;
      return;
    }
    const startTime = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - startTime) / duration);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      const current = start + (target - start) * eased;
      const formatted = Number.isInteger(target) && Math.abs(target) >= 1
        ? Math.round(current).toLocaleString()
        : current.toLocaleString(undefined, { maximumFractionDigits: 2 });
      setDisplayed(`${prefix}${formatted}${suffix}`);
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        prevNumRef.current = target;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return <span>{displayed}</span>;
}


