import React from 'react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell
} from 'recharts';
import { HourlyStat, RegionStat, MagnitudeStat } from '../types';

interface ChartsViewProps {
  hourlyStats: HourlyStat[];
  regionStats: RegionStat[];
  magnitudeStats: MagnitudeStat[];
}

const COLORS = ['#38bdf8', '#34d399', '#fbbf24', '#f97316', '#f43f5e', '#a855f7'];

export const ChartsView: React.FC<ChartsViewProps> = ({
  hourlyStats,
  regionStats,
  magnitudeStats
}) => {
  const formattedHourly = hourlyStats.map((h) => ({
    ...h,
    hour: new Date(h.hour_bucket).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* 24h Hourly Trend */}
      <div className="lg:col-span-2 p-5 rounded-xl border border-slate-800 bg-slate-900/60 backdrop-blur shadow-sm">
        <h3 className="text-sm font-semibold text-slate-300 mb-1">Actividad Sísmica por Hora (Últimas 24h)</h3>
        <p className="text-xs text-slate-500 mb-4">Frecuencia temporal y magnitud máxima observada en cada ventana</p>
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

      {/* Magnitude Distribution */}
      <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 backdrop-blur shadow-sm">
        <h3 className="text-sm font-semibold text-slate-300 mb-1">Distribución por Clase</h3>
        <p className="text-xs text-slate-500 mb-4">Proporción de eventos clasificados (Gold)</p>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={magnitudeStats} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis type="number" stroke="#64748b" fontSize={11} />
              <YAxis dataKey="magnitude_class" type="category" stroke="#64748b" fontSize={11} width={70} />
              <Tooltip
                contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px' }}
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
    </div>
  );
};
