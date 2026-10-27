import React, { useState, useEffect } from 'react';
import { SeismicGlobe3D } from './SeismicGlobe3D';
import { EarthquakeEvent, KPIs, HourlyStat, RegionStat, MagnitudeStat } from '../types';
import { api } from '../services/api';
import {
  Activity,
  BarChart3,
  ChevronRight,
  ChevronLeft,
  Flame,
  Globe2,
  Radio,
  ShieldCheck,
  Waves,
  MapPin,
  Clock,
  AlertTriangle,
  RefreshCw
} from 'lucide-react';

interface CockpitDashboardProps {
  events: EarthquakeEvent[];
  kpis: KPIs | null;
  hourlyStats: HourlyStat[];
  regionStats: RegionStat[];
  magnitudeStats: MagnitudeStat[];
}

export const CockpitDashboard: React.FC<CockpitDashboardProps> = ({
  events,
  kpis,
  hourlyStats,
  regionStats,
  magnitudeStats,
}) => {
  const [selectedEvent, setSelectedEvent] = useState<EarthquakeEvent | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);
  const [feedEvents, setFeedEvents] = useState<EarthquakeEvent[]>(events);
  const [feedRange, setFeedRange] = useState<string>('24h');
  const [totalRegistered, setTotalRegistered] = useState<number>(kpis?.total_events_24h ?? events.length);
  const [isUpdating, setIsUpdating] = useState<boolean>(false);

  // Sync when initial events prop updates (e.g. from SSE or initial fetch)
  useEffect(() => {
    if (feedRange === '24h') {
      setFeedEvents(events);
      if (kpis?.total_events_24h !== undefined) {
        setTotalRegistered(kpis.total_events_24h);
      }
    }
  }, [events, kpis, feedRange]);

  const handleFeedRangeChange = async (newRange: string) => {
    setFeedRange(newRange);
    setIsUpdating(true);
    try {
      const data = await api.getEvents({ time_range: newRange, page_size: 150 });
      if (data) {
        if (data.items) setFeedEvents(data.items);
        if (typeof data.total === 'number') setTotalRegistered(data.total);
      }
    } catch (err) {
      console.error("Error loading feed for range:", err);
    } finally {
      setIsUpdating(false);
    }
  };

  const getMarkerColor = (mag: number): string => {
    if (mag >= 5.0) return 'text-rose-400 bg-rose-500/10 border-rose-500/30';
    if (mag >= 4.0) return 'text-amber-400 bg-amber-500/10 border-amber-500/30';
    if (mag >= 2.5) return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30';
    return 'text-sky-400 bg-sky-500/10 border-sky-500/30';
  };

  const formatEventTime = (isoString?: string): { relative: string; dateStr: string } => {
    if (!isoString) return { relative: '--', dateStr: '--:--' };
    try {
      const d = new Date(isoString);
      const now = new Date();
      const diffMs = now.getTime() - d.getTime();
      const diffMins = Math.floor(diffMs / (1000 * 60));
      const diffHours = Math.floor(diffMins / 60);
      const diffDays = Math.floor(diffHours / 24);

      let relative = '';
      if (diffMins < 1) {
        relative = 'Ahora mismo';
      } else if (diffMins < 60) {
        relative = `Hace ${diffMins} min`;
      } else if (diffHours < 24) {
        relative = `Hace ${diffHours} h`;
      } else if (diffDays === 1) {
        relative = 'Ayer';
      } else {
        relative = `Hace ${diffDays} días`;
      }

      const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const dayStr = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
      const dateStr = feedRange === '24h'
        ? (diffHours >= 24 || d.getDate() !== now.getDate() ? `Ayer ${timeStr}` : `Hoy ${timeStr}`)
        : `${dayStr} ${timeStr}`;

      return { relative, dateStr };
    } catch {
      return { relative: '--', dateStr: String(isoString) };
    }
  };

  return (
    <div className="relative w-full h-full min-h-[600px] flex overflow-hidden bg-slate-950">
      {/* 3D WebGL Globe Viewport (Dominant Center/Left) */}
      <div className="relative flex-1 h-full overflow-hidden">
        <SeismicGlobe3D
          events={feedEvents}
          selectedEvent={selectedEvent}
          onSelectEvent={(ev) => setSelectedEvent(ev)}
        />

        {/* Floating Toggle Button for Sidebar */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className={`absolute top-4 right-4 z-30 p-2.5 rounded-xl bg-slate-900/80 hover:bg-slate-800 border border-slate-700/80 text-slate-200 backdrop-blur shadow-xl transition-all ${
            sidebarOpen ? 'translate-x-0' : 'translate-x-0'
          }`}
          title={sidebarOpen ? 'Ocultar panel de telemetría' : 'Mostrar panel de telemetría'}
        >
          {sidebarOpen ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* Collapsible Cockpit Telemetry Sidebar (Right) */}
      <div
        className={`h-full border-l border-slate-800/80 bg-slate-950/85 backdrop-blur-xl flex flex-col transition-all duration-300 z-20 ${
          sidebarOpen ? 'w-[420px] lg:w-[450px]' : 'w-0 border-l-0 overflow-hidden'
        }`}
      >
        {sidebarOpen && (
          <>
            {/* Sidebar Header & Navigation Tabs */}
            <div className="p-3.5 border-b border-slate-800/80 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      isUpdating ? 'bg-amber-400 animate-ping' : 'bg-emerald-400 animate-pulse'
                    }`}
                  ></div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                    Consola de Telemetría
                    {isUpdating && <RefreshCw className="w-3 h-3 text-sky-400 animate-spin" />}
                  </h3>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400">
                  USGS Live Feed
                </span>
              </div>

              {/* Feed Time Range Filter - Solo 24h, Semana y Mes */}
              <div className="grid grid-cols-3 gap-1 bg-slate-900/90 p-1 rounded-lg border border-slate-800/80 text-[11px]">
                {[
                  { id: '24h', label: '24 Horas' },
                  { id: '7d', label: 'Semana' },
                  { id: '30d', label: 'Mes' }
                ].map((item) => (
                  <button
                    key={item.id}
                    disabled={isUpdating}
                    onClick={() => handleFeedRangeChange(item.id)}
                    className={`py-1.5 rounded-md font-medium text-center transition-all cursor-pointer ${
                      feedRange === item.id
                        ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40 font-semibold shadow-sm'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              {/* Apartado Sismos Registrados */}
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900/90 border border-slate-800 shadow-inner">
                <div className="flex items-center gap-2.5">
                  <div className="p-1.5 rounded-lg bg-sky-500/10 border border-sky-500/30 text-sky-400">
                    <Activity className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-mono tracking-wider text-slate-400 block leading-tight">
                      Sismos Registrados
                    </span>
                    <span className="text-sm font-bold font-mono text-slate-100">
                      {totalRegistered.toLocaleString()} sismos
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono block">
                      {feedRange === '24h' ? 'Escala: Últimas 24 horas' : feedRange === '7d' ? 'Escala: Últimos 7 días' : 'Escala: Últimos 30 días'}
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-[10px] font-mono text-slate-400 block leading-tight">En Visor 3D</span>
                  <span className="text-xs font-mono font-semibold text-sky-400">
                    {feedEvents.length} balizas
                  </span>
                </div>
              </div>
            </div>

            {/* Sidebar Feed Content (Pure Seismic Event Stream) */}
            <div className="flex-1 overflow-y-auto p-3.5 space-y-3 custom-scrollbar">
              <div className="space-y-2.5">
                <div className="flex items-center justify-between text-[11px] text-slate-400 px-1">
                  <span>Haz clic en un evento para enfocar la cámara 3D</span>
                  <span className="text-[10px] text-slate-500 font-mono">Filtro: {feedRange}</span>
                </div>

                <div className={`space-y-2.5 transition-opacity duration-200 ${isUpdating ? 'opacity-60 pointer-events-none' : 'opacity-100'}`}>
                  {feedEvents.length === 0 ? (
                    <div className="text-center py-12 text-slate-500 text-xs">
                      No hay sismos reportados en el feed para este rango de tiempo
                    </div>
                  ) : (
                    feedEvents.map((ev) => {
                      const isSelected = selectedEvent?.event_id === ev.event_id;
                      const badgeClasses = getMarkerColor(ev.magnitude);

                      return (
                        <div
                          key={ev.event_id}
                          onClick={() => setSelectedEvent(ev)}
                          className={`p-3 rounded-xl border transition-all cursor-pointer ${
                            isSelected
                              ? 'bg-sky-500/10 border-sky-500/60 shadow-lg shadow-sky-500/5 ring-1 ring-sky-500/40'
                              : 'bg-slate-900/60 hover:bg-slate-900 border-slate-800/80 hover:border-slate-700'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2 mb-1.5">
                            <span
                              className={`text-xs font-black px-2 py-0.5 rounded-md border ${badgeClasses}`}
                            >
                              M {Number(ev.magnitude).toFixed(1)}
                            </span>
                            {(() => {
                              const timeInfo = formatEventTime(ev.event_time);
                              return (
                                <div className="text-right">
                                  <span className="text-[10px] font-mono font-semibold text-sky-400 block leading-tight">
                                    {timeInfo.relative}
                                  </span>
                                  <span className="text-[9px] font-mono text-slate-500 flex items-center gap-1 justify-end">
                                    <Clock className="w-2.5 h-2.5 text-slate-500" />
                                    {timeInfo.dateStr}
                                  </span>
                                </div>
                              );
                            })()}
                          </div>

                          <div className="text-xs font-semibold text-slate-200 line-clamp-1 mb-2">
                            {ev.place}
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-400 pt-2 border-t border-slate-800/60">
                            <div>
                              Región: <span className="text-slate-300 font-medium">{ev.region || 'Global'}</span>
                            </div>
                            <div>
                              Prof: <span className="text-slate-300 font-medium">{ev.depth_km !== undefined && ev.depth_km !== null && !isNaN(Number(ev.depth_km)) ? `${Number(ev.depth_km).toFixed(1)} km` : '--'}</span>
                            </div>
                            <div>
                              Radio PGA: <span className="text-sky-400 font-mono font-medium">{Number(ev.impact_radius_km || 0).toFixed(0)} km</span>
                            </div>
                            <div>
                              Estado: <span className="text-slate-300 capitalize">{ev.status}</span>
                            </div>
                          </div>

                          {ev.tsunami_alert && (
                            <div className="mt-2.5 flex items-center gap-1.5 text-[10px] font-bold text-rose-400 bg-rose-500/10 border border-rose-500/30 px-2 py-1 rounded">
                              <AlertTriangle className="w-3 h-3" />
                              ALERTA DE TSUNAMI EMITIDA
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
