"""
SQL Scripts management API - save/load SQL files to disk.
"""
import os
import re
from typing import List
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.api.deps import get_current_user
from app.models.user import User

router = APIRouter()

# SQL 脚本存储目录 - 相对于 backend 目录
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
SCRIPTS_DIR = os.path.join(BACKEND_DIR, "data", "sql_scripts")
os.makedirs(SCRIPTS_DIR, exist_ok=True)


class SqlScriptCreate(BaseModel):
    name: str  # 文件名（不含后缀）
    content: str


class SqlScriptUpdate(BaseModel):
    content: str


class SqlScriptResponse(BaseModel):
    name: str
    content: str
    size: int
    modified_at: datetime


class SqlScriptListItem(BaseModel):
    name: str
    size: int
    modified_at: datetime


def sanitize_filename(name: str) -> str:
    """Remove invalid characters from filename."""
    # Only allow alphanumeric, underscore, hyphen, Chinese characters
    name = re.sub(r'[^\w\u4e00-\u9fff\-]', '_', name)
    return name[:100]  # Limit length


def get_user_scripts_dir(user_id: int) -> str:
    """Get the scripts directory for a user."""
    user_dir = os.path.join(SCRIPTS_DIR, str(user_id))
    os.makedirs(user_dir, exist_ok=True)
    return user_dir


@router.get("/", response_model=List[SqlScriptListItem])
async def list_scripts(
    current_user: User = Depends(get_current_user),
):
    """List all SQL scripts for current user."""
    user_dir = get_user_scripts_dir(current_user.id)
    scripts = []

    for filename in os.listdir(user_dir):
        if filename.endswith('.sql'):
            filepath = os.path.join(user_dir, filename)
            stat = os.stat(filepath)
            scripts.append(SqlScriptListItem(
                name=filename[:-4],  # Remove .sql extension
                size=stat.st_size,
                modified_at=datetime.fromtimestamp(stat.st_mtime),
            ))

    # Sort by modified time, newest first
    scripts.sort(key=lambda x: x.modified_at, reverse=True)
    return scripts


@router.get("/{name}", response_model=SqlScriptResponse)
async def get_script(
    name: str,
    current_user: User = Depends(get_current_user),
):
    """Get a SQL script by name."""
    user_dir = get_user_scripts_dir(current_user.id)
    safe_name = sanitize_filename(name)
    filepath = os.path.join(user_dir, f"{safe_name}.sql")

    if not os.path.exists(filepath):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Script not found"
        )

    stat = os.stat(filepath)
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    return SqlScriptResponse(
        name=safe_name,
        content=content,
        size=stat.st_size,
        modified_at=datetime.fromtimestamp(stat.st_mtime),
    )


@router.post("/", response_model=SqlScriptResponse, status_code=status.HTTP_201_CREATED)
async def create_script(
    data: SqlScriptCreate,
    current_user: User = Depends(get_current_user),
):
    """Create or update a SQL script."""
    user_dir = get_user_scripts_dir(current_user.id)
    safe_name = sanitize_filename(data.name)
    filepath = os.path.join(user_dir, f"{safe_name}.sql")

    # 直接写入（创建或覆盖）
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(data.content)

    stat = os.stat(filepath)
    return SqlScriptResponse(
        name=safe_name,
        content=data.content,
        size=stat.st_size,
        modified_at=datetime.fromtimestamp(stat.st_mtime),
    )


@router.put("/{name}", response_model=SqlScriptResponse)
async def update_script(
    name: str,
    data: SqlScriptUpdate,
    current_user: User = Depends(get_current_user),
):
    """Update an existing SQL script."""
    user_dir = get_user_scripts_dir(current_user.id)
    safe_name = sanitize_filename(name)
    filepath = os.path.join(user_dir, f"{safe_name}.sql")

    # Create if not exists (auto-save behavior)
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(data.content)

    stat = os.stat(filepath)
    return SqlScriptResponse(
        name=safe_name,
        content=data.content,
        size=stat.st_size,
        modified_at=datetime.fromtimestamp(stat.st_mtime),
    )


@router.delete("/{name}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_script(
    name: str,
    current_user: User = Depends(get_current_user),
):
    """Delete a SQL script."""
    user_dir = get_user_scripts_dir(current_user.id)
    safe_name = sanitize_filename(name)
    filepath = os.path.join(user_dir, f"{safe_name}.sql")

    if not os.path.exists(filepath):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Script not found"
        )

    os.remove(filepath)


@router.post("/{name}/rename", response_model=SqlScriptResponse)
async def rename_script(
    name: str,
    new_name: str,
    current_user: User = Depends(get_current_user),
):
    """Rename a SQL script."""
    user_dir = get_user_scripts_dir(current_user.id)
    safe_name = sanitize_filename(name)
    safe_new_name = sanitize_filename(new_name)

    old_path = os.path.join(user_dir, f"{safe_name}.sql")
    new_path = os.path.join(user_dir, f"{safe_new_name}.sql")

    if not os.path.exists(old_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Script not found"
        )

    if os.path.exists(new_path):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A script with the new name already exists"
        )

    os.rename(old_path, new_path)

    stat = os.stat(new_path)
    with open(new_path, 'r', encoding='utf-8') as f:
        content = f.read()

    return SqlScriptResponse(
        name=safe_new_name,
        content=content,
        size=stat.st_size,
        modified_at=datetime.fromtimestamp(stat.st_mtime),
    )
