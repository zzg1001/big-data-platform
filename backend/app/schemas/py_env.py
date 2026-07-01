"""
Pydantic schemas for Python 运行环境。
"""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class PyEnvRegister(BaseModel):
    """登记已有解释器。"""
    name: str
    python_path: str
    description: Optional[str] = None


class PyEnvCreateVenv(BaseModel):
    """新建平台托管 venv。"""
    name: str
    description: Optional[str] = None
    base_python: Optional[str] = None  # 用哪个解释器建 venv，默认后端自身


class PyEnvInstall(BaseModel):
    """装包：packages（空格/换行分隔）或 requirements 文本，二选一。"""
    packages: Optional[str] = None
    requirements: Optional[str] = None


class PyEnvResponse(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    python_path: str
    kind: str
    status: str
    python_version: Optional[str] = None
    last_log: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True
