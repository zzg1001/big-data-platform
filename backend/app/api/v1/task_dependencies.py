"""
Task dependency management API.
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import select, or_, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.deps import get_current_user
from app.models.user import User
from app.models.task_dependency import TaskDependency
from app.models.sync_task import SyncTask
from app.models.etl_task import EtlTask
from app.models.dw_layer import DwLayer
from app.schemas.task_dependency import (
    TaskDependencyCreate,
    TaskDependencyResponse,
    TaskSearchResult,
    ParseSqlRequest,
    ParseSqlResponse,
)

router = APIRouter()


async def get_task_info(db: AsyncSession, task_type: str, task_id: int) -> dict:
    """Get task name and detail for display."""
    if task_type == "sync":
        result = await db.execute(
            select(SyncTask, DwLayer)
            .outerjoin(DwLayer, SyncTask.dw_layer_id == DwLayer.id)
            .where(SyncTask.id == task_id)
        )
        row = result.first()
        if row:
            task, layer = row
            return {
                "name": task.name,
                "detail": f"{task.source_table} → {task.target_table}",
                "layer_name": layer.display_name if layer else None,
            }
    else:  # etl
        result = await db.execute(
            select(EtlTask, DwLayer)
            .outerjoin(DwLayer, EtlTask.dw_layer_id == DwLayer.id)
            .where(EtlTask.id == task_id)
        )
        row = result.first()
        if row:
            task, layer = row
            return {
                "name": task.name,
                "detail": task.sql_content[:100] + "..." if len(task.sql_content) > 100 else task.sql_content,
                "layer_name": layer.display_name if layer else None,
            }
    return {"name": "Unknown", "detail": "", "layer_name": None}


@router.get("/task/{task_type}/{task_id}", response_model=List[TaskDependencyResponse])
async def get_task_dependencies(
    task_type: str,
    task_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get all dependencies for a specific task."""
    if task_type not in ("sync", "etl"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="task_type must be 'sync' or 'etl'"
        )

    result = await db.execute(
        select(TaskDependency)
        .where(
            and_(
                TaskDependency.task_type == task_type,
                TaskDependency.task_id == task_id,
            )
        )
    )
    dependencies = result.scalars().all()

    # Enrich with upstream task info
    items = []
    for dep in dependencies:
        info = await get_task_info(db, dep.upstream_task_type, dep.upstream_task_id)
        items.append(TaskDependencyResponse(
            id=dep.id,
            task_type=dep.task_type,
            task_id=dep.task_id,
            upstream_task_type=dep.upstream_task_type,
            upstream_task_id=dep.upstream_task_id,
            dependency_type=dep.dependency_type,
            source_table=dep.source_table,
            created_by=dep.created_by,
            created_at=dep.created_at,
            upstream_task_name=info["name"],
            upstream_task_detail=info["detail"],
            upstream_layer_name=info["layer_name"],
        ))

    return items


@router.post("/", response_model=TaskDependencyResponse, status_code=status.HTTP_201_CREATED)
async def create_dependency(
    data: TaskDependencyCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a task dependency."""
    # Validate task_type
    if data.task_type not in ("sync", "etl"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="task_type must be 'sync' or 'etl'"
        )
    if data.upstream_task_type not in ("sync", "etl"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="upstream_task_type must be 'sync' or 'etl'"
        )

    # Prevent self-dependency
    if data.task_type == data.upstream_task_type and data.task_id == data.upstream_task_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A task cannot depend on itself"
        )

    # Check if dependency already exists
    existing = await db.execute(
        select(TaskDependency).where(
            and_(
                TaskDependency.task_type == data.task_type,
                TaskDependency.task_id == data.task_id,
                TaskDependency.upstream_task_type == data.upstream_task_type,
                TaskDependency.upstream_task_id == data.upstream_task_id,
            )
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This dependency already exists"
        )

    # Verify tasks exist
    if data.task_type == "sync":
        task_result = await db.execute(select(SyncTask).where(SyncTask.id == data.task_id))
    else:
        task_result = await db.execute(select(EtlTask).where(EtlTask.id == data.task_id))
    if not task_result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task {data.task_type}:{data.task_id} not found"
        )

    if data.upstream_task_type == "sync":
        upstream_result = await db.execute(select(SyncTask).where(SyncTask.id == data.upstream_task_id))
    else:
        upstream_result = await db.execute(select(EtlTask).where(EtlTask.id == data.upstream_task_id))
    if not upstream_result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Upstream task {data.upstream_task_type}:{data.upstream_task_id} not found"
        )

    dependency = TaskDependency(
        **data.model_dump(),
        created_by=current_user.id,
    )
    db.add(dependency)
    await db.flush()
    await db.refresh(dependency)

    info = await get_task_info(db, dependency.upstream_task_type, dependency.upstream_task_id)
    return TaskDependencyResponse(
        id=dependency.id,
        task_type=dependency.task_type,
        task_id=dependency.task_id,
        upstream_task_type=dependency.upstream_task_type,
        upstream_task_id=dependency.upstream_task_id,
        dependency_type=dependency.dependency_type,
        source_table=dependency.source_table,
        created_by=dependency.created_by,
        created_at=dependency.created_at,
        upstream_task_name=info["name"],
        upstream_task_detail=info["detail"],
        upstream_layer_name=info["layer_name"],
    )


@router.delete("/{dependency_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_dependency(
    dependency_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a task dependency."""
    result = await db.execute(
        select(TaskDependency).where(TaskDependency.id == dependency_id)
    )
    dependency = result.scalar_one_or_none()
    if not dependency:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Dependency not found"
        )

    await db.delete(dependency)


