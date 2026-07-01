"""
脚本同步 API：上传 Python 程序（.py / .zip），生成 Airflow DAG 提交运行。
"""
from typing import List, Optional
from datetime import datetime
import os
import re
import sys
import shutil
import zipfile
import asyncio
import subprocess

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File as FastAPIFile, Form
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.config import settings
from app.api.deps import get_current_user
from app.models.user import User
from app.models.script_task import ScriptTask, ScriptStatus
from app.models.py_env import PyEnv
from app.schemas.script_sync import ScriptTaskResponse, ScriptTaskUpdate
from app.services.airflow_service import airflow_service, AirflowAPIError

router = APIRouter()

# Airflow worker 容器内的固定 dags 根目录（DAG 运行时引用的路径，与 backend 写入路径映射到同一宿主机目录）
CONTAINER_DAGS_ROOT = "/opt/airflow/dags"


def _dags_path() -> str:
    """后端写 DAG 文件的目录。"""
    return settings.AIRFLOW_DAGS_PATH or "/opt/airflow/dags/generated"


def _scripts_root() -> str:
    """后端写上传脚本的根目录（与 dags 同级的 user_scripts）。"""
    return os.path.join(os.path.dirname(_dags_path()), "user_scripts")


def _script_dir(task_id: int) -> str:
    """某任务在后端文件系统的脚本目录。"""
    return os.path.join(_scripts_root(), str(task_id))


def _container_script_dir(task_id: int) -> str:
    """某任务在 Airflow 容器内的脚本目录（DAG 里用这个路径）。"""
    return f"{CONTAINER_DAGS_ROOT}/user_scripts/{task_id}"


def _ensure_airflowignore() -> None:
    """确保 dags 根目录的 .airflowignore 含 user_scripts/，避免 Airflow 把用户脚本当 DAG 解析。"""
    dags_root = os.path.dirname(_dags_path())
    try:
        os.makedirs(dags_root, exist_ok=True)
        ignore_path = os.path.join(dags_root, ".airflowignore")
        existing = ""
        if os.path.exists(ignore_path):
            with open(ignore_path, "r", encoding="utf-8") as f:
                existing = f.read()
        if "user_scripts" not in existing:
            with open(ignore_path, "a", encoding="utf-8") as f:
                f.write(("\n" if existing and not existing.endswith("\n") else "") + "user_scripts/\n")
    except Exception as e:
        print(f"Warning: failed to write .airflowignore: {e}")


def _safe_name(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9_]", "_", name)[:20] or "script"


