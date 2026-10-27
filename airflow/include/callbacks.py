"""
Airflow Failure Callback: Alerting via Webhook
Dispatches structured failure alerts to an external webhook URL (Slack, Telegram, Httpbin, etc.).
"""
import os
import json
import logging
import urllib.request

logger = logging.getLogger("airflow.task")

def task_failure_alert(context: dict):
    """
    Callback triggered when an Airflow task fails.
    Reads FAILURE_ALERT_WEBHOOK_URL from environment and dispatches an alert payload.
    """
    webhook_url = os.getenv("FAILURE_ALERT_WEBHOOK_URL")
    if not webhook_url:
        logger.warning("No FAILURE_ALERT_WEBHOOK_URL configured. Skipping failure alert.")
        return

    task_instance = context.get("task_instance")
    dag_id = context.get("dag").dag_id if context.get("dag") else "unknown_dag"
    task_id = task_instance.task_id if task_instance else "unknown_task"
    execution_date = str(context.get("execution_date", "unknown_date"))
    exception = str(context.get("exception", "No exception info provided"))

    payload = {
        "event": "AIRFLOW_TASK_FAILURE",
        "severity": "CRITICAL",
        "dag_id": dag_id,
        "task_id": task_id,
        "execution_date": execution_date,
        "error_message": exception[:500],
        "log_url": task_instance.log_url if task_instance else "N/A"
    }

    if not webhook_url.startswith(("http://", "https://")):
        logger.warning("Invalid webhook URL scheme: %s", webhook_url)
        return

    try:
        import requests
        res = requests.post(webhook_url, json=payload, timeout=5)
        logger.info("Failure alert successfully dispatched to webhook: status %s", res.status_code)
    except Exception as e:
        logger.error("Failed to dispatch alert to webhook (%s): %s", webhook_url, e)
