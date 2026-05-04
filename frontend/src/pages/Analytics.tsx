import { useEffect, useState } from 'react';
import {
  LineChart as LineChartIcon,
  PieChart as PieChartIcon,
  BarChart3,
  TrendingUp,
  Activity,
  Zap,
  History,
  Server,
} from 'lucide-react';
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
  PieChart,
  Pie,
} from 'recharts';
import { useDashboard } from '../hooks/useDashboard';
import { formatAmount } from '../utils/format';
import type { AgentDecision } from '../types';

/** Normalize raw EventBus events into AgentDecision shape */
const normalizeDecision = (raw: Record<string, unknown>): AgentDecision => {
  if (raw.action && raw.agentType) return raw as unknown as AgentDecision;
  return {
    id: (raw.id as string) || `${raw.type || 'event'}-${raw.timestamp || Date.now()}`,
    agentType: (raw.agentType || raw.source || 'treasury') as AgentDecision['agentType'],
    action: (raw.action || raw.type || 'unknown') as string,
    reasoning: (raw.reasoning || '') as string,
    data: (raw.data || raw.payload || {}) as Record<string, unknown>,
    txHash: raw.txHash as string | undefined,
    status: (raw.status || 'executed') as AgentDecision['status'],
    timestamp: (raw.timestamp || Date.now()) as number,
  };
};

import { apiUrl } from '../utils/api';

