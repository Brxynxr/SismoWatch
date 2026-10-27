import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { KPICards } from './components/KPICards';
import { SeismicMap } from './components/SeismicMap';
import { ChartsView } from './components/ChartsView';
import { EventsCatalog } from './components/EventsCatalog';
import { ChatAssistant } from './components/ChatAssistant';
import { ReportsView } from './components/ReportsView';
import { QuarantineAdmin } from './components/QuarantineAdmin';
import { LoginModal } from './components/LoginModal';
import { User, KPIs, EarthquakeEvent, HourlyStat, RegionStat, MagnitudeStat } from './types';
import { api, getStoredUser, setStoredUser } from './services/api';
import { Activity, Shield, RefreshCw } from 'lucide-react';

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
        api.getEvents({ page_size: 20 }).catch(() => ({ items: [] })),
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
            return Array.from(newMap.values()).slice(0, 30);
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
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      <Navbar
        currentTab={currentTab}
        setCurrentTab={setCurrentTab}
        user={user}
        onLogout={handleLogout}
        isLive={isLive}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {currentTab === 'dashboard' && (
          <div className="space-y-6">
            {/* KPI Cards */}
            <KPICards kpis={kpis} />

            {/* Seismic Map (Differentiator #1: PGA Impact Radius circles) */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-bold text-slate-300 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-sky-400" />
                  Mapa Interactivo Global de Sismos & Radios de Afectación PGA
                </h2>
                <span className="text-xs text-slate-500">
                  {events.length} sismos recientes graficados
                </span>
              </div>
              <SeismicMap events={events} />
            </div>

            {/* Recharts Temporal and Distribution Analytics */}
            <ChartsView
              hourlyStats={hourlyStats}
              regionStats={regionStats}
              magnitudeStats={magnitudeStats}
            />
          </div>
        )}

        {currentTab === 'catalog' && <EventsCatalog />}

        {currentTab === 'chat' && <ChatAssistant />}

        {currentTab === 'reports' && <ReportsView user={user} />}

        {currentTab === 'quarantine' && user.role === 'admin' && <QuarantineAdmin />}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 bg-slate-950 py-4 text-center text-xs text-slate-500">
        <p>SismoWatch • Arquitectura Medallion (Bronze/Silver/Gold) • POLP PostgreSQL • Local LLM Grounding</p>
      </footer>
    </div>
  );
};
