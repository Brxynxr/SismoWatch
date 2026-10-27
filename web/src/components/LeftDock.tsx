import React from 'react';
import {
  Globe2,
  Database,
  BarChart3,
  FileText,
  AlertTriangle,
  Radio,
  Activity,
} from 'lucide-react';
import { User } from '../types';

interface LeftDockProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
  user: User | null;
  onLogout?: () => void;
  isLive: boolean;
}

export const LeftDock: React.FC<LeftDockProps> = ({
  currentTab,
  onSelectTab,
  user,
  isLive
}) => {
  const navItems = [
    {
      id: 'dashboard',
      label: 'Cockpit 3D (Globo)',
      description: 'Centro de monitoreo global 3D en tiempo real',
      icon: Globe2
    },
    {
      id: 'analytics',
      label: 'Analítica y KPIs',
      description: 'Métricas de calidad, gráficos y distribución',
      icon: BarChart3
    },
    {
      id: 'catalog',
      label: 'Catálogo de Sismos',
      description: 'Exploración y filtrado tabular de eventos',
      icon: Database
    },
    {
      id: 'reports',
      label: 'Reportes Ejecutivos',
      description: 'Auditoría y análisis con IA',
      icon: FileText
    },
    ...(user?.role === 'admin'
      ? [
          {
            id: 'quarantine',
            label: 'Cuarentena y Calidad',
            description: 'Gestión de registros rechazados',
            icon: AlertTriangle
          }
        ]
      : [])
  ];

  return (
    <aside className="w-16 sm:w-18 h-screen sticky top-0 z-40 bg-slate-950/95 border-r border-slate-800/80 backdrop-blur-2xl flex flex-col items-center justify-between py-4 select-none shrink-0 shadow-2xl">
      {/* Top Brand Logo */}
      <div className="flex flex-col items-center gap-1">
        <button
          onClick={() => onSelectTab('dashboard')}
          title="SismoWatch 3D • Centro de Monitoreo"
          className="group relative p-2.5 rounded-xl bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 transition-all shadow-lg shadow-cyan-500/10 cursor-pointer"
        >
          <Activity className="w-5 h-5 group-hover:scale-110 transition-transform" />
          <span className="absolute -bottom-0.5 -right-0.5 flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
          </span>
        </button>
        <span className="text-[9px] font-mono font-bold tracking-wider text-slate-400 uppercase mt-0.5">
          Sismo
        </span>
      </div>

      {/* Middle Navigation Dock */}
      <nav className="flex flex-col items-center gap-3 my-auto w-full px-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentTab === item.id;
          return (
            <div key={item.id} className="relative group w-full flex justify-center">
              <button
                onClick={() => {
                  // If clicking the currently open drawer, toggle it back to dashboard
                  if (isActive && item.id !== 'dashboard') {
                    onSelectTab('dashboard');
                  } else {
                    onSelectTab(item.id);
                  }
                }}
                className={`relative flex items-center justify-center w-11 h-11 rounded-xl transition-all cursor-pointer ${
                  isActive
                    ? 'bg-gradient-to-tr from-cyan-600/30 to-sky-500/20 text-cyan-300 border border-cyan-400/50 shadow-lg shadow-cyan-500/20 scale-105'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/70 border border-transparent'
                }`}
                aria-label={item.label}
              >
                <Icon className="w-5 h-5" />

                {/* Active Indicator Bar */}
                {isActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-cyan-400 rounded-r-full shadow-sm shadow-cyan-400/80"></span>
                )}
              </button>

              {/* Flyout Tooltip (Left Dock to Right) */}
              <div className="absolute left-full ml-3 top-1/2 -translate-y-1/2 hidden group-hover:flex flex-col min-w-[170px] bg-slate-900/95 border border-slate-700/80 rounded-xl px-3 py-2 text-xs shadow-2xl backdrop-blur-xl z-50 pointer-events-none animate-in fade-in slide-in-from-left-2 duration-150">
                <span className="font-semibold text-slate-100">{item.label}</span>
                <span className="text-[10px] text-slate-400 leading-tight mt-0.5">{item.description}</span>
              </div>
            </div>
          );
        })}
      </nav>

      {/* Bottom Telemetry Controls */}
      <div className="flex flex-col items-center gap-3 w-full px-2">
        {/* SSE Live Connection Dot */}
        <div
          title={isLive ? 'Conexión SSE en vivo activa' : 'Reconectando con backend...'}
          className="relative group flex items-center justify-center w-8 h-8 rounded-lg bg-slate-900 border border-slate-800"
        >
          <Radio className={`w-3.5 h-3.5 ${isLive ? 'text-emerald-400' : 'text-slate-500'}`} />
          {isLive && (
            <span className="absolute -top-1 -right-1 flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
          )}

          {/* SSE Tooltip */}
          <div className="absolute left-full ml-3 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-1.5 whitespace-nowrap bg-slate-900/95 border border-slate-700 rounded-lg px-2.5 py-1 text-[11px] font-mono text-slate-200 shadow-xl pointer-events-none z-50">
            <span className={`w-2 h-2 rounded-full ${isLive ? 'bg-emerald-400' : 'bg-rose-400'}`}></span>
            {isLive ? 'SSE STREAM ACTIVO' : 'DESCONECTADO'}
          </div>
        </div>
      </div>
    </aside>
  );
};
