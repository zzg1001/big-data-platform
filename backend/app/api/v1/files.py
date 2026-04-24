"""
File management API endpoints.
"""
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File as FastAPIFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import pandas as pd

from app.core.database import get_db
from app.api.deps import get_current_user
from app.models.user import User
from app.models.file import File, FileStatus
from app.models.datasource import DataSource
from app.schemas.file import FileUploadResponse, FileResponse as FileResponseSchema, FilePreview, FileImportRequest
from app.services.file_service import FileService
from app.services.db_connector import DatabaseConnector

router = APIRouter()


@router.post("/upload", response_model=FileUploadResponse)
async def upload_file(
    file: UploadFile = FastAPIFile(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upload a file (Excel, CSV, JSON)."""
    # Validate file type
    if not file.filename:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No filename provided")

    ext = file.filename.lower().split(".")[-1]
    if ext not in ("xlsx", "xls", "csv", "json"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported file type. Supported: xlsx, xls, csv, json",
        )

    file_service = FileService(db)
    try:
        file_record = await file_service.upload(file, current_user.id)
        return file_record
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get("/", response_model=List[FileResponseSchema])
async def list_files(
    skip: int = 0,
    limit: int = 100,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List user's uploaded files."""
    file_service = FileService(db)
    files = await file_service.get_user_files(current_user.id, skip=skip, limit=limit)
    return files


@router.get("/{file_id}", response_model=FileResponseSchema)
async def get_file(
    file_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get file metadata."""
    file_service = FileService(db)
    file_record = await file_service.get_by_id(file_id)

    if not file_record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")

    if file_record.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    return file_record


@router.get("/{file_id}/preview", response_model=FilePreview)
async def preview_file(
    file_id: int,
    rows: int = 100,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Preview file contents (first N rows)."""
    file_service = FileService(db)
    file_record = await file_service.get_by_id(file_id)

    if not file_record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")

    if file_record.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    try:
        preview = file_service.preview(file_record, rows=min(rows, 1000))
        return preview
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get("/{file_id}/download")
async def download_file(
    file_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Download a file."""
    file_service = FileService(db)
    file_record = await file_service.get_by_id(file_id)

    if not file_record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")

    if file_record.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    return FileResponse(
        path=file_record.storage_path,
        filename=file_record.original_name,
        media_type="application/octet-stream",
    )


@router.delete("/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_file(
    file_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a file."""
    file_service = FileService(db)
    file_record = await file_service.get_by_id(file_id)

    if not file_record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")

    if file_record.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    await file_service.delete(file_record)


@router.post("/{file_id}/import", response_model=FileResponseSchema)
async def import_file_to_database(
    file_id: int,
    import_request: FileImportRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Import file data to a database table."""
    file_service = FileService(db)
    file_record = await file_service.get_by_id(file_id)

    if not file_record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")

    if file_record.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    # Get datasource
    result = await db.execute(
        select(DataSource).where(DataSource.id == import_request.datasource_id)
    )
    datasource = result.scalar_one_or_none()
    if not datasource:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Datasource not found")

    try:
        # Update status
        file_record.status = FileStatus.PROCESSING
        await db.flush()

        # Get DataFrame
        df = file_service.get_dataframe(file_record)

        # Apply column mappings if provided
        if import_request.column_mappings:
            df = df.rename(columns=import_request.column_mappings)

        # Get engine and import
        engine = DatabaseConnector.get_engine(
            datasource_id=datasource.id,
            db_type=datasource.type,
            host=datasource.host,
            port=datasource.port,
            database=datasource.database,
            username=datasource.username,
            encrypted_password=datasource.encrypted_password,
            schema_name=datasource.schema_name,
            service_name=datasource.service_name,
        )

        df.to_sql(
            name=import_request.table_name,
            con=engine,
            schema=datasource.schema_name,
            if_exists=import_request.if_exists,
            index=False,
        )

        # Update file record
        file_record.status = FileStatus.COMPLETED
        file_record.target_datasource_id = datasource.id
        file_record.target_table = import_request.table_name
        await db.flush()
        await db.refresh(file_record)

        return file_record

    except Exception as e:
        file_record.status = FileStatus.FAILED
        file_record.error_message = str(e)
        await db.flush()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.post("/export/excel")
async def export_to_excel(
    datasource_id: int,
    sql: str,
    filename: str = "export",
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Export query results to Excel."""
    # Get datasource
    result = await db.execute(select(DataSource).where(DataSource.id == datasource_id))
    datasource = result.scalar_one_or_none()
    if not datasource:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Datasource not found")

    try:
        engine = DatabaseConnector.get_engine(
            datasource_id=datasource.id,
            db_type=datasource.type,
            host=datasource.host,
            port=datasource.port,
            database=datasource.database,
            username=datasource.username,
            encrypted_password=datasource.encrypted_password,
            schema_name=datasource.schema_name,
            service_name=datasource.service_name,
        )

        df = pd.read_sql(sql, engine)

        file_service = FileService(db)
        export_path = file_service.export_to_excel(df, filename)

        return FileResponse(
            path=export_path,
            filename=f"{filename}.xlsx",
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )

    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
