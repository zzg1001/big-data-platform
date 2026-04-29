"""
Sync schedule models - wraps sync tasks with scheduling configuration.
"""
from datetime import datetime
from sqlalchemy import Column, BigInteger, String, DateTime, ForeignKey, Text, Boolean
from sqlalchemy.orm import relationship

from app.core.database import Base


class SyncSchedule(Base):
    """Schedule configuration that wraps a sync task."""
    __tablename__ = "big_sync_schedules"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False)
    description = Column(String(500))

    # Reference to sync task
    sync_task_id = Column(BigInteger, ForeignKey("big_sync_tasks.id"), nullable=False)

    # Schedule config
    cron_expression = Column(String(100), nullable=False)
    is_enabled = Column(Boolean, default=False)

    # Airflow DAG info
    dag_id = Column(String(200), index=True)
    airflow_status = Column(String(50))  # "active" | "paused" | "error"
    next_run_time = Column(DateTime)
    last_run_time = Column(DateTime)
    last_run_status = Column(String(50))  # "success" | "failed"

    # Audit
    created_by = Column(BigInteger, ForeignKey("big_users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationship
    sync_task = relationship("SyncTask", backref="schedules")
