import React, { useState, useEffect } from 'react';
import { FileText, Sparkles, RefreshCw, Calendar, Globe, AlertCircle, Shield, Printer } from 'lucide-react';
import { AIReport, User } from '../types';
import { api } from '../services/api';

interface ReportsViewProps {
  user: User | null;
}

export const ReportsView: React.FC<ReportsViewProps> = ({ user }) => {
  const [latestReport, setLatestReport] = useState<AIReport | null>(null);
  const [reportsList, setReportsList] = useState<AIReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const loadReports = async () => {
    setLoading(true);
    try {
      const [latest, list] = await Promise.all([
        api.getLatestReport(),
        api.listReports()
      ]);
      setLatestReport(latest);
      setReportsList(list);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReports();
  }, []);

  const handleRegenerate = async () => {
    if (user?.role !== 'admin') return;
    setRegenerating(true);
    setMsg(null);
    try {
      const res = await api.triggerReportRegenerate();
      setMsg(res.message || 'Reporte programado exitosamente.');
      setTimeout(() => loadReports(), 4000);
    } catch (err: any) {
      setMsg(`Error: ${err.message}`);
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header with Admin trigger */}
      <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 backdrop-blur flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <FileText className="w-5 h-5 text-sky-400" />
            Reportes Ejecutivos Diarios de Actividad Sísmica
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Informes automatizados generados por IA a partir de métricas verificadas en Capa Gold.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {latestReport && (
            <button
              onClick={() => window.print()}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
              title="Descargar o imprimir reporte en PDF"
            >
              <Printer className="w-4 h-4 text-sky-400" />
              Exportar a PDF
            </button>
          )}

          {user?.role === 'admin' && (
            <button
              onClick={handleRegenerate}
              disabled={regenerating}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${regenerating ? 'animate-spin' : ''}`} />
              Regenerar Reporte Hoy (Admin)
            </button>
          )}
        </div>
      </div>

      {msg && (
        <div className="p-3 rounded-lg bg-sky-950/50 border border-sky-800 text-xs text-sky-200">
          {msg}
        </div>
      )}

      {/* Latest Report Feature Card */}
      {latestReport && (
        <div className="p-6 rounded-xl border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-900/80 to-slate-950 shadow-xl space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
            <div>
              <span className="text-[11px] font-mono uppercase tracking-wider text-sky-400 font-semibold">
                Informe Oficial Sísmico • {latestReport.report_date}
              </span>
              <h3 className="text-xl font-extrabold text-white mt-1">{latestReport.title}</h3>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs px-2.5 py-1 rounded-md font-mono bg-slate-800 border border-slate-700 text-slate-300">
                Modelo: {latestReport.model_used || 'qwen2.5-coder:1.5b'}
              </span>
            </div>
          </div>

          {/* Quick Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800">
              <span className="text-[11px] text-slate-400">Total Sismos</span>
              <p className="text-xl font-bold text-white">{latestReport.total_events}</p>
            </div>
            <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800">
              <span className="text-[11px] text-slate-400">Magnitud Máxima</span>
              <p className="text-xl font-bold text-amber-400">M {Number(latestReport.max_magnitude).toFixed(1)}</p>
            </div>
            <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800">
              <span className="text-[11px] text-slate-400">Regiones Afectadas</span>
              <p className="text-sm font-semibold text-slate-200 truncate">
                {latestReport.regions_affected?.slice(0, 2).join(', ') || 'Global'}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800">
              <span className="text-[11px] text-slate-400">Generado el</span>
              <p className="text-xs font-mono text-slate-300">
                {new Date(latestReport.generated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} UTC
              </p>
            </div>
          </div>

          {/* Executive Summary */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
              Resumen Ejecutivo
            </h4>
            <div className="p-4 rounded-xl bg-slate-950/40 border border-slate-800/80 text-sm leading-relaxed text-slate-200">
              {latestReport.summary}
            </div>
          </div>

          {/* Key Findings & Recommendations */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {latestReport.key_findings && latestReport.key_findings.length > 0 && (
              <div className="p-4 rounded-xl bg-slate-950/40 border border-slate-800/80 space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-sky-400 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  Hallazgos Clave
                </h4>
                <ul className="text-xs space-y-1.5 text-slate-300 list-disc list-inside">
                  {latestReport.key_findings.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              </div>
            )}

            {latestReport.recommendations && latestReport.recommendations.length > 0 && (
              <div className="p-4 rounded-xl bg-slate-950/40 border border-slate-800/80 space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5" />
                  Recomendaciones Operacionales
                </h4>
                <ul className="text-xs space-y-1.5 text-slate-300 list-disc list-inside">
                  {latestReport.recommendations.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
