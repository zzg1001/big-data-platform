"""
ETL task models for saved SQL scripts.
"""
from datetime import datetime
from sqlalchemy import Column, BigInteger, String, DateTime, ForeignKey, Text, Boolean, Enum
from sqlalchemy.orm import relationship
import enum

from app.core.database import Base


class EtlStatus(str, enum.Enum):
    """ETL task status."""
    DRAFT = "draft"
    ACTIVE = "active"
    DISABLED = "disabled"


class EtlLogStatus(str, enum.Enum):
    """ETL execution log status."""
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"


class EtlTask(Base):
    """ETL task - saved SQL script for scheduled execution."""
    __tablename__ = "big_etl_tasks"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False)
    description = Column(String(500))

    # SQL content
    sql_content = Column(Text, nullable=False)

    # Data source (which warehouse to execute on)
    datasource_id = Column(BigInteger, ForeignKey("big_datasources.id"), nullable=True)

    # Data warehouse layer (ODS, DW, DWS, ADS)
    dw_layer_id = Column(BigInteger, ForeignKey("big_dw_layers.id"), nullable=True)

    # Schedule
    cron_expression = Column(String(100))
    is_scheduled = Column(Boolean, default=False)

    # Airflow DAG info
    dag_id = Column(String(200), index=True)
    airflow_status = Column(String(50))  # "active" | "paused" | "error"
    next_run_time = Column(DateTime)

    # Status
    status = Column(Enum(EtlStatus), default=EtlStatus.DRAFT)
    last_run_at = Column(DateTime)
    last_run_rows = Column(BigInteger)
    last_error = Column(Text)

    # Audit
    created_by = Column(BigInteger, ForeignKey("big_users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    logs = relationship("EtlLog", back_populates="etl_task", cascade="all, delete-orphan")
    dw_layer = relationship("DwLayer", back_populates="etl_tasks", lazy="joined")

    @property
    def dw_layer_name(self) -> str | None:
        """Get the data warehouse layer name."""
        return self.dw_layer.name if self.dw_layer else None

    @property
    def dw_layer_color(self) -> str | None:
        """Get the data warehouse layer color."""
        return self.dw_layer.color if self.dw_layer else None


class EtlLog(Base):
    """ETL execution log."""
    __tablename__ = "big_etl_logs"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    etl_task_id = Column(BigInteger, ForeignKey("big_etl_tasks.id"), nullable=False)

    status = Column(Enum(EtlLogStatus), default=EtlLogStatus.RUNNING)

    # Execution stats
    rows_affected = Column(BigInteger, default=0)
    execution_time_ms = Column(BigInteger)

    # Error info
    error_message = Column(Text)

    # Timestamps
    started_at = Column(DateTime, default=datetime.utcnow)
    finished_at = Column(DateTime)

    # Relationships
    etl_task = relationship("EtlTask", back_populates="logs")
