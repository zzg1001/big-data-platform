"""
System configuration API endpoints.
"""
import json
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import encrypt_password, decrypt_password
from app.api.deps import get_current_user
from app.models.user import User
from app.models.system_config import SystemConfig
from app.schemas.warehouse import WarehouseConfigUpdate, WarehouseConfigResponse, WarehouseTestResult
from app.services.db_connector import DatabaseConnector

router = APIRouter()

WAREHOUSE_CONFIG_KEY = "warehouse_config"


@router.get("/warehouse", response_model=WarehouseConfigResponse)
async def get_warehouse_config(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get current warehouse configuration."""
    result = await db.execute(
        select(SystemConfig).where(SystemConfig.config_key == WAREHOUSE_CONFIG_KEY)
    )
    config = result.scalar_one_or_none()

    if not config or not config.config_value:
        return WarehouseConfigResponse(configured=False)

    try:
        data = json.loads(config.config_value)
        return WarehouseConfigResponse(
            configured=True,
            name=data.get("name"),
            type=data.get("type"),
            host=data.get("host"),
            port=data.get("port"),
            database=data.get("database"),
            username=data.get("username"),
            schema_name=data.get("schema_name"),
            extra_params=data.get("extra_params"),
        )
    except (json.JSONDecodeError, TypeError):
        return WarehouseConfigResponse(configured=False)


@router.put("/warehouse", response_model=WarehouseConfigResponse)
async def set_warehouse_config(
    request: WarehouseConfigUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Set warehouse configuration."""
    # Get existing config
    result = await db.execute(
        select(SystemConfig).where(SystemConfig.config_key == WAREHOUSE_CONFIG_KEY)
    )
    config = result.scalar_one_or_none()

    # Prepare data
    config_data = {
        "name": request.name,
        "type": request.type,
        "host": request.host,
        "port": request.port,
        "database": request.database,
        "username": request.username,
        "schema_name": request.schema_name,
        "extra_params": request.extra_params,
    }

    # Handle password
    if request.password:
        # Encrypt and store new password
        config_data["encrypted_password"] = encrypt_password(request.password)
    elif config and config.config_value:
        # Keep existing password
        try:
            existing = json.loads(config.config_value)
            if "encrypted_password" in existing:
                config_data["encrypted_password"] = existing["encrypted_password"]
        except (json.JSONDecodeError, TypeError):
            pass

    if config:
        config.config_value = json.dumps(config_data)
    else:
        config = SystemConfig(
            config_key=WAREHOUSE_CONFIG_KEY,
            config_value=json.dumps(config_data),
            description="数据仓库/数据湖连接配置"
        )
        db.add(config)

    await db.flush()

    return WarehouseConfigResponse(
        configured=True,
        name=request.name,
        type=request.type,
        host=request.host,
        port=request.port,
        database=request.database,
        username=request.username,
        schema_name=request.schema_name,
        extra_params=request.extra_params,
    )


@router.post("/warehouse/test", response_model=WarehouseTestResult)
async def test_warehouse_connection(
    request: WarehouseConfigUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Test warehouse connection without saving."""
    # If no password provided, try to get from existing config
    password = request.password
    if not password:
        result = await db.execute(
            select(SystemConfig).where(SystemConfig.config_key == WAREHOUSE_CONFIG_KEY)
        )
        config = result.scalar_one_or_none()
        if config and config.config_value:
            try:
                existing = json.loads(config.config_value)
                if "encrypted_password" in existing:
                    password = decrypt_password(existing["encrypted_password"])
            except (json.JSONDecodeError, TypeError):
                pass

    if not password:
        return WarehouseTestResult(success=False, message="请输入密码")

    result = DatabaseConnector.test_connection(
        db_type=request.type,
        host=request.host,
        port=request.port,
        database=request.database,
        username=request.username,
        password=password,
        schema_name=request.schema_name,
    )
    return WarehouseTestResult(**result)


@router.delete("/warehouse", status_code=status.HTTP_204_NO_CONTENT)
async def clear_warehouse_config(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Clear warehouse configuration."""
    result = await db.execute(
        select(SystemConfig).where(SystemConfig.config_key == WAREHOUSE_CONFIG_KEY)
    )
    config = result.scalar_one_or_none()

    if config:
        await db.delete(config)
        await db.flush()


def get_warehouse_connection_info(config_value: str) -> dict:
    """Helper to extract warehouse connection info from config."""
    try:
        data = json.loads(config_value)
        return {
            "type": data.get("type"),
            "host": data.get("host"),
            "port": data.get("port"),
            "database": data.get("database"),
            "username": data.get("username"),
            "password": decrypt_password(data.get("encrypted_password", "")),
            "schema_name": data.get("schema_name"),
        }
    except (json.JSONDecodeError, TypeError):
        return {}
