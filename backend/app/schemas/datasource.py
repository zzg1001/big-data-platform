"""
DataSource schemas.
"""
from datetime import datetime
from typing import Optional, List, Any
from pydantic import BaseModel, Field

from app.models.datasource import DataSourceType


class DataSourceGroupCreate(BaseModel):
    """Schema for creating a datasource group."""
    name: str = Field(..., max_length=100)
    description: Optional[str] = Field(None, max_length=255)


class DataSourceGroupResponse(BaseModel):
    """Schema for datasource group response."""
    id: int
    name: str
    description: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class DataSourceCreate(BaseModel):
    """Schema for creating a datasource."""
    name: str = Field(..., max_length=100)
    type: DataSourceType
    host: str = Field(..., max_length=255)
    port: int = Field(..., ge=1, le=65535)
    database: Optional[str] = Field(None, max_length=100)
    username: str = Field(..., max_length=100)
    password: str = Field(..., max_length=255)
    schema_name: Optional[str] = Field(None, max_length=100)
    service_name: Optional[str] = Field(None, max_length=100)
    extra_params: Optional[str] = None
    group_id: Optional[int] = None
    pool_size: int = Field(default=5, ge=1, le=50)
    max_overflow: int = Field(default=10, ge=0, le=100)
    is_warehouse: bool = False  # 是否为数仓


class DataSourceUpdate(BaseModel):
    """Schema for updating a datasource."""
    name: Optional[str] = Field(None, max_length=100)
    host: Optional[str] = Field(None, max_length=255)
    port: Optional[int] = Field(None, ge=1, le=65535)
    database: Optional[str] = Field(None, max_length=100)
    username: Optional[str] = Field(None, max_length=100)
    password: Optional[str] = Field(None, max_length=255)
    schema_name: Optional[str] = Field(None, max_length=100)
    service_name: Optional[str] = Field(None, max_length=100)
    extra_params: Optional[str] = None
    group_id: Optional[int] = None
    is_active: Optional[bool] = None
    pool_size: Optional[int] = Field(None, ge=1, le=50)
    max_overflow: Optional[int] = Field(None, ge=0, le=100)
    is_warehouse: Optional[bool] = None  # 是否为数仓


class DataSourceResponse(BaseModel):
    """Schema for datasource response."""
    id: int
    name: str
    type: DataSourceType
    host: str
    port: int
    database: str
    username: str
    schema_name: Optional[str] = None
    service_name: Optional[str] = None
    is_active: bool
    is_warehouse: bool = False  # 是否为数仓
    connection_status: str
    last_connected_at: Optional[datetime] = None
    group_id: Optional[int] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class DataSourceTest(BaseModel):
    """Schema for testing datasource connection."""
    type: DataSourceType
    host: str
    port: int
    database: Optional[str] = None
    username: str
    password: str
    schema_name: Optional[str] = None
    service_name: Optional[str] = None


class ColumnMetadata(BaseModel):
    """Schema for column metadata."""
    name: str
    data_type: str
    is_nullable: bool
    is_primary_key: bool = False
    default_value: Optional[str] = None
    comment: Optional[str] = None


class TableMetadata(BaseModel):
    """Schema for table metadata."""
    name: str
    schema_name: Optional[str] = None
    columns: List[ColumnMetadata] = []
    row_count: Optional[int] = None
    comment: Optional[str] = None
