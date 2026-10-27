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
  const getRangeMeta = () => {
    switch (timeRangeLabel) {
      case '24h':
        return {
          title: 'Actividad Sísmica por Hora (Últimas 24 Horas)',
          metricUnit: 'Escala: Horas (UTC)',
          subtitle: 'Eje X: Horas del día • Eje Y: Cantidad de sismos registrados en cada hora',
          yAxisLabel: 'Sismos / hora'
        };
      case 'Semana':
        return {
          title: 'Actividad Sísmica Diaria (Últimos 7 Días)',
          metricUnit: 'Escala: Días de la semana',
          subtitle: 'Eje X: Días de la semana • Eje Y: Cantidad de sismos registrados por día',
          yAxisLabel: 'Sismos / día'
        };
      case 'Mes':
        return {
          title: 'Actividad Sísmica por Semanas (Últimos 30 Días)',
          metricUnit: 'Escala: Semanas del mes',
          subtitle: 'Eje X: Semanas del mes en orden cronológico • Eje Y: Cantidad de sismos registrados por semana',
          yAxisLabel: 'Sismos / semana'
        };
      case 'Año':
        return {
          title: 'Actividad Sísmica Mensual (Año en Curso)',
          metricUnit: 'Escala: Meses (Ene - Mes Actual)',
          subtitle: 'Eje X: Meses del año (desde enero hasta el mes en curso) • Eje Y: Cantidad de sismos registrados por mes',
          yAxisLabel: 'Sismos / mes'
        };
      default:
        return {
          title: `Actividad Sísmica Temporal (${timeRangeLabel})`,
          metricUnit: 'Escala Temporal',
          subtitle: 'Frecuencia temporal y picos observados en cada intervalo',
          yAxisLabel: 'Sismos'
        };
    }
  };

  const meta = getRangeMeta();

  const formattedHourly = hourlyStats.map((h, idx) => {
    try {
      const d = new Date(h.hour_bucket);
      let axisLabel = '';
      let tooltipTitle = '';

      if (timeRangeLabel === '24h') {
        axisLabel = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        tooltipTitle = `Hora: ${axisLabel} (${d.toLocaleDateString([], { day: 'numeric', month: 'short' })})`;
      } else if (timeRangeLabel === 'Semana') {
        axisLabel = d.toLocaleDateString([], { weekday: 'short', day: 'numeric' });
        tooltipTitle = `Día: ${d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}`;
      } else if (timeRangeLabel === 'Mes') {
        axisLabel = `Semana ${idx + 1}`;
        const endOfWeek = new Date(d);
        endOfWeek.setDate(d.getDate() + 6);
        tooltipTitle = `Semana ${idx + 1} (${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} - ${endOfWeek.toLocaleDateString([], { day: 'numeric', month: 'short' })})`;
      } else {
        // Año: asegurar timeZone UTC para evitar desplazamientos por huso horario del navegador
        const rawMonth = d.toLocaleDateString([], { month: 'short', timeZone: 'UTC' });
        axisLabel = rawMonth.charAt(0).toUpperCase() + rawMonth.slice(1);
        const fullMonth = d.toLocaleDateString([], { month: 'long', year: 'numeric', timeZone: 'UTC' });
        tooltipTitle = `Mes: ${fullMonth.charAt(0).toUpperCase() + fullMonth.slice(1)}`;
      }

      return {
        ...h,
        axisLabel,
        fullTimestamp: tooltipTitle
      };
    } catch {
      return { ...h, axisLabel: String(h.hour_bucket), fullTimestamp: String(h.hour_bucket) };
    }
  });

  return (
    <div className="space-y-6">
      {/* 1. Actividad Sísmica Temporal (Full Width Hero Chart) */}
      <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 mb-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-200">{meta.title}</h3>
            <p className="text-xs text-slate-400">{meta.subtitle}</p>
          </div>
          <span className="self-start sm:self-auto text-[10px] font-mono font-medium px-2 py-0.5 rounded bg-sky-500/10 border border-sky-500/30 text-sky-400">
            {meta.metricUnit}
          </span>
        </div>

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
              <XAxis dataKey="axisLabel" stroke="#64748b" fontSize={11} />
              <YAxis stroke="#64748b" fontSize={11} allowDecimals={false} />
              <Tooltip
                contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px' }}
                labelStyle={{ color: '#38bdf8', fontWeight: 600, marginBottom: '4px' }}
                labelFormatter={(_, items) => items?.[0]?.payload?.fullTimestamp || ''}
                formatter={(val: any, name: any, item: any) => [
                  `${val} sismos (M máx: ${item?.payload?.max_magnitude ?? 'N/A'})`,
                  meta.yAxisLabel
                ]}
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
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 mb-1">
          <div>
            <h3 className="text-sm font-semibold text-slate-200">Distribución por Clase Sísmica ({timeRangeLabel})</h3>
            <p className="text-xs text-slate-400">Clasificación estándar de magnitud USGS según energía liberada</p>
          </div>
          <span className="self-start sm:self-auto text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300">
            Total en período: {magnitudeStats.reduce((acc, m) => acc + (m.event_count || 0), 0)} sismos
          </span>
        </div>

        <div className="h-64 w-full my-3">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={magnitudeStats} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis type="number" stroke="#64748b" fontSize={11} />
              <YAxis dataKey="magnitude_class" type="category" stroke="#64748b" fontSize={11} width={80} />
              <Tooltip
                contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px' }}
                formatter={(val: any, name: any, item: any) => [
                  `${val} eventos (${item?.payload?.percentage || 0}% del período)`,
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

        {/* Guía didáctica para que cualquier persona entienda */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-3 border-t border-slate-800/80 text-[10px]">
          <div className="bg-slate-950/60 p-2 rounded-lg border border-slate-800/60">
            <span className="font-bold text-sky-400 block">Micro (&lt; 2.0)</span>
            <span className="text-slate-400 leading-tight">Imperceptible</span>
          </div>
          <div className="bg-slate-950/60 p-2 rounded-lg border border-slate-800/60">
            <span className="font-bold text-emerald-400 block">Minor (2.0 - 3.9)</span>
            <span className="text-slate-400 leading-tight">Casi imperceptible</span>
          </div>
          <div className="bg-slate-950/60 p-2 rounded-lg border border-slate-800/60">
            <span className="font-bold text-amber-400 block">Light (4.0 - 4.9)</span>
            <span className="text-slate-400 leading-tight">Sentido ampliamente</span>
          </div>
          <div className="bg-slate-950/60 p-2 rounded-lg border border-slate-800/60">
            <span className="font-bold text-orange-400 block">Moderate (5.0 - 5.9)</span>
            <span className="text-slate-400 leading-tight">Daños menores</span>
          </div>
          <div className="bg-slate-950/60 p-2 rounded-lg border border-slate-800/60 col-span-2 sm:col-span-1">
            <span className="font-bold text-rose-400 block">Strong+ (≥ 6.0)</span>
            <span className="text-slate-400 leading-tight">Riesgo destructivo</span>
          </div>
        </div>
      </div>

      {/* 3. Top Regiones con Mayor Actividad Sísmica (Card completa vertical debajo) */}
      <div className="p-5 rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 mb-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-200">Top Regiones con Mayor Actividad ({timeRangeLabel})</h3>
            <p className="text-xs text-slate-400">Zonas tectónicas con mayor acumulación de eventos en este período</p>
          </div>
          <span className="self-start sm:self-auto text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
            Medición: Sismos acumulados
          </span>
        </div>
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
