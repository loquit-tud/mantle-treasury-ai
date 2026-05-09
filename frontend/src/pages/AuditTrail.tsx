import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, FileSearch, RefreshCw, ShieldCheck, Copy, Check } from 'lucide-react';
import { apiUrl } from '../utils/api';

type AuditEvent = {
  id: number;
  correlationId: string;
  stage: 'intent' | 'guard' | 'execution';
  action: string;
  actor: 'api' | 'agent';
  timestamp: number;
  ok: boolean | null;
  reason: string | null;
  amountRaw: string | null;
  toAddress: string | null;
  txHash: string | null;
  data: Record<string, unknown> | null;
};

type AuditChain = {
  correlationId: string;
  action: string;
  latestTimestamp: number;
  events: AuditEvent[];
};

function formatUsd(raw: string | null): string {
  if (!raw) return '—';
  try {
    const n = Number(raw) / 1e6;
    if (!Number.isFinite(n)) return '—';
    return `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDt`;
  } catch {
    return '—';
  }
}

function shortAddr(addr: string | null): string {
  if (!addr) return '—';
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function mantleTxUrl(txHash: string): string {
  return `https://mantlescan.xyz/tx/${txHash}`;
}

export default function AuditTrail() {
  const [chains, setChains] = useState<AuditChain[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiUrl('/api/audit/trail?limit=25'));
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const json = await res.json();
      setChains(json?.data?.chains ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load audit trail');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const stats = useMemo(() => {
    const total = chains.length;
    const withExec = chains.filter(c => c.events.some(e => e.stage === 'execution')).length;
    const withTx = chains.filter(c => c.events.some(e => !!e.txHash)).length;
    return { total, withExec, withTx };
  }, [chains]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return chains;
    return chains.filter((c) =>
      c.correlationId.toLowerCase().includes(q) ||
      c.action.toLowerCase().includes(q) ||
      c.events.some((e) =>
        (e.txHash || '').toLowerCase().includes(q) ||
        (e.toAddress || '').toLowerCase().includes(q) ||
        (e.reason || '').toLowerCase().includes(q),
      )
    );
  }, [chains, query]);

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedId(value);
      window.setTimeout(() => setCopiedId(null), 1200);
    } catch {
      // ignore
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-indigo-300" />
            <h2 className="text-2xl font-semibold tracking-tight text-white">Audit Trail</h2>
          </div>
          <p className="mt-1 text-sm text-slate-400">
            Judge-proof chain-of-custody: intent → guard decision → execution.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:border-slate-600 hover:bg-slate-800 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 text-indigo-300 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Recent chains" value={String(stats.total)} />
        <StatCard label="With execution stage" value={String(stats.withExec)} />
        <StatCard label="With txHash" value={String(stats.withTx)} />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex-1">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by action, correlationId, txHash, address…"
            className="w-full rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-2.5 text-sm text-slate-100 placeholder:text-slate-600"
          />
          <p className="mt-1 text-[11px] text-slate-500">
            Tip: paste a txHash or correlationId from a judge proof response.
          </p>
        </div>
        <a
          href={apiUrl('/api/audit/trail?limit=25')}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-slate-500 hover:text-indigo-200"
        >
          View JSON
        </a>
      </div>

      {error && (
        <div className="flex items-center gap-3 rounded-xl border border-red-800/60 bg-red-950/40 p-4">
          <FileSearch className="h-5 w-5 shrink-0 text-red-400" />
          <span className="text-sm text-red-200">{error}</span>
        </div>
      )}

      <div className="space-y-3">
        {filtered.length === 0 && !loading ? (
          <EmptyState text="No audit chains yet — trigger a withdrawal proposal, borrow, invest, or bridge execute." />
        ) : (
          filtered.map((c) => (
            <div key={c.correlationId} className="glass-card p-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Action</p>
                  <p className="mt-1 text-sm font-semibold text-slate-100">{c.action}</p>
                </div>
                <div className="flex flex-col items-start gap-1 sm:items-end">
                  <p className="text-[11px] text-slate-500">Correlation</p>
                  <div className="flex items-center gap-2">
                    <code className="text-[11px] text-slate-300">{c.correlationId}</code>
                    <button
                      type="button"
                      onClick={() => copy(c.correlationId)}
                      className="rounded p-1 transition-colors hover:bg-slate-800"
                      aria-label="Copy correlationId"
                    >
                      {copiedId === c.correlationId ? (
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="h-3.5 w-3.5 text-slate-400" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {c.events.map((e) => (
                  <StageCard key={e.id} event={e} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass-tile p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
    </div>
  );
}

function StageCard({ event }: { event: AuditEvent }) {
  const statusLabel =
    event.ok == null ? '—' : event.ok ? 'OK' : 'REJECTED';

  const tone =
    event.stage === 'guard'
      ? (event.ok ? 'border-emerald-500/25 bg-emerald-950/20' : 'border-red-500/25 bg-red-950/20')
      : event.stage === 'execution'
        ? (event.ok ? 'border-indigo-500/25 bg-indigo-950/20' : 'border-amber-500/25 bg-amber-950/20')
        : 'border-slate-800 bg-slate-950/30';

  return (
    <div className={`rounded-xl border p-4 ${tone}`}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">{event.stage}</p>
        {event.stage !== 'intent' && (
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            event.ok ? 'bg-emerald-500/15 text-emerald-200' : 'bg-red-500/15 text-red-200'
          }`}>
            {statusLabel}
          </span>
        )}
      </div>
      <p className="mt-2 text-xs text-slate-400">
        {new Date(event.timestamp).toLocaleString()}
      </p>

      <div className="mt-3 space-y-1 text-xs">
        <Row k="Actor" v={event.actor} />
        <Row k="Amount" v={formatUsd(event.amountRaw)} />
        <Row k="To" v={shortAddr(event.toAddress)} mono />
        {event.reason ? <Row k="Reason" v={event.reason} /> : null}
        {event.txHash ? (
          <a
            className="mt-2 inline-flex items-center gap-1.5 text-xs text-indigo-200 hover:text-indigo-100"
            href={mantleTxUrl(event.txHash)}
            target="_blank"
            rel="noopener noreferrer"
          >
            View tx <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : null}
      </div>
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-500">{k}</span>
      <span className={`text-slate-200 ${mono ? 'font-mono' : ''}`}>{v}</span>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="py-10 flex flex-col items-center justify-center text-center glass-card">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-slate-800 bg-slate-950/50">
        <FileSearch className="h-5 w-5 text-slate-600" />
      </div>
      <p className="text-sm font-medium text-slate-400">{text}</p>
    </div>
  );
}