@router.get("/search-tasks", response_model=List[TaskSearchResult])
async def search_tasks(
    q: str = Query(..., min_length=1, description="Search query"),
    exclude_type: Optional[str] = Query(None, description="Task type to exclude"),
    exclude_id: Optional[int] = Query(None, description="Task ID to exclude"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Search tasks for dependency selection."""
    results = []
    search_pattern = f"%{q}%"

    # Search sync tasks
    if exclude_type != "sync" or exclude_id is None:
        sync_query = (
            select(SyncTask, DwLayer)
            .outerjoin(DwLayer, SyncTask.dw_layer_id == DwLayer.id)
            .where(
                or_(
                    SyncTask.name.ilike(search_pattern),
                    SyncTask.source_table.ilike(search_pattern),
                    SyncTask.target_table.ilike(search_pattern),
                )
            )
            .limit(20)
        )
        if exclude_type == "sync" and exclude_id:
            sync_query = sync_query.where(SyncTask.id != exclude_id)

        sync_result = await db.execute(sync_query)
        for task, layer in sync_result.all():
            results.append(TaskSearchResult(
                task_type="sync",
                task_id=task.id,
                name=task.name,
                detail=f"{task.source_table} → {task.target_table}",
                layer_id=layer.id if layer else None,
                layer_name=layer.display_name if layer else None,
                layer_color=layer.color if layer else None,
                is_scheduled=task.is_scheduled,
            ))

    # Search ETL tasks
    if exclude_type != "etl" or exclude_id is None:
        etl_query = (
            select(EtlTask, DwLayer)
            .outerjoin(DwLayer, EtlTask.dw_layer_id == DwLayer.id)
            .where(
                or_(
                    EtlTask.name.ilike(search_pattern),
                    EtlTask.sql_content.ilike(search_pattern),
                )
            )
            .limit(20)
        )
        if exclude_type == "etl" and exclude_id:
            etl_query = etl_query.where(EtlTask.id != exclude_id)

        etl_result = await db.execute(etl_query)
        for task, layer in etl_result.all():
            sql_preview = task.sql_content[:80] + "..." if len(task.sql_content) > 80 else task.sql_content
            results.append(TaskSearchResult(
                task_type="etl",
                task_id=task.id,
                name=task.name,
                detail=sql_preview,
                layer_id=layer.id if layer else None,
                layer_name=layer.display_name if layer else None,
                layer_color=layer.color if layer else None,
                is_scheduled=task.is_scheduled,
            ))

    return results[:30]  # Limit total results


@router.post("/parse-sql", response_model=ParseSqlResponse)
async def parse_sql_dependencies(
    data: ParseSqlRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Parse SQL to extract table dependencies and match with existing tasks."""
    import re

    sql = data.sql_content.upper()

    # Simple regex to find table names after FROM, JOIN, INTO
    # This is a basic implementation - could be enhanced with proper SQL parsing
    table_pattern = r'(?:FROM|JOIN|INTO)\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?)'
    matches = re.findall(table_pattern, sql, re.IGNORECASE)

    # Extract unique table names (lowercase for matching)
    source_tables = list(set([m.lower() for m in matches]))

    # Try to detect target table (INSERT INTO, CREATE TABLE)
    target_pattern = r'(?:INSERT\s+INTO|CREATE\s+TABLE)\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?)'
    target_match = re.search(target_pattern, sql, re.IGNORECASE)
    target_table = target_match.group(1).lower() if target_match else None

    # Remove target from source if present
    if target_table and target_table in source_tables:
        source_tables.remove(target_table)

    # Match tables with sync tasks (by target_table)
    matched_tasks = []
    unmatched_tables = []

    for table in source_tables:
        # Search in sync tasks
        sync_result = await db.execute(
            select(SyncTask, DwLayer)
            .outerjoin(DwLayer, SyncTask.dw_layer_id == DwLayer.id)
            .where(SyncTask.target_table.ilike(f"%{table}%"))
        )
        sync_matches = sync_result.all()

        if sync_matches:
            for task, layer in sync_matches:
                matched_tasks.append(TaskSearchResult(
                    task_type="sync",
                    task_id=task.id,
                    name=task.name,
                    detail=f"{task.source_table} → {task.target_table}",
                    layer_id=layer.id if layer else None,
                    layer_name=layer.display_name if layer else None,
                    layer_color=layer.color if layer else None,
                    is_scheduled=task.is_scheduled,
                ))
        else:
            # Search in ETL tasks (check if any ETL produces this table)
            # This is harder without proper SQL parsing of ETL output
            unmatched_tables.append(table)

    return ParseSqlResponse(
        source_tables=source_tables,
        target_table=target_table,
        matched_tasks=matched_tasks,
        unmatched_tables=unmatched_tables,
    )
