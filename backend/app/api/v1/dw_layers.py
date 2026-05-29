"""
Data warehouse layer management API.
"""
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.deps import get_current_user
from app.models.user import User
from app.models.dw_layer import DwLayer
from app.models.sync_task import SyncTask
from app.models.etl_task import EtlTask
from app.schemas.dw_layer import (
    DwLayerCreate,
    DwLayerUpdate,
    DwLayerResponse,
    DwLayerListItem,
    DwLayerInitDefaults,
)

router = APIRouter()

# Default layers configuration
DEFAULT_LAYERS = [
    {"name": "ODS", "display_name": "原始数据层", "level": 1, "color": "#8c8c8c", "description": "Operational Data Store - 原始数据同步"},
    {"name": "DW", "display_name": "数据仓库层", "level": 2, "color": "#1890ff", "description": "Data Warehouse - 数据清洗转换"},
    {"name": "DWS", "display_name": "汇总数据层", "level": 3, "color": "#52c41a", "description": "Data Warehouse Summary - 轻度汇总"},
    {"name": "ADS", "display_name": "应用数据层", "level": 4, "color": "#722ed1", "description": "Application Data Store - 业务指标"},
]


@router.get("/", response_model=List[DwLayerListItem])
async def list_layers(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get all DW layers ordered by level."""
    # Get layers with task counts
    result = await db.execute(
        select(DwLayer).order_by(DwLayer.level, DwLayer.id)
    )
    layers = result.scalars().all()

    # Get task counts for each layer
    items = []
    for layer in layers:
        # Count sync tasks
        sync_count_result = await db.execute(
            select(func.count(SyncTask.id)).where(SyncTask.dw_layer_id == layer.id)
        )
        sync_count = sync_count_result.scalar() or 0

        # Count ETL tasks
        etl_count_result = await db.execute(
            select(func.count(EtlTask.id)).where(EtlTask.dw_layer_id == layer.id)
        )
        etl_count = etl_count_result.scalar() or 0

        items.append(DwLayerListItem(
            id=layer.id,
            name=layer.name,
            display_name=layer.display_name,
            description=layer.description,
            level=layer.level,
            color=layer.color,
            sync_task_count=sync_count,
            etl_task_count=etl_count,
        ))

    return items


@router.post("/", response_model=DwLayerResponse, status_code=status.HTTP_201_CREATED)
async def create_layer(
    data: DwLayerCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new DW layer."""
    # Check if name already exists
    existing = await db.execute(
        select(DwLayer).where(DwLayer.name == data.name)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Layer with name '{data.name}' already exists"
        )

    layer = DwLayer(
        **data.model_dump(),
        created_by=current_user.id,
    )
    db.add(layer)
    await db.flush()
    await db.refresh(layer)
    return layer


@router.get("/{layer_id}", response_model=DwLayerResponse)
async def get_layer(
    layer_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a specific DW layer."""
    result = await db.execute(
        select(DwLayer).where(DwLayer.id == layer_id)
    )
    layer = result.scalar_one_or_none()
    if not layer:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Layer not found"
        )
    return layer


@router.put("/{layer_id}", response_model=DwLayerResponse)
async def update_layer(
    layer_id: int,
    data: DwLayerUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update a DW layer."""
    result = await db.execute(
        select(DwLayer).where(DwLayer.id == layer_id)
    )
    layer = result.scalar_one_or_none()
    if not layer:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Layer not found"
        )

    # Check name uniqueness if changing name
    if data.name and data.name != layer.name:
        existing = await db.execute(
            select(DwLayer).where(DwLayer.name == data.name)
        )
        if existing.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Layer with name '{data.name}' already exists"
            )

    # Update fields
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(layer, field, value)

    await db.flush()
    await db.refresh(layer)
    return layer


@router.delete("/{layer_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_layer(
    layer_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a DW layer (only if no tasks are assigned)."""
    result = await db.execute(
        select(DwLayer).where(DwLayer.id == layer_id)
    )
    layer = result.scalar_one_or_none()
    if not layer:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Layer not found"
        )

    # Check if any tasks are using this layer
    sync_count = await db.execute(
        select(func.count(SyncTask.id)).where(SyncTask.dw_layer_id == layer_id)
    )
    etl_count = await db.execute(
        select(func.count(EtlTask.id)).where(EtlTask.dw_layer_id == layer_id)
    )

    total_tasks = (sync_count.scalar() or 0) + (etl_count.scalar() or 0)
    if total_tasks > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot delete layer with {total_tasks} associated tasks. Please reassign tasks first."
        )

    await db.delete(layer)


@router.post("/init-defaults", response_model=DwLayerInitDefaults)
async def init_default_layers(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Initialize default DW layers (ODS, DW, DWS, ADS)."""
    created = []
    skipped = []

    for layer_config in DEFAULT_LAYERS:
        # Check if already exists
        existing = await db.execute(
            select(DwLayer).where(DwLayer.name == layer_config["name"])
        )
        if existing.scalar_one_or_none():
            skipped.append(layer_config["name"])
            continue

        layer = DwLayer(
            **layer_config,
            created_by=current_user.id,
        )
        db.add(layer)
        created.append(layer_config["name"])

    await db.flush()
    return DwLayerInitDefaults(created=created, skipped=skipped)
