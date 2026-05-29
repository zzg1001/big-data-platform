"""
Task dependency schemas.
"""
from datetime import datetime
from typing import Optional, List, Literal
from pydantic import BaseModel, Field


class TaskDependencyCreate(BaseModel):
    """Schema for creating a task dependency."""
    task_type: Literal["sync", "etl"]
    task_id: int
    upstream_task_type: Literal["sync", "etl"]
    upstream_task_id: int
    dependency_type: Literal["manual", "ai_parsed"] = "manual"
    source_table: Optional[str] = Field(None, max_length=200)


class TaskDependencyResponse(BaseModel):
    """Schema for task dependency response."""
    id: int
    task_type: str
    task_id: int
    upstream_task_type: str
    upstream_task_id: int
    dependency_type: str
    source_table: Optional[str] = None
    created_by: Optional[int] = None
    created_at: datetime

    # Extended info (filled by API)
    upstream_task_name: Optional[str] = None
    upstream_task_detail: Optional[str] = None  # table name or SQL preview
    upstream_layer_name: Optional[str] = None

    class Config:
        from_attributes = True


class TaskSearchResult(BaseModel):
    """Schema for task search result (used for dependency selection)."""
    task_type: str  # "sync" | "etl"
    task_id: int
    name: str
    detail: str  # source_table -> target_table or SQL preview
    layer_id: Optional[int] = None
    layer_name: Optional[str] = None
    layer_color: Optional[str] = None
    is_scheduled: bool = False


class ParseSqlRequest(BaseModel):
    """Schema for SQL parsing request."""
    sql_content: str


class ParseSqlResponse(BaseModel):
    """Schema for SQL parsing response."""
    source_tables: List[str]  # Tables referenced in SQL
    target_table: Optional[str] = None  # Table being written to (if detected)
    matched_tasks: List[TaskSearchResult]  # Tasks that produce the source tables
    unmatched_tables: List[str]  # Tables with no matching task
