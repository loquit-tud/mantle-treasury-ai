import { useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, Sparkles, X, Activity } from 'lucide-react';

type ToastTone = 'success' | 'info' | 'warn' | 'agent';

interface Toast {
  id: string;
  tone: ToastTone;
  title: string;
  body?: string;
  ts: number;
}

const TONE_CFG: Record<ToastTone, { ring: string; icon: React.ReactNode; tint: string }> = {
  success: {
    ring: 'border-emerald-400/40',
    icon: <CheckCircle2 className="h-4 w-4 text-emerald-300" />,
    tint: 'from-emerald-500/20 to-teal-500/10',
  },
  info: {
    ring: 'border-sky-400/40',
    icon: <Activity className="h-4 w-4 text-sky-300" />,
    tint: 'from-sky-500/20 to-indigo-500/10',
  },
  warn: {
    ring: 'border-amber-400/40',
    icon: <AlertCircle className="h-4 w-4 text-amber-300" />,
    tint: 'from-amber-500/20 to-orange-500/10',
  },
  agent: {
    ring: 'border-indigo-400/40',
    icon: <Sparkles className="h-4 w-4 text-indigo-300" />,
    tint: 'from-indigo-500/25 to-violet-500/10',
  },
};

const TTL_MS = 5500;
const MAX_STACK = 4;

function deriveToast(lastMessage: unknown): Toast | null {
  if (!lastMessage || typeof lastMessage !== 'object') return null;
  const msg = lastMessage as { type?: string; data?: Record<string, unknown> };
  if (msg.type !== 'agent:event' || !msg.data) return null;
  const data = msg.data as { type?: string; source?: string; timestamp?: number; payload?: Record<string, unknown> };
  if (!data.type) return null;

  const ts = (data.timestamp as number) ?? Date.now();
  const id = `${data.type}-${ts}-${data.source ?? 'sys'}`;
  const source = (data.source ?? 'agent').toString();
  const sourceLabel = source.charAt(0).toUpperCase() + source.slice(1);

  switch (data.type) {
    case 'dialogue:consensus': {
      const reasoning = (data.payload?.reasoning as string) || 'Board reached consensus';
      return { id, tone: 'success', title: 'Consensus reached', body: reasoning, ts };
    }
    case 'dialogue:turn': {
      const reasoning = (data.payload?.reasoning as string) || '';
      if (!reasoning) return null;
      return { id, tone: 'agent', title: `${sourceLabel} weighs in`, body: reasoning, ts };
    }
    case 'decision:executed':
    case 'decision:approved': {
      const action = (data.payload?.action as string) || data.type;
      return { id, tone: 'success', title: `${sourceLabel} executed`, body: action, ts };
    }
    case 'decision:rejected':
    case 'decision:blocked': {
      const reason = (data.payload?.reason as string) || 'Action blocked by risk gate';
      return { id, tone: 'warn', title: `${sourceLabel} rejected`, body: reason, ts };
    }
    case 'risk:alert':
    case 'risk:warning': {
      const detail = (data.payload?.message as string) || (data.payload?.reason as string) || 'Risk warning';
      return { id, tone: 'warn', title: 'Risk alert', body: detail, ts };
    }
    case 'loan:created':
    case 'loan:approved': {
      const amount = data.payload?.amount as string | undefined;
      return { id, tone: 'success', title: 'Loan approved', body: amount ? `Amount: ${amount}` : undefined, ts };
    }
    case 'yield:harvested': {
      const amount = data.payload?.amount as string | undefined;
      return { id, tone: 'success', title: 'Yield harvested', body: amount ? `+${amount}` : undefined, ts };
    }
    default:
      return null;
  }
}

export function ToastStack({ lastMessage }: { lastMessage: unknown }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const t = deriveToast(lastMessage);
    if (!t) return;
    setToasts((prev) => {
      if (prev.some((p) => p.id === t.id)) return prev;
      const next = [...prev, t];
      return next.slice(-MAX_STACK);
    });
  }, [lastMessage]);

  // Auto-expire
  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setToasts((prev) => prev.filter((t) => now - t.ts < TTL_MS));
    }, 500);
    return () => clearInterval(timer);
  }, [toasts.length]);

  const dismiss = (id: string) => setToasts((prev) => prev.filter((t) => t.id !== id));

  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(92vw,360px)] flex-col gap-2"
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((t) => {
        const cfg = TONE_CFG[t.tone];
        return (
          <div
            key={t.id}
            className={`pointer-events-auto group relative overflow-hidden rounded-xl border ${cfg.ring} bg-gradient-to-br ${cfg.tint} backdrop-blur-xl p-3 shadow-[0_18px_40px_-18px_rgba(0,0,0,0.6)] animate-in fade-in slide-in-from-right-4 duration-300`}
          >
            <div className="flex items-start gap-2.5">
              <div className="mt-0.5 shrink-0">{cfg.icon}</div>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-semibold text-slate-100">{t.title}</p>
                {t.body && (
                  <p className="mt-0.5 line-clamp-3 text-[11.5px] leading-relaxed text-slate-300">{t.body}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss"
                className="shrink-0 rounded-md p-0.5 text-slate-400 transition hover:bg-slate-800/60 hover:text-slate-200"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <span className="absolute bottom-0 left-0 h-0.5 w-full bg-gradient-to-r from-white/0 via-white/40 to-white/0 opacity-30" />
          </div>
        );
      })}
    </div>
  );
}
