/**
 * Module-level store for the user-selected EIP-1193 provider.
 *
 * We deliberately do NOT touch `window.ethereum`. Some extensions (MetaMask)
 * lock it as non-configurable, which makes any `Object.defineProperty` call
 * throw "Cannot redefine property: ethereum" and breaks the page when other
 * wallets (EVM Ask, Trust, Rabby) try to inject. All ethers calls in the app
 * route through `getEth()` and use the user-picked provider directly.
 */
import type { EIP1193Provider } from './useWalletProviders';

let selected: EIP1193Provider | null = null;
const listeners = new Set<() => void>();

export function setSelectedProvider(p: EIP1193Provider | null): void {
  selected = p;
  listeners.forEach((l) => l());
}

export function getEth(): EIP1193Provider | null {
  if (selected) return selected;
  // Fallback only if the user hasn't explicitly picked a provider yet.
  // window.ethereum can be hijacked by whichever extension wins the inject race
  // — that's why the wallet picker is the source of truth.
  const eth = (window as { ethereum?: EIP1193Provider }).ethereum;
  return eth ?? null;
}

export function subscribeProvider(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
