import { useEffect, useState } from 'react';

// EIP-6963 — Multi Injected Provider Discovery
// https://eips.ethereum.org/EIPS/eip-6963

export interface EIP1193Provider {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
}

export interface EIP6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string; // data URI
  rdns: string;
}

export interface EIP6963ProviderDetail {
  info: EIP6963ProviderInfo;
  provider: EIP1193Provider;
}

interface AnnounceEvent extends CustomEvent {
  detail: EIP6963ProviderDetail;
}

export function useWalletProviders(): EIP6963ProviderDetail[] {
  const [providers, setProviders] = useState<EIP6963ProviderDetail[]>([]);

  useEffect(() => {
    const map = new Map<string, EIP6963ProviderDetail>();

    const onAnnounce = (e: Event) => {
      const detail = (e as AnnounceEvent).detail;
      if (detail?.info?.uuid && !map.has(detail.info.uuid)) {
        map.set(detail.info.uuid, detail);
        setProviders(Array.from(map.values()));
      }
    };

    window.addEventListener('eip6963:announceProvider', onAnnounce as EventListener);
    window.dispatchEvent(new Event('eip6963:requestProvider'));

    return () => {
      window.removeEventListener('eip6963:announceProvider', onAnnounce as EventListener);
    };
  }, []);

  return providers;
}
