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
} from 'lucide-react';
import { formatAmount, formatPercentage } from '../utils/format';
import type { CreditProfile, Loan, DefaultPrediction } from '../types';

// Constants using Vite Env
const TREASURY_VAULT_ADDRESS = import.meta.env.VITE_TREASURY_VAULT_ADDRESS || '0x5503e9d53592B7D896E135804637C1710bDD5A64';
const USDT_ADDRESS = import.meta.env.VITE_USDT_ADDRESS || '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9';
const CREDIT_LINE_ADDRESS = import.meta.env.VITE_CREDIT_LINE_ADDRESS || '0x236AB6D30F70D7aB6c272aCB3b186D925Bcae1a0';
const EXPECTED_CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID || '42161');
const CHAIN_NAME = import.meta.env.VITE_CHAIN_NAME || 'Arbitrum One';
const RPC_URL = 'https://arb1.arbitrum.io/rpc';

/** Ensure MetaMask is on the correct chain; auto-add if missing */
async function ensureCorrectChain(): Promise<void> {
  if (!window.ethereum) return;
  const hexChainId = '0x' + EXPECTED_CHAIN_ID.toString(16);
  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: hexChainId }],
    });
  } catch (switchErr: unknown) {
    // 4902 = chain not added yet
    if ((switchErr as { code?: number }).code === 4902) {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: hexChainId,
          chainName: CHAIN_NAME,
          rpcUrls: [RPC_URL],
          nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
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

  const connectWallet = useCallback(async () => {
    if (!window.ethereum) { alert('Please install MetaMask'); return; }
    try {
      localStorage.removeItem('wallet-disconnected');
      await ensureCorrectChain();
      const provider = new BrowserProvider(window.ethereum);
      const accounts = await provider.send('eth_requestAccounts', []);
      const addr = accounts[0] as string;
      setAddress(addr);
      setIsConnected(true);
      // Fetch balances
      const eth = await provider.getBalance(addr);
      setEthBal(formatEther(eth));
      const usdt = new Contract(USDT_ADDRESS, ERC20_ABI, provider);
      const bal = await usdt.balanceOf(addr);
      setUsdtBal(formatUnits(bal, 6));
    } catch (err) {
      console.error('Wallet connect failed:', err);
    }
  }, []);

  const disconnectWallet = useCallback(async () => {
    localStorage.setItem('wallet-disconnected', 'true');
    // Try revoking MetaMask permissions so eth_accounts returns []
    try {
      await window.ethereum?.request({
        method: 'wallet_revokePermissions',
        params: [{ eth_accounts: {} }],
      });
    } catch {
      // Older MetaMask versions don't support this — flag handles it
    }
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
    if (window.ethereum && !localStorage.getItem('wallet-disconnected')) {
      const provider = new BrowserProvider(window.ethereum);
      provider.send('eth_accounts', []).then((accs: string[]) => {
        if (accs.length > 0) connectWallet();
      }).catch(() => {});
    }
  }, [connectWallet]);

  const [isCheckingCredit, setIsCheckingCredit] = useState(false);
  const [creditProfile, setCreditProfile] = useState<CreditProfile | null>(null);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [depositAmount, setDepositAmount] = useState('');
  const [isDepositing, setIsDepositing] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  
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
      fetch(apiUrl(`/api/credit/${address}`))
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
        const res = await fetch(apiUrl(`/api/credit/${target}/loans`));
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
        const res = await fetch(apiUrl(`/api/credit/${target}/history`));
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
    setIsBorrowing(true);
    setBorrowResult(null);
    try {
      const wei = parseUnits(borrowAmount, 6).toString();
      const res = await fetch(apiUrl(`/api/credit/${target}/borrow`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: wei }),
      });
      const data = await res.json();
      if (data.success) {
        setBorrowResult({ success: true, message: `Borrowed ${borrowAmount} USDt — Loan #${data.data.id}` });
        setBorrowAmount('');
        // Refresh credit + loans
        checkCreditScore();
        fetchLoans();
      } else {
        setBorrowResult({ success: false, message: data.error || 'Borrow declined' });
      }
    } catch {
      setBorrowResult({ success: false, message: 'Network error' });
    } finally {
      setIsBorrowing(false);
    }
  };

  const handleRepay = async (loanId: number) => {
    const target = lookupAddress || address;
    if (!target || !repayAmount || isNaN(Number(repayAmount)) || Number(repayAmount) <= 0) return;
    if (!window.ethereum) { alert('Please install MetaMask'); return; }
    setIsRepaying(true);
    setRepayResult(null);
    try {
      await ensureCorrectChain();
      const provider = new BrowserProvider(window.ethereum);
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
      fetch(apiUrl(`/api/credit/${target}/repay`), {
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
    if (!lookupAddress) return;
    setIsCheckingCredit(true);
    try {
      const res = await fetch(apiUrl(`/api/credit/${lookupAddress}/evaluate`), { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setCreditProfile(data.data as CreditProfile);
        if (data.data.mlPrediction) setMlPrediction(data.data.mlPrediction as DefaultPrediction);
        fetchLoans();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsCheckingCredit(false);
    }
  };

  const handleDeposit = async () => {
    if (!address || !depositAmount || isNaN(Number(depositAmount))) return;
    
    // Check if window.ethereum exists
    if (!window.ethereum) {
        alert("Please install MetaMask to use this feature.");
        return;
    }

    setIsDepositing(true);
    setTxHash(null);
    try {
      await ensureCorrectChain();
      // 1. Setup Ethers Provider & Signer
      const provider = new BrowserProvider(window.ethereum);
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

  // Determine Credit Tier & Color
  const getCreditTier = (score: number) => {
    if (score >= 800) return { label: 'Excellent', color: 'text-green-400', stroke: '#4ade80' };
    if (score >= 700) return { label: 'Good', color: 'text-blue-400', stroke: '#60a5fa' };
    if (score >= 600) return { label: 'Fair', color: 'text-yellow-400', stroke: '#facc15' };
    return { label: 'Poor', color: 'text-red-400', stroke: '#f87171' };
  };

  const tierInfo = creditProfile ? getCreditTier(creditProfile.score) : null;
  const scorePercent = creditProfile ? Math.min(Math.max((creditProfile.score - 300) / 550 * 100, 0), 100) : 0;

  const activeLoans = loans.filter(l => l.active);

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
         <div>
            <h2 className="text-2xl font-bold text-white tracking-tight">Your Portfolio</h2>
            <p className="text-sm text-gray-400">Manage your connected wallet, credit, and vault deposits.</p>
         </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* Wallet Overview Panel */}
        <div className="md:col-span-1 space-y-6">
            <div className="bg-gray-900/50 border border-gray-800 rounded-2xl p-6">
                <div className="flex items-center gap-3 mb-6 pb-6 border-b border-gray-800/80">
                   <div className="w-10 h-10 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center">
                      <Wallet className="w-5 h-5 text-gray-300" />
                   </div>
                   <div>
                       <h3 className="text-sm font-semibold text-white">Connected Wallet</h3>
                       <p className="text-xs text-gray-400 mt-0.5">
                         {isConnected ? `${address?.slice(0, 6)}...${address?.slice(-4)}` : 'Not Connected'}
                       </p>
                   </div>
                </div>

                {isConnected ? (
                  <div className="space-y-4">
                     <button
                        onClick={disconnectWallet}
                        className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-gray-800 px-3 py-2 text-xs font-medium text-gray-400 hover:bg-gray-700 hover:text-white transition-all border border-gray-700"
                     >
                        <LogOut className="w-3.5 h-3.5" /> Disconnect Wallet
                     </button>
                     <div className="bg-gray-950/50 rounded-xl p-4 border border-gray-800/50">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">ETH Balance</p>
                        <p className="text-xl font-bold text-white">
                           {ethBal ? Number(ethBal).toFixed(4) : '0.0000'} <span className="text-sm text-gray-400 font-medium">ETH</span>
                        </p>
                     </div>
                     <div className="bg-gray-950/50 rounded-xl p-4 border border-gray-800/50">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">USDt Balance</p>
                        <p className="text-xl font-bold text-white">
                           {usdtBal ? Number(usdtBal).toFixed(2) : '0.00'} <span className="text-sm text-gray-400 font-medium">USDt</span>
                        </p>
                     </div>
                  </div>
                ) : (
                  <div className="py-8 flex flex-col items-center justify-center text-center">
                     <p className="text-sm text-gray-500 mb-4">Connect wallet to view balances</p>
                     <button onClick={connectWallet} className="inline-flex items-center gap-2 rounded-xl bg-blue-500 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-400 transition-all">
                        <Wallet className="w-4 h-4" /> Connect MetaMask
                     </button>
                  </div>
                )}
            </div>

            {/* Deposit Form */}
            {isConnected && (
              <div className="bg-gray-900/50 border border-gray-800 rounded-2xl p-6">
                  <div className="flex items-center gap-2 mb-4">
                     <Upload className="w-4 h-4 text-green-400" />
                     <h3 className="text-sm font-semibold text-white">Deposit to Treasury</h3>
                  </div>
                  <p className="text-xs text-gray-400 mb-4">Provide liquidity to the multi-sig vault. Approvals may be required.</p>
                  
                  <div className="space-y-3">
                     <div className="relative">
                       <input 
                         type="number" 
                         value={depositAmount}
                         onChange={(e) => setDepositAmount(e.target.value)}
                         placeholder="Amount in USDt"
                         className="w-full bg-gray-950 border border-gray-800 rounded-xl px-4 py-3 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-green-500/50 focus:ring-1 focus:ring-green-500/50 transition-all font-mono"
                       />
                       <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-medium text-gray-500 uppercase tracking-wider">USDt</span>
                     </div>
                     <button
                        onClick={handleDeposit}
                        disabled={isDepositing || !depositAmount}
                        className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-green-500 px-4 py-3 text-sm font-bold text-gray-950 hover:bg-green-400 transition-all shadow-[0_0_20px_-5px_var(--color-green-500)] disabled:opacity-50 disabled:shadow-none disabled:cursor-not-allowed"
                     >
                       {isDepositing ? (
                         <><RefreshCw className="w-4 h-4 animate-spin" /> Depositing...</>
                       ) : (
                         'Process Deposit (WDK)'
                       )}
                     </button>
                  </div>
                  {txHash && (
                    <div className="mt-4 p-3 rounded-lg bg-green-950/30 border border-green-900/50 flex items-start gap-2">
                       <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
                       <div className="overflow-hidden">
                          <p className="text-xs text-green-400 font-medium mb-0.5">Deposit Successful</p>
                          <p className="text-[10px] text-green-500/70 truncate font-mono">{txHash}</p>
                       </div>
                    </div>
                  )}
              </div>
            )}
        </div>

        {/* Credit & Loans Panel */}
        <div className="md:col-span-2 space-y-6">
            {/* Credit Score Module */}
            <div className="bg-gray-900/50 border border-gray-800 rounded-2xl p-8 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/5 rounded-full blur-[80px] pointer-events-none" />
                
                {!isConnected ? (
                   <div className="h-full min-h-[250px] flex flex-col items-center justify-center text-center">
                      <Activity className="w-12 h-12 text-gray-700 mb-4" />
                      <h3 className="text-lg font-semibold text-white mb-2">Credit System Locked</h3>
                      <p className="text-sm text-gray-400 max-w-sm mx-auto mb-6">Connect your wallet to evaluate your on-chain history and access uncollateralized credit lines.</p>
                      <button onClick={connectWallet} className="inline-flex items-center gap-2 rounded-xl bg-blue-500 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-400 transition-all">
                        <Wallet className="w-4 h-4" /> Connect MetaMask
                      </button>
                   </div>
                ) : !creditProfile ? (
                   <div className="h-full min-h-[250px] flex flex-col items-center justify-center text-center">
                      <div className="w-16 h-16 rounded-full bg-blue-950/30 border border-blue-900/50 flex items-center justify-center mb-6">
                         <Activity className="w-6 h-6 text-blue-400" />
                      </div>
                      <h3 className="text-xl font-bold text-white mb-2">Check On-chain Credit Profile</h3>
                      <p className="text-sm text-gray-400 max-w-sm mx-auto mb-6">Our Credit Agent will analyze on-chain history and generate a score instantly.</p>
                      
                      <div className="flex w-full max-w-md mx-auto items-center gap-2 mb-4">
                        <input
                           type="text"
                           value={lookupAddress}
                           onChange={(e) => setLookupAddress(e.target.value)}
                           placeholder="Enter 0x..."
                           className="flex-1 bg-gray-950 border border-gray-800 rounded-xl px-4 py-3 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 font-mono"
                        />
                      </div>

                      <button
                        onClick={checkCreditScore}
                        disabled={isCheckingCredit || !lookupAddress}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-500 px-6 py-3 text-sm font-bold text-white hover:bg-blue-400 transition-all shadow-[0_0_20px_-5px_var(--color-blue-500)] disabled:opacity-50"
                      >
                         {isCheckingCredit ? (
                            <><RefreshCw className="w-4 h-4 animate-spin" /> Analyzing History...</>
                         ) : (
                            <><Activity className="w-4 h-4" /> Evaluate Profile</>
                         )}
                      </button>
                   </div>
                ) : (
                   <div className="flex flex-col sm:flex-row items-center gap-8 relative z-10">
                      {/* Gauge Chart */}
                      <div className="relative w-48 h-48 shrink-0 flex items-center justify-center">
                         <svg viewBox="0 0 36 36" className="w-full h-full transform -rotate-90">
                            {/* Background Circle */}
                            <path
                              className="text-gray-800"
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
                            <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mt-1">Score</span>
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
                            <p className="text-sm text-gray-400">Last updated: {new Date(creditProfile.lastUpdated).toLocaleString()}</p>
                         </div>

                         {/* ML Risk Assessment Badge */}
                         {mlPrediction && (
                           <div className={`rounded-xl p-4 border ${
                             mlPrediction.riskBucket === 'low' ? 'bg-green-950/20 border-green-900/40' :
                             mlPrediction.riskBucket === 'medium' ? 'bg-yellow-950/20 border-yellow-900/40' :
                             mlPrediction.riskBucket === 'high' ? 'bg-orange-950/20 border-orange-900/40' :
                             'bg-red-950/20 border-red-900/40'
                           }`}>
                             <div className="flex items-center justify-between">
                               <div className="flex items-center gap-2">
                                 <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">ML Risk</span>
                                 <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                   mlPrediction.riskBucket === 'low' ? 'text-green-400 bg-green-500/10' :
                                   mlPrediction.riskBucket === 'medium' ? 'text-yellow-400 bg-yellow-500/10' :
                                   mlPrediction.riskBucket === 'high' ? 'text-orange-400 bg-orange-500/10' :
                                   'text-red-400 bg-red-500/10'
                                 }`}>
                                   {mlPrediction.riskBucket}
                                 </span>
                               </div>
                               <span className="text-xs text-gray-400">Default probability: <span className="font-bold text-white">{(mlPrediction.probability * 100).toFixed(2)}%</span></span>
                             </div>
                           </div>
                         )}

                         <div className="grid grid-cols-2 gap-4">
                            <div className="bg-gray-950/60 rounded-xl p-4 border border-gray-800/60">
                               <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Credit Limit</p>
                               <p className="text-lg font-bold text-white">{formatAmount(creditProfile.limit)} <span className="text-xs text-gray-400 font-medium">USDt</span></p>
                            </div>
                            <div className="bg-gray-950/60 rounded-xl p-4 border border-gray-800/60">
                               <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Interest Rate</p>
                               <p className="text-lg font-bold text-white">{formatPercentage(creditProfile.rate / 100)} <span className="text-xs text-gray-400 font-medium">APR</span></p>
                            </div>
                            <div className="bg-gray-950/60 rounded-xl p-4 border border-gray-800/60">
                               <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Available to Borrow</p>
                               <p className="text-lg font-bold text-white">{formatAmount(creditProfile.available)} <span className="text-xs text-gray-400 font-medium">USDt</span></p>
                            </div>
                            <div className="bg-gray-950/60 rounded-xl p-4 border border-gray-800/60">
                               <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Total Borrowed</p>
                               <p className="text-lg font-bold text-white">{formatAmount(creditProfile.borrowed)} <span className="text-xs text-gray-400 font-medium">USDt</span></p>
                            </div>
                         </div>

                         {/* Borrow Form */}
                         {BigInt(creditProfile.available) > 0n && (
                           <div className="bg-gray-950/60 rounded-xl p-4 border border-blue-900/30">
                              <div className="flex items-center gap-2 mb-3">
                                 <ArrowDownCircle className="w-4 h-4 text-blue-400" />
                                 <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider">Borrow USDt</p>
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
                                      className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 font-mono"
                                    />
                                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-medium text-gray-500 uppercase">USDt</span>
                                 </div>
                                 <button
                                    onClick={handleBorrow}
                                    disabled={isBorrowing || !borrowAmount || Number(borrowAmount) <= 0}
                                    className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-blue-500 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                 >
                                    {isBorrowing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ArrowDownCircle className="w-3.5 h-3.5" />}
                                    {isBorrowing ? 'Processing...' : 'Borrow'}
                                 </button>
                              </div>
                              {borrowResult && (
                                <div className={`mt-3 p-2.5 rounded-lg flex items-start gap-2 text-xs ${borrowResult.success ? 'bg-green-950/30 border border-green-900/50 text-green-400' : 'bg-red-950/30 border border-red-900/50 text-red-400'}`}>
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
                                  className="w-48 bg-gray-950 border border-gray-800 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-gray-600 focus:outline-none focus:border-blue-500/50 font-mono"
                               />
                               <button
                                 onClick={checkCreditScore}
                                 disabled={isCheckingCredit || !lookupAddress}
                                 className="text-xs font-semibold text-blue-400 hover:text-blue-300 transition-colors flex items-center justify-center sm:justify-start gap-1 p-2"
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
                <div className="bg-gray-900/50 border border-gray-800 rounded-2xl p-6">
                   <div className="flex items-center gap-2 mb-6 pb-4 border-b border-gray-800/80">
                      <History className="w-5 h-5 text-gray-300" />
                      <h3 className="text-sm font-semibold text-white">Your Active Loans</h3>
                   </div>

                   {activeLoans.length === 0 ? (
                      <div className="py-8 flex flex-col items-center justify-center text-center">
                         <div className="w-12 h-12 rounded-full bg-gray-800/50 flex items-center justify-center mb-3">
                            <TrendingDown className="w-5 h-5 text-gray-600" />
                         </div>
                         <p className="text-sm font-medium text-gray-500 mb-1">No active loans found</p>
                         <p className="text-xs text-gray-600">You currently do not have any debt in the protocol.</p>
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
                            <div key={loan.id} className="bg-gray-950/50 border border-gray-800 rounded-xl p-5 hover:border-gray-700 transition-colors">
                               <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                  <div>
                                     <div className="flex items-center gap-2 mb-1">
                                        <span className="text-lg font-bold text-white">{formatAmount(loan.principal)} USDt</span>
                                        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-yellow-500/10 text-yellow-500 border border-yellow-500/20">Active</span>
                                     </div>
                                     <p className="text-xs text-gray-500">Borrowed on {new Date(loan.borrowedAt * 1000).toLocaleDateString()}</p>
                                  </div>
                                  
                                  <div className="flex items-center gap-6">
                                     <div className="text-right">
                                        <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-0.5">Interest</p>
                                        <p className="text-sm font-medium text-gray-300">{formatPercentage(loan.interestRate / 100)}</p>
                                     </div>
                                     <div className="text-right">
                                        <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-0.5">Due Date</p>
                                        <p className="text-sm font-medium text-gray-300">{new Date(loan.dueDate * 1000).toLocaleDateString()}</p>
                                        <span className={`text-[10px] font-bold ${isUrgent ? 'text-red-400' : 'text-gray-500'}`}>
                                          {daysLeft}d left
                                        </span>
                                     </div>
                                     <div className="text-right hidden sm:block">
                                        <p className="text-[10px] font-semibold text-red-500/70 uppercase tracking-widest mb-0.5">Total Due</p>
                                        <p className="text-sm font-bold text-red-400">{formatAmount(loan.totalDue)} USDt</p>
                                     </div>
                                  </div>
                               </div>
                               
                               <div className="mt-4 pt-4 border-t border-gray-800/80 sm:hidden">
                                  <div className="flex justify-between items-center">
                                      <p className="text-xs font-semibold text-red-500/70 uppercase tracking-widest">Total Due</p>
                                      <p className="text-sm font-bold text-red-400">{formatAmount(loan.totalDue)} USDt</p>
                                  </div>
                               </div>

                               {/* Repayment Progress */}
                               {repaidBig > 0n && (
                                 <div className="mt-3">
                                   <div className="flex items-center justify-between mb-1">
                                     <span className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Repaid</span>
                                     <span className="text-[10px] text-gray-400 font-mono">{formatAmount(loan.repaid || '0')} / {formatAmount(loan.principal)} USDt ({repayPercent}%)</span>
                                   </div>
                                   <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
                                     <div className="h-full bg-green-500 rounded-full transition-all duration-500" style={{ width: `${Math.min(repayPercent, 100)}%` }} />
                                   </div>
                                 </div>
                               )}

                               {/* Repay inline */}
                               <div className="mt-4 pt-4 border-t border-gray-800/80">
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
                                              className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-green-500/50 font-mono"
                                           />
                                           <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-medium text-gray-500 uppercase">USDt</span>
                                        </div>
                                        <button
                                           onClick={() => handleRepay(loan.id)}
                                           disabled={isRepaying || !repayAmount || Number(repayAmount) <= 0}
                                           className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-green-500 px-3 py-2 text-sm font-bold text-gray-950 hover:bg-green-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                           {isRepaying ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ArrowUpCircle className="w-3.5 h-3.5" />}
                                           {isRepaying ? 'Paying...' : 'Pay'}
                                        </button>
                                        <button
                                           onClick={() => { setRepayLoanId(null); setRepayAmount(''); setRepayResult(null); }}
                                           className="shrink-0 text-xs text-gray-500 hover:text-gray-300 px-2 py-2"
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
                                          if (window.ethereum) {
                                            try {
                                              const prov = new BrowserProvider(window.ethereum);
                                              const cl = new Contract(CREDIT_LINE_ADDRESS, CREDIT_LINE_ABI, prov);
                                              const due = await cl.getAmountDue(loan.id);
                                              if (due > 0n) setRepayAmount(formatUnits(due, 6));
                                            } catch { setRepayAmount(formatUnits(BigInt(loan.totalDue || loan.principal), 6)); }
                                          }
                                        }}
                                        className="inline-flex items-center gap-1.5 text-sm font-semibold text-green-400 hover:text-green-300 transition-colors"
                                     >
                                        <ArrowUpCircle className="w-4 h-4" /> Repay This Loan
                                     </button>
                                  )}
                                  {repayResult && repayLoanId === loan.id && (
                                     <div className={`mt-2 p-2.5 rounded-lg flex items-start gap-2 text-xs ${repayResult.success ? 'bg-green-950/30 border border-green-900/50 text-green-400' : 'bg-red-950/30 border border-red-900/50 text-red-400'}`}>
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
                <div className="bg-gray-900/50 border border-gray-800 rounded-2xl p-6">
                   <button
                     onClick={() => { setShowHistory(!showHistory); if (!showHistory) fetchLoanHistory(); }}
                     className="flex items-center gap-2 w-full text-left"
                   >
                      <History className="w-5 h-5 text-gray-400" />
                      <h3 className="text-sm font-semibold text-white">Loan History</h3>
                      <span className="ml-auto text-xs text-gray-500">{showHistory ? '▲ Hide' : '▼ Show'}</span>
                   </button>

                   {showHistory && (
                     <div className="mt-4 pt-4 border-t border-gray-800/80">
                       {loanHistory.filter(l => !l.active).length === 0 ? (
                         <p className="text-sm text-gray-500 text-center py-4">No past loans found.</p>
                       ) : (
                         <div className="space-y-3">
                           {loanHistory.filter(l => !l.active).map(loan => {
                             const wasDefaulted = BigInt(loan.repaid || '0') < BigInt(loan.principal);
                             return (
                               <div key={loan.id} className={`bg-gray-950/50 border rounded-xl p-4 ${wasDefaulted ? 'border-red-900/40' : 'border-green-900/40'}`}>
                                 <div className="flex items-center justify-between">
                                   <div className="flex items-center gap-2">
                                     <span className="text-sm font-bold text-white">{formatAmount(loan.principal)} USDt</span>
                                     <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                                       wasDefaulted ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-green-500/10 text-green-400 border border-green-500/20'
                                     }`}>
                                       {wasDefaulted ? 'Defaulted' : 'Repaid'}
                                     </span>
                                   </div>
                                   <span className="text-xs text-gray-500">{new Date(loan.borrowedAt * 1000).toLocaleDateString()}</span>
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
