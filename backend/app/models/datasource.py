"""
DataSource models.
"""
from datetime import datetime
from sqlalchemy import Column, BigInteger, String, Boolean, DateTime, ForeignKey, Text, Enum
from sqlalchemy.orm import relationship
import enum

from app.core.database import Base


class DataSourceType(str, enum.Enum):
    """Supported data source types."""
    MYSQL = "mysql"
    POSTGRESQL = "postgresql"
    ORACLE = "oracle"
    HIVE = "hive"
    SQLSERVER = "sqlserver"


class DataSourceGroup(Base):
    """DataSource group for organization."""
    __tablename__ = "big_datasource_groups"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False)
    description = Column(String(255))
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    datasources = relationship("DataSource", back_populates="group")


class DataSource(Base):
    """DataSource connection configuration."""
    __tablename__ = "big_datasources"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False, index=True)
    type = Column(Enum(DataSourceType), nullable=False)
    host = Column(String(255), nullable=False)
    port = Column(BigInteger, nullable=False)
    database = Column(String(100), nullable=True)
    username = Column(String(100), nullable=False)
    encrypted_password = Column(Text, nullable=False)

    # Optional connection parameters
    schema_name = Column(String(100))
    service_name = Column(String(100))
    extra_params = Column(Text)

    # Connection pool settings
    pool_size = Column(BigInteger, default=5)
    max_overflow = Column(BigInteger, default=10)

    # Status
    is_active = Column(Boolean, default=True)
    is_warehouse = Column(Boolean, default=False)  # 是否为平台数据库
    is_default = Column(Boolean, default=False)  # 是否为默认数据源
    last_connected_at = Column(DateTime)
    connection_status = Column(String(50), default="unknown")

    # Organization
    group_id = Column(BigInteger, ForeignKey("big_datasource_groups.id"))

    # Audit
    created_by = Column(BigInteger, ForeignKey("big_users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    group = relationship("DataSourceGroup", back_populates="datasources")
    queries = relationship("Query", back_populates="datasource")
