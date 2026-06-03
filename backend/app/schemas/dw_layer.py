"""
Data warehouse layer schemas.
"""
from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field


class DwLayerCreate(BaseModel):
    """Schema for creating a DW layer."""
    name: str = Field(..., max_length=50)
    display_name: str = Field(..., max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    level: int = Field(..., ge=0)
    color: Optional[str] = Field(None, max_length=20)
    requires_dependency: bool = True  # ODS=False, others=True


class DwLayerUpdate(BaseModel):
    """Schema for updating a DW layer."""
    name: Optional[str] = Field(None, max_length=50)
    display_name: Optional[str] = Field(None, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    level: Optional[int] = Field(None, ge=0)
    color: Optional[str] = Field(None, max_length=20)
    requires_dependency: Optional[bool] = None


class DwLayerResponse(BaseModel):
    """Schema for DW layer response."""
    id: int
    name: str
    display_name: str
    description: Optional[str] = None
    level: int
    color: Optional[str] = None
    requires_dependency: bool = True
    created_by: Optional[int] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class DwLayerListItem(BaseModel):
    """Schema for DW layer list item."""
    id: int
    name: str
    display_name: str
    description: Optional[str] = None
    level: int
    color: Optional[str] = None
    requires_dependency: bool = True
    sync_task_count: int = 0
    etl_task_count: int = 0

    class Config:
        from_attributes = True


class DwLayerInitDefaults(BaseModel):
    """Response for init defaults."""
    created: List[str]
    skipped: List[str]
