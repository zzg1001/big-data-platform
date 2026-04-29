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
from app.schemas.sync_schedule import (
    SyncScheduleCreate,
    SyncScheduleUpdate,
    SyncScheduleResponse,
    SyncScheduleListItem,
)
from app.services.airflow_service import airflow_service
from app.core.config import settings

router = APIRouter()


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
    """Update a sync schedule."""
    result = await db.execute(
        select(SyncSchedule).where(SyncSchedule.id == schedule_id)
    )
    schedule = result.scalar_one_or_none()
    if not schedule:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Schedule not found"
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

    # Delete DAG from Airflow if exists
    if schedule.dag_id:
        # Try to delete DAG via Airflow API
        try:
            await airflow_service.delete_dag(schedule.dag_id)
        except Exception:
            pass  # Ignore Airflow API errors

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

    await db.delete(schedule)
    await db.flush()


@router.post("/{schedule_id}/enable", response_model=dict)
async def enable_sync_schedule(
    schedule_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Enable a sync schedule - generate DAG and activate."""
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

    # Generate DAG ID
    dag_id = f"sync_schedule_{schedule.id}_{task.source_table.replace('.', '_')}"
    schedule.dag_id = dag_id

    # Generate DAG file content
    dag_content = f'''"""
Auto-generated Airflow DAG for sync schedule: {schedule.name}
Sync Task: {task.name}
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
    description='{schedule.description or schedule.name}',
    schedule_interval='{schedule.cron_expression}',
    start_date=datetime(2024, 1, 1),
    catchup=False,
    is_paused_upon_creation=False,
    tags=['data_sync', 'sync_schedule'],
) as dag:

    sync_task = PythonOperator(
        task_id='execute_sync',
        python_callable=execute_sync,
    )
'''

    # Save DAG file
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
            detail=f"Failed to save DAG file: {str(e)}"
        )

    # Update schedule
    schedule.is_enabled = True
    schedule.airflow_status = "active"

    await db.flush()

    return {
        "success": True,
        "schedule_id": schedule_id,
        "dag_id": dag_id,
        "message": "Schedule enabled successfully"
    }


@router.post("/{schedule_id}/disable", response_model=dict)
async def disable_sync_schedule(
    schedule_id: int,
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

    # Pause DAG in Airflow
    if schedule.dag_id:
        await airflow_service.pause_dag(schedule.dag_id)

    # Update schedule
    schedule.is_enabled = False
    schedule.airflow_status = "paused"

    await db.flush()

    return {
        "success": True,
        "schedule_id": schedule_id,
        "message": "Schedule disabled successfully"
    }
