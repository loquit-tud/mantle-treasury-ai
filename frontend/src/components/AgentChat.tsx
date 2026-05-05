import { useEffect, useRef, useState } from 'react';
import { MessageSquare } from 'lucide-react';

interface ChatMessage {
  id: string;
  speaker: 'treasury' | 'credit' | 'risk' | 'consensus';
  message: string;
  topic: string;
  turn: number;
  timestamp: number;
}

const SPEAKER_CONFIG: Record<string, { label: string; color: string; bg: string; border: string; avatar: string }> = {
  treasury: { label: 'Treasury', color: 'text-indigo-200', bg: 'bg-indigo-500/10', border: 'border-indigo-500/25', avatar: 'T' },
  credit: { label: 'Credit', color: 'text-sky-200', bg: 'bg-sky-500/10', border: 'border-sky-500/25', avatar: 'C' },
  risk: { label: 'Risk', color: 'text-amber-200', bg: 'bg-amber-500/10', border: 'border-amber-500/25', avatar: 'R' },
  consensus: { label: 'Consensus', color: 'text-slate-100', bg: 'bg-slate-800/80', border: 'border-slate-600/60', avatar: 'Σ' },
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
  const initialisedRef = useRef(false);

  // Seed messages from persisted dialogue rounds (runs once when data arrives)
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
  const scrollRef = useRef<HTMLDivElement>(null);

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
        // Deduplicate by id
        if (prev.some(m => m.id === chatMsg.id)) return prev;
        return [...prev, chatMsg].slice(-30);
      });
    }
  }, [lastMessage, currentTopic]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const topicLabel = currentTopic ? currentTopic.replace(/_/g, ' ') : 'Waiting for Board Meeting...';

  return (
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60 shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950/40 px-5 py-4">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-indigo-300" />
          <h3 className="text-sm font-semibold text-slate-200">Board meeting transcript</h3>
        </div>
        <span className="rounded border border-indigo-500/25 bg-indigo-500/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-indigo-200">
          {topicLabel}
        </span>
      </div>
      <div
        ref={scrollRef}
        className="custom-scrollbar h-[380px] space-y-3 overflow-y-auto overflow-x-hidden p-4"
      >
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="mb-3 flex h-16 w-16 animate-pulse items-center justify-center rounded-full border border-indigo-500/20 bg-indigo-500/5">
              <MessageSquare className="h-7 w-7 text-indigo-400/40" />
            </div>
            <p className="text-sm font-semibold text-slate-400">Awaiting next cycle</p>
            <p className="mt-1 max-w-[240px] text-[11px] leading-relaxed text-slate-500">
              Structured debate rounds appear here when agents synchronize on capital allocation and risk posture.
            </p>
            <div className="mt-4 flex items-center gap-3">
              <span className="flex items-center gap-1.5 text-[10px] text-indigo-300/90"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-400" />Treasury</span>
              <span className="flex items-center gap-1.5 text-[10px] text-sky-300/90"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400" />Credit</span>
              <span className="flex items-center gap-1.5 text-[10px] text-amber-300/90"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />Risk</span>
            </div>
          </div>
        ) : (
          messages.map((msg, i) => {
            const cfg = SPEAKER_CONFIG[msg.speaker] || SPEAKER_CONFIG.consensus;
            const isConsensus = msg.speaker === 'consensus';
            return (
              <div
                key={msg.id}
                className={`flex gap-3 animate-in slide-in-from-bottom-2 duration-300 ${i === messages.length - 1 ? 'animate-pulse-once' : ''}`}
              >
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${cfg.bg} ${cfg.border} ${cfg.color}`}>
                  {cfg.avatar}
                </div>
                <div className={`min-w-0 flex-1 ${isConsensus ? `rounded-lg border p-3 ${cfg.bg} ${cfg.border}` : ''}`}>
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className={`text-xs font-semibold uppercase tracking-wider ${cfg.color}`}>
                      {cfg.label}
                    </span>
                    {isConsensus && (
                      <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-[9px] font-bold text-indigo-100">
                        Consensus
                      </span>
                    )}
                    <span className="ml-auto shrink-0 font-mono text-[10px] text-slate-500">
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                  </div>
                  <p className={`break-words text-[13px] leading-relaxed ${isConsensus ? 'font-medium text-slate-100' : 'text-slate-300'}`}>
                    {msg.message}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
