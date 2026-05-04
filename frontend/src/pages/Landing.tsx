import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
  Shield,
  LineChart,
  ArrowRight,
  Activity,
  Brain,
  Lock,
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

const EVIDENCE_LINKS = [
  {
    label: 'TreasuryVault contract (verified on Mantle)',
    href: 'https://mantlescan.xyz/address/0x51A80e33E227029bB201C4891B62Eb8530F223c3',
  },
  {
    label: 'CreditLine contract (verified on Mantle)',
    href: 'https://mantlescan.xyz/address/0xACd7fec284d6059FB1F151BD03AbaE3cB71dB18c',
  },
  {
    label: 'Live backend health endpoint (Railway)',
    href: 'https://mantle-treasury-ai-production.up.railway.app/health',
  },
  {
    label: 'Open-source repository',
    href: 'https://github.com/loquit-tud/mantle-treasury-ai',
  },
];

const CONTRACTS = [
  { label: 'TreasuryVault', address: '0x51A80e33E227029bB201C4891B62Eb8530F223c3' },
  { label: 'CreditLine', address: '0xACd7fec284d6059FB1F151BD03AbaE3cB71dB18c' },
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
        {/* Animated grid background */}
        <div className="hero-grid absolute inset-0 pointer-events-none" />
        {/* Background glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-green-900/20 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute top-1/3 left-1/4 w-[400px] h-[400px] bg-cyan-900/10 rounded-full blur-[100px] pointer-events-none" />

        <div className="relative z-10 max-w-4xl mx-auto text-center space-y-6">
          {/* Eyebrow */}
          <div className="animate-fade-in-up inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-green-500/10 border border-green-500/20 text-green-400 text-xs font-bold uppercase tracking-widest">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            Live on Mantle Mainnet
          </div>
          <h2 className="animate-fade-in-up animate-delay-100 text-5xl sm:text-7xl font-extrabold tracking-tight leading-tight">
            Quorum <br/>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-emerald-600">
              Autonomous CFO for DAOs
            </span>
          </h2>
          
          <p className="animate-fade-in-up animate-delay-200 text-xl sm:text-2xl text-gray-400 max-w-3xl mx-auto leading-relaxed">
            3 AI agents that <strong className="text-white">hold, lend, and manage USDt on-chain</strong> without human intervention — powered by OpenClaw
          </p>

          <div className="animate-fade-in-up animate-delay-300 flex flex-wrap items-center justify-center gap-3">
            <span className="px-3 py-1.5 rounded-full text-xs font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              AI & RWA Track · Path B (Application)
            </span>
            <span className="px-3 py-1.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              Asset Category: Tokenized credit instruments & revenue-backed lending
            </span>
            <span className="px-3 py-1.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
              Target Users: DAOs and on-chain operator teams
            </span>
          </div>

          <p className="text-sm sm:text-base text-gray-300 max-w-3xl mx-auto leading-relaxed">
            <span className="text-gray-500">One-line pitch:</span> Quorum tokenizes short-term credit instruments (revolving credit lines, revenue-backed loans) on Mantle — three AI agents manage origination, yield, and restructuring autonomously.
          </p>

          {/* Live stats bar */}
          <div className="flex flex-wrap items-center justify-center gap-4 pt-4">
            <StatPill label="TVL" value={balanceUSDt !== null ? `$${balanceUSDt.toLocaleString()} USDt` : '...'} color="cyan" />
            <StatPill label="AI Agents" value="3" color="emerald" />
            <StatPill label="Contract Tests" value="31" color="blue" />
            <StatPill label="MCP Tools" value="15" color="purple" />
            <StatPill label="Proof Links" value={String(EVIDENCE_LINKS.length)} color="green" />
          </div>

          <div className="animate-fade-in-up animate-delay-400 pt-6 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              to="/dashboard"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-green-500 px-8 py-4 text-base font-bold text-gray-950 hover:bg-green-400 transition-all hover:scale-105 active:scale-95 shadow-[0_0_30px_-5px_var(--color-green-500)]"
            >
              Enter Dashboard
              <ArrowRight className="w-5 h-5" />
            </Link>
            <a
              href="https://github.com/loquit-tud/mantle-treasury-ai"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-gray-900 border border-gray-700 px-6 py-4 text-sm font-semibold text-gray-200 hover:bg-gray-800 hover:border-gray-600 transition-colors"
            >
              Open-Source Repo
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        </div>
      </main>

      {/* ── Plain English / Accessibility Explainer ── */}
      <section className="bg-gradient-to-r from-gray-900 via-gray-900 to-gray-900 border-y border-gray-800 py-6">
        <div className="max-w-5xl mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center gap-6 justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center shrink-0">
                <span className="text-lg">💡</span>
              </div>
              <div>
                <p className="text-sm font-bold text-white">New to Web3? Simple version:</p>
                <p className="text-sm text-gray-400">Quorum is an <strong className="text-amber-400">automated bank manager</strong> for your DAO. Three AI advisors hold a boardroom vote every 5 min, then execute decisions on-chain — no human needed.</p>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 shrink-0">
              <div className="text-center px-4 py-2 rounded-lg bg-gray-800 border border-gray-700">
                <p className="text-xs text-gray-500 uppercase tracking-wider">No code needed</p>
                <p className="text-sm font-bold text-white">Connect &amp; watch</p>
              </div>
              <div className="text-center px-4 py-2 rounded-lg bg-gray-800 border border-gray-700">
                <p className="text-xs text-gray-500 uppercase tracking-wider">No risk to you</p>
                <p className="text-sm font-bold text-white">Read-only demo</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── How It Works ── */}
      <section className="bg-gray-950 py-20 border-b border-gray-800">
        <div className="max-w-5xl mx-auto px-4">
          <div className="text-center mb-14">
            <span className="text-xs font-bold uppercase tracking-widest text-green-400 mb-2 block">Step by Step</span>
            <h3 className="text-3xl font-bold text-white mb-3">How Quorum Works</h3>
            <p className="text-gray-400 max-w-xl mx-auto">Four simple steps from deposit to autonomous yield &amp; lending.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                step: '01',
                icon: '🏦',
                title: 'Deposit USDt',
                desc: 'Send USDt to the TreasuryVault smart contract on Mantle. Funds are secured by auditable Solidity code.',
                styles: {
                  card: 'hover:border-cyan-500/40',
                  iconWrap: 'bg-cyan-500/10 border-cyan-500/30',
                  badgeWrap: 'bg-cyan-500/20 border-cyan-500/40',
                  badgeText: 'text-cyan-400',
                },
              },
              {
                step: '02',
                icon: '🤖',
                title: 'Agents Analyse',
                desc: 'Treasury, Credit, and Risk agents read on-chain state every cycle and prepare proposals.',
                styles: {
                  card: 'hover:border-emerald-500/40',
                  iconWrap: 'bg-emerald-500/10 border-emerald-500/30',
                  badgeWrap: 'bg-emerald-500/20 border-emerald-500/40',
                  badgeText: 'text-emerald-400',
                },
              },
              {
                step: '03',
                icon: '🗳️',
                title: 'Board Meeting Vote',
                desc: '3 LLM-powered agents debate via structured turns. Consensus reached in ≤4 turns using Groq LLaMA.',
                styles: {
                  card: 'hover:border-purple-500/40',
                  iconWrap: 'bg-purple-500/10 border-purple-500/30',
                  badgeWrap: 'bg-purple-500/20 border-purple-500/40',
                  badgeText: 'text-purple-400',
                },
              },
              {
                step: '04',
                icon: '⛓️',
                title: 'Execute On-Chain',
                desc: 'Winning decision executed directly on Mantle. Every action is recorded as an immutable on-chain event.',
                styles: {
                  card: 'hover:border-amber-500/40',
                  iconWrap: 'bg-amber-500/10 border-amber-500/30',
                  badgeWrap: 'bg-amber-500/20 border-amber-500/40',
                  badgeText: 'text-amber-400',
                },
              },
            ].map((s, i) => (
              <div key={i} className={`relative flex flex-col items-center text-center p-6 rounded-2xl bg-gray-900/60 border border-gray-800 transition-all duration-300 hover:-translate-y-1 group ${s.styles.card}`}>
                <div className={`w-12 h-12 rounded-full border flex items-center justify-center text-2xl mb-4 group-hover:scale-110 transition-transform ${s.styles.iconWrap}`}>
                  {s.icon}
                </div>
                <div className={`absolute -top-3 -right-3 w-7 h-7 rounded-full border flex items-center justify-center ${s.styles.badgeWrap}`}>
                  <span className={`text-[10px] font-black ${s.styles.badgeText}`}>{s.step}</span>
                </div>
                <h4 className="text-sm font-bold text-white mb-2">{s.title}</h4>
                <p className="text-xs text-gray-400 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Track Alignment Section */}
      <section className="bg-gray-900/30 py-14 border-t border-gray-800">
        <div className="max-w-5xl mx-auto px-4">
          <div className="text-center mb-8">
            <span className="text-xs font-bold uppercase tracking-widest text-cyan-400 mb-2 block">Hackathon Alignment</span>
            <h3 className="text-3xl font-bold text-white mb-3">AI & RWA Track Checklist</h3>
            <p className="text-gray-400 max-w-2xl mx-auto">How Quorum maps to the track rubric: real asset context, Mantle deployment, and complete product delivery.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5">
              <p className="text-xs uppercase tracking-wider text-gray-500 mb-2">Path Selection</p>
              <p className="text-sm text-white font-semibold">Path B · AI Driven RWA Application</p>
              <p className="text-sm text-gray-400 mt-2">End-user-facing treasury app where AI agents manage lending, yield, and risk decisions on-chain.</p>
            </div>
            <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5">
              <p className="text-xs uppercase tracking-wider text-gray-500 mb-2">Real Asset Framing</p>
              <p className="text-sm text-white font-semibold">Tokenized credit instruments & revenue-backed receivables</p>
              <p className="text-sm text-gray-400 mt-2">On-chain revolving credit lines, invoice factoring (revenue-backed loans), and tiered fixed-income products — real-world financial primitives brought on-chain via AI.</p>
            </div>
            <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5">
              <p className="text-xs uppercase tracking-wider text-gray-500 mb-2">Mantle Integration</p>
              <p className="text-sm text-white font-semibold">Production contracts deployed on Mantle Mainnet</p>
              <p className="text-sm text-gray-400 mt-2">TreasuryVault and CreditLine are live, verifiable, and linked below.</p>
            </div>
            <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5">
              <p className="text-xs uppercase tracking-wider text-gray-500 mb-2">Compliance Awareness</p>
              <p className="text-sm text-white font-semibold">KYC-ready scoring + auditable credit decisions</p>
              <p className="text-sm text-gray-400 mt-2">On-chain credit scoring (transparent formula), ZK proofs for privacy-preserving credit checks, ML default screening, and immutable decision logs for regulatory audit trails.</p>
            </div>
          </div>
        </div>
      </section>

      {/* RWA Real-World Equivalents */}
      <section className="bg-gray-950 py-14 border-t border-gray-800">
        <div className="max-w-5xl mx-auto px-4">
          <div className="text-center mb-8">
            <span className="text-xs font-bold uppercase tracking-widest text-amber-400 mb-2 block">Why This Is RWA</span>
            <h3 className="text-3xl font-bold text-white mb-3">Real-World Finance, On-Chain</h3>
            <p className="text-gray-400 max-w-2xl mx-auto">Every Quorum feature maps to a recognized traditional finance instrument — now autonomous and permissionless.</p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left py-3 px-4 text-gray-400 font-semibold">On-Chain Feature</th>
                  <th className="text-left py-3 px-4 text-gray-400 font-semibold">TradFi Equivalent</th>
                </tr>
              </thead>
              <tbody className="text-gray-300">
                {[
                  ['CreditLine loans (30-day, tiered APR)', 'Commercial paper / revolving credit facilities'],
                  ['Revenue-backed lending', 'Invoice factoring / accounts receivable financing'],
                  ['ML credit scoring (7 on-chain features)', 'Credit bureau scoring (FICO-equivalent for DAOs)'],
                  ['Tiered penalty interest', 'Late payment fees in commercial lending'],
                  ['Autonomous debt restructuring', 'Loan workouts (normally done by bank credit officers)'],
                  ['TreasuryVault yield allocation', 'Money market fund management'],
                  ['ZK credit proofs', 'Privacy-preserving credit checks ("soft pull")'],
                ].map(([onchain, tradfi], i) => (
                  <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-900/50">
                    <td className="py-3 px-4 font-medium text-white">{onchain}</td>
                    <td className="py-3 px-4 text-amber-400/80">{tradfi}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-center text-sm text-gray-500 mt-6 max-w-2xl mx-auto">
            DAOs need the same financial services as corporations — credit, yield, risk management — but lack the personnel. Quorum replaces treasury analysts, credit officers, and risk managers with autonomous AI agents operating 24/7 on-chain.
          </p>
        </div>
      </section>

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
            <FeatureCard icon={<MessageSquare className="w-6 h-6 text-pink-400" />} title="Board Meetings (LLM)" description="Every 5 minutes, all 3 agents debate capital allocation, risk, and strategy. 4 LLM turns → synthesized consensus." />
            <FeatureCard icon={<TrendingUp className="w-6 h-6 text-green-400" />} title="Revenue-Backed Lending" description="AI agents borrow against future earnings — invoice factoring for the agent economy. 50% of projected 30d revenue." />
            <FeatureCard icon={<Layers className="w-6 h-6 text-amber-400" />} title="Debt Restructuring" description="ML detects at-risk loans → LLM negotiates new terms (extend, reduce rate, forgiveness, tranches). Fully autonomous." />
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
            <h3 className="text-3xl font-bold text-white mb-3">Production Evidence</h3>
            <p className="text-gray-400 max-w-xl mx-auto">Track submission artifacts: verified contracts, live backend, and open-source repository.</p>
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

          {/* Track evidence links */}
          <div className="space-y-2">
            {EVIDENCE_LINKS.map((proof) => (
              <a
                key={proof.href}
                href={proof.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between gap-4 px-5 py-3.5 rounded-xl bg-gray-900/50 border border-gray-800 hover:border-green-500/30 hover:bg-gray-900/80 transition-all group"
              >
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                  <span className="text-sm font-medium text-gray-200">{proof.label}</span>
                </div>
                <div className="flex items-center gap-2">
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
