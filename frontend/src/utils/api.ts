/**
 * API configuration — resolves the backend URL.
 * On localhost:3001 (served by backend) → relative path.
 * On Pages (quorum.pages.dev) → explicit backend tunnel URL.
 */
const BACKEND_URL = import.meta.env.VITE_API_URL
  || (window.location.hostname === 'localhost' ? '' : 'https://mantle-treasury-ai-production.up.railway.app');

export function apiUrl(path: string): string {
  return `${BACKEND_URL}${path}`;
}

export function wsUrl(): string {
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL;
  if (window.location.hostname === 'localhost') {
    return `ws://${window.location.host}/ws`;
  }
  return 'wss://mantle-treasury-ai-production.up.railway.app/ws';
}
