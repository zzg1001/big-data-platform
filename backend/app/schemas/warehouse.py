"""
Warehouse configuration schemas.
"""
from typing import Optional
from pydantic import BaseModel, Field


class WarehouseConfigUpdate(BaseModel):
    """Request for updating warehouse configuration."""
    name: str = Field(..., max_length=100, description="平台数据库名称")
    type: str = Field(..., description="数据库类型: mysql, postgresql, hive, clickhouse, etc.")
    host: str = Field(..., max_length=255)
    port: int = Field(..., ge=1, le=65535)
    database: str = Field(..., max_length=200)
    username: str = Field(..., max_length=100)
    password: Optional[str] = Field(None, description="密码，留空则不修改")
    schema_name: Optional[str] = Field(None, max_length=100)
    extra_params: Optional[str] = Field(None, description="额外连接参数")


class WarehouseConfigResponse(BaseModel):
    """Response for warehouse configuration."""
    configured: bool = False
    name: Optional[str] = None
    type: Optional[str] = None
    host: Optional[str] = None
    port: Optional[int] = None
    database: Optional[str] = None
    username: Optional[str] = None
    schema_name: Optional[str] = None
    extra_params: Optional[str] = None
    # 不返回密码


class WarehouseTestResult(BaseModel):
    """Result of warehouse connection test."""
    success: bool
    message: str
