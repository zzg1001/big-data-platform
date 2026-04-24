"""
Audit log model.
"""
from datetime import datetime
from sqlalchemy import Column, BigInteger, String, DateTime, ForeignKey, Text

from app.core.database import Base


class AuditLog(Base):
    """Audit log for tracking user actions."""
    __tablename__ = "big_audit_logs"

    id = Column(BigInteger, primary_key=True, autoincrement=True)

    # User info
    user_id = Column(BigInteger, ForeignKey("big_users.id"))
    username = Column(String(50))

    # Action details
    action = Column(String(50), nullable=False)
    resource_type = Column(String(50), nullable=False)
    resource_id = Column(BigInteger)
    resource_name = Column(String(255))

    # Request details
    ip_address = Column(String(50))
    user_agent = Column(String(500))
    request_method = Column(String(10))
    request_path = Column(String(500))

    # Additional info
    details = Column(Text)

    # Status
    status = Column(String(20), default="success")
    error_message = Column(Text)

    # Timestamp
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
