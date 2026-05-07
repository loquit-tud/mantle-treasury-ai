import { useState, useEffect, useCallback } from 'react';
import { BrowserProvider, Contract, parseUnits, formatUnits, formatEther } from 'ethers';
import { apiUrl } from '../utils/api';
import {
  Wallet,
  Activity,
  RefreshCw,
  CheckCircle2,
  History,
  TrendingDown,
  Upload,
  ArrowDownCircle,
  ArrowUpCircle,
  AlertCircle,
  LogOut,
  Shield,
} from 'lucide-react';
import { formatAmount, formatPercentage } from '../utils/format';
import type { CreditProfile, Loan, DefaultPrediction } from '../types';
import { WalletPickerModal } from '../components/WalletPickerModal';
import type { EIP1193Provider } from '../hooks/useWalletProviders';
import { setSelectedProvider, getEth } from '../hooks/selectedProvider';

// Constants using Vite Env
const TREASURY_VAULT_ADDRESS = import.meta.env.VITE_TREASURY_VAULT_ADDRESS || '0xb52718aEc4Bc8459Ac97A276CB2d0798B25b17F0';
const USDT_ADDRESS = import.meta.env.VITE_USDT_ADDRESS || '0x779Ded0c9e1022225f8E0630b35a9b54bE713736';
const CREDIT_LINE_ADDRESS = import.meta.env.VITE_CREDIT_LINE_ADDRESS || '0xACd7fec284d6059FB1F151BD03AbaE3cB71dB18c';
// Note: CollateralLock is intentionally NOT used in the borrow flow anymore.
// Quorum is uncollateralized credit (revenue-backed lending). MNT collateral coming in v2.
const EXPECTED_CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID || '5000');
const CHAIN_NAME = import.meta.env.VITE_CHAIN_NAME || 'Mantle Mainnet';
const RPC_URL = import.meta.env.VITE_RPC_URL || 'https://rpc.mantle.xyz';

/** Ensure MetaMask is on the correct chain; auto-add if missing */
async function ensureCorrectChain(): Promise<void> {
  const eth = getEth();
  if (!eth) return;
  const hexChainId = '0x' + EXPECTED_CHAIN_ID.toString(16);
  try {
    await eth.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: hexChainId }],
    });
  } catch (switchErr: unknown) {
    // 4902 = chain not added yet
    if ((switchErr as { code?: number }).code === 4902) {
      await eth.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: hexChainId,
          chainName: CHAIN_NAME,
          rpcUrls: [RPC_URL],
          nativeCurrency: { name: 'Mantle', symbol: 'MNT', decimals: 18 },
        }],
      });
    } else {
      throw switchErr;
    }
  }
}

// Contract ABIs
const VAULT_ABI = [
  "function deposit(uint256 amount) external",
  "function getBalance() external view returns (uint256)",
  "function emergencyWithdraw(address to, uint256 amount) external",
];
const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address owner) external view returns (uint256)",
  "function allowance(address owner, address spender) external view returns (uint256)",
];
const CREDIT_LINE_ABI = [
  "function repay(uint256 loanId, uint256 amount) external",
  "function getAmountDue(uint256 loanId) external view returns (uint256)",
];

