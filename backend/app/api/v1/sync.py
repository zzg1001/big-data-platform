"""
Data sync API endpoints.
"""
from typing import List, Optional
from datetime import datetime
import json
import os

from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.deps import get_current_user
from app.models.user import User
from app.models.datasource import DataSource
from app.models.sync_task import SyncTask, SyncLog, SyncStatus, SyncMode, ColumnMapping
from app.models.dw_layer import DwLayer
from app.models.task_dependency import TaskDependency
from app.models.etl_task import EtlTask
from app.schemas.sync_task import (
    SyncTaskCreate,
    SyncTaskUpdate,
    SyncTaskResponse,
    SyncLogResponse,
    SyncPreviewRequest,
    SyncPreviewResponse,
    SyncTaskEnableRequest,
    SyncTaskSchedulerView,
    SyncTaskBackfillRequest,
    ColumnMappingSaveRequest,
    ColumnMappingListResponse,
    ColumnMappingItem,
)
from app.services.db_connector import DatabaseConnector
from app.services.sync_service import SyncService
from app.services.ai_assistant import AIAssistant
from app.services.airflow_service import airflow_service
from app.schemas.ai import AIDDLConvertResponse, DDLTypeMapping
from app.core.config import settings
from app.core.security import decrypt_password
from app.models.system_config import SystemConfig

router = APIRouter()


async def get_datasource(db: AsyncSession, datasource_id: int) -> DataSource:
    """Helper to get datasource by ID."""
    result = await db.execute(select(DataSource).where(DataSource.id == datasource_id))
    datasource = result.scalar_one_or_none()
    if not datasource:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Datasource {datasource_id} not found")
    return datasource


def get_engine_for_datasource(ds: DataSource):
    """Get SQLAlchemy engine for a datasource."""
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

    return DatabaseConnector.get_engine(
        datasource_id=-1,  # 使用特殊ID标识平台数据库
        db_type=data.get("type"),
        host=data.get("host"),
        port=data.get("port"),
        database=data.get("database"),
        username=data.get("username"),
        encrypted_password=data.get("encrypted_password"),
        schema_name=data.get("schema_name"),
        pool_size=5,
        max_overflow=10,
    )


async def auto_add_sync_dependency(db: AsyncSession, task: SyncTask, user_id: int):
    """
    自动为非 ODS 层的同步任务添加依赖。
    根据 source_table 查找产出该表的上游任务。
    """
    if not task.dw_layer_id:
        return  # 没有指定层级，不处理

    # 获取任务的层级
    layer_result = await db.execute(
        select(DwLayer).where(DwLayer.id == task.dw_layer_id)
    )
    layer = layer_result.scalar_one_or_none()

    if not layer or not layer.requires_dependency:
        return  # ODS 层或不需要依赖的层级

    # 根据 source_table 查找产出该表的同步任务
    # 匹配逻辑：上游任务的 target_table = 当前任务的 source_table
    source_table = task.source_table.lower()

    # 查找同步任务
    upstream_sync = await db.execute(
        select(SyncTask).where(
            SyncTask.target_table.ilike(f"%{source_table}%"),
            SyncTask.id != task.id  # 排除自己
        )
    )
    upstream_sync_task = upstream_sync.scalar_one_or_none()

    if upstream_sync_task:
        # 检查依赖是否已存在
        existing = await db.execute(
            select(TaskDependency).where(
                TaskDependency.task_type == "sync",
                TaskDependency.task_id == task.id,
                TaskDependency.upstream_task_type == "sync",
                TaskDependency.upstream_task_id == upstream_sync_task.id,
            )
        )
        if not existing.scalar_one_or_none():
            # 创建依赖
            dep = TaskDependency(
                task_type="sync",
                task_id=task.id,
                upstream_task_type="sync",
                upstream_task_id=upstream_sync_task.id,
                dependency_type="auto",
                source_table=task.source_table,
                created_by=user_id,
            )
            db.add(dep)
        return

    # 如果没找到同步任务，查找 ETL 任务（ETL 任务可能产出这张表）
    # ETL 任务没有明确的 target_table，这里暂不处理
    # 用户可以手动添加 ETL 任务作为依赖


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


