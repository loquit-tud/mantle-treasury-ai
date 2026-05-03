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
      const accounts = await window.ethereum.request({
        method: 'eth_requestAccounts',
      }) as string[];
      if (accounts && accounts.length > 0) {
        setAddress(accounts[0]);
        localStorage.removeItem('wallet_disconnected');
      }
    } catch (error) {
      console.error('Connection failed:', error);
    }
    setIsConnecting(false);
  };

  const disconnect = () => {
    setAddress(null);
    localStorage.setItem('wallet_disconnected', 'true');
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
        <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 rounded-lg">
          <div className="w-2 h-2 bg-green-400 rounded-full"></div>
          <span className="text-sm text-white">
            {address.slice(0, 6)}...{address.slice(-4)}
          </span>
          <button
            onClick={copyAddress}
            className="p-1 hover:bg-gray-700 rounded transition-colors"
          >
            {copied ? (
              <Check className="w-3 h-3 text-green-400" />
            ) : (
              <Copy className="w-3 h-3 text-gray-400" />
            )}
          </button>
          <a
            href={`https://arbiscan.io/address/${address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1 hover:bg-gray-700 rounded transition-colors"
          >
            <ExternalLink className="w-3 h-3 text-gray-400" />
          </a>
        </div>
        <button
          onClick={disconnect}
          className="px-3 py-1.5 text-sm text-gray-400 hover:text-white transition-colors"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={connect}
      disabled={isConnecting}
      className="flex items-center gap-2 px-4 py-2 bg-green-500/20 text-green-400 border border-green-500/30 rounded-lg font-medium hover:bg-green-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    >
      <Wallet className="w-4 h-4" />
      {isConnecting ? 'Connecting...' : 'Connect Wallet'}
    </button>
  );
}

