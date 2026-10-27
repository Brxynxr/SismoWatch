import React from 'react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell
} from 'recharts';
import { HourlyStat, RegionStat, MagnitudeStat } from '../types';

interface ChartsViewProps {
  hourlyStats: HourlyStat[];
  regionStats: RegionStat[];
  magnitudeStats: MagnitudeStat[];
  timeRangeLabel?: string;
}

const COLORS = ['#38bdf8', '#34d399', '#fbbf24', '#f97316', '#f43f5e', '#a855f7'];

export const ChartsView: React.FC<ChartsViewProps> = ({
  hourlyStats,
  regionStats,
  magnitudeStats,
  timeRangeLabel = '24h'
}) => {
  const formattedHourly = hourlyStats.map((h) => {
    try {
      const d = new Date(h.hour_bucket);
      const isDateBucket = timeRangeLabel === 'Mes' || timeRangeLabel === 'Año' || timeRangeLabel === 'Semana';
      const label = isDateBucket
        ? d.toLocaleDateString([], { month: 'short', day: 'numeric' })
        : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return {
        ...h,
        hour: label,
        fullTimestamp: d.toLocaleString([], {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })
      };
    } catch {
      return { ...h, hour: String(h.hour_bucket), fullTimestamp: String(h.hour_bucket) };
    }
  });

  return (
    <div className="space-y-6">
      {/* 1. Actividad Sísmica Temporal (Full Width Hero Chart) */}
      <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur shadow-sm">
        <h3 className="text-sm font-semibold text-slate-300 mb-1">Actividad Sísmica Temporal ({timeRangeLabel})</h3>
        <p className="text-xs text-slate-500 mb-4">Frecuencia temporal y picos observados en cada ventana</p>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={formattedHourly}>
              <defs>
                <linearGradient id="eventCountGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#0284c7" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#0284c7" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="hour" stroke="#64748b" fontSize={11} />
              <YAxis stroke="#64748b" fontSize={11} allowDecimals={false} />
              <Tooltip
                contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px' }}
                labelStyle={{ color: '#94a3b8' }}
                labelFormatter={(_, items) => items?.[0]?.payload?.fullTimestamp || ''}
              />
              <Area
                type="monotone"
                dataKey="event_count"
                name="Sismos"
                stroke="#38bdf8"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#eventCountGrad)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 2. Distribución por Clase Sísmica (Card completa vertical debajo de actividad) */}
      <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur shadow-sm">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold text-slate-300">Distribución por Clase Sísmica ({timeRangeLabel})</h3>
          <span className="text-[11px] font-mono text-slate-400">Total: {magnitudeStats.reduce((acc, m) => acc + (m.event_count || 0), 0)} sismos</span>
        </div>
        <p className="text-xs text-slate-500 mb-4">Clasificación estándar USGS (Micro, Minor, Light, Moderate, Strong)</p>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={magnitudeStats} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis type="number" stroke="#64748b" fontSize={11} />
              <YAxis dataKey="magnitude_class" type="category" stroke="#64748b" fontSize={11} width={80} />
              <Tooltip
                contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px' }}
                formatter={(val: any, name: any, item: any) => [
                  `${val} eventos (${item?.payload?.percentage || 0}%)`,
                  'Frecuencia'
                ]}
              />
              <Bar dataKey="event_count" name="Eventos" radius={[0, 4, 4, 0]}>
                {magnitudeStats.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 3. Top Regiones con Mayor Actividad Sísmica (Card completa vertical debajo) */}
      <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur shadow-sm">
        <h3 className="text-sm font-semibold text-slate-300 mb-1">Top Regiones con Mayor Actividad ({timeRangeLabel})</h3>
        <p className="text-xs text-slate-500 mb-4">Zonas tectónicas con mayor acumulación de eventos en este período</p>
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={regionStats.slice(0, 7)} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis type="number" stroke="#64748b" fontSize={11} />
              <YAxis dataKey="region" type="category" stroke="#64748b" fontSize={11} width={120} />
              <Tooltip
                contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px' }}
                formatter={(val: any, name: any, item: any) => [
                  `${val} sismos (M máx: ${item?.payload?.max_magnitude ?? 'N/A'}, M prom: ${item?.payload?.avg_magnitude ?? 'N/A'})`,
                  'Actividad'
                ]}
              />
              <Bar dataKey="event_count" name="Sismos" fill="#06b6d4" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};
