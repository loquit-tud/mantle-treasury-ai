import { useEffect, useRef, useState } from 'react';
import { MessageSquare, Sparkles } from 'lucide-react';

interface ChatMessage {
  id: string;
  speaker: 'treasury' | 'credit' | 'risk' | 'consensus';
  message: string;
  topic: string;
  turn: number;
  timestamp: number;
}

const SPEAKER_CONFIG: Record<
  string,
  {
    label: string;
    text: string;
    bubble: string;
    border: string;
    avatarBg: string;
    avatarText: string;
    avatar: string;
    align: 'left' | 'right' | 'center';
    glow: string;
  }
> = {
  treasury: {
    label: 'Treasury',
    text: 'text-indigo-100',
    bubble: 'bg-gradient-to-br from-indigo-500/25 to-indigo-700/15',
    border: 'border-indigo-400/30',
    avatarBg: 'bg-gradient-to-br from-indigo-400 to-indigo-600',
    avatarText: 'text-white',
    avatar: 'T',
    align: 'left',
    glow: 'shadow-[0_8px_24px_-12px_rgba(99,102,241,0.6)]',
  },
  credit: {
    label: 'Credit',
    text: 'text-sky-100',
    bubble: 'bg-gradient-to-br from-sky-500/25 to-sky-700/15',
    border: 'border-sky-400/30',
    avatarBg: 'bg-gradient-to-br from-sky-400 to-sky-600',
    avatarText: 'text-white',
    avatar: 'C',
    align: 'right',
    glow: 'shadow-[0_8px_24px_-12px_rgba(56,189,248,0.6)]',
  },
  risk: {
    label: 'Risk',
    text: 'text-amber-100',
    bubble: 'bg-gradient-to-br from-amber-500/25 to-amber-700/15',
    border: 'border-amber-400/30',
    avatarBg: 'bg-gradient-to-br from-amber-400 to-amber-600',
    avatarText: 'text-white',
    avatar: 'R',
    align: 'left',
    glow: 'shadow-[0_8px_24px_-12px_rgba(251,191,36,0.6)]',
  },
  consensus: {
    label: 'Consensus',
    text: 'text-emerald-100',
    bubble: 'bg-gradient-to-br from-emerald-500/30 via-teal-500/20 to-cyan-500/20',
    border: 'border-emerald-400/40',
    avatarBg: 'bg-gradient-to-br from-emerald-400 via-teal-400 to-cyan-400',
    avatarText: 'text-slate-950',
    avatar: 'Σ',
    align: 'center',
    glow: 'shadow-[0_10px_32px_-12px_rgba(52,211,153,0.7)]',
  },
};

interface DialogueRound {
  topic: string;
  turns: { speaker: string; message: string; timestamp: number }[];
  consensus: string;
  timestamp: number;
}