@router.post("/", response_model=SyncTaskResponse, status_code=status.HTTP_201_CREATED)
async def create_sync_task(
    task_data: SyncTaskCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new sync task."""
    # 获取平台数据库配置（可能作为源或目标使用）
    wh_result = await db.execute(
        select(SystemConfig).where(SystemConfig.config_key == "warehouse_config")
    )
    wh_config = wh_result.scalar_one_or_none()

    # Validate source datasource if provided, otherwise check warehouse config
    if task_data.source_datasource_id:
        await get_datasource(db, task_data.source_datasource_id)
    else:
        if not wh_config or not wh_config.config_value:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="未指定源数据源且系统平台数据库未配置，请先在系统管理中配置平台数据库"
            )

    # Validate target datasource if provided, otherwise check warehouse config
    if task_data.target_datasource_id:
        await get_datasource(db, task_data.target_datasource_id)
    else:
        if not wh_config or not wh_config.config_value:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="未指定目标数据源且系统平台数据库未配置，请先在系统管理中配置目标平台数据库"
            )

    sync_task = SyncTask(
        name=task_data.name,
        description=task_data.description,
        source_datasource_id=task_data.source_datasource_id,
        source_table=task_data.source_table,
        source_schema=task_data.source_schema,
        target_datasource_id=task_data.target_datasource_id,
        target_table=task_data.target_table,
        target_schema=task_data.target_schema,
        dw_layer_id=task_data.dw_layer_id,
        sync_mode=task_data.sync_mode,
        incremental_column=task_data.incremental_column,
        where_condition=task_data.where_condition,
        column_mapping=json.dumps(task_data.column_mapping) if task_data.column_mapping else None,
        selected_columns=json.dumps(task_data.selected_columns) if task_data.selected_columns else None,
        cron_expression=task_data.cron_expression,
        is_scheduled=task_data.is_scheduled,
        status=SyncStatus.DRAFT,
        created_by=current_user.id,
    )
    db.add(sync_task)
    await db.flush()
    await db.refresh(sync_task)

    # 自动添加依赖（非 ODS 层的同步任务）
    await auto_add_sync_dependency(db, sync_task, current_user.id)
    await db.flush()

    return sync_task


@router.get("/", response_model=List[SyncTaskResponse])
async def list_sync_tasks(
    status_filter: SyncStatus = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all sync tasks."""
    from sqlalchemy.orm import joinedload
    from app.models.dw_layer import DwLayer
    from app.models.sync_schedule import SyncSchedule

    query = select(SyncTask).options(joinedload(SyncTask.dw_layer))
    if status_filter:
        query = query.where(SyncTask.status == status_filter)
    query = query.order_by(SyncTask.created_at.desc())

    result = await db.execute(query)
    tasks = list(result.scalars().unique().all())

    # 查询所有有调度的任务ID
    schedule_result = await db.execute(
        select(SyncSchedule.sync_task_id).distinct()
    )
    scheduled_task_ids = set(row[0] for row in schedule_result.fetchall())

    # 更新 is_scheduled 字段（基于实际调度关系）
    for task in tasks:
        task.is_scheduled = task.id in scheduled_task_ids

    return tasks


@router.get("/table-columns", response_model=List[dict])
async def get_table_columns_direct(
    datasource_id: int,
    table_name: str,
    schema_name: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get column information for a table directly from datasource."""
    ds = await get_datasource(db, datasource_id)

    try:
        engine = get_engine_for_datasource(ds)
        sync_service = SyncService(engine, engine)
        columns = sync_service.get_table_columns(table_name, schema_name)
        return columns
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get("/{task_id}", response_model=SyncTaskResponse)
async def get_sync_task(
    task_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get sync task by ID."""
    from sqlalchemy.orm import joinedload

    result = await db.execute(
        select(SyncTask).options(joinedload(SyncTask.dw_layer)).where(SyncTask.id == task_id)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sync task not found")
    return task


@router.put("/{task_id}", response_model=SyncTaskResponse)
async def update_sync_task(
    task_id: int,
    task_data: SyncTaskUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update a sync task."""
    result = await db.execute(select(SyncTask).where(SyncTask.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sync task not found")

    update_data = task_data.model_dump(exclude_unset=True)

    # Serialize JSON fields
    if "column_mapping" in update_data:
        update_data["column_mapping"] = json.dumps(update_data["column_mapping"]) if update_data["column_mapping"] else None
    if "selected_columns" in update_data:
        update_data["selected_columns"] = json.dumps(update_data["selected_columns"]) if update_data["selected_columns"] else None

    for field, value in update_data.items():
        setattr(task, field, value)

    await db.flush()
    await db.refresh(task)
    return task


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_sync_task(
    task_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a sync task, its logs, and the Airflow DAG file."""
    from sqlalchemy.orm import selectinload
    from app.models.sync_schedule import SyncSchedule

    # Check if any schedule references this task (后端保护层)
    schedule_result = await db.execute(
        select(SyncSchedule).where(SyncSchedule.sync_task_id == task_id)
    )
    schedule = schedule_result.scalar_one_or_none()
    if schedule:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="请删除引用"
        )

    # 检查是否有下游任务依赖此任务
    downstream_tasks = await check_downstream_dependencies(db, "sync", task_id)
    if downstream_tasks:
        task_names = ", ".join([f"{t['type']}:{t['name']}" for t in downstream_tasks])
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"无法删除：以下任务依赖此任务：{task_names}，请先删除依赖关系"
        )

    # 使用 selectinload 预加载 logs，以便级联删除
    result = await db.execute(
        select(SyncTask)
        .options(selectinload(SyncTask.logs))
        .where(SyncTask.id == task_id)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sync task not found")

    # 删除 Airflow DAG 文件
    dag_id = f"sync_{task.id}_{task.source_table.replace('.', '_')}"
    dag_path = os.path.join(settings.AIRFLOW_DAGS_PATH or '/opt/airflow/dags/generated', f'{dag_id}.py')
    if os.path.exists(dag_path):
        try:
            os.remove(dag_path)
        except Exception as e:
            # 记录错误但不阻止删除任务
            print(f"Warning: Failed to delete DAG file {dag_path}: {e}")

    # 删除此任务作为下游的依赖关系
    from sqlalchemy import delete
    await db.execute(
        delete(TaskDependency).where(
            TaskDependency.task_type == "sync",
            TaskDependency.task_id == task_id
        )
    )

    await db.delete(task)
    await db.flush()


@router.post("/preview", response_model=SyncPreviewResponse)
async def preview_sync_data(
    request: SyncPreviewRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Preview source data before sync."""
    source_ds = await get_datasource(db, request.source_datasource_id)

    try:
        source_engine = get_engine_for_datasource(source_ds)
        sync_service = SyncService(source_engine, source_engine)  # Target not needed for preview

        result = sync_service.preview_data(
            table=request.source_table,
            schema=request.source_schema,
            columns=request.selected_columns,
            where_condition=request.where_condition,
            limit=request.limit,
        )
        return SyncPreviewResponse(**result)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get("/{task_id}/columns", response_model=List[dict])
async def get_source_columns(
    task_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get column information for source table."""
    result = await db.execute(select(SyncTask).where(SyncTask.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sync task not found")

    try:
        # 如果有 source_datasource_id 则使用，否则使用平台数据库
        if task.source_datasource_id:
            source_ds = await get_datasource(db, task.source_datasource_id)
            source_engine = get_engine_for_datasource(source_ds)
        else:
            source_engine = await get_warehouse_engine(db)
        sync_service = SyncService(source_engine, source_engine)
        columns = sync_service.get_table_columns(task.source_table, task.source_schema)
        return columns
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.post("/{task_id}/execute", response_model=SyncLogResponse)
async def execute_sync_task(
    task_id: int,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Execute a sync task immediately."""
    result = await db.execute(select(SyncTask).where(SyncTask.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sync task not found")

    if task.status == SyncStatus.RUNNING:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Task is already running")

    # Create log entry
    log = SyncLog(
        sync_task_id=task.id,
        sync_mode=task.sync_mode,
        status="pending",
        started_at=datetime.utcnow(),
    )
    db.add(log)
    task.status = SyncStatus.RUNNING
    await db.flush()
    await db.refresh(log)

    # Execute sync
    try:
        # 如果有 source_datasource_id 则使用，否则使用平台数据库
        if task.source_datasource_id:
            source_ds = await get_datasource(db, task.source_datasource_id)
            source_engine = get_engine_for_datasource(source_ds)
        else:
            source_engine = await get_warehouse_engine(db)

        # 如果有 target_datasource_id 则使用，否则使用平台数据库
        if task.target_datasource_id:
            target_ds = await get_datasource(db, task.target_datasource_id)
            target_engine = get_engine_for_datasource(target_ds)
        else:
            target_engine = await get_warehouse_engine(db)
        sync_service = SyncService(source_engine, target_engine)

        log = sync_service.execute_sync(task, log)

        # Update task status
        if log.status == "success":
            task.status = SyncStatus.ACTIVE
            task.last_sync_at = datetime.utcnow()
            task.last_sync_rows = log.rows_written
            task.last_error = None
            if log.incremental_end:
                task.incremental_value = log.incremental_end
        else:
            task.status = SyncStatus.FAILED
            task.last_error = log.error_message

        await db.flush()
        await db.refresh(log)
        return log

    except Exception as e:
        log.status = "failed"
        log.error_message = str(e)
        log.completed_at = datetime.utcnow()
        task.status = SyncStatus.FAILED
        task.last_error = str(e)
        await db.flush()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get("/{task_id}/logs", response_model=List[SyncLogResponse])
async def get_sync_logs(
    task_id: int,
    limit: int = 50,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get execution logs for a sync task."""
    result = await db.execute(
        select(SyncLog)
        .where(SyncLog.sync_task_id == task_id)
        .order_by(SyncLog.started_at.desc())
        .limit(limit)
    )
    return list(result.scalars().all())


@router.post("/{task_id}/generate-ddl", response_model=dict)
async def generate_target_ddl(
    task_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Generate CREATE TABLE DDL for target table."""
    result = await db.execute(select(SyncTask).where(SyncTask.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sync task not found")

    try:
        # 如果有 source_datasource_id 则使用，否则使用平台数据库
        if task.source_datasource_id:
            source_ds = await get_datasource(db, task.source_datasource_id)
            source_engine = get_engine_for_datasource(source_ds)
        else:
            source_engine = await get_warehouse_engine(db)

        if task.target_datasource_id:
            target_ds = await get_datasource(db, task.target_datasource_id)
            target_engine = get_engine_for_datasource(target_ds)
        else:
            target_engine = await get_warehouse_engine(db)
        sync_service = SyncService(source_engine, target_engine)

        selected_columns = json.loads(task.selected_columns) if task.selected_columns else None
        column_mapping = json.loads(task.column_mapping) if task.column_mapping else None

        ddl = sync_service.create_target_table(
            source_table=task.source_table,
            target_table=task.target_table,
            source_schema=task.source_schema,
            target_schema=task.target_schema,
            selected_columns=selected_columns,
            column_mapping=column_mapping,
        )
        return {"ddl": ddl}
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.post("/{task_id}/generate-dag", response_model=dict)
async def generate_sync_dag(
    task_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Generate an Airflow DAG for a sync task."""
    result = await db.execute(select(SyncTask).where(SyncTask.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sync task not found")

    if not task.is_scheduled or not task.cron_expression:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Task must have a cron expression to generate DAG"
        )

    # Get source name for DAG description
    if task.source_datasource_id:
        source_ds = await get_datasource(db, task.source_datasource_id)
        source_name = source_ds.name
    else:
        source_name = "平台数据库"

    # Get target name for DAG description
    if task.target_datasource_id:
        target_ds = await get_datasource(db, task.target_datasource_id)
        target_name = target_ds.name
    else:
        target_name = "平台数据库"

    # Generate DAG content
    dag_id = f"sync_{task.id}_{task.source_table.replace('.', '_')}"

    # Convert cron to Airflow schedule (handling common formats)
    schedule = task.cron_expression

    dag_content = f'''"""
Auto-generated Airflow DAG for sync task: {task.name}
Source: {source_ds.name}.{task.source_table}
Target: {target_name}.{task.target_table}
"""
from datetime import datetime, timedelta
from airflow import DAG
from airflow.operators.python import PythonOperator
import requests

default_args = {{
    'owner': 'data_platform',
    'depends_on_past': False,
    'email_on_failure': True,
    'retries': 1,
    'retry_delay': timedelta(minutes=5),
}}

def execute_sync():
    """Call the data platform API to execute sync."""
    import os
    api_url = os.environ.get('DATA_PLATFORM_API_URL', 'http://backend:8000')
    # Note: In production, implement proper authentication
    response = requests.post(
        f"{{api_url}}/api/v1/sync/{task.id}/execute",
        headers={{"Authorization": "Bearer YOUR_API_TOKEN"}},
        timeout=3600
    )
    response.raise_for_status()
    return response.json()

with DAG(
    dag_id='{dag_id}',
    default_args=default_args,
    description='{task.description or task.name}',
    schedule_interval='{schedule}',
    start_date=datetime(2024, 1, 1),
    catchup=False,
    is_paused_upon_creation=False,
    tags=['data_sync', 'auto_generated'],
) as dag:

    sync_task = PythonOperator(
        task_id='execute_sync',
        python_callable=execute_sync,
    )
'''

    # Save to Airflow DAGs directory
    import os
    dag_path = os.path.join(settings.AIRFLOW_DAGS_PATH or '/opt/airflow/dags/generated', f'{dag_id}.py')

    try:
        os.makedirs(os.path.dirname(dag_path), exist_ok=True)
        with open(dag_path, 'w', encoding='utf-8') as f:
            f.write(dag_content)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save DAG file: {str(e)}"
        )

    # Update task status
    task.status = SyncStatus.ACTIVE
    await db.flush()

    return {
        "success": True,
        "dag_id": dag_id,
        "dag_path": dag_path,
        "message": f"DAG '{dag_id}' generated successfully"
    }


@router.post("/{task_id}/generate-ddl-ai", response_model=AIDDLConvertResponse)
async def generate_target_ddl_ai(
    task_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Generate DDL for target table. If source and target db types are the same, skip AI conversion."""
    result = await db.execute(select(SyncTask).where(SyncTask.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sync task not found")

    # 获取平台数据库配置（可能作为源或目标使用）
    import json as json_module
    wh_result = await db.execute(
        select(SystemConfig).where(SystemConfig.config_key == "warehouse_config")
    )
    wh_config = wh_result.scalar_one_or_none()
    wh_data = json_module.loads(wh_config.config_value) if wh_config and wh_config.config_value else None

    # Get source db type
    if task.source_datasource_id:
        source_ds = await get_datasource(db, task.source_datasource_id)
        source_db_type = source_ds.type.value if hasattr(source_ds.type, 'value') else str(source_ds.type)
        source_engine = get_engine_for_datasource(source_ds)
    else:
        if not wh_data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="平台数据库未配置"
            )
        source_db_type = wh_data.get("type", "mysql")
        source_engine = await get_warehouse_engine(db)

    # Get target db type
    if task.target_datasource_id:
        target_ds = await get_datasource(db, task.target_datasource_id)
        target_db_type = target_ds.type.value if hasattr(target_ds.type, 'value') else str(target_ds.type)
    else:
        if not wh_data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="平台数据库未配置"
            )
        target_db_type = wh_data.get("type", "mysql")

    try:

        # Get table metadata and generate source DDL
        metadata = DatabaseConnector.get_table_metadata(
            source_engine, task.source_table, schema=task.source_schema
        )

        # Build source DDL from metadata
        columns_ddl = []
        type_mappings = []
        selected_columns = json.loads(task.selected_columns) if task.selected_columns else None

        for col in metadata.columns:
            # Skip if not in selected columns
            if selected_columns and col.name not in selected_columns:
                continue

            col_def = f"  {col.name} {col.data_type}"
            if not col.is_nullable:
                col_def += " NOT NULL"
            if col.default_value:
                col_def += f" DEFAULT {col.default_value}"
            if col.comment:
                col_def += f" COMMENT '{col.comment}'"
            columns_ddl.append(col_def)

            # Record type mapping
            type_mappings.append(DDLTypeMapping(
                column_name=col.name,
                source_type=col.data_type,
                target_type=col.data_type,
                warning=None,
            ))

        pk_cols = [col.name for col in metadata.columns if col.is_primary_key]
        if pk_cols:
            # Only include PK columns that are selected
            if selected_columns:
                pk_cols = [c for c in pk_cols if c in selected_columns]
            if pk_cols:
                columns_ddl.append(f"  PRIMARY KEY ({', '.join(pk_cols)})")

        table_name = f"{task.source_schema}.{task.source_table}" if task.source_schema else task.source_table
        source_ddl = f"CREATE TABLE {table_name} (\n" + ",\n".join(columns_ddl) + "\n);"

        # Determine target table name
        if task.target_schema:
            full_target_table = f"{task.target_schema}.{task.target_table}"
        else:
            full_target_table = task.target_table

        # 如果源库和目标库类型相同，直接生成 DDL，不使用 AI
        if source_db_type.lower() == target_db_type.lower():
            target_ddl = f"CREATE TABLE IF NOT EXISTS {full_target_table} (\n" + ",\n".join(columns_ddl) + "\n);"

            return AIDDLConvertResponse(
                source_db_type=source_db_type,
                target_db_type=target_db_type,
                source_ddl=source_ddl,
                target_ddl=target_ddl,
                type_mappings=type_mappings,
                explanation=f"源库和目标库类型相同 ({source_db_type})，直接复制 DDL 结构，无需类型转换。",
                warnings=[],
            )

        # 如果类型不同，检查 AI 服务是否配置
        if not settings.ANTHROPIC_AUTH_TOKEN:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="源库和目标库类型不同，需要 AI 转换，但 AI 服务未配置。",
            )

        # Use AI to convert DDL
        ai = AIAssistant()
        response = ai.convert_ddl(
            source_ddl=source_ddl,
            source_db_type=source_db_type,
            target_db_type=target_db_type,
            target_table=task.target_table,
            target_schema=task.target_schema,
        )
        return response

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


from pydantic import BaseModel
from typing import Optional


class ExecuteDDLRequest(BaseModel):
    """Request body for executing DDL on warehouse or specific datasource."""
    ddl: str
    target_datasource_id: Optional[int] = None  # None表示使用系统平台数据库


class GenerateDDLRequest(BaseModel):
    """Request body for generating DDL."""
    source_datasource_id: Optional[int] = None  # None表示使用系统平台数据库
    source_table: str
    source_schema: Optional[str] = None
    target_table: Optional[str] = None
    target_schema: Optional[str] = None
    target_datasource_id: Optional[int] = None  # None表示使用系统平台数据库


@router.post("/execute-ddl-warehouse", response_model=dict)
async def execute_ddl_on_warehouse(
    request: ExecuteDDLRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Execute DDL on the system warehouse or a specific datasource."""
    try:
        # 如果指定了目标数据源，使用该数据源；否则使用系统平台数据库
        if request.target_datasource_id:
            target_ds = await get_datasource(db, request.target_datasource_id)
            engine = get_engine_for_datasource(target_ds)
        else:
            engine = await get_warehouse_engine(db)

        # Execute DDL
        from sqlalchemy import text
        with engine.connect() as conn:
            conn.execute(text(request.ddl))
            conn.commit()

        # Extract table name from DDL
        import re
        match = re.search(r'CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)', request.ddl, re.IGNORECASE)
        table_name = match.group(1) if match else None

        return {
            "success": True,
            "message": "DDL 执行成功",
            "table_name": table_name,
        }
    except HTTPException:
        raise
    except Exception as e:
        import logging
        import traceback
        error_detail = traceback.format_exc()
        logging.error(f"DDL 执行失败: {type(e).__name__}: {str(e)}\nDDL: {request.ddl[:300]}\nTraceback: {error_detail}")
        return {
            "success": False,
            "message": f"DDL 执行失败: {type(e).__name__}: {str(e) or '未知错误'}",
            "table_name": None,
        }


@router.post("/generate-ddl-preview", response_model=AIDDLConvertResponse)
async def generate_ddl_preview(
    request: GenerateDDLRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Generate DDL for a table. If source and target db types are the same, skip AI conversion."""
    import json as json_module

    # 获取平台数据库配置（可能作为源或目标使用）
    wh_result = await db.execute(
        select(SystemConfig).where(SystemConfig.config_key == "warehouse_config")
    )
    wh_config = wh_result.scalar_one_or_none()
    wh_data = json_module.loads(wh_config.config_value) if wh_config and wh_config.config_value else None

    # 如果指定了源数据源，从该数据源获取；否则使用平台数据库
    if request.source_datasource_id:
        source_ds = await get_datasource(db, request.source_datasource_id)
        source_db_type = source_ds.type.value if hasattr(source_ds.type, 'value') else str(source_ds.type)
        source_engine = get_engine_for_datasource(source_ds)
    else:
        if not wh_data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="平台数据库未配置，请先在系统管理中配置平台数据库"
            )
        source_db_type = wh_data.get("type", "mysql")
        source_engine = await get_warehouse_engine(db)

    # 如果指定了目标数据源，从该数据源获取类型；否则从平台数据库配置获取
    if request.target_datasource_id:
        target_ds = await get_datasource(db, request.target_datasource_id)
        target_db_type = target_ds.type.value if hasattr(target_ds.type, 'value') else str(target_ds.type)
    else:
        if not wh_data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="平台数据库未配置，请先在系统管理中配置目标平台数据库"
            )
        target_db_type = wh_data.get("type", "mysql")

    try:

        # Get table metadata and generate source DDL
        metadata = DatabaseConnector.get_table_metadata(
            source_engine, request.source_table, schema=request.source_schema
        )

        # Build source DDL from metadata
        columns_ddl = []
        type_mappings = []
        for col in metadata.columns:
            # 清理数据类型中的 COLLATE 子句
            import re
            clean_data_type = re.sub(r'\s+COLLATE\s+["\']?\w+["\']?', '', col.data_type, flags=re.IGNORECASE)
            col_def = f"  {col.name} {clean_data_type}"
            if not col.is_nullable:
                col_def += " NOT NULL"
            if col.default_value:
                col_def += f" DEFAULT {col.default_value}"
            if col.comment:
                col_def += f" COMMENT '{col.comment}'"
            columns_ddl.append(col_def)

            # Record type mapping
            type_mappings.append(DDLTypeMapping(
                column_name=col.name,
                source_type=clean_data_type,
                target_type=clean_data_type,  # Same type if no conversion
                warning=None,
            ))

        pk_cols = [col.name for col in metadata.columns if col.is_primary_key]
        if pk_cols:
            columns_ddl.append(f"  PRIMARY KEY ({', '.join(pk_cols)})")

        # Determine target table name
        target_table = request.target_table or request.source_table
        if request.target_schema:
            full_target_table = f"{request.target_schema}.{target_table}"
        else:
            full_target_table = target_table

        source_table_name = f"{request.source_schema}.{request.source_table}" if request.source_schema else request.source_table
        source_ddl = f"CREATE TABLE {source_table_name} (\n" + ",\n".join(columns_ddl) + "\n);"

        # 如果源库和目标库类型相同，直接生成 DDL，不使用 AI
        if source_db_type.lower() == target_db_type.lower():
            # 直接替换表名生成目标 DDL
            target_ddl = f"CREATE TABLE IF NOT EXISTS {full_target_table} (\n" + ",\n".join(columns_ddl) + "\n);"

            return AIDDLConvertResponse(
                source_db_type=source_db_type,
                target_db_type=target_db_type,
                source_ddl=source_ddl,
                target_ddl=target_ddl,
                type_mappings=type_mappings,
                explanation=f"源库和目标库类型相同 ({source_db_type})，直接复制 DDL 结构，无需类型转换。",
                warnings=[],
            )

        # 如果类型不同，检查 AI 服务是否配置
        if not settings.ANTHROPIC_AUTH_TOKEN:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="源库和目标库类型不同，需要 AI 转换，但 AI 服务未配置。",
            )

        # Use AI to convert DDL
        ai = AIAssistant()
        response = ai.convert_ddl(
            source_ddl=source_ddl,
            source_db_type=source_db_type,
            target_db_type=target_db_type,
            target_table=target_table,
            target_schema=request.target_schema,
        )
        return response

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


# ==================== Column Mapping Endpoints ====================

@router.post("/column-mappings", response_model=dict)
async def save_column_mappings(
    request: ColumnMappingSaveRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Save column mappings for a source-target table pair."""
    from sqlalchemy import delete

    # Delete existing mappings for this source-target pair
    await db.execute(
        delete(ColumnMapping).where(
            ColumnMapping.source_datasource_id == request.source_datasource_id,
            ColumnMapping.source_table == request.source_table,
            ColumnMapping.target_table == request.target_table,
        )
    )

    # Insert new mappings
    for idx, mapping in enumerate(request.mappings):
        cm = ColumnMapping(
            sync_task_id=request.sync_task_id,
            source_datasource_id=request.source_datasource_id,
            source_table=request.source_table,
            target_table=request.target_table,
            source_column=mapping.source_column,
            source_type=mapping.source_type,
            target_column=mapping.target_column,
            target_type=mapping.target_type,
            sort_order=idx,
            is_new_column=mapping.is_new_column,
        )
        db.add(cm)

    await db.flush()

    return {
        "success": True,
        "message": f"保存了 {len(request.mappings)} 个字段映射",
        "count": len(request.mappings),
    }


@router.get("/column-mappings", response_model=ColumnMappingListResponse)
async def get_column_mappings(
    source_datasource_id: int,
    source_table: str,
    target_table: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get saved column mappings for a source-target table pair."""
    result = await db.execute(
        select(ColumnMapping)
        .where(
            ColumnMapping.source_datasource_id == source_datasource_id,
            ColumnMapping.source_table == source_table,
            ColumnMapping.target_table == target_table,
        )
        .order_by(ColumnMapping.sort_order)
    )
    mappings = result.scalars().all()

    return ColumnMappingListResponse(
        source_table=source_table,
        target_table=target_table,
        mappings=[
            ColumnMappingItem(
                source_column=m.source_column,
                source_type=m.source_type,
                target_column=m.target_column,
                target_type=m.target_type,
                is_new_column=m.is_new_column,
            )
            for m in mappings
        ],
    )


@router.delete("/column-mappings", response_model=dict)
async def delete_column_mappings(
    source_datasource_id: int,
    source_table: str,
    target_table: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete column mappings for a source-target table pair."""
    from sqlalchemy import delete

    result = await db.execute(
        delete(ColumnMapping).where(
            ColumnMapping.source_datasource_id == source_datasource_id,
            ColumnMapping.source_table == source_table,
            ColumnMapping.target_table == target_table,
        )
    )
    await db.flush()

    return {
        "success": True,
        "deleted_count": result.rowcount,
    }


# ==================== Scheduler Management Endpoints ====================

@router.get("/scheduler/list", response_model=List[SyncTaskSchedulerView])
async def list_sync_tasks_for_scheduler(
    status_filter: str = None,  # "online" | "offline" | None (all)
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    List sync tasks for scheduler management view.
    Includes creator name from joined User table.
    """
    from app.models.user import User as UserModel

    query = select(SyncTask, UserModel.username).outerjoin(
        UserModel, SyncTask.created_by == UserModel.id
    )

    if status_filter == "online":
        query = query.where(SyncTask.is_scheduled == True)
    elif status_filter == "offline":
        query = query.where(SyncTask.is_scheduled == False)

    query = query.order_by(SyncTask.created_at.desc())
    result = await db.execute(query)
    rows = result.all()

    tasks = []
    for task, creator_name in rows:
        task_dict = {
            "id": task.id,
            "name": task.name,
            "description": task.description,
            "source_datasource_id": task.source_datasource_id,
            "source_table": task.source_table,
            "target_table": task.target_table,
            "sync_mode": task.sync_mode,
            "is_scheduled": task.is_scheduled,
            "cron_expression": task.cron_expression,
            "dag_id": task.dag_id,
            "airflow_status": task.airflow_status,
            "next_run_time": task.next_run_time,
            "status": task.status,
            "last_sync_at": task.last_sync_at,
            "last_sync_rows": task.last_sync_rows,
            "created_by": task.created_by,
            "creator_name": creator_name,
            "created_at": task.created_at,
        }
        tasks.append(task_dict)

    return tasks


@router.post("/{task_id}/enable", response_model=dict)
async def enable_sync_task(
    task_id: int,
    request: SyncTaskEnableRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Enable/上线 a sync task:
    1. Set cron_expression and is_scheduled=True
    2. Generate DAG file
    3. Activate DAG in Airflow
    """
    result = await db.execute(select(SyncTask).where(SyncTask.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sync task not found")

    if task.is_scheduled:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Task is already scheduled")

    # Update task with cron expression
    task.cron_expression = request.cron_expression
    task.is_scheduled = True

    # Generate DAG ID
    dag_id = f"sync_{task.id}_{task.source_table.replace('.', '_')}"
    task.dag_id = dag_id

    # Generate DAG file content
    schedule = task.cron_expression
    dag_content = f'''"""
Auto-generated Airflow DAG for sync task: {task.name}
Source: {task.source_table}
Target: {task.target_table}
"""
from datetime import datetime, timedelta
from airflow import DAG
from airflow.operators.python import PythonOperator
import requests

default_args = {{
    'owner': 'data_platform',
    'depends_on_past': False,
    'email_on_failure': True,
    'retries': 1,
    'retry_delay': timedelta(minutes=5),
}}

def execute_sync():
    """Call the data platform API to execute sync."""
    import os
    api_url = os.environ.get('DATA_PLATFORM_API_URL', 'http://backend:8000')
    response = requests.post(
        f"{{api_url}}/api/v1/sync/{task.id}/execute",
        headers={{"Authorization": "Bearer YOUR_API_TOKEN"}},
        timeout=3600
    )
    response.raise_for_status()
    return response.json()

with DAG(
    dag_id='{dag_id}',
    default_args=default_args,
    description='{task.description or task.name}',
    schedule_interval='{schedule}',
    start_date=datetime(2024, 1, 1),
    catchup=False,
    is_paused_upon_creation=False,
    tags=['data_sync', 'auto_generated'],
) as dag:

    sync_task = PythonOperator(
        task_id='execute_sync',
        python_callable=execute_sync,
    )
'''

    # Save DAG file
    dag_path = os.path.join(settings.AIRFLOW_DAGS_PATH or '/opt/airflow/dags/generated', f'{dag_id}.py')
    try:
        os.makedirs(os.path.dirname(dag_path), exist_ok=True)
        with open(dag_path, 'w', encoding='utf-8') as f:
            f.write(dag_content)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save DAG file: {str(e)}"
        )

    # Update task status
    task.status = SyncStatus.ACTIVE
    task.airflow_status = "active"

    await db.flush()

    return {
        "success": True,
        "task_id": task_id,
        "dag_id": dag_id,
        "message": f"Task enabled successfully. DAG '{dag_id}' generated."
    }


@router.post("/{task_id}/disable", response_model=dict)
async def disable_sync_task(
    task_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Disable/下线 a sync task:
    1. Set is_scheduled=False
    2. Pause DAG in Airflow (if exists)
    """
    result = await db.execute(select(SyncTask).where(SyncTask.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sync task not found")

    if not task.is_scheduled:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Task is not scheduled")

    # Pause DAG in Airflow
    if task.dag_id:
        await airflow_service.pause_dag(task.dag_id)

    # Update task
    task.is_scheduled = False
    task.airflow_status = "paused"
    task.status = SyncStatus.PAUSED

    await db.flush()

    return {
        "success": True,
        "task_id": task_id,
        "message": "Task disabled successfully."
    }


@router.get("/{task_id}/airflow-status", response_model=dict)
async def get_sync_task_airflow_status(
    task_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Get real-time Airflow status for a sync task.
    """
    result = await db.execute(select(SyncTask).where(SyncTask.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sync task not found")

    if not task.dag_id:
        return {
            "task_id": task_id,
            "dag_id": None,
            "status": None,
            "next_run_time": None,
            "recent_runs": [],
        }

    # Get status from Airflow
    dag_status = await airflow_service.get_dag_status(task.dag_id)
    next_run = await airflow_service.get_next_dag_run(task.dag_id)
    recent_runs = await airflow_service.get_dag_runs(task.dag_id, limit=5)

    # Update cached status in DB
    if dag_status:
        task.airflow_status = dag_status
    if next_run:
        task.next_run_time = next_run
    await db.flush()

    return {
        "task_id": task_id,
        "dag_id": task.dag_id,
        "status": dag_status,
        "next_run_time": next_run.isoformat() if next_run else None,
        "recent_runs": [
            {
                "run_id": run.get("dag_run_id"),
                "state": run.get("state"),
                "execution_date": run.get("execution_date"),
                "start_date": run.get("start_date"),
                "end_date": run.get("end_date"),
            }
            for run in recent_runs
        ],
    }


@router.post("/{task_id}/backfill", response_model=dict)
async def backfill_sync_task(
    task_id: int,
    request: SyncTaskBackfillRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Trigger backfill for a sync task.
    Modes: full | by_partition | by_date
    """
    result = await db.execute(select(SyncTask).where(SyncTask.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sync task not found")

    # Update backfill config
    task.backfill_mode = request.mode
    task.backfill_start_date = request.start_date
    task.backfill_end_date = request.end_date

    # For full backfill, just execute the sync
    if request.mode == "full":
        try:
            # Get source engine
            if task.source_datasource_id:
                source_ds = await get_datasource(db, task.source_datasource_id)
                source_engine = get_engine_for_datasource(source_ds)
            else:
                source_engine = await get_warehouse_engine(db)

            # Get target engine
            if task.target_datasource_id:
                target_ds = await get_datasource(db, task.target_datasource_id)
                target_engine = get_engine_for_datasource(target_ds)
            else:
                target_engine = await get_warehouse_engine(db)
            sync_service = SyncService(source_engine, target_engine)

            # Create log entry
            sync_log = SyncLog(
                sync_task_id=task.id,
                sync_mode=SyncMode.FULL,
                status="running",
                started_at=datetime.utcnow(),
            )
            db.add(sync_log)
            await db.flush()

            # Execute sync (full mode = truncate + insert)
            rows_read, rows_written = sync_service.execute_sync(task, mode_override="full")

            # Update log
            sync_log.status = "success"
            sync_log.rows_read = rows_read
            sync_log.rows_written = rows_written
            sync_log.completed_at = datetime.utcnow()

            # Update task
            task.last_sync_at = datetime.utcnow()
            task.last_sync_rows = rows_written

            await db.flush()

            return {
                "success": True,
                "task_id": task_id,
                "mode": request.mode,
                "rows_read": rows_read,
                "rows_written": rows_written,
            }

        except Exception as e:
            return {
                "success": False,
                "task_id": task_id,
                "mode": request.mode,
                "error": str(e),
            }

    # For partition/date backfill - trigger Airflow DAG with conf
    elif request.mode in ["by_partition", "by_date"]:
        if not task.dag_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Task must be scheduled before triggering backfill by partition/date"
            )

        conf = {
            "backfill_mode": request.mode,
            "start_date": request.start_date.isoformat() if request.start_date else None,
            "end_date": request.end_date.isoformat() if request.end_date else None,
            "partitions": request.partitions,
        }

        result = await airflow_service.trigger_dag(task.dag_id, conf=conf)
        if result:
            return {
                "success": True,
                "task_id": task_id,
                "mode": request.mode,
                "dag_run_id": result.get("dag_run_id"),
            }
        else:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to trigger Airflow DAG"
            )

    return {"success": False, "error": "Invalid backfill mode"}


@router.post("/internal/{task_id}/execute", response_model=dict)
async def internal_execute_sync_task(
    task_id: int,
    x_internal_key: str = None,
    db: AsyncSession = Depends(get_db),
):
    """
    Internal endpoint for Airflow DAG to execute sync task.
    Uses internal API key instead of user authentication.
    """
    from app.core.config import settings
    from fastapi import Header

    # Validate internal API key from query param or header
    if x_internal_key != settings.INTERNAL_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid internal API key"
        )

    result = await db.execute(select(SyncTask).where(SyncTask.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sync task not found")

    if task.status == SyncStatus.RUNNING:
        return {"success": False, "message": "Task is already running", "task_id": task_id}

    # Create log entry
    log = SyncLog(
        sync_task_id=task.id,
        sync_mode=task.sync_mode,
        status="pending",
        started_at=datetime.utcnow(),
    )
    db.add(log)
    task.status = SyncStatus.RUNNING
    await db.flush()
    await db.refresh(log)

    # Execute sync
    try:
        # Get source engine
        if task.source_datasource_id:
            source_ds = await get_datasource(db, task.source_datasource_id)
            source_engine = get_engine_for_datasource(source_ds)
        else:
            source_engine = await get_warehouse_engine(db)

        # Get target engine
        if task.target_datasource_id:
            target_ds = await get_datasource(db, task.target_datasource_id)
            target_engine = get_engine_for_datasource(target_ds)
        else:
            target_engine = await get_warehouse_engine(db)
        sync_service = SyncService(source_engine, target_engine)

        log = sync_service.execute_sync(task, log)

        # Update task status
        if log.status == "success":
            task.status = SyncStatus.ACTIVE
            task.last_sync_at = datetime.utcnow()
            task.last_sync_rows = log.rows_written
            task.last_error = None
        else:
            task.status = SyncStatus.FAILED
            task.last_error = log.error_message

        await db.flush()

        return {
            "success": log.status == "success",
            "task_id": task_id,
            "log_id": log.id,
            "rows_read": log.rows_read,
            "rows_written": log.rows_written,
            "status": log.status,
            "error": log.error_message,
        }

    except Exception as e:
        log.status = "failed"
        log.error_message = str(e)
        log.finished_at = datetime.utcnow()
        task.status = SyncStatus.FAILED
        task.last_error = str(e)
        await db.flush()
        return {
            "success": False,
            "task_id": task_id,
            "error": str(e),
        }


@router.post("/internal/{task_id}/update-status", response_model=dict)
async def internal_update_sync_status(
    task_id: int,
    x_internal_key: str = None,
    rows_read: int = 0,
    rows_written: int = 0,
    status_str: str = "success",
    error_msg: str = None,
    db: AsyncSession = Depends(get_db),
):
    """
    Internal endpoint for Airflow DAG to update sync task status.
    Lightweight API - failures here don't affect the actual sync.
    """
    from app.core.config import settings

    # Validate internal API key
    if x_internal_key != settings.INTERNAL_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid internal API key"
        )

    result = await db.execute(select(SyncTask).where(SyncTask.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        return {"success": False, "error": "Task not found"}

    # Update task status
    if status_str == "success":
        task.status = SyncStatus.ACTIVE
        task.last_sync_at = datetime.utcnow()
        task.last_sync_rows = rows_written
        task.last_error = None
    else:
        task.status = SyncStatus.FAILED
        task.last_error = error_msg

    # Create log entry
    log = SyncLog(
        sync_task_id=task.id,
        sync_mode=task.sync_mode,
        status=status_str,
        rows_read=rows_read,
        rows_written=rows_written,
        error_message=error_msg,
        started_at=datetime.utcnow(),
        completed_at=datetime.utcnow(),
    )
    db.add(log)
    await db.flush()

    return {"success": True, "task_id": task_id, "status": status_str}
