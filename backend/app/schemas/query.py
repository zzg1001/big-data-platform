"""
Query schemas.
"""
from datetime import datetime
from typing import Optional, List, Any, Dict
from pydantic import BaseModel, Field

from app.models.query import QueryStatus


class QueryCreate(BaseModel):
    """Schema for creating a saved query."""
    name: str = Field(..., max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    sql_content: str
    datasource_id: int
    is_public: int = 0
    tags: Optional[str] = Field(None, max_length=255)


class QueryUpdate(BaseModel):
    """Schema for updating a saved query."""
    name: Optional[str] = Field(None, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    sql_content: Optional[str] = None
    datasource_id: Optional[int] = None
    is_public: Optional[int] = None
    tags: Optional[str] = Field(None, max_length=255)


class QueryResponse(BaseModel):
    """Schema for query response."""
    id: int
    name: str
    description: Optional[str] = None
    sql_content: str
    datasource_id: Optional[int] = None
    user_id: int
    is_public: int
    tags: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class QueryExecute(BaseModel):
    """Schema for executing a SQL query."""
    sql: str
    datasource_id: int
    limit: int = Field(default=1000, ge=1, le=10000)
    offset: int = Field(default=0, ge=0)


class QueryResult(BaseModel):
    """Schema for query execution result."""
    columns: List[str]
    rows: List[List[Any]]
    row_count: int
    execution_time_ms: float
    has_more: bool = False
    total_rows: Optional[int] = None


class QueryHistoryResponse(BaseModel):
    """Schema for query history response."""
    id: int
    query_id: Optional[int] = None
    datasource_id: Optional[int] = None
    sql_content: str
    status: QueryStatus
    error_message: Optional[str] = None
    row_count: Optional[int] = None
    execution_time_ms: Optional[float] = None
    started_at: datetime
    completed_at: Optional[datetime] = None

    class Config:
        from_attributes = True
