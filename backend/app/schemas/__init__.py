"""
Pydantic schemas for API validation.
"""
from app.schemas.user import (
    UserCreate,
    UserUpdate,
    UserResponse,
    UserLogin,
    Token,
    TokenPayload,
)
from app.schemas.datasource import (
    DataSourceCreate,
    DataSourceUpdate,
    DataSourceResponse,
    DataSourceTest,
    DataSourceGroupCreate,
    DataSourceGroupResponse,
    TableMetadata,
    ColumnMetadata,
)
from app.schemas.query import (
    QueryCreate,
    QueryUpdate,
    QueryResponse,
    QueryExecute,
    QueryResult,
    QueryHistoryResponse,
)
from app.schemas.schedule import (
    ScheduleCreate,
    ScheduleUpdate,
    ScheduleResponse,
    ScheduleLogResponse,
)
from app.schemas.file import (
    FileUploadResponse,
    FileResponse,
    FileImportRequest,
)
from app.schemas.ai import (
    AITextToSQLRequest,
    AITextToSQLResponse,
    AISQLOptimizeRequest,
    AISQLOptimizeResponse,
    AIGenerateDAGRequest,
    AIGenerateDAGResponse,
)
from app.schemas.etl_task import (
    EtlTaskCreate,
    EtlTaskUpdate,
    EtlTaskResponse,
    EtlLogResponse,
    EtlTaskEnableRequest,
    EtlTaskListItem,
)

__all__ = [
    # User
    "UserCreate",
    "UserUpdate",
    "UserResponse",
    "UserLogin",
    "Token",
    "TokenPayload",
    # DataSource
    "DataSourceCreate",
    "DataSourceUpdate",
    "DataSourceResponse",
    "DataSourceTest",
    "DataSourceGroupCreate",
    "DataSourceGroupResponse",
    "TableMetadata",
    "ColumnMetadata",
    # Query
    "QueryCreate",
    "QueryUpdate",
    "QueryResponse",
    "QueryExecute",
    "QueryResult",
    "QueryHistoryResponse",
    # Schedule
    "ScheduleCreate",
    "ScheduleUpdate",
    "ScheduleResponse",
    "ScheduleLogResponse",
    # File
    "FileUploadResponse",
    "FileResponse",
    "FileImportRequest",
    # AI
    "AITextToSQLRequest",
    "AITextToSQLResponse",
    "AISQLOptimizeRequest",
    "AISQLOptimizeResponse",
    "AIGenerateDAGRequest",
    "AIGenerateDAGResponse",
    # ETL
    "EtlTaskCreate",
    "EtlTaskUpdate",
    "EtlTaskResponse",
    "EtlLogResponse",
    "EtlTaskEnableRequest",
    "EtlTaskListItem",
]
