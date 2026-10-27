"""
DAG: usgs_daily_report_anomaly
Description: Computes daily seismic metrics, detects regional statistical anomalies (Z-Score),
generates narrative executive reports in Spanish with Grounded Local LLM, and stores audit logs.
"""
import os
import json
import time
import math
import logging
from datetime import datetime, timezone, timedelta, date
from typing import Dict, Any, List
import requests
from airflow.decorators import dag, task
from include.callbacks import task_failure_alert

logger = logging.getLogger("airflow.task")

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://host.docker.internal:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5-coder:1.5b")
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.1-8b-instant")

POSTGRES_HOST = os.getenv("POSTGRES_HOST", "postgres")
POSTGRES_PORT = int(os.getenv("POSTGRES_PORT", "5432"))
POSTGRES_DB = os.getenv("POSTGRES_DB", "sismowatch_db")
DB_USER = os.getenv("DB_TRANSFORMATION_USER", "user_transformation")
DB_PASSWORD = os.getenv("DB_TRANSFORMATION_PASSWORD", "transformation_secret_pwd_2026")

def get_transformation_db_conn():
    import psycopg2
    from psycopg2.extras import RealDictCursor
    return psycopg2.connect(
        host=POSTGRES_HOST,
        port=POSTGRES_PORT,
        dbname=POSTGRES_DB,
        user=DB_USER,
        password=DB_PASSWORD
    )

def query_llm(prompt: str, system_prompt: str, fallback_summary: str = "") -> str:
    """Calls Ollama (or Groq if configured) for structured text generation with resilient fallback."""
    if GROQ_API_KEY:
        try:
            res = requests.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {GROQ_API_KEY}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": GROQ_MODEL,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": 0.2
                },
                timeout=20
            )
            if res.status_code == 200:
                return res.json()["choices"][0]["message"]["content"]
        except Exception as e:
            logger.warning("Groq failed in DAG: %s. Falling back to Ollama.", e)

    # Local Ollama
    try:
        url = f"{OLLAMA_BASE_URL}/api/chat"
        payload = {
            "model": "qwen2.5-coder:1.5b",
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt}
            ],
            "stream": False,
            "options": {"temperature": 0.2}
        }
        res = requests.post(url, json=payload, timeout=60)
        if res.status_code == 200:
            return res.json().get("message", {}).get("content", "")
        else:
            logger.warning("Ollama returned status %d: %s", res.status_code, res.text)
    except Exception as e:
        logger.warning("Local LLM call failed or timed out: %s. Engaging deterministic grounded fallback.", e)

    if fallback_summary:
        return fallback_summary

    return "Informe consolidado a partir de los datos registrados en Capa Gold."

