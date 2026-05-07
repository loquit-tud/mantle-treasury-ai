import { useState, useEffect, useCallback } from 'react';
import { BrowserProvider, Contract, parseEther, parseUnits, formatEther, formatUnits } from 'ethers';
import { apiUrl } from '../utils/api';
import { Coins, ArrowDownCircle, ArrowUpCircle, RefreshCw, CheckCircle2, AlertCircle, Lock } from 'lucide-react';
import { getEth } from '../hooks/selectedProvider';

const MNT_VAULT_ADDRESS =
  import.meta.env.VITE_MNT_COLLATERAL_VAULT_ADDRESS || '0x618Bfab3091F99c2476D34d803576C0B9e46acb8';

const MNT_VAULT_ABI = [
  'function borrow(uint256 usdtAmount) external payable',
  'function repay(uint256 amount) external',
  'function withdrawMnt(uint256 amount) external',
  'function getPosition(address user) view returns (uint256, uint256, uint256, uint256)',
];

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
];

interface VaultStatus {
  priceUsd: number;
  priceFresh: boolean;
  ltvBps: number;
  liquidationLtvBps: number;
  usdtReserves: string;
}

interface VaultPosition {
  mntCollateral: string;
  usdtDebt: string;
  maxDebt: string;
  ltvBps: string;
}

interface Props {
  address: string;
  usdtAddress: string;
}

