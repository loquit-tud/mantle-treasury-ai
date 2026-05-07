import { createPortal } from 'react-dom';
import { X, Wallet as WalletIcon } from 'lucide-react';
import { useWalletProviders, type EIP1193Provider } from '../hooks/useWalletProviders';

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (provider: EIP1193Provider, name: string) => void;
}

export function WalletPickerModal({ open, onClose, onSelect }: Props) {
  const providers = useWalletProviders();

  if (!open) return null;

  const hasInjected = typeof window !== 'undefined' && !!(window as { ethereum?: unknown }).ethereum;
  const showFallback = providers.length === 0 && hasInjected;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass-card w-full max-w-sm p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-white">Connect a wallet</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {providers.length === 0 && !hasInjected && (
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-400">
            No Web3 wallet detected. Install{' '}
            <a
              href="https://metamask.io/download/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-300 underline hover:text-indigo-200"
            >
              MetaMask
            </a>{' '}
            or{' '}
            <a
              href="https://rabby.io/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-300 underline hover:text-indigo-200"
            >
              Rabby
            </a>
            .
          </div>
        )}

        <div className="space-y-2">
          {providers.map((p) => (
            <button
              key={p.info.uuid}
              type="button"
              onClick={() => onSelect(p.provider, p.info.name)}
              className="flex w-full items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-3 text-left transition-colors hover:border-indigo-500/40 hover:bg-slate-900/70"
            >
              <img src={p.info.icon} alt="" className="h-8 w-8 rounded-md" />
              <div className="flex-1">
                <p className="text-sm font-medium text-white">{p.info.name}</p>
                <p className="font-mono text-[10px] text-slate-500">{p.info.rdns}</p>
              </div>
            </button>
          ))}

          {showFallback && (
            <button
              type="button"
              onClick={() => {
                const eth = (window as { ethereum?: EIP1193Provider }).ethereum;
                if (eth) onSelect(eth, 'Browser wallet');
              }}
              className="flex w-full items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-3 text-left transition-colors hover:border-indigo-500/40 hover:bg-slate-900/70"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-indigo-500/15">
                <WalletIcon className="h-4 w-4 text-indigo-300" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-white">Browser wallet</p>
                <p className="text-[10px] text-slate-500">window.ethereum (legacy)</p>
              </div>
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
