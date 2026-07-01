"""
Script sync task models - uploaded Python programs run on Airflow.
"""
from datetime import datetime
from sqlalchemy import Column, BigInteger, String, DateTime, ForeignKey, Text, Boolean, Enum
import enum

from app.core.database import Base


class ScriptStatus(str, enum.Enum):
    """Script sync task status."""
    DRAFT = "draft"        # 已上传，未上线
    ACTIVE = "active"      # 已上线（DAG 已生成并启用）
    PAUSED = "paused"      # 已下线（DAG 暂停）
    FAILED = "failed"


class ScriptTask(Base):
    """脚本同步任务 - 上传的 Python 程序，生成 Airflow DAG 运行。"""
    __tablename__ = "big_script_tasks"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False)
    description = Column(String(500))

    # 上传内容
    original_filename = Column(String(255))          # 上传时的原始文件名
    entrypoint = Column(String(255), default="main.py")  # 入口脚本（相对脚本目录）
    has_requirements = Column(Boolean, default=False)    # 目录里是否有 requirements.txt

    # 手动运行使用的 Python 运行环境（big_py_envs.id，可空=后端默认解释器）
    env_id = Column(BigInteger, nullable=True)

    # 调度
    cron_expression = Column(String(100))            # 为空=仅手动触发
    is_scheduled = Column(Boolean, default=False)

    # Airflow DAG 信息
    dag_id = Column(String(200), index=True)
    airflow_status = Column(String(50))              # "active" | "paused" | "error"

    # 状态
    status = Column(Enum(ScriptStatus), default=ScriptStatus.DRAFT)
    last_run_at = Column(DateTime)
    last_run_status = Column(String(50))
    last_error = Column(Text)

    # 审计
    created_by = Column(BigInteger, ForeignKey("big_users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