export function MntCollateralCard({ address, usdtAddress }: Props) {
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [position, setPosition] = useState<VaultPosition | null>(null);
  const [mntInput, setMntInput] = useState('');
  const [usdtInput, setUsdtInput] = useState('');
  const [repayInput, setRepayInput] = useState('');
  const [withdrawInput, setWithdrawInput] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; msg: string; tx?: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [s, p] = await Promise.all([
        fetch(apiUrl('/api/mnt-vault/status')).then((r) => r.json()),
        fetch(apiUrl(`/api/mnt-vault/position/${address}`)).then((r) => r.json()),
      ]);
      if (s.success) setStatus(s.data);
      if (p.success) setPosition(p.data);
    } catch {
      /* ignore */
    }
  }, [address]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15_000);
    return () => clearInterval(t);
  }, [refresh]);

  const mntCol = position ? Number(formatEther(position.mntCollateral)) : 0;
  const debt = position ? Number(formatUnits(position.usdtDebt, 6)) : 0;
  const maxDebt = position ? Number(formatUnits(position.maxDebt, 6)) : 0;
  const currentLtv = position ? Number(position.ltvBps) / 100 : 0;
  const reservesAvail = status ? Number(formatUnits(status.usdtReserves, 6)) : 0;

  // Preview borrow
  const previewMntWei = mntInput && !isNaN(Number(mntInput)) ? parseEther(mntInput || '0') : 0n;
  const previewExtraMnt = previewMntWei > 0n ? Number(formatEther(previewMntWei)) : 0;
  const previewMntUsd = status ? previewExtraMnt * status.priceUsd : 0;
  const previewMaxBorrow = previewMntUsd * (status ? status.ltvBps / 10000 : 0);
  const totalMaxAfter = maxDebt + previewMaxBorrow;
  const requestedBorrow = usdtInput && !isNaN(Number(usdtInput)) ? Number(usdtInput) : 0;
  const wouldExceedLtv = requestedBorrow > 0 && debt + requestedBorrow > totalMaxAfter;
  const exceedsReserves = requestedBorrow > reservesAvail;

  async function doBorrow() {
    setResult(null);
    if (!getEth()) return;
    if (!mntInput && !usdtInput) {
      setResult({ ok: false, msg: 'Enter MNT to lock and/or USDT0 to borrow' });
      return;
    }
    setBusy('borrow');
    try {
      const provider = new BrowserProvider(getEth()!);
      const signer = await provider.getSigner();
      const vault = new Contract(MNT_VAULT_ADDRESS, MNT_VAULT_ABI, signer);
      const mntWei = mntInput && Number(mntInput) > 0 ? parseEther(mntInput) : 0n;
      const usdtAmount = usdtInput && Number(usdtInput) > 0 ? parseUnits(usdtInput, 6) : 0n;
      const tx = await vault.borrow(usdtAmount, { value: mntWei });
      const rcpt = await tx.wait();
      setResult({
        ok: true,
        msg:
          (mntWei > 0n ? `Locked ${mntInput} MNT` : '') +
          (mntWei > 0n && usdtAmount > 0n ? ' • ' : '') +
          (usdtAmount > 0n ? `Borrowed ${usdtInput} USDT0` : ''),
        tx: rcpt!.hash,
      });
      setMntInput('');
      setUsdtInput('');
      refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Transaction failed';
      setResult({ ok: false, msg: msg.includes('user rejected') ? 'Transaction cancelled' : msg.slice(0, 200) });
    } finally {
      setBusy(null);
    }
  }

  async function doRepay() {
    setResult(null);
    if (!getEth() || !repayInput) return;
    setBusy('repay');
    try {
      const provider = new BrowserProvider(getEth()!);
      const signer = await provider.getSigner();
      const usdt = new Contract(usdtAddress, ERC20_ABI, signer);
      const vault = new Contract(MNT_VAULT_ADDRESS, MNT_VAULT_ABI, signer);
      const amount = parseUnits(repayInput, 6);
      const allowance: bigint = await usdt.allowance(address, MNT_VAULT_ADDRESS);
      if (allowance < amount) {
        const a = await usdt.approve(MNT_VAULT_ADDRESS, amount);
        await a.wait();
      }
      const tx = await vault.repay(amount);
      const rcpt = await tx.wait();
      setResult({ ok: true, msg: `Repaid ${repayInput} USDT0`, tx: rcpt!.hash });
      setRepayInput('');
      refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Repay failed';
      setResult({ ok: false, msg: msg.includes('user rejected') ? 'Transaction cancelled' : msg.slice(0, 200) });
    } finally {
      setBusy(null);
    }
  }

  async function doWithdraw() {
    setResult(null);
    if (!getEth() || !withdrawInput) return;
    setBusy('withdraw');
    try {
      const provider = new BrowserProvider(getEth()!);
      const signer = await provider.getSigner();
      const vault = new Contract(MNT_VAULT_ADDRESS, MNT_VAULT_ABI, signer);
      const tx = await vault.withdrawMnt(parseEther(withdrawInput));
      const rcpt = await tx.wait();
      setResult({ ok: true, msg: `Withdrew ${withdrawInput} MNT`, tx: rcpt!.hash });
      setWithdrawInput('');
      refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Withdraw failed';
      setResult({ ok: false, msg: msg.includes('user rejected') ? 'Transaction cancelled' : msg.slice(0, 200) });
    } finally {
      setBusy(null);
    }
  }

  const ltvColor = currentLtv >= 75 ? 'text-red-400' : currentLtv >= 60 ? 'text-amber-400' : 'text-emerald-400';

  return (
    <div className="glass-card p-6 mt-6">
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-800/80">
        <div className="flex items-center gap-2">
          <Coins className="w-5 h-5 text-cyan-400" />
          <h3 className="text-sm font-semibold text-white">MNT-Collateralized Borrow</h3>
          <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">v2 · Live</span>
        </div>
        <button onClick={refresh} className="text-slate-500 hover:text-slate-300 transition-colors" aria-label="Refresh">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Stat label="MNT Price" value={status ? `$${status.priceUsd.toFixed(4)}` : '…'} sub={status ? (status.priceFresh ? 'Fresh' : 'Stale') : ''} subColor={status?.priceFresh ? 'text-emerald-400' : 'text-amber-400'} />
        <Stat label="Max LTV" value={status ? `${status.ltvBps / 100}%` : '…'} sub={status ? `Liq @ ${status.liquidationLtvBps / 100}%` : ''} />
        <Stat label="Your Collateral" value={`${mntCol.toFixed(4)} MNT`} sub={status ? `≈ $${(mntCol * status.priceUsd).toFixed(2)}` : ''} />
        <Stat label="Your Debt" value={`${debt.toFixed(2)} USDT0`} sub={`LTV ${currentLtv.toFixed(1)}%`} subColor={ltvColor} />
      </div>

      {/* Borrow form */}
      <div className="bg-slate-950/60 rounded-xl p-4 border border-cyan-900/30 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <ArrowDownCircle className="w-4 h-4 text-cyan-400" />
          <p className="text-xs font-semibold text-cyan-400 uppercase tracking-wider">Lock MNT → Borrow USDT0</p>
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">MNT to Lock</label>
            <div className="relative">
              <input
                type="number"
                step="0.01"
                min="0"
                value={mntInput}
                onChange={(e) => setMntInput(e.target.value)}
                placeholder="0.0"
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50 font-mono"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-medium text-slate-500 uppercase">MNT</span>
            </div>
          </div>
          <div>
            <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">USDT0 to Borrow</label>
            <div className="relative">
              <input
                type="number"
                step="0.01"
                min="0"
                value={usdtInput}
                onChange={(e) => setUsdtInput(e.target.value)}
                placeholder={`Max ${totalMaxAfter.toFixed(2)}`}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50 font-mono"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-medium text-slate-500 uppercase">USDT0</span>
            </div>
          </div>
        </div>

        {(previewExtraMnt > 0 || requestedBorrow > 0) && (
          <div className="text-[11px] text-slate-400 bg-slate-900/50 rounded-md px-3 py-2 space-y-1">
            {previewExtraMnt > 0 && (
              <div>+ {previewExtraMnt.toFixed(4)} MNT collateral worth <span className="text-white">${previewMntUsd.toFixed(2)}</span> → unlocks <span className="text-cyan-400">${previewMaxBorrow.toFixed(2)}</span> at {(status?.ltvBps ?? 0) / 100}% LTV</div>
            )}
            {requestedBorrow > 0 && (
              <div>Headroom after this tx: <span className={wouldExceedLtv ? 'text-red-400' : 'text-emerald-400'}>{(totalMaxAfter - debt - requestedBorrow).toFixed(2)} USDT0</span></div>
            )}
            {exceedsReserves && <div className="text-red-400">⚠ Vault has only {reservesAvail.toFixed(2)} USDT0 in reserves</div>}
          </div>
        )}

        <button
          onClick={doBorrow}
          disabled={busy !== null || (!mntInput && !usdtInput) || wouldExceedLtv || exceedsReserves}
          className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-cyan-500 px-4 py-2.5 text-sm font-bold text-white hover:bg-cyan-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy === 'borrow' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Lock className="w-3.5 h-3.5" />}
          {busy === 'borrow' ? 'Submitting…' : 'Lock MNT & Borrow USDT0'}
        </button>

        <p className="text-[10px] text-slate-500">
          Native MNT lock · oracle price (CoinGecko, refreshed every 5min) · liquidation at {status ? status.liquidationLtvBps / 100 : 80}% LTV. No score check — anyone can borrow.
        </p>
      </div>

      {/* Repay + Withdraw */}
      {(debt > 0 || mntCol > 0) && (
        <div className="grid md:grid-cols-2 gap-3 mt-4">
          {debt > 0 && (
            <div className="bg-slate-950/60 rounded-xl p-4 border border-slate-800/60">
              <div className="flex items-center gap-2 mb-3">
                <ArrowUpCircle className="w-4 h-4 text-emerald-400" />
                <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">Repay USDT0</p>
              </div>
              <div className="flex gap-2">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={repayInput}
                  onChange={(e) => setRepayInput(e.target.value)}
                  placeholder={`Max ${debt.toFixed(2)}`}
                  className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/50 font-mono"
                />
                <button onClick={() => setRepayInput(debt.toFixed(6))} className="text-[10px] font-bold text-emerald-400 hover:text-emerald-300 px-2">MAX</button>
                <button
                  onClick={doRepay}
                  disabled={busy !== null || !repayInput}
                  className="rounded-lg bg-emerald-500 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-400 disabled:opacity-50"
                >
                  {busy === 'repay' ? <RefreshCw className="w-3 h-3 animate-spin" /> : 'Repay'}
                </button>
              </div>
            </div>
          )}

          {mntCol > 0 && (
            <div className="bg-slate-950/60 rounded-xl p-4 border border-slate-800/60">
              <div className="flex items-center gap-2 mb-3">
                <ArrowUpCircle className="w-4 h-4 text-amber-400" />
                <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider">Withdraw MNT</p>
              </div>
              <div className="flex gap-2">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={withdrawInput}
                  onChange={(e) => setWithdrawInput(e.target.value)}
                  placeholder={`Max ${mntCol.toFixed(4)}`}
                  className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-amber-500/50 font-mono"
                />
                <button onClick={() => setWithdrawInput(mntCol.toFixed(6))} className="text-[10px] font-bold text-amber-400 hover:text-amber-300 px-2">MAX</button>
                <button
                  onClick={doWithdraw}
                  disabled={busy !== null || !withdrawInput}
                  className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-bold text-white hover:bg-amber-400 disabled:opacity-50"
                >
                  {busy === 'withdraw' ? <RefreshCw className="w-3 h-3 animate-spin" /> : 'Withdraw'}
                </button>
              </div>
              <p className="text-[10px] text-slate-500 mt-2">Only allowed if remaining MNT still covers debt at {status ? status.ltvBps / 100 : 70}% LTV.</p>
            </div>
          )}
        </div>
      )}

      {result && (
        <div className={`mt-4 p-3 rounded-lg flex items-start gap-2 text-xs ${result.ok ? 'bg-cyan-950/30 border border-cyan-900/50 text-cyan-300' : 'bg-red-950/30 border border-red-900/50 text-red-400'}`}>
          {result.ok ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" /> : <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
          <div className="flex-1">
            <div>{result.msg}</div>
            {result.tx && (
              <a href={`https://mantlescan.xyz/tx/${result.tx}`} target="_blank" rel="noreferrer" className="underline text-cyan-400 hover:text-cyan-300 break-all">
                {result.tx.slice(0, 12)}…{result.tx.slice(-8)}
              </a>
            )}
          </div>
        </div>
      )}

      <p className="mt-4 text-[10px] text-slate-600">
        Vault: <a href={`https://mantlescan.xyz/address/${MNT_VAULT_ADDRESS}`} target="_blank" rel="noreferrer" className="underline hover:text-slate-400">{MNT_VAULT_ADDRESS.slice(0, 8)}…{MNT_VAULT_ADDRESS.slice(-6)}</a>
        {status && <> · Reserves available: <span className="text-slate-500">{reservesAvail.toFixed(2)} USDT0</span></>}
      </p>
    </div>
  );
}

function Stat({ label, value, sub, subColor }: { label: string; value: string; sub?: string; subColor?: string }) {
  return (
    <div className="bg-slate-950/60 rounded-xl p-3 border border-slate-800/60">
      <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">{label}</p>
      <p className="text-sm font-bold text-white font-mono">{value}</p>
      {sub && <p className={`text-[10px] mt-0.5 ${subColor || 'text-slate-500'}`}>{sub}</p>}
    </div>
  );
}
