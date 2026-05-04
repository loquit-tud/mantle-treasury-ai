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
  treasury: { label: 'Treasury', color: 'text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/30', avatar: '💰' },
  credit:   { label: 'Credit',   color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', avatar: '🏦' },
  risk:     { label: 'Risk',     color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30', avatar: '🛡️' },
  consensus:{ label: 'Consensus',color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/30', avatar: '⚖️' },
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
    <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden shadow-sm">
      <div className="px-5 py-4 border-b border-gray-700 flex items-center justify-between bg-gray-800/80">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-purple-400" />
          <h3 className="text-sm font-semibold text-gray-200">Board Meeting — Live Debate</h3>
        </div>
        <span className="text-[11px] uppercase tracking-wider text-purple-400 font-bold px-2 py-0.5 bg-purple-500/10 rounded border border-purple-500/20">
          {topicLabel}
        </span>
      </div>
      <div
        ref={scrollRef}
        className="p-4 space-y-3 h-[380px] overflow-y-auto overflow-x-hidden custom-scrollbar"
      >
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 rounded-full bg-purple-500/5 border border-purple-500/20 flex items-center justify-center mb-3 animate-pulse">
              <MessageSquare className="w-7 h-7 text-purple-500/40" />
            </div>
            <p className="text-sm font-semibold text-gray-400">Agents standing by...</p>
            <p className="text-[11px] text-gray-500 mt-1 max-w-[220px] leading-relaxed">
              Three AI advisors will debate capital allocation & risk once the countdown reaches 0:00
            </p>
            <div className="flex items-center gap-3 mt-4">
              <span className="flex items-center gap-1.5 text-[10px] text-cyan-500/80"><span className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse" />Treasury</span>
              <span className="flex items-center gap-1.5 text-[10px] text-emerald-500/80"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />Credit</span>
              <span className="flex items-center gap-1.5 text-[10px] text-amber-500/80"><span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />Risk</span>
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
                <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm ${cfg.bg} border ${cfg.border}`}>
                  {cfg.avatar}
                </div>
                <div className={`flex-1 min-w-0 ${isConsensus ? `rounded-lg p-3 ${cfg.bg} border ${cfg.border}` : ''}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs font-bold uppercase tracking-wider ${cfg.color}`}>
                      {cfg.label}
                    </span>
                    {isConsensus && (
                      <span className="text-[9px] bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded font-bold">
                        FINAL DECISION
                      </span>
                    )}
                    <span className="text-[10px] text-gray-600 font-mono ml-auto shrink-0">
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                  </div>
                  <p className={`text-[13px] leading-relaxed break-words ${isConsensus ? 'text-purple-200 font-medium' : 'text-gray-300'}`}>
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
