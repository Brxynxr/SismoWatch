export interface User {
  username: string;
  role: 'admin' | 'viewer';
  token: string;
}

export interface KPIs {
  total_events_24h: number;
  max_magnitude_24h: number | string;
  avg_magnitude_24h: number | string;
  tsunami_alerts_24h: number;
  latest_event_time: string | null;
  reviewed_events_24h: number;
}

export interface EarthquakeEvent {
  event_id: string;
  latitude: number;
  longitude: number;
  depth_km: number;
  magnitude: number;
  magnitude_class: string;
  place: string;
  region: string;
  impact_radius_km: number;
  event_time: string;
  updated_time?: string;
  tsunami_alert: boolean;
  status?: string;
  significance?: number;
  mag_type?: string;
  usgs_url?: string;
}

export interface HourlyStat {
  hour_bucket: string;
  event_count: number;
  max_magnitude: number;
}

export interface RegionStat {
  region: string;
  event_count: number;
  max_magnitude: number;
  avg_magnitude: number;
}

export interface MagnitudeStat {
  magnitude_class: string;
  event_count: number;
  percentage: number;
}

export interface QuarantineRecord {
  quarantine_id: number;
  event_id: string;
  failed_rules: string[];
  rejection_reason: string;
  payload: any;
  quarantined_at: string;
}

export interface AIReport {
  report_id: number;
  report_date: string;
  title: string;
  summary: string;
  key_findings?: string[];
  recommendations?: string[];
  total_events: number;
  max_magnitude: number;
  avg_magnitude?: number;
  tsunami_alerts?: number;
  regions_affected?: string[];
  model_used?: string;
  execution_seconds?: number;
  generated_at: string;
}

export interface ProofOfGrounding {
  verified: boolean;
  source_table: string;
  rows_retrieved: number;
  db_role: string;
  statement_timeout_ms: number;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  sql_query?: string;
  sql_results?: any[];
  proof_of_grounding?: ProofOfGrounding;
  model_used?: string;
  latency_seconds?: number;
  provider?: string;
  error?: boolean;
}
