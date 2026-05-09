import { Link } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  ExternalLink,
  GraduationCap,
  Landmark,
  LineChart,
  Shield,
  Sparkles,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { apiUrl } from '../utils/api';
import { useCursorGlow } from '../hooks/useCursorGlow';

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
    href: 'https://mantlescan.xyz/address/0xb52718aEc4Bc8459Ac97A276CB2d0798B25b17F0',
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
  { label: 'TreasuryVault', address: '0xb52718aEc4Bc8459Ac97A276CB2d0798B25b17F0' },
  { label: 'CreditLine', address: '0xACd7fec284d6059FB1F151BD03AbaE3cB71dB18c' },
];

export default function Landing() {
  const stats = useLiveStats();
  const balanceUSDt = stats ? (Number(stats.balance) / 1e6) : null;
  const tvlLabel = balanceUSDt !== null ? `$${balanceUSDt.toLocaleString()} USDt` : 'Loading...';

  return (
    <div className="min-h-screen text-slate-100 relative">
      <div className="app-mesh-bg" aria-hidden="true" />
      <header className="sticky top-0 z-40 border-b border-slate-800/60 bg-slate-950/60 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="brand-glow flex h-10 w-10 items-center justify-center rounded-xl">
              <Shield className="h-5 w-5 text-indigo-200" />
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Quorum</p>
              <p className="text-sm font-semibold text-gradient-brand">Treasury & credit prototype</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-2 rounded-full border border-slate-700/70 bg-slate-900/60 px-3 py-1 text-xs text-slate-300 backdrop-blur sm:inline-flex">
              {stats?.healthy ? <span className="live-dot" /> : <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />}
              {stats?.healthy ? 'Demo backend up' : 'Connecting…'}
            </span>
            <Link to="/dashboard" className="btn-pill-secondary">
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
              <h1 className="text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
                <span className="text-white">Automated treasury and lending,</span>{' '}
                <span className="text-gradient">live on Mantle.</span>
              </h1>
              <p className="max-w-xl text-base leading-relaxed text-slate-300 sm:text-lg">
                Quorum wires three AI agents into treasury allocation, credit decisions, and risk checks — experimental software,
                executed on-chain so you can follow what happened and when.
              </p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Link to="/dashboard" className="btn-pill-primary">
                  Open live dashboard
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link to="/dashboard?proof=1" className="btn-pill-secondary">
                  Run AI proof demo
                  <Sparkles className="h-4 w-4" />
                </Link>
                <Link to="/agents" className="btn-pill-secondary">
                  Agent leaderboard
                  <LineChart className="h-4 w-4" />
                </Link>
                <a
                  href="https://github.com/loquit-tud/mantle-treasury-ai"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-pill-secondary"
                >
                  Review Source Code
                  <ExternalLink className="h-4 w-4" />
                </a>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-slate-400">
                <span className="inline-flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900/50 px-3 py-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  No wallet needed to view the demo
                </span>
                <span className="inline-flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900/50 px-3 py-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />
                  Explorer links + audit trail included
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <div className="glass-card p-6">
                <div className="mb-5 flex items-center justify-between">
                  <p className="text-sm font-semibold text-slate-200">Live demo snapshot</p>
                  <span className="flex items-center gap-1.5 rounded-full border border-slate-700/60 bg-slate-950/60 px-2.5 py-1 text-[11px] text-slate-400">
                    <span className="live-dot" /> Real-time API
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <StatItem label="Treasury TVL" value={tvlLabel} numeric={balanceUSDt ?? undefined} prefix="$" suffix=" USDt" />
                  <StatItem label="Active Loans" value={String(stats?.loans ?? 0)} numeric={stats?.loans ?? 0} />
                  <StatItem label="Credit Profiles" value={String(stats?.profiles ?? 0)} numeric={stats?.profiles ?? 0} />
                  <StatItem label="Agent Decisions" value={String(stats?.decisions ?? 0)} numeric={stats?.decisions ?? 0} />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Beginner-first onboarding (progressive disclosure) */}
        <section className="border-b border-slate-800/70">
          <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="inline-flex items-center gap-2 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-200">
                  <GraduationCap className="h-3.5 w-3.5" /> Beginner-friendly
                </p>
                <h2 className="mt-3 text-2xl font-semibold text-white">Start here (2 minutes, judge-ready)</h2>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
                  Follow a safe path: view the live dashboard, run one AI proof action, then verify the transaction on the explorer.
                </p>
              </div>
              <Link to="/dashboard?proof=1" className="btn-pill-primary">
                Run AI proof now
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            <div className="mt-8 grid gap-4 md:grid-cols-3">
              <OnboardingCard
                step="Step 1"
                title="Open dashboard"
                desc="See status, KPIs, safety policy, and recent on-chain transactions (view-only)."
                ctaLabel="Go to dashboard"
                to="/dashboard"
              />
              <OnboardingCard
                step="Step 2"
                title="AI proof (preview → confirm)"
                desc="Trigger one AI-driven yield decision and get a verifiable explorer link."
                ctaLabel="Open AI proof"
                to="/dashboard?proof=1"
              />
              <OnboardingCard
                step="Step 3"
                title="Inspect agents + consensus"
                desc="Check reputation leaderboard and recent consensus rounds."
                ctaLabel="View agents"
                to="/agents"
              />
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

        <section className="border-b border-slate-800/70">
          <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
            <div className="mb-10 text-center">
              <p className="inline-flex items-center gap-1.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-200">
                <Sparkles className="h-3 w-3" /> How it works
              </p>
              <h2 className="mt-4 text-3xl font-semibold text-white sm:text-4xl">From idle capital to on-chain action in three beats</h2>
              <p className="mx-auto mt-3 max-w-2xl text-sm text-slate-400 sm:text-base">
                Every cycle, the agents debate, reach consensus, and the result is anchored on Mantle. No human in the loop for routine moves.
              </p>
            </div>

            <div className="grid items-start gap-4 md:grid-cols-3">
              <RevealStep
                index={1}
                icon={<BrainCircuit className="h-5 w-5 text-indigo-200" />}
                title="Agents propose"
                tone="indigo"
                description="Treasury, Credit and Risk each draft a position based on live on-chain data, scoring models and policy."
                tag="Stage 1 · Inputs"
              />
              <RevealStep
                index={2}
                icon={<Zap className="h-5 w-5 text-sky-200" />}
                title="Board reaches consensus"
                tone="sky"
                description="A short multi-turn debate. Disagreement is logged. Only proposals that satisfy every guardrail advance."
                tag="Stage 2 · Quorum"
              />
              <RevealStep
                index={3}
                icon={<ShieldCheck className="h-5 w-5 text-emerald-200" />}
                title="Executes on Mantle"
                tone="emerald"
                description="The signed transaction is broadcast. Receipts, reasoning and dissent are kept side-by-side for audit."
                tag="Stage 3 · Settlement"
              />
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
              <a
                href={apiUrl('/api/safety/policy')}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-300 transition hover:border-indigo-400/40 hover:text-white"
              >
                <span>Safety policy (JSON)</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
              <a
                href={apiUrl('/api/agents/reputation')}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-300 transition hover:border-indigo-400/40 hover:text-white"
              >
                <span>Agent reputation (JSON)</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
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

function OnboardingCard({
  step,
  title,
  desc,
  ctaLabel,
  to,
}: {
  step: string;
  title: string;
  desc: string;
  ctaLabel: string;
  to: string;
}) {
  const { ref, onPointerMove } = useCursorGlow<HTMLElement>();
  return (
    <article ref={ref} onPointerMove={onPointerMove} className="glass-card cursor-glow p-5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{step}</p>
      <h3 className="mt-2 text-base font-semibold text-white">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-slate-400">{desc}</p>
      <Link
        to={to}
        className="mt-4 inline-flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm font-semibold text-slate-200 transition hover:border-slate-700 hover:bg-slate-950/60"
      >
        {ctaLabel}
        <ArrowRight className="h-4 w-4 text-indigo-200" />
      </Link>
    </article>
  );
}

function StatItem({ label, value, numeric, prefix, suffix }: { label: string; value: string; numeric?: number; prefix?: string; suffix?: string }) {
  return (
    <div className="glass-tile p-3.5">
      <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-2 text-base font-semibold text-slate-100">
        {numeric !== undefined ? <AnimatedNumber target={numeric} prefix={prefix} suffix={suffix} /> : value}
      </p>
    </div>
  );
}

function AnimatedNumber({ target, prefix = '', suffix = '', duration = 900 }: { target: number; prefix?: string; suffix?: string; duration?: number }) {
  const [val, setVal] = useState(0);
  const fromRef = useRef(0);
  useEffect(() => {
    const start = fromRef.current;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const cur = start + (target - start) * eased;
      setVal(cur);
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  const display = Number.isInteger(target) && Math.abs(target) >= 10
    ? Math.round(val).toLocaleString()
    : val.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return <span>{prefix}{display}{suffix}</span>;
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
  const { ref, onPointerMove } = useCursorGlow<HTMLElement>();
  return (
    <article ref={ref} onPointerMove={onPointerMove} className="glass-card cursor-glow p-5 transition-transform duration-200 hover:-translate-y-0.5">
      <div className="brand-glow mb-3 flex h-10 w-10 items-center justify-center rounded-xl">
        {icon}
      </div>
      <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-slate-400">{description}</p>
    </article>
  );
}

function useReveal<T extends HTMLElement>(threshold = 0.2) {
  const ref = useRef<T | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setShown(true);
            obs.disconnect();
            break;
          }
        }
      },
      { threshold },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, shown };
}

