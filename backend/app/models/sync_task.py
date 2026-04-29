"""
Data sync task models.
"""
from datetime import datetime
from sqlalchemy import Column, BigInteger, String, DateTime, ForeignKey, Text, Boolean, Enum
from sqlalchemy.orm import relationship
import enum

from app.core.database import Base


class SyncMode(str, enum.Enum):
    """Sync mode."""
    FULL = "full"
    INCREMENTAL = "incremental"


class SyncStatus(str, enum.Enum):
    """Sync task status."""
    DRAFT = "draft"
    ACTIVE = "active"
    PAUSED = "paused"
    RUNNING = "running"
    FAILED = "failed"


class SyncTask(Base):
    """Data sync task configuration."""
    __tablename__ = "big_sync_tasks"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False)
    description = Column(String(500))

    # Source
    source_datasource_id = Column(BigInteger, ForeignKey("big_datasources.id"), nullable=False)
    source_table = Column(String(200), nullable=False)
    source_schema = Column(String(100))

    # Target (使用系统数仓配置时可为空)
    target_datasource_id = Column(BigInteger, ForeignKey("big_datasources.id"), nullable=True)
    target_table = Column(String(200), nullable=False)
    target_schema = Column(String(100))

    # Sync config
    sync_mode = Column(Enum(SyncMode), default=SyncMode.FULL)
    incremental_column = Column(String(100))
    incremental_value = Column(String(255))
    where_condition = Column(Text)
    column_mapping = Column(Text)  # JSON: {"source_col": "target_col"}
    selected_columns = Column(Text)  # JSON: ["col1", "col2"]

    # Partition config (for Hive/SparkSQL)
    partition_columns = Column(Text)  # JSON: ["dt", "hour"]
    partition_type = Column(String(50))  # "hive" | "sparksql" | "custom"

    # Backfill config
    backfill_mode = Column(String(50))  # "full" | "by_partition" | "by_date"
    backfill_start_date = Column(DateTime)
    backfill_end_date = Column(DateTime)

    # Multi-table merge
    merge_group_id = Column(BigInteger)  # Group ID for merging multiple source tables
    merge_order = Column(BigInteger)  # Order within merge group

    # Schedule
    cron_expression = Column(String(100))
    is_scheduled = Column(Boolean, default=False)

    # Airflow DAG info
    dag_id = Column(String(200), index=True)
    airflow_status = Column(String(50))  # "active" | "paused" | "error"
    next_run_time = Column(DateTime)

    # Status
    status = Column(Enum(SyncStatus), default=SyncStatus.DRAFT)
    last_sync_at = Column(DateTime)
    last_sync_rows = Column(BigInteger)
    last_error = Column(Text)

    # Audit
    created_by = Column(BigInteger, ForeignKey("big_users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships (cascade delete: 删除任务时同时删除日志)
    logs = relationship("SyncLog", back_populates="sync_task", cascade="all, delete-orphan")


class SyncLog(Base):
    """Sync execution log."""
    __tablename__ = "big_sync_logs"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    sync_task_id = Column(BigInteger, ForeignKey("big_sync_tasks.id"), nullable=False)

    sync_mode = Column(Enum(SyncMode))
    status = Column(String(50))

    rows_read = Column(BigInteger, default=0)
    rows_written = Column(BigInteger, default=0)

    incremental_start = Column(String(255))
    incremental_end = Column(String(255))

    error_message = Column(Text)

    started_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime)

    # Relationships
    sync_task = relationship("SyncTask", back_populates="logs")


class ColumnMapping(Base):
    """Column mapping for sync tasks - stores source to target field mappings."""
    __tablename__ = "big_column_mappings"

    id = Column(BigInteger, primary_key=True, autoincrement=True)

    # 关联的同步任务（可选，也可用于模板）
    sync_task_id = Column(BigInteger, ForeignKey("big_sync_tasks.id"), nullable=True)

    # 数据源信息（用于缓存映射关系）
    source_datasource_id = Column(BigInteger, ForeignKey("big_datasources.id"), nullable=True)
    source_table = Column(String(200), nullable=False)
    target_table = Column(String(200), nullable=False)

    # 源字段
    source_column = Column(String(200), nullable=False)
    source_type = Column(String(100), nullable=False)

    # 目标字段
    target_column = Column(String(200), nullable=False)
    target_type = Column(String(100), nullable=False)

    # 排序和状态
    sort_order = Column(BigInteger, default=0)
    is_new_column = Column(Boolean, default=False)  # 是否为新增的目标字段

    # 审计
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