export default function Analytics() {
  const { data } = useDashboard();
  
  // Need to fetch full decision log for historical agent performance
  const [historicalDecisions, setHistoricalDecisions] = useState<AgentDecision[]>([]);
  const [opportunities, setOpportunities] = useState<any[]>([]);
  const [treasuryHistory, setTreasuryHistory] = useState<Array<{ timestamp: number; balance: number; volume: number; yieldTotal: number }>>([]);
  
  useEffect(() => {
     fetch(apiUrl('/api/decisions?limit=100'))
       .then(res => res.json())
       .then(data => {
          if (data.success && data.data) {
             setHistoricalDecisions(data.data.map((d: Record<string, unknown>) => normalizeDecision(d)));
          }
       })
       .catch(console.error);

     fetch(apiUrl('/api/yield/opportunities'))
       .then(res => res.json())
       .then(data => {
          if (data.success && data.data) {
             setOpportunities(data.data);
          }
       })
       .catch(console.error);

     fetch(apiUrl('/api/treasury/history'))
       .then(res => res.json())
       .then(data => {
          if (data.success && data.data) {
             setTreasuryHistory(data.data);
          }
       })
       .catch(console.error);
  }, []);

  const treasury = data?.treasury;
  const creditProfiles = data?.creditProfiles || [];
  const loans = data?.activeLoans || [];
  
  // Combine real-time decisions with historical for better metrics
  const allDecisions = [
       ...(data?.agentDecisions || []).map(d => normalizeDecision(d as unknown as Record<string, unknown>)),
       ...historicalDecisions,
     ]
       // Deduplicate by ID
       .filter((v,i,a)=>a.findIndex(v2=>(v2.id===v.id))===i);

  // --- Chart Data Preparation ---

  // 1. Treasury Balance History — downsample to ~1 point per hour
  const currentBalance = treasury ? Number(treasury.balance) / 1e6 : 0;
  const downsampleHourly = (data: typeof treasuryHistory) => {
    if (data.length === 0) return [];
    const hourMs = 3600_000;
    const result: typeof data = [data[0]];
    let lastTs = data[0].timestamp;
    for (let i = 1; i < data.length; i++) {
      if (data[i].timestamp - lastTs >= hourMs) {
        result.push(data[i]);
        lastTs = data[i].timestamp;
      }
    }
    // Always include the last point
    if (result[result.length - 1] !== data[data.length - 1]) {
      result.push(data[data.length - 1]);
    }
    return result;
  };

  const sampled = downsampleHourly(treasuryHistory);
  const treasuryHistoryData = sampled.length > 0
    ? sampled.map(h => ({
        day: new Date(h.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
        balance: h.balance,
      }))
    : [{ day: 'Now', balance: currentBalance }];

  // 2. Daily Volume — aggregate per day, compute from balance deltas if backend volume is 0
  const aggregateVolumeByDay = (data: typeof treasuryHistory) => {
    const byDay = new Map<string, number>();
    for (let i = 0; i < data.length; i++) {
      const key = new Date(data[i].timestamp).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
      // Use recorded volume if available, otherwise detect from balance delta
      let vol = data[i].volume;
      if (vol === 0 && i > 0) {
        const delta = Math.abs(data[i].balance - data[i - 1].balance);
        if (delta > 0.001) vol = delta;
      }
      byDay.set(key, (byDay.get(key) || 0) + vol);
    }
    return Array.from(byDay.entries()).map(([day, volume]) => ({ day, volume: Math.round(volume * 100) / 100 }));
  };
  const currentVolume = treasury ? Number(treasury.dailyVolume) / 1e6 : 0;
  const volumeData = treasuryHistory.length > 0
    ? aggregateVolumeByDay(treasuryHistory)
    : [{ day: 'Now', volume: currentVolume }];

  // 3. Yield Performance — combine active positions + known opportunities
  const activeYield = (treasury?.yieldPositions || []).map(p => ({
    protocol: p.protocol ? p.protocol.split(' ')[0] : 'Unknown',
    apy: p.apy,
    amount: Number(p.amount) / 1e6,
    active: true,
  }));
  const oppYield = opportunities
    .filter(o => !activeYield.some(a => a.protocol.toLowerCase() === o.protocol.toLowerCase()))
    .map(o => ({
      protocol: o.protocol.charAt(0).toUpperCase() + o.protocol.slice(1),
      apy: typeof o.apy === 'number' && o.apy < 1 ? o.apy * 100 : o.apy,
      amount: 0,
      active: false,
    }));
  const yieldData = [...activeYield, ...oppYield];

  // 4. Credit System Stats
  let totalLent = 0;
  let totalRepaid = 0;
  let totalDefaulted = 0; // Compute defaults from real loan data
  
  loans.forEach(l => {
     totalLent += Number(l.principal) / 1e6;
     totalRepaid += Number(l.repaid) / 1e6;
     // If due date passed and not fully repaid, consider default
     if (l.dueDate * 1000 < Date.now() && Number(l.repaid) < Number(l.totalDue)) {
        totalDefaulted += (Number(l.totalDue) - Number(l.repaid)) / 1e6;
     }
  });

  const creditStatsData = [
    { name: 'Active Lent', value: totalLent - totalRepaid, color: '#3b82f6' }, // blue-500
    { name: 'Repaid', value: totalRepaid, color: '#22c55e' }, // green-500
    { name: 'Defaulted', value: totalDefaulted, color: '#ef4444' }, // red-500
  ].filter(d => d.value > 0);

  // Agent Performance Metrics
  const now = Date.now();
  const last24h = allDecisions.filter(d => now - d.timestamp < 86400000);
  const decisionsPerHour = last24h.length / 24;
  const successCount = last24h.filter(d => d.status === 'executed').length;
  const successRate = last24h.length > 0 ? (successCount / last24h.length) * 100 : 0;
  
  // Calculate average score
  const avgScore = creditProfiles.length > 0 
    ? creditProfiles.reduce((acc, p) => acc + p.score, 0) / creditProfiles.length 
    : 0;

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-2">
         <div>
            <h2 className="text-2xl font-bold text-white tracking-tight">System Analytics</h2>
            <p className="text-sm text-gray-400">Deep dive into Quorum performance and metrics.</p>
         </div>
      </div>

      {/* Top Level KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
         <KPICard 
           icon={<Activity className="w-5 h-5 text-purple-400" />}
           label="Agent Actions (24h)"
           value={last24h.length.toString()}
           sub={`${decisionsPerHour.toFixed(1)} actions / hour`}
         />
         <KPICard 
           icon={<CheckCircle2 className="w-5 h-5 text-green-400" />}
           label="Agent Success Rate"
           value={`${successRate.toFixed(1)}%`}
           sub={`${successCount} successful executions`}
         />
         <KPICard 
           icon={<Zap className="w-5 h-5 text-yellow-400" />}
           label="Avg Credit Score"
           value={avgScore.toFixed(0)}
           sub={`Across ${creditProfiles.length} profiles`}
         />
         <KPICard 
           icon={<PieChartIcon className="w-5 h-5 text-blue-400" />}
           label="Total Lent"
           value={`${formatAmount(totalLent)} USDt`}
           sub={`Repaid: ${formatAmount(totalRepaid)} USDt`}
         />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Treasury Balance Over Time */}
        <Panel title="Treasury Balance (7 Days)" icon={<LineChartIcon className="w-4 h-4 text-green-400" />}>
           <div className="h-[300px] w-full pt-4">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={treasuryHistoryData} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorTreasury" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#4ade80" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#4ade80" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1f2937" />
                  <XAxis dataKey="day" stroke="#4b5563" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="#4b5563" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(val) => `$${val >= 1000 ? (val/1000).toFixed(0)+'k' : val}`} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#111827', borderColor: '#1f2937', borderRadius: '0.5rem', color: '#fff' }}
                    itemStyle={{ color: '#4ade80' }}
                    formatter={(val: number) => [`$${val.toFixed(2)}`, 'Balance']}
                  />
                  <Area type="monotone" dataKey="balance" stroke="#4ade80" strokeWidth={2} fillOpacity={1} fill="url(#colorTreasury)" />
                </AreaChart>
              </ResponsiveContainer>
           </div>
        </Panel>

        {/* Daily Volume */}
        <Panel title="Daily Transaction Volume" icon={<BarChart3 className="w-4 h-4 text-blue-400" />}>
           <div className="h-[300px] w-full pt-4">
              {volumeData.every(d => d.volume === 0) ? (
                 <div className="h-full flex items-center justify-center text-sm text-gray-500">
                    No transaction volume recorded yet. Deposits and withdrawals will appear here.
                 </div>
              ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={volumeData} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1f2937" />
                  <XAxis dataKey="day" stroke="#4b5563" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="#4b5563" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(val) => `$${val >= 1000 ? (val/1000).toFixed(0)+'k' : val}`} />
                  <Tooltip 
                    cursor={{ fill: '#1f2937', opacity: 0.4 }}
                    contentStyle={{ backgroundColor: '#111827', borderColor: '#1f2937', borderRadius: '0.5rem', color: '#fff' }}
                    itemStyle={{ color: '#60a5fa' }}
                    formatter={(val: number) => [`$${val.toFixed(2)}`, 'Volume']}
                  />
                  <Bar dataKey="volume" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              )}
           </div>
        </Panel>

        {/* Yield Performance */}
        <Panel title="Yield Protocol APY Comparison" icon={<TrendingUp className="w-4 h-4 text-purple-400" />}>
           <div className="h-[300px] w-full pt-4">
              {yieldData.length > 0 ? (
                 <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={yieldData} margin={{ top: 20, right: 20, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1f2937" />
                      <XAxis dataKey="protocol" stroke="#4b5563" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis stroke="#4b5563" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(val) => `${val}%`} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#111827', borderColor: '#1f2937', borderRadius: '0.5rem', color: '#fff' }}
                        formatter={(val: number, _name: string, entry: any) => [
                          `${val.toFixed(2)}%`,
                          entry.payload.active ? 'Active APY' : 'Available APY'
                        ]}
                      />
                      <Bar dataKey="apy" radius={[4, 4, 0, 0]}>
                        {yieldData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.active ? '#c084fc' : '#6b7280'} fillOpacity={entry.active ? 1 : 0.5} />
                        ))}
                      </Bar>
                    </BarChart>
                 </ResponsiveContainer>
              ) : (
                 <div className="h-full flex items-center justify-center text-sm text-gray-500">
                    No active yield positions to compare.
                 </div>
              )}
           </div>
        </Panel>

        {/* Credit System Stats */}
        <Panel title="Credit Ledger Distribution" icon={<PieChartIcon className="w-4 h-4 text-gray-400" />}>
           <div className="h-[300px] w-full pt-4 flex items-center justify-center">
              {creditStatsData.length > 0 ? (
                 <div className="w-full h-full flex flex-col sm:flex-row items-center">
                    <div className="flex-1 h-full min-h-[200px]">
                       <ResponsiveContainer width="100%" height="100%">
                         <PieChart>
                           <Pie
                             data={creditStatsData}
                             cx="50%"
                             cy="50%"
                             innerRadius={60}
                             outerRadius={80}
                             paddingAngle={5}
                             dataKey="value"
                             stroke="none"
                           >
                             {creditStatsData.map((entry, index) => (
                               <Cell key={`cell-${index}`} fill={entry.color} />
                             ))}
                           </Pie>
                           <Tooltip 
                             contentStyle={{ backgroundColor: '#111827', borderColor: '#1f2937', borderRadius: '0.5rem', color: '#fff' }}
                             formatter={(val: number) => [`$${val.toFixed(2)}`, 'Amount']}
                           />
                         </PieChart>
                       </ResponsiveContainer>
                    </div>
                    <div className="sm:w-1/3 flex flex-col justify-center gap-4 shrink-0">
                       {creditStatsData.map(stat => (
                          <div key={stat.name} className="flex items-center gap-2">
                             <div className="w-3 h-3 rounded-full" style={{ backgroundColor: stat.color }} />
                             <div>
                                <p className="text-xs text-gray-400">{stat.name}</p>
                                <p className="text-sm font-bold text-white">${formatAmount(stat.value)}</p>
                             </div>
                          </div>
                       ))}
                    </div>
                 </div>
              ) : (
                 <div className="text-sm text-gray-500">
                    No debt issued yet.
                 </div>
              )}
           </div>
        </Panel>
      </div>

      {/* Data Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
         {/* Agent Decision History */}
         <Panel title="Agent Decision History" icon={<History className="w-4 h-4 text-cyan-400" />}>
            <div className="overflow-x-auto max-h-[400px] custom-scrollbar">
               <table className="w-full text-sm text-left">
                  <thead className="text-xs text-gray-500 uppercase bg-gray-950/50 sticky top-0">
                     <tr>
                        <th className="px-4 py-3 font-semibold">Time</th>
                        <th className="px-4 py-3 font-semibold">Agent</th>
                        <th className="px-4 py-3 font-semibold">Action</th>
                        <th className="px-4 py-3 font-semibold">Status</th>
                     </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                     {allDecisions.length === 0 ? (
                        <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-500">No decisions recorded</td></tr>
                     ) : (
                        allDecisions.slice(0, 50).reverse().map((decision, i) => (
                           <tr key={decision.id || i} className="hover:bg-gray-800/30 transition-colors">
                              <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                                 {new Date(decision.timestamp).toLocaleTimeString()}
                              </td>
                              <td className="px-4 py-3">
                                 <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                                    decision.agentType === 'treasury' 
                                      ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20' 
                                      : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                 }`}>
                                    {decision.agentType}
                                 </span>
                              </td>
                              <td className="px-4 py-3 text-gray-300">
                                 {(decision.action || 'Unknown Action').replace(/_/g, ' ')}
                              </td>
                              <td className="px-4 py-3">
                                 <span className={
                                    decision.status === 'executed' ? 'text-green-400' :
                                    decision.status === 'failed' ? 'text-red-400' : 'text-yellow-400'
                                 }>
                                    {(decision.status || 'pending').charAt(0).toUpperCase() + (decision.status || 'pending').slice(1)}
                                 </span>
                              </td>
                           </tr>
                        ))
                     )}
                  </tbody>
               </table>
            </div>
         </Panel>

         {/* Yield Opportunities */}
         <Panel title="Yield Opportunities" icon={<Server className="w-4 h-4 text-purple-400" />}>
            <div className="overflow-x-auto max-h-[400px] custom-scrollbar">
               <table className="w-full text-sm text-left">
                  <thead className="text-xs text-gray-500 uppercase bg-gray-950/50 sticky top-0">
                     <tr>
                        <th className="px-4 py-3 font-semibold">Protocol</th>
                        <th className="px-4 py-3 font-semibold">Strategy</th>
                        <th className="px-4 py-3 font-semibold text-right">APY</th>
                        <th className="px-4 py-3 font-semibold text-right">Risk Score</th>
                     </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                     {opportunities.length === 0 ? (
                        <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-500">No opportunities detected</td></tr>
                     ) : (
                        opportunities.map((opp, i) => {
                           const riskScore = typeof opp.riskScore === 'number' ? opp.riskScore : (opp.risk === 'low' ? 20 : opp.risk === 'medium' ? 50 : opp.risk === 'high' ? 80 : 0);
                           const apyVal = typeof opp.apy === 'number' && opp.apy < 1 ? opp.apy * 100 : opp.apy;
                           return (
                           <tr key={i} className="hover:bg-gray-800/30 transition-colors">
                              <td className="px-4 py-3 font-medium text-white capitalize">
                                 {opp.protocol}
                              </td>
                              <td className="px-4 py-3 text-gray-400">
                                 {(opp.strategy || 'lending').replace(/_/g, ' ')}
                              </td>
                              <td className="px-4 py-3 text-right text-purple-400 font-medium">
                                 {apyVal.toFixed(2)}%
                              </td>
                              <td className="px-4 py-3 text-right">
                                 <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                    riskScore < 30 ? 'text-green-400' :
                                    riskScore < 60 ? 'text-yellow-400' : 'text-red-400'
                                 }`}>
                                    {riskScore}/100
                                 </span>
                              </td>
                           </tr>
                        )})
                     )}
                  </tbody>
               </table>
            </div>
         </Panel>
      </div>
    </div>
  );
}

function KPICard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-5 hover:bg-gray-800/50 transition-colors">
      <div className="flex items-center gap-3 mb-3">
        {icon}
        <span className="text-xs text-gray-400 uppercase tracking-widest font-semibold">{label}</span>
      </div>
      <p className="text-2xl font-black text-white tracking-tight">{value}</p>
      <p className="text-xs text-gray-500 mt-2 font-medium">{sub}</p>
    </div>
  );
}

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-xl overflow-hidden shadow-sm flex flex-col">
      <div className="px-5 py-4 border-b border-gray-800/80 flex items-center gap-2 bg-gray-950/20">
        {icon}
        <h3 className="text-sm font-semibold text-gray-200">{title}</h3>
      </div>
      <div className="p-5 flex-1">{children}</div>
    </div>
  );
}

function CheckCircle2(props: any) {
  return (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>
    </svg>
  );
}
