import React from 'react';
import { Activity, Flame, BarChart2, Waves, Clock, CheckCircle } from 'lucide-react';
import { KPIs } from '../types';

interface KPICardsProps {
  kpis: KPIs | null;
  timeRangeLabel?: string;
}

export const KPICards: React.FC<KPICardsProps> = ({ kpis, timeRangeLabel = '24h' }) => {
  const cards = [
    {
      title: `Total Sismos (${timeRangeLabel})`,
      value: kpis?.total_events_24h ?? '--',
      subtitle: `${kpis?.reviewed_events_24h ?? 0} revisados por sismólogo`,
      icon: Activity,
      color: 'from-sky-500/20 to-blue-600/10 border-sky-500/30 text-sky-400'
    },
    {
      title: `Magnitud Máxima (${timeRangeLabel})`,
      value: kpis?.max_magnitude_24h ? Number(kpis.max_magnitude_24h).toFixed(2) : '--',
      subtitle: Number(kpis?.max_magnitude_24h || 0) >= 4.5 ? 'Atención Requerida' : 'Rango Normal',
      icon: Flame,
      color: 'from-amber-500/20 to-orange-600/10 border-amber-500/30 text-amber-400'
    },
    {
      title: 'Magnitud Promedio',
      value: kpis?.avg_magnitude_24h ? Number(kpis.avg_magnitude_24h).toFixed(2) : '--',
      subtitle: 'Actividad basal global',
      icon: BarChart2,
      color: 'from-emerald-500/20 to-teal-600/10 border-emerald-500/30 text-emerald-400'
    },
    {
      title: 'Alertas de Tsunami',
      value: kpis?.tsunami_alerts_24h ?? 0,
      subtitle: (kpis?.tsunami_alerts_24h ?? 0) > 0 ? 'ALERTA COSTERA ACTIVA' : 'Sin alertas vigentes',
      icon: Waves,
      color: (kpis?.tsunami_alerts_24h ?? 0) > 0
        ? 'from-rose-500/30 to-red-600/20 border-rose-500/40 text-rose-400'
        : 'from-indigo-500/20 to-purple-600/10 border-indigo-500/30 text-indigo-400'
    }
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((c, idx) => {
        const Icon = c.icon;
        return (
          <div
            key={idx}
            className={`p-5 rounded-xl border bg-gradient-to-br bg-slate-900/60 backdrop-blur shadow-sm transition-transform hover:-translate-y-0.5 ${c.color}`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                {c.title}
              </span>
              <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800">
                <Icon className="w-5 h-5" />
              </div>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-3xl font-extrabold tracking-tight text-white">{c.value}</span>
            </div>
            <p className="mt-1 text-xs text-slate-400 font-medium">{c.subtitle}</p>
          </div>
        );
      })}
    </div>
  );
};
