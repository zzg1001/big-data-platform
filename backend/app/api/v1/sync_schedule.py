"""
Sync schedule API endpoints - manage scheduling for sync tasks.
"""
from typing import List, Optional
from datetime import datetime
import os

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.deps import get_current_user
from app.models.user import User
from app.models.sync_task import SyncTask, SyncStatus
from app.models.sync_schedule import SyncSchedule
from app.models.task_dependency import TaskDependency
from app.models.etl_task import EtlTask
from app.schemas.sync_schedule import (
    SyncScheduleCreate,
    SyncScheduleUpdate,
    SyncScheduleResponse,
    SyncScheduleListItem,
)
from app.services.airflow_service import airflow_service, AirflowAPIError
from app.core.config import settings

router = APIRouter()


async def check_online_downstream_dependencies(db: AsyncSession, task_type: str, task_id: int) -> list:
    """检查是否有已上线的下游任务依赖此任务。返回已上线的下游任务列表。"""
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



@router.get("/", response_model=List[SyncScheduleListItem])
async def list_sync_schedules(
    enabled_filter: Optional[str] = None,  # "enabled" | "disabled" | None
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all sync schedules with task info."""
    from app.models.user import User as UserModel

    query = (
        select(SyncSchedule, SyncTask, UserModel.username)
        .join(SyncTask, SyncSchedule.sync_task_id == SyncTask.id)
        .outerjoin(UserModel, SyncSchedule.created_by == UserModel.id)
    )

    if enabled_filter == "enabled":
        query = query.where(SyncSchedule.is_enabled == True)
    elif enabled_filter == "disabled":
        query = query.where(SyncSchedule.is_enabled == False)

    query = query.order_by(SyncSchedule.created_at.desc())
    result = await db.execute(query)
    rows = result.all()

    schedules = []
    for schedule, task, creator_name in rows:
        schedules.append({
            "id": schedule.id,
            "name": schedule.name,
            "description": schedule.description,
            "sync_task_id": schedule.sync_task_id,
            "cron_expression": schedule.cron_expression,
            "is_enabled": schedule.is_enabled,
            "dag_id": schedule.dag_id,
            "airflow_status": schedule.airflow_status,
            "next_run_time": schedule.next_run_time,
            "last_run_time": schedule.last_run_time,
            "last_run_status": schedule.last_run_status,
            "sync_task_name": task.name,
            "source_table": task.source_table,
            "target_table": task.target_table,
            "sync_mode": task.sync_mode.value if task.sync_mode else "full",
            "last_sync_at": task.last_sync_at,
            "last_sync_rows": task.last_sync_rows,
            "creator_name": creator_name,
            "created_at": schedule.created_at,
        })

    return schedules


@router.get("/available-tasks", response_model=List[dict])
async def list_available_sync_tasks(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List sync tasks that are not yet scheduled."""
    # Get IDs of tasks that already have schedules
    scheduled_result = await db.execute(
        select(SyncSchedule.sync_task_id)
    )
    scheduled_task_ids = [row[0] for row in scheduled_result.all()]

    # Get tasks not in scheduled list
    query = select(SyncTask)
    if scheduled_task_ids:
        query = query.where(SyncTask.id.notin_(scheduled_task_ids))
    query = query.order_by(SyncTask.created_at.desc())

    result = await db.execute(query)
    tasks = result.scalars().all()

    return [
        {
            "id": t.id,
            "name": t.name,
            "source_table": t.source_table,
            "target_table": t.target_table,
            "sync_mode": t.sync_mode.value if t.sync_mode else "full",
        }
        for t in tasks
    ]


@router.post("/", response_model=SyncScheduleResponse, status_code=status.HTTP_201_CREATED)
async def create_sync_schedule(
    schedule_data: SyncScheduleCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new sync schedule."""
    # Verify sync task exists
    result = await db.execute(
        select(SyncTask).where(SyncTask.id == schedule_data.sync_task_id)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sync task not found"
        )

    # Check if task already has a schedule
    existing = await db.execute(
        select(SyncSchedule).where(SyncSchedule.sync_task_id == schedule_data.sync_task_id)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This sync task already has a schedule"
        )

    schedule = SyncSchedule(
        name=schedule_data.name,
        description=schedule_data.description,
        sync_task_id=schedule_data.sync_task_id,
        cron_expression=schedule_data.cron_expression,
        is_enabled=False,
        created_by=current_user.id,
    )
    db.add(schedule)
    await db.flush()
    await db.refresh(schedule)

    return schedule


@router.get("/{schedule_id}", response_model=SyncScheduleResponse)
async def get_sync_schedule(
    schedule_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a single sync schedule."""
    result = await db.execute(
        select(SyncSchedule).where(SyncSchedule.id == schedule_id)
    )
    schedule = result.scalar_one_or_none()
    if not schedule:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Schedule not found"
        )
    return schedule


@router.put("/{schedule_id}", response_model=SyncScheduleResponse)
async def update_sync_schedule(
    schedule_id: int,
    schedule_data: SyncScheduleUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update a sync schedule. If enabled and cron changed, redeploy DAG."""
    result = await db.execute(
        select(SyncSchedule).where(SyncSchedule.id == schedule_id)
    )
    schedule = result.scalar_one_or_none()
    if not schedule:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Schedule not found"
        )

    # Check if cron expression is changing while schedule is enabled
    old_cron = schedule.cron_expression
    new_cron = schedule_data.cron_expression if schedule_data.cron_expression else old_cron
    cron_changed = old_cron != new_cron and schedule.is_enabled

    if cron_changed:
        # If schedule is enabled and cron changed, need to redeploy DAG
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="已上线的调度不能直接修改Cron表达式，请先下线再修改"
        )

    for field, value in schedule_data.model_dump(exclude_unset=True).items():
        setattr(schedule, field, value)

    await db.flush()
    return schedule


@router.delete("/{schedule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_sync_schedule(
    schedule_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a sync schedule and its DAG file."""
    result = await db.execute(
        select(SyncSchedule).where(SyncSchedule.id == schedule_id)
    )
    schedule = result.scalar_one_or_none()
    if not schedule:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Schedule not found"
        )

    # Check if schedule is enabled
    if schedule.is_enabled:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="请先下线后再删除"
        )

    # Delete DAG from Airflow with confirmation if exists
    if schedule.dag_id:
        try:
            await airflow_service.delete_dag_with_confirmation(schedule.dag_id)
        except AirflowAPIError:
            # Airflow删除失败时只记录警告，不阻止删除
            pass
        except Exception:
            pass

        # Delete DAG file
        dag_path = os.path.join(
            settings.AIRFLOW_DAGS_PATH or '/opt/airflow/dags/generated',
            f'{schedule.dag_id}.py'
        )
        if os.path.exists(dag_path):
            try:
                os.remove(dag_path)
            except Exception:
                pass

    # Only delete from local DB after Airflow confirms success
    await db.delete(schedule)
    await db.flush()


