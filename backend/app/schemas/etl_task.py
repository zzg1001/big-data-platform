"""
ETL task schemas.
"""
from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field

from app.models.etl_task import EtlStatus, EtlLogStatus


class EtlTaskCreate(BaseModel):
    """Schema for creating an ETL task."""
    name: str = Field(..., max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    sql_content: str
    datasource_id: Optional[int] = None  # If None, use system warehouse
    dw_layer_id: Optional[int] = None  # Data warehouse layer
    upstream_task_ids: Optional[List[dict]] = None  # [{"task_type": "sync", "task_id": 1}]


class EtlTaskUpdate(BaseModel):
    """Schema for updating an ETL task."""
    name: Optional[str] = Field(None, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    sql_content: Optional[str] = None
    datasource_id: Optional[int] = None
    dw_layer_id: Optional[int] = None
    status: Optional[EtlStatus] = None
    cron_expression: Optional[str] = Field(None, max_length=100)
    is_scheduled: Optional[bool] = None
    upstream_task_ids: Optional[List[dict]] = None  # [{"task_type": "sync", "task_id": 1}]


class EtlTaskResponse(BaseModel):
    """Schema for ETL task response."""
    id: int
    name: str
    description: Optional[str] = None
    sql_content: str
    datasource_id: Optional[int] = None
    dw_layer_id: Optional[int] = None
    dw_layer_name: Optional[str] = None
    dw_layer_color: Optional[str] = None

    # Schedule
    cron_expression: Optional[str] = None
    is_scheduled: bool

    # Airflow
    dag_id: Optional[str] = None
    airflow_status: Optional[str] = None
    next_run_time: Optional[datetime] = None

    # Status
    status: EtlStatus
    last_run_at: Optional[datetime] = None
    last_run_rows: Optional[int] = None
    last_error: Optional[str] = None

    # Audit
    created_by: Optional[int] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class EtlLogResponse(BaseModel):
    """Schema for ETL log response."""
    id: int
    etl_task_id: int
    status: EtlLogStatus
    rows_affected: int
    execution_time_ms: Optional[int] = None
    error_message: Optional[str] = None
    started_at: datetime
    finished_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class EtlTaskEnableRequest(BaseModel):
    """Schema for enabling/scheduling an ETL task."""
    cron_expression: str = Field(..., max_length=100)


class EtlTaskListItem(BaseModel):
    """Schema for ETL task list item (with datasource name)."""
    id: int
    name: str
    description: Optional[str] = None
    sql_preview: str  # First 100 chars of SQL
    datasource_id: Optional[int] = None
    datasource_name: Optional[str] = None
    dw_layer_id: Optional[int] = None
    dw_layer_name: Optional[str] = None
    dw_layer_color: Optional[str] = None

    is_scheduled: bool
    cron_expression: Optional[str] = None
    dag_id: Optional[str] = None
    airflow_status: Optional[str] = None

    status: EtlStatus
    last_run_at: Optional[datetime] = None
    last_run_rows: Optional[int] = None
    dependency_count: int = 0  # 上游依赖数量

    created_at: datetime

    class Config:
        from_attributes = True
