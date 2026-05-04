import { createBrowserRouter } from 'react-router-dom';
import App from './App';
import Landing from './pages/Landing';
import Dashboard from './pages/Dashboard';
import WalletPage from './pages/WalletPage';
import Analytics from './pages/Analytics';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
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
    ],
  },
], { basename: '/mantle-treasury-ai' });
