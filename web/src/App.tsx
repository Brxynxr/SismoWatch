import React, { useState, useEffect } from 'react';
import { LeftDock } from './components/LeftDock';
import { CockpitDashboard } from './components/CockpitDashboard';
import { EventsCatalog } from './components/EventsCatalog';
import { ReportsView } from './components/ReportsView';
import { QuarantineAdmin } from './components/QuarantineAdmin';
import { FloatingChatAssistant } from './components/FloatingChatAssistant';
import { LoginModal } from './components/LoginModal';
import { User, KPIs, EarthquakeEvent, HourlyStat, RegionStat, MagnitudeStat } from './types';
import { api, getStoredUser, setStoredUser } from './services/api';
import { Database, FileText, AlertTriangle, X } from 'lucide-react';

export const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(getStoredUser());
  const [currentTab, setCurrentTab] = useState<string>('dashboard');
  const [isLive, setIsLive] = useState<boolean>(false);

  // Data states
  const [kpis, setKpis] = useState<KPIs | null>(null);
  const [events, setEvents] = useState<EarthquakeEvent[]>([]);
  const [hourlyStats, setHourlyStats] = useState<HourlyStat[]>([]);
  const [regionStats, setRegionStats] = useState<RegionStat[]>([]);
  const [magnitudeStats, setMagnitudeStats] = useState<MagnitudeStat[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  const loadInitialData = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [kpisData, eventsData, hourlyData, regionsData, magsData] = await Promise.all([
        api.getKPIs().catch(() => null),
        api.getEvents({ page_size: 25 }).catch(() => ({ items: [] })),
        api.getHourlyStats().catch(() => []),
        api.getRegionStats().catch(() => []),
        api.getMagnitudeDistribution().catch(() => [])
      ]);

      if (kpisData) setKpis(kpisData);
      if (eventsData?.items) setEvents(eventsData.items);
      setHourlyStats(hourlyData);
      setRegionStats(regionsData);
      setMagnitudeStats(magsData);
    } catch (err) {
      console.error("Error loading dashboard data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) {
      loadInitialData();
    }
  }, [user]);

  // Real-Time Server-Sent Events (SSE) Listener
  useEffect(() => {
    if (!user) return;

    const eventSource = new EventSource(`/api/stream?token=${user.token}`);

    eventSource.addEventListener('seismic_update', (e) => {
      try {
        const payload = JSON.parse(e.data);
        setIsLive(true);
        if (payload.kpis) {
          setKpis(payload.kpis);
        }
        if (payload.recent_events && payload.recent_events.length > 0) {
          setEvents((prev) => {
            const newMap = new Map();
            payload.recent_events.forEach((ev: EarthquakeEvent) => newMap.set(ev.event_id, ev));
            prev.forEach((ev) => {
              if (!newMap.has(ev.event_id)) newMap.set(ev.event_id, ev);
            });
            return Array.from(newMap.values()).slice(0, 35);
          });
        }
      } catch (err) {
        console.error("Error processing SSE message:", err);
      }
    });

    eventSource.onerror = () => {
      setIsLive(false);
    };

    return () => {
      eventSource.close();
    };
  }, [user]);

  const handleLogout = () => {
    setStoredUser(null);
    setUser(null);
  };

  if (!user) {
    return <LoginModal onSuccess={(u) => setUser(u)} />;
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-slate-950 text-slate-100 flex font-sans">
      {/* 1. Left Vertical Navigation Dock */}
      <LeftDock
        currentTab={currentTab}
        onSelectTab={(tab) => setCurrentTab(tab)}
        user={user}
        onLogout={handleLogout}
        isLive={isLive}
      />

      {/* 2. Slide-Out Drawer Panel (Catálogo, Reportes, Cuarentena) */}
      {currentTab !== 'dashboard' && (
        <div className="absolute top-0 left-16 sm:left-18 h-full w-[640px] xl:w-[760px] 2xl:w-[840px] max-w-[calc(100vw-5rem)] z-30 bg-slate-950/95 backdrop-blur-2xl border-r border-slate-800 shadow-2xl flex flex-col animate-in slide-in-from-left duration-200">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-slate-900/80">
            <div className="flex items-center gap-2.5">
              {currentTab === 'catalog' && (
                <>
                  <Database className="w-4 h-4 text-cyan-400" />
                  <div>
                    <h3 className="font-bold text-sm text-slate-100">Catálogo Histórico de Sismos</h3>
                    <p className="text-[10px] text-slate-400">Filtrado tabular y descarga CSV</p>
                  </div>
                </>
              )}
              {currentTab === 'reports' && (
                <>
                  <FileText className="w-4 h-4 text-cyan-400" />
                  <div>
                    <h3 className="font-bold text-sm text-slate-100">Reportes Ejecutivos Sísmicos</h3>
                    <p className="text-[10px] text-slate-400">Auditoría con IA y evaluación de riesgo</p>
                  </div>
                </>
              )}
              {currentTab === 'quarantine' && (
                <>
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  <div>
                    <h3 className="font-bold text-sm text-slate-100">Cuarentena y Control de Calidad</h3>
                    <p className="text-[10px] text-slate-400">Registros anómalos rechazados por Pandera</p>
                  </div>
                </>
              )}
            </div>
            <button
              onClick={() => setCurrentTab('dashboard')}
              title="Cerrar panel y volver al visor 3D completo"
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 sm:p-5 custom-scrollbar">
            {currentTab === 'catalog' && <EventsCatalog />}
            {currentTab === 'reports' && <ReportsView user={user} />}
            {currentTab === 'quarantine' && user.role === 'admin' && <QuarantineAdmin />}
          </div>
        </div>
      )}

      {/* 3. Main Center Cockpit Viewport (Always Active 3D Globe & Live Telemetry) */}
      <main className="flex-1 h-screen relative overflow-hidden">
        <CockpitDashboard
          events={events}
          kpis={kpis}
          hourlyStats={hourlyStats}
          regionStats={regionStats}
          magnitudeStats={magnitudeStats}
        />
      </main>

      {/* 4. Floating Grounded AI Assistant (Minimalist Robot FAB) */}
      <FloatingChatAssistant />
    </div>
  );
};
