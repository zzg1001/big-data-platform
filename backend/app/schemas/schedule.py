"""
Schedule schemas.
"""
from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field

from app.models.schedule import ScheduleStatus


class ScheduleCreate(BaseModel):
    """Schema for creating a schedule."""
    name: str = Field(..., max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    cron_expression: str = Field(..., max_length=100)
    sql_content: Optional[str] = None
    datasource_id: Optional[int] = None
    dependencies: Optional[List[str]] = None
    alert_email: Optional[str] = Field(None, max_length=255)
    alert_on_failure: bool = True
    alert_on_success: bool = False


class ScheduleUpdate(BaseModel):
    """Schema for updating a schedule."""
    name: Optional[str] = Field(None, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    cron_expression: Optional[str] = Field(None, max_length=100)
    sql_content: Optional[str] = None
    datasource_id: Optional[int] = None
    dependencies: Optional[List[str]] = None
    status: Optional[ScheduleStatus] = None
    alert_email: Optional[str] = Field(None, max_length=255)
    alert_on_failure: Optional[bool] = None
    alert_on_success: Optional[bool] = None


class ScheduleResponse(BaseModel):
    """Schema for schedule response."""
    id: int
    name: str
    description: Optional[str] = None
    dag_id: str
    cron_expression: str
    sql_content: Optional[str] = None
    datasource_id: Optional[int] = None
    status: ScheduleStatus
    is_deployed: bool
    dependencies: Optional[str] = None
    alert_email: Optional[str] = None
    alert_on_failure: bool
    alert_on_success: bool
    created_by: Optional[int] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ScheduleLogResponse(BaseModel):
    """Schema for schedule log response."""
    id: int
    schedule_id: int
    dag_run_id: Optional[str] = None
    execution_date: Optional[datetime] = None
    status: str
    error_message: Optional[str] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None

    class Config:
        from_attributes = True
