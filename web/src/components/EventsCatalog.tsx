import React, { useState, useEffect } from 'react';
import { Download, Search, Filter, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
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

      {/* Events Table */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 backdrop-blur overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950/80 uppercase text-[11px] font-semibold text-slate-400 border-b border-slate-800">
              <tr>
                <th className="px-4 py-3">ID Evento</th>
                <th className="px-4 py-3">Magnitud</th>
                <th className="px-4 py-3">Lugar & Región</th>
                <th className="px-4 py-3">Prof.</th>
                <th className="px-4 py-3">Radio PGA</th>
                <th className="px-4 py-3">Fecha y Hora (UTC)</th>
                <th className="px-4 py-3">Tsunami</th>
                <th className="px-4 py-3">USGS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500 font-sans">
                    Cargando catálogo curado...
                  </td>
                </tr>
              ) : events.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500 font-sans">
                    No se encontraron sismos con los filtros actuales.
                  </td>
                </tr>
              ) : (
                events.map((ev) => (
                  <tr key={ev.event_id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="px-4 py-2.5 font-bold text-sky-400">{ev.event_id}</td>
                    <td className="px-4 py-2.5 font-sans">
                      <span className={`px-2 py-0.5 rounded font-bold text-xs ${
                        ev.magnitude >= 4.5
                          ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                          : ev.magnitude >= 2.5
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                      }`}>
                        M {Number(ev.magnitude).toFixed(1)} ({ev.magnitude_class})
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-sans">
                      <span className="font-medium text-slate-200 block truncate max-w-xs">{ev.place}</span>
                      <span className="text-[10px] text-slate-400">{ev.region}</span>
                    </td>
                    <td className="px-4 py-2.5">{Number(ev.depth_km).toFixed(1)} km</td>
                    <td className="px-4 py-2.5 text-emerald-400">{ev.impact_radius_km} km</td>
                    <td className="px-4 py-2.5 text-slate-400">{new Date(ev.event_time).toLocaleString()}</td>
                    <td className="px-4 py-2.5 font-sans">
                      {ev.tsunami_alert ? (
                        <span className="text-rose-400 font-bold">ALERTA</span>
                      ) : (
                        <span className="text-slate-500">No</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {ev.usgs_url ? (
                        <a
                          href={ev.usgs_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sky-400 hover:text-sky-300 inline-flex items-center gap-1"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      ) : '--'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="p-3 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between text-xs text-slate-400">
          <span>Mostrando {events.length} de {total} registros en Capa Gold</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span>Página {page} de {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="p-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
