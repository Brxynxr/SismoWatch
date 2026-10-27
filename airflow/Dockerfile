FROM apache/airflow:2.10.0-python3.11

USER airflow
COPY requirements.txt /requirements.txt
RUN pip install --no-cache-dir -r /requirements.txt --constraint "https://raw.githubusercontent.com/apache/airflow/constraints-2.10.0/constraints-3.11.txt"
