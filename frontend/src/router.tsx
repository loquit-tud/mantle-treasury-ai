import { createBrowserRouter } from 'react-router-dom';
import App from './App';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      {
        index: true,
        lazy: async () => ({
          Component: (await import('./pages/Landing')).default,
        }),
      },
      {
        path: 'dashboard',
        lazy: async () => ({
          Component: (await import('./pages/Dashboard')).default,
        }),
      },
      {
        path: 'wallet',
        lazy: async () => ({
          Component: (await import('./pages/WalletPage')).default,
        }),
      },
      {
        path: 'analytics',
        lazy: async () => ({
          Component: (await import('./pages/Analytics')).default,
        }),
      },
      {
        path: 'agents',
        lazy: async () => ({
          Component: (await import('./pages/Agents')).default,
        }),
      },
      {
        path: 'audit',
        lazy: async () => ({
          Component: (await import('./pages/AuditTrail')).default,
        }),
      },
    ],
  },
], { basename: '/mantle-treasury-ai' });
