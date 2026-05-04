import { useState, useEffect, useCallback } from 'react';
import {
  Brain,
  Shield,
  ArrowRightLeft,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Zap,
} from 'lucide-react';
import { apiUrl } from '../utils/api';
import { formatAmount } from '../utils/format';
import type {
  DefaultPrediction,
  ZKProof,
  InterAgentSummary,
  InterAgentPoolStatus,
  InterAgentLoan,
  DialogueTurn,
} from '../types';

// ─── ML Default Prediction ──────────────────────────────
function MLPredictionCard() {
  const [address, setAddress] = useState('');
  const [prediction, setPrediction] = useState<DefaultPrediction | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchPrediction = async () => {
    if (!address) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(apiUrl(`/api/credit/${address}/default-prediction`));
      const data = await res.json();
      if (data.success) {
        setPrediction(data.data);
      } else {
        setError(data.error || 'Failed');
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  const riskColor = (bucket: string) => {
    switch (bucket) {
      case 'low': return 'text-green-400 bg-green-500/10 border-green-500/20';
      case 'medium': return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20';
      case 'high': return 'text-orange-400 bg-orange-500/10 border-orange-500/20';
      case 'critical': return 'text-red-400 bg-red-500/10 border-red-500/20';
      default: return 'text-gray-400 bg-gray-500/10 border-gray-500/20';
    }
  };

  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-2xl p-6">
      <div className="flex items-center gap-2 mb-4">
        <Brain className="w-5 h-5 text-purple-400" />
        <h3 className="text-sm font-semibold text-white">ML Default Prediction</h3>
        <span className="text-[10px] text-gray-500 ml-auto">Logistic Regression · 7 Features</span>
      </div>

      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="0x address..."
          className="flex-1 bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-purple-500/50 font-mono"
        />
        <button
          onClick={fetchPrediction}
          disabled={loading || !address}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-purple-500 px-4 py-2 text-sm font-bold text-white hover:bg-purple-400 transition-all disabled:opacity-50"
        >
          {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Brain className="w-3.5 h-3.5" />}
          Predict
        </button>
      </div>

      {error && (
        <div className="p-2.5 rounded-lg bg-red-950/30 border border-red-900/50 text-red-400 text-xs flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5" /> {error}
        </div>
      )}

      {prediction && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider">Default Probability</p>
              <p className="text-2xl font-bold text-white">{(prediction.probability * 100).toFixed(2)}%</p>
            </div>
            <span className={`px-3 py-1.5 rounded-full text-xs font-bold uppercase border ${riskColor(prediction.riskBucket)}`}>
              {prediction.riskBucket}
            </span>
          </div>

          <div className="bg-gray-950/60 rounded-xl p-3 border border-gray-800/60">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Feature Importance</p>
            <div className="space-y-1.5">
              {prediction.featureImportance.map((f) => (
                <div key={f.feature} className="flex items-center gap-2 text-xs">
                  <span className="text-gray-400 w-28 truncate font-mono">{f.feature}</span>
                  <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${f.contribution < 0 ? 'bg-green-500' : f.contribution > 0 ? 'bg-red-500' : 'bg-gray-600'}`}
                      style={{ width: `${Math.min(Math.abs(f.contribution) * 100, 100)}%` }}
                    />
                  </div>
                  <span className={`w-10 text-right ${f.contribution < 0 ? 'text-green-400' : f.contribution > 0 ? 'text-red-400' : 'text-gray-500'}`}>
                    {f.contribution > 0 ? '+' : ''}{f.contribution.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <p className="text-[10px] text-gray-600 text-right">Model: {prediction.modelVersion} · Confidence: {(prediction.confidence * 100).toFixed(0)}%</p>
        </div>
      )}
    </div>
  );
}

// ─── ZK Credit Proof ────────────────────────────────────
function ZKProofCard() {
  const [address, setAddress] = useState('');
  const [proof, setProof] = useState<{ proof: ZKProof; message: string } | null>(null);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');

  const generateProof = async () => {
    if (!address) return;
    setLoading(true);
    setError('');
    setProof(null);
    setVerified(null);
    try {
      const res = await fetch(apiUrl(`/api/credit/${address}/zk-proof`), { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setProof(data.data);
      } else {
        setError(data.error || 'Failed to generate proof');
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  const verifyProof = async () => {
    if (!proof) return;
    setVerifying(true);
    try {
      const res = await fetch(apiUrl('/api/credit/verify-proof'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(proof.proof),
      });
      const data = await res.json();
      setVerified(data.data?.valid ?? false);
    } catch {
      setVerified(false);
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-2xl p-6">
      <div className="flex items-center gap-2 mb-4">
        <Shield className="w-5 h-5 text-cyan-400" />
        <h3 className="text-sm font-semibold text-white">ZK Credit Proof</h3>
        <span className="text-[10px] text-gray-500 ml-auto">SHA-256 + Fiat-Shamir</span>
      </div>

      <p className="text-xs text-gray-400 mb-4">Prove your credit tier without revealing your exact score. Zero-knowledge range proof.</p>

      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="0x address (must have profile)..."
          className="flex-1 bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-cyan-500/50 font-mono"
        />
        <button
          onClick={generateProof}
          disabled={loading || !address}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-cyan-500 px-4 py-2 text-sm font-bold text-gray-950 hover:bg-cyan-400 transition-all disabled:opacity-50"
        >
          {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Shield className="w-3.5 h-3.5" />}
          Generate
        </button>
      </div>

      {error && (
        <div className="p-2.5 rounded-lg bg-red-950/30 border border-red-900/50 text-red-400 text-xs flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5" /> {error}
        </div>
      )}

      {proof && (
        <div className="space-y-3">
          <div className="bg-green-950/20 border border-green-900/40 rounded-xl p-4">
            <p className="text-xs text-green-400 font-medium mb-1">{proof.message}</p>
            <p className="text-[10px] text-gray-500 font-mono break-all">Commitment: {proof.proof.commitment.slice(0, 48)}...</p>
            <p className="text-[10px] text-gray-500">Bit proofs: {proof.proof.rangeProof.bitCommitments.length} bits</p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={verifyProof}
              disabled={verifying}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gray-800 border border-gray-700 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 transition-all disabled:opacity-50"
            >
              {verifying ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
              Verify Proof
            </button>
            {verified !== null && (
              <span className={`text-sm font-bold ${verified ? 'text-green-400' : 'text-red-400'}`}>
                {verified ? '✓ Valid — creditworthy' : '✗ Invalid proof'}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Inter-Agent Lending ────────────────────────────────
function InterAgentLendingCard() {
  const [summary, setSummary] = useState<InterAgentSummary | null>(null);
  const [pool, setPool] = useState<InterAgentPoolStatus | null>(null);
  const [loans, setLoans] = useState<InterAgentLoan[]>([]);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [requesting, setRequesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/api/inter-agent/lending'));
      const data = await res.json();
      if (data.success) {
        setSummary(data.data.summary);
        setPool(data.data.poolStatus);
        setLoans(data.data.loans || []);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const requestCapital = async () => {
    if (!amount) return;
    setRequesting(true);
    setResult(null);
    try {
      const res = await fetch(apiUrl('/api/inter-agent/request-capital'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, reason: reason || 'Manual capital request' }),
      });
      const data = await res.json();
      if (data.success) {
        setResult({ ok: true, msg: `Capital allocated: ${formatAmount(amount)} USDt` });
        setAmount('');
        setReason('');
        fetchStatus();
      } else {
        setResult({ ok: false, msg: data.error || 'Request declined' });
      }
    } catch {
      setResult({ ok: false, msg: 'Network error' });
    } finally {
      setRequesting(false);
    }
  };

  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-2xl p-6">
      <div className="flex items-center gap-2 mb-4">
        <ArrowRightLeft className="w-5 h-5 text-amber-400" />
        <h3 className="text-sm font-semibold text-white">Inter-Agent Lending</h3>
        <span className="text-[10px] text-gray-500 ml-auto">Treasury → Credit Agent</span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-6">
          <RefreshCw className="w-5 h-5 text-gray-500 animate-spin" />
        </div>
      ) : (
        <div className="space-y-4">
          {/* Pool Stats */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-950/60 rounded-xl p-3 border border-gray-800/60">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Available Capital</p>
              <p className="text-lg font-bold text-white">{formatAmount(pool?.availableCapital || '0')}</p>
            </div>
            <div className="bg-gray-950/60 rounded-xl p-3 border border-gray-800/60">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Active Loans</p>
              <p className="text-lg font-bold text-white">{summary?.activeLoans ?? 0}</p>
            </div>
            <div className="bg-gray-950/60 rounded-xl p-3 border border-gray-800/60">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Total Allocated</p>
              <p className="text-sm font-bold text-amber-400">{formatAmount(summary?.totalAllocated || '0')} USDt</p>
            </div>
            <div className="bg-gray-950/60 rounded-xl p-3 border border-gray-800/60">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Pool Utilization</p>
              <p className="text-sm font-bold text-amber-400">{((pool?.poolUtilization ?? 0) * 100).toFixed(1)}%</p>
            </div>
          </div>

          {/* Request Capital Form */}
          <div className="bg-gray-950/50 rounded-xl p-4 border border-amber-900/20">
            <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-3">Request Capital</p>
            <div className="flex gap-2 mb-2">
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Amount (wei)"
                className="flex-1 bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-amber-500/50 font-mono"
              />
              <button
                onClick={requestCapital}
                disabled={requesting || !amount}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-gray-950 hover:bg-amber-400 transition-all disabled:opacity-50"
              >
                {requesting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                Request
              </button>
            </div>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (optional)"
              className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-xs text-white placeholder:text-gray-600 focus:outline-none focus:border-amber-500/50"
            />
            {result && (
              <div className={`mt-2 p-2.5 rounded-lg flex items-start gap-2 text-xs ${result.ok ? 'bg-green-950/30 border border-green-900/50 text-green-400' : 'bg-red-950/30 border border-red-900/50 text-red-400'}`}>
                {result.ok ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" /> : <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
                <span>{result.msg}</span>
              </div>
            )}
          </div>

          {/* Recent inter-agent loans */}
          {loans.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider">Recent Transactions</p>
              {loans.slice(0, 5).map((l) => (
                <div key={l.id} className="flex items-center justify-between text-xs bg-gray-950/40 rounded-lg p-2.5 border border-gray-800/50">
                  <span className="text-gray-400">{formatAmount(l.amount)} USDt</span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                    l.status === 'allocated' ? 'text-green-400 bg-green-500/10' :
                    l.status === 'declined' ? 'text-red-400 bg-red-500/10' :
                    l.status === 'repaid' ? 'text-blue-400 bg-blue-500/10' :
                    'text-yellow-400 bg-yellow-500/10'
                  }`}>
                    {l.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Board Meetings Feed ────────────────────────────────
function BoardMeetingsCard() {
  const [dialogues, setDialogues] = useState<Array<{
    id: string;
    topic: string;
    consensus?: string;
    rounds: DialogueTurn[];
    timestamp: number;
  }>>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDialogues = async () => {
      try {
        const res = await fetch(apiUrl('/api/decisions?limit=50'));
        const data = await res.json();
        if (data.success) {
          // Extract dialogue events
          const dialogueEvents = (data.data as Array<{
            type: string;
            payload: { action: string; data?: Record<string, unknown> };
            timestamp: number;
            source: string;
          }>).filter(
            (d) => d.type?.includes('dialogue') || d.payload?.action?.includes('dialogue') || d.payload?.action?.includes('board')
          );

          // Group into meetings
          const meetings: typeof dialogues = [];
          let current: typeof dialogues[0] | null = null;

          for (const evt of dialogueEvents) {
            const action = evt.payload?.action || evt.type || '';
            if (action.includes('board_consensus') || action.includes('consensus')) {
              if (current) {
                current.consensus = (evt.payload?.data as Record<string, string>)?.consensus || 'Consensus reached';
                meetings.push(current);
                current = null;
              } else {
                meetings.push({
                  id: `meeting-${evt.timestamp}`,
                  topic: 'Board Meeting',
                  consensus: (evt.payload?.data as Record<string, string>)?.consensus || 'Consensus reached',
                  rounds: [],
                  timestamp: evt.timestamp,
                });
              }
            } else if (action.includes('dialogue')) {
              if (!current) {
                current = {
                  id: `meeting-${evt.timestamp}`,
                  topic: (evt.payload?.data as Record<string, string>)?.topic || 'Inter-Agent Discussion',
                  rounds: [],
                  timestamp: evt.timestamp,
                };
              }
              current.rounds.push({
                agent: evt.source || 'unknown',
                message: (evt.payload?.data as Record<string, string>)?.message ||
                         (evt.payload?.data as Record<string, string>)?.reasoning ||
                         JSON.stringify(evt.payload?.data || {}).slice(0, 200),
                timestamp: evt.timestamp,
              });
            }
          }
          if (current) meetings.push(current);
          setDialogues(meetings.reverse());
        }
      } catch { /* ignore */ }
      finally { setLoading(false); }
    };

    fetchDialogues();
    const interval = setInterval(fetchDialogues, 30000); // refresh every 30s
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-2xl p-6">
      <div className="flex items-center gap-2 mb-4">
        <MessageSquare className="w-5 h-5 text-indigo-400" />
        <h3 className="text-sm font-semibold text-white">Board Meetings</h3>
        <span className="text-[10px] text-gray-500 ml-auto">Treasury ↔ Credit Agent Dialogue</span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-6">
          <RefreshCw className="w-5 h-5 text-gray-500 animate-spin" />
        </div>
      ) : dialogues.length === 0 ? (
        <div className="py-8 text-center">
          <MessageSquare className="w-8 h-8 text-gray-700 mx-auto mb-2" />
          <p className="text-sm text-gray-500">No board meetings yet. Agents will converse every 5 minutes.</p>
        </div>
      ) : (
        <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1 custom-scrollbar">
          {dialogues.map((meeting) => (
            <div key={meeting.id} className="bg-gray-950/50 border border-gray-800/60 rounded-xl overflow-hidden">
              <button
                onClick={() => setExpanded(expanded === meeting.id ? null : meeting.id)}
                className="w-full flex items-center justify-between p-4 hover:bg-gray-800/20 transition-colors"
              >
                <div className="flex items-center gap-3 text-left min-w-0">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${meeting.consensus ? 'bg-green-500' : 'bg-yellow-500 animate-pulse'}`} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white truncate">{meeting.topic}</p>
                    <p className="text-[10px] text-gray-500">
                      {new Date(meeting.timestamp).toLocaleTimeString()} · {meeting.rounds.length} turns
                      {meeting.consensus && ' · Consensus ✓'}
                    </p>
                  </div>
                </div>
                {expanded === meeting.id ? (
                  <ChevronUp className="w-4 h-4 text-gray-500 shrink-0" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-gray-500 shrink-0" />
                )}
              </button>

              {expanded === meeting.id && (
                <div className="px-4 pb-4 space-y-3 border-t border-gray-800/50">
                  {meeting.rounds.map((round, i) => (
                    <div key={i} className="flex gap-3 pt-3">
                      <div className={`w-6 h-6 rounded-full shrink-0 flex items-center justify-center text-[10px] font-bold ${
                        round.agent === 'treasury' ? 'bg-cyan-900/50 text-cyan-400 border border-cyan-500/20' : 'bg-emerald-900/50 text-emerald-400 border border-emerald-500/20'
                      }`}>
                        {round.agent === 'treasury' ? 'T' : 'C'}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-0.5">
                          {round.agent} Agent
                        </p>
                        <p className="text-xs text-gray-300 leading-relaxed break-words">
                          {round.message}
                        </p>
                      </div>
                    </div>
                  ))}
                  {meeting.consensus && (
                    <div className="mt-2 p-3 rounded-lg bg-green-950/20 border border-green-900/40">
                      <p className="text-[10px] font-bold text-green-400 uppercase tracking-wider mb-1">Consensus</p>
                      <p className="text-xs text-green-300/80 leading-relaxed">{meeting.consensus}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Exported Composite ─────────────────────────────────
export function BonusFeatures() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-2">
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-purple-500/30 to-transparent" />
        <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
          <Zap className="w-5 h-5 text-yellow-400" />
          Bonus Features
        </h2>
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-purple-500/30 to-transparent" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <MLPredictionCard />
        <ZKProofCard />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <InterAgentLendingCard />
        <BoardMeetingsCard />
      </div>
    </div>
  );
}
