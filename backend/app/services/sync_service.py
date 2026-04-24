"""
Data synchronization service.
"""
from typing import Optional, List, Dict, Any
from datetime import datetime
import json

from sqlalchemy import text
from sqlalchemy.engine import Engine

from app.models.sync_task import SyncTask, SyncLog, SyncMode, SyncStatus
from app.services.db_connector import DatabaseConnector


class SyncService:
    """Service for executing data synchronization."""

    def __init__(self, source_engine: Engine, target_engine: Engine):
        self.source_engine = source_engine
        self.target_engine = target_engine

    def preview_data(
        self,
        table: str,
        schema: Optional[str] = None,
        columns: Optional[List[str]] = None,
        where_condition: Optional[str] = None,
        limit: int = 100,
    ) -> Dict[str, Any]:
        """Preview source data before sync."""
        # Build column list
        col_str = ", ".join(columns) if columns else "*"

        # Build table name with schema
        table_name = f"{schema}.{table}" if schema else table

        # Build query
        sql = f"SELECT {col_str} FROM {table_name}"
        if where_condition:
            sql += f" WHERE {where_condition}"
        sql += f" LIMIT {limit}"

        with self.source_engine.connect() as conn:
            result = conn.execute(text(sql))
            columns = list(result.keys())
            rows = [list(row) for row in result.fetchall()]

            # Get total count
            count_sql = f"SELECT COUNT(*) FROM {table_name}"
            if where_condition:
                count_sql += f" WHERE {where_condition}"
            count_result = conn.execute(text(count_sql))
            total_count = count_result.scalar()

        return {
            "columns": columns,
            "rows": rows,
            "total_count": total_count,
        }

    def get_table_columns(self, table: str, schema: Optional[str] = None) -> List[Dict[str, Any]]:
        """Get column information for a table."""
        from sqlalchemy import inspect
        inspector = inspect(self.source_engine)
        columns = inspector.get_columns(table, schema=schema)

        # Get primary key columns
        try:
            pk_constraint = inspector.get_pk_constraint(table, schema=schema)
            pk_columns = pk_constraint.get("constrained_columns", []) if pk_constraint else []
        except Exception:
            pk_columns = []

        result = []
        for col in columns:
            result.append({
                "name": col["name"],
                "data_type": str(col["type"]),
                "is_nullable": col.get("nullable", True),
                "is_primary_key": col["name"] in pk_columns,
            })
        return result

    def execute_sync(
        self,
        sync_task: SyncTask,
        log: SyncLog,
    ) -> SyncLog:
        """Execute data synchronization."""
        try:
            log.status = "running"

            # Parse configurations
            selected_columns = json.loads(sync_task.selected_columns) if sync_task.selected_columns else None
            column_mapping = json.loads(sync_task.column_mapping) if sync_task.column_mapping else None

            # Build source query
            source_table = f"{sync_task.source_schema}.{sync_task.source_table}" if sync_task.source_schema else sync_task.source_table
            target_table = f"{sync_task.target_schema}.{sync_task.target_table}" if sync_task.target_schema else sync_task.target_table

            col_str = ", ".join(selected_columns) if selected_columns else "*"
            sql = f"SELECT {col_str} FROM {source_table}"

            # Build WHERE clause
            conditions = []
            if sync_task.where_condition:
                conditions.append(f"({sync_task.where_condition})")

            # Add incremental condition
            if sync_task.sync_mode == SyncMode.INCREMENTAL and sync_task.incremental_column and sync_task.incremental_value:
                conditions.append(f"{sync_task.incremental_column} > '{sync_task.incremental_value}'")
                log.incremental_start = sync_task.incremental_value

            if conditions:
                sql += " WHERE " + " AND ".join(conditions)

            # Order by incremental column for incremental sync
            if sync_task.sync_mode == SyncMode.INCREMENTAL and sync_task.incremental_column:
                sql += f" ORDER BY {sync_task.incremental_column}"

            # Read source data
            with self.source_engine.connect() as conn:
                result = conn.execute(text(sql))
                columns = list(result.keys())
                rows = result.fetchall()
                log.rows_read = len(rows)

            if not rows:
                log.status = "success"
                log.rows_written = 0
                log.completed_at = datetime.utcnow()
                return log

            # Apply column mapping
            if column_mapping:
                columns = [column_mapping.get(col, col) for col in columns]

            # Write to target
            with self.target_engine.connect() as conn:
                # For full sync, truncate target table first
                if sync_task.sync_mode == SyncMode.FULL:
                    conn.execute(text(f"TRUNCATE TABLE {target_table}"))

                # Build INSERT statement
                placeholders = ", ".join([":p" + str(i) for i in range(len(columns))])
                col_names = ", ".join([f"`{col}`" for col in columns])
                insert_sql = f"INSERT INTO {target_table} ({col_names}) VALUES ({placeholders})"

                # Insert in batches
                batch_size = 1000
                for i in range(0, len(rows), batch_size):
                    batch = rows[i:i + batch_size]
                    for row in batch:
                        params = {f"p{j}": val for j, val in enumerate(row)}
                        conn.execute(text(insert_sql), params)

                conn.commit()
                log.rows_written = len(rows)

            # Update incremental value
            if sync_task.sync_mode == SyncMode.INCREMENTAL and sync_task.incremental_column and rows:
                # Get the max value of incremental column from synced data
                col_index = columns.index(sync_task.incremental_column) if sync_task.incremental_column in columns else None
                if col_index is not None:
                    max_value = max(row[col_index] for row in rows)
                    log.incremental_end = str(max_value)

            log.status = "success"
            log.completed_at = datetime.utcnow()

        except Exception as e:
            log.status = "failed"
            log.error_message = str(e)
            log.completed_at = datetime.utcnow()

        return log

    def create_target_table(
        self,
        source_table: str,
        target_table: str,
        source_schema: Optional[str] = None,
        target_schema: Optional[str] = None,
        selected_columns: Optional[List[str]] = None,
        column_mapping: Optional[Dict[str, str]] = None,
    ) -> str:
        """Generate CREATE TABLE DDL for target table based on source table structure."""
        from sqlalchemy import inspect

        inspector = inspect(self.source_engine)
        columns = inspector.get_columns(source_table, schema=source_schema)

        # Filter columns if specified
        if selected_columns:
            columns = [col for col in columns if col["name"] in selected_columns]

        # Build column definitions
        col_defs = []
        for col in columns:
            col_name = col["name"]
            if column_mapping:
                col_name = column_mapping.get(col_name, col_name)

            # Convert SQLAlchemy type to SQL type string
            col_type = str(col["type"])
            nullable = "NULL" if col.get("nullable", True) else "NOT NULL"
            col_defs.append(f"  `{col_name}` {col_type} {nullable}")

        target_name = f"{target_schema}.{target_table}" if target_schema else target_table
        ddl = f"CREATE TABLE IF NOT EXISTS {target_name} (\n"
        ddl += ",\n".join(col_defs)
        ddl += "\n);"

        return ddl
