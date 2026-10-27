import React, { useState } from 'react';
import { SeismicGlobe3D } from './SeismicGlobe3D';
import { KPICards } from './KPICards';
import { ChartsView } from './ChartsView';
import { EarthquakeEvent, KPIs, HourlyStat, RegionStat, MagnitudeStat } from '../types';
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
  AlertTriangle
} from 'lucide-react';

interface CockpitDashboardProps {
  events: EarthquakeEvent[];
  kpis: KPIs | null;
  hourlyStats: HourlyStat[];
  regionStats: RegionStat[];
  magnitudeStats: MagnitudeStat[];
  timeRange?: string;
  onTimeRangeChange?: (range: string) => void;
}

export const CockpitDashboard: React.FC<CockpitDashboardProps> = ({
  events,
  kpis,
  hourlyStats,
  regionStats,
  magnitudeStats,
  timeRange = '24h',
  onTimeRangeChange,
}) => {
  const [selectedEvent, setSelectedEvent] = useState<EarthquakeEvent | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);

  const getMarkerColor = (mag: number): string => {
    if (mag >= 5.0) return 'text-rose-400 bg-rose-500/10 border-rose-500/30';
    if (mag >= 4.0) return 'text-amber-400 bg-amber-500/10 border-amber-500/30';
    if (mag >= 2.5) return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30';
    return 'text-sky-400 bg-sky-500/10 border-sky-500/30';
  };

  const formatEventTime = (isoString?: string): string => {
    if (!isoString) return '--:--';
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return '--:--';
    }
  };

  return (
    <div className="relative w-full h-full min-h-[600px] flex overflow-hidden bg-slate-950">
      {/* 3D WebGL Globe Viewport (Dominant Center/Left) */}
      <div className="relative flex-1 h-full overflow-hidden">
        <SeismicGlobe3D
          events={events}
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
                  <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                    Consola de Telemetría
                  </h3>
                </div>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-sky-400 font-semibold">
                  {events.length} Sismos en Red
                </span>
              </div>

              {/* Feed Time Range Filter */}
              <div className="grid grid-cols-4 gap-1 bg-slate-900/90 p-1 rounded-lg border border-slate-800/80 text-[11px]">
                {[
                  { id: '24h', label: '24h' },
                  { id: '7d', label: 'Semana' },
                  { id: '30d', label: 'Mes' },
                  { id: '1y', label: 'Año' }
                ].map((item) => (
                  <button
                    key={item.id}
                    onClick={() => onTimeRangeChange && onTimeRangeChange(item.id)}
                    className={`py-1.5 rounded-md font-medium text-center transition-all cursor-pointer ${
                      timeRange === item.id
                        ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40 font-semibold shadow-sm'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Sidebar Feed Content (Pure Seismic Event Stream) */}
            <div className="flex-1 overflow-y-auto p-3.5 space-y-3 custom-scrollbar">
              <div className="space-y-2.5">
                <div className="flex items-center justify-between text-[11px] text-slate-400 px-1">
                  <span>Haz clic en un evento para enfocar la cámara 3D</span>
                  <span className="text-[10px] text-slate-500 font-mono">Filtro: {timeRange}</span>
                </div>

                {events.length === 0 ? (
                  <div className="text-center py-12 text-slate-500 text-xs">
                    No hay sismos reportados en el feed para este rango de tiempo
                  </div>
                ) : (
                  events.map((ev) => {
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
                          <span className="text-[10px] font-mono text-slate-500 flex items-center gap-1">
                            <Clock className="w-3 h-3 text-slate-500" />
                            {formatEventTime(ev.event_time)}
                          </span>
                        </div>

                        <div className="text-xs font-semibold text-slate-200 line-clamp-1 mb-2">
                          {ev.place}
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-400 pt-2 border-t border-slate-800/60">
                          <div>
                            Región: <span className="text-slate-300 font-medium">{ev.region || 'Global'}</span>
                          </div>
                          <div>
                            Prof: <span className="text-slate-300 font-medium">{Number(ev.depth_km).toFixed(1)} km</span>
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
          </>
        )}
      </div>
    </div>
  );
};
