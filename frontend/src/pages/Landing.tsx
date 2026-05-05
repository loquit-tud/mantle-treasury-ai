import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  ExternalLink,
  Landmark,
  LineChart,
  Shield,
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
  const tvlLabel = balanceUSDt !== null ? `$${balanceUSDt.toLocaleString()} USDt` : 'Loading...';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-slate-950/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-indigo-500/30 bg-indigo-500/10">
              <Shield className="h-5 w-5 text-indigo-300" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Quorum</p>
              <p className="text-sm font-semibold text-slate-100">Treasury & credit prototype</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-2 rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs text-slate-300 sm:inline-flex">
              <span className={`h-1.5 w-1.5 rounded-full ${stats?.healthy ? 'bg-emerald-400' : 'bg-amber-400'}`} />
              {stats?.healthy ? 'Demo backend up' : 'Connecting…'}
            </span>
            <Link
              to="/dashboard"
              className="inline-flex items-center rounded-lg border border-indigo-400/30 bg-indigo-500/10 px-4 py-2 text-sm font-medium text-indigo-200 transition hover:bg-indigo-500/20"
            >
              Open Dashboard
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="border-b border-slate-800/70">
          <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:py-20">
            <div className="space-y-6">
              <p className="inline-flex items-center rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-indigo-200">
                Built on Mantle mainnet
              </p>
              <h1 className="text-4xl font-semibold leading-tight tracking-tight text-white sm:text-5xl">
                Automated treasury and lending you can try on Mantle.
              </h1>
              <p className="max-w-xl text-base leading-relaxed text-slate-300 sm:text-lg">
                Quorum wires three AI agents into treasury allocation, credit decisions, and risk checks — experimental software,
                executed on-chain so you can follow what happened and when.
              </p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Link
                  to="/dashboard"
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-indigo-400"
                >
                  Open live dashboard
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <a
                  href="https://github.com/loquit-tud/mantle-treasury-ai"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-5 py-3 text-sm font-semibold text-slate-200 transition hover:border-slate-600 hover:bg-slate-800"
                >
                  Review Source Code
                  <ExternalLink className="h-4 w-4" />
                </a>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-2xl shadow-slate-950/50">
              <div className="mb-4 flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-200">Live demo snapshot</p>
                <span className="rounded-full border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-400">Real-time API</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <StatItem label="Treasury TVL" value={tvlLabel} />
                <StatItem label="Active Loans" value={String(stats?.loans ?? 0)} />
                <StatItem label="Credit Profiles" value={String(stats?.profiles ?? 0)} />
                <StatItem label="Agent Decisions" value={String(stats?.decisions ?? 0)} />
              </div>
              <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950 p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-slate-500">One-line pitch</p>
                <p className="mt-2 text-sm leading-relaxed text-slate-300">
                  A small-stack demo: agents propose treasury moves and loans, then consensus gates what actually executes — useful for hackathons and learning, not a substitute for audits or legal advice.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-slate-800/70">
          <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
            <h2 className="text-2xl font-semibold text-white">How the three agents split the work</h2>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-400">
              Each agent has a narrow job; proposals meet in a board-style step before anything is sent on-chain — easier to reason about than one model doing everything.
            </p>
            <div className="mt-8 grid gap-4 md:grid-cols-3">
              <FeatureCard
                icon={<Landmark className="h-5 w-5 text-indigo-300" />}
                title="Treasury Agent"
                description="Allocates idle USDt to yield, enforces daily limits, and routes high-value withdrawals through multisig and timelock."
              />
              <FeatureCard
                icon={<LineChart className="h-5 w-5 text-indigo-300" />}
                title="Credit Agent"
                description="Runs on-chain scoring, evaluates repayment behavior, and prices debt with transparent risk tiers."
              />
              <FeatureCard
                icon={<BrainCircuit className="h-5 w-5 text-indigo-300" />}
                title="Risk Agent"
                description="Watches exposure, surfaces odd patterns, and can suggest restructuring paths before small issues snowball."
              />
            </div>
          </div>
        </section>

        <section className="border-b border-slate-800/70">
          <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
            <h2 className="text-2xl font-semibold text-white">Track alignment at a glance</h2>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
                <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Asset class</p>
                <p className="mt-2 text-sm font-semibold text-slate-100">Tokenized short-term credit instruments</p>
                <p className="mt-2 text-sm text-slate-400">Revenue-backed lending, revolving credit lines, and autonomous debt servicing.</p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
                <p className="text-xs uppercase tracking-[0.14em] text-slate-500">AI responsibility split</p>
                <p className="mt-2 text-sm font-semibold text-slate-100">Treasury, Credit, and Risk each own a distinct mandate</p>
                <p className="mt-2 text-sm text-slate-400">Board meetings create consensus before execution, reducing single-model bias.</p>
              </div>
            </div>
          </div>
        </section>

        <section>
          <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
            <h2 className="text-2xl font-semibold text-white">On-chain evidence</h2>
            <p className="mt-3 max-w-2xl text-sm text-slate-400">
              Contracts, backend health, and source — open for inspection.
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              {CONTRACTS.map((contract) => (
                <a
                  key={contract.address}
                  href={`https://mantlescan.xyz/address/${contract.address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-300 transition hover:border-indigo-400/40 hover:text-white"
                >
                  <span>{contract.label}</span>
                  <code className="text-xs text-slate-500">{contract.address.slice(0, 6)}...{contract.address.slice(-4)}</code>
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ))}
            </div>

            <div className="mt-6 space-y-2">
              {EVIDENCE_LINKS.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3 text-sm transition hover:border-slate-700 hover:bg-slate-900"
                >
                  <span className="flex items-center gap-2 text-slate-200">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    {link.label}
                  </span>
                  <ExternalLink className="h-4 w-4 text-slate-500" />
                </a>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
      <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-2 text-sm font-semibold text-slate-100">{value}</p>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <article className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg border border-indigo-500/25 bg-indigo-500/10">
        {icon}
      </div>
      <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-slate-400">{description}</p>
    </article>
  );
}
