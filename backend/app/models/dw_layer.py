"""
Data warehouse layer model for organizing tasks into layers (ODS, DW, DWS, ADS).
"""
from datetime import datetime
from sqlalchemy import Column, BigInteger, String, DateTime, ForeignKey, Integer
from sqlalchemy.orm import relationship

from app.core.database import Base


class DwLayer(Base):
    """Data warehouse layer definition."""
    __tablename__ = "big_dw_layers"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    name = Column(String(50), nullable=False, unique=True)  # ODS, DW, DWS, ADS
    display_name = Column(String(100), nullable=False)  # 原始数据层, 数据仓库层
    description = Column(String(500))
    level = Column(Integer, nullable=False, default=0)  # Sort order: ODS=1, DW=2, DWS=3, ADS=4
    color = Column(String(20))  # UI display color, e.g., "#52c41a"

    # Audit fields
    created_by = Column(BigInteger, ForeignKey("big_users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    sync_tasks = relationship("SyncTask", back_populates="dw_layer")
    etl_tasks = relationship("EtlTask", back_populates="dw_layer")

    def __repr__(self):
        return f"<DwLayer(id={self.id}, name='{self.name}', level={self.level})>"
