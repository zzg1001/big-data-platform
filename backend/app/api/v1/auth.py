"""
Authentication API endpoints.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import create_access_token, create_refresh_token, decode_token
from app.core.redis import create_session, delete_session, extend_session
from app.schemas.user import UserCreate, UserResponse, UserLogin, Token
from app.services.user_service import UserService
from app.api.deps import get_current_user
from app.models.user import User

router = APIRouter()


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register(
    user_data: UserCreate,
    db: AsyncSession = Depends(get_db),
):
    """Register a new user."""
    user_service = UserService(db)

    # Check if username exists
    if await user_service.get_by_username(user_data.username):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already registered",
        )

    # Check if email exists
    if await user_service.get_by_email(user_data.email):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered",
        )

    user = await user_service.create(user_data)
    return user


@router.post("/login", response_model=Token)
async def login(
    credentials: UserLogin,
    db: AsyncSession = Depends(get_db),
):
    """Login and get JWT tokens."""
    user_service = UserService(db)

    user = await user_service.authenticate(credentials.username, credentials.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is disabled",
        )

    access_token, token_id = create_access_token(data={"sub": user.username, "uid": user.id})
    refresh_token = create_refresh_token(data={"sub": user.username, "uid": user.id, "tid": token_id})

    # Store session in Redis with 10-minute TTL
    await create_session(user.id, token_id, {
        "username": user.username,
        "user_id": user.id,
    })

    return Token(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
    )


@router.post("/refresh", response_model=Token)
async def refresh_token(
    refresh_token: str,
    db: AsyncSession = Depends(get_db),
):
    """Refresh access token using refresh token."""
    payload = decode_token(refresh_token)

    if not payload or payload.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token",
        )

    user_service = UserService(db)
    user = await user_service.get_by_username(payload.get("sub"))

    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )

    # Use the same token_id to maintain session continuity
    old_token_id = payload.get("tid")
    access_token, token_id = create_access_token(
        data={"sub": user.username, "uid": user.id},
        token_id=old_token_id
    )
    new_refresh_token = create_refresh_token(data={"sub": user.username, "uid": user.id, "tid": token_id})

    # Extend session in Redis
    await extend_session(user.id, token_id)

    return Token(
        access_token=access_token,
        refresh_token=new_refresh_token,
        token_type="bearer",
    )


@router.post("/logout")
async def logout(
    current_user: User = Depends(get_current_user),
):
    """Logout and invalidate session."""
    # The token_id is extracted in get_current_user, we need to get it from the request
    # For now, we'll delete all sessions for the user
    from app.core.redis import delete_all_user_sessions
    await delete_all_user_sessions(current_user.id)
    return {"message": "Logged out successfully"}


@router.post("/heartbeat")
async def heartbeat(
    current_user: User = Depends(get_current_user),
):
    """Heartbeat endpoint to extend session TTL."""
    # Session is automatically extended in get_current_user
    return {"message": "Session extended"}
