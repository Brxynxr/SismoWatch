import { KPIs, EarthquakeEvent, HourlyStat, RegionStat, MagnitudeStat, AIReport, QuarantineRecord, User } from '../types';

const API_BASE = '';

export const getStoredUser = (): User | null => {
  const data = localStorage.getItem('sismowatch_user');
  if (!data) return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
};

export const setStoredUser = (user: User | null) => {
  if (user) {
    localStorage.setItem('sismowatch_user', JSON.stringify(user));
  } else {
    localStorage.removeItem('sismowatch_user');
  }
};

const authHeaders = () => {
  const user = getStoredUser();
  return {
    'Content-Type': 'application/json',
    ...(user?.token ? { Authorization: `Bearer ${user.token}` } : {})
  };
};

export const api = {
  login: async (username: string, password: string): Promise<User> => {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Credenciales inválidas' }));
      throw new Error(err.detail || 'Fallo de autenticación');
    }
    const data = await res.json();
    const user: User = {
      username: data.username,
      role: data.role,
      token: data.access_token
    };
    setStoredUser(user);
    return user;
  },

  logout: (): void => {
    setStoredUser(null);
  },

  getKPIs: async (range: string = '24h'): Promise<KPIs> => {
    const res = await fetch(`${API_BASE}/api/kpis?range=${range}`, { headers: authHeaders() });
    if (!res.ok) throw new Error('Error al cargar KPIs');
    return res.json();
  },

  getEvents: async (params: {
    min_magnitude?: number;
    max_magnitude?: number;
    region?: string;
    magnitude_class?: string;
    start_date?: string;
    end_date?: string;
    time_range?: string;
    page?: number;
    page_size?: number;
  }): Promise<{ items: EarthquakeEvent[]; total: number; page: number; total_pages: number }> => {
    const query = new URLSearchParams();
    if (params.min_magnitude !== undefined) query.append('min_magnitude', params.min_magnitude.toString());
    if (params.max_magnitude !== undefined) query.append('max_magnitude', params.max_magnitude.toString());
    if (params.region) query.append('region', params.region);
    if (params.magnitude_class) query.append('magnitude_class', params.magnitude_class);
    if (params.start_date) query.append('start_date', params.start_date);
    if (params.end_date) query.append('end_date', params.end_date);
    if (params.time_range) query.append('time_range', params.time_range);
    if (params.page) query.append('page', params.page.toString());
    if (params.page_size) query.append('page_size', params.page_size.toString());

    const res = await fetch(`${API_BASE}/api/events?${query.toString()}`, { headers: authHeaders() });
    if (!res.ok) throw new Error('Error al cargar catálogo de eventos');
    return res.json();
  },

  getHourlyStats: async (range: string = '24h'): Promise<HourlyStat[]> => {
    const res = await fetch(`${API_BASE}/api/stats/hourly?range=${range}`, { headers: authHeaders() });
    if (!res.ok) throw new Error('Error al cargar estadísticas horarias');
    return res.json();
  },

  getRegionStats: async (range: string = '24h'): Promise<RegionStat[]> => {
    const res = await fetch(`${API_BASE}/api/stats/regions?range=${range}`, { headers: authHeaders() });
    if (!res.ok) throw new Error('Error al cargar estadísticas regionales');
    return res.json();
  },

  getMagnitudeDistribution: async (range: string = '24h'): Promise<MagnitudeStat[]> => {
    const res = await fetch(`${API_BASE}/api/stats/magnitudes?range=${range}`, { headers: authHeaders() });
    if (!res.ok) throw new Error('Error al cargar distribución de magnitudes');
    return res.json();
  },

  getLatestReport: async (): Promise<AIReport> => {
    const res = await fetch(`${API_BASE}/api/reports/latest`, { headers: authHeaders() });
    if (!res.ok) throw new Error('Error al cargar reporte diario');
    return res.json();
  },

  listReports: async (): Promise<AIReport[]> => {
    const res = await fetch(`${API_BASE}/api/reports`, { headers: authHeaders() });
    if (!res.ok) throw new Error('Error al listar reportes');
    return res.json();
  },

  getQuarantine: async (): Promise<{ total: number; items: QuarantineRecord[] }> => {
    const res = await fetch(`${API_BASE}/api/quality/quarantine`, { headers: authHeaders() });
    if (!res.ok) {
      if (res.status === 403) throw new Error('Acceso denegado: Se requieren privilegios de Administrador.');
      throw new Error('Error al consultar registros en cuarentena');
    }
    return res.json();
  },

  triggerBackfill: async (daysBack: number = 7) => {
    const res = await fetch(`${API_BASE}/api/admin/backfill`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ days_back: daysBack })
    });
    if (!res.ok) throw new Error('Fallo al disparar backfill');
    return res.json();
  },

  triggerReportRegenerate: async () => {
    const res = await fetch(`${API_BASE}/api/admin/reports/regenerate`, {
      method: 'POST',
      headers: authHeaders()
    });
    if (!res.ok) throw new Error('Fallo al solicitar regeneración de reporte');
    return res.json();
  },

  askChat: async (
    message: string,
    provider: 'local' | 'cloud' = 'cloud',
    history?: Array<{ role: string; content: string }>
  ) => {
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ message, provider, history: history || [] })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Error en el asistente' }));
      throw new Error(err.detail || 'Error en comunicación con agente IA');
    }
    return res.json();
  }
};
