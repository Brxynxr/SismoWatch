import React from 'react';
import { Activity, Shield, Database, Sparkles, AlertTriangle, LogOut, Radio } from 'lucide-react';
import { User } from '../types';

interface NavbarProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
  user: User | null;
  onLogout: () => void;
  isLive: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  setCurrentTab,
  user,
  onLogout,
  isLive
}) => {
  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: Activity },
    { id: 'catalog', label: 'Catálogo de Sismos', icon: Database },
    { id: 'chat', label: 'Asistente IA Grounded', icon: Sparkles },
    { id: 'reports', label: 'Reportes Ejecutivos', icon: Shield },
    ...(user?.role === 'admin'
      ? [{ id: 'quarantine', label: 'Cuarentena y Control', icon: AlertTriangle }]
      : [])
  ];

  return (
    <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Brand */}
          <div className="flex items-center gap-3">
            <div className="p-2 bg-sky-500/10 rounded-lg border border-sky-500/20 text-sky-400">
              <Activity className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-lg tracking-tight text-white">SismoWatch</span>
                <span className="text-xs px-2 py-0.5 rounded-full font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  Medallion E2E
                </span>
              </div>
              <p className="text-xs text-slate-400 hidden sm:block">Monitoreo Sísmico Global USGS en Tiempo Real</p>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="hidden md:flex items-center space-x-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = currentTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setCurrentTab(item.id)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    active
                      ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* User Profile & Actions */}
          <div className="flex items-center gap-3">
            {/* Live SSE Pulse */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono bg-slate-800 border border-slate-700">
              <Radio className={`w-3.5 h-3.5 ${isLive ? 'text-emerald-400 animate-pulse' : 'text-slate-500'}`} />
              <span className={isLive ? 'text-emerald-400 font-semibold' : 'text-slate-500'}>
                {isLive ? 'EN VIVO' : 'CONECTANDO'}
              </span>
            </div>

            {/* Role Badge */}
            {user && (
              <div className="flex items-center gap-2">
                <span
                  className={`text-xs px-2.5 py-1 rounded-md font-semibold border ${
                    user.role === 'admin'
                      ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                      : 'bg-sky-500/10 text-sky-300 border-sky-500/30'
                  }`}
                >
                  {user.role === 'admin' ? '🛡️ Admin' : '👁️ Viewer'}
                </span>
                <button
                  onClick={onLogout}
                  title="Cerrar Sesión"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Mobile Navigation bar */}
        <div className="flex md:hidden overflow-x-auto py-2 space-x-1 border-t border-slate-800">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = currentTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setCurrentTab(item.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap ${
                  active
                    ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                    : 'text-slate-400 hover:bg-slate-800'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {item.label}
              </button>
            );
          })}
        </div>
      </div>
    </header>
  );
};
