"""
Python 运行环境 API：登记已有解释器 / 新建托管 venv / 装包 / 列包 / 删除。
供脚本"手动运行"选择在哪个环境里执行。
"""
from typing import List
import os
import sys
import shutil
import asyncio
import subprocess

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.config import settings
from app.api.deps import get_current_user
from app.models.user import User
from app.models.py_env import PyEnv
from app.schemas.py_env import (
    PyEnvRegister, PyEnvCreateVenv, PyEnvInstall, PyEnvResponse,
)

router = APIRouter()


def _venvs_root() -> str:
    return os.path.join(os.path.abspath(settings.UPLOAD_DIR), "_venvs")


def _venv_python(venv_dir: str) -> str:
    if os.name == "nt":
        return os.path.join(venv_dir, "Scripts", "python.exe")
    return os.path.join(venv_dir, "bin", "python")


def _run(cmd: list, timeout: int) -> tuple:
    """在线程里跑（避开 Windows 事件循环子进程限制）。返回 (returncode, output)。"""
    try:
        p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout)
        return p.returncode, (p.stdout or b"").decode(errors="replace")
    except subprocess.TimeoutExpired:
        return -1, f"超时（>{timeout}s）"
    except Exception as ex:
        return -1, f"执行失败: {ex}"


async def _arun(cmd: list, timeout: int) -> tuple:
    return await asyncio.to_thread(_run, cmd, timeout)


async def _python_version(python_path: str) -> str:
    rc, out = await _arun([python_path, "--version"], 15)
    return out.strip() if rc == 0 else ""


@router.get("/", response_model=List[PyEnvResponse])
async def list_envs(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(PyEnv).order_by(PyEnv.created_at.desc()))
    return result.scalars().all()


@router.get("/discover", response_model=dict)
async def discover_envs(
    current_user: User = Depends(get_current_user),
):
    """自动发现候选解释器（当前后端解释器 + conda 环境），供登记时选择。"""
    candidates = [{"name": "后端默认环境", "python_path": sys.executable}]
    # 尝试列 conda 环境
    rc, out = await _arun(["conda", "env", "list"], 15)
    if rc == 0:
        for line in out.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split()
            env_dir = parts[-1]
            if not os.path.isdir(env_dir):
                continue
            py = os.path.join(env_dir, "python.exe") if os.name == "nt" else os.path.join(env_dir, "bin", "python")
            if os.path.exists(py) and py != sys.executable:
                candidates.append({"name": f"conda:{os.path.basename(env_dir)}", "python_path": py})
    return {"candidates": candidates}


@router.post("/register", response_model=PyEnvResponse)
async def register_env(
    data: PyEnvRegister,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """登记一个已有解释器。"""
    if not os.path.exists(data.python_path):
        raise HTTPException(status_code=400, detail="解释器路径不存在")
    version = await _python_version(data.python_path)
    if not version:
        raise HTTPException(status_code=400, detail="该路径不是可用的 Python 解释器")

    dup = await db.execute(select(PyEnv).where(PyEnv.name == data.name))
    if dup.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="环境名称已存在")

    env = PyEnv(
        name=data.name,
        description=data.description,
        python_path=data.python_path,
        kind="external",
        status="ready",
        python_version=version,
    )
    db.add(env)
    await db.commit()
    await db.refresh(env)
    return env


@router.post("/create-venv", response_model=PyEnvResponse)
async def create_venv(
    data: PyEnvCreateVenv,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """新建平台托管的虚拟环境（python -m venv）。"""
    dup = await db.execute(select(PyEnv).where(PyEnv.name == data.name))
    if dup.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="环境名称已存在")

    safe = "".join(c for c in data.name if c.isalnum() or c in "_-") or "venv"
    venv_dir = os.path.join(_venvs_root(), safe)
    os.makedirs(_venvs_root(), exist_ok=True)
    if os.path.exists(venv_dir):
        shutil.rmtree(venv_dir, ignore_errors=True)

    base = data.base_python or sys.executable
    rc, out = await _arun([base, "-m", "venv", venv_dir], 180)
    py = _venv_python(venv_dir)
    if rc != 0 or not os.path.exists(py):
        raise HTTPException(status_code=500, detail=f"创建 venv 失败：{out[-500:]}")

    version = await _python_version(py)
    env = PyEnv(
        name=data.name,
        description=data.description,
        python_path=py,
        kind="managed",
        status="ready",
        python_version=version,
        last_log=out[-4000:],
    )
    db.add(env)
    await db.commit()
    await db.refresh(env)
    return env


@router.post("/{env_id}/install", response_model=dict)
async def install_packages(
    env_id: int,
    data: PyEnvInstall,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """在该环境里 pip install 包。"""
    result = await db.execute(select(PyEnv).where(PyEnv.id == env_id))
    env = result.scalar_one_or_none()
    if not env:
        raise HTTPException(status_code=404, detail="环境不存在")

    pkgs = []
    if data.packages:
        pkgs = data.packages.split()
        cmd = [env.python_path, "-m", "pip", "install", *pkgs]
    elif data.requirements:
        # 把 requirements 写到临时文件再装
        req_dir = os.path.join(_venvs_root(), "_req")
        os.makedirs(req_dir, exist_ok=True)
        req_path = os.path.join(req_dir, f"req_{env_id}.txt")
        with open(req_path, "w", encoding="utf-8") as f:
            f.write(data.requirements)
        cmd = [env.python_path, "-m", "pip", "install", "-r", req_path]
    else:
        raise HTTPException(status_code=400, detail="请填写要安装的包或 requirements")

    rc, out = await _arun(cmd, 600)
    env.last_log = out[-8000:]
    await db.commit()
    return {"success": rc == 0, "output": out[-8000:], "message": "安装成功" if rc == 0 else "安装失败"}


@router.get("/{env_id}/packages", response_model=dict)
async def list_packages(
    env_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """列出该环境已安装的包（pip list）。"""
    result = await db.execute(select(PyEnv).where(PyEnv.id == env_id))
    env = result.scalar_one_or_none()
    if not env:
        raise HTTPException(status_code=404, detail="环境不存在")
    rc, out = await _arun([env.python_path, "-m", "pip", "list", "--format=freeze"], 60)
    return {"success": rc == 0, "output": out}


@router.delete("/{env_id}", response_model=dict)
async def delete_env(
    env_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """删除环境。托管 venv 会删目录；外部环境仅取消登记。"""
    result = await db.execute(select(PyEnv).where(PyEnv.id == env_id))
    env = result.scalar_one_or_none()
    if not env:
        raise HTTPException(status_code=404, detail="环境不存在")
    if env.kind == "managed":
        venv_dir = os.path.dirname(os.path.dirname(env.python_path))  # 由 python 路径回推 venv 根
        if os.path.isdir(venv_dir) and os.path.abspath(_venvs_root()) in os.path.abspath(venv_dir):
            shutil.rmtree(venv_dir, ignore_errors=True)
    await db.delete(env)
    await db.commit()
    return {"success": True, "message": "已删除"}
