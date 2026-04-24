"""
Query and QueryHistory models.
"""
from datetime import datetime
from sqlalchemy import Column, BigInteger, String, DateTime, ForeignKey, Text, Float, Enum
from sqlalchemy.orm import relationship
import enum

from app.core.database import Base


class QueryStatus(str, enum.Enum):
    """Query execution status."""
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    CANCELLED = "cancelled"


class Query(Base):
    """Saved SQL queries."""
    __tablename__ = "big_queries"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False)
    description = Column(String(500))
    sql_content = Column(Text, nullable=False)

    # Association
    datasource_id = Column(BigInteger, ForeignKey("big_datasources.id"))
    user_id = Column(BigInteger, ForeignKey("big_users.id"))

    # Metadata
    is_public = Column(BigInteger, default=0)
    tags = Column(String(255))

    # Audit
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    datasource = relationship("DataSource", back_populates="queries")
    user = relationship("User", back_populates="queries")
    history = relationship("QueryHistory", back_populates="query")


class QueryHistory(Base):
    """Query execution history."""
    __tablename__ = "big_query_history"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    query_id = Column(BigInteger, ForeignKey("big_queries.id"))
    datasource_id = Column(BigInteger, ForeignKey("big_datasources.id"))
    user_id = Column(BigInteger, ForeignKey("big_users.id"))

    # Execution details
    sql_content = Column(Text, nullable=False)
    status = Column(Enum(QueryStatus), default=QueryStatus.PENDING)
    error_message = Column(Text)

    # Performance metrics
    row_count = Column(BigInteger)
    execution_time_ms = Column(Float)

    # Timestamps
    started_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime)

    # Relationships
    query = relationship("Query", back_populates="history")
