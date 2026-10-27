import React, { useState } from 'react';
import { Activity, Lock, User, AlertCircle, ShieldCheck, Eye } from 'lucide-react';
import { api } from '../services/api';
import { User as UserType } from '../types';

interface LoginModalProps {
  onSuccess: (user: UserType) => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({ onSuccess }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;
    setLoading(true);
    setError(null);
    try {
      const user = await api.login(username, password);
      onSuccess(user);
    } catch (err: any) {
      setError(err.message || 'Error de autenticación.');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickLogin = async (userRole: 'viewer' | 'admin') => {
    setLoading(true);
    setError(null);
    const u = userRole === 'admin' ? 'admin' : 'viewer';
    const p = userRole === 'admin' ? 'admin_sismowatch_2026_pwd' : 'viewer_sismowatch_2026_pwd';
    setUsername(u);
    setPassword(p);
    try {
      const user = await api.login(u, p);
      onSuccess(user);
    } catch (err: any) {
      setError(err.message || 'Error de autenticación rápida.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
      <div className="max-w-md w-full p-8 rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl space-y-6">
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex p-3 rounded-2xl bg-sky-500/10 border border-sky-500/20 text-sky-400 mb-1">
            <Activity className="w-8 h-8 animate-pulse" />
          </div>
          <h2 className="text-2xl font-black text-white tracking-tight">SismoWatch</h2>
          <p className="text-xs text-slate-400">Plataforma Medallion & IA Grounded de Monitoreo Sísmico Global</p>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-rose-950/50 border border-rose-800 text-xs text-rose-200 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Credentials Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
              Usuario
            </label>
            <div className="relative">
              <User className="w-4 h-4 absolute left-3 top-3 text-slate-500" />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin o viewer"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-sky-500 transition-colors"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
              Contraseña
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 absolute left-3 top-3 text-slate-500" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-sky-500 transition-colors"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-bold text-sm shadow-md transition-colors"
          >
            {loading ? 'Validando...' : 'Iniciar Sesión'}
          </button>
        </form>

        {/* Quick Demo Logins for Evaluator */}
        <div className="pt-4 border-t border-slate-800 space-y-2.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 block text-center">
            Acceso Rápido para Sustentación / Evaluación
          </span>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => handleQuickLogin('viewer')}
              disabled={loading}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-xs text-sky-300 font-semibold transition-colors"
            >
              <Eye className="w-3.5 h-3.5" />
              Rol Viewer
            </button>
            <button
              onClick={() => handleQuickLogin('admin')}
              disabled={loading}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-xs text-amber-300 font-semibold transition-colors"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              Rol Admin
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
