"""
Sync schedule schemas.
"""
from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field


class SyncScheduleCreate(BaseModel):
    """Schema for creating a sync schedule."""
    name: str = Field(..., max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    sync_task_id: int
    cron_expression: str = Field(..., max_length=100)


class SyncScheduleUpdate(BaseModel):
    """Schema for updating a sync schedule."""
    name: Optional[str] = Field(None, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    cron_expression: Optional[str] = Field(None, max_length=100)


class SyncScheduleResponse(BaseModel):
    """Schema for sync schedule response."""
    id: int
    name: str
    description: Optional[str] = None
    sync_task_id: int
    cron_expression: str
    is_enabled: bool
    dag_id: Optional[str] = None
    airflow_status: Optional[str] = None
    next_run_time: Optional[datetime] = None
    last_run_time: Optional[datetime] = None
    last_run_status: Optional[str] = None
    created_by: Optional[int] = None
    created_at: datetime
    updated_at: datetime

    # Joined fields from sync_task
    sync_task_name: Optional[str] = None
    source_table: Optional[str] = None
    target_table: Optional[str] = None
    creator_name: Optional[str] = None

    class Config:
        from_attributes = True


class SyncScheduleListItem(BaseModel):
    """Schema for schedule list view with task info."""
    id: int
    name: str
    description: Optional[str] = None
    sync_task_id: int
    cron_expression: str
    is_enabled: bool
    dag_id: Optional[str] = None
    airflow_status: Optional[str] = None
    next_run_time: Optional[datetime] = None
    last_run_time: Optional[datetime] = None
    last_run_status: Optional[str] = None

    # From sync_task
    sync_task_name: str
    source_table: str
    target_table: str
    sync_mode: str
    last_sync_at: Optional[datetime] = None
    last_sync_rows: Optional[int] = None

    # Creator
    creator_name: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True
