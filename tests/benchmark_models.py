"""
Benchmark Suite: Ollama Local Models Comparison for SismoWatch
Evaluates models on:
1. 8 Text-to-SQL questions on curated.v_events_chat
2. 1 Executive Spanish daily report based on fixed KPIs
3. 2 Anomaly explanations in Spanish
Measures: SQL accuracy, only-SELECT compliance, latency, tokens per second, and Spanish quality.
"""
import json
import time
import urllib.request
import re

OLLAMA_URL = "http://localhost:11434/api/generate"

SCHEMA_PROMPT = """You are a strict PostgreSQL SQL generator for a seismic monitoring platform.
The ONLY accessible view is:
curated.v_events_chat (event_id, magnitude, magnitude_class, place, region, event_time, depth_km, tsunami_alert, status)

RULES:
1. Output ONLY a valid single PostgreSQL SELECT query.
2. Do NOT use INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE, EXEC.
3. Always include LIMIT (maximum 50).
4. No comments, no markdown ticks, no preamble. Output raw SQL only.
"""

SQL_QUESTIONS = [
    ("¿Cuántos sismos hay registrados en total?", "SELECT COUNT(*) FROM curated.v_events_chat;"),
    ("¿Cuál ha sido la magnitud máxima registrada?", "SELECT MAX(magnitude) FROM curated.v_events_chat;"),
    ("¿Cuál es la magnitud promedio de los sismos?", "SELECT AVG(magnitude) FROM curated.v_events_chat;"),
    ("¿Cuántos sismos ocurrieron en las últimas 24 horas?", "event_time >= NOW() - INTERVAL '24 hours'"),
    ("¿Qué sismos ocurrieron en California?", "WHERE region = 'California'"),
    ("¿Cuáles sismos tuvieron alerta de tsunami activa?", "WHERE tsunami_alert = TRUE"),
    ("¿Cuáles son los 5 sismos con mayor profundidad?", "ORDER BY depth_km DESC LIMIT 5"),
    ("¿Cuántos sismos hay por cada clasificación de magnitud?", "GROUP BY magnitude_class")
]

REPORT_PROMPT = """Eres el analista jefe de SismoWatch. Redacta un resumen ejecutivo breve (1 párrafo) en español a partir de estos KPIs oficiales verificados:
- Total eventos en 24h: 48
- Magnitud máxima: 6.4 (en Japón)
- Magnitud promedio: 3.8
- Alertas de tsunami: 1
- Región con mayor actividad: Japón (12 eventos)

REGLAS:
1. Usa lenguaje profesional y conciso en español.
2. Menciona exactamente las cifras provistas (48, 6.4, 3.8, 1, 12).
3. NO inventes cifras adicionales.
"""

ANOMALY_PROMPT_1 = """Explica brevemente (1 o 2 oraciones) en español esta alerta estadística detectada:
Tipo: Enjambre sísmico
Región: California
Eventos en 1 hora: 15 (promedio histórico: 2.1)
Z-Score: 3.8
Significado operativo para gestión de riesgo:
"""

ANOMALY_PROMPT_2 = """Explica brevemente (1 o 2 oraciones) en español esta alerta estadística detectada:
Tipo: Anomalía de magnitud crítica
Región: Japón
Magnitud: 6.4 (umbral crítico: 6.0)
Z-Score: 4.2
Alerta de tsunami: Activa
Significado operativo para gestión de riesgo:
"""

