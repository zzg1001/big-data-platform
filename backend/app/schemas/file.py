"""
File schemas.
"""
from datetime import datetime
from typing import Optional, List, Any
from pydantic import BaseModel, Field

from app.models.file import FileType, FileStatus


class FileUploadResponse(BaseModel):
    """Schema for file upload response."""
    id: int
    original_name: str
    file_type: FileType
    file_size: int
    status: FileStatus
    created_at: datetime

    class Config:
        from_attributes = True


class FileResponse(BaseModel):
    """Schema for file response."""
    id: int
    original_name: str
    stored_name: str
    file_type: FileType
    file_size: int
    status: FileStatus
    error_message: Optional[str] = None
    target_datasource_id: Optional[int] = None
    target_table: Optional[str] = None
    user_id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class FilePreview(BaseModel):
    """Schema for file preview."""
    columns: List[str]
    rows: List[List[Any]]
    total_rows: int
    preview_rows: int


class FileImportRequest(BaseModel):
    """Schema for importing file to database."""
    file_id: int
    datasource_id: int
    table_name: str = Field(..., max_length=100)
    if_exists: str = Field(default="fail", pattern="^(fail|replace|append)$")
    column_mappings: Optional[dict] = None
