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

    # 源配置（source_datasource_id 为空时使用系统平台数据库配置）
    source_datasource_id: Optional[int] = None  # 为空时使用系统平台数据库配置
    source_table: str = Field(..., max_length=200)
    source_schema: Optional[str] = Field(None, max_length=100)

    # 目标配置（使用系统配置的平台数据库，target_datasource_id 可选）
    target_datasource_id: Optional[int] = None  # 为空时使用系统平台数据库配置
    target_table: str = Field(..., max_length=200)
    target_schema: Optional[str] = Field(None, max_length=100)

    # Data warehouse layer
    dw_layer_id: Optional[int] = None

    # 同步配置
    sync_mode: SyncMode = SyncMode.FULL
    incremental_column: Optional[str] = Field(None, max_length=100)
    where_condition: Optional[str] = None
    column_mapping: Optional[Dict[str, str]] = None
    selected_columns: Optional[List[str]] = None

    # 分区配置 (Hive/SparkSQL)
    partition_columns: Optional[List[str]] = None
    partition_type: Optional[str] = Field(None, max_length=50)  # "hive" | "sparksql"

    # 补数据配置
    backfill_mode: Optional[str] = Field(None, max_length=50)  # "full" | "by_partition" | "by_date"
    backfill_start_date: Optional[datetime] = None
    backfill_end_date: Optional[datetime] = None

    # 多表合并
    merge_group_id: Optional[int] = None
    merge_order: Optional[int] = None

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
    dw_layer_id: Optional[int] = None
    sync_mode: Optional[SyncMode] = None
    incremental_column: Optional[str] = Field(None, max_length=100)
    where_condition: Optional[str] = None
    column_mapping: Optional[Dict[str, str]] = None
    selected_columns: Optional[List[str]] = None

    # 分区配置
    partition_columns: Optional[List[str]] = None
    partition_type: Optional[str] = Field(None, max_length=50)

    # 补数据配置
    backfill_mode: Optional[str] = Field(None, max_length=50)
    backfill_start_date: Optional[datetime] = None
    backfill_end_date: Optional[datetime] = None

    # 多表合并
    merge_group_id: Optional[int] = None
    merge_order: Optional[int] = None

    # 调度配置
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

    target_datasource_id: Optional[int] = None  # 为空时使用系统平台数据库配置
    target_table: str
    target_schema: Optional[str] = None

    dw_layer_id: Optional[int] = None
    dw_layer_name: Optional[str] = None
    dw_layer_color: Optional[str] = None

    sync_mode: SyncMode
    incremental_column: Optional[str] = None
    incremental_value: Optional[str] = None
    where_condition: Optional[str] = None
    column_mapping: Optional[str] = None
    selected_columns: Optional[str] = None

    # 分区配置
    partition_columns: Optional[str] = None
    partition_type: Optional[str] = None

    # 补数据配置
    backfill_mode: Optional[str] = None
    backfill_start_date: Optional[datetime] = None
    backfill_end_date: Optional[datetime] = None

    # 多表合并
    merge_group_id: Optional[int] = None
    merge_order: Optional[int] = None

    # 调度配置
    cron_expression: Optional[str] = None
    is_scheduled: bool

    # Airflow DAG 信息
    dag_id: Optional[str] = None
    airflow_status: Optional[str] = None
    next_run_time: Optional[datetime] = None

    status: SyncStatus
    last_sync_at: Optional[datetime] = None
    last_sync_rows: Optional[int] = None
    last_error: Optional[str] = None

    created_by: Optional[int] = None
    creator_name: Optional[str] = None  # 创建人名称 (join from users)
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


class SyncTaskEnableRequest(BaseModel):
    """Schema for enabling/scheduling a sync task."""
    cron_expression: str = Field(..., max_length=100)


class SyncTaskBackfillRequest(BaseModel):
    """Schema for backfill request."""
    mode: str = Field(..., description="full | by_partition | by_date")
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    partitions: Optional[List[str]] = None


class SyncTaskSchedulerView(BaseModel):
    """Schema for scheduler list view (includes creator name)."""
    id: int
    name: str
    description: Optional[str] = None

    source_datasource_id: int
    source_table: str
    target_table: str

    dw_layer_id: Optional[int] = None
    dw_layer_name: Optional[str] = None
    dw_layer_color: Optional[str] = None

    sync_mode: SyncMode
    is_scheduled: bool
    cron_expression: Optional[str] = None

    dag_id: Optional[str] = None
    airflow_status: Optional[str] = None
    next_run_time: Optional[datetime] = None

    status: SyncStatus
    last_sync_at: Optional[datetime] = None
    last_sync_rows: Optional[int] = None

    created_by: Optional[int] = None
    creator_name: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


# ==================== Column Mapping Schemas ====================

class ColumnMappingItem(BaseModel):
    """Single column mapping item."""
    source_column: str
    source_type: str
    target_column: str
    target_type: str
    is_new_column: bool = False  # 是否为新增的目标字段


class ColumnMappingSaveRequest(BaseModel):
    """Request to save column mappings."""
    source_datasource_id: int
    source_table: str
    target_table: str
    mappings: List[ColumnMappingItem]
    sync_task_id: Optional[int] = None  # 可选，关联到同步任务


class ColumnMappingResponse(BaseModel):
    """Response for column mapping."""
    id: int
    sync_task_id: Optional[int] = None
    source_datasource_id: Optional[int] = None
    source_table: str
    target_table: str
    source_column: str
    source_type: str
    target_column: str
    target_type: str
    sort_order: int
    is_new_column: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ColumnMappingListResponse(BaseModel):
    """Response for list of column mappings."""
    source_table: str
    target_table: str
    mappings: List[ColumnMappingItem]
