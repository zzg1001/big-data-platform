"""
Python 运行环境：脚本手动运行时使用的解释器（外部已有环境 或 平台托管 venv）。
"""
from datetime import datetime
from sqlalchemy import Column, BigInteger, String, DateTime, Text
import enum

from app.core.database import Base


class PyEnvKind(str, enum.Enum):
    EXTERNAL = "external"   # 登记的已有解释器（conda 环境 / 系统 python / 已有 venv）
    MANAGED = "managed"     # 平台创建的 venv


class PyEnv(Base):
    """运行环境 = 一个 Python 解释器路径。"""
    __tablename__ = "big_py_envs"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False, unique=True)
    description = Column(String(500))
    python_path = Column(String(500), nullable=False)  # python 解释器绝对路径
    kind = Column(String(20), default="external")      # external | managed
    status = Column(String(20), default="ready")       # ready | creating | invalid | failed
    python_version = Column(String(50))
    last_log = Column(Text)                             # 创建/装包的最近输出
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
