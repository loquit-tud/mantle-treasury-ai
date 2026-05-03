/**
 * API configuration — resolves the backend URL.
 * On localhost:3001 (served by backend) → relative path.
 * On Pages (agent-treasury.pages.dev) → explicit backend tunnel URL.
 */
const BACKEND_URL = import.meta.env.VITE_API_URL
  || (window.location.hostname === 'localhost' ? '' : 'https://treasury.proceedgate.dev');

export function apiUrl(path: string): string {
  return `${BACKEND_URL}${path}`;
}

export function wsUrl(): string {
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL;
  if (window.location.hostname === 'localhost') {
    return `ws://${window.location.host}/ws`;
  }
  return 'wss://treasury.proceedgate.dev/ws';
}
