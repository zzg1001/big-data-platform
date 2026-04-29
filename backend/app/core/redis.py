"""
Redis connection and session management.
"""
import redis.asyncio as redis
from typing import Optional
import json

from app.core.config import settings

# Redis client (will be initialized on first use)
_redis_client: Optional[redis.Redis] = None


async def get_redis() -> redis.Redis:
    """Get Redis client instance."""
    global _redis_client
    if _redis_client is None:
        _redis_client = redis.from_url(
            settings.REDIS_URL,
            encoding="utf-8",
            decode_responses=True,
        )
    return _redis_client


def get_session_key(user_id: int, token_id: str) -> str:
    """Generate Redis key for user session."""
    return f"session:{user_id}:{token_id}"


async def create_session(user_id: int, token_id: str, user_data: dict) -> bool:
    """Create a new session in Redis."""
    client = await get_redis()
    key = get_session_key(user_id, token_id)
    await client.setex(key, settings.SESSION_EXPIRE_SECONDS, json.dumps(user_data))
    return True


async def get_session(user_id: int, token_id: str) -> Optional[dict]:
    """Get session data from Redis."""
    client = await get_redis()
    key = get_session_key(user_id, token_id)
    data = await client.get(key)
    if data:
        return json.loads(data)
    return None


async def extend_session(user_id: int, token_id: str) -> bool:
    """Extend session TTL (called on user activity)."""
    client = await get_redis()
    key = get_session_key(user_id, token_id)
    # Check if key exists and extend TTL
    if await client.exists(key):
        await client.expire(key, settings.SESSION_EXPIRE_SECONDS)
        return True
    return False


async def delete_session(user_id: int, token_id: str) -> bool:
    """Delete a session (logout)."""
    client = await get_redis()
    key = get_session_key(user_id, token_id)
    await client.delete(key)
    return True


async def delete_all_user_sessions(user_id: int) -> int:
    """Delete all sessions for a user."""
    client = await get_redis()
    pattern = f"session:{user_id}:*"
    keys = []
    async for key in client.scan_iter(match=pattern):
        keys.append(key)
    if keys:
        return await client.delete(*keys)
    return 0
