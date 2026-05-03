/**
 * AgentTreasury Dashboard — Main App Component
 */

import { Shield } from 'lucide-react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { WalletConnect } from './components/WalletConnect';

export default function App() {
  const location = useLocation();
  const isLanding = location.pathname === '/';

  // If we are on the landing page, we just render it directly so we don't
  // show the main Dashboard header/footer that applies to the rest of the app.
  if (isLanding) {
    return <Outlet />;
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {/* Header / Navbar */}
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4">
           {/* Top Row: Logo & Wallet */}
           <div className="py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Shield className="w-7 h-7 text-green-400" />
                <div>
                  <h1 className="text-lg font-bold tracking-tight">
                    AgentTreasury <span className="text-green-400">CORE</span>
                  </h1>
                  <p className="text-xs text-gray-500 hidden sm:block">
                    Autonomous DAO CFO &mdash; Tether Hackathon Galactica
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <WalletConnect />
              </div>
           </div>

           {/* Bottom Row: Navigation Links */}
           <nav className="flex items-center gap-6 overflow-x-auto custom-scrollbar pb-2 pt-1 border-t border-gray-800/40">
              <NavLink 
                to="/dashboard"
                end
                className={({ isActive }) => `
                  whitespace-nowrap text-sm font-medium transition-colors border-b-2 px-1 py-1
                  ${isActive ? 'border-green-400 text-green-400' : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-600'}
                `}
              >
                 Dashboard
              </NavLink>
              <NavLink 
                to="/wallet"
                className={({ isActive }) => `
                  whitespace-nowrap text-sm font-medium transition-colors border-b-2 px-1 py-1
                  ${isActive ? 'border-green-400 text-green-400' : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-600'}
                `}
              >
                 My Wallet
              </NavLink>
              <NavLink 
                to="/analytics"
                className={({ isActive }) => `
                  whitespace-nowrap text-sm font-medium transition-colors border-b-2 px-1 py-1
                  ${isActive ? 'border-green-400 text-green-400' : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-600'}
                `}
              >
                 Analytics
              </NavLink>
              <NavLink 
                to="/cross-chain"
                className={({ isActive }) => `
                  whitespace-nowrap text-sm font-medium transition-colors border-b-2 px-1 py-1
                  ${isActive ? 'border-cyan-400 text-cyan-400' : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-600'}
                `}
              >
                 Cross-Chain
              </NavLink>
           </nav>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-4 py-6 w-full flex-1">
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800 mt-auto bg-gray-950">
        <div className="max-w-7xl mx-auto px-4 py-4 flex flex-col sm:flex-row items-center justify-between text-xs text-gray-600 gap-2">
          <span>AgentTreasury CORE &mdash; Tether Hackathon Galactica: WDK Edition</span>
          <span>Powered by WDK + OpenClaw</span>
        </div>
      </footer>
    </div>
  );
}
