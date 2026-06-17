"""
Schedule management API endpoints.
"""
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.deps import get_current_user
from app.models.user import User
from app.models.datasource import DataSource
from app.models.schedule import Schedule, ScheduleStatus, ScheduleLog
from app.schemas.schedule import (
    ScheduleCreate,
    ScheduleUpdate,
    ScheduleResponse,
    ScheduleLogResponse,
)
from app.services.dag_generator import DAGGenerator
from app.services.airflow_service import AirflowService

router = APIRouter()


@router.post("/", response_model=ScheduleResponse, status_code=status.HTTP_201_CREATED)
async def create_schedule(
    schedule_data: ScheduleCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new schedule."""
    dag_generator = DAGGenerator()
    dag_id = dag_generator.sanitize_dag_id(schedule_data.name)

    # Check if DAG ID already exists
    result = await db.execute(select(Schedule).where(Schedule.dag_id == dag_id))
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Schedule with DAG ID '{dag_id}' already exists",
        )

    schedule = Schedule(
        name=schedule_data.name,
        description=schedule_data.description,
        dag_id=dag_id,
        cron_expression=schedule_data.cron_expression,
        sql_content=schedule_data.sql_content,
        datasource_id=schedule_data.datasource_id,
        dependencies=str(schedule_data.dependencies) if schedule_data.dependencies else None,
        alert_email=schedule_data.alert_email,
        alert_on_failure=schedule_data.alert_on_failure,
        alert_on_success=schedule_data.alert_on_success,
        status=ScheduleStatus.DRAFT,
        created_by=current_user.id,
    )
    db.add(schedule)
    await db.flush()
    await db.refresh(schedule)
    return schedule


@router.get("/", response_model=List[ScheduleResponse])
async def list_schedules(
    status_filter: ScheduleStatus = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all schedules."""
    query = select(Schedule)
    if status_filter:
        query = query.where(Schedule.status == status_filter)
    query = query.order_by(Schedule.created_at.desc())

    result = await db.execute(query)
    return list(result.scalars().all())


@router.get("/{schedule_id}", response_model=ScheduleResponse)
async def get_schedule(
    schedule_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get schedule by ID."""
    result = await db.execute(select(Schedule).where(Schedule.id == schedule_id))
    schedule = result.scalar_one_or_none()
    if not schedule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Schedule not found")
    return schedule


@router.put("/{schedule_id}", response_model=ScheduleResponse)
async def update_schedule(
    schedule_id: int,
    schedule_data: ScheduleUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update a schedule."""
    result = await db.execute(select(Schedule).where(Schedule.id == schedule_id))
    schedule = result.scalar_one_or_none()
    if not schedule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Schedule not found")

    update_data = schedule_data.model_dump(exclude_unset=True)

    if "dependencies" in update_data:
        update_data["dependencies"] = str(update_data["dependencies"]) if update_data["dependencies"] else None

    for field, value in update_data.items():
        setattr(schedule, field, value)

    await db.flush()
    await db.refresh(schedule)
    return schedule


@router.delete("/{schedule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_schedule(
    schedule_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a schedule."""
    result = await db.execute(select(Schedule).where(Schedule.id == schedule_id))
    schedule = result.scalar_one_or_none()
    if not schedule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Schedule not found")

    # Remove DAG file if deployed
    if schedule.is_deployed:
        try:
            dag_generator = DAGGenerator()
            dag_generator.remove_dag(schedule.dag_id)
        except Exception:
            pass  # 忽略DAG删除错误，继续删除数据库记录

    await db.delete(schedule)
    await db.flush()


@router.post("/{schedule_id}/generate-dag", response_model=dict)
async def generate_dag(
    schedule_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Generate DAG code for a schedule."""
    result = await db.execute(select(Schedule).where(Schedule.id == schedule_id))
    schedule = result.scalar_one_or_none()
    if not schedule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Schedule not found")

    # Get datasource for connection ID
    conn_id = "default_conn"
    if schedule.datasource_id:
        ds_result = await db.execute(
            select(DataSource).where(DataSource.id == schedule.datasource_id)
        )
        datasource = ds_result.scalar_one_or_none()
        if datasource:
            conn_id = f"{datasource.type.value}_{datasource.id}"

    dag_generator = DAGGenerator()
    dependencies = eval(schedule.dependencies) if schedule.dependencies else None

    dag_code = dag_generator.generate_sql_dag(
        name=schedule.name,
        description=schedule.description or "",
        sql_content=schedule.sql_content or "",
        conn_id=conn_id,
        schedule_interval=schedule.cron_expression,
        alert_email=schedule.alert_email,
        dependencies=dependencies,
    )

    # Store DAG code
    schedule.dag_code = dag_code
    await db.flush()

    return {"dag_id": schedule.dag_id, "dag_code": dag_code}


@router.post("/{schedule_id}/deploy", response_model=ScheduleResponse)
async def deploy_schedule(
    schedule_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Deploy schedule to Airflow."""
    result = await db.execute(select(Schedule).where(Schedule.id == schedule_id))
    schedule = result.scalar_one_or_none()
    if not schedule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Schedule not found")

    if not schedule.dag_code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="DAG code not generated. Call /generate-dag first.",
        )

    dag_generator = DAGGenerator()
    try:
        dag_generator.deploy_dag(schedule.dag_id, schedule.dag_code)
        schedule.is_deployed = True
        schedule.status = ScheduleStatus.ACTIVE
        await db.flush()
        await db.refresh(schedule)
        return schedule
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.post("/{schedule_id}/pause", response_model=ScheduleResponse)
async def pause_schedule(
    schedule_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Pause a schedule (下线调度任务)."""
    result = await db.execute(select(Schedule).where(Schedule.id == schedule_id))
    schedule = result.scalar_one_or_none()
    if not schedule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Schedule not found")

    # 调用 Airflow API 暂停 DAG
    if schedule.dag_id:
        airflow_service = AirflowService()
        success = await airflow_service.pause_dag(schedule.dag_id)
        if not success:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Airflow API 调用失败，无法暂停 DAG: {schedule.dag_id}"
            )

    schedule.status = ScheduleStatus.PAUSED
    await db.commit()
    await db.refresh(schedule)
    return schedule


@router.post("/{schedule_id}/resume", response_model=ScheduleResponse)
async def resume_schedule(
    schedule_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Resume a paused schedule (上线调度任务)."""
    result = await db.execute(select(Schedule).where(Schedule.id == schedule_id))
    schedule = result.scalar_one_or_none()
    if not schedule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Schedule not found")

    if not schedule.is_deployed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Schedule not deployed",
        )

    # 调用 Airflow API 恢复 DAG
    if schedule.dag_id:
        airflow_service = AirflowService()
        success = await airflow_service.unpause_dag(schedule.dag_id)
        if not success:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Airflow API 调用失败，无法恢复 DAG: {schedule.dag_id}"
            )

    schedule.status = ScheduleStatus.ACTIVE
    await db.commit()
    await db.refresh(schedule)
    return schedule


@router.get("/{schedule_id}/logs", response_model=List[ScheduleLogResponse])
async def get_schedule_logs(
    schedule_id: int,
    limit: int = 50,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get execution logs for a schedule."""
    result = await db.execute(
        select(ScheduleLog)
        .where(ScheduleLog.schedule_id == schedule_id)
        .order_by(ScheduleLog.started_at.desc())
        .limit(limit)
    )
    return list(result.scalars().all())
