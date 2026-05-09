/**
 * Quorum Dashboard — Main App Component
 */

import { useEffect } from 'react';
import { Shield } from 'lucide-react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { WalletConnect } from './components/WalletConnect';

export default function App() {
  const location = useLocation();
  const isLanding = location.pathname === '/';

  // Global cursor-glow tracker: any element with .glass-card or .cursor-glow gets
  // --x and --y CSS vars updated on pointermove relative to its top-left.
  useEffect(() => {
    let raf = 0;
    const handler = (e: PointerEvent) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const target = (e.target as HTMLElement | null)?.closest<HTMLElement>(
          '.glass-card, .cursor-glow',
        );
        if (!target) return;
        const rect = target.getBoundingClientRect();
        target.style.setProperty('--x', `${e.clientX - rect.left}px`);
        target.style.setProperty('--y', `${e.clientY - rect.top}px`);
      });
    };
    window.addEventListener('pointermove', handler, { passive: true });
    return () => {
      window.removeEventListener('pointermove', handler);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // If we are on the landing page, we just render it directly so we don't
  // show the main Dashboard header/footer that applies to the rest of the app.
  if (isLanding) {
    return (
      <div key="landing" className="page-fade">
        <Outlet />
      </div>
    );
  }

  return (
    <div className="min-h-screen text-slate-100 flex flex-col relative">
      <div className="app-mesh-bg" aria-hidden="true" />

      {/* Header / Navbar */}
      <header className="border-b border-slate-800/60 bg-slate-950/60 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
           {/* Top Row: Logo & Wallet */}
           <div className="py-3 flex items-center justify-between">
              <NavLink to="/dashboard" className="flex items-center gap-3 group">
                <div className="brand-glow flex h-10 w-10 items-center justify-center rounded-xl transition-transform duration-200 group-hover:scale-105">
                  <Shield className="w-5 h-5 text-indigo-200" />
                </div>
                <div>
                  <h1 className="text-base font-semibold tracking-tight text-gradient-brand">
                    Quorum
                  </h1>
                  <p className="text-[11px] text-slate-500 hidden sm:block">
                    Treasury & credit · Mantle Mainnet
                  </p>
                </div>
              </NavLink>

              <div className="flex items-center gap-4">
                <WalletConnect />
              </div>
           </div>

           {/* Bottom Row: Navigation Links */}
           <nav className="flex items-center gap-2 overflow-x-auto custom-scrollbar pb-2.5 pt-2">
              <NavLink
                to="/dashboard"
                end
                className={({ isActive }) => `nav-pill ${isActive ? 'nav-pill-active' : ''}`}
              >
                 Dashboard
              </NavLink>
              <NavLink
                to="/wallet"
                className={({ isActive }) => `nav-pill ${isActive ? 'nav-pill-active' : ''}`}
              >
                 My Wallet
              </NavLink>
              <NavLink
                to="/analytics"
                className={({ isActive }) => `nav-pill ${isActive ? 'nav-pill-active' : ''}`}
              >
                 Analytics
              </NavLink>
              <NavLink
                to="/audit"
                className={({ isActive }) => `nav-pill ${isActive ? 'nav-pill-active' : ''}`}
              >
                 Audit Trail
              </NavLink>

           </nav>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 w-full flex-1">
        <div key={location.pathname} className="page-fade">
          <Outlet />
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/60 mt-auto bg-slate-950/40 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 gap-2">
          <span>Quorum — treasury & credit demo on Mantle</span>
          <span className="flex items-center gap-2"><span className="live-dot" /> Powered by Mantle Network</span>
        </div>
      </footer>
    </div>
  );
}
