"""
SQL query execution API endpoints.
"""
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.deps import get_current_user
from app.models.user import User
from app.models.datasource import DataSource
from app.models.query import Query, QueryHistory, QueryStatus
from app.schemas.query import (
    QueryCreate,
    QueryUpdate,
    QueryResponse,
    QueryExecute,
    QueryResult,
    QueryHistoryResponse,
)
from app.services.db_connector import DatabaseConnector
from app.services.query_executor import QueryExecutor, create_query_history, update_query_history

router = APIRouter()


@router.post("/execute", response_model=QueryResult)
async def execute_query(
    query_data: QueryExecute,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Execute a SQL query."""
    # Get datasource
    result = await db.execute(
        select(DataSource).where(DataSource.id == query_data.datasource_id)
    )
    datasource = result.scalar_one_or_none()
    if not datasource:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Datasource not found")

    # Create query history record
    history = await create_query_history(
        db=db,
        sql_content=query_data.sql,
        datasource_id=datasource.id,
        user_id=current_user.id,
    )

    try:
        # Get engine and execute
        engine = DatabaseConnector.get_engine(
            datasource_id=datasource.id,
            db_type=datasource.type,
            host=datasource.host,
            port=datasource.port,
            database=datasource.database,
            username=datasource.username,
            encrypted_password=datasource.encrypted_password,
            schema_name=datasource.schema_name,
            service_name=datasource.service_name,
            pool_size=datasource.pool_size,
            max_overflow=datasource.max_overflow,
        )

        executor = QueryExecutor(engine)
        result = executor.execute(
            sql=query_data.sql,
            limit=query_data.limit,
            offset=query_data.offset,
        )

        # Update history with success
        await update_query_history(
            db=db,
            history=history,
            status=QueryStatus.SUCCESS,
            row_count=result.row_count,
            execution_time_ms=result.execution_time_ms,
        )

        return result

    except Exception as e:
        # Update history with failure
        await update_query_history(
            db=db,
            history=history,
            status=QueryStatus.FAILED,
            error_message=str(e),
        )
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


# Saved Queries
@router.post("/saved", response_model=QueryResponse, status_code=status.HTTP_201_CREATED)
async def save_query(
    query_data: QueryCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Save a query."""
    query = Query(
        name=query_data.name,
        description=query_data.description,
        sql_content=query_data.sql_content,
        datasource_id=query_data.datasource_id,
        user_id=current_user.id,
        is_public=query_data.is_public,
        tags=query_data.tags,
    )
    db.add(query)
    await db.flush()
    await db.refresh(query)
    return query


@router.get("/saved", response_model=List[QueryResponse])
async def list_saved_queries(
    datasource_id: int = None,
    include_public: bool = True,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List saved queries."""
    query = select(Query)

    if include_public:
        query = query.where(
            (Query.user_id == current_user.id) | (Query.is_public == 1)
        )
    else:
        query = query.where(Query.user_id == current_user.id)

    if datasource_id:
        query = query.where(Query.datasource_id == datasource_id)

    query = query.order_by(Query.updated_at.desc())

    result = await db.execute(query)
    return list(result.scalars().all())


@router.get("/saved/{query_id}", response_model=QueryResponse)
async def get_saved_query(
    query_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a saved query by ID."""
    result = await db.execute(select(Query).where(Query.id == query_id))
    query = result.scalar_one_or_none()

    if not query:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Query not found")

    # Check access
    if query.user_id != current_user.id and query.is_public != 1:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    return query


@router.put("/saved/{query_id}", response_model=QueryResponse)
async def update_saved_query(
    query_id: int,
    query_data: QueryUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update a saved query."""
    result = await db.execute(select(Query).where(Query.id == query_id))
    query = result.scalar_one_or_none()

    if not query:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Query not found")

    if query.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    update_data = query_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(query, field, value)

    await db.flush()
    await db.refresh(query)
    return query


@router.delete("/saved/{query_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_saved_query(
    query_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a saved query."""
    result = await db.execute(select(Query).where(Query.id == query_id))
    query = result.scalar_one_or_none()

    if not query:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Query not found")

    if query.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    await db.delete(query)
    await db.flush()


# Query History
@router.get("/history", response_model=List[QueryHistoryResponse])
async def get_query_history(
    datasource_id: int = None,
    limit: int = 50,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get query execution history."""
    query = select(QueryHistory).where(QueryHistory.user_id == current_user.id)

    if datasource_id:
        query = query.where(QueryHistory.datasource_id == datasource_id)

    query = query.order_by(QueryHistory.started_at.desc()).limit(limit)

    result = await db.execute(query)
    return list(result.scalars().all())
