"""
Data sync API endpoints.
"""
from typing import List
from datetime import datetime
import json

from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.deps import get_current_user
from app.models.user import User
from app.models.datasource import DataSource
from app.models.sync_task import SyncTask, SyncLog, SyncStatus, SyncMode
from app.schemas.sync_task import (
    SyncTaskCreate,
    SyncTaskUpdate,
    SyncTaskResponse,
    SyncLogResponse,
    SyncPreviewRequest,
    SyncPreviewResponse,
)
from app.services.db_connector import DatabaseConnector
from app.services.sync_service import SyncService
from app.services.ai_assistant import AIAssistant
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
            detail="数仓未配置，请先在系统管理中配置目标数仓"
        )

    import json
    try:
        data = json.loads(config.config_value)
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="数仓配置格式错误"
        )

    password = decrypt_password(data.get("encrypted_password", ""))
    if not password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="数仓密码未配置"
        )

    return DatabaseConnector.get_engine(
        datasource_id=-1,  # 使用特殊ID标识数仓
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


@router.post("/", response_model=SyncTaskResponse, status_code=status.HTTP_201_CREATED)
async def create_sync_task(
    task_data: SyncTaskCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new sync task."""
    # Validate source datasource exists
    await get_datasource(db, task_data.source_datasource_id)

    # Validate target datasource if provided, otherwise check warehouse config
    if task_data.target_datasource_id:
        await get_datasource(db, task_data.target_datasource_id)
    else:
        # Verify warehouse is configured
        result = await db.execute(
            select(SystemConfig).where(SystemConfig.config_key == "warehouse_config")
        )
        config = result.scalar_one_or_none()
        if not config or not config.config_value:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="未指定目标数据源且系统数仓未配置，请先在系统管理中配置目标数仓"
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
    return sync_task


@router.get("/", response_model=List[SyncTaskResponse])
async def list_sync_tasks(
    status_filter: SyncStatus = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all sync tasks."""
    query = select(SyncTask)
    if status_filter:
        query = query.where(SyncTask.status == status_filter)
    query = query.order_by(SyncTask.created_at.desc())

    result = await db.execute(query)
    return list(result.scalars().all())


@router.get("/{task_id}", response_model=SyncTaskResponse)
async def get_sync_task(
    task_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get sync task by ID."""
    result = await db.execute(select(SyncTask).where(SyncTask.id == task_id))
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
    """Delete a sync task and its logs."""
    from sqlalchemy.orm import selectinload

    # 使用 selectinload 预加载 logs，以便级联删除
    result = await db.execute(
        select(SyncTask)
        .options(selectinload(SyncTask.logs))
        .where(SyncTask.id == task_id)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sync task not found")

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

    source_ds = await get_datasource(db, task.source_datasource_id)

    try:
        source_engine = get_engine_for_datasource(source_ds)
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

    # Get datasources
    source_ds = await get_datasource(db, task.source_datasource_id)

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
        source_engine = get_engine_for_datasource(source_ds)
        # 如果有 target_datasource_id 则使用，否则使用系统数仓配置
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


@router.get("/table-columns", response_model=List[dict])
async def get_table_columns_direct(
    datasource_id: int,
    table_name: str,
    schema_name: str = None,
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

    source_ds = await get_datasource(db, task.source_datasource_id)

    try:
        source_engine = get_engine_for_datasource(source_ds)
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

    source_ds = await get_datasource(db, task.source_datasource_id)

    # Get target name for DAG description
    if task.target_datasource_id:
        target_ds = await get_datasource(db, task.target_datasource_id)
        target_name = target_ds.name
    else:
        # Get from warehouse config
        wh_result = await db.execute(
            select(SystemConfig).where(SystemConfig.config_key == "warehouse_config")
        )
        wh_config = wh_result.scalar_one_or_none()
        if wh_config and wh_config.config_value:
            import json as json_module
            wh_data = json_module.loads(wh_config.config_value)
            target_name = wh_data.get("name", "数仓")
        else:
            target_name = "数仓"

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

    source_ds = await get_datasource(db, task.source_datasource_id)
    source_db_type = source_ds.type.value if hasattr(source_ds.type, 'value') else str(source_ds.type)

    # Get target db type
    if task.target_datasource_id:
        target_ds = await get_datasource(db, task.target_datasource_id)
        target_db_type = target_ds.type.value if hasattr(target_ds.type, 'value') else str(target_ds.type)
    else:
        # Get from warehouse config
        wh_result = await db.execute(
            select(SystemConfig).where(SystemConfig.config_key == "warehouse_config")
        )
        wh_config = wh_result.scalar_one_or_none()
        if not wh_config or not wh_config.config_value:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="数仓未配置，请先在系统管理中配置目标数仓"
            )
        import json as json_module
        wh_data = json_module.loads(wh_config.config_value)
        target_db_type = wh_data.get("type", "mysql")

    try:
        source_engine = get_engine_for_datasource(source_ds)

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
    """Request body for executing DDL on warehouse."""
    ddl: str


class GenerateDDLRequest(BaseModel):
    """Request body for generating DDL."""
    source_datasource_id: int
    source_table: str
    source_schema: Optional[str] = None
    target_table: Optional[str] = None
    target_schema: Optional[str] = None


@router.post("/execute-ddl-warehouse", response_model=dict)
async def execute_ddl_on_warehouse(
    request: ExecuteDDLRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Execute DDL on the system warehouse configuration."""
    try:
        warehouse_engine = await get_warehouse_engine(db)

        # Execute DDL
        from sqlalchemy import text
        with warehouse_engine.connect() as conn:
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
        return {
            "success": False,
            "message": f"DDL 执行失败: {str(e)}",
            "table_name": None,
        }


@router.post("/generate-ddl-preview", response_model=AIDDLConvertResponse)
async def generate_ddl_preview(
    request: GenerateDDLRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Generate DDL for a table. If source and target db types are the same, skip AI conversion."""
    source_ds = await get_datasource(db, request.source_datasource_id)

    # Get target db type from warehouse config
    wh_result = await db.execute(
        select(SystemConfig).where(SystemConfig.config_key == "warehouse_config")
    )
    wh_config = wh_result.scalar_one_or_none()
    if not wh_config or not wh_config.config_value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="数仓未配置，请先在系统管理中配置目标数仓"
        )

    import json as json_module
    wh_data = json_module.loads(wh_config.config_value)
    target_db_type = wh_data.get("type", "mysql")
    source_db_type = source_ds.type.value if hasattr(source_ds.type, 'value') else str(source_ds.type)

    try:
        source_engine = get_engine_for_datasource(source_ds)

        # Get table metadata and generate source DDL
        metadata = DatabaseConnector.get_table_metadata(
            source_engine, request.source_table, schema=request.source_schema
        )

        # Build source DDL from metadata
        columns_ddl = []
        type_mappings = []
        for col in metadata.columns:
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
                target_type=col.data_type,  # Same type if no conversion
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
