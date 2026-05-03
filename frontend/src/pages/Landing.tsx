import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
  Shield,
  LineChart,
  ArrowRight,
  Activity,
  Brain,
  Lock,
  Globe,
  ExternalLink,
  CheckCircle2,
  TrendingUp,
  Users,
  MessageSquare,
  Layers,
  ArrowRightLeft,
} from 'lucide-react';
import { apiUrl } from '../utils/api';

// Live stats from backend
function useLiveStats() {
  const [stats, setStats] = useState<{
    balance: string;
    loans: number;
    profiles: number;
    yieldPositions: number;
    decisions: number;
    healthy: boolean;
  } | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [dashRes, healthRes] = await Promise.all([
          fetch(apiUrl('/api/dashboard')).catch(() => null),
          fetch(apiUrl('/health')).catch(() => null),
        ]);
        const dash = dashRes?.ok ? await dashRes.json() : null;
        const health = healthRes?.ok ? await healthRes.json() : null;
        const d = dash?.data ?? dash;
        setStats({
          balance: d?.treasury?.balance ?? '0',
          loans: d?.activeLoans?.length ?? 0,
          profiles: d?.creditProfiles?.length ?? 0,
          yieldPositions: d?.treasury?.yieldPositions?.length ?? 0,
          decisions: d?.agentDecisions?.length ?? 0,
          healthy: health?.status === 'ok' || !!d,
        });
      } catch { /* offline — stats stay null */ }
    };
    load();
  }, []);

  return stats;
}

// On-chain proofs (real Arbiscan txs)
const ON_CHAIN_PROOFS = [
  { label: 'AGENT_ROLE grant (Vault)', tx: '0x26bb7311729c8e50a7ffad327932c76781d4d8dd631d25c631a51d4432a6eb02' },
  { label: 'EXECUTOR_ROLE grant (Vault)', tx: '0x8ecf85df9f9a15f73a67b193052e044016d7da93305e27cb3d0fc4f2ed603ee3' },
  { label: 'USDt approve → Aave V3', tx: '0x46f7966bd2055e22273e6d3870232a2e630612d57b8e629ea8225585fd9d4bdc' },
  { label: 'USDt supply → Aave V3', tx: '0x2cccf89dfe2c17599dd1644e8e92c265d8218c9e3f5d730fe61a871b4c6d7152' },
  { label: 'Cross-chain bridge (LayerZero)', tx: '0x55efb23ec8bfc027d75abcb44e12a25624e5306f0140c169c09930760fd69efb' },
];

const CONTRACTS = [
  { label: 'TreasuryVault', address: '0x5503e9d53592B7D896E135804637C1710bDD5A64' },
  { label: 'CreditLine', address: '0x236AB6D30F70D7aB6c272aCB3b186D925Bcae1a0' },
];

