/**
 * Quorum Dashboard — Main App Component
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
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Header / Navbar */}
      <header className="border-b border-slate-800/80 bg-slate-950/90 backdrop-blur sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
           {/* Top Row: Logo & Wallet */}
           <div className="py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-indigo-500/30 bg-indigo-500/10">
                  <Shield className="w-5 h-5 text-indigo-300" />
                </div>
                <div>
                  <h1 className="text-sm font-semibold tracking-tight text-slate-100">
                    Quorum
                  </h1>
                  <p className="text-xs text-slate-500 hidden sm:block">
                    Autonomous DAO CFO &mdash; Mantle Network
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <WalletConnect />
              </div>
           </div>

           {/* Bottom Row: Navigation Links */}
           <nav className="flex items-center gap-2 overflow-x-auto custom-scrollbar pb-2 pt-2 border-t border-slate-800/70">
              <NavLink 
                to="/dashboard"
                end
                className={({ isActive }) => `
                  whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors
                  ${isActive ? 'bg-slate-900 border border-slate-700 text-indigo-200' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'}
                `}
              >
                 Dashboard
              </NavLink>
              <NavLink 
                to="/wallet"
                className={({ isActive }) => `
                  whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors
                  ${isActive ? 'bg-slate-900 border border-slate-700 text-indigo-200' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'}
                `}
              >
                 My Wallet
              </NavLink>
              <NavLink 
                to="/analytics"
                className={({ isActive }) => `
                  whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors
                  ${isActive ? 'bg-slate-900 border border-slate-700 text-indigo-200' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'}
                `}
              >
                 Analytics
              </NavLink>

           </nav>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 w-full flex-1">
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 mt-auto bg-slate-950">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 gap-2">
          <span>Quorum &mdash; Autonomous DAO CFO on Mantle</span>
          <span>Powered by Mantle Network</span>
        </div>
      </footer>
    </div>
  );
}
