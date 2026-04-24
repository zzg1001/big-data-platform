"""
Warehouse data exploration API endpoints.
"""
import json
import time
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import decrypt_password
from app.api.deps import get_current_user
from app.models.user import User
from app.models.system_config import SystemConfig
from app.services.db_connector import DatabaseConnector


class WarehouseQueryRequest(BaseModel):
    """Request schema for warehouse query execution."""
    sql: str
    limit: int = Field(default=1000, ge=1, le=10000)
    offset: int = Field(default=0, ge=0)


class WarehouseQueryResult(BaseModel):
    """Response schema for warehouse query execution."""
    columns: List[str]
    rows: List[List]
    row_count: int
    execution_time_ms: float
    has_more: bool = False

router = APIRouter()


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
        datasource_id=-1,
        db_type=data.get("type"),
        host=data.get("host"),
        port=data.get("port"),
        database=data.get("database"),
        username=data.get("username"),
        encrypted_password=data.get("encrypted_password"),
        schema_name=data.get("schema_name"),
        pool_size=5,
        max_overflow=10,
    ), data


@router.get("/tables", response_model=List[str])
async def list_warehouse_tables(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all tables in the warehouse."""
    engine, config = await get_warehouse_engine(db)

    try:
        tables = DatabaseConnector.get_tables(engine, schema=config.get("schema_name"))
        return tables
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"获取表列表失败: {str(e)}"
        )


@router.get("/tables/{table_name}")
async def get_warehouse_table_metadata(
    table_name: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get table metadata (columns, types, etc.)."""
    engine, config = await get_warehouse_engine(db)

    try:
        metadata = DatabaseConnector.get_table_metadata(
            engine, table_name, schema=config.get("schema_name")
        )
        return {
            "table_name": table_name,
            "columns": [
                {
                    "name": col.name,
                    "data_type": col.data_type,
                    "is_nullable": col.is_nullable,
                    "is_primary_key": col.is_primary_key,
                    "default_value": col.default_value,
                    "comment": col.comment,
                }
                for col in metadata.columns
            ],
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"获取表结构失败: {str(e)}"
        )


@router.get("/tables/{table_name}/preview")
async def preview_warehouse_table_data(
    table_name: str,
    limit: int = 100,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Preview table data."""
    if limit > 1000:
        limit = 1000

    engine, config = await get_warehouse_engine(db)
    schema_name = config.get("schema_name")

    try:
        # Build full table name
        if schema_name:
            full_table_name = f"{schema_name}.{table_name}"
        else:
            full_table_name = table_name

        # Get row count
        count_sql = f"SELECT COUNT(*) FROM {full_table_name}"

        # Get data
        data_sql = f"SELECT * FROM {full_table_name} LIMIT {limit}"

        with engine.connect() as conn:
            # Get total count
            count_result = conn.execute(text(count_sql))
            total = count_result.scalar()

            # Get data
            data_result = conn.execute(text(data_sql))
            columns = list(data_result.keys())
            rows = [dict(zip(columns, row)) for row in data_result.fetchall()]

        return {
            "table_name": table_name,
            "columns": columns,
            "rows": rows,
            "total": total,
            "limit": limit,
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"获取表数据失败: {str(e)}"
        )


@router.post("/query", response_model=WarehouseQueryResult)
async def execute_warehouse_query(
    query_data: WarehouseQueryRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Execute a SQL query on the warehouse."""
    engine, config = await get_warehouse_engine(db)

    try:
        start_time = time.time()

        sql = query_data.sql.strip()

        # Add LIMIT if not present (for safety)
        sql_upper = sql.upper()
        if not sql_upper.startswith("SELECT"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="只支持 SELECT 查询"
            )

        with engine.connect() as conn:
            result = conn.execute(text(sql))
            columns = list(result.keys())

            # Fetch with limit
            all_rows = result.fetchmany(query_data.limit + 1)
            has_more = len(all_rows) > query_data.limit
            rows = all_rows[:query_data.limit]

            # Convert to list of lists
            rows_data = [list(row) for row in rows]

        execution_time_ms = (time.time() - start_time) * 1000

        return WarehouseQueryResult(
            columns=columns,
            rows=rows_data,
            row_count=len(rows_data),
            execution_time_ms=round(execution_time_ms, 2),
            has_more=has_more,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"查询执行失败: {str(e)}"
        )