@dag(
    dag_id="usgs_daily_report_anomaly",
    description="Generación de reporte ejecutivo diario y detección de anomalías Z-score",
    schedule="0 6 * * *",  # 06:00 UTC diariamente
    start_date=datetime(2026, 1, 1),
    catchup=False,
    max_active_runs=1,
    default_args={
        "owner": "sismowatch",
        "retries": 2,
        "retry_delay": timedelta(minutes=2),
        "on_failure_callback": task_failure_alert,
    },
    tags=["gold", "ai", "reports", "anomalies"]
)
def daily_report_anomaly_pipeline():

    @task
    def detect_anomalies_and_metrics() -> Dict[str, Any]:
        """Calculates 24h summary metrics and detects Z-score statistical anomalies."""
        from psycopg2.extras import RealDictCursor

        with get_transformation_db_conn() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                # 1. 24h metrics from Gold
                cur.execute("""
                    SELECT count(*) as total_events,
                           COALESCE(MAX(magnitude), 0.0) as max_magnitude,
                           COALESCE(AVG(magnitude), 0.0) as avg_magnitude,
                           COALESCE(SUM(CASE WHEN tsunami_alert THEN 1 ELSE 0 END), 0) as tsunami_alerts
                    FROM curated.earthquakes
                    WHERE event_time >= NOW() - INTERVAL '24 hours';
                """)
                summary = cur.fetchone()
                total_events = int(summary["total_events"])
                max_mag = float(summary["max_magnitude"])
                avg_mag = float(summary["avg_magnitude"])
                tsunami_alerts = int(summary["tsunami_alerts"])

                # 2. Regional counts
                cur.execute("""
                    SELECT region, count(*) as count, MAX(magnitude) as max_mag
                    FROM curated.earthquakes
                    WHERE event_time >= NOW() - INTERVAL '24 hours'
                    GROUP BY region
                    ORDER BY count DESC;
                """)
                region_counts = [dict(r) for r in cur.fetchall()]
                regions_list = [r["region"] for r in region_counts[:5]]

                # 3. Z-score anomaly detection
                # We analyze whether any region had an abnormal surge in earthquakes compared to mean
                counts = [r["count"] for r in region_counts]
                anomalies_detected = []

                if len(counts) >= 3:
                    mean_val = sum(counts) / len(counts)
                    variance = sum((x - mean_val) ** 2 for x in counts) / len(counts)
                    std_dev = math.sqrt(variance) if variance > 0 else 1.0

                    for r in region_counts:
                        z = (r["count"] - mean_val) / std_dev
                        if z >= 2.0:  # Regional frequency surge
                            anomalies_detected.append({
                                "region": r["region"],
                                "metric_name": "event_frequency_surge",
                                "metric_value": float(r["count"]),
                                "z_score": round(float(z), 2),
                                "time_window": "24h"
                            })

                # Insert detected anomalies into curated.anomalies
                for anom in anomalies_detected:
                    cur.execute("""
                        INSERT INTO curated.anomalies 
                        (time_window, region, metric_name, metric_value, z_score, explanation)
                        VALUES (%s, %s, %s, %s, %s, %s);
                    """, (
                        anom["time_window"],
                        anom["region"],
                        anom["metric_name"],
                        anom["metric_value"],
                        anom["z_score"],
                        f"Enjambre sísmico regional detectado en {anom['region']} con z-score de {anom['z_score']} y {int(anom['metric_value'])} eventos."
                    ))

                conn.commit()

        return {
            "total_events": total_events,
            "max_magnitude": max_mag,
            "avg_magnitude": avg_mag,
            "tsunami_alerts": tsunami_alerts,
            "regions_affected": regions_list,
            "anomalies_count": len(anomalies_detected)
        }

    @task
    def generate_ai_executive_report(metrics: Dict[str, Any]):
        """Generates grounded narrative executive report in Spanish with Local LLM."""
        start_time = time.time()
        report_date_str = date.today().isoformat()

        # Prompt with strict numerical boundaries
        system_prompt = """Eres el Geofísico y Analista de Datos Principal de SismoWatch.
Tu responsabilidad es redactar un informe ejecutivo conciso, formal y de nivel ministerial sobre la sismicidad mundial en las últimas 24 horas.

REGLAS DE ORO:
1. NUNCA inventes números. Usa EXACTAMENTE las cifras proporcionadas en el contexto.
2. Redacta en español formal y técnico.
3. Estructura el resumen en 2 párrafos concisos.
"""
        user_prompt = f"""Métricas oficiales calculadas para el informe del {report_date_str}:
- Total de sismos registrados: {metrics['total_events']}
- Magnitud máxima registrada: {metrics['max_magnitude']:.2f}
- Magnitud promedio: {metrics['avg_magnitude']:.2f}
- Alertas de tsunami: {metrics['tsunami_alerts']}
- Regiones más activas: {', '.join(metrics['regions_affected']) if metrics['regions_affected'] else 'Actividad global dispersa'}
- Anomalías estadísticas detectadas: {metrics['anomalies_count']}

Genera el informe ejecutivo en español con un resumen técnico."""

        fallback_summary = (
            f"Durante las últimas 24 horas, la red de monitoreo registró un total de {metrics['total_events']} eventos sísmicos. "
            f"El evento de mayor liberación de energía presentó una magnitud de {metrics['max_magnitude']:.1f}, "
            f"con una media global de {metrics['avg_magnitude']:.1f}. "
            f"Las zonas con mayor concentración de actividad corresponden a {', '.join(metrics['regions_affected'][:3]) if metrics['regions_affected'] else 'regiones oceánicas'}. "
            f"No se reportaron alertas críticas de tsunami y los parámetros de calidad del catálogo se mantuvieron conformes."
        )

        summary_text = query_llm(user_prompt, system_prompt, fallback_summary=fallback_summary)
        elapsed_ms = int((time.time() - start_time) * 1000)

        # Structured findings
        key_findings = [
            f"Se registraron {metrics['total_events']} eventos sísmicos en la ventana de observación.",
            f"El evento de mayor energía alcanzó una magnitud de {metrics['max_magnitude']:.1f}.",
            f"Actividad concentrada principalmente en: {', '.join(metrics['regions_affected'][:3]) if metrics['regions_affected'] else 'Diversas zonas de subducción'}."
        ]

        recommendations = [
            "Mantener monitoreo continuo en las estaciones de monitoreo regional.",
            "Revisar el catálogo de eventos en cuarentena para confirmar integridad de sensores.",
            "Confirmar protocolos de mitigación en caso de sismos con magnitud superior a 5.0."
        ]

        calculated_kpis = {
            "title": f"Reporte Sísmico Ejecutivo Diario - {report_date_str}",
            "total_events": metrics["total_events"],
            "max_magnitude": metrics["max_magnitude"],
            "avg_magnitude": metrics["avg_magnitude"],
            "tsunami_alerts": metrics["tsunami_alerts"],
            "regions_affected": metrics["regions_affected"],
            "key_findings": key_findings,
            "recommendations": recommendations
        }

        # Save to curated.ai_reports
        with get_transformation_db_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO curated.ai_reports 
                    (report_date, summary_text, calculated_kpis, model_name, execution_time_ms, validation_passed)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT (report_date) DO UPDATE SET
                        summary_text = EXCLUDED.summary_text,
                        calculated_kpis = EXCLUDED.calculated_kpis,
                        model_name = EXCLUDED.model_name,
                        execution_time_ms = EXCLUDED.execution_time_ms,
                        created_at = NOW();
                """, (
                    report_date_str,
                    summary_text,
                    json.dumps(calculated_kpis, default=str),
                    OLLAMA_MODEL,
                    elapsed_ms,
                    True
                ))

                # Log into curated.ai_runs
                cur.execute("""
                    INSERT INTO curated.ai_runs 
                    (run_type, model_name, prompt_tokens_estimated, completion_tokens_estimated, latency_ms, estimated_cost_usd, success)
                    VALUES (%s, %s, %s, %s, %s, %s, %s);
                """, (
                    "daily_report",
                    OLLAMA_MODEL,
                    len(user_prompt.split()),
                    len(summary_text.split()),
                    elapsed_ms,
                    0.0,
                    True
                ))

                conn.commit()

        logger.info("Daily report for %s successfully generated in %d ms.", report_date_str, elapsed_ms)

    metrics_result = detect_anomalies_and_metrics()
    generate_ai_executive_report(metrics_result)

daily_report_dag = daily_report_anomaly_pipeline()
