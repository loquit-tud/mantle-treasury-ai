/**
 * Module-level store for the user-selected EIP-1193 provider.
 *
 * Some wallet extensions (Rabby, SafePal, Brave) lock `window.ethereum` as a
 * read-only getter, so we cannot reassign it. Instead, the wallet picker stores
 * the chosen provider here and `getEth()` returns it (or falls back to
 * window.ethereum) for all subsequent calls.
 */
import type { EIP1193Provider } from './useWalletProviders';

let selected: EIP1193Provider | null = null;
const listeners = new Set<() => void>();

export function setSelectedProvider(p: EIP1193Provider | null): void {
  selected = p;
  // Best-effort: try to also overwrite window.ethereum for libraries we don't
  // control. Silently ignore if the property is locked by another extension.
  if (p) {
    try {
      Object.defineProperty(window, 'ethereum', {
        value: p,
        writable: true,
        configurable: true,
      });
    } catch {
      try {
        (window as { ethereum?: EIP1193Provider }).ethereum = p;
      } catch {
        /* read-only — getEth() handles it */
      }
    }
  }
  listeners.forEach((l) => l());
}

export function getEth(): EIP1193Provider | null {
  if (selected) return selected;
  const eth = (window as { ethereum?: EIP1193Provider }).ethereum;
  return eth ?? null;
}

export function subscribeProvider(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
