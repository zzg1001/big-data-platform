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
    column_mapping = Column(Text)
    selected_columns = Column(Text)

    # Schedule
    cron_expression = Column(String(100))
    is_scheduled = Column(Boolean, default=False)

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
