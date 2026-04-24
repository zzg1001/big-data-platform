"""
Data lineage API endpoints.
"""
from typing import List, Dict
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.api.deps import get_current_user
from app.models.user import User
from app.services.lineage_parser import LineageParser

router = APIRouter()


class LineageRequest(BaseModel):
    """Request for lineage parsing."""
    sql: str


class LineageResponse(BaseModel):
    """Response with lineage information."""
    nodes: List[Dict]
    edges: List[Dict]
    source_tables: List[str]
    target_tables: List[str]
    ctes: List[str]


class MultiLineageRequest(BaseModel):
    """Request for multi-SQL lineage parsing."""
    sqls: List[str]


class DependencyResponse(BaseModel):
    """Response with table dependencies."""
    dependencies: Dict[str, List[str]]


@router.post("/parse", response_model=LineageResponse)
async def parse_lineage(
    request: LineageRequest,
    current_user: User = Depends(get_current_user),
):
    """Parse SQL and extract data lineage."""
    parser = LineageParser()
    try:
        result = parser.parse(request.sql)
        return LineageResponse(**result)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to parse SQL: {str(e)}",
        )


@router.post("/dependencies", response_model=DependencyResponse)
async def get_dependencies(
    request: MultiLineageRequest,
    current_user: User = Depends(get_current_user),
):
    """Get table dependencies from multiple SQL statements."""
    parser = LineageParser()
    try:
        dependencies = parser.get_table_dependencies(request.sqls)
        # Convert sets to lists for JSON serialization
        return DependencyResponse(
            dependencies={k: list(v) for k, v in dependencies.items()}
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to parse SQL: {str(e)}",
        )
