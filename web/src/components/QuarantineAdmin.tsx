import React, { useState, useEffect } from 'react';
import { AlertOctagon, RefreshCw, Database, ShieldAlert, CheckCircle, Clock, Play } from 'lucide-react';
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

      {/* Quarantine Table */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 backdrop-blur overflow-hidden">
        <div className="p-4 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <AlertOctagon className="w-4 h-4 text-amber-400" />
            Registros Aislados en Cuarentena
          </h3>
          <span className="text-xs font-mono text-slate-400">Total: {total}</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950/80 uppercase text-[11px] font-semibold text-slate-400 border-b border-slate-800">
              <tr>
                <th className="px-4 py-3">ID Cuarentena</th>
                <th className="px-4 py-3">ID Evento</th>
                <th className="px-4 py-3">Reglas Violadas</th>
                <th className="px-4 py-3">Motivo de Rechazo</th>
                <th className="px-4 py-3">Fecha Aislamiento</th>
                <th className="px-4 py-3">Payload</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500 font-sans">
                    Consultando cuarentena...
                  </td>
                </tr>
              ) : quarantineItems.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-emerald-400 font-sans">
                    ✓ Cero registros en cuarentena. Todos los datos ingresados cumplen las reglas de calidad Pandera.
                  </td>
                </tr>
              ) : (
                quarantineItems.map((item) => (
                  <tr key={item.quarantine_id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="px-4 py-2.5 font-bold text-slate-400">#{item.quarantine_id}</td>
                    <td className="px-4 py-2.5 text-amber-400 font-semibold">{item.event_id || 'NULL'}</td>
                    <td className="px-4 py-2.5 font-sans">
                      <div className="flex flex-wrap gap-1">
                        {item.failed_rules?.map((r, i) => (
                          <span
                            key={i}
                            className="px-1.5 py-0.5 rounded text-[10px] bg-rose-500/10 text-rose-300 border border-rose-500/20"
                          >
                            {r}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 font-sans text-slate-300 max-w-xs truncate" title={item.rejection_reason}>
                      {item.rejection_reason}
                    </td>
                    <td className="px-4 py-2.5 text-slate-400">
                      {new Date(item.quarantined_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 font-sans">
                      <button
                        onClick={() => setSelectedPayload(item.payload)}
                        className="text-xs text-sky-400 hover:text-sky-300 underline"
                      >
                        Ver JSON
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
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
