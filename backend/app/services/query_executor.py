"""
SQL query execution service.
"""
from typing import Optional, List, Any, Dict
import time
from datetime import datetime

from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.query import QueryHistory, QueryStatus
from app.schemas.query import QueryResult


class QueryExecutor:
    """Service for executing SQL queries."""

    def __init__(self, engine: Engine):
        self.engine = engine

    def execute(
        self,
        sql: str,
        limit: int = 1000,
        offset: int = 0,
    ) -> QueryResult:
        """Execute a SQL query and return results."""
        start_time = time.time()

        # Parse and wrap the query with limit/offset if it's a SELECT
        sql_upper = sql.strip().upper()
        is_select = sql_upper.startswith("SELECT")

        with self.engine.connect() as conn:
            if is_select:
                # Count total rows first (for pagination info)
                count_sql = f"SELECT COUNT(*) FROM ({sql}) AS subq"
                try:
                    count_result = conn.execute(text(count_sql))
                    total_rows = count_result.scalar()
                except Exception:
                    total_rows = None

                # Apply limit and offset
                paginated_sql = f"{sql} LIMIT {limit} OFFSET {offset}"
                result = conn.execute(text(paginated_sql))
            else:
                result = conn.execute(text(sql))
                conn.commit()
                total_rows = result.rowcount if result.rowcount >= 0 else None

            # Get column names
            columns = list(result.keys()) if result.returns_rows else []

            # Fetch rows
            if result.returns_rows:
                rows = [list(row) for row in result.fetchall()]
            else:
                rows = []

        execution_time_ms = (time.time() - start_time) * 1000
        row_count = len(rows)
        has_more = total_rows is not None and (offset + row_count) < total_rows

        return QueryResult(
            columns=columns,
            rows=rows,
            row_count=row_count,
            execution_time_ms=round(execution_time_ms, 2),
            has_more=has_more,
            total_rows=total_rows,
        )

    def execute_raw(self, sql: str) -> Dict[str, Any]:
        """Execute raw SQL without pagination."""
        start_time = time.time()

        with self.engine.connect() as conn:
            result = conn.execute(text(sql))

            if result.returns_rows:
                columns = list(result.keys())
                rows = [list(row) for row in result.fetchall()]
            else:
                conn.commit()
                columns = []
                rows = []

        execution_time_ms = (time.time() - start_time) * 1000

        return {
            "columns": columns,
            "rows": rows,
            "row_count": len(rows),
            "execution_time_ms": round(execution_time_ms, 2),
        }


async def create_query_history(
    db: AsyncSession,
    sql_content: str,
    datasource_id: int,
    user_id: int,
    query_id: Optional[int] = None,
) -> QueryHistory:
    """Create a query history record."""
    history = QueryHistory(
        query_id=query_id,
        datasource_id=datasource_id,
        user_id=user_id,
        sql_content=sql_content,
        status=QueryStatus.PENDING,
        started_at=datetime.utcnow(),
    )
    db.add(history)
    await db.flush()
    await db.refresh(history)
    return history


async def update_query_history(
    db: AsyncSession,
    history: QueryHistory,
    status: QueryStatus,
    row_count: Optional[int] = None,
    execution_time_ms: Optional[float] = None,
    error_message: Optional[str] = None,
) -> QueryHistory:
    """Update query history with execution results."""
    history.status = status
    history.row_count = row_count
    history.execution_time_ms = execution_time_ms
    history.error_message = error_message
    history.completed_at = datetime.utcnow()
    await db.flush()
    await db.refresh(history)
    return history
