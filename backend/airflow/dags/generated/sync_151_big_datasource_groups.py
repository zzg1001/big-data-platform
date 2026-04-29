"""
Auto-generated Airflow DAG for sync task: Sync_ods_mysql_ai_agent_big_datasource_groups
Source: 8.153.198.194.big_datasource_groups
Target: 数据仓库.ods_mysql_ai_agent_big_datasource_groups
"""
from datetime import datetime, timedelta
from airflow import DAG
from airflow.operators.python import PythonOperator
import requests

default_args = {
    'owner': 'data_platform',
    'depends_on_past': False,
    'email_on_failure': True,
    'retries': 1,
    'retry_delay': timedelta(minutes=5),
}

def execute_sync():
    """Call the data platform API to execute sync."""
    import os
    api_url = os.environ.get('DATA_PLATFORM_API_URL', 'http://backend:8000')
    # Note: In production, implement proper authentication
    response = requests.post(
        f"{api_url}/api/v1/sync/151/execute",
        headers={"Authorization": "Bearer YOUR_API_TOKEN"},
        timeout=3600
    )
    response.raise_for_status()
    return response.json()

with DAG(
    dag_id='sync_151_big_datasource_groups',
    default_args=default_args,
    description='big_datasource_groups → ods_mysql_ai_agent_big_datasource_groups',
    schedule_interval='0 2 * * *',
    start_date=datetime(2024, 1, 1),
    catchup=False,
    tags=['data_sync', 'auto_generated'],
) as dag:

    sync_task = PythonOperator(
        task_id='execute_sync',
        python_callable=execute_sync,
    )
