"""
File management models.
"""
from datetime import datetime
from sqlalchemy import Column, BigInteger, String, DateTime, ForeignKey, Enum
from sqlalchemy.orm import relationship
import enum

from app.core.database import Base


class FileType(str, enum.Enum):
    """Supported file types."""
    CSV = "csv"
    EXCEL = "excel"
    JSON = "json"


class FileStatus(str, enum.Enum):
    """File processing status."""
    UPLOADED = "uploaded"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class File(Base):
    """Uploaded file metadata."""
    __tablename__ = "big_files"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    original_name = Column(String(255), nullable=False)
    stored_name = Column(String(255), nullable=False, unique=True)
    file_type = Column(Enum(FileType), nullable=False)
    file_size = Column(BigInteger, nullable=False)

    # Storage path
    storage_path = Column(String(500), nullable=False)

    # Processing status
    status = Column(Enum(FileStatus), default=FileStatus.UPLOADED)
    error_message = Column(String(500))

    # If imported to a table
    target_datasource_id = Column(BigInteger, ForeignKey("big_datasources.id"))
    target_table = Column(String(100))

    # Audit
    user_id = Column(BigInteger, ForeignKey("big_users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    user = relationship("User", back_populates="files")
