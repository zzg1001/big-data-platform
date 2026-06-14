"""
Data Service API Schemas.
"""
from datetime import datetime
from typing import Optional, List, Any
from pydantic import BaseModel, Field


# ==================== API Key Management ====================

class ApiKeyCreate(BaseModel):
    """Create API Key request."""
    name: str = Field(..., max_length=100, description="密钥名称")
    description: Optional[str] = Field(None, max_length=500, description="密钥描述")
    scope_type: str = Field("all", description="权限范围: all, project, tag")
    scope_ids: Optional[List[int]] = Field(None, description="授权的项目/标签ID列表")
    rate_limit: int = Field(1000, ge=1, le=100000, description="每小时请求限制")
    expires_at: Optional[datetime] = Field(None, description="过期时间")


class ApiKeyUpdate(BaseModel):
    """Update API Key request."""
    name: Optional[str] = Field(None, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    scope_type: Optional[str] = None
    scope_ids: Optional[List[int]] = None
    rate_limit: Optional[int] = Field(None, ge=1, le=100000)
    expires_at: Optional[datetime] = None
    is_active: Optional[bool] = None


class ApiKeyResponse(BaseModel):
    """API Key response (without full key)."""
    id: int
    name: str
    description: Optional[str] = None
    key_prefix: str  # Only show prefix like bdk_xxxx****
    scope_type: str
    scope_ids: Optional[List[int]] = None
    rate_limit: int
    expires_at: Optional[datetime] = None
    is_active: bool
    last_used_at: Optional[datetime] = None
    total_requests: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ApiKeyCreateResponse(ApiKeyResponse):
    """Response after creating API Key (includes full key, shown only once)."""
    api_key: str  # Full key, shown only once at creation


# ==================== Open API (API Key Auth) ====================

class TagListItem(BaseModel):
    """Tag list item for open API."""
    id: int
    name: str
    description: Optional[str] = None
    node_type: str
    parent_id: Optional[int] = None
    dimension_id: Optional[int] = None
    has_data: bool = False  # Whether tag has data table


class TagDetailResponse(BaseModel):
    """Tag detail for open API."""
    id: int
    name: str
    description: Optional[str] = None
    node_type: str
    parent_id: Optional[int] = None
    dimension_id: Optional[int] = None
    tag_table_name: Optional[str] = None
    columns: Optional[List[str]] = None  # Table columns
    row_count: Optional[int] = None


class TagDataRequest(BaseModel):
    """Tag data query request."""
    page: int = Field(1, ge=1, description="页码")
    page_size: int = Field(100, ge=1, le=1000, description="每页条数")
    fields: Optional[List[str]] = Field(None, description="返回字段列表")
    filters: Optional[dict] = Field(None, description="筛选条件")
    sort: Optional[str] = Field(None, description="排序字段")
    sort_order: str = Field("asc", description="排序方向: asc, desc")


class PaginationInfo(BaseModel):
    """Pagination info."""
    page: int
    page_size: int
    total: int
    total_pages: int


class TagDataResponse(BaseModel):
    """Tag data query response."""
    tag_id: int
    tag_name: str
    table_name: Optional[str] = None
    columns: List[str]
    rows: List[dict]
    pagination: PaginationInfo


class OpenApiResponse(BaseModel):
    """Standard open API response wrapper."""
    success: bool = True
    data: Optional[Any] = None
    error: Optional[dict] = None
    request_id: Optional[str] = None


# ==================== Statistics ====================

class ApiStatsOverview(BaseModel):
    """API statistics overview."""
    total_keys: int
    active_keys: int
    today_requests: int
    month_requests: int
    avg_response_time_ms: Optional[float] = None


class AccessLogItem(BaseModel):
    """Access log item."""
    id: int
    api_key_id: int
    api_key_name: Optional[str] = None
    endpoint: str
    method: str
    status_code: int
    response_time_ms: Optional[int] = None
    row_count: Optional[int] = None
    client_ip: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class AccessLogResponse(BaseModel):
    """Access log list response."""
    items: List[AccessLogItem]
    total: int
    page: int
    page_size: int