@router.post("/upload", response_model=ScriptTaskResponse)
async def upload_script(
    file: UploadFile = FastAPIFile(...),
    name: str = Form(...),
    description: Optional[str] = Form(None),
    entrypoint: Optional[str] = Form(None),
    cron_expression: Optional[str] = Form(None),
    env_id: Optional[int] = Form(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """上传 Python 程序（.py 或 .zip），创建脚本同步任务。"""
    filename = file.filename or "script"
    lower = filename.lower()
    if not (lower.endswith(".py") or lower.endswith(".zip")):
        raise HTTPException(status_code=400, detail="仅支持 .py 或 .zip 文件")

    # 1. 先建任务拿到 id
    task = ScriptTask(
        name=name,
        description=description,
        original_filename=filename,
        cron_expression=cron_expression,
        env_id=env_id,
        status=ScriptStatus.DRAFT,
        created_by=current_user.id,
    )
    db.add(task)
    await db.flush()  # 拿到 task.id

    # 2. 准备脚本目录（先清空旧的，幂等）
    target_dir = _script_dir(task.id)
    try:
        if os.path.exists(target_dir):
            shutil.rmtree(target_dir)
        os.makedirs(target_dir, exist_ok=True)

        content = await file.read()

        if lower.endswith(".py"):
            # 单文件：入口就是该文件
            entry = os.path.basename(filename)
            with open(os.path.join(target_dir, entry), "wb") as f:
                f.write(content)
            task.entrypoint = entry
        else:
            # zip：先落盘再解压
            zip_path = os.path.join(target_dir, "_upload.zip")
            with open(zip_path, "wb") as f:
                f.write(content)
            with zipfile.ZipFile(zip_path, "r") as zf:
                zf.extractall(target_dir)
            os.remove(zip_path)
            entry = entrypoint or "main.py"
            if not os.path.exists(os.path.join(target_dir, entry)):
                raise HTTPException(status_code=400, detail=f"压缩包内未找到入口文件「{entry}」，请确认入口文件名")
            task.entrypoint = entry

        # 3. 检测 requirements.txt
        task.has_requirements = os.path.exists(os.path.join(target_dir, "requirements.txt"))
    except HTTPException:
        # 回滚目录与任务
        if os.path.exists(target_dir):
            shutil.rmtree(target_dir, ignore_errors=True)
        await db.rollback()
        raise
    except Exception as e:
        if os.path.exists(target_dir):
            shutil.rmtree(target_dir, ignore_errors=True)
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"保存脚本失败: {str(e)}")

    # 4. 确保 .airflowignore
    _ensure_airflowignore()

    await db.commit()
    await db.refresh(task)
    return task


@router.get("/", response_model=List[ScriptTaskResponse])
async def list_scripts(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(ScriptTask).order_by(ScriptTask.created_at.desc()))
    return result.scalars().all()


@router.get("/{task_id}", response_model=ScriptTaskResponse)
async def get_script(
    task_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(ScriptTask).where(ScriptTask.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="脚本任务不存在")
    return task


@router.put("/{task_id}", response_model=ScriptTaskResponse)
async def update_script(
    task_id: int,
    data: ScriptTaskUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(ScriptTask).where(ScriptTask.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="脚本任务不存在")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(task, k, v)
    await db.commit()
    await db.refresh(task)
    return task


def _build_dag(task: ScriptTask) -> str:
    """生成脚本任务的 Airflow DAG 内容（BashOperator 运行用户脚本）。"""
    script_dir = _container_script_dir(task.id)
    pip = "pip install --user -r requirements.txt && " if task.has_requirements else ""
    bash_command = f"cd {script_dir} && {pip}python {task.entrypoint}"
    schedule_repr = repr(task.cron_expression) if task.cron_expression else "None"
    return f'''"""
Auto-generated Airflow DAG for script sync task: {task.name}
Task ID: {task.id}
"""
from datetime import datetime, timedelta
from airflow import DAG
from airflow.operators.bash import BashOperator

default_args = {{
    'owner': 'data_platform',
    'depends_on_past': False,
    'retries': 0,
    'retry_delay': timedelta(minutes=5),
}}

with DAG(
    dag_id='{task.dag_id}',
    default_args=default_args,
    description={repr(task.description or task.name)},
    schedule_interval={schedule_repr},
    start_date=datetime(2024, 1, 1),
    catchup=False,
    is_paused_upon_creation=False,
    tags=['script_sync', 'auto_generated'],
) as dag:
    run_script = BashOperator(
        task_id='run_script',
        bash_command={repr(bash_command)},
    )
'''


def _write_dag_file(task: ScriptTask) -> None:
    """生成并写入 DAG 文件到 AIRFLOW_DAGS_PATH。"""
    dag_content = _build_dag(task)
    dag_path = os.path.join(_dags_path(), f"{task.dag_id}.py")
    os.makedirs(os.path.dirname(dag_path), exist_ok=True)
    with open(dag_path, "w", encoding="utf-8") as f:
        f.write(dag_content)


@router.post("/{task_id}/deploy", response_model=dict)
async def deploy_script(
    task_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """上线：生成 DAG 文件并在 Airflow 启用。"""
    result = await db.execute(select(ScriptTask).where(ScriptTask.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="脚本任务不存在")

    try:
        await airflow_service.check_connectivity()
    except AirflowAPIError as e:
        raise HTTPException(status_code=503, detail=f"Airflow服务不可用: {e.message}")

    if not task.dag_id:
        task.dag_id = f"script_{task.id}_{_safe_name(task.name)}"

    try:
        _write_dag_file(task)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DAG文件保存失败: {str(e)}")

    task.is_scheduled = True
    task.status = ScriptStatus.ACTIVE
    task.airflow_status = "active"
    await db.commit()

    try:
        await airflow_service.enable_dag_simple(task.dag_id)
    except AirflowAPIError:
        pass  # DAG 文件已生成，Airflow 稍后会扫到

    return {"success": True, "dag_id": task.dag_id, "message": "脚本任务已上线"}


@router.post("/{task_id}/run", response_model=dict)
async def run_script(
    task_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """手动执行：直接在当前后端环境里跑脚本（不经过 Airflow），同步返回输出。"""
    result = await db.execute(select(ScriptTask).where(ScriptTask.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="脚本任务不存在")

    script_dir = _script_dir(task.id)
    entry = task.entrypoint or "main.py"
    if not os.path.exists(os.path.join(script_dir, entry)):
        raise HTTPException(status_code=400, detail="脚本文件不存在，请重新上传")

    # 解析运行环境：绑定了运行环境就用它的解释器，否则用后端默认解释器
    python_exe = sys.executable
    env_label = "后端默认环境"
    if task.env_id:
        envres = await db.execute(select(PyEnv).where(PyEnv.id == task.env_id))
        env = envres.scalar_one_or_none()
        if env and os.path.exists(env.python_path):
            python_exe = env.python_path
            env_label = env.name
        elif env:
            env_label = f"{env.name}（解释器路径不存在，已回退后端默认）"

    logs = [f"[env] 运行环境：{env_label}\n[env] 解释器：{python_exe}\n"]

    def _run_sync(cmd: list, label: str, timeout: int) -> int:
        # 用阻塞 subprocess 跑（在线程里调用，避开 Windows 事件循环不支持子进程的限制）
        try:
            p = subprocess.run(
                cmd, cwd=script_dir,
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout,
            )
            if p.stdout:
                logs.append(f"[{label}]\n" + p.stdout.decode(errors="replace"))
            return p.returncode
        except subprocess.TimeoutExpired as e:
            if e.stdout:
                out = e.stdout if isinstance(e.stdout, bytes) else str(e.stdout).encode()
                logs.append(f"[{label}]\n" + out.decode(errors="replace"))
            logs.append(f"[{label}] 超时（>{timeout}s）已终止")
            return -1
        except Exception as ex:
            logs.append(f"[{label}] 启动失败: {ex}")
            return -1

    # 若带 requirements.txt，先在所选环境安装依赖（best-effort）
    if task.has_requirements and os.path.exists(os.path.join(script_dir, "requirements.txt")):
        await asyncio.to_thread(_run_sync, [python_exe, "-m", "pip", "install", "-r", "requirements.txt"], "pip install", 300)

    # 执行脚本（用所选运行环境的解释器）
    rc = await asyncio.to_thread(_run_sync, [python_exe, entry], "run", 600)
    output = "\n".join(logs)[-8000:]
    success = rc == 0

    task.last_run_at = datetime.utcnow()
    task.last_run_status = "success" if success else "failed"
    # 复用 last_error 字段存最近一次运行的完整输出（成功/失败都存），供"查看日志"
    task.last_error = output or "(无输出)"
    await db.commit()

    return {
        "success": success,
        "returncode": rc,
        "output": output,
        "message": "执行成功" if success else f"执行失败（退出码 {rc}）",
    }


@router.post("/{task_id}/disable", response_model=dict)
async def disable_script(
    task_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """下线：暂停 DAG。"""
    result = await db.execute(select(ScriptTask).where(ScriptTask.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="脚本任务不存在")
    if task.dag_id:
        try:
            await airflow_service.pause_dag(task.dag_id)
        except AirflowAPIError:
            pass
    task.is_scheduled = False
    task.status = ScriptStatus.PAUSED
    task.airflow_status = "paused"
    await db.commit()
    return {"success": True, "message": "脚本任务已下线"}


@router.post("/{task_id}/unschedule", response_model=dict)
async def unschedule_script(
    task_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """移出调度：暂停并删除 DAG、清空调度信息，但保留任务和已上传的脚本文件。"""
    result = await db.execute(select(ScriptTask).where(ScriptTask.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="脚本任务不存在")

    if task.dag_id:
        try:
            await airflow_service.pause_dag(task.dag_id)
        except AirflowAPIError:
            pass
        dag_path = os.path.join(_dags_path(), f"{task.dag_id}.py")
        if os.path.exists(dag_path):
            try:
                os.remove(dag_path)
            except Exception as e:
                print(f"Warning: failed to delete DAG file {dag_path}: {e}")
        try:
            await airflow_service.delete_dag_with_confirmation(task.dag_id)
        except AirflowAPIError:
            pass

    task.is_scheduled = False
    task.cron_expression = None
    task.dag_id = None
    task.airflow_status = None
    task.status = ScriptStatus.DRAFT
    await db.commit()
    return {"success": True, "message": "已移出调度"}


@router.delete("/{task_id}", response_model=dict)
async def delete_script(
    task_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """删除任务：清理脚本目录、DAG 文件和 Airflow 中的 DAG。"""
    result = await db.execute(select(ScriptTask).where(ScriptTask.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="脚本任务不存在")

    # 删 DAG 文件
    if task.dag_id:
        dag_path = os.path.join(_dags_path(), f"{task.dag_id}.py")
        if os.path.exists(dag_path):
            try:
                os.remove(dag_path)
            except Exception as e:
                print(f"Warning: failed to delete DAG file {dag_path}: {e}")
        try:
            await airflow_service.delete_dag_with_confirmation(task.dag_id)
        except AirflowAPIError:
            pass

    # 删脚本目录
    sdir = _script_dir(task.id)
    if os.path.exists(sdir):
        shutil.rmtree(sdir, ignore_errors=True)

    await db.delete(task)
    await db.commit()
    return {"success": True, "message": "已删除"}
