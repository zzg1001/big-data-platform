"""
Warehouse data exploration API endpoints.
"""
import json
import time
from typing import List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import decrypt_password
from app.api.deps import get_current_user
from app.models.user import User
from app.models.system_config import SystemConfig
from app.models.datasource import DataSourceType
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
            detail="平台数据库未配置，请先在系统管理中配置目标平台数据库"
        )

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


class WarehouseExecuteResult(BaseModel):
    """Response schema for warehouse SQL execution (supports all SQL types)."""
    columns: List[str]
    rows: List[List]
    row_count: int
    affected_rows: Optional[int] = None
    execution_time_ms: float
    has_more: bool = False
    sql_type: str = "SELECT"  # SELECT, INSERT, UPDATE, DELETE, DDL


@router.post("/query", response_model=WarehouseExecuteResult)
async def execute_warehouse_query(
    query_data: WarehouseQueryRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Execute a SQL statement on the warehouse (supports SELECT, INSERT, UPDATE, DELETE, DDL)."""
    engine, config = await get_warehouse_engine(db)

    try:
        start_time = time.time()

        sql = query_data.sql.strip()
        sql_upper = sql.upper()

        # Determine SQL type
        if sql_upper.startswith("SELECT"):
            sql_type = "SELECT"
        elif sql_upper.startswith("INSERT"):
            sql_type = "INSERT"
        elif sql_upper.startswith("UPDATE"):
            sql_type = "UPDATE"
        elif sql_upper.startswith("DELETE"):
            sql_type = "DELETE"
        elif sql_upper.startswith(("CREATE", "DROP", "ALTER", "TRUNCATE")):
            sql_type = "DDL"
        else:
            sql_type = "OTHER"

        with engine.connect() as conn:
            result = conn.execute(text(sql))

            if sql_type == "SELECT":
                # SELECT query - return result set
                columns = list(result.keys())
                all_rows = result.fetchmany(query_data.limit + 1)
                has_more = len(all_rows) > query_data.limit
                rows = all_rows[:query_data.limit]
                rows_data = [list(row) for row in rows]
                affected_rows = None
            else:
                # DML/DDL - commit and return affected rows
                conn.commit()
                columns = []
                rows_data = []
                has_more = False
                affected_rows = result.rowcount if result.rowcount >= 0 else 0

        execution_time_ms = (time.time() - start_time) * 1000

        return WarehouseExecuteResult(
            columns=columns,
            rows=rows_data,
            row_count=len(rows_data),
            affected_rows=affected_rows,
            execution_time_ms=round(execution_time_ms, 2),
            has_more=has_more,
            sql_type=sql_type,
        )
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        import logging
        logging.error(f"Warehouse query failed: {str(e)}\nSQL: {query_data.sql}\nTraceback: {traceback.format_exc()}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"SQL执行失败: {str(e)}"
        )
