"""
Data Service API - API Key management and Open Data Access.
"""
import secrets
import hashlib
import json
import uuid
import time
from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query, Request
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import text

from app.core.database import get_db
from app.api.deps import get_current_user, get_api_key
from app.api.v1.warehouse import get_warehouse_engine
from app.models.user import User
from app.models.api_key import ApiKey, ApiAccessLog
from app.models.tag import TagNode
from app.schemas.data_service import (
    ApiKeyCreate,
    ApiKeyUpdate,
    ApiKeyResponse,
    ApiKeyCreateResponse,
    TagListItem,
    TagDetailResponse,
    TagDataResponse,
    PaginationInfo,
    OpenApiResponse,
    ApiStatsOverview,
    AccessLogItem,
    AccessLogResponse,
)

router = APIRouter()


def generate_api_key() -> tuple[str, str, str]:
    """Generate API Key.

    Returns:
        (full_key, key_prefix, key_hash)
    """
    random_part = secrets.token_hex(32)
    full_key = f"bdk_{random_part}"
    key_prefix = f"bdk_{random_part[:8]}****"
    key_hash = hashlib.sha256(full_key.encode()).hexdigest()
    return full_key, key_prefix, key_hash


# ==================== API Key Management (JWT Auth) ====================

@router.post("/keys", response_model=ApiKeyCreateResponse, status_code=status.HTTP_201_CREATED)
async def create_api_key(
    data: ApiKeyCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new API Key."""
    full_key, key_prefix, key_hash = generate_api_key()

    api_key = ApiKey(
        name=data.name,
        description=data.description,
        key_prefix=key_prefix,
        key_hash=key_hash,
        scope_type=data.scope_type,
        scope_ids=json.dumps(data.scope_ids) if data.scope_ids else None,
        rate_limit=data.rate_limit,
        expires_at=data.expires_at,
        created_by=current_user.id,
    )

    db.add(api_key)
    await db.commit()
    await db.refresh(api_key)

    # Return with full key (only shown once)
    return ApiKeyCreateResponse(
        id=api_key.id,
        name=api_key.name,
        description=api_key.description,
        key_prefix=api_key.key_prefix,
        api_key=full_key,
        scope_type=api_key.scope_type,
        scope_ids=json.loads(api_key.scope_ids) if api_key.scope_ids else None,
        rate_limit=api_key.rate_limit,
        expires_at=api_key.expires_at,
        is_active=api_key.is_active,
        last_used_at=api_key.last_used_at,
        total_requests=api_key.total_requests,
        created_at=api_key.created_at,
        updated_at=api_key.updated_at,
    )


@router.get("/keys", response_model=List[ApiKeyResponse])
async def list_api_keys(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all API Keys created by current user."""
    result = await db.execute(
        select(ApiKey)
        .where(ApiKey.created_by == current_user.id)
        .order_by(ApiKey.created_at.desc())
    )
    keys = result.scalars().all()

    return [
        ApiKeyResponse(
            id=key.id,
            name=key.name,
            description=key.description,
            key_prefix=key.key_prefix,
            scope_type=key.scope_type,
            scope_ids=json.loads(key.scope_ids) if key.scope_ids else None,
            rate_limit=key.rate_limit,
            expires_at=key.expires_at,
            is_active=key.is_active,
            last_used_at=key.last_used_at,
            total_requests=key.total_requests,
            created_at=key.created_at,
            updated_at=key.updated_at,
        )
        for key in keys
    ]


@router.get("/keys/{key_id}", response_model=ApiKeyResponse)
async def get_api_key_detail(
    key_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get API Key details."""
    result = await db.execute(
        select(ApiKey).where(
            ApiKey.id == key_id,
            ApiKey.created_by == current_user.id
        )
    )
    key = result.scalar_one_or_none()

    if not key:
        raise HTTPException(status_code=404, detail="API Key not found")

    return ApiKeyResponse(
        id=key.id,
        name=key.name,
        description=key.description,
        key_prefix=key.key_prefix,
        scope_type=key.scope_type,
        scope_ids=json.loads(key.scope_ids) if key.scope_ids else None,
        rate_limit=key.rate_limit,
        expires_at=key.expires_at,
        is_active=key.is_active,
        last_used_at=key.last_used_at,
        total_requests=key.total_requests,
        created_at=key.created_at,
        updated_at=key.updated_at,
    )


@router.put("/keys/{key_id}", response_model=ApiKeyResponse)
async def update_api_key(
    key_id: int,
    data: ApiKeyUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update API Key."""
    result = await db.execute(
        select(ApiKey).where(
            ApiKey.id == key_id,
            ApiKey.created_by == current_user.id
        )
    )
    key = result.scalar_one_or_none()

    if not key:
        raise HTTPException(status_code=404, detail="API Key not found")

    update_data = data.model_dump(exclude_unset=True)
    if "scope_ids" in update_data and update_data["scope_ids"] is not None:
        update_data["scope_ids"] = json.dumps(update_data["scope_ids"])

    for field, value in update_data.items():
        setattr(key, field, value)

    await db.commit()
    await db.refresh(key)

    return ApiKeyResponse(
        id=key.id,
        name=key.name,
        description=key.description,
        key_prefix=key.key_prefix,
        scope_type=key.scope_type,
        scope_ids=json.loads(key.scope_ids) if key.scope_ids else None,
        rate_limit=key.rate_limit,
        expires_at=key.expires_at,
        is_active=key.is_active,
        last_used_at=key.last_used_at,
        total_requests=key.total_requests,
        created_at=key.created_at,
        updated_at=key.updated_at,
    )


@router.delete("/keys/{key_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_api_key(
    key_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete API Key."""
    result = await db.execute(
        select(ApiKey).where(
            ApiKey.id == key_id,
            ApiKey.created_by == current_user.id
        )
    )
    key = result.scalar_one_or_none()

    if not key:
        raise HTTPException(status_code=404, detail="API Key not found")

    await db.delete(key)
    await db.commit()


@router.post("/keys/{key_id}/regenerate", response_model=ApiKeyCreateResponse)
async def regenerate_api_key(
    key_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Regenerate API Key (old key becomes invalid immediately)."""
    result = await db.execute(
        select(ApiKey).where(
            ApiKey.id == key_id,
            ApiKey.created_by == current_user.id
        )
    )
    key = result.scalar_one_or_none()

    if not key:
        raise HTTPException(status_code=404, detail="API Key not found")

    # Generate new key
    full_key, key_prefix, key_hash = generate_api_key()
    key.key_prefix = key_prefix
    key.key_hash = key_hash
    key.total_requests = 0
    key.last_used_at = None

    await db.commit()
    await db.refresh(key)

    return ApiKeyCreateResponse(
        id=key.id,
        name=key.name,
        description=key.description,
        key_prefix=key.key_prefix,
        api_key=full_key,
        scope_type=key.scope_type,
        scope_ids=json.loads(key.scope_ids) if key.scope_ids else None,
        rate_limit=key.rate_limit,
        expires_at=key.expires_at,
        is_active=key.is_active,
        last_used_at=key.last_used_at,
        total_requests=key.total_requests,
        created_at=key.created_at,
        updated_at=key.updated_at,
    )


# ==================== Statistics (JWT Auth) ====================

@router.get("/stats/overview", response_model=ApiStatsOverview)
async def get_stats_overview(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get API usage statistics overview."""
    # Total and active keys
    total_result = await db.execute(
        select(func.count(ApiKey.id)).where(ApiKey.created_by == current_user.id)
    )
    total_keys = total_result.scalar() or 0

    active_result = await db.execute(
        select(func.count(ApiKey.id)).where(
            ApiKey.created_by == current_user.id,
            ApiKey.is_active == True
        )
    )
    active_keys = active_result.scalar() or 0

    # Get user's key IDs
    keys_result = await db.execute(
        select(ApiKey.id).where(ApiKey.created_by == current_user.id)
    )
    key_ids = [k for k in keys_result.scalars().all()]

    today_requests = 0
    month_requests = 0
    avg_response_time = None

    if key_ids:
        # Today's requests
        today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        today_result = await db.execute(
            select(func.count(ApiAccessLog.id)).where(
                ApiAccessLog.api_key_id.in_(key_ids),
                ApiAccessLog.created_at >= today_start
            )
        )
        today_requests = today_result.scalar() or 0

        # This month's requests
        month_start = datetime.utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        month_result = await db.execute(
            select(func.count(ApiAccessLog.id)).where(
                ApiAccessLog.api_key_id.in_(key_ids),
                ApiAccessLog.created_at >= month_start
            )
        )
        month_requests = month_result.scalar() or 0

        # Average response time
        avg_result = await db.execute(
            select(func.avg(ApiAccessLog.response_time_ms)).where(
                ApiAccessLog.api_key_id.in_(key_ids),
                ApiAccessLog.response_time_ms.isnot(None)
            )
        )
        avg_response_time = avg_result.scalar()

    return ApiStatsOverview(
        total_keys=total_keys,
        active_keys=active_keys,
        today_requests=today_requests,
        month_requests=month_requests,
        avg_response_time_ms=avg_response_time,
    )


@router.get("/stats/logs", response_model=AccessLogResponse)
async def get_access_logs(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    key_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get API access logs."""
    # Get user's key IDs
    keys_result = await db.execute(
        select(ApiKey.id, ApiKey.name).where(ApiKey.created_by == current_user.id)
    )
    keys_data = {k.id: k.name for k in keys_result.all()}
    key_ids = list(keys_data.keys())

    if not key_ids:
        return AccessLogResponse(items=[], total=0, page=page, page_size=page_size)

    # Build query
    query = select(ApiAccessLog).where(ApiAccessLog.api_key_id.in_(key_ids))
    count_query = select(func.count(ApiAccessLog.id)).where(ApiAccessLog.api_key_id.in_(key_ids))

    if key_id:
        if key_id not in key_ids:
            raise HTTPException(status_code=403, detail="Access denied to this key's logs")
        query = query.where(ApiAccessLog.api_key_id == key_id)
        count_query = count_query.where(ApiAccessLog.api_key_id == key_id)

    # Get total
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # Get logs
    query = query.order_by(ApiAccessLog.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    logs = result.scalars().all()

    return AccessLogResponse(
        items=[
            AccessLogItem(
                id=log.id,
                api_key_id=log.api_key_id,
                api_key_name=keys_data.get(log.api_key_id),
                endpoint=log.endpoint,
                method=log.method,
                status_code=log.status_code,
                response_time_ms=log.response_time_ms,
                row_count=log.row_count,
                client_ip=log.client_ip,
                created_at=log.created_at,
            )
            for log in logs
        ],
        total=total,
        page=page,
        page_size=page_size,
    )


# ==================== Open API (API Key Auth) ====================

async def log_access(
    db: AsyncSession,
    api_key: ApiKey,
    request: Request,
    endpoint: str,
    status_code: int,
    response_time_ms: int,
    row_count: Optional[int] = None,
):
    """Log API access."""
    log = ApiAccessLog(
        api_key_id=api_key.id,
        endpoint=endpoint,
        method=request.method,
        request_params=json.dumps(dict(request.query_params)),
        status_code=status_code,
        response_time_ms=response_time_ms,
        row_count=row_count,
        client_ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    db.add(log)
    await db.commit()


def check_tag_permission(api_key: ApiKey, tag: TagNode) -> bool:
    """Check if API Key has permission to access the tag."""
    if api_key.scope_type == "all":
        return True

    scope_ids = json.loads(api_key.scope_ids) if api_key.scope_ids else []

    if api_key.scope_type == "tag":
        return tag.id in scope_ids

    if api_key.scope_type == "project":
        return tag.project_id in scope_ids if tag.project_id else False

    return False


@router.get("/open/tags", response_model=OpenApiResponse)
async def open_list_tags(
    request: Request,
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_api_key),
):
    """List authorized tags (Open API)."""
    start_time = time.time()
    request_id = f"req_{uuid.uuid4().hex[:12]}"

    try:
        query = select(TagNode).where(TagNode.is_active == True)

        # Filter by scope
        if api_key.scope_type == "tag":
            scope_ids = json.loads(api_key.scope_ids) if api_key.scope_ids else []
            query = query.where(TagNode.id.in_(scope_ids))
        elif api_key.scope_type == "project":
            scope_ids = json.loads(api_key.scope_ids) if api_key.scope_ids else []
            query = query.where(TagNode.project_id.in_(scope_ids))

        result = await db.execute(query.order_by(TagNode.id))
        tags = result.scalars().all()

        items = [
            TagListItem(
                id=tag.id,
                name=tag.name,
                description=tag.description,
                node_type=tag.node_type,
                parent_id=tag.parent_id,
                dimension_id=tag.dimension_id,
                has_data=bool(tag.tag_table_name),
            )
            for tag in tags
        ]

        response_time = int((time.time() - start_time) * 1000)
        await log_access(db, api_key, request, "/open/tags", 200, response_time, len(items))

        return OpenApiResponse(
            success=True,
            data=items,
            request_id=request_id,
        )
    except Exception as e:
        response_time = int((time.time() - start_time) * 1000)
        await log_access(db, api_key, request, "/open/tags", 500, response_time)
        return OpenApiResponse(
            success=False,
            error={"code": "INTERNAL_ERROR", "message": str(e)},
            request_id=request_id,
        )


@router.get("/open/tags/{tag_id}", response_model=OpenApiResponse)
async def open_get_tag(
    tag_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_api_key),
):
    """Get tag detail (Open API)."""
    start_time = time.time()
    request_id = f"req_{uuid.uuid4().hex[:12]}"

    try:
        result = await db.execute(select(TagNode).where(TagNode.id == tag_id))
        tag = result.scalar_one_or_none()

        if not tag:
            response_time = int((time.time() - start_time) * 1000)
            await log_access(db, api_key, request, f"/open/tags/{tag_id}", 404, response_time)
            return OpenApiResponse(
                success=False,
                error={"code": "NOT_FOUND", "message": "Tag not found"},
                request_id=request_id,
            )

        if not check_tag_permission(api_key, tag):
            response_time = int((time.time() - start_time) * 1000)
            await log_access(db, api_key, request, f"/open/tags/{tag_id}", 403, response_time)
            return OpenApiResponse(
                success=False,
                error={"code": "FORBIDDEN", "message": "No permission to access this tag"},
                request_id=request_id,
            )

        # Get columns if has data table
        columns = None
        row_count = None
        if tag.tag_table_name:
            try:
                engine, _ = await get_warehouse_engine(db)
                with engine.connect() as conn:
                    # Get columns
                    col_result = conn.execute(text(f"SELECT * FROM `{tag.tag_table_name}` LIMIT 1"))
                    columns = list(col_result.keys())
                    # Get count
                    count_result = conn.execute(text(f"SELECT COUNT(*) FROM `{tag.tag_table_name}`"))
                    row_count = count_result.scalar()
            except:
                pass

        response_time = int((time.time() - start_time) * 1000)
        await log_access(db, api_key, request, f"/open/tags/{tag_id}", 200, response_time)

        return OpenApiResponse(
            success=True,
            data=TagDetailResponse(
                id=tag.id,
                name=tag.name,
                description=tag.description,
                node_type=tag.node_type,
                parent_id=tag.parent_id,
                dimension_id=tag.dimension_id,
                tag_table_name=tag.tag_table_name,
                columns=columns,
                row_count=row_count,
            ),
            request_id=request_id,
        )
    except Exception as e:
        response_time = int((time.time() - start_time) * 1000)
        await log_access(db, api_key, request, f"/open/tags/{tag_id}", 500, response_time)
        return OpenApiResponse(
            success=False,
            error={"code": "INTERNAL_ERROR", "message": str(e)},
            request_id=request_id,
        )


@router.get("/open/tags/{tag_id}/data", response_model=OpenApiResponse)
async def open_get_tag_data(
    tag_id: int,
    request: Request,
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=1000),
    fields: Optional[str] = Query(None, description="Comma-separated field names"),
    sort: Optional[str] = Query(None, description="Sort field"),
    sort_order: str = Query("asc", description="Sort order: asc or desc"),
    db: AsyncSession = Depends(get_db),
    api_key: ApiKey = Depends(get_api_key),
):
    """Query tag data (Open API - Core endpoint)."""
    start_time = time.time()
    request_id = f"req_{uuid.uuid4().hex[:12]}"

    try:
        result = await db.execute(select(TagNode).where(TagNode.id == tag_id))
        tag = result.scalar_one_or_none()

        if not tag:
            response_time = int((time.time() - start_time) * 1000)
            await log_access(db, api_key, request, f"/open/tags/{tag_id}/data", 404, response_time)
            return OpenApiResponse(
                success=False,
                error={"code": "NOT_FOUND", "message": "Tag not found"},
                request_id=request_id,
            )

        if not check_tag_permission(api_key, tag):
            response_time = int((time.time() - start_time) * 1000)
            await log_access(db, api_key, request, f"/open/tags/{tag_id}/data", 403, response_time)
            return OpenApiResponse(
                success=False,
                error={"code": "FORBIDDEN", "message": "No permission to access this tag"},
                request_id=request_id,
            )

        # Get table name (value tags use parent's table)
        tag_table_name = tag.tag_table_name
        filter_condition = None

        if tag.node_type in ('value', 'tag') and not tag_table_name and tag.parent_id:
            parent_result = await db.execute(select(TagNode).where(TagNode.id == tag.parent_id))
            parent_tag = parent_result.scalar_one_or_none()
            if parent_tag and parent_tag.tag_table_name:
                tag_table_name = parent_tag.tag_table_name
                filter_condition = f"tag_name = '{tag.name}'"

        if not tag_table_name:
            response_time = int((time.time() - start_time) * 1000)
            await log_access(db, api_key, request, f"/open/tags/{tag_id}/data", 200, response_time, 0)
            return OpenApiResponse(
                success=True,
                data=TagDataResponse(
                    tag_id=tag.id,
                    tag_name=tag.name,
                    table_name=None,
                    columns=[],
                    rows=[],
                    pagination=PaginationInfo(page=page, page_size=page_size, total=0, total_pages=0),
                ),
                request_id=request_id,
            )

        engine, _ = await get_warehouse_engine(db)

        with engine.connect() as conn:
            # Build SELECT clause
            select_fields = "*"
            if fields:
                field_list = [f.strip() for f in fields.split(",")]
                select_fields = ", ".join([f"`{f}`" for f in field_list])

            # Build WHERE clause
            where_clause = ""
            if filter_condition:
                where_clause = f"WHERE {filter_condition}"

            # Build ORDER BY clause
            order_clause = ""
            if sort:
                order_dir = "DESC" if sort_order.lower() == "desc" else "ASC"
                order_clause = f"ORDER BY `{sort}` {order_dir}"

            # Get total count
            count_sql = f"SELECT COUNT(*) FROM `{tag_table_name}` {where_clause}"
            count_result = conn.execute(text(count_sql))
            total = count_result.scalar() or 0
            total_pages = (total + page_size - 1) // page_size

            # Get data with pagination
            offset = (page - 1) * page_size
            data_sql = f"SELECT {select_fields} FROM `{tag_table_name}` {where_clause} {order_clause} LIMIT {page_size} OFFSET {offset}"

            data_result = conn.execute(text(data_sql))
            columns = list(data_result.keys())
            rows = [dict(zip(columns, row)) for row in data_result.fetchall()]

        response_time = int((time.time() - start_time) * 1000)
        await log_access(db, api_key, request, f"/open/tags/{tag_id}/data", 200, response_time, len(rows))

        return OpenApiResponse(
            success=True,
            data=TagDataResponse(
                tag_id=tag.id,
                tag_name=tag.name,
                table_name=tag_table_name,
                columns=columns,
                rows=rows,
                pagination=PaginationInfo(
                    page=page,
                    page_size=page_size,
                    total=total,
                    total_pages=total_pages,
                ),
            ),
            request_id=request_id,
        )
    except Exception as e:
        response_time = int((time.time() - start_time) * 1000)
        await log_access(db, api_key, request, f"/open/tags/{tag_id}/data", 500, response_time)
        return OpenApiResponse(
            success=False,
            error={"code": "INTERNAL_ERROR", "message": str(e)},
            request_id=request_id,
        )
