"""
API Key models for Data Service.
"""
from datetime import datetime
from sqlalchemy import Column, BigInteger, String, Boolean, DateTime, ForeignKey, Text, Integer
import enum

from app.core.database import Base


class ScopeType(str, enum.Enum):
    """API Key scope types."""
    ALL = "all"
    PROJECT = "project"
    TAG = "tag"


class ApiKey(Base):
    """API Key for external data access."""
    __tablename__ = "big_api_keys"

    id = Column(BigInteger, primary_key=True, autoincrement=True)

    # Basic info
    name = Column(String(100), nullable=False)
    description = Column(String(500))

    # Key credentials (prefix for display, hash for verification)
    key_prefix = Column(String(16), nullable=False)
    key_hash = Column(String(255), nullable=False, index=True)

    # Permission scope
    scope_type = Column(String(20), default="all")  # all, project, tag
    scope_ids = Column(Text)  # JSON array of project/tag IDs

    # Rate limiting
    rate_limit = Column(Integer, default=1000)  # requests per hour

    # Expiration
    expires_at = Column(DateTime)

    # Status & statistics
    is_active = Column(Boolean, default=True)
    last_used_at = Column(DateTime)
    total_requests = Column(BigInteger, default=0)

    # Audit
    created_by = Column(BigInteger, ForeignKey("big_users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class ApiAccessLog(Base):
    """API access log for auditing and statistics."""
    __tablename__ = "big_api_access_logs"

    id = Column(BigInteger, primary_key=True, autoincrement=True)

    # Related key
    api_key_id = Column(BigInteger, ForeignKey("big_api_keys.id"))

    # Request info
    endpoint = Column(String(255), nullable=False)
    method = Column(String(10), nullable=False)
    request_params = Column(Text)  # JSON

    # Response info
    status_code = Column(Integer, nullable=False)
    response_time_ms = Column(Integer)
    row_count = Column(Integer)

    # Client info
    client_ip = Column(String(45))
    user_agent = Column(String(500))

    # Timestamp
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
