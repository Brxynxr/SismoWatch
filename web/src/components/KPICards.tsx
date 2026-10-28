import React from 'react';
import { Activity, Flame, BarChart2, Waves, Clock, ShieldCheck } from 'lucide-react';
import { KPIs } from '../types';

interface KPICardsProps {
  kpis: KPIs | null;
  timeRangeLabel?: string;
}

export const KPICards: React.FC<KPICardsProps> = ({ kpis, timeRangeLabel = '24h' }) => {
  const formatTime = (ts?: string | null) => {
    if (!ts) return '--';
    try {
      const d = new Date(ts);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return '--';
    }
  };

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
    },
    {
      title: 'Calidad de Datos',
      value: kpis?.quality_score !== undefined ? `${Number(kpis.quality_score).toFixed(1)}%` : '99.0%',
      subtitle: (Number(kpis?.quality_score ?? 100) >= 80) ? 'Pipeline Saludable (Gold)' : 'Degradado (Revisar)',
      icon: ShieldCheck,
      color: (Number(kpis?.quality_score ?? 100) >= 80)
        ? 'from-teal-500/20 to-cyan-600/10 border-teal-500/30 text-teal-300'
        : 'from-amber-500/30 to-rose-600/20 border-amber-500/40 text-amber-400'
    },
    {
      title: 'Última Actualización',
      value: formatTime(kpis?.last_quality_update || kpis?.latest_event_time),
      subtitle: 'Sincronizado vía Airflow',
      icon: Clock,
      color: 'from-violet-500/20 to-purple-600/10 border-violet-500/30 text-violet-300'
    }
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4">
      {cards.map((c, idx) => {
        const Icon = c.icon;
        return (
          <div
            key={idx}
            className={`p-4 rounded-xl border bg-gradient-to-br bg-slate-900/60 backdrop-blur shadow-sm transition-transform hover:-translate-y-0.5 flex flex-col justify-between ${c.color}`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 leading-tight">
                {c.title}
              </span>
              <div className="p-1.5 rounded-lg bg-slate-950/60 border border-slate-800 shrink-0">
                <Icon className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2.5 flex items-baseline gap-2">
              <span className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">{c.value}</span>
            </div>
            <p className="mt-1 text-[11px] text-slate-400 font-medium truncate">{c.subtitle}</p>
          </div>
        );
      })}
    </div>
  );
};
