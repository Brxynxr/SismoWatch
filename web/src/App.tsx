import React, { useState, useEffect } from 'react';
import { LeftDock } from './components/LeftDock';
import { CockpitDashboard } from './components/CockpitDashboard';
import { KPICards } from './components/KPICards';
import { ChartsView } from './components/ChartsView';
import { EventsCatalog } from './components/EventsCatalog';
import { ReportsView } from './components/ReportsView';
import { QuarantineAdmin } from './components/QuarantineAdmin';
import { FloatingChatAssistant } from './components/FloatingChatAssistant';
import { LoginModal } from './components/LoginModal';
import { User, KPIs, EarthquakeEvent, HourlyStat, RegionStat, MagnitudeStat } from './types';
import { api, getStoredUser } from './services/api';
import { Database, FileText, AlertTriangle, X, BarChart3, RefreshCw, Activity } from 'lucide-react';

export const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(getStoredUser());
  const [showLoginModal, setShowLoginModal] = useState<boolean>(!getStoredUser());
  const [currentTab, setCurrentTab] = useState<string>('dashboard');
  const [isLive, setIsLive] = useState<boolean>(false);

  // Data states
  const [kpis, setKpis] = useState<KPIs | null>(null);
  const [events, setEvents] = useState<EarthquakeEvent[]>([]);
  const [hourlyStats, setHourlyStats] = useState<HourlyStat[]>([]);
  const [regionStats, setRegionStats] = useState<RegionStat[]>([]);
  const [magnitudeStats, setMagnitudeStats] = useState<MagnitudeStat[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  // Dedicated independent Analytics state
  const [analyticsRange, setAnalyticsRange] = useState<string>('24h');
  const [analyticsLoading, setAnalyticsLoading] = useState<boolean>(false);
  const [analyticsKPIs, setAnalyticsKPIs] = useState<KPIs | null>(null);
  const [analyticsHourly, setAnalyticsHourly] = useState<HourlyStat[]>([]);
  const [analyticsRegions, setAnalyticsRegions] = useState<RegionStat[]>([]);
  const [analyticsMagnitudes, setAnalyticsMagnitudes] = useState<MagnitudeStat[]>([]);

  const handleAnalyticsRangeChange = async (range: string) => {
    setAnalyticsRange(range);
    if (!user) return;
    setAnalyticsLoading(true);
    try {
      const [kpisData, hourlyData, regionsData, magsData] = await Promise.all([
        api.getKPIs(range).catch(() => null),
        api.getHourlyStats(range).catch(() => []),
        api.getRegionStats(range).catch(() => []),
        api.getMagnitudeDistribution(range).catch(() => [])
      ]);
      if (kpisData) setAnalyticsKPIs(kpisData);
      setAnalyticsHourly(hourlyData);
      setAnalyticsRegions(regionsData);
      setAnalyticsMagnitudes(magsData);
    } catch (err) {
      console.error("Error loading analytics data:", err);
    } finally {
      setAnalyticsLoading(false);
    }
  };

  const loadInitialData = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [kpisData, eventsData, hourlyData, regionsData, magsData] = await Promise.all([
        api.getKPIs('24h').catch(() => null),
        api.getEvents({ page_size: 200, time_range: '24h' }).catch(() => ({ items: [] })),
        api.getHourlyStats('24h').catch(() => []),
        api.getRegionStats('24h').catch(() => []),
        api.getMagnitudeDistribution('24h').catch(() => [])
      ]);

      if (kpisData) {
        setKpis(kpisData);
        setAnalyticsKPIs(kpisData);
      }
      if (eventsData?.items) setEvents(eventsData.items);
      setHourlyStats(hourlyData);
      setAnalyticsHourly(hourlyData);
      setRegionStats(regionsData);
      setAnalyticsRegions(regionsData);
      setMagnitudeStats(magsData);
      setAnalyticsMagnitudes(magsData);
    } catch (err) {
      console.error("Error loading dashboard data:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    api.logout();
    setUser(null);
    setShowLoginModal(true);
    setIsLive(false);
  };

  const handleLoginSuccess = (loggedInUser: User) => {
    setUser(loggedInUser);
    setShowLoginModal(false);
  };

  useEffect(() => {
    const stored = getStoredUser();
    if (stored?.token) {
      setUser(stored);
      setShowLoginModal(false);
    } else {
      setUser(null);
      setShowLoginModal(true);
    }
  }, []);

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
            return Array.from(newMap.values()).slice(0, 200);
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

  if (!user) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-950 text-slate-100 font-sans">
        <div className="flex flex-col items-center gap-3">
          <div className="relative p-3.5 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 shadow-2xl shadow-cyan-500/10">
            <Activity className="w-8 h-8 animate-pulse" />
            <span className="absolute -bottom-1 -right-1 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-cyan-500"></span>
            </span>
          </div>
          <h1 className="text-xl font-bold tracking-tight text-white">SismoWatch</h1>
          <span className="text-xs font-mono text-cyan-400">Iniciando Centro de Monitoreo...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-slate-950 text-slate-100 flex font-sans">
      {/* 1. Left Vertical Navigation Dock */}
      <LeftDock
        currentTab={currentTab}
        onSelectTab={(tab) => setCurrentTab(tab)}
        user={user}
        onLogout={handleLogout}
        onLoginClick={() => setShowLoginModal(true)}
        isLive={isLive}
      />

      {/* 2. Side Section Panel (Catálogo, Analítica, Reportes, Cuarentena) */}
      {currentTab !== 'dashboard' && (
        <aside className="h-full w-[540px] xl:w-[650px] 2xl:w-[740px] shrink-0 z-30 bg-slate-950/95 backdrop-blur-2xl border-r border-slate-800 shadow-2xl flex flex-col transition-all duration-300">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-slate-900/80">
            <div className="flex items-center gap-2.5">
              {currentTab === 'analytics' && (
                <>
                  <BarChart3 className="w-4 h-4 text-cyan-400" />
                  <div>
                    <h3 className="font-bold text-sm text-slate-100">Analítica Sísmica & KPIs</h3>
                    <p className="text-[10px] text-slate-400">Telemetría histórica, distribución regional y métricas</p>
                  </div>
                </>
              )}
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
            {currentTab === 'analytics' && (
              <div className="space-y-5">
                {/* Time Range Selector for Analytics */}
                <div className="flex items-center justify-between bg-slate-900/90 p-2.5 rounded-xl border border-slate-800">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-300 px-1">Rango de Análisis:</span>
                    {analyticsLoading && <RefreshCw className="w-3.5 h-3.5 text-cyan-400 animate-spin" />}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {[
                      { id: '24h', label: '24 Horas' },
                      { id: '7d', label: 'Semana' },
                      { id: '30d', label: 'Mes' },
                      { id: '1y', label: 'Año' }
                    ].map((item) => (
                      <button
                        key={item.id}
                        disabled={analyticsLoading}
                        onClick={() => handleAnalyticsRangeChange(item.id)}
                        className={`px-3 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                          analyticsRange === item.id
                            ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold shadow-sm'
                            : 'text-slate-400 hover:text-white hover:bg-slate-800/80'
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className={`space-y-6 transition-opacity duration-200 ${analyticsLoading ? 'opacity-60 pointer-events-none' : 'opacity-100'}`}>
                  <KPICards
                    kpis={analyticsKPIs || kpis}
                    timeRangeLabel={
                      analyticsRange === '24h'
                        ? '24h'
                        : analyticsRange === '7d'
                        ? 'Semana'
                        : analyticsRange === '30d'
                        ? 'Mes'
                        : 'Año'
                    }
                  />
                  <ChartsView
                    hourlyStats={analyticsHourly}
                    regionStats={analyticsRegions}
                    magnitudeStats={analyticsMagnitudes}
                    timeRangeLabel={
                      analyticsRange === '24h'
                        ? '24h'
                        : analyticsRange === '7d'
                        ? 'Semana'
                        : analyticsRange === '30d'
                        ? 'Mes'
                        : 'Año'
                    }
                  />
                </div>
              </div>
            )}
            {currentTab === 'catalog' && <EventsCatalog />}
            {currentTab === 'reports' && <ReportsView user={user} />}
            {currentTab === 'quarantine' && user.role === 'admin' && <QuarantineAdmin />}
          </div>
        </aside>
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

      {/* 5. RBAC Authentication Modal */}
      {showLoginModal && (
        <LoginModal onSuccess={handleLoginSuccess} />
      )}
    </div>
  );
};
