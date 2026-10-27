import React, { useState, useEffect } from 'react';
import { AlertOctagon, RefreshCw, Database, ShieldAlert, CheckCircle, Clock, Play, FileCode, X } from 'lucide-react';
import { QuarantineRecord } from '../types';
import { api } from '../services/api';

export const QuarantineAdmin: React.FC = () => {
  const [quarantineItems, setQuarantineItems] = useState<QuarantineRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [selectedPayload, setSelectedPayload] = useState<any | null>(null);

  const loadQuarantine = async () => {
    setLoading(true);
    try {
      const data = await api.getQuarantine();
      setQuarantineItems(data.items);
      setTotal(data.total);
    } catch (err: any) {
      setActionMsg(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadQuarantine();
  }, []);

  const handleTriggerBackfill = async () => {
    setBackfilling(true);
    setActionMsg(null);
    try {
      const res = await api.triggerBackfill(7);
      setActionMsg(res.message || 'Backfill iniciado en Airflow.');
    } catch (err: any) {
      setActionMsg(`Fallo de ejecución: ${err.message}`);
    } finally {
      setBackfilling(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Control Actions */}
      <div className="p-6 rounded-xl border border-amber-500/30 bg-gradient-to-r from-amber-500/10 via-slate-900 to-slate-900 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-lg bg-amber-500/20 text-amber-400">
              <ShieldAlert className="w-5 h-5" />
            </span>
            <h2 className="text-lg font-bold text-white">Panel de Cuarentena y Control del Pipeline (Admin)</h2>
          </div>
          <p className="text-xs text-slate-300 mt-1 max-w-2xl">
            Registros aislados por el motor de calidad <strong>Pandera (lazy=True)</strong> en Capa Silver. 
            El aislamiento previene la corrupción de analíticas en Capa Gold sin detener el flujo de datos conformes.
          </p>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          <button
            onClick={handleTriggerBackfill}
            disabled={backfilling}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white transition-colors"
          >
            <Play className={`w-4 h-4 ${backfilling ? 'animate-spin' : ''}`} />
            Disparar Backfill (7 Días)
          </button>
          <button
            onClick={loadQuarantine}
            disabled={loading}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {actionMsg && (
        <div className="p-3 rounded-lg bg-slate-900 border border-amber-500/40 text-xs text-amber-200">
          {actionMsg}
        </div>
      )}

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 backdrop-blur">
          <span className="text-xs text-slate-400 font-semibold uppercase">Total Filas Cuarentenadas</span>
          <p className="text-2xl font-extrabold text-amber-400 mt-1">{total}</p>
          <span className="text-[11px] text-slate-500">Aisladas en staging.quarantine</span>
        </div>
        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 backdrop-blur">
          <span className="text-xs text-slate-400 font-semibold uppercase">Mínimo Privilegio (POLP)</span>
          <p className="text-sm font-bold text-emerald-400 mt-1">role_api_reader</p>
          <span className="text-[11px] text-slate-500">Expuesto únicamente vía curated.v_quarantine</span>
        </div>
        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 backdrop-blur">
          <span className="text-xs text-slate-400 font-semibold uppercase">Circuit Breaker & SLA</span>
          <p className="text-sm font-bold text-sky-400 mt-1">Activo (&lt; 120 min)</p>
          <span className="text-[11px] text-slate-500">Validación nivel lote bloqueante</span>
        </div>
      </div>

      {/* Quarantine Cards Section (Zero Horizontal Scroll) */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <AlertOctagon className="w-4 h-4 text-amber-400" />
            Registros Aislados en Cuarentena
          </h3>
          <span className="text-xs font-mono text-slate-400">Total: {total} filas aisladas</span>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="p-4 rounded-xl border border-slate-800 bg-slate-900/40 animate-pulse h-44 flex flex-col justify-between">
                <div className="h-4 bg-slate-800 rounded w-1/3 mb-2"></div>
                <div className="h-3 bg-slate-800 rounded w-2/3 mb-4"></div>
                <div className="h-12 bg-slate-800 rounded mb-2"></div>
              </div>
            ))}
          </div>
        ) : quarantineItems.length === 0 ? (
          <div className="p-12 text-center rounded-xl border border-slate-800 bg-slate-900/60 backdrop-blur text-emerald-400 text-xs">
            ✓ Cero registros en cuarentena. Todos los datos ingresados cumplen las reglas de calidad Pandera.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {quarantineItems.map((item) => (
              <div
                key={item.quarantine_id}
                className="p-4 rounded-xl border border-amber-500/20 bg-slate-900/70 hover:border-amber-500/40 hover:bg-slate-900 transition-all flex flex-col justify-between shadow-sm"
              >
                <div>
                  {/* Top Header: Quarantine ID & Event ID */}
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300 font-bold">
                      Cuarentena #{item.quarantine_id}
                    </span>
                    <span className="font-mono text-xs font-bold text-slate-300 truncate max-w-[150px]">
                      {item.event_id || 'ID_VACÍO'}
                    </span>
                  </div>

                  {/* Failed Rules Badges */}
                  <div className="mb-2.5">
                    <span className="text-[10px] font-mono text-slate-500 uppercase block mb-1">Reglas Violadas:</span>
                    <div className="flex flex-wrap gap-1">
                      {item.failed_rules && item.failed_rules.length > 0 ? (
                        item.failed_rules.map((r, i) => (
                          <span
                            key={i}
                            className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-rose-500/15 text-rose-300 border border-rose-500/30 font-semibold"
                          >
                            {r}
                          </span>
                        ))
                      ) : (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-amber-500/15 text-amber-300 border border-amber-500/30">
                          ANOMALÍA_ESQUEMA
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Rejection Reason */}
                  <div className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800/80 mb-3">
                    <span className="text-[9px] font-mono uppercase text-slate-500 block mb-0.5">Motivo del Rechazo:</span>
                    <p className="text-[11px] font-mono text-slate-300 line-clamp-2 leading-relaxed" title={item.rejection_reason}>
                      {item.rejection_reason || 'Rechazado por validación de esquema en Silver'}
                    </p>
                  </div>
                </div>

                {/* Footer: Date and JSON inspection button */}
                <div className="flex items-center justify-between pt-2 border-t border-slate-800/80 text-[11px] text-slate-400">
                  <span className="flex items-center gap-1 font-mono text-[10px]">
                    <Clock className="w-3 h-3 text-slate-500" />
                    {new Date(item.quarantined_at).toLocaleString([], {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </span>
                  <button
                    onClick={() => setSelectedPayload(item.payload)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-sky-400 hover:text-sky-300 text-[11px] font-medium border border-slate-700 transition-colors cursor-pointer"
                  >
                    <FileCode className="w-3 h-3" />
                    Ver JSON
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal for Raw JSON Payload */}
      {selectedPayload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="max-w-xl w-full p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h4 className="text-sm font-bold text-white">Payload Original Aislado</h4>
              <button
                onClick={() => setSelectedPayload(null)}
                className="text-slate-400 hover:text-white text-xs font-semibold"
              >
                Cerrar ✕
              </button>
            </div>
            <pre className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-xs text-sky-300 overflow-x-auto max-h-80 font-mono">
              {JSON.stringify(selectedPayload, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
};
