"""
ETL task API endpoints.
"""
from typing import List
from datetime import datetime
import os

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.api.deps import get_current_user
from app.models.user import User
from app.models.datasource import DataSource, DataSourceType
from app.models.etl_task import EtlTask, EtlLog, EtlStatus, EtlLogStatus
from app.models.sync_task import SyncTask
from app.models.task_dependency import TaskDependency
from app.schemas.etl_task import (
    EtlTaskCreate,
    EtlTaskUpdate,
    EtlTaskResponse,
    EtlLogResponse,
    EtlTaskEnableRequest,
    EtlTaskListItem,
)
from app.services.db_connector import DatabaseConnector
from app.core.config import settings
from app.core.security import decrypt_password
from app.models.system_config import SystemConfig
from app.services.airflow_service import airflow_service, AirflowAPIError

router = APIRouter()


async def check_downstream_dependencies(db: AsyncSession, task_type: str, task_id: int) -> list:
    """检查是否有下游任务依赖此任务。返回下游任务列表。"""
    result = await db.execute(
        select(TaskDependency).where(
            TaskDependency.upstream_task_type == task_type,
            TaskDependency.upstream_task_id == task_id,
        )
    )
    dependencies = result.scalars().all()

    downstream_tasks = []
    for dep in dependencies:
        if dep.task_type == "sync":
            task_result = await db.execute(
                select(SyncTask).where(SyncTask.id == dep.task_id)
            )
            task = task_result.scalar_one_or_none()
            if task:
                downstream_tasks.append({"type": "sync", "id": task.id, "name": task.name})
        elif dep.task_type == "etl":
            task_result = await db.execute(
                select(EtlTask).where(EtlTask.id == dep.task_id)
            )
            task = task_result.scalar_one_or_none()
            if task:
                downstream_tasks.append({"type": "etl", "id": task.id, "name": task.name})

    return downstream_tasks


async def check_online_downstream_dependencies(db: AsyncSession, task_type: str, task_id: int) -> list:
    """检查是否有已上线的下游任务依赖此任务。返回已上线的下游任务列表。"""
    from app.models.sync_schedule import SyncSchedule

    result = await db.execute(
        select(TaskDependency).where(
            TaskDependency.upstream_task_type == task_type,
            TaskDependency.upstream_task_id == task_id,
        )
    )
    dependencies = result.scalars().all()

    online_downstream = []
    for dep in dependencies:
        if dep.task_type == "sync":
            # 检查同步任务的调度是否已上线
            sched_result = await db.execute(
                select(SyncSchedule, SyncTask)
                .join(SyncTask, SyncSchedule.sync_task_id == SyncTask.id)
                .where(SyncSchedule.sync_task_id == dep.task_id, SyncSchedule.is_enabled == True)
            )
            row = sched_result.first()
            if row:
                schedule, task = row
                online_downstream.append({"type": "sync", "id": task.id, "name": task.name})
        elif dep.task_type == "etl":
            # 检查ETL任务是否已上线
            etl_result = await db.execute(
                select(EtlTask).where(EtlTask.id == dep.task_id, EtlTask.is_scheduled == True)
            )
            etl = etl_result.scalar_one_or_none()
            if etl:
                online_downstream.append({"type": "etl", "id": etl.id, "name": etl.name})

    return online_downstream


async def get_warehouse_engine(db: AsyncSession):
    """Get SQLAlchemy engine for the system warehouse config."""
    result = await db.execute(
        select(SystemConfig).where(SystemConfig.config_key == "warehouse_config")
    )
    config = result.scalar_one_or_none()

    if not config or not config.config_value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="平台数据库未配置，请先在系统管理中配置目标平台数据库"
        )

    import json
    try:
        data = json.loads(config.config_value)
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="平台数据库配置格式错误"
        )

    password = decrypt_password(data.get("encrypted_password", ""))
    if not password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="平台数据库密码未配置"
        )

    # Convert string type to DataSourceType enum
    db_type_str = data.get("type", "").lower()
    try:
        db_type = DataSourceType(db_type_str)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"不支持的数据库类型: {db_type_str}"
        )

    return DatabaseConnector.get_engine(
        datasource_id=-1,
        db_type=db_type,
        host=data.get("host"),
        port=int(data.get("port", 0)),
        database=data.get("database"),
        username=data.get("username"),
        encrypted_password=data.get("encrypted_password"),
        schema_name=data.get("schema_name"),
        pool_size=5,
        max_overflow=10,
    )


