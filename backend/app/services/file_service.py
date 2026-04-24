"""
File upload, download, and processing service.
"""
import os
import uuid
from typing import Optional, List, Any, BinaryIO
from datetime import datetime

import pandas as pd
from fastapi import UploadFile
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.config import settings
from app.models.file import File, FileType, FileStatus
from app.schemas.file import FilePreview


class FileService:
    """Service for file operations."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.upload_dir = settings.UPLOAD_DIR
        os.makedirs(self.upload_dir, exist_ok=True)

    def _get_file_type(self, filename: str) -> FileType:
        """Determine file type from extension."""
        ext = filename.lower().split(".")[-1]
        if ext in ("xlsx", "xls"):
            return FileType.EXCEL
        elif ext == "csv":
            return FileType.CSV
        elif ext == "json":
            return FileType.JSON
        raise ValueError(f"Unsupported file type: {ext}")

    async def upload(self, file: UploadFile, user_id: int) -> File:
        """Upload a file and save metadata."""
        # Generate unique stored name
        file_type = self._get_file_type(file.filename)
        stored_name = f"{uuid.uuid4().hex}_{file.filename}"
        storage_path = os.path.join(self.upload_dir, stored_name)

        # Save file to disk
        content = await file.read()
        file_size = len(content)

        with open(storage_path, "wb") as f:
            f.write(content)

        # Create database record
        file_record = File(
            original_name=file.filename,
            stored_name=stored_name,
            file_type=file_type,
            file_size=file_size,
            storage_path=storage_path,
            status=FileStatus.UPLOADED,
            user_id=user_id,
        )
        self.db.add(file_record)
        await self.db.flush()
        await self.db.refresh(file_record)
        return file_record

    async def get_by_id(self, file_id: int) -> Optional[File]:
        """Get file by ID."""
        result = await self.db.execute(select(File).where(File.id == file_id))
        return result.scalar_one_or_none()

    async def get_user_files(
        self, user_id: int, skip: int = 0, limit: int = 100
    ) -> List[File]:
        """Get files uploaded by a user."""
        result = await self.db.execute(
            select(File)
            .where(File.user_id == user_id)
            .order_by(File.created_at.desc())
            .offset(skip)
            .limit(limit)
        )
        return list(result.scalars().all())

    def preview(self, file_record: File, rows: int = 100) -> FilePreview:
        """Preview file contents."""
        df = self._read_file(file_record, nrows=rows)

        # Convert to preview format
        columns = df.columns.tolist()
        data_rows = df.values.tolist()

        # Get total row count
        total_df = self._read_file(file_record)
        total_rows = len(total_df)

        return FilePreview(
            columns=columns,
            rows=data_rows,
            total_rows=total_rows,
            preview_rows=len(data_rows),
        )

    def _read_file(self, file_record: File, nrows: Optional[int] = None) -> pd.DataFrame:
        """Read file into DataFrame."""
        path = file_record.storage_path

        if file_record.file_type == FileType.CSV:
            return pd.read_csv(path, nrows=nrows)
        elif file_record.file_type == FileType.EXCEL:
            return pd.read_excel(path, nrows=nrows)
        elif file_record.file_type == FileType.JSON:
            df = pd.read_json(path)
            if nrows:
                df = df.head(nrows)
            return df
        raise ValueError(f"Unsupported file type: {file_record.file_type}")

    def get_dataframe(self, file_record: File) -> pd.DataFrame:
        """Get file contents as DataFrame."""
        return self._read_file(file_record)

    async def delete(self, file_record: File) -> None:
        """Delete file from disk and database."""
        # Remove from disk
        if os.path.exists(file_record.storage_path):
            os.remove(file_record.storage_path)

        # Remove from database
        await self.db.delete(file_record)
        await self.db.flush()

    def export_to_excel(self, df: pd.DataFrame, filename: str) -> str:
        """Export DataFrame to Excel file."""
        export_path = os.path.join(self.upload_dir, f"export_{uuid.uuid4().hex}_{filename}.xlsx")
        df.to_excel(export_path, index=False)
        return export_path

    def export_to_csv(self, df: pd.DataFrame, filename: str) -> str:
        """Export DataFrame to CSV file."""
        export_path = os.path.join(self.upload_dir, f"export_{uuid.uuid4().hex}_{filename}.csv")
        df.to_csv(export_path, index=False)
        return export_path
