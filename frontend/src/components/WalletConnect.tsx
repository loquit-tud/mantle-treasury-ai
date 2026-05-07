/**
 * Wallet Connect Component - Connect to MetaMask or other wallets
 */

import { useState, useEffect } from 'react';
import { Wallet, ExternalLink, Copy, Check } from 'lucide-react';

export function WalletConnect() {
  const [address, setAddress] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Check if already connected
    checkConnection();
    
    // Listen for account changes (try/catch for MetaMask compatibility)
    if (window.ethereum) {
      try {
        window.ethereum.on('accountsChanged', handleAccountsChanged);
        window.ethereum.on('chainChanged', () => window.location.reload());
      } catch {
        // MetaMask newer versions may not support .on()
      }
    }

    return () => {
      if (window.ethereum) {
        try {
          window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
        } catch {
          // ignore
        }
      }
    };
  }, []);

  const checkConnection = async () => {
    if (window.ethereum) {
      // Respect user's explicit disconnect
      if (localStorage.getItem('wallet_disconnected') === 'true') return;
      try {
        const accounts = await window.ethereum.request({ method: 'eth_accounts' }) as string[];
        if (accounts && accounts.length > 0) {
          setAddress(accounts[0]);
        }
      } catch (error) {
        console.error('Failed to check connection:', error);
      }
    }
  };

  const handleAccountsChanged = (accounts: unknown) => {
    const accs = accounts as string[];
    if (accs.length === 0) {
      setAddress(null);
    } else if (localStorage.getItem('wallet_disconnected') !== 'true') {
      setAddress(accs[0]);
    }
  };

  const connect = async () => {
    if (!window.ethereum) {
      alert('Please install MetaMask or another Web3 wallet');
      return;
    }

    setIsConnecting(true);
    try {
      // Force account picker (works on MetaMask, Rabby, Frame, etc.)
      // Falls back to eth_requestAccounts on wallets that don't support permissions.
      let accounts: string[] = [];
      try {
        const perms = await window.ethereum.request({
          method: 'wallet_requestPermissions',
          params: [{ eth_accounts: {} }],
        }) as Array<{ caveats?: Array<{ type: string; value: unknown }> }>;
        const caveat = perms?.[0]?.caveats?.find((c) => c.type === 'restrictReturnedAccounts');
        if (caveat && Array.isArray(caveat.value)) {
          accounts = caveat.value as string[];
        }
      } catch {
        // permissions not supported — fallback
      }
      if (accounts.length === 0) {
        accounts = await window.ethereum.request({
          method: 'eth_requestAccounts',
        }) as string[];
      }
      if (accounts && accounts.length > 0) {
        setAddress(accounts[0]);
        localStorage.removeItem('wallet_disconnected');
      }
    } catch (error) {
      console.error('Connection failed:', error);
    }
    setIsConnecting(false);
  };

  const disconnect = async () => {
    setAddress(null);
    localStorage.setItem('wallet_disconnected', 'true');
    // Revoke permissions so next connect shows the picker again (MetaMask 11+, Rabby).
    if (window.ethereum) {
      try {
        await window.ethereum.request({
          method: 'wallet_revokePermissions',
          params: [{ eth_accounts: {} }],
        });
      } catch {
        // older wallets don't support — flag-based gate is still respected.
      }
    }
  };

  const copyAddress = () => {
    if (address) {
      navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (address) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-1.5">
          <div className="h-2 w-2 rounded-full bg-emerald-400" />
          <span className="text-sm text-slate-100">
            {address.slice(0, 6)}...{address.slice(-4)}
          </span>
          <button
            type="button"
            onClick={copyAddress}
            className="rounded p-1 transition-colors hover:bg-slate-800"
          >
            {copied ? (
              <Check className="h-3 w-3 text-emerald-400" />
            ) : (
              <Copy className="h-3 w-3 text-slate-400" />
            )}
          </button>
          <a
            href={`https://mantlescan.xyz/address/${address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded p-1 transition-colors hover:bg-slate-800"
          >
            <ExternalLink className="h-3 w-3 text-slate-400" />
          </a>
        </div>
        <button
          type="button"
          onClick={disconnect}
          className="px-3 py-1.5 text-sm text-slate-500 transition-colors hover:text-white"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={connect}
      disabled={isConnecting}
      className="flex items-center gap-2 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-4 py-2 font-medium text-indigo-200 transition-colors hover:bg-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Wallet className="w-4 h-4" />
      {isConnecting ? 'Connecting...' : 'Connect Wallet'}
    </button>
  );
}

