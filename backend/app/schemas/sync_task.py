"""
Sync task schemas.
"""
from datetime import datetime
from typing import Optional, List, Dict
from pydantic import BaseModel, Field

from app.models.sync_task import SyncMode, SyncStatus


class SyncTaskCreate(BaseModel):
    """Schema for creating a sync task."""
    name: str = Field(..., max_length=100)
    description: Optional[str] = Field(None, max_length=500)

    # 源配置
    source_datasource_id: int
    source_table: str = Field(..., max_length=200)
    source_schema: Optional[str] = Field(None, max_length=100)

    # 目标配置（使用系统配置的数仓，target_datasource_id 可选）
    target_datasource_id: Optional[int] = None  # 为空时使用系统数仓配置
    target_table: str = Field(..., max_length=200)
    target_schema: Optional[str] = Field(None, max_length=100)

    # 同步配置
    sync_mode: SyncMode = SyncMode.FULL
    incremental_column: Optional[str] = Field(None, max_length=100)
    where_condition: Optional[str] = None
    column_mapping: Optional[Dict[str, str]] = None
    selected_columns: Optional[List[str]] = None

    # 调度配置
    cron_expression: Optional[str] = Field(None, max_length=100)
    is_scheduled: bool = False


class SyncTaskUpdate(BaseModel):
    """Schema for updating a sync task."""
    name: Optional[str] = Field(None, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    source_table: Optional[str] = Field(None, max_length=200)
    source_schema: Optional[str] = Field(None, max_length=100)
    target_table: Optional[str] = Field(None, max_length=200)
    target_schema: Optional[str] = Field(None, max_length=100)
    sync_mode: Optional[SyncMode] = None
    incremental_column: Optional[str] = Field(None, max_length=100)
    where_condition: Optional[str] = None
    column_mapping: Optional[Dict[str, str]] = None
    selected_columns: Optional[List[str]] = None
    cron_expression: Optional[str] = Field(None, max_length=100)
    is_scheduled: Optional[bool] = None
    status: Optional[SyncStatus] = None


class SyncTaskResponse(BaseModel):
    """Schema for sync task response."""
    id: int
    name: str
    description: Optional[str] = None

    source_datasource_id: int
    source_table: str
    source_schema: Optional[str] = None

    target_datasource_id: Optional[int] = None  # 为空时使用系统数仓配置
    target_table: str
    target_schema: Optional[str] = None

    sync_mode: SyncMode
    incremental_column: Optional[str] = None
    incremental_value: Optional[str] = None
    where_condition: Optional[str] = None
    column_mapping: Optional[str] = None
    selected_columns: Optional[str] = None

    cron_expression: Optional[str] = None
    is_scheduled: bool

    status: SyncStatus
    last_sync_at: Optional[datetime] = None
    last_sync_rows: Optional[int] = None
    last_error: Optional[str] = None

    created_by: Optional[int] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class SyncLogResponse(BaseModel):
    """Schema for sync log response."""
    id: int
    sync_task_id: int
    sync_mode: Optional[SyncMode] = None
    status: str
    rows_read: int
    rows_written: int
    incremental_start: Optional[str] = None
    incremental_end: Optional[str] = None
    error_message: Optional[str] = None
    started_at: datetime
    completed_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class SyncPreviewRequest(BaseModel):
    """Schema for sync preview request."""
    source_datasource_id: int
    source_table: str
    source_schema: Optional[str] = None
    where_condition: Optional[str] = None
    selected_columns: Optional[List[str]] = None
    limit: int = Field(default=100, le=1000)


class SyncPreviewResponse(BaseModel):
    """Schema for sync preview response."""
    columns: List[str]
    rows: List[List]
    total_count: Optional[int] = None