export function AgentChat({ lastMessage, initialDialogues }: { lastMessage: unknown; initialDialogues?: DialogueRound[] }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentTopic, setCurrentTopic] = useState<string>('');
  const [typingSpeaker, setTypingSpeaker] = useState<string | null>(null);
  const initialisedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!initialDialogues?.length || initialisedRef.current) return;
    initialisedRef.current = true;

    const seed: ChatMessage[] = [];
    for (const round of initialDialogues) {
      for (const turn of round.turns) {
        seed.push({
          id: `seed-${round.topic}-${turn.timestamp}-${turn.speaker}`,
          speaker: (turn.speaker as ChatMessage['speaker']) || 'consensus',
          message: turn.message,
          topic: round.topic,
          turn: 0,
          timestamp: turn.timestamp,
        });
      }
    }

    if (seed.length) {
      seed.sort((a, b) => a.timestamp - b.timestamp);
      setMessages(seed.slice(-30));
      const last = seed[seed.length - 1];
      if (last?.topic) setCurrentTopic(last.topic);
    }
  }, [initialDialogues]);

  useEffect(() => {
    if (!lastMessage) return;
    const msg = lastMessage as { type: string; data: { type?: string; source?: string; payload?: Record<string, unknown>; timestamp?: number } };

    if (msg.type !== 'agent:event') return;
    const event = msg.data;
    if (!event?.type) return;

    if (event.type === 'dialogue:turn' || event.type === 'dialogue:consensus') {
      const payload = event.payload || {};
      const data = (payload.data || {}) as Record<string, unknown>;
      const speaker = (data.speaker || event.source || 'consensus') as ChatMessage['speaker'];
      const topic = (data.topic || '') as string;
      const turn = (data.turn || 0) as number;
      const reasoning = (payload.reasoning || '') as string;

      if (topic && topic !== currentTopic) {
        setCurrentTopic(topic);
      }

      const chatMsg: ChatMessage = {
        id: `${event.type}-${event.timestamp || Date.now()}-${turn}`,
        speaker: event.type === 'dialogue:consensus' ? 'consensus' : speaker,
        message: reasoning,
        topic,
        turn,
        timestamp: (event.timestamp || Date.now()) as number,
      };

      setMessages(prev => {
        if (prev.some(m => m.id === chatMsg.id)) return prev;
        return [...prev, chatMsg].slice(-30);
      });

      const order: ChatMessage['speaker'][] = ['treasury', 'credit', 'risk', 'consensus'];
      const idx = order.indexOf(chatMsg.speaker);
      const next = order[(idx + 1) % order.length];
      setTypingSpeaker(next);
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      typingTimerRef.current = setTimeout(() => setTypingSpeaker(null), 2200);
    }
  }, [lastMessage, currentTopic]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, typingSpeaker]);

  useEffect(() => () => { if (typingTimerRef.current) clearTimeout(typingTimerRef.current); }, []);

  const topicLabel = currentTopic ? currentTopic.replace(/_/g, ' ') : 'Waiting for board meeting…';

  return (
    <div className="overflow-hidden glass-card">
      <div className="flex items-center justify-between border-b border-slate-800/60 bg-slate-950/30 px-5 py-4">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-indigo-300" />
          <h3 className="text-sm font-semibold text-slate-200">Board meeting transcript</h3>
        </div>
        <span className="flex items-center gap-1.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-200">
          <Sparkles className="h-3 w-3" />
          {topicLabel}
        </span>
      </div>
      <div
        ref={scrollRef}
        className="custom-scrollbar h-[420px] space-y-4 overflow-y-auto overflow-x-hidden p-5"
      >
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="brand-glow mb-3 flex h-16 w-16 items-center justify-center rounded-2xl">
              <MessageSquare className="h-7 w-7 text-indigo-300" />
            </div>
            <p className="text-sm font-semibold text-slate-300">Awaiting next board meeting</p>
            <p className="mt-1 max-w-[260px] text-[12px] leading-relaxed text-slate-500">
              The three agents debate capital allocation and risk posture every cycle. Live transcripts appear here.
            </p>
            <div className="mt-5 flex items-center gap-3">
              <AgentBadge speaker="treasury" />
              <AgentBadge speaker="credit" />
              <AgentBadge speaker="risk" />
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg) => {
              const cfg = SPEAKER_CONFIG[msg.speaker] || SPEAKER_CONFIG.consensus;
              return <ChatBubble key={msg.id} msg={msg} cfg={cfg} />;
            })}
            {typingSpeaker && SPEAKER_CONFIG[typingSpeaker] && (
              <TypingIndicator cfg={SPEAKER_CONFIG[typingSpeaker]} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ChatBubble({ msg, cfg }: { msg: ChatMessage; cfg: typeof SPEAKER_CONFIG[string] }) {
  const isCenter = cfg.align === 'center';
  const isRight = cfg.align === 'right';
  const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (isCenter) {
    return (
      <div className="flex flex-col items-center text-center animate-in fade-in slide-in-from-bottom-2 duration-300">
        <div className={`flex h-9 w-9 items-center justify-center rounded-full ${cfg.avatarBg} ${cfg.avatarText} text-sm font-bold ${cfg.glow}`}>
          {cfg.avatar}
        </div>
        <div className={`mt-2 max-w-[85%] rounded-2xl border ${cfg.border} ${cfg.bubble} ${cfg.glow} p-4 backdrop-blur-sm`}>
          <div className="mb-1 flex items-center justify-center gap-2">
            <span className={`text-[10px] font-bold uppercase tracking-[0.2em] ${cfg.text}`}>{cfg.label}</span>
            <span className="text-[10px] font-mono text-slate-400">{time}</span>
          </div>
          <p className="text-[13px] font-medium leading-relaxed text-slate-100">{msg.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex items-end gap-2.5 animate-in fade-in slide-in-from-bottom-1 duration-300 ${isRight ? 'flex-row-reverse' : ''}`}>
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${cfg.avatarBg} ${cfg.avatarText} ${cfg.glow}`}>
        {cfg.avatar}
      </div>
      <div className={`max-w-[78%] min-w-0 ${isRight ? 'items-end text-right' : 'items-start text-left'} flex flex-col`}>
        <div className={`mb-1 flex items-center gap-2 text-[10px] ${isRight ? 'flex-row-reverse' : ''}`}>
          <span className={`font-semibold uppercase tracking-[0.16em] ${cfg.text}`}>{cfg.label}</span>
          <span className="font-mono text-slate-500">{time}</span>
        </div>
        <div className={`rounded-2xl border ${cfg.border} ${cfg.bubble} px-3.5 py-2.5 backdrop-blur-sm ${isRight ? 'rounded-br-sm' : 'rounded-bl-sm'}`}>
          <p className="break-words text-[13px] leading-relaxed text-slate-100">{msg.message}</p>
        </div>
      </div>
    </div>
  );
}

function TypingIndicator({ cfg }: { cfg: typeof SPEAKER_CONFIG[string] }) {
  const isRight = cfg.align === 'right';
  return (
    <div className={`flex items-end gap-2.5 animate-in fade-in duration-200 ${isRight ? 'flex-row-reverse' : ''}`}>
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${cfg.avatarBg} ${cfg.avatarText} opacity-80`}>
        {cfg.avatar}
      </div>
      <div className={`rounded-2xl border ${cfg.border} ${cfg.bubble} px-4 py-3 backdrop-blur-sm`}>
        <div className="flex items-center gap-1">
          <span className={`h-1.5 w-1.5 rounded-full ${cfg.avatarBg} animate-bounce [animation-delay:-0.3s]`} />
          <span className={`h-1.5 w-1.5 rounded-full ${cfg.avatarBg} animate-bounce [animation-delay:-0.15s]`} />
          <span className={`h-1.5 w-1.5 rounded-full ${cfg.avatarBg} animate-bounce`} />
        </div>
      </div>
    </div>
  );
}

function AgentBadge({ speaker }: { speaker: 'treasury' | 'credit' | 'risk' }) {
  const cfg = SPEAKER_CONFIG[speaker];
  return (
    <span className={`flex items-center gap-1.5 rounded-full border ${cfg.border} ${cfg.bubble} px-2.5 py-1 text-[10px] font-medium ${cfg.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.avatarBg} animate-pulse`} />
      {cfg.label}
    </span>
  );
}
