"""
System configuration model.
"""
from datetime import datetime
from sqlalchemy import Column, BigInteger, String, DateTime, Text
from app.core.database import Base


class SystemConfig(Base):
    """System configuration key-value store."""
    __tablename__ = "big_system_config"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    config_key = Column(String(100), unique=True, nullable=False, index=True)
    config_value = Column(Text)
    description = Column(String(500))
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
