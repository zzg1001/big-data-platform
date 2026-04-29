"""
AI assistant schemas.
"""
from typing import Optional, List
from pydantic import BaseModel, Field


class AITextToSQLRequest(BaseModel):
    """Schema for text-to-SQL request."""
    natural_language: str = Field(..., min_length=1, max_length=2000)
    datasource_id: int
    context: Optional[str] = None  # Additional context about the database schema


class AITextToSQLResponse(BaseModel):
    """Schema for text-to-SQL response."""
    sql: str
    explanation: str
    confidence: float = Field(ge=0, le=1)


class AISQLOptimizeRequest(BaseModel):
    """Schema for SQL optimization request."""
    sql: str
    datasource_id: Optional[int] = None


class AISQLOptimizeResponse(BaseModel):
    """Schema for SQL optimization response."""
    original_sql: str
    optimized_sql: str
    suggestions: List[str]
    explanation: str


class AIExplainRequest(BaseModel):
    """Schema for SQL explanation request."""
    sql: str


class AIExplainResponse(BaseModel):
    """Schema for SQL explanation response."""
    sql: str
    explanation: str
    tables_used: List[str]
    operations: List[str]


class AIGenerateDAGRequest(BaseModel):
    """Schema for DAG generation request."""
    name: str = Field(..., max_length=100)
    description: str = Field(..., max_length=500)
    sql_content: str
    datasource_id: int
    cron_expression: str = Field(..., max_length=100)
    dependencies: Optional[List[str]] = None
    alert_email: Optional[str] = None


class AIGenerateDAGResponse(BaseModel):
    """Schema for DAG generation response."""
    dag_id: str
    dag_code: str
    explanation: str


class DDLTypeMapping(BaseModel):
    """Schema for DDL type mapping."""
    column_name: str
    source_type: str
    target_type: str
    warning: Optional[str] = None


class AIDDLConvertRequest(BaseModel):
    """Schema for AI DDL conversion request."""
    source_datasource_id: int
    target_datasource_id: int
    source_table: str
    source_schema: Optional[str] = None
    target_table: Optional[str] = None
    target_schema: Optional[str] = None


class AIDDLConvertResponse(BaseModel):
    """Schema for AI DDL conversion response."""
    source_db_type: str
    target_db_type: str
    source_ddl: str
    target_ddl: str
    type_mappings: List[DDLTypeMapping]
    explanation: str
    warnings: List[str] = []


class AIExecuteDDLRequest(BaseModel):
    """Schema for executing DDL on target database."""
    datasource_id: int
    ddl: str


class AIExecuteDDLResponse(BaseModel):
    """Schema for DDL execution response."""
    success: bool
    message: str
    table_name: Optional[str] = None


class AIFixDDLRequest(BaseModel):
    """Schema for AI DDL fix request."""
    ddl: str
    error: str
    target_db_type: str


class AIFixDDLResponse(BaseModel):
    """Schema for AI DDL fix response."""
    original_ddl: str
    fixed_ddl: str
    explanation: str
    changes: List[str] = []


class AIGenerateCronRequest(BaseModel):
    """Schema for AI cron generation request."""
    description: str = Field(..., min_length=1, max_length=500)


class AIGenerateCronResponse(BaseModel):
    """Schema for AI cron generation response."""
    cron_expression: str
    explanation: str
    next_runs: List[str] = []  # ISO format datetime strings


class ColumnTypeInfo(BaseModel):
    """Schema for column type info."""
    name: str
    data_type: str


class AIConvertColumnTypesRequest(BaseModel):
    """Schema for AI column type conversion request."""
    columns: List[ColumnTypeInfo]
    source_db_type: str
    target_db_type: str


class ColumnTypeMapping(BaseModel):
    """Schema for column type mapping result."""
    source_column: str
    source_type: str
    target_column: str
    target_type: str


class AIConvertColumnTypesResponse(BaseModel):
    """Schema for AI column type conversion response."""
    mappings: List[ColumnTypeMapping]
    explanation: Optional[str] = None
