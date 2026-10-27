import React, { useState, useEffect } from 'react';
import { Download, Search, Filter, ChevronLeft, ChevronRight, ExternalLink, Clock, AlertTriangle, Activity } from 'lucide-react';
import { EarthquakeEvent } from '../types';
import { api, getStoredUser } from '../services/api';

export const EventsCatalog: React.FC = () => {
  const [events, setEvents] = useState<EarthquakeEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);

  // Filters
  const [regionFilter, setRegionFilter] = useState('');
  const [minMag, setMinMag] = useState<number | undefined>(undefined);
  const [magClass, setMagClass] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await api.getEvents({
        page,
        page_size: 15,
        region: regionFilter || undefined,
        min_magnitude: minMag,
        magnitude_class: magClass || undefined
      });
      setEvents(data.items);
      setTotal(data.total);
      setTotalPages(data.total_pages);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [page, minMag, magClass]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    loadData();
  };

  const handleExportCSV = () => {
    const user = getStoredUser();
    const token = user?.token || '';
    const query = new URLSearchParams();
    if (minMag !== undefined) query.append('min_magnitude', minMag.toString());
    if (regionFilter) query.append('region', regionFilter);

    // Trigger download
    const url = `/api/reports/export?${query.toString()}`;
    fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => res.blob())
      .then(blob => {
        const downloadUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = `sismowatch_export_${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      })
      .catch(err => console.error("Error exporting CSV:", err));
  };

  return (
    <div className="space-y-4">
      {/* Search & Filter Bar */}
      <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 backdrop-blur flex flex-col md:flex-row gap-3 items-center justify-between">
        <form onSubmit={handleSearch} className="flex flex-wrap gap-2.5 items-center w-full md:w-auto">
          {/* Region Search */}
          <div className="relative min-w-[200px]">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
            <input
              type="text"
              placeholder="Filtrar por región..."
              value={regionFilter}
              onChange={(e) => setRegionFilter(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
            />
          </div>

          {/* Min Magnitude */}
          <select
            value={minMag ?? ''}
            onChange={(e) => {
              setMinMag(e.target.value ? Number(e.target.value) : undefined);
              setPage(1);
            }}
            className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-sky-500"
          >
            <option value="">Cualquier Magnitud</option>
            <option value="1.0">≥ M 1.0</option>
            <option value="2.5">≥ M 2.5</option>
            <option value="4.0">≥ M 4.0</option>
            <option value="5.0">≥ M 5.0 (Fuerte)</option>
          </select>

          {/* Magnitude Class */}
          <select
            value={magClass}
            onChange={(e) => {
              setMagClass(e.target.value);
              setPage(1);
            }}
            className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-sky-500"
          >
            <option value="">Todas las Clases</option>
            <option value="Micro">Micro (&lt; 2.0)</option>
            <option value="Minor">Minor (2.0 - 3.9)</option>
            <option value="Light">Light (4.0 - 4.9)</option>
            <option value="Moderate">Moderate (5.0 - 5.9)</option>
            <option value="Strong">Strong (6.0+)</option>
          </select>

          <button
            type="submit"
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-sky-600 hover:bg-sky-500 text-white transition-colors"
          >
            Buscar
          </button>
        </form>

        {/* Export Button */}
        <button
          onClick={handleExportCSV}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors w-full md:w-auto justify-center"
        >
          <Download className="w-3.5 h-3.5 text-sky-400" />
          Exportar Catálogo (CSV)
        </button>
      </div>

      {/* Events Grid (3 Column Cards Layout - Zero Horizontal Scroll) */}
      <div className="space-y-4">
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="p-4 rounded-xl border border-slate-800 bg-slate-900/40 animate-pulse h-40 flex flex-col justify-between">
                <div className="h-4 bg-slate-800 rounded w-1/3 mb-2"></div>
                <div className="h-3 bg-slate-800 rounded w-3/4 mb-4"></div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="h-6 bg-slate-800 rounded"></div>
                  <div className="h-6 bg-slate-800 rounded"></div>
                  <div className="h-6 bg-slate-800 rounded"></div>
                </div>
              </div>
            ))}
          </div>
        ) : events.length === 0 ? (
          <div className="p-12 text-center rounded-xl border border-slate-800 bg-slate-900/60 backdrop-blur text-slate-500 text-xs">
            No se encontraron sismos con los filtros actuales en el catálogo curado.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {events.map((ev) => {
              const isStrong = Number(ev.magnitude) >= 4.5;
              const isMinor = Number(ev.magnitude) >= 2.5;
              const badgeClass = isStrong
                ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                : isMinor
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                : 'bg-sky-500/20 text-sky-300 border-sky-500/40';

              const eventDate = new Date(ev.event_time);
              const formattedDate = eventDate.toLocaleDateString([], {
                month: 'short',
                day: 'numeric'
              });
              const formattedTime = eventDate.toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit'
              });

              return (
                <div
                  key={ev.event_id}
                  className="p-4 rounded-xl border border-slate-800 bg-slate-900/70 hover:border-slate-700 hover:bg-slate-900 transition-all flex flex-col justify-between group shadow-sm hover:shadow-md"
                >
                  <div>
                    {/* Top Header: ID & Magnitude */}
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <span className="font-mono text-[11px] font-bold text-sky-400 group-hover:text-sky-300 transition-colors">
                        #{ev.event_id}
                      </span>
                      <span className={`px-2 py-0.5 rounded text-[11px] font-bold font-mono border whitespace-nowrap ${badgeClass}`}>
                        M {Number(ev.magnitude).toFixed(1)} ({ev.magnitude_class})
                      </span>
                    </div>

                    {/* Place and Region */}
                    <h4 className="text-xs font-semibold text-slate-200 line-clamp-2 mb-1 group-hover:text-white transition-colors" title={ev.place}>
                      {ev.place || 'Epicentro no especificado'}
                    </h4>
                    <span className="text-[11px] text-slate-400 block mb-3">
                      Región: <span className="text-slate-300">{ev.region || 'Global'}</span>
                    </span>

                    {/* Metrics Grid */}
                    <div className="grid grid-cols-3 gap-1.5 p-2 rounded-lg bg-slate-950/70 border border-slate-800/70 text-[10px] font-mono text-slate-400 mb-3">
                      <div>
                        <span className="text-slate-500 block text-[9px] uppercase">Profundidad</span>
                        <span className="text-slate-200 font-semibold">{Number(ev.depth_km ?? 0).toFixed(1)} km</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[9px] uppercase">Radio PGA</span>
                        <span className="text-sky-400 font-semibold">{Number(ev.impact_radius_km ?? 0).toFixed(0)} km</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[9px] uppercase">Estado</span>
                        <span className="text-emerald-400 font-semibold capitalize">{ev.status || 'rec'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Card Footer: Timestamp & USGS External Link */}
                  <div>
                    {ev.tsunami_alert && (
                      <div className="mb-2.5 flex items-center gap-1.5 text-[10px] font-bold text-rose-400 bg-rose-500/10 border border-rose-500/30 px-2 py-1 rounded">
                        <AlertTriangle className="w-3 h-3" />
                        ALERTA DE TSUNAMI
                      </div>
                    )}
                    <div className="flex items-center justify-between pt-2 border-t border-slate-800/80 text-[11px] text-slate-400">
                      <span className="flex items-center gap-1 font-mono text-[10px]">
                        <Clock className="w-3 h-3 text-slate-500" />
                        {formattedDate} {formattedTime}
                      </span>
                      {ev.usgs_url ? (
                        <a
                          href={ev.usgs_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-sky-400 hover:text-sky-300 hover:underline"
                        >
                          Ficha USGS
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <span className="text-slate-600 text-[10px]">Sin ficha</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination Footer */}
        <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-950/70 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-400">
          <span className="font-mono text-[11px]">
            Mostrando <strong className="text-slate-200">{events.length}</strong> de <strong className="text-sky-400">{total.toLocaleString()}</strong> registros en Capa Gold
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
              className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:bg-slate-800 hover:border-slate-700 disabled:opacity-40 text-slate-300 transition-colors cursor-pointer"
              title="Página anterior"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="font-mono text-[11px] px-2">
              Página <strong className="text-slate-200">{page}</strong> de <strong className="text-slate-200">{totalPages}</strong>
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
              className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:bg-slate-800 hover:border-slate-700 disabled:opacity-40 text-slate-300 transition-colors cursor-pointer"
              title="Página siguiente"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