export default function WalletPage() {
  const [address, setAddress] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [ethBal, setEthBal] = useState<string | null>(null);
  const [usdtBal, setUsdtBal] = useState<string | null>(null);
  const [showNoWalletCard, setShowNoWalletCard] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const finishConnect = useCallback(async () => {
    const eth = getEth();
    if (!eth) return;
    localStorage.removeItem('wallet-disconnected');

    // 1. Request accounts FIRST (most wallets refuse chain switch without account permission)
    let accounts: string[] = [];
    try {
      const perms = await eth.request({
        method: 'wallet_requestPermissions',
        params: [{ eth_accounts: {} }],
      }) as Array<{ caveats?: Array<{ type: string; value: unknown }> }>;
      const caveat = perms?.[0]?.caveats?.find((c) => c.type === 'restrictReturnedAccounts');
      if (caveat && Array.isArray(caveat.value)) {
        accounts = caveat.value as string[];
      }
    } catch {
      // permissions not supported — fallback below
    }
    if (accounts.length === 0) {
      accounts = await eth.request({ method: 'eth_requestAccounts' }) as string[];
    }
    if (!accounts || accounts.length === 0) {
      throw new Error('No account selected in wallet.');
    }

    // 2. NOW switch chain (wallet has accounts authorized)
    try {
      await ensureCorrectChain();
    } catch (chainErr) {
      console.warn('Chain switch failed (continuing):', chainErr);
    }

    const provider = new BrowserProvider(eth);
    const addr = accounts[0] as string;
    setAddress(addr);
    setIsConnected(true);
    try {
      const ethBalRaw = await provider.getBalance(addr);
      setEthBal(formatEther(ethBalRaw));
      const usdt = new Contract(USDT_ADDRESS, ERC20_ABI, provider);
      const bal = await usdt.balanceOf(addr);
      setUsdtBal(formatUnits(bal, 6));
      try {
        const vault = new Contract(TREASURY_VAULT_ADDRESS, VAULT_ABI, provider);
        const vBal = await vault.getBalance();
        setVaultBal(formatUnits(vBal, 6));
      } catch {
        // vault read optional
      }
    } catch (balErr) {
      console.warn('Balance fetch failed:', balErr);
    }
  }, []);

  const handleProviderSelected = useCallback(async (chosen: EIP1193Provider, name: string) => {
    setPickerOpen(false);
    setConnectError(null);
    try {
      // Store globally so all subsequent calls use the chosen provider.
      setSelectedProvider(chosen);
      localStorage.setItem('wallet-last', name);
      await finishConnect();
    } catch (err) {
      const msg = (err as { message?: string })?.message || String(err);
      console.error('Wallet connect failed:', err);
      setConnectError(`${name}: ${msg}`);
    }
  }, [finishConnect]);

  const connectWallet = useCallback(async () => {
    if (!getEth()) { setShowNoWalletCard(true); return; }
    // Always show picker so user can choose between MetaMask / Rabby / etc.
    setPickerOpen(true);
  }, []);

  const disconnectWallet = useCallback(async () => {
    localStorage.setItem('wallet-disconnected', 'true');
    // Try revoking MetaMask permissions so eth_accounts returns []
    try {
      await getEth()?.request({
        method: 'wallet_revokePermissions',
        params: [{ eth_accounts: {} }],
      });
    } catch {
      // Older MetaMask versions don't support this — flag handles it
    }
    setSelectedProvider(null);
    setAddress(null);
    setIsConnected(false);
    setEthBal(null);
    setUsdtBal(null);
    setCreditProfile(null);
    setLoans([]);
    setLookupAddress('');
    setTxHash(null);
    setBorrowResult(null);
    setRepayResult(null);
  }, []);

  // Auto-connect if already authorized (skip if user explicitly disconnected)
  useEffect(() => {
    if (localStorage.getItem('wallet-disconnected')) return;
    const lastName = localStorage.getItem('wallet-last');
    if (!lastName) return; // never auto-connect a wallet the user hasn't picked

    let cancelled = false;

    const tryConnect = async (eth: EIP1193Provider) => {
      if (cancelled) return;
      try {
        const provider = new BrowserProvider(eth);
        const accs: string[] = await provider.send('eth_accounts', []);
        if (!cancelled && accs.length > 0) {
          setSelectedProvider(eth);
          await finishConnect();
        }
      } catch {
        // ignore
      }
    };

    // Re-discover ONLY the previously chosen wallet via EIP-6963 — no fallback to window.ethereum
    // (window.ethereum is hijacked by whichever extension wins the race — usually MetaMask
    //  even when the user actually connected Trust / Rabby / etc.)
    const onAnnounce = (e: Event) => {
      const detail = (e as CustomEvent).detail as { info?: { name?: string }; provider?: EIP1193Provider };
      if (!detail?.info?.name || !detail.provider) return;
      if (detail.info.name === lastName) {
        tryConnect(detail.provider);
      }
    };
    window.addEventListener('eip6963:announceProvider', onAnnounce as EventListener);
    window.dispatchEvent(new Event('eip6963:requestProvider'));

    return () => {
      cancelled = true;
      window.removeEventListener('eip6963:announceProvider', onAnnounce as EventListener);
    };
  }, [finishConnect]);

  const [isCheckingCredit, setIsCheckingCredit] = useState(false);
  const [creditCheckError, setCreditCheckError] = useState<string | null>(null);
  const [creditProfile, setCreditProfile] = useState<CreditProfile | null>(null);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [depositAmount, setDepositAmount] = useState('');
  const [isDepositing, setIsDepositing] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [withdrawTxHash, setWithdrawTxHash] = useState<string | null>(null);
  const [vaultBal, setVaultBal] = useState<string | null>(null);
  
  const [lookupAddress, setLookupAddress] = useState('');

  // Borrow state
  const [borrowAmount, setBorrowAmount] = useState('');
  const [isBorrowing, setIsBorrowing] = useState(false);
  const [borrowResult, setBorrowResult] = useState<{ success: boolean; message: string } | null>(null);

  // Repay state
  const [repayLoanId, setRepayLoanId] = useState<number | null>(null);
  const [repayAmount, setRepayAmount] = useState('');
  const [isRepaying, setIsRepaying] = useState(false);
  const [repayResult, setRepayResult] = useState<{ success: boolean; message: string } | null>(null);

  // ML Prediction state (populated from evaluate response)
  const [mlPrediction, setMlPrediction] = useState<DefaultPrediction | null>(null);

  // Loan history state (all loans including repaid/defaulted)
  const [loanHistory, setLoanHistory] = useState<Loan[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // Sync lookup address with connected address initially
  useEffect(() => {
    if (address && !lookupAddress) {
      setLookupAddress(address);
    }
  }, [address]);

  // Fetch initial user data (only if profile exists already)
  useEffect(() => {
    if (address && isConnected) {
      fetch(apiUrl(`/api/credit/${address.toLowerCase()}`))
        .then(res => res.json())
        .then(data => {
            if (data.success && data.data && data.data.exists) {
                setCreditProfile(data.data as CreditProfile);
                setLookupAddress(address);
                fetchLoans();
            }
        })
        .catch(console.error);
    } else {
        setCreditProfile(null);
        setLoans([]);
    }
  }, [address, isConnected]);

  const fetchLoans = async () => {
    const target = lookupAddress || address;
    if (!target) return;
    try {
        const res = await fetch(apiUrl(`/api/credit/${target.toLowerCase()}/loans`));
        const data = await res.json();
        if (data.success) {
            setLoans(data.data as Loan[]);
        }
    } catch (err) {
        console.error(err);
    }
  };

  const fetchLoanHistory = async () => {
    const target = lookupAddress || address;
    if (!target) return;
    try {
        const res = await fetch(apiUrl(`/api/credit/${target.toLowerCase()}/history`));
        const data = await res.json();
        if (data.success) {
            setLoanHistory(data.data as Loan[]);
        }
    } catch (err) {
        console.error(err);
    }
  };

  const handleBorrow = async () => {
    const target = lookupAddress || address;
    if (!target || !borrowAmount || isNaN(Number(borrowAmount)) || Number(borrowAmount) <= 0) return;
    if (!getEth()) { setShowNoWalletCard(true); return; }
    setIsBorrowing(true);
    setBorrowResult(null);
    try {
      // Uncollateralized credit — the agent issues the loan based purely on the on-chain reputation score.
      // No collateral lock here; that defeats the "revenue-backed lending" thesis.
      const parsedAmount = parseUnits(borrowAmount, 6);
      const wei = parsedAmount.toString();
      const res = await fetch(apiUrl(`/api/credit/${target.toLowerCase()}/borrow`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: wei }),
      });
      const data = await res.json();
      if (data.success) {
        setBorrowResult({ success: true, message: `Borrowed ${borrowAmount} USDT0 — Loan #${data.data.id}` });
        setBorrowAmount('');
        checkCreditScore();
        fetchLoans();
      } else {
        setBorrowResult({ success: false, message: data.error || 'Borrow declined by Credit Agent' });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Transaction error';
      setBorrowResult({ success: false, message: msg.includes('user rejected') ? 'Transaction cancelled' : msg });
    } finally {
      setIsBorrowing(false);
    }
  };

  const handleRepay = async (loanId: number) => {
    const target = lookupAddress || address;
    if (!target || !repayAmount || isNaN(Number(repayAmount)) || Number(repayAmount) <= 0) return;
    if (!getEth()) { setShowNoWalletCard(true); return; }
    setIsRepaying(true);
    setRepayResult(null);
    try {
      await ensureCorrectChain();
      const provider = new BrowserProvider(getEth()!);
      const signer = await provider.getSigner();
      const parsedAmount = parseUnits(repayAmount, 6);

      // 1. Approve USDt for CreditLine
      const usdtContract = new Contract(USDT_ADDRESS, ERC20_ABI, signer);
      const allowance = await usdtContract.allowance(target, CREDIT_LINE_ADDRESS);
      if (allowance < parsedAmount) {
        const approveTx = await usdtContract.approve(CREDIT_LINE_ADDRESS, parsedAmount);
        await approveTx.wait();
      }

      // 2. Repay directly from borrower's wallet
      const creditLine = new Contract(CREDIT_LINE_ADDRESS, CREDIT_LINE_ABI, signer);
      const repayTx = await creditLine.repay(loanId, parsedAmount);
      await repayTx.wait();

      // 3. Notify backend to sync local state
      fetch(apiUrl(`/api/credit/${target.toLowerCase()}/repay`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loanId, amount: parsedAmount.toString(), onChainDone: true }),
      }).catch(() => {});

      // Refresh USDt balance
      const newBal = await usdtContract.balanceOf(target);
      setUsdtBal(formatUnits(newBal, 6));

      setRepayResult({ success: true, message: `Repaid ${repayAmount} USDt on Loan #${loanId}` });
      setRepayAmount('');
      setRepayLoanId(null);
      fetchLoans();
      checkCreditScore();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('user rejected') || msg.includes('ACTION_REJECTED')) {
        setRepayResult({ success: false, message: 'Transaction cancelled by user' });
      } else if (msg.includes('exceeds balance') || msg.includes('insufficient')) {
        setRepayResult({ success: false, message: 'Insufficient USDt balance' });
      } else {
        setRepayResult({ success: false, message: msg.slice(0, 120) });
      }
    } finally {
      setIsRepaying(false);
    }
  };

  const checkCreditScore = async () => {
    const target = lookupAddress.trim();
    if (!target) return;
    if (!/^0x[a-fA-F0-9]{40}$/.test(target)) {
      setCreditCheckError('Enter a full wallet address (42 chars), not a shortened one like 0x1234...abcd.');
      return;
    }

    setIsCheckingCredit(true);
    setCreditCheckError(null);
    try {
      const res = await fetch(apiUrl(`/api/credit/${target.toLowerCase()}/evaluate`), { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setCreditProfile(data.data as CreditProfile);
        if (data.data.mlPrediction) setMlPrediction(data.data.mlPrediction as DefaultPrediction);
        fetchLoans();
      } else {
        setCreditCheckError(data.error || 'Credit evaluation failed. Try again in a moment.');
      }
    } catch (err) {
      console.error(err);
      setCreditCheckError('Network error while evaluating wallet. Please retry.');
    } finally {
      setIsCheckingCredit(false);
    }
  };

  const handleDeposit = async () => {
    if (!address || !depositAmount || isNaN(Number(depositAmount))) return;
    
    // Check if window.ethereum exists
    if (!getEth()) { setShowNoWalletCard(true); return; }

    setIsDepositing(true);
    setTxHash(null);
    try {
      await ensureCorrectChain();
      // 1. Setup Ethers Provider & Signer
      const provider = new BrowserProvider(getEth()!);
      const signer = await provider.getSigner();
      
      const usdtContract = new Contract(USDT_ADDRESS, ERC20_ABI, signer);
      const vaultContract = new Contract(TREASURY_VAULT_ADDRESS, VAULT_ABI, signer);
      
      const parsedAmount = parseUnits(depositAmount, 6); // USDt has 6 decimals

      // 2. Check Allowance & Approve
      const allowance = await usdtContract.allowance(address, TREASURY_VAULT_ADDRESS);
      if (allowance < parsedAmount) {
         const approveTx = await usdtContract.approve(TREASURY_VAULT_ADDRESS, parsedAmount);
         await approveTx.wait();
      }

      // 3. Deposit
      const depositTx = await vaultContract.deposit(parsedAmount);
      await depositTx.wait();

      setTxHash(depositTx.hash);
      setDepositAmount('');

      // Refresh balances after deposit
      const newBal = await usdtContract.balanceOf(address);
      setUsdtBal(formatUnits(newBal, 6));
      const vBal = await vaultContract.getBalance();
      setVaultBal(formatUnits(vBal, 6));
    } catch (err: unknown) {
      console.error('Deposit error:', err);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('user rejected') || msg.includes('ACTION_REJECTED')) {
        alert('Transaction cancelled by user.');
      } else if (msg.includes('insufficient')) {
        alert('Insufficient USDt balance.');
      } else {
        alert(`Deposit failed: ${msg.slice(0, 120)}`);
      }
    } finally {
      setIsDepositing(false);
    }
  };

  const handleWithdraw = async () => {
    if (!address || !withdrawAmount || isNaN(Number(withdrawAmount))) return;
    if (!getEth()) { setShowNoWalletCard(true); return; }
    setIsWithdrawing(true);
    setWithdrawTxHash(null);
    try {
      await ensureCorrectChain();
      const provider = new BrowserProvider(getEth()!);
      const signer = await provider.getSigner();
      const vaultContract = new Contract(TREASURY_VAULT_ADDRESS, VAULT_ABI, signer);
      const usdtContract = new Contract(USDT_ADDRESS, ERC20_ABI, signer);
      const parsedAmount = parseUnits(withdrawAmount, 6);

      const tx = await vaultContract.emergencyWithdraw(address, parsedAmount);
      await tx.wait();

      setWithdrawTxHash(tx.hash);
      setWithdrawAmount('');

      const newBal = await usdtContract.balanceOf(address);
      setUsdtBal(formatUnits(newBal, 6));
      const vBal = await vaultContract.getBalance();
      setVaultBal(formatUnits(vBal, 6));
    } catch (err: unknown) {
      console.error('Withdraw error:', err);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('user rejected') || msg.includes('ACTION_REJECTED')) {
        alert('Transaction cancelled by user.');
      } else if (msg.includes('insufficient')) {
        alert('Vault has insufficient balance for that amount.');
      } else {
        alert(`Withdraw failed: ${msg.slice(0, 120)}`);
      }
    } finally {
      setIsWithdrawing(false);
    }
  };

  // Determine Credit Tier & Color
  const getCreditTier = (score: number) => {
    if (score >= 800) return { label: 'Excellent', color: 'text-indigo-300', stroke: '#818cf8' };
    if (score >= 700) return { label: 'Good', color: 'text-sky-300', stroke: '#38bdf8' };
    if (score >= 600) return { label: 'Fair', color: 'text-amber-300', stroke: '#fbbf24' };
    return { label: 'Poor', color: 'text-red-400', stroke: '#f87171' };
  };

  const tierInfo = creditProfile ? getCreditTier(creditProfile.score) : null;
  const scorePercent = creditProfile ? Math.min(Math.max((creditProfile.score - 300) / 550 * 100, 0), 100) : 0;

  const activeLoans = loans.filter(l => l.active);

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-5xl mx-auto">
      <WalletPickerModal open={pickerOpen} onClose={() => setPickerOpen(false)} onSelect={handleProviderSelected} />
      {connectError && (
        <div className="flex items-start gap-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200" role="alert">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
          <div className="flex-1">
            <p className="font-medium text-rose-100">Wallet connection failed</p>
            <p className="mt-1 break-words text-xs text-rose-200/80">{connectError}</p>
          </div>
          <button
            type="button"
            onClick={() => setConnectError(null)}
            className="text-xs text-rose-200/70 transition-colors hover:text-white"
          >
            Dismiss
          </button>
        </div>
      )}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
              {/* ── No Wallet Onboarding Card ── */}
              {showNoWalletCard && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm" onClick={() => setShowNoWalletCard(false)} role="presentation">
                  <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-2xl" onClick={e => e.stopPropagation()} role="dialog" aria-labelledby="wallet-modal-title">
                    <div className="mb-5 flex items-center gap-3">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-indigo-500/30 bg-indigo-500/10">
                        <Shield className="h-6 w-6 text-indigo-300" />
                      </div>
                      <div>
                        <h3 id="wallet-modal-title" className="text-lg font-semibold text-white">Wallet required</h3>
                        <p className="text-xs text-slate-400">Deposits and credit actions need a browser wallet (e.g. MetaMask).</p>
                      </div>
                    </div>
                    <div className="mb-6 space-y-3">
                      <div className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-xs font-bold text-slate-400">1</span>
                        <div>
                          <p className="text-sm font-semibold text-white">Install a wallet</p>
                          <p className="text-xs text-slate-400">Browser extension — Chrome, Firefox, or Brave.</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-xs font-bold text-slate-400">2</span>
                        <div>
                          <p className="text-sm font-semibold text-white">Use Mantle</p>
                          <p className="text-xs text-slate-400">RPC: rpc.mantle.xyz · Chain ID: 5000 · Symbol: MNT</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-xs font-bold text-slate-400">3</span>
                        <div>
                          <p className="text-sm font-semibold text-white">Connect when ready</p>
                          <p className="text-xs text-slate-400">You can explore the dashboard without connecting.</p>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <a
                        href="https://metamask.io/download/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 rounded-xl bg-indigo-500 py-2.5 text-center text-sm font-semibold text-white transition-colors hover:bg-indigo-400"
                      >
                        Get MetaMask
                      </a>
                      <button
                        type="button"
                        onClick={() => setShowNoWalletCard(false)}
                        className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm text-slate-400 transition-colors hover:border-slate-600 hover:text-white"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                </div>
              )}

         <div>
            <h2 className="text-2xl font-bold tracking-tight text-gradient-brand">Your Portfolio</h2>
            <p className="text-sm text-slate-400">Manage your connected wallet, credit, and vault deposits.</p>
         </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* Wallet Overview Panel */}
        <div className="md:col-span-1 space-y-6">
            <div className="glass-card p-6">
                <div className="flex items-center gap-3 mb-6 pb-6 border-b border-slate-800/80">
                   <div className="w-10 h-10 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center">
                      <Wallet className="w-5 h-5 text-slate-300" />
                   </div>
                   <div>
                       <h3 className="text-sm font-semibold text-white">Connected Wallet</h3>
                       <p className="text-xs text-slate-400 mt-0.5">
                         {isConnected ? `${address?.slice(0, 6)}...${address?.slice(-4)}` : 'Not Connected'}
                       </p>
                   </div>
                </div>

                {isConnected ? (
                  <div className="space-y-4">
                     <button
                        onClick={disconnectWallet}
                        className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-xs font-medium text-slate-400 hover:bg-slate-700 hover:text-white transition-all border border-slate-700"
                     >
                        <LogOut className="w-3.5 h-3.5" /> Disconnect Wallet
                     </button>
                     <div className="bg-slate-950/50 rounded-xl p-4 border border-slate-800/50">
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">MNT Balance</p>
                        <p className="text-xl font-bold text-white">
                           {ethBal ? Number(ethBal).toFixed(4) : '0.0000'} <span className="text-sm text-slate-400 font-medium">MNT</span>
                        </p>
                     </div>
                     <div className="bg-slate-950/50 rounded-xl p-4 border border-slate-800/50">
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">USDT0 Balance</p>
                        <p className="text-xl font-bold text-white">
                           {usdtBal ? Number(usdtBal).toFixed(2) : '0.00'} <span className="text-sm text-slate-400 font-medium">USDT0</span>
                        </p>
                     </div>
                  </div>
                ) : (
                  <div className="py-8 flex flex-col items-center justify-center text-center">
                     <p className="text-sm text-slate-500 mb-4">Connect wallet to view balances</p>
                     <button onClick={connectWallet} className="inline-flex items-center gap-2 rounded-xl bg-indigo-500 px-5 py-2.5 text-sm font-bold text-white hover:bg-indigo-400 transition-all">
                        <Wallet className="w-4 h-4" /> Connect MetaMask
                     </button>
                  </div>
                )}
            </div>

            {/* Deposit Form */}
            {isConnected && (
              <div className="glass-card p-6">
                  <div className="flex items-center gap-2 mb-4">
                     <Upload className="w-4 h-4 text-indigo-400" />
                     <h3 className="text-sm font-semibold text-white">Deposit USDT0 to Treasury</h3>
                  </div>
                  <p className="text-xs text-slate-400 mb-2">Provide liquidity to the multi-sig vault. One-time approval required.</p>
                  <div className="mb-4 flex items-center justify-between text-[11px]">
                    <span className="text-slate-500">Wallet balance</span>
                    <span className="font-mono text-slate-300">{usdtBal ? Number(usdtBal).toFixed(4) : '0.0000'} USDT0</span>
                  </div>

                  <div className="space-y-3">
                     <div className="relative">
                       <input
                         type="number"
                         value={depositAmount}
                         onChange={(e) => setDepositAmount(e.target.value)}
                         placeholder="0.00"
                         className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 pr-28 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all font-mono"
                       />
                       <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                         <button
                           type="button"
                           onClick={() => { if (usdtBal) setDepositAmount(usdtBal); }}
                           disabled={!usdtBal || Number(usdtBal) <= 0}
                           className="rounded-md border border-indigo-500/30 bg-indigo-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-indigo-300 transition-colors hover:bg-indigo-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
                         >
                           Max
                         </button>
                         <span className="text-xs font-medium text-slate-500 uppercase tracking-wider pr-2">USDT0</span>
                       </div>
                     </div>
                     {depositAmount && usdtBal && Number(depositAmount) > Number(usdtBal) && (
                       <p className="text-[11px] text-rose-400">Amount exceeds wallet balance ({Number(usdtBal).toFixed(4)} USDT0).</p>
                     )}
                     <button
                        onClick={handleDeposit}
                        disabled={isDepositing || !depositAmount || Number(depositAmount) <= 0 || (!!usdtBal && Number(depositAmount) > Number(usdtBal))}
                        className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-500 transition-all shadow-[0_0_20px_-5px_rgba(99,102,241,0.45)] disabled:opacity-50 disabled:shadow-none disabled:cursor-not-allowed"
                     >
                       {isDepositing ? (
                         <><RefreshCw className="w-4 h-4 animate-spin" /> Depositing...</>
                       ) : (
                         <>Deposit {depositAmount || '0'} USDT0</>
                       )}
                     </button>
                  </div>
                  {txHash && (
                    <div className="mt-4 p-3 rounded-lg bg-indigo-950/30 border border-indigo-900/50 flex items-start gap-2">
                       <CheckCircle2 className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                       <div className="overflow-hidden flex-1">
                          <p className="text-xs text-indigo-400 font-medium mb-0.5">Deposit Successful</p>
                          <a
                            href={`https://mantlescan.xyz/tx/${txHash}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[10px] text-indigo-300 hover:text-indigo-200 underline truncate font-mono block"
                          >
                            {txHash}
                          </a>
                       </div>
                    </div>
                  )}
              </div>
            )}

            {/* Withdraw Form */}
            {isConnected && (
              <div className="glass-card p-6">
                  <div className="flex items-center gap-2 mb-4">
                     <LogOut className="w-4 h-4 text-amber-400" />
                     <h3 className="text-sm font-semibold text-white">Withdraw USDT0 from Treasury</h3>
                  </div>
                  <p className="text-xs text-slate-400 mb-2">Pull liquidity back to your wallet from the on-chain vault.</p>
                  <div className="mb-4 flex items-center justify-between text-[11px]">
                    <span className="text-slate-500">Liquid in vault (instantly withdrawable)</span>
                    <span className="font-mono text-slate-300">{vaultBal ? Number(vaultBal).toFixed(4) : '0.0000'} USDT0</span>
                  </div>
                  <p className="text-[10px] text-slate-500 mb-3 leading-relaxed">
                    Funds invested in yield (Aave aUSDT0) must first be unwound by the Treasury Agent before they become withdrawable here.
                  </p>
                  <div className="space-y-3">
                    <div className="relative">
                      <input
                        type="number"
                        value={withdrawAmount}
                        onChange={(e) => setWithdrawAmount(e.target.value)}
                        placeholder="0.00"
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 pr-28 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 transition-all font-mono"
                      />
                      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => { if (vaultBal) setWithdrawAmount(vaultBal); }}
                          disabled={!vaultBal || Number(vaultBal) <= 0}
                          className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-300 transition-colors hover:bg-amber-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          Max
                        </button>
                        <span className="text-xs font-medium text-slate-500 uppercase tracking-wider pr-2">USDT0</span>
                      </div>
                    </div>
                    {withdrawAmount && vaultBal && Number(withdrawAmount) > Number(vaultBal) && (
                      <p className="text-[11px] text-rose-400">Amount exceeds vault balance ({Number(vaultBal).toFixed(4)} USDT0).</p>
                    )}
                    <button
                      onClick={handleWithdraw}
                      disabled={isWithdrawing || !withdrawAmount || Number(withdrawAmount) <= 0 || (!!vaultBal && Number(withdrawAmount) > Number(vaultBal))}
                      className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 py-3 text-sm font-bold text-white hover:bg-amber-500 transition-all shadow-[0_0_20px_-5px_rgba(245,158,11,0.45)] disabled:opacity-50 disabled:shadow-none disabled:cursor-not-allowed"
                    >
                      {isWithdrawing ? (
                        <><RefreshCw className="w-4 h-4 animate-spin" /> Withdrawing...</>
                      ) : (
                        <>Withdraw {withdrawAmount || '0'} USDT0</>
                      )}
                    </button>
                  </div>
                  {withdrawTxHash && (
                    <div className="mt-4 p-3 rounded-lg bg-amber-950/30 border border-amber-900/50 flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      <div className="overflow-hidden flex-1">
                        <p className="text-xs text-amber-400 font-medium mb-0.5">Withdraw Successful</p>
                        <a
                          href={`https://mantlescan.xyz/tx/${withdrawTxHash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[10px] text-amber-300 hover:text-amber-200 underline truncate font-mono block"
                        >
                          {withdrawTxHash}
                        </a>
                      </div>
                    </div>
                  )}
              </div>
            )}
        </div>

        {/* Credit & Loans Panel */}
        <div className="md:col-span-2 space-y-6">
            {/* Credit Score Module */}
            <div className="glass-card p-8 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/5 rounded-full blur-[80px] pointer-events-none" />
                
                {!isConnected ? (
                   <div className="h-full min-h-[250px] flex flex-col items-center justify-center text-center">
                      <Activity className="w-12 h-12 text-slate-700 mb-4" />
                      <h3 className="text-lg font-semibold text-white mb-2">Credit System Locked</h3>
                      <p className="text-sm text-slate-400 max-w-sm mx-auto mb-6">Connect your wallet to evaluate your on-chain history and access uncollateralized credit lines.</p>
                      <button onClick={connectWallet} className="inline-flex items-center gap-2 rounded-xl bg-indigo-500 px-5 py-2.5 text-sm font-bold text-white hover:bg-indigo-400 transition-all">
                        <Wallet className="w-4 h-4" /> Connect MetaMask
                      </button>
                   </div>
                ) : !creditProfile ? (
                   <div className="h-full min-h-[250px] flex flex-col items-center justify-center text-center">
                      <div className="w-16 h-16 rounded-full bg-indigo-950/30 border border-indigo-900/50 flex items-center justify-center mb-6">
                         <Activity className="w-6 h-6 text-indigo-400" />
                      </div>
                      <h3 className="text-xl font-bold text-white mb-2">Check On-chain Credit Profile</h3>
                      <p className="text-sm text-slate-400 max-w-sm mx-auto mb-6">Our Credit Agent will analyze on-chain history and generate a score instantly.</p>
                      
                      <div className="flex w-full max-w-md mx-auto items-center gap-2 mb-4">
                        <input
                           type="text"
                           value={lookupAddress}
                           onChange={(e) => {
                             setLookupAddress(e.target.value);
                             if (creditCheckError) setCreditCheckError(null);
                           }}
                           placeholder="Enter 0x..."
                           className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 font-mono"
                        />
                      </div>

                      <button
                        onClick={checkCreditScore}
                        disabled={isCheckingCredit || !lookupAddress}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-500 px-6 py-3 text-sm font-bold text-white hover:bg-indigo-400 transition-all shadow-[0_0_20px_-5px_var(--color-indigo-500)] disabled:opacity-50"
                      >
                         {isCheckingCredit ? (
                            <><RefreshCw className="w-4 h-4 animate-spin" /> Analyzing History...</>
                         ) : (
                            <><Activity className="w-4 h-4" /> Evaluate Profile</>
                         )}
                      </button>
                      {creditCheckError && (
                        <p className="mt-3 text-xs text-red-400 max-w-md mx-auto">{creditCheckError}</p>
                      )}
                   </div>
                ) : (
                   <div className="flex flex-col sm:flex-row items-center gap-8 relative z-10">
                      {/* Gauge Chart */}
                      <div className="relative w-48 h-48 shrink-0 flex items-center justify-center">
                         <svg viewBox="0 0 36 36" className="w-full h-full transform -rotate-90">
                            {/* Background Circle */}
                            <path
                              className="text-slate-800"
                              strokeWidth="3"
                              stroke="currentColor"
                              fill="none"
                              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                            />
                            {/* Progress Circle line */}
                            <path
                              stroke={tierInfo?.stroke || '#4b5563'}
                              strokeWidth="3"
                              strokeDasharray={`${scorePercent}, 100`}
                              strokeLinecap="round"
                              fill="none"
                              className="transition-all duration-1000 ease-out"
                              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                            />
                         </svg>
                         <div className="absolute inset-0 flex flex-col items-center justify-center">
                            <span className="text-4xl font-extrabold text-white tracking-tight">{creditProfile.score}</span>
                            <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mt-1">Score</span>
                         </div>
                      </div>

                      {/* Score Details */}
                      <div className="flex-1 space-y-6 w-full text-center sm:text-left">
                         <div>
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                               <h3 className="text-2xl font-bold text-white">Credit Profile</h3>
                               <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border border-current ${tierInfo?.color} bg-current/10`}>
                                  {tierInfo?.label} Tier
                               </span>
                            </div>
                            <p className="text-sm text-slate-400">Last updated: {new Date(creditProfile.lastUpdated).toLocaleString()}</p>
                         </div>

                         {/* ML Risk Assessment Badge */}
                         {mlPrediction && (
                           <div className={`rounded-xl p-4 border ${
                             mlPrediction.riskBucket === 'low' ? 'bg-indigo-950/20 border-indigo-900/40' :
                             mlPrediction.riskBucket === 'medium' ? 'bg-amber-950/20 border-amber-900/40' :
                             mlPrediction.riskBucket === 'high' ? 'bg-orange-950/20 border-orange-900/40' :
                             'bg-red-950/20 border-red-900/40'
                           }`}>
                             <div className="flex items-center justify-between">
                               <div className="flex items-center gap-2">
                                 <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">ML Risk</span>
                                 <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                   mlPrediction.riskBucket === 'low' ? 'text-indigo-400 bg-indigo-500/10' :
                                   mlPrediction.riskBucket === 'medium' ? 'text-amber-400 bg-amber-500/10' :
                                   mlPrediction.riskBucket === 'high' ? 'text-orange-400 bg-orange-500/10' :
                                   'text-red-400 bg-red-500/10'
                                 }`}>
                                   {mlPrediction.riskBucket}
                                 </span>
                               </div>
                               <span className="text-xs text-slate-400">Default probability: <span className="font-bold text-white">{(mlPrediction.probability * 100).toFixed(2)}%</span></span>
                             </div>
                           </div>
                         )}

                         <div className="grid grid-cols-2 gap-4">
                            <div className="bg-slate-950/60 rounded-xl p-4 border border-slate-800/60">
                               <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Credit Limit</p>
                               <p className="text-lg font-bold text-white">{formatAmount(creditProfile.limit)} <span className="text-xs text-slate-400 font-medium">USDt</span></p>
                            </div>
                            <div className="bg-slate-950/60 rounded-xl p-4 border border-slate-800/60">
                               <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Interest Rate</p>
                               <p className="text-lg font-bold text-white">{formatPercentage(creditProfile.rate / 100)} <span className="text-xs text-slate-400 font-medium">APR</span></p>
                            </div>
                            <div className="bg-slate-950/60 rounded-xl p-4 border border-slate-800/60">
                               <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Available to Borrow</p>
                               <p className="text-lg font-bold text-white">{formatAmount(creditProfile.available)} <span className="text-xs text-slate-400 font-medium">USDt</span></p>
                            </div>
                            <div className="bg-slate-950/60 rounded-xl p-4 border border-slate-800/60">
                               <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Total Borrowed</p>
                               <p className="text-lg font-bold text-white">{formatAmount(creditProfile.borrowed)} <span className="text-xs text-slate-400 font-medium">USDt</span></p>
                            </div>
                         </div>

                         {/* Borrow Form */}
                         {BigInt(creditProfile.available) > 0n && (
                           <div className="bg-slate-950/60 rounded-xl p-4 border border-indigo-900/30">
                              <div className="flex items-center gap-2 mb-3">
                                 <ArrowDownCircle className="w-4 h-4 text-indigo-400" />
                                 <p className="text-xs font-semibold text-indigo-400 uppercase tracking-wider">Borrow USDt</p>
                              </div>
                              <div className="flex items-center gap-2">
                                 <div className="relative flex-1">
                                    <input
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      value={borrowAmount}
                                      onChange={(e) => setBorrowAmount(e.target.value)}
                                      placeholder={`Max ${formatAmount(creditProfile.available)}`}
                                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 font-mono"
                                    />
                                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-medium text-slate-500 uppercase">USDt</span>
                                 </div>
                                 <button
                                    onClick={handleBorrow}
                                    disabled={isBorrowing || !borrowAmount || Number(borrowAmount) <= 0}
                                    className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                 >
                                    {isBorrowing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ArrowDownCircle className="w-3.5 h-3.5" />}
                                    {isBorrowing ? 'Locking collateral...' : 'Lock & Borrow'}
                                 </button>
                              </div>
                              <p className="mt-2 text-[10px] text-slate-500">
                                <strong className="text-indigo-300">Uncollateralized.</strong> The Credit Agent issues this loan purely against your on-chain reputation score — no USDT0 or MNT lock required.
                                <span className="block mt-1 text-slate-600">Coming soon: MNT-collateralized loans with higher LTV for users who want to borrow above their score-based limit.</span>
                              </p>
                              {borrowResult && (
                                <div className={`mt-3 p-2.5 rounded-lg flex items-start gap-2 text-xs ${borrowResult.success ? 'bg-indigo-950/30 border border-indigo-900/50 text-indigo-400' : 'bg-red-950/30 border border-red-900/50 text-red-400'}`}>
                                   {borrowResult.success ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" /> : <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
                                   <span>{borrowResult.message}</span>
                                </div>
                              )}
                           </div>
                         )}
                         
                         <div className="pt-2">
                            <div className="flex w-full items-center gap-2 mb-2 sm:mb-0">
                               <input
                                  type="text"
                                  value={lookupAddress}
                                  onChange={(e) => setLookupAddress(e.target.value)}
                                  placeholder="0x..."
                                  className="w-48 bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/50 font-mono"
                               />
                               <button
                                 onClick={checkCreditScore}
                                 disabled={isCheckingCredit || !lookupAddress}
                                 className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 transition-colors flex items-center justify-center sm:justify-start gap-1 p-2"
                               >
                                  <RefreshCw className={`w-3 h-3 ${isCheckingCredit ? 'animate-spin' : ''}`} /> Evaluate
                               </button>
                            </div>
                         </div>
                      </div>
                   </div>
                )}
            </div>

            {/* Active Loans List */}
            {isConnected && creditProfile && (
                <div className="glass-card p-6">
                   <div className="flex items-center gap-2 mb-6 pb-4 border-b border-slate-800/80">
                      <History className="w-5 h-5 text-slate-300" />
                      <h3 className="text-sm font-semibold text-white">Your Active Loans</h3>
                   </div>

                   {activeLoans.length === 0 ? (
                      <div className="py-8 flex flex-col items-center justify-center text-center">
                         <div className="w-12 h-12 rounded-full bg-slate-800/50 flex items-center justify-center mb-3">
                            <TrendingDown className="w-5 h-5 text-slate-600" />
                         </div>
                         <p className="text-sm font-medium text-slate-500 mb-1">No active loans found</p>
                         <p className="text-xs text-slate-600">You currently do not have any debt in the protocol.</p>
                      </div>
                   ) : (
                      <div className="space-y-4">
                         {activeLoans.map(loan => {
                            const repaidBig = BigInt(loan.repaid || '0');
                            const principalBig = BigInt(loan.principal);
                            const repayPercent = principalBig > 0n ? Number((repaidBig * 100n) / principalBig) : 0;
                            const nowSec = Math.floor(Date.now() / 1000);
                            const daysLeft = Math.max(0, Math.ceil((loan.dueDate - nowSec) / 86400));
                            const isUrgent = daysLeft <= 3;

                            return (
                            <div key={loan.id} className="bg-slate-950/50 border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition-colors">
                               <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                  <div>
                                     <div className="flex items-center gap-2 mb-1">
                                        <span className="text-lg font-bold text-white">{formatAmount(loan.principal)} USDt</span>
                                        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/20">Active</span>
                                     </div>
                                     <p className="text-xs text-slate-500">Borrowed on {new Date(loan.borrowedAt * 1000).toLocaleDateString()}</p>
                                  </div>
                                  
                                  <div className="flex items-center gap-6">
                                     <div className="text-right">
                                        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-0.5">Interest</p>
                                        <p className="text-sm font-medium text-slate-300">{formatPercentage(loan.interestRate / 100)}</p>
                                     </div>
                                     <div className="text-right">
                                        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-0.5">Due Date</p>
                                        <p className="text-sm font-medium text-slate-300">{new Date(loan.dueDate * 1000).toLocaleDateString()}</p>
                                        <span className={`text-[10px] font-bold ${isUrgent ? 'text-red-400' : 'text-slate-500'}`}>
                                          {daysLeft}d left
                                        </span>
                                     </div>
                                     <div className="text-right hidden sm:block">
                                        <p className="text-[10px] font-semibold text-red-500/70 uppercase tracking-widest mb-0.5">Total Due</p>
                                        <p className="text-sm font-bold text-red-400">{formatAmount(loan.totalDue)} USDt</p>
                                     </div>
                                  </div>
                               </div>
                               
                               <div className="mt-4 pt-4 border-t border-slate-800/80 sm:hidden">
                                  <div className="flex justify-between items-center">
                                      <p className="text-xs font-semibold text-red-500/70 uppercase tracking-widest">Total Due</p>
                                      <p className="text-sm font-bold text-red-400">{formatAmount(loan.totalDue)} USDt</p>
                                  </div>
                               </div>

                               {/* Repayment Progress */}
                               {repaidBig > 0n && (
                                 <div className="mt-3">
                                   <div className="flex items-center justify-between mb-1">
                                     <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Repaid</span>
                                     <span className="text-[10px] text-slate-400 font-mono">{formatAmount(loan.repaid || '0')} / {formatAmount(loan.principal)} USDt ({repayPercent}%)</span>
                                   </div>
                                   <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                     <div className="h-full bg-indigo-500 rounded-full transition-all duration-500" style={{ width: `${Math.min(repayPercent, 100)}%` }} />
                                   </div>
                                 </div>
                               )}

                               {/* Repay inline */}
                               <div className="mt-4 pt-4 border-t border-slate-800/80">
                                  {repayLoanId === loan.id ? (
                                     <div className="flex items-center gap-2">
                                        <div className="relative flex-1">
                                           <input
                                              type="number"
                                              step="0.01"
                                              min="0"
                                              value={repayAmount}
                                              onChange={(e) => setRepayAmount(e.target.value)}
                                              placeholder={`Max ${formatAmount(loan.totalDue)}`}
                                              className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/50 font-mono"
                                           />
                                           <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-medium text-slate-500 uppercase">USDt</span>
                                        </div>
                                        <button
                                           onClick={() => handleRepay(loan.id)}
                                           disabled={isRepaying || !repayAmount || Number(repayAmount) <= 0}
                                           className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-bold text-white hover:bg-indigo-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                           {isRepaying ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ArrowUpCircle className="w-3.5 h-3.5" />}
                                           {isRepaying ? 'Paying...' : 'Pay'}
                                        </button>
                                        <button
                                           onClick={() => { setRepayLoanId(null); setRepayAmount(''); setRepayResult(null); }}
                                           className="shrink-0 text-xs text-slate-500 hover:text-slate-300 px-2 py-2"
                                        >
                                           Cancel
                                        </button>
                                     </div>
                                  ) : (
                                     <button
                                        onClick={async () => {
                                          setRepayLoanId(loan.id);
                                          setRepayResult(null);
                                          // Auto-fill with exact amount due from on-chain
                                          if (getEth()) {
                                            try {
                                              const prov = new BrowserProvider(getEth()!);
                                              const cl = new Contract(CREDIT_LINE_ADDRESS, CREDIT_LINE_ABI, prov);
                                              const due = await cl.getAmountDue(loan.id);
                                              if (due > 0n) setRepayAmount(formatUnits(due, 6));
                                            } catch { setRepayAmount(formatUnits(BigInt(loan.totalDue || loan.principal), 6)); }
                                          }
                                        }}
                                        className="inline-flex items-center gap-1.5 text-sm font-semibold text-indigo-400 hover:text-indigo-300 transition-colors"
                                     >
                                        <ArrowUpCircle className="w-4 h-4" /> Repay This Loan
                                     </button>
                                  )}
                                  {repayResult && repayLoanId === loan.id && (
                                     <div className={`mt-2 p-2.5 rounded-lg flex items-start gap-2 text-xs ${repayResult.success ? 'bg-indigo-950/30 border border-indigo-900/50 text-indigo-400' : 'bg-red-950/30 border border-red-900/50 text-red-400'}`}>
                                        {repayResult.success ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" /> : <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
                                        <span>{repayResult.message}</span>
                                     </div>
                                  )}
                               </div>
                            </div>
                            );
                         })}
                      </div>
                   )}
                </div>
            )}

            {/* Loan History Toggle */}
            {isConnected && creditProfile && (
                <div className="glass-card p-6">
                   <button
                     onClick={() => { setShowHistory(!showHistory); if (!showHistory) fetchLoanHistory(); }}
                     className="flex items-center gap-2 w-full text-left"
                   >
                      <History className="w-5 h-5 text-slate-400" />
                      <h3 className="text-sm font-semibold text-white">Loan History</h3>
                      <span className="ml-auto text-xs text-slate-500">{showHistory ? '▲ Hide' : '▼ Show'}</span>
                   </button>

                   {showHistory && (
                     <div className="mt-4 pt-4 border-t border-slate-800/80">
                       {loanHistory.filter(l => !l.active).length === 0 ? (
                         <p className="text-sm text-slate-500 text-center py-4">No past loans found.</p>
                       ) : (
                         <div className="space-y-3">
                           {loanHistory.filter(l => !l.active).map(loan => {
                             const wasDefaulted = BigInt(loan.repaid || '0') < BigInt(loan.principal);
                             return (
                               <div key={loan.id} className={`bg-slate-950/50 border rounded-xl p-4 ${wasDefaulted ? 'border-red-900/40' : 'border-indigo-900/40'}`}>
                                 <div className="flex items-center justify-between">
                                   <div className="flex items-center gap-2">
                                     <span className="text-sm font-bold text-white">{formatAmount(loan.principal)} USDt</span>
                                     <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                                       wasDefaulted ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'
                                     }`}>
                                       {wasDefaulted ? 'Defaulted' : 'Repaid'}
                                     </span>
                                   </div>
                                   <span className="text-xs text-slate-500">{new Date(loan.borrowedAt * 1000).toLocaleDateString()}</span>
                                 </div>
                               </div>
                             );
                           })}
                         </div>
                       )}
                     </div>
                   )}
                </div>
            )}
        </div>
      </div>
    </div>
  );
}