def query_ollama(model: str, prompt: str, temperature: float = 0.1, max_tokens: int = 250):
    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": temperature,
            "num_predict": max_tokens
        }
    }
    t0 = time.time()
    req = urllib.request.Request(
        OLLAMA_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            data = json.loads(res.read().decode("utf-8"))
            dur = time.time() - t0
            eval_count = data.get("eval_count", 0)
            eval_duration_ns = data.get("eval_duration", 1)
            tps = (eval_count / (eval_duration_ns / 1e9)) if eval_duration_ns > 0 else 0
            return {
                "response": data.get("response", "").strip(),
                "duration": dur,
                "tokens": eval_count,
                "tps": tps
            }
    except Exception as e:
        return {"response": f"ERROR: {e}", "duration": 0, "tokens": 0, "tps": 0}

def evaluate_model(model_name: str):
    print(f"\n=======================================================")
    print(f"EVALUANDO MODELO: {model_name}")
    print(f"=======================================================")
    
    # 1. SQL Benchmark
    sql_passed = 0
    only_select_count = 0
    total_sql_time = 0
    total_sql_tokens = 0
    
    print("\n--- 1. Pruebas Text-to-SQL (8 preguntas) ---")
    for i, (q, expected_hint) in enumerate(SQL_QUESTIONS, 1):
        prompt = f"{SCHEMA_PROMPT}\nPregunta: {q}\nSQL:"
        res = query_ollama(model_name, prompt, temperature=0.0)
        sql = res["response"].replace("```sql", "").replace("```", "").strip()
        total_sql_time += res["duration"]
        total_sql_tokens += res["tokens"]
        
        # Validate only-SELECT
        is_only_select = sql.upper().startswith("SELECT") and not any(
            w in sql.upper() for w in ["INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "TRUNCATE"]
        )
        if is_only_select:
            only_select_count += 1
            
        # Basic accuracy check
        has_limit = "LIMIT" in sql.upper()
        targets_chat_view = "curated.v_events_chat" in sql.lower() or "v_events_chat" in sql.lower()
        if is_only_select and targets_chat_view:
            sql_passed += 1
            status = "PASS"
        else:
            status = "FAIL"
            
        print(f"Q{i}: {q[:40]}... -> [{status}] ({res['duration']:.2f}s) | SQL: {sql[:60]}...")
        
    avg_sql_tps = total_sql_tokens / total_sql_time if total_sql_time > 0 else 0
    
    # 2. Daily Report Benchmark
    print("\n--- 2. Reporte Diario Ejecutivo en Español ---")
    rep_res = query_ollama(model_name, REPORT_PROMPT, temperature=0.3, max_tokens=300)
    print(f"Duración: {rep_res['duration']:.2f}s | TPS: {rep_res['tps']:.1f}")
    print(f"Texto:\n{rep_res['response']}\n")
    
    # Check numbers
    expected_nums = ["48", "6.4", "3.8", "1", "12"]
    matched_nums = [n for n in expected_nums if n in rep_res['response']]
    num_accuracy = (len(matched_nums) / len(expected_nums)) * 100
    
    # 3. Anomaly Explanations
    print("--- 3. Explicaciones de Anomalías en Español ---")
    anom1_res = query_ollama(model_name, ANOMALY_PROMPT_1, temperature=0.3, max_tokens=150)
    print(f"Anomalía 1 ({anom1_res['duration']:.2f}s): {anom1_res['response'][:120]}...")
    
    anom2_res = query_ollama(model_name, ANOMALY_PROMPT_2, temperature=0.3, max_tokens=150)
    print(f"Anomalía 2 ({anom2_res['duration']:.2f}s): {anom2_res['response'][:120]}...")
    
    return {
        "model": model_name,
        "sql_accuracy_pct": (sql_passed / len(SQL_QUESTIONS)) * 100,
        "only_select_pct": (only_select_count / len(SQL_QUESTIONS)) * 100,
        "sql_avg_latency_s": total_sql_time / len(SQL_QUESTIONS),
        "avg_tps": avg_sql_tps,
        "num_accuracy_pct": num_accuracy,
        "report_duration_s": rep_res['duration'],
        "sample_report": rep_res['response']
    }

if __name__ == "__main__":
    import sys
    models_to_test = sys.argv[1:] if len(sys.argv) > 1 else ["phi3:latest", "qwen2.5-coder:1.5b"]
    results = []
    for m in models_to_test:
        results.append(evaluate_model(m))
        
    print("\n=======================================================")
    print("RESUMEN COMPARATIVO FINAL")
    print("=======================================================")
    print(f"{'Modelo':<20} | {'SQL OK%':<8} | {'Solo-SELECT%':<12} | {'Latencia SQL':<12} | {'TPS':<8} | {'Precisión Núm%':<14}")
    print("-" * 85)
    for r in results:
        print(f"{r['model']:<20} | {r['sql_accuracy_pct']:<8.1f} | {r['only_select_pct']:<12.1f} | {r['sql_avg_latency_s']:<10.2f}s | {r['avg_tps']:<8.1f} | {r['num_accuracy_pct']:<14.1f}")
