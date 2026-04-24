"""
User, Role, and Permission models.
"""
from datetime import datetime
from sqlalchemy import Column, BigInteger, String, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship

from app.core.database import Base


class User(Base):
    """User model."""
    __tablename__ = "big_users"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    email = Column(String(100), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(100))
    is_active = Column(Boolean, default=True)
    is_superuser = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    roles = relationship("Role", secondary="big_user_roles", back_populates="users")
    queries = relationship("Query", back_populates="user")
    files = relationship("File", back_populates="user")


class Role(Base):
    """Role model."""
    __tablename__ = "big_roles"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    name = Column(String(50), unique=True, nullable=False)
    description = Column(String(255))
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    users = relationship("User", secondary="big_user_roles", back_populates="roles")
    permissions = relationship("Permission", secondary="big_role_permissions", back_populates="roles")


class Permission(Base):
    """Permission model."""
    __tablename__ = "big_permissions"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    name = Column(String(100), unique=True, nullable=False)
    resource = Column(String(50), nullable=False)
    action = Column(String(50), nullable=False)
    description = Column(String(255))

    # Relationships
    roles = relationship("Role", secondary="big_role_permissions", back_populates="permissions")


class UserRole(Base):
    """User-Role association table."""
    __tablename__ = "big_user_roles"

    user_id = Column(BigInteger, ForeignKey("big_users.id", ondelete="CASCADE"), primary_key=True)
    role_id = Column(BigInteger, ForeignKey("big_roles.id", ondelete="CASCADE"), primary_key=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class RolePermission(Base):
    """Role-Permission association table."""
    __tablename__ = "big_role_permissions"

    role_id = Column(BigInteger, ForeignKey("big_roles.id", ondelete="CASCADE"), primary_key=True)
    permission_id = Column(BigInteger, ForeignKey("big_permissions.id", ondelete="CASCADE"), primary_key=True)
