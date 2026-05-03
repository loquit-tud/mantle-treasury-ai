import { createBrowserRouter } from 'react-router-dom';
import App from './App';
import Landing from './pages/Landing';
import Dashboard from './pages/Dashboard';
import WalletPage from './pages/WalletPage';
import Analytics from './pages/Analytics';
import CrossChain from './pages/CrossChain';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <App />, // App as Layout
    children: [
      {
        index: true,
        element: <Landing />,
      },
      {
        path: 'dashboard',
        element: <Dashboard />,
      },
      {
        path: 'wallet',
        element: <WalletPage />,
      },
      {
        path: 'analytics',
        element: <Analytics />,
      },
      {
        path: 'cross-chain',
        element: <CrossChain />,
      },
    ],
  },
]);
