"""
AI assistant API endpoints.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.config import settings
from app.api.deps import get_current_user
from app.models.user import User
from app.models.datasource import DataSource
from app.schemas.ai import (
    AITextToSQLRequest,
    AITextToSQLResponse,
    AISQLOptimizeRequest,
    AISQLOptimizeResponse,
    AIExplainRequest,
    AIExplainResponse,
    AIGenerateDAGRequest,
    AIGenerateDAGResponse,
    AIDDLConvertRequest,
    AIDDLConvertResponse,
    AIExecuteDDLRequest,
    AIExecuteDDLResponse,
    AIFixDDLRequest,
    AIFixDDLResponse,
)
from app.services.ai_assistant import AIAssistant
from app.services.db_connector import DatabaseConnector

router = APIRouter()


def get_ai_assistant() -> AIAssistant:
    """Get AI assistant instance."""
    if not settings.ANTHROPIC_AUTH_TOKEN:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI service not configured. Please set ANTHROPIC_AUTH_TOKEN.",
        )
    return AIAssistant()


@router.post("/text-to-sql", response_model=AITextToSQLResponse)
async def text_to_sql(
    request: AITextToSQLRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Convert natural language to SQL."""
    # Get datasource for schema information
    result = await db.execute(
        select(DataSource).where(DataSource.id == request.datasource_id)
    )
    datasource = result.scalar_one_or_none()
    if not datasource:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Datasource not found")

    # Get table schema for context
    try:
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
        )

        tables = DatabaseConnector.get_tables(engine, schema=datasource.schema_name)

        # Build schema description
        schema_parts = []
        for table in tables[:20]:  # Limit to first 20 tables
            try:
                metadata = DatabaseConnector.get_table_metadata(
                    engine, table, schema=datasource.schema_name
                )
                cols = ", ".join([f"{c.name} ({c.data_type})" for c in metadata.columns[:10]])
                schema_parts.append(f"Table: {table}\nColumns: {cols}")
            except Exception:
                schema_parts.append(f"Table: {table}")

        table_schema = "\n\n".join(schema_parts)

        if request.context:
            table_schema = f"{table_schema}\n\nAdditional context: {request.context}"

    except Exception as e:
        table_schema = request.context or "No schema information available."

    ai = get_ai_assistant()
    dialect = datasource.type.value

    try:
        response = ai.text_to_sql(
            natural_language=request.natural_language,
            table_schema=table_schema,
            dialect=dialect,
        )
        return response
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.post("/optimize", response_model=AISQLOptimizeResponse)
async def optimize_sql(
    request: AISQLOptimizeRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get SQL optimization suggestions."""
    dialect = "postgresql"

    if request.datasource_id:
        result = await db.execute(
            select(DataSource).where(DataSource.id == request.datasource_id)
        )
        datasource = result.scalar_one_or_none()
        if datasource:
            dialect = datasource.type.value

    ai = get_ai_assistant()
    try:
        response = ai.optimize_sql(sql=request.sql, dialect=dialect)
        return response
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.post("/explain", response_model=AIExplainResponse)
async def explain_sql(
    request: AIExplainRequest,
    current_user: User = Depends(get_current_user),
):
    """Explain what a SQL query does."""
    ai = get_ai_assistant()
    try:
        response = ai.explain_sql(sql=request.sql)
        return response
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.post("/generate-dag", response_model=AIGenerateDAGResponse)
async def generate_dag(
    request: AIGenerateDAGRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Generate Airflow DAG code using AI."""
    # Get datasource configuration
    result = await db.execute(
        select(DataSource).where(DataSource.id == request.datasource_id)
    )
    datasource = result.scalar_one_or_none()
    if not datasource:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Datasource not found")

    datasource_config = {
        "conn_id": f"{datasource.type.value}_{datasource.id}",
        "type": datasource.type.value,
    }

    ai = get_ai_assistant()
    try:
        response = ai.generate_dag(
            name=request.name,
            description=request.description,
            sql_content=request.sql_content,
            cron_expression=request.cron_expression,
            datasource_config=datasource_config,
            dependencies=request.dependencies,
            alert_email=request.alert_email,
        )
        return response
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.post("/convert-ddl", response_model=AIDDLConvertResponse)
async def convert_ddl(
    request: AIDDLConvertRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Convert DDL from source database type to target database type using AI."""
    # Get source datasource
    result = await db.execute(
        select(DataSource).where(DataSource.id == request.source_datasource_id)
    )
    source_ds = result.scalar_one_or_none()
    if not source_ds:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source datasource not found")

    # Get target datasource
    result = await db.execute(
        select(DataSource).where(DataSource.id == request.target_datasource_id)
    )
    target_ds = result.scalar_one_or_none()
    if not target_ds:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target datasource not found")

    # Check if target is a warehouse
    if not target_ds.is_warehouse:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Target datasource must be marked as a warehouse (数仓)"
        )

    # Get source table DDL
    try:
        source_engine = DatabaseConnector.get_engine(
            datasource_id=source_ds.id,
            db_type=source_ds.type,
            host=source_ds.host,
            port=source_ds.port,
            database=source_ds.database,
            username=source_ds.username,
            encrypted_password=source_ds.encrypted_password,
            schema_name=source_ds.schema_name,
            service_name=source_ds.service_name,
        )

        # Get table metadata and generate source DDL
        metadata = DatabaseConnector.get_table_metadata(
            source_engine, request.source_table, schema=request.source_schema
        )

        # Build source DDL from metadata
        columns_ddl = []
        for col in metadata.columns:
            col_def = f"  {col.name} {col.data_type}"
            if not col.is_nullable:
                col_def += " NOT NULL"
            if col.default_value:
                col_def += f" DEFAULT {col.default_value}"
            if col.comment:
                col_def += f" COMMENT '{col.comment}'"
            columns_ddl.append(col_def)

        pk_cols = [col.name for col in metadata.columns if col.is_primary_key]
        if pk_cols:
            columns_ddl.append(f"  PRIMARY KEY ({', '.join(pk_cols)})")

        table_name = f"{request.source_schema}.{request.source_table}" if request.source_schema else request.source_table
        source_ddl = f"CREATE TABLE {table_name} (\n" + ",\n".join(columns_ddl) + "\n);"

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get source table metadata: {str(e)}"
        )

    # Use AI to convert DDL
    ai = get_ai_assistant()
    try:
        response = ai.convert_ddl(
            source_ddl=source_ddl,
            source_db_type=source_ds.type.value,
            target_db_type=target_ds.type.value,
            target_table=request.target_table or request.source_table,
            target_schema=request.target_schema,
        )
        return response
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.post("/execute-ddl", response_model=AIExecuteDDLResponse)
async def execute_ddl(
    request: AIExecuteDDLRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Execute DDL on target database."""
    # Get target datasource
    result = await db.execute(
        select(DataSource).where(DataSource.id == request.datasource_id)
    )
    datasource = result.scalar_one_or_none()
    if not datasource:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Datasource not found")

    # Check if target is a warehouse
    if not datasource.is_warehouse:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Target datasource must be marked as a warehouse (数仓)"
        )

    try:
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
        )

        # Execute DDL
        with engine.connect() as conn:
            conn.execute(request.ddl)
            conn.commit()

        # Extract table name from DDL
        import re
        match = re.search(r'CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)', request.ddl, re.IGNORECASE)
        table_name = match.group(1) if match else None

        return AIExecuteDDLResponse(
            success=True,
            message="DDL executed successfully",
            table_name=table_name,
        )
    except Exception as e:
        return AIExecuteDDLResponse(
            success=False,
            message=f"DDL execution failed: {str(e)}",
            table_name=None,
        )


@router.post("/fix-ddl", response_model=AIFixDDLResponse)
async def fix_ddl(
    request: AIFixDDLRequest,
    current_user: User = Depends(get_current_user),
):
    """Use AI to fix DDL based on error message."""
    ai = get_ai_assistant()
    try:
        response = ai.fix_ddl(
            ddl=request.ddl,
            error=request.error,
            target_db_type=request.target_db_type,
        )
        return response
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
