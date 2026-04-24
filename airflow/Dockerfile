FROM apache/airflow:2.8.0-python3.11

USER root

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

USER airflow

# Install additional Python packages
RUN pip install --no-cache-dir \
    apache-airflow-providers-postgres \
    apache-airflow-providers-mysql \
    apache-airflow-providers-common-sql \
    apache-airflow-providers-http \
    pandas \
    sqlalchemy

# Create directories
RUN mkdir -p /opt/airflow/dags/generated