export default function Landing() {
  const stats = useLiveStats();
  const balanceUSDt = stats ? (Number(stats.balance) / 1e6) : null;

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {/* Navbar */}
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield className="w-8 h-8 text-green-400" />
            <div>
              <h1 className="text-xl font-bold tracking-tight">
                Quorum <span className="text-green-400">AI</span>
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {stats?.healthy && (
              <span className="hidden sm:inline-flex items-center gap-1.5 text-xs text-green-400 bg-green-500/10 border border-green-500/20 rounded-full px-3 py-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                Live
              </span>
            )}
            <Link
              to="/dashboard"
              className="inline-flex items-center justify-center rounded-lg bg-green-500/10 px-4 py-2 text-sm font-medium text-green-400 border border-green-500/20 hover:bg-green-500/20 transition-colors"
            >
              Launch App
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 pt-16 pb-12 relative overflow-hidden">
        {/* Background glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-green-900/20 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute top-1/3 left-1/4 w-[400px] h-[400px] bg-cyan-900/10 rounded-full blur-[100px] pointer-events-none" />

        <div className="relative z-10 max-w-4xl mx-auto text-center space-y-6">
          <h2 className="text-5xl sm:text-7xl font-extrabold tracking-tight leading-tight">
            Quorum <br/>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-emerald-600">
              Autonomous CFO for DAOs
            </span>
          </h2>
          
          <p className="text-xl sm:text-2xl text-gray-400 max-w-3xl mx-auto leading-relaxed">
            3 AI agents that <strong className="text-white">hold, lend, and manage USDt on-chain</strong> without human intervention — powered by OpenClaw
          </p>

          {/* Live stats bar */}
          <div className="flex flex-wrap items-center justify-center gap-4 pt-4">
            <StatPill label="TVL" value={balanceUSDt !== null ? `$${balanceUSDt.toLocaleString()} USDt` : '...'} color="cyan" />
            <StatPill label="AI Agents" value="3" color="emerald" />
            <StatPill label="Contract Tests" value="31" color="blue" />
            <StatPill label="MCP Tools" value="15" color="purple" />
            <StatPill label="On-Chain Proofs" value={String(ON_CHAIN_PROOFS.length)} color="green" />
          </div>

          <div className="pt-6 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              to="/dashboard"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-green-500 px-8 py-4 text-base font-bold text-gray-950 hover:bg-green-400 transition-all hover:scale-105 active:scale-95 shadow-[0_0_30px_-5px_var(--color-green-500)]"
            >
              Enter Dashboard
              <ArrowRight className="w-5 h-5" />
            </Link>
          </div>
        </div>
      </main>

      {/* 3-Agent Architecture Section */}
      <section className="bg-gray-950 py-20 border-t border-gray-900 relative">
        <div className="max-w-7xl mx-auto px-4 z-10 relative">
          <div className="text-center mb-14">
            <h3 className="text-3xl font-bold text-white mb-3">3-Agent Architecture</h3>
            <p className="text-gray-400 max-w-2xl mx-auto">Three autonomous AI agents that debate, decide, and execute — all on-chain with real USDt.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <AgentCard
              icon={<Shield className="w-7 h-7 text-cyan-400" />}
              title="Treasury Agent"
              subtitle="Yield & Risk Management"
              items={['Aave V3 yield optimization', 'Multi-sig withdrawals + 1h timelock', 'Daily volume caps (10k USDt)', 'Emergency pause (Guardian role)']}
              color="cyan"
            />
            <AgentCard
              icon={<LineChart className="w-7 h-7 text-emerald-400" />}
              title="Credit Agent"
              subtitle="Scoring & Lending"
              items={['On-chain credit scoring (500–1000)', '3-tier lending: 5% / 10% / 15% APR', 'ML default prediction (logistic regression)', 'Auto-repayment tracking + penalty interest']}
              color="emerald"
            />
            <AgentCard
              icon={<Brain className="w-7 h-7 text-amber-400" />}
              title="Risk Agent"
              subtitle="Compliance & Oversight"
              items={['Systemic risk monitoring', 'Board Meeting debate participant', 'Portfolio protection advisory', 'Regulatory compliance checks']}
              color="amber"
            />
          </div>
        </div>
      </section>

      {/* Bonus / Innovation Features */}
      <section className="bg-gray-900/30 py-20 border-t border-gray-800">
        <div className="max-w-7xl mx-auto px-4">
          <div className="text-center mb-14">
            <span className="text-xs font-bold uppercase tracking-widest text-purple-400 mb-2 block">Beyond Requirements</span>
            <h3 className="text-3xl font-bold text-white mb-3">Innovation Features</h3>
            <p className="text-gray-400 max-w-2xl mx-auto">Advanced autonomous finance capabilities — implemented and working.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            <FeatureCard icon={<Brain className="w-6 h-6 text-blue-400" />} title="ML Default Prediction" description="Logistic regression model predicts loan default probability (0–100%) using 7 on-chain features. Auto-blocks critical risk (>60%)." />
            <FeatureCard icon={<Lock className="w-6 h-6 text-purple-400" />} title="ZK Credit Proofs" description='Prove credit tier ("≥ 800 = Excellent") without revealing exact score. SHA-256 commitments + Fiat-Shamir + replay prevention.' />
            <FeatureCard icon={<ArrowRightLeft className="w-6 h-6 text-indigo-400" />} title="Inter-Agent Lending" description="Credit Agent borrows from Treasury via EventBus. Up to 20% of vault balance per request with full tracking." />
            <FeatureCard icon={<MessageSquare className="w-6 h-6 text-pink-400" />} title="Board Meetings (LLM)" description="Every 45s, all 3 agents debate capital allocation, risk, and strategy. 4 LLM turns → synthesized consensus." />
            <FeatureCard icon={<TrendingUp className="w-6 h-6 text-green-400" />} title="Revenue-Backed Lending" description="AI agents borrow against future earnings — invoice factoring for the agent economy. 50% of projected 30d revenue." />
            <FeatureCard icon={<Layers className="w-6 h-6 text-amber-400" />} title="Debt Restructuring" description="ML detects at-risk loans → LLM negotiates new terms (extend, reduce rate, forgiveness, tranches). Fully autonomous." />
            <FeatureCard icon={<Globe className="w-6 h-6 text-teal-400" />} title="Cross-Chain Bridge" description="Compares Aave APY across Arbitrum/Ethereum/Polygon. Bridges USDt0 via LayerZero when remote yield is ≥1.5% better." />
            <FeatureCard icon={<Users className="w-6 h-6 text-yellow-400" />} title="Idle Capital Detection" description="Reads vault balance on-chain, detects idle capital, lowers score threshold, proactively extends up to 3 loans per cycle." />
            <FeatureCard icon={<Activity className="w-6 h-6 text-red-400" />} title="Penalty & Credit Freeze" description="Tiered penalty interest (+5/10/15%). Defaulters get credit frozen — score -200, available credit zeroed until resolved." />
          </div>
        </div>
      </section>

      {/* On-Chain Proof Section */}
      <section className="bg-gray-950 py-20 border-t border-gray-800">
        <div className="max-w-5xl mx-auto px-4">
          <div className="text-center mb-12">
            <span className="text-xs font-bold uppercase tracking-widest text-green-400 mb-2 block">Verified On-Chain</span>
            <h3 className="text-3xl font-bold text-white mb-3">Real Transactions</h3>
            <p className="text-gray-400 max-w-xl mx-auto">Every key operation verified on-chain — not simulated, not mocked.</p>
          </div>

          {/* Contracts */}
          <div className="flex flex-wrap gap-3 justify-center mb-8">
            {CONTRACTS.map((c) => (
              <a
                key={c.address}
                href={`https://explorer.mantle.xyz/address/${c.address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gray-900 border border-gray-700 hover:border-green-500/40 transition-colors group"
              >
                <span className="text-sm font-medium text-gray-300 group-hover:text-white">{c.label}</span>
                <code className="text-xs font-mono text-gray-500 group-hover:text-green-400 transition-colors">{c.address.slice(0, 6)}...{c.address.slice(-4)}</code>
                <ExternalLink className="w-3 h-3 text-gray-600 group-hover:text-green-400" />
              </a>
            ))}
          </div>

          {/* Transaction proofs */}
          <div className="space-y-2">
            {ON_CHAIN_PROOFS.map((proof) => (
              <a
                key={proof.tx}
                href={`https://explorer.mantle.xyz/tx/${proof.tx}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between gap-4 px-5 py-3.5 rounded-xl bg-gray-900/50 border border-gray-800 hover:border-green-500/30 hover:bg-gray-900/80 transition-all group"
              >
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                  <span className="text-sm font-medium text-gray-200">{proof.label}</span>
                </div>
                <div className="flex items-center gap-2">
                  <code className="text-xs font-mono text-gray-500 group-hover:text-green-400 transition-colors hidden sm:inline">
                    {proof.tx.slice(0, 10)}...{proof.tx.slice(-8)}
                  </code>
                  <ExternalLink className="w-3 h-3 text-gray-600 group-hover:text-green-400 flex-shrink-0" />
                </div>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* Tech Stack */}
      <section className="bg-gray-900/30 py-16 border-t border-gray-800">
        <div className="max-w-5xl mx-auto px-4">
          <div className="text-center mb-10">
            <h3 className="text-2xl font-bold text-white mb-2">Tech Stack</h3>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {[
              { label: 'OpenClaw', highlight: true },
              { label: 'Mantle Network', highlight: false },
              { label: 'Solidity 0.8.20', highlight: false },
              { label: 'Foundry (31 tests)', highlight: false },
              { label: 'TypeScript', highlight: false },
              { label: 'Node.js + Express', highlight: false },
              { label: 'React 18 + Vite', highlight: false },
              { label: 'WebSocket (real-time)', highlight: false },
              { label: 'SQLite WAL', highlight: false },
              { label: 'Aave V3', highlight: false },
              { label: 'LayerZero (bridge)', highlight: false },
              { label: 'Groq LLaMA 3.3 70B', highlight: false },
              { label: 'MCP Server (15 tools)', highlight: false },
              { label: 'ethers.js v6', highlight: false },
              { label: 'Recharts', highlight: false },
              { label: 'Tailwind CSS', highlight: false },
              { label: 'Cloudflare Pages', highlight: false },
            ].map((tech) => (
              <span
                key={tech.label}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  tech.highlight
                    ? 'bg-green-500/10 border border-green-500/30 text-green-400'
                    : 'bg-gray-900 border border-gray-800 text-gray-400 hover:border-gray-700 hover:text-gray-300'
                }`}
              >
                {tech.label}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-800 mt-auto bg-gray-950">
        <div className="max-w-7xl mx-auto px-4 py-6 flex flex-col sm:flex-row items-center justify-between text-sm text-gray-500 gap-4">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-gray-600" />
            <span>Quorum &copy; 2026</span>
          </div>
          <div className="flex items-center gap-4">
            <span>Quorum — Autonomous DAO CFO on Mantle</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ── Helper Components ── */

function StatPill({ label, value, color }: { label: string; value: string; color: string }) {
  const colorMap: Record<string, string> = {
    cyan: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
    emerald: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    blue: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
    purple: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
    green: 'text-green-400 bg-green-500/10 border-green-500/20',
  };
  return (
    <div className={`flex items-center gap-2 px-4 py-2 rounded-full border ${colorMap[color] ?? colorMap.cyan}`}>
      <span className="text-xs text-gray-500 uppercase font-semibold">{label}</span>
      <span className="text-sm font-bold">{value}</span>
    </div>
  );
}

function AgentCard({ icon, title, subtitle, items, color }: { icon: React.ReactNode; title: string; subtitle: string; items: string[]; color: string }) {
  const borderMap: Record<string, string> = {
    cyan: 'hover:border-cyan-500/40',
    emerald: 'hover:border-emerald-500/40',
    amber: 'hover:border-amber-500/40',
  };
  const dotMap: Record<string, string> = {
    cyan: 'bg-cyan-500',
    emerald: 'bg-emerald-500',
    amber: 'bg-amber-500',
  };
  return (
    <div className={`bg-gray-900/50 border border-gray-800 rounded-2xl p-7 transition-all group ${borderMap[color] ?? ''}`}>
      <div className="flex items-center gap-3 mb-4">
        <div className="w-12 h-12 rounded-xl bg-gray-950 border border-gray-800 flex items-center justify-center group-hover:scale-110 transition-transform">
          {icon}
        </div>
        <div>
          <h4 className="text-lg font-bold text-white">{title}</h4>
          <p className="text-xs text-gray-500">{subtitle}</p>
        </div>
      </div>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2 text-sm text-gray-400">
            <span className={`w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0 ${dotMap[color] ?? 'bg-gray-500'}`} />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-6 hover:bg-gray-900/80 hover:border-gray-700 transition-all group">
      <div className="w-11 h-11 rounded-lg bg-gray-950 border border-gray-800 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
        {icon}
      </div>
      <h4 className="text-base font-semibold text-white mb-2">{title}</h4>
      <p className="text-sm text-gray-400 leading-relaxed">{description}</p>
    </div>
  );
}