async def get_datasource_engine(db: AsyncSession, datasource_id: int):
    """Get SQLAlchemy engine for a datasource."""
    result = await db.execute(select(DataSource).where(DataSource.id == datasource_id))
    ds = result.scalar_one_or_none()
    if not ds:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Datasource {datasource_id} not found")

    return DatabaseConnector.get_engine(
        datasource_id=ds.id,
        db_type=ds.type,
        host=ds.host,
        port=ds.port,
        database=ds.database,
        username=ds.username,
        encrypted_password=ds.encrypted_password,
        schema_name=ds.schema_name,
        service_name=ds.service_name,
        pool_size=ds.pool_size,
        max_overflow=ds.max_overflow,
    )


@router.post("/", response_model=EtlTaskResponse, status_code=status.HTTP_201_CREATED)
async def create_etl_task(
    task_data: EtlTaskCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new ETL task from SQL script."""
    etl_task = EtlTask(
        name=task_data.name,
        description=task_data.description,
        sql_content=task_data.sql_content,
        datasource_id=task_data.datasource_id,
        status=EtlStatus.DRAFT,
        is_scheduled=False,
        created_by=current_user.id,
    )
    db.add(etl_task)
    await db.flush()
    await db.refresh(etl_task)
    return etl_task


@router.get("/", response_model=List[EtlTaskListItem])
async def list_etl_tasks(
    status_filter: EtlStatus = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all ETL tasks with datasource names."""
    from app.models.dw_layer import DwLayer
    from sqlalchemy import func

    query = select(
        EtlTask,
        DataSource.name.label("datasource_name"),
        DwLayer.name.label("layer_name"),
        DwLayer.color.label("layer_color"),
    ).outerjoin(
        DataSource, EtlTask.datasource_id == DataSource.id
    ).outerjoin(
        DwLayer, EtlTask.dw_layer_id == DwLayer.id
    )

    if status_filter:
        query = query.where(EtlTask.status == status_filter)

    query = query.order_by(EtlTask.created_at.desc())
    result = await db.execute(query)
    rows = result.all()

    # 获取所有ETL任务的依赖数量
    task_ids = [row[0].id for row in rows]
    dep_counts = {}
    if task_ids:
        dep_query = select(
            TaskDependency.task_id,
            func.count(TaskDependency.id).label("count")
        ).where(
            TaskDependency.task_type == "etl",
            TaskDependency.task_id.in_(task_ids)
        ).group_by(TaskDependency.task_id)
        dep_result = await db.execute(dep_query)
        for task_id, count in dep_result.all():
            dep_counts[task_id] = count

    tasks = []
    for task, ds_name, layer_name, layer_color in rows:
        # Create SQL preview (first 100 chars)
        sql_preview = task.sql_content[:100] + "..." if len(task.sql_content) > 100 else task.sql_content
        sql_preview = sql_preview.replace("\n", " ").strip()

        tasks.append(EtlTaskListItem(
            id=task.id,
            name=task.name,
            description=task.description,
            sql_preview=sql_preview,
            datasource_id=task.datasource_id,
            datasource_name=ds_name or "系统平台数据库",
            dw_layer_id=task.dw_layer_id,
            dw_layer_name=layer_name,
            dw_layer_color=layer_color,
            is_scheduled=task.is_scheduled,
            cron_expression=task.cron_expression,
            dag_id=task.dag_id,
            airflow_status=task.airflow_status,
            status=task.status,
            last_run_at=task.last_run_at,
            last_run_rows=task.last_run_rows,
            dependency_count=dep_counts.get(task.id, 0),
            created_at=task.created_at,
        ))

    return tasks


@router.get("/{task_id}", response_model=EtlTaskResponse)
async def get_etl_task(
    task_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get ETL task by ID."""
    result = await db.execute(select(EtlTask).where(EtlTask.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ETL task not found")
    return task


@router.put("/{task_id}", response_model=EtlTaskResponse)
async def update_etl_task(
    task_id: int,
    task_data: EtlTaskUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update an ETL task."""
    print(f"[ETL UPDATE] task_id={task_id}, task_data={task_data}")

    result = await db.execute(select(EtlTask).where(EtlTask.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ETL task not found")

    update_data = task_data.model_dump(exclude_unset=True)
    print(f"[ETL UPDATE] update_data={update_data}")

    for field, value in update_data.items():
        setattr(task, field, value)

    await db.commit()
    await db.refresh(task)
    print(f"[ETL UPDATE] saved, sql_content[:50]={task.sql_content[:50] if task.sql_content else None}")
    return task


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_etl_task(
    task_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete an ETL task and its logs."""
    result = await db.execute(
        select(EtlTask)
        .options(selectinload(EtlTask.logs))
        .where(EtlTask.id == task_id)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ETL task not found")

    # 检查是否有调度引用（后端保护层）
    # dag_id 存在表示有调度记录，无论是否已上线都不能删除
    if task.dag_id or task.cron_expression:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="请删除引用"
        )

    # 检查是否有下游任务依赖此任务
    downstream_tasks = await check_downstream_dependencies(db, "etl", task_id)
    if downstream_tasks:
        task_names = ", ".join([f"{t['type']}:{t['name']}" for t in downstream_tasks])
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"无法删除：以下任务依赖此任务：{task_names}，请先删除依赖关系"
        )

    # Delete DAG file if exists
    if task.dag_id:
        dag_path = os.path.join(settings.AIRFLOW_DAGS_PATH or '/opt/airflow/dags/generated', f'{task.dag_id}.py')
        if os.path.exists(dag_path):
            try:
                os.remove(dag_path)
            except Exception as e:
                print(f"Warning: Failed to delete DAG file {dag_path}: {e}")

    # 删除此任务作为下游的依赖关系
    from sqlalchemy import delete
    await db.execute(
        delete(TaskDependency).where(
            TaskDependency.task_type == "etl",
            TaskDependency.task_id == task_id
        )
    )

    await db.delete(task)
    await db.flush()


@router.post("/{task_id}/execute", response_model=EtlLogResponse)
async def execute_etl_task(
    task_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Execute an ETL task immediately."""
    result = await db.execute(select(EtlTask).where(EtlTask.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ETL task not found")

    # Create log entry
    log = EtlLog(
        etl_task_id=task.id,
        status=EtlLogStatus.RUNNING,
        started_at=datetime.utcnow(),
    )
    db.add(log)
    await db.flush()
    await db.refresh(log)

    # Get engine
    try:
        if task.datasource_id:
            engine = await get_datasource_engine(db, task.datasource_id)
        else:
            engine = await get_warehouse_engine(db)
    except HTTPException:
        raise
    except Exception as e:
        log.status = EtlLogStatus.FAILED
        log.error_message = f"Failed to get database engine: {str(e)}"
        log.finished_at = datetime.utcnow()
        await db.flush()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

    # Execute SQL
    start_time = datetime.utcnow()
    try:
        from sqlalchemy import text
        with engine.connect() as conn:
            # Split by semicolons for multiple statements
            statements = [s.strip() for s in task.sql_content.split(';') if s.strip()]
            total_rows = 0

            for stmt in statements:
                result_proxy = conn.execute(text(stmt))
                if result_proxy.rowcount >= 0:
                    total_rows += result_proxy.rowcount

            conn.commit()

        end_time = datetime.utcnow()
        execution_time_ms = int((end_time - start_time).total_seconds() * 1000)

        # Update log
        log.status = EtlLogStatus.SUCCESS
        log.rows_affected = total_rows
        log.execution_time_ms = execution_time_ms
        log.finished_at = end_time

        # Update task
        task.status = EtlStatus.ACTIVE
        task.last_run_at = end_time
        task.last_run_rows = total_rows
        task.last_error = None

        await db.flush()
        await db.refresh(log)
        return log

    except Exception as e:
        end_time = datetime.utcnow()
        execution_time_ms = int((end_time - start_time).total_seconds() * 1000)

        log.status = EtlLogStatus.FAILED
        log.error_message = str(e)
        log.execution_time_ms = execution_time_ms
        log.finished_at = end_time

        task.last_error = str(e)

        await db.flush()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get("/{task_id}/logs", response_model=List[EtlLogResponse])
async def get_etl_logs(
    task_id: int,
    limit: int = 50,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get execution logs for an ETL task."""
    result = await db.execute(
        select(EtlLog)
        .where(EtlLog.etl_task_id == task_id)
        .order_by(EtlLog.started_at.desc())
        .limit(limit)
    )
    return list(result.scalars().all())


@router.post("/{task_id}/schedule", response_model=dict)
async def schedule_etl_task(
    task_id: int,
    request: EtlTaskEnableRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Save schedule for ETL task (without enabling in Airflow)."""
    result = await db.execute(select(EtlTask).where(EtlTask.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ETL task not found")

    # 检查是否已上线（is_scheduled=True 表示已上线）
    if task.is_scheduled:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="任务已上线，请先下线")

    # Only save cron expression and generate DAG ID (no Airflow interaction)
    task.cron_expression = request.cron_expression
    dag_id = f"etl_{task.id}_{task.name.replace(' ', '_')[:20]}"
    task.dag_id = dag_id
    task.is_scheduled = False  # Not enabled yet
    task.airflow_status = "pending"

    await db.flush()

    return {
        "success": True,
        "task_id": task_id,
        "dag_id": dag_id,
        "message": "Schedule saved. Use enable to activate in Airflow."
    }


@router.post("/{task_id}/enable", response_model=dict)
async def enable_etl_task(
    task_id: int,
    request: EtlTaskEnableRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Enable/schedule an ETL task - generate DAG and activate."""
    from app.models.sync_schedule import SyncSchedule

    result = await db.execute(select(EtlTask).where(EtlTask.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ETL task not found")

    if task.is_scheduled:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Task is already scheduled")

    # Check Airflow connectivity first (fail fast)
    try:
        await airflow_service.check_connectivity()
    except AirflowAPIError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Airflow服务不可用: {e.message}"
        )

    # Update task with cron expression (if provided, otherwise use existing)
    if request.cron_expression:
        task.cron_expression = request.cron_expression
    elif not task.cron_expression:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cron expression is required")

    task.is_scheduled = True

    # Use existing DAG ID or generate new one
    if not task.dag_id:
        dag_id = f"etl_{task.id}_{task.name.replace(' ', '_')[:20]}"
        task.dag_id = dag_id
    else:
        dag_id = task.dag_id

    # Get warehouse config for DAG
    wh_result = await db.execute(
        select(SystemConfig).where(SystemConfig.config_key == "warehouse_config")
    )
    wh_config = wh_result.scalar_one_or_none()
    if not wh_config or not wh_config.config_value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="平台数据库未配置，请先在系统管理中配置目标平台数据库"
        )

    import json
    wh_data = json.loads(wh_config.config_value)

    # Query dependencies for this ETL task
    dep_result = await db.execute(
        select(TaskDependency).where(
            TaskDependency.task_type == "etl",
            TaskDependency.task_id == task_id,
        )
    )
    dependencies = dep_result.scalars().all()

    # Get DAG IDs for upstream tasks and check if they are scheduled
    upstream_dag_ids = []
    unscheduled_deps = []  # 未上线的依赖
    for dep in dependencies:
        if dep.upstream_task_type == "sync":
            # Find the sync task and its schedule
            up_task_result = await db.execute(
                select(SyncTask).where(SyncTask.id == dep.upstream_task_id)
            )
            up_task = up_task_result.scalar_one_or_none()
            up_sched_result = await db.execute(
                select(SyncSchedule).where(SyncSchedule.sync_task_id == dep.upstream_task_id)
            )
            up_schedule = up_sched_result.scalar_one_or_none()
            if up_schedule and up_schedule.dag_id and up_schedule.is_enabled:
                upstream_dag_ids.append(up_schedule.dag_id)
            else:
                task_name = up_task.name if up_task else f"sync:{dep.upstream_task_id}"
                unscheduled_deps.append(f"同步任务「{task_name}」")
        elif dep.upstream_task_type == "etl":
            # ETL tasks have their own dag_id
            up_etl_result = await db.execute(
                select(EtlTask).where(EtlTask.id == dep.upstream_task_id)
            )
            up_etl = up_etl_result.scalar_one_or_none()
            if up_etl and up_etl.dag_id and up_etl.is_scheduled:
                upstream_dag_ids.append(up_etl.dag_id)
            else:
                task_name = up_etl.name if up_etl else f"etl:{dep.upstream_task_id}"
                unscheduled_deps.append(f"ETL任务「{task_name}」")

    # 如果有未上线的依赖，阻止上线
    if unscheduled_deps:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"以下依赖任务尚未上线调度，请先上线它们：{', '.join(unscheduled_deps)}"
        )

    # Build extra imports and sensors for dependencies
    extra_imports = ""
    sensor_code = ""
    sensor_chain = ""
    if upstream_dag_ids:
        extra_imports = "from airflow.sensors.external_task import ExternalTaskSensor"
        sensor_tasks = []
        for i, upstream_dag_id in enumerate(upstream_dag_ids):
            sensor_name = f"wait_for_{upstream_dag_id.replace('-', '_').replace('.', '_')}"
            sensor_code += f'''
    {sensor_name} = ExternalTaskSensor(
        task_id="{sensor_name}",
        external_dag_id="{upstream_dag_id}",
        mode="reschedule",
        timeout=3600,
        poke_interval=60,
    )
'''
            sensor_tasks.append(sensor_name)
        # Build dependency chain: sensors >> etl_task
        if sensor_tasks:
            sensor_chain = f"\n    [{', '.join(sensor_tasks)}] >> etl_task"

    # Escape SQL content for Python string
    escaped_sql = task.sql_content.replace('\\', '\\\\').replace("'''", "\\'\\'\\'").replace('"""', '\\"\\"\\"')

    # Generate DAG content - execute SQL directly
    dag_content = f'''"""
Auto-generated Airflow DAG for ETL task: {task.name}
Description: {task.description or 'N/A'}
Task ID: {task.id}
Dependencies: {len(upstream_dag_ids)} upstream DAGs
"""
from datetime import datetime, timedelta
from airflow import DAG
from airflow.operators.python import PythonOperator
{extra_imports}

default_args = {{
    'owner': 'data_platform',
    'depends_on_past': False,
    'email_on_failure': True,
    'retries': 1,
    'retry_delay': timedelta(minutes=5),
}}

# Database configuration
DB_CONFIG = {{
    'type': '{wh_data.get("type", "")}',
    'host': '{wh_data.get("host", "")}',
    'port': {wh_data.get("port", 5432)},
    'database': '{wh_data.get("database", "")}',
    'username': '{wh_data.get("username", "")}',
    'encrypted_password': '{wh_data.get("encrypted_password", "")}',
    'schema_name': '{wh_data.get("schema_name", "") or ""}',
}}

SQL_CONTENT = """
{escaped_sql}
"""

def execute_etl():
    """Execute ETL SQL directly on the database."""
    from sqlalchemy import create_engine, text
    from cryptography.fernet import Fernet
    import os
    import urllib.parse

    # Decrypt password (must match backend's get_fernet_key logic)
    import hashlib
    import base64
    secret_key = os.environ.get('ENCRYPTION_KEY', 'your_32_byte_encryption_key_here')
    key_bytes = hashlib.sha256(secret_key.encode()).digest()
    fernet_key = base64.urlsafe_b64encode(key_bytes)
    fernet = Fernet(fernet_key)

    try:
        password = fernet.decrypt(DB_CONFIG['encrypted_password'].encode()).decode()
    except Exception:
        password = DB_CONFIG['encrypted_password']

    # Build connection URL
    db_type = DB_CONFIG['type'].lower()
    encoded_user = urllib.parse.quote_plus(DB_CONFIG['username'])
    encoded_pass = urllib.parse.quote_plus(password)
    host = DB_CONFIG['host']
    port = DB_CONFIG['port']
    database = DB_CONFIG['database']
    schema = DB_CONFIG['schema_name']

    if db_type == 'mysql':
        url = f"mysql+pymysql://{{encoded_user}}:{{encoded_pass}}@{{host}}:{{port}}/{{database}}?charset=utf8mb4"
    elif db_type == 'postgresql':
        url = f"postgresql+psycopg2://{{encoded_user}}:{{encoded_pass}}@{{host}}:{{port}}/{{database}}"
        if schema:
            url += f"?options=-csearch_path={{schema}}"
    elif db_type == 'oracle':
        url = f"oracle+cx_oracle://{{encoded_user}}:{{encoded_pass}}@{{host}}:{{port}}/{{database}}"
    else:
        url = f"{{db_type}}://{{encoded_user}}:{{encoded_pass}}@{{host}}:{{port}}/{{database}}"

    engine = create_engine(url)

    # Execute SQL statements
    statements = [s.strip() for s in SQL_CONTENT.split(';') if s.strip()]
    total_rows = 0

    with engine.begin() as conn:
        for stmt in statements:
            result = conn.execute(text(stmt))
            if result.rowcount >= 0:
                total_rows += result.rowcount

    print(f"ETL executed successfully. Total affected rows: {{total_rows}}")
    return {{"status": "success", "rows_affected": total_rows}}

with DAG(
    dag_id='{dag_id}',
    default_args=default_args,
    description='{task.description or task.name}',
    schedule_interval='{request.cron_expression}',
    start_date=datetime(2024, 1, 1),
    catchup=False,
    is_paused_upon_creation=False,
    tags=['etl', 'auto_generated'],
) as dag:
{sensor_code}
    etl_task = PythonOperator(
        task_id='execute_etl',
        python_callable=execute_etl,
    )
{sensor_chain}
'''

    # Save DAG file to Airflow directory
    dag_path = os.path.join(settings.AIRFLOW_DAGS_PATH or '/opt/airflow/dags/generated', f'{dag_id}.py')
    try:
        os.makedirs(os.path.dirname(dag_path), exist_ok=True)
        with open(dag_path, 'w', encoding='utf-8') as f:
            f.write(dag_content)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"DAG文件保存失败: {str(e)}"
        )

    # Update task status
    task.status = EtlStatus.ACTIVE
    task.airflow_status = "active"
    await db.flush()

    # Try to unpause DAG in Airflow (best effort, don't fail if DAG not scanned yet)
    try:
        await airflow_service.enable_dag_simple(dag_id)
    except AirflowAPIError:
        # Airflow not reachable, but DAG file is saved, Airflow will pick it up later
        pass

    dep_msg = f"，包含{len(upstream_dag_ids)}个上游依赖" if upstream_dag_ids else ""
    return {
        "success": True,
        "task_id": task_id,
        "dag_id": dag_id,
        "message": f"ETL任务已上线，DAG文件已生成{dep_msg}"
    }


@router.post("/{task_id}/disable", response_model=dict)
async def disable_etl_task(
    task_id: int,
    force: bool = False,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Disable/unschedule an ETL task."""
    result = await db.execute(select(EtlTask).where(EtlTask.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ETL task not found")

    if not task.is_scheduled:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Task is not scheduled")

    # 检查是否有已上线的下游任务依赖此任务
    online_downstream = await check_online_downstream_dependencies(db, "etl", task_id)
    if online_downstream and not force:
        task_names = ", ".join([f"{t['name']}" for t in online_downstream])
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"警告：以下已上线的任务依赖此任务：{task_names}。下线后这些任务将无法获取最新数据。确定要下线吗？"
        )

    # Pause DAG in Airflow (best effort - DAG may not exist)
    if task.dag_id:
        await airflow_service.pause_dag(task.dag_id)

    # Only update local DB after Airflow confirms success
    task.is_scheduled = False
    task.airflow_status = "paused"
    task.status = EtlStatus.DISABLED

    await db.flush()

    return {
        "success": True,
        "task_id": task_id,
        "message": "ETL task disabled successfully."
    }


@router.post("/{task_id}/unschedule", response_model=dict)
async def unschedule_etl_task(
    task_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove ETL task from schedule (delete schedule but keep task)."""
    result = await db.execute(select(EtlTask).where(EtlTask.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ETL task not found")

    if task.is_scheduled:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="请先下线再删除调度")

    # Delete DAG from Airflow with confirmation if exists
    if task.dag_id:
        try:
            await airflow_service.delete_dag_with_confirmation(task.dag_id)
        except AirflowAPIError as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Airflow删除失败: {e.message}"
            )

        # Delete DAG file after Airflow confirms deletion
        dag_path = os.path.join(settings.AIRFLOW_DAGS_PATH or '/opt/airflow/dags/generated', f'{task.dag_id}.py')
        if os.path.exists(dag_path):
            try:
                os.remove(dag_path)
            except Exception as e:
                print(f"Warning: Failed to delete DAG file {dag_path}: {e}")

    # Only update local DB after Airflow confirms success
    task.dag_id = None
    task.cron_expression = None
    task.airflow_status = None
    task.status = EtlStatus.DRAFT

    await db.flush()

    return {
        "success": True,
        "task_id": task_id,
        "message": "ETL task removed from schedule."
    }
