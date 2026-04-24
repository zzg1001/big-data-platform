"""
Schedule models for Airflow DAG management.
"""
from datetime import datetime
from sqlalchemy import Column, BigInteger, String, DateTime, ForeignKey, Text, Boolean, Enum
from sqlalchemy.orm import relationship
import enum

from app.core.database import Base


class ScheduleStatus(str, enum.Enum):
    """Schedule status."""
    DRAFT = "draft"
    ACTIVE = "active"
    PAUSED = "paused"
    FAILED = "failed"


class Schedule(Base):
    """DAG schedule configuration."""
    __tablename__ = "big_schedules"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False, unique=True)
    description = Column(String(500))

    # DAG configuration
    dag_id = Column(String(100), unique=True, index=True)
    cron_expression = Column(String(100), nullable=False)

    # SQL/Task configuration
    sql_content = Column(Text)
    datasource_id = Column(BigInteger, ForeignKey("big_datasources.id"))

    # DAG code
    dag_code = Column(Text)

    # Status
    status = Column(Enum(ScheduleStatus), default=ScheduleStatus.DRAFT)
    is_deployed = Column(Boolean, default=False)

    # Dependencies
    dependencies = Column(Text)

    # Alert configuration
    alert_email = Column(String(255))
    alert_on_failure = Column(Boolean, default=True)
    alert_on_success = Column(Boolean, default=False)

    # Audit
    created_by = Column(BigInteger, ForeignKey("big_users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    logs = relationship("ScheduleLog", back_populates="schedule")


class ScheduleLog(Base):
    """Schedule execution logs."""
    __tablename__ = "big_schedule_logs"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    schedule_id = Column(BigInteger, ForeignKey("big_schedules.id"))

    # Airflow run info
    dag_run_id = Column(String(100))
    execution_date = Column(DateTime)

    # Status
    status = Column(String(50))
    error_message = Column(Text)

    # Timestamps
    started_at = Column(DateTime)
    completed_at = Column(DateTime)

    # Relationships
    schedule = relationship("Schedule", back_populates="logs")
