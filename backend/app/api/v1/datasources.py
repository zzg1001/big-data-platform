"""
Data source management API endpoints.
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import encrypt_password, decrypt_password
from app.api.deps import get_current_user
from app.models.user import User
from app.models.datasource import DataSource, DataSourceGroup
from app.schemas.datasource import (
    DataSourceCreate,
    DataSourceUpdate,
    DataSourceResponse,
    DataSourceTest,
    DataSourceGroupCreate,
    DataSourceGroupResponse,
    TableMetadata,
)
from app.services.db_connector import DatabaseConnector

router = APIRouter()


# Data Source Groups
@router.post("/groups", response_model=DataSourceGroupResponse, status_code=status.HTTP_201_CREATED)
async def create_group(
    group_data: DataSourceGroupCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new datasource group."""
    group = DataSourceGroup(**group_data.model_dump())
    db.add(group)
    await db.flush()
    await db.refresh(group)
    return group


@router.get("/groups", response_model=List[DataSourceGroupResponse])
async def list_groups(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all datasource groups."""
    result = await db.execute(select(DataSourceGroup).order_by(DataSourceGroup.name))
    return list(result.scalars().all())


# Data Sources
@router.post("/", response_model=DataSourceResponse, status_code=status.HTTP_201_CREATED)
async def create_datasource(
    ds_data: DataSourceCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new datasource."""
    # Encrypt password
    encrypted_pwd = encrypt_password(ds_data.password)

    datasource = DataSource(
        name=ds_data.name,
        type=ds_data.type,
        host=ds_data.host,
        port=ds_data.port,
        database=ds_data.database,
        username=ds_data.username,
        encrypted_password=encrypted_pwd,
        schema_name=ds_data.schema_name,
        service_name=ds_data.service_name,
        extra_params=ds_data.extra_params,
        group_id=ds_data.group_id,
        pool_size=ds_data.pool_size,
        max_overflow=ds_data.max_overflow,
        is_warehouse=ds_data.is_warehouse,
        created_by=current_user.id,
    )
    db.add(datasource)
    await db.flush()
    await db.refresh(datasource)
    return datasource


@router.get("/", response_model=dict)
async def list_datasources(
    group_id: Optional[int] = None,
    is_warehouse: Optional[bool] = None,
    keyword: Optional[str] = Query(None, description="搜索关键词"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(20, ge=1, le=100, description="每页数量"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    List datasources with pagination.
    """
    # 构建查询
    query = select(DataSource).where(DataSource.is_active == True)
    count_query = select(func.count(DataSource.id)).where(DataSource.is_active == True)

    if group_id:
        query = query.where(DataSource.group_id == group_id)
        count_query = count_query.where(DataSource.group_id == group_id)

    if is_warehouse is not None:
        query = query.where(DataSource.is_warehouse == is_warehouse)
        count_query = count_query.where(DataSource.is_warehouse == is_warehouse)

    if keyword:
        keyword_filter = f"%{keyword}%"
        query = query.where(
            (DataSource.name.like(keyword_filter)) |
            (DataSource.host.like(keyword_filter)) |
            (DataSource.database.like(keyword_filter))
        )
        count_query = count_query.where(
            (DataSource.name.like(keyword_filter)) |
            (DataSource.host.like(keyword_filter)) |
            (DataSource.database.like(keyword_filter))
        )

    # 获取总数
    total_result = await db.execute(count_query)
    total = total_result.scalar()

    # 分页查询
    offset = (page - 1) * page_size
    query = query.order_by(DataSource.name).offset(offset).limit(page_size)

    result = await db.execute(query)
    items = list(result.scalars().all())

    return {
        "items": [DataSourceResponse.model_validate(item).model_dump() for item in items],
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": (total + page_size - 1) // page_size if total > 0 else 0,
    }


@router.get("/all", response_model=List[DataSourceResponse])
async def list_all_datasources(
    is_warehouse: Optional[bool] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    获取所有数据源（不分页，用于下拉选择等场景）。
    为了性能，只返回基本字段。
    """
    query = select(DataSource).where(DataSource.is_active == True)

    if is_warehouse is not None:
        query = query.where(DataSource.is_warehouse == is_warehouse)

    query = query.order_by(DataSource.name)

    result = await db.execute(query)
    return list(result.scalars().all())


@router.get("/{datasource_id}", response_model=DataSourceResponse)
async def get_datasource(
    datasource_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get datasource by ID."""
    result = await db.execute(select(DataSource).where(DataSource.id == datasource_id))
    datasource = result.scalar_one_or_none()
    if not datasource:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Datasource not found")
    return datasource


@router.put("/{datasource_id}", response_model=DataSourceResponse)
async def update_datasource(
    datasource_id: int,
    ds_data: DataSourceUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update datasource."""
    result = await db.execute(select(DataSource).where(DataSource.id == datasource_id))
    datasource = result.scalar_one_or_none()
    if not datasource:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Datasource not found")

    update_data = ds_data.model_dump(exclude_unset=True)

    # Encrypt password if provided
    if "password" in update_data:
        update_data["encrypted_password"] = encrypt_password(update_data.pop("password"))

    for field, value in update_data.items():
        setattr(datasource, field, value)

    # Remove cached engine if connection params changed
    DatabaseConnector.remove_engine(datasource_id)

    await db.flush()
    await db.refresh(datasource)
    return datasource


@router.delete("/{datasource_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_datasource(
    datasource_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete datasource (soft delete)."""
    result = await db.execute(select(DataSource).where(DataSource.id == datasource_id))
    datasource = result.scalar_one_or_none()
    if not datasource:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Datasource not found")

    datasource.is_active = False
    DatabaseConnector.remove_engine(datasource_id)
    await db.flush()


@router.post("/{datasource_id}/set-default", response_model=DataSourceResponse)
async def set_default_datasource(
    datasource_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Set a datasource as the default."""
    # 先取消所有数据源的默认状态
    await db.execute(
        select(DataSource).where(DataSource.is_default == True)
    )
    result = await db.execute(select(DataSource).where(DataSource.is_active == True))
    all_datasources = result.scalars().all()
    for ds in all_datasources:
        ds.is_default = False

    # 设置指定数据源为默认
    result = await db.execute(select(DataSource).where(DataSource.id == datasource_id))
    datasource = result.scalar_one_or_none()
    if not datasource:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Datasource not found")

    datasource.is_default = True
    await db.flush()
    await db.refresh(datasource)
    return datasource


@router.post("/test", response_model=dict)
async def test_connection(
    test_data: DataSourceTest,
    current_user: User = Depends(get_current_user),
):
    """Test datasource connection without saving."""
    result = DatabaseConnector.test_connection(
        db_type=test_data.type,
        host=test_data.host,
        port=test_data.port,
        database=test_data.database,
        username=test_data.username,
        password=test_data.password,
        schema_name=test_data.schema_name,
        service_name=test_data.service_name,
    )
    return result


@router.post("/{datasource_id}/test", response_model=dict)
async def test_saved_connection(
    datasource_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Test saved datasource connection."""
    result = await db.execute(select(DataSource).where(DataSource.id == datasource_id))
    datasource = result.scalar_one_or_none()
    if not datasource:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Datasource not found")

    password = decrypt_password(datasource.encrypted_password)
    test_result = DatabaseConnector.test_connection(
        db_type=datasource.type,
        host=datasource.host,
        port=datasource.port,
        database=datasource.database,
        username=datasource.username,
        password=password,
        schema_name=datasource.schema_name,
        service_name=datasource.service_name,
    )

    # Update connection status
    from datetime import datetime
    datasource.connection_status = "connected" if test_result["success"] else "failed"
    if test_result["success"]:
        datasource.last_connected_at = datetime.utcnow()
    await db.flush()

    return test_result


@router.get("/{datasource_id}/tables", response_model=List[str])
async def get_tables(
    datasource_id: int,
    schema: str = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get list of tables from datasource."""
    result = await db.execute(select(DataSource).where(DataSource.id == datasource_id))
    datasource = result.scalar_one_or_none()
    if not datasource:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Datasource not found")

    try:
        engine = DatabaseConnector.get_engine(
            datasource_id=datasource.id,
            db_type=datasource.type,
            host=datasource.host,
            port=datasource.port,
            database=datasource.database,
            username=datasource.username,
            encrypted_password=datasource.encrypted_password,
            schema_name=datasource.schema_name,
            service_name=datasource.service_name,
            pool_size=datasource.pool_size,
            max_overflow=datasource.max_overflow,
        )
        tables = DatabaseConnector.get_tables(engine, schema=schema or datasource.schema_name)
        return tables
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get("/{datasource_id}/tables/{table_name}", response_model=TableMetadata)
async def get_table_metadata(
    datasource_id: int,
    table_name: str,
    schema: str = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get metadata for a specific table."""
    result = await db.execute(select(DataSource).where(DataSource.id == datasource_id))
    datasource = result.scalar_one_or_none()
    if not datasource:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Datasource not found")

    try:
        engine = DatabaseConnector.get_engine(
            datasource_id=datasource.id,
            db_type=datasource.type,
            host=datasource.host,
            port=datasource.port,
            database=datasource.database,
            username=datasource.username,
            encrypted_password=datasource.encrypted_password,
            schema_name=datasource.schema_name,
            service_name=datasource.service_name,
            pool_size=datasource.pool_size,
            max_overflow=datasource.max_overflow,
        )
        metadata = DatabaseConnector.get_table_metadata(
            engine, table_name, schema=schema or datasource.schema_name
        )
        return metadata
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