const REVEAL_TONES: Record<string, { ring: string; chip: string; halo: string }> = {
  indigo: {
    ring: 'border-indigo-400/30 shadow-[0_24px_60px_-30px_rgba(99,102,241,0.6)]',
    chip: 'bg-indigo-500/15 text-indigo-200 border-indigo-400/40',
    halo: 'from-indigo-500/30 to-indigo-700/10',
  },
  sky: {
    ring: 'border-sky-400/30 shadow-[0_24px_60px_-30px_rgba(56,189,248,0.6)]',
    chip: 'bg-sky-500/15 text-sky-200 border-sky-400/40',
    halo: 'from-sky-500/30 to-sky-700/10',
  },
  emerald: {
    ring: 'border-emerald-400/30 shadow-[0_24px_60px_-30px_rgba(52,211,153,0.6)]',
    chip: 'bg-emerald-500/15 text-emerald-200 border-emerald-400/40',
    halo: 'from-emerald-500/30 via-teal-500/15 to-cyan-500/10',
  },
};

function RevealStep({ index, icon, title, description, tone, tag }: { index: number; icon: React.ReactNode; title: string; description: string; tone: keyof typeof REVEAL_TONES; tag: string }) {
  const { ref, shown } = useReveal<HTMLDivElement>(0.25);
  const glow = useCursorGlow<HTMLDivElement>();
  const t = REVEAL_TONES[tone];
  // Combine the two refs
  const setRefs = (el: HTMLDivElement | null) => {
    ref.current = el;
    glow.ref.current = el;
  };
  return (
    <div
      ref={setRefs}
      onPointerMove={glow.onPointerMove}
      className={`group relative overflow-hidden cursor-glow rounded-2xl border ${t.ring} bg-slate-900/60 p-6 backdrop-blur-xl transition-all duration-700 ease-out ${shown ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}
      style={{ transitionDelay: shown ? `${index * 110}ms` : '0ms' }}
    >
      <div className={`pointer-events-none absolute -top-16 right-0 h-40 w-40 rounded-full bg-gradient-to-br ${t.halo} blur-3xl opacity-70`} />
      <div className="relative z-10 flex items-start justify-between">
        <div className="brand-glow flex h-11 w-11 items-center justify-center rounded-xl">
          {icon}
        </div>
        <span className="font-mono text-3xl font-bold tracking-tight text-slate-700/80 group-hover:text-slate-500 transition-colors">
          0{index}
        </span>
      </div>
      <p className={`relative z-10 mt-4 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] ${t.chip}`}>
        {tag}
      </p>
      <h3 className="relative z-10 mt-3 text-lg font-semibold text-white">{title}</h3>
      <p className="relative z-10 mt-2 text-sm leading-relaxed text-slate-400">{description}</p>
    </div>
  );
}