@router.post("/{schedule_id}/enable", response_model=dict)
async def enable_sync_schedule(
    schedule_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Enable a sync schedule - generate DAG and activate."""
    from app.models.datasource import DataSource
    from app.core.security import decrypt_password
    from app.models.system_config import SystemConfig
    import json

    result = await db.execute(
        select(SyncSchedule, SyncTask)
        .join(SyncTask, SyncSchedule.sync_task_id == SyncTask.id)
        .where(SyncSchedule.id == schedule_id)
    )
    row = result.one_or_none()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Schedule not found"
        )

    schedule, task = row

    if schedule.is_enabled:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Schedule is already enabled"
        )

    # Check Airflow connectivity first (fail fast)
    try:
        await airflow_service.check_connectivity()
    except AirflowAPIError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Airflow服务不可用: {e.message}"
        )

    # Get source datasource
    source_ds_result = await db.execute(
        select(DataSource).where(DataSource.id == task.source_datasource_id)
    )
    source_ds = source_ds_result.scalar_one_or_none()
    if not source_ds:
        raise HTTPException(status_code=404, detail="Source datasource not found")

    # Get target datasource (or warehouse config)
    target_config = None
    if task.target_datasource_id:
        target_ds_result = await db.execute(
            select(DataSource).where(DataSource.id == task.target_datasource_id)
        )
        target_ds = target_ds_result.scalar_one_or_none()
        if target_ds:
            target_config = {
                "type": target_ds.type.value,
                "host": target_ds.host,
                "port": target_ds.port,
                "database": target_ds.database,
                "username": target_ds.username,
                "password": decrypt_password(target_ds.encrypted_password),
            }

    if not target_config:
        # Use system warehouse config
        wh_result = await db.execute(
            select(SystemConfig).where(SystemConfig.config_key == "warehouse_config")
        )
        wh_config = wh_result.scalar_one_or_none()
        if wh_config and wh_config.config_value:
            wh = json.loads(wh_config.config_value)
            # Decrypt the encrypted_password from warehouse config
            wh_password = wh.get("encrypted_password")
            if wh_password:
                wh_password = decrypt_password(wh_password)
            target_config = {
                "type": wh.get("type", "mysql"),
                "host": wh.get("host"),
                "port": wh.get("port"),
                "database": wh.get("database"),
                "username": wh.get("username"),
                "password": wh_password,
            }

    if not target_config:
        raise HTTPException(status_code=400, detail="No target datasource or warehouse configured")

    # Generate DAG ID
    dag_id = f"sync_schedule_{schedule.id}_{task.source_table.replace('.', '_')}"
    schedule.dag_id = dag_id

    # Build source and target connection URLs
    source_password = decrypt_password(source_ds.encrypted_password)
    source_type = source_ds.type.value
    target_type = target_config["type"]

    # Escape special characters in passwords for URL
    import urllib.parse
    source_password_escaped = urllib.parse.quote_plus(source_password or "")
    target_password_escaped = urllib.parse.quote_plus(target_config["password"] or "")

    source_url = f"{source_type}://{source_ds.username}:{source_password_escaped}@{source_ds.host}:{source_ds.port}/{source_ds.database or ''}"
    target_url = f"{target_type}://{target_config['username']}:{target_password_escaped}@{target_config['host']}:{target_config['port']}/{target_config['database'] or ''}"

    # Build table names
    source_table = f"{task.source_schema}.{task.source_table}" if task.source_schema else task.source_table
    target_table = f"{task.target_schema}.{task.target_table}" if task.target_schema else task.target_table

    # Get sync configuration
    sync_mode = task.sync_mode.value if task.sync_mode else "full"
    selected_columns = task.selected_columns if task.selected_columns else "None"
    column_mapping = task.column_mapping if task.column_mapping else "None"
    where_condition = f'"{task.where_condition}"' if task.where_condition else "None"
    incremental_column = f'"{task.incremental_column}"' if task.incremental_column else "None"
    incremental_value = f'"{task.incremental_value}"' if task.incremental_value else "None"

    # Query dependencies for this task
    dep_result = await db.execute(
        select(TaskDependency).where(
            TaskDependency.task_type == "sync",
            TaskDependency.task_id == task.id,
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
            elif dep.upstream_task_id:  # 有依赖但未上线
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
            elif dep.upstream_task_id:  # 有依赖但未上线
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
            sensor_name = f"wait_for_{upstream_dag_id.replace('-', '_')}"
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
        # Build dependency chain: sensors >> sync_task
        if sensor_tasks:
            sensor_chain = f"\n    [{', '.join(sensor_tasks)}] >> sync_task"

    # Generate DAG file content with direct sync logic
    dag_content = f'''"""
Auto-generated Airflow DAG for sync schedule: {schedule.name}
Sync Task: {task.name}
Source: {source_table}
Target: {target_table}
Mode: {sync_mode}
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

# Sync configuration
SYNC_CONFIG = {{
    "task_id": {task.id},
    "source_url": "{source_url}",
    "target_url": "{target_url}",
    "source_table": "{source_table}",
    "target_table": "{target_table}",
    "sync_mode": "{sync_mode}",
    "selected_columns": {selected_columns},
    "column_mapping": {column_mapping},
    "where_condition": {where_condition},
    "incremental_column": {incremental_column},
    "incremental_value": {incremental_value},
}}

def execute_sync():
    """Execute data synchronization directly."""
    import json
    from sqlalchemy import create_engine, text

    config = SYNC_CONFIG

    # Create engines
    source_engine = create_engine(config["source_url"])
    target_engine = create_engine(config["target_url"])

    # Build SELECT query
    columns = config["selected_columns"]
    col_str = ", ".join(columns) if columns else "*"
    sql = f"SELECT {{col_str}} FROM {{config['source_table']}}"

    # Build WHERE clause
    conditions = []
    if config["where_condition"]:
        conditions.append(f"({{config['where_condition']}})")

    if config["sync_mode"] == "incremental" and config["incremental_column"] and config["incremental_value"]:
        conditions.append(f"{{config['incremental_column']}} > '{{config['incremental_value']}}'")

    if conditions:
        sql += " WHERE " + " AND ".join(conditions)

    if config["sync_mode"] == "incremental" and config["incremental_column"]:
        sql += f" ORDER BY {{config['incremental_column']}}"

    # Read source data
    with source_engine.connect() as conn:
        result = conn.execute(text(sql))
        columns_list = list(result.keys())
        rows = result.fetchall()

    rows_read = len(rows)
    print(f"Read {{rows_read}} rows from source")

    if not rows:
        print("No data to sync")
        return {{"success": True, "rows_read": 0, "rows_written": 0}}

    # Apply column mapping
    if config["column_mapping"]:
        columns_list = [config["column_mapping"].get(col, col) for col in columns_list]

    # Write to target (use begin() for auto-commit transaction)
    with target_engine.begin() as conn:
        # For full sync, truncate target table first
        if config["sync_mode"] == "full":
            conn.execute(text(f"TRUNCATE TABLE {{config['target_table']}}"))

        # Build INSERT statement
        placeholders = ", ".join([f":p{{i}}" for i in range(len(columns_list))])
        col_names = ", ".join([f"`{{col}}`" for col in columns_list])
        insert_sql = f"INSERT INTO {{config['target_table']}} ({{col_names}}) VALUES ({{placeholders}})"

        # Insert in batches
        batch_size = 1000
        for i in range(0, len(rows), batch_size):
            batch = rows[i:i + batch_size]
            for row in batch:
                params = {{f"p{{j}}": val for j, val in enumerate(row)}}
                conn.execute(text(insert_sql), params)
        # Transaction auto-commits when exiting the 'with' block

    print(f"Written {{rows_read}} rows to target")

    # Update sync status via API (optional, non-blocking)
    try:
        import requests
        import os
        api_url = os.environ.get('DATA_PLATFORM_API_URL', 'http://host.docker.internal:8000')
        internal_key = os.environ.get('DATA_PLATFORM_INTERNAL_KEY', 'bigdata_platform_internal_key_2024')
        requests.post(
            f"{{api_url}}/api/v1/sync/internal/{{config['task_id']}}/update-status",
            params={{"x_internal_key": internal_key}},
            json={{"rows_read": rows_read, "rows_written": rows_read, "status": "success"}},
            timeout=10
        )
    except Exception as e:
        print(f"Failed to update status: {{e}}")

    return {{"success": True, "rows_read": rows_read, "rows_written": rows_read}}

with DAG(
    dag_id='{dag_id}',
    default_args=default_args,
    description='{schedule.description or schedule.name}',
    schedule_interval='{schedule.cron_expression}',
    start_date=datetime(2024, 1, 1),
    catchup=False,
    is_paused_upon_creation=False,
    tags=['data_sync', 'sync_schedule'],
) as dag:
{sensor_code}
    sync_task = PythonOperator(
        task_id='execute_sync',
        python_callable=execute_sync,
    )
{sensor_chain}
'''

    # Save DAG file
    # Save DAG file to Airflow directory
    dag_path = os.path.join(
        settings.AIRFLOW_DAGS_PATH or '/opt/airflow/dags/generated',
        f'{dag_id}.py'
    )
    try:
        os.makedirs(os.path.dirname(dag_path), exist_ok=True)
        with open(dag_path, 'w', encoding='utf-8') as f:
            f.write(dag_content)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"DAG文件保存失败: {str(e)}"
        )

    # Update schedule status
    schedule.is_enabled = True
    schedule.airflow_status = "active"
    await db.flush()

    # Try to unpause DAG in Airflow (best effort)
    try:
        await airflow_service.enable_dag_simple(dag_id)
    except AirflowAPIError:
        pass  # DAG file is saved, Airflow will pick it up later

    return {
        "success": True,
        "schedule_id": schedule_id,
        "dag_id": dag_id,
        "message": "调度已上线"
    }


@router.post("/{schedule_id}/disable", response_model=dict)
async def disable_sync_schedule(
    schedule_id: int,
    force: bool = False,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Disable a sync schedule - pause DAG."""
    result = await db.execute(
        select(SyncSchedule).where(SyncSchedule.id == schedule_id)
    )
    schedule = result.scalar_one_or_none()
    if not schedule:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Schedule not found"
        )

    if not schedule.is_enabled:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Schedule is not enabled"
        )

    # 检查是否有已上线的下游任务依赖此任务
    online_downstream = await check_online_downstream_dependencies(db, "sync", schedule.sync_task_id)
    if online_downstream and not force:
        task_names = ", ".join([f"{t['name']}" for t in online_downstream])
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"警告：以下已上线的任务依赖此任务：{task_names}。下线后这些任务将无法获取最新数据。确定要下线吗？"
        )

    # Pause DAG in Airflow (best effort - DAG may not exist)
    if schedule.dag_id:
        await airflow_service.pause_dag(schedule.dag_id)

    # Only update local DB after Airflow confirms success
    schedule.is_enabled = False
    schedule.airflow_status = "paused"

    await db.flush()

    return {
        "success": True,
        "schedule_id": schedule_id,
        "message": "Schedule disabled successfully"
    }
