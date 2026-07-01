"""
Pydantic schemas for script sync tasks.
"""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class ScriptTaskUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    entrypoint: Optional[str] = None
    cron_expression: Optional[str] = None
    env_id: Optional[int] = None


class ScriptTaskResponse(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    original_filename: Optional[str] = None
    entrypoint: str
    has_requirements: bool
    env_id: Optional[int] = None
    cron_expression: Optional[str] = None
    is_scheduled: bool
    dag_id: Optional[str] = None
    airflow_status: Optional[str] = None
    status: str
    last_run_at: Optional[datetime] = None
    last_run_status: Optional[str] = None
    last_error: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True
