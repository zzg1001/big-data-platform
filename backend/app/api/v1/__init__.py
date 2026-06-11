"""
API v1 router.
"""
from fastapi import APIRouter

from app.api.v1 import auth, datasources, queries, files, schedules, ai, lineage, users, sync, sync_schedule, system_config, warehouse, etl, dw_layers, task_dependencies, sql_scripts, tags

api_router = APIRouter()

api_router.include_router(auth.router, prefix="/auth", tags=["Authentication"])
api_router.include_router(users.router, prefix="/users", tags=["Users"])
api_router.include_router(datasources.router, prefix="/datasources", tags=["Data Sources"])
api_router.include_router(queries.router, prefix="/queries", tags=["Queries"])
api_router.include_router(files.router, prefix="/files", tags=["Files"])
api_router.include_router(sync.router, prefix="/sync", tags=["Data Sync"])
api_router.include_router(sync_schedule.router, prefix="/sync-schedules", tags=["Sync Schedules"])
api_router.include_router(warehouse.router, prefix="/warehouse", tags=["Warehouse Explorer"])
api_router.include_router(schedules.router, prefix="/schedules", tags=["Schedules"])
api_router.include_router(ai.router, prefix="/ai", tags=["AI Assistant"])
api_router.include_router(lineage.router, prefix="/lineage", tags=["Lineage"])
api_router.include_router(system_config.router, prefix="/config", tags=["System Config"])
api_router.include_router(etl.router, prefix="/etl", tags=["ETL Tasks"])
api_router.include_router(dw_layers.router, prefix="/dw-layers", tags=["DW Layers"])
api_router.include_router(task_dependencies.router, prefix="/task-dependencies", tags=["Task Dependencies"])
api_router.include_router(sql_scripts.router, prefix="/sql-scripts", tags=["SQL Scripts"])
api_router.include_router(tags.router, prefix="/tags", tags=["Tags"])
