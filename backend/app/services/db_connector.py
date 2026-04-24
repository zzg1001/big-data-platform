"""
Multi-database connector service.
"""
from typing import Optional, Dict, Any, List
from contextlib import contextmanager
import json
from urllib.parse import quote_plus

from sqlalchemy import create_engine, text, inspect
from sqlalchemy.engine import Engine
from sqlalchemy.pool import QueuePool

from app.models.datasource import DataSourceType
from app.schemas.datasource import TableMetadata, ColumnMetadata
from app.core.security import decrypt_password


class DatabaseConnector:
    """Service for connecting to multiple database types."""

    _engines: Dict[int, Engine] = {}

    @staticmethod
    def get_connection_url(
        db_type: DataSourceType,
        host: str,
        port: int,
        database: str,
        username: str,
        password: str,
        schema_name: Optional[str] = None,
        service_name: Optional[str] = None,
    ) -> str:
        """Build connection URL based on database type."""
        # URL encode username and password to handle special characters
        encoded_username = quote_plus(username)
        encoded_password = quote_plus(password)

        if db_type == DataSourceType.MYSQL:
            return f"mysql+pymysql://{encoded_username}:{encoded_password}@{host}:{port}/{database}?charset=utf8mb4"

        elif db_type == DataSourceType.POSTGRESQL:
            url = f"postgresql+psycopg2://{encoded_username}:{encoded_password}@{host}:{port}/{database}"
            if schema_name:
                url += f"?options=-csearch_path={schema_name}"
            return url

        elif db_type == DataSourceType.ORACLE:
            if service_name:
                return f"oracle+cx_oracle://{encoded_username}:{encoded_password}@{host}:{port}/?service_name={service_name}"
            return f"oracle+cx_oracle://{encoded_username}:{encoded_password}@{host}:{port}/{database}"

        elif db_type == DataSourceType.HIVE:
            return f"hive://{encoded_username}:{encoded_password}@{host}:{port}/{database}"

        elif db_type == DataSourceType.SQLSERVER:
            return f"mssql+pymssql://{encoded_username}:{encoded_password}@{host}:{port}/{database}"

        raise ValueError(f"Unsupported database type: {db_type}")

    @classmethod
    def get_engine(
        cls,
        datasource_id: int,
        db_type: DataSourceType,
        host: str,
        port: int,
        database: str,
        username: str,
        encrypted_password: str,
        schema_name: Optional[str] = None,
        service_name: Optional[str] = None,
        pool_size: int = 5,
        max_overflow: int = 10,
        connect_timeout: int = 10,
    ) -> Engine:
        """Get or create a database engine for the datasource."""
        if datasource_id in cls._engines:
            return cls._engines[datasource_id]

        password = decrypt_password(encrypted_password)
        url = cls.get_connection_url(
            db_type, host, port, database, username, password, schema_name, service_name
        )

        # Set connection timeout based on database type
        connect_args: Dict[str, Any] = {}
        if db_type == DataSourceType.MYSQL:
            connect_args = {"connect_timeout": connect_timeout}
        elif db_type == DataSourceType.POSTGRESQL:
            connect_args = {"connect_timeout": connect_timeout}
        elif db_type == DataSourceType.SQLSERVER:
            connect_args = {"login_timeout": connect_timeout}

        engine = create_engine(
            url,
            poolclass=QueuePool,
            pool_size=pool_size,
            max_overflow=max_overflow,
            pool_pre_ping=True,
            pool_recycle=3600,
            connect_args=connect_args,
        )
        cls._engines[datasource_id] = engine
        return engine

    @classmethod
    def remove_engine(cls, datasource_id: int) -> None:
        """Remove and dispose of an engine."""
        if datasource_id in cls._engines:
            cls._engines[datasource_id].dispose()
            del cls._engines[datasource_id]

    @staticmethod
    def test_connection(
        db_type: DataSourceType,
        host: str,
        port: int,
        database: str,
        username: str,
        password: str,
        schema_name: Optional[str] = None,
        service_name: Optional[str] = None,
        timeout: int = 10,
    ) -> Dict[str, Any]:
        """Test database connection without storing engine."""
        try:
            url = DatabaseConnector.get_connection_url(
                db_type, host, port, database, username, password, schema_name, service_name
            )

            # Set connection timeout based on database type
            connect_args: Dict[str, Any] = {}
            if db_type == DataSourceType.MYSQL:
                connect_args = {"connect_timeout": timeout}
            elif db_type == DataSourceType.POSTGRESQL:
                connect_args = {"connect_timeout": timeout}
            elif db_type == DataSourceType.SQLSERVER:
                connect_args = {"login_timeout": timeout}

            engine = create_engine(
                url,
                pool_pre_ping=True,
                connect_args=connect_args,
            )
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            engine.dispose()
            return {"success": True, "message": "Connection successful"}
        except Exception as e:
            return {"success": False, "message": str(e)}

    @staticmethod
    def get_tables(engine: Engine, schema: Optional[str] = None) -> List[str]:
        """Get list of tables from database."""
        inspector = inspect(engine)
        return inspector.get_table_names(schema=schema)

    @staticmethod
    def get_table_metadata(
        engine: Engine, table_name: str, schema: Optional[str] = None
    ) -> TableMetadata:
        """Get metadata for a specific table."""
        inspector = inspect(engine)

        columns = []
        pk_columns = set(inspector.get_pk_constraint(table_name, schema=schema).get("constrained_columns", []))

        for col in inspector.get_columns(table_name, schema=schema):
            columns.append(ColumnMetadata(
                name=col["name"],
                data_type=str(col["type"]),
                is_nullable=col.get("nullable", True),
                is_primary_key=col["name"] in pk_columns,
                default_value=str(col.get("default")) if col.get("default") else None,
                comment=col.get("comment"),
            ))

        return TableMetadata(
            name=table_name,
            schema_name=schema,
            columns=columns,
        )

    @staticmethod
    def get_databases(engine: Engine, db_type: DataSourceType) -> List[str]:
        """Get list of databases/schemas."""
        if db_type == DataSourceType.MYSQL:
            with engine.connect() as conn:
                result = conn.execute(text("SHOW DATABASES"))
                return [row[0] for row in result]

        elif db_type == DataSourceType.POSTGRESQL:
            inspector = inspect(engine)
            return inspector.get_schema_names()

        elif db_type == DataSourceType.ORACLE:
            with engine.connect() as conn:
                result = conn.execute(text("SELECT username FROM all_users ORDER BY username"))
                return [row[0] for row in result]

        return []
