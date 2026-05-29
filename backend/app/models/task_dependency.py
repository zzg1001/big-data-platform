"""
Task dependency model for managing upstream/downstream relationships between tasks.
"""
from datetime import datetime
from sqlalchemy import Column, BigInteger, String, DateTime, ForeignKey, Index, UniqueConstraint

from app.core.database import Base


class TaskDependency(Base):
    """Task dependency relationship - defines which tasks depend on which upstream tasks."""
    __tablename__ = "big_task_dependencies"

    id = Column(BigInteger, primary_key=True, autoincrement=True)

    # Dependent task (downstream - the task that has dependencies)
    task_type = Column(String(20), nullable=False)  # "sync" | "etl"
    task_id = Column(BigInteger, nullable=False)

    # Upstream dependency (the task that must complete first)
    upstream_task_type = Column(String(20), nullable=False)  # "sync" | "etl"
    upstream_task_id = Column(BigInteger, nullable=False)

    # Dependency metadata
    dependency_type = Column(String(20), default="manual")  # "manual" | "ai_parsed"
    source_table = Column(String(200))  # Table name that creates this dependency (for AI-parsed)

    # Audit fields
    created_by = Column(BigInteger, ForeignKey("big_users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        # Unique constraint: prevent duplicate dependencies
        UniqueConstraint(
            'task_type', 'task_id', 'upstream_task_type', 'upstream_task_id',
            name='uq_task_dependency'
        ),
        # Index for efficient lookup by task
        Index('ix_task_dependencies_task', 'task_type', 'task_id'),
        # Index for efficient lookup by upstream task
        Index('ix_task_dependencies_upstream', 'upstream_task_type', 'upstream_task_id'),
    )

    def __repr__(self):
        return (
            f"<TaskDependency(id={self.id}, "
            f"{self.task_type}:{self.task_id} <- {self.upstream_task_type}:{self.upstream_task_id})>"
        )
