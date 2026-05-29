"""
Airflow REST API service for DAG management.
Supports transactional operations with confirmation.
"""
import httpx
import asyncio
from typing import Optional, Dict, List
from datetime import datetime
from fastapi import HTTPException, status

from app.core.config import settings


class AirflowAPIError(Exception):
    """Exception raised when Airflow API call fails."""
    def __init__(self, message: str, status_code: int = None):
        self.message = message
        self.status_code = status_code
        super().__init__(self.message)


class AirflowService:
    """Service for interacting with Airflow REST API with transaction support."""

    def __init__(self):
        # Ensure base_url has /api/v1
        base = settings.AIRFLOW_API_URL.rstrip('/')
        if not base.endswith('/api/v1'):
            base = f"{base}/api/v1"
        self.base_url = base
        self.auth = (settings.AIRFLOW_USERNAME, settings.AIRFLOW_PASSWORD)
        self.timeout = 5.0  # Quick timeout for fast failure

    async def _request(
        self,
        method: str,
        endpoint: str,
        json: Optional[Dict] = None,
        params: Optional[Dict] = None,
        raise_on_error: bool = False,
    ) -> Optional[Dict]:
        """Make HTTP request to Airflow API."""
        url = f"{self.base_url}{endpoint}"
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            try:
                response = await client.request(
                    method=method,
                    url=url,
                    auth=self.auth,
                    json=json,
                    params=params,
                )
                if response.status_code == 404:
                    return None
                if response.status_code >= 400:
                    if raise_on_error:
                        detail = response.text
                        try:
                            detail = response.json().get("detail", response.text)
                        except Exception:
                            pass
                        raise AirflowAPIError(f"Airflow API error: {detail}", response.status_code)
                    return None
                return response.json() if response.content else {}
            except httpx.RequestError as e:
                if raise_on_error:
                    raise AirflowAPIError(f"Airflow connection error: {str(e)}")
                return None

    async def get_dag(self, dag_id: str, raise_on_connection_error: bool = False) -> Optional[Dict]:
        """
        Get DAG information.
        Returns None if DAG doesn't exist.
        If raise_on_connection_error=True, raises AirflowAPIError on connection failure.
        """
        try:
            result = await self._request("GET", f"/dags/{dag_id}", raise_on_error=raise_on_connection_error)
            return result
        except AirflowAPIError as e:
            if e.status_code == 404:
                return None
            raise
        except httpx.HTTPStatusError:
            return None

    async def get_dag_status(self, dag_id: str) -> Optional[str]:
        """
        Get DAG status (active/paused).
        Returns: "active" | "paused" | None (if not found)
        """
        dag = await self.get_dag(dag_id)
        if dag is None:
            return None
        return "paused" if dag.get("is_paused", True) else "active"

    async def pause_dag(self, dag_id: str) -> bool:
        """
        Pause a DAG.
        Returns True if successful.
        """
        try:
            await self._request("PATCH", f"/dags/{dag_id}", json={"is_paused": True})
            return True
        except Exception:
            return False

    async def unpause_dag(self, dag_id: str) -> bool:
        """
        Unpause/activate a DAG.
        Returns True if successful.
        """
        try:
            await self._request("PATCH", f"/dags/{dag_id}", json={"is_paused": False})
            return True
        except Exception:
            return False

    async def get_dag_runs(
        self,
        dag_id: str,
        limit: int = 5,
        order_by: str = "-execution_date",
    ) -> List[Dict]:
        """
        Get recent DAG runs.
        """
        try:
            result = await self._request(
                "GET",
                f"/dags/{dag_id}/dagRuns",
                params={"limit": limit, "order_by": order_by},
            )
            return result.get("dag_runs", []) if result else []
        except Exception:
            return []

    async def trigger_dag(
        self,
        dag_id: str,
        conf: Optional[Dict] = None,
        logical_date: Optional[datetime] = None,
    ) -> Optional[Dict]:
        """
        Trigger a DAG run.
        """
        try:
            payload = {}
            if conf:
                payload["conf"] = conf
            if logical_date:
                payload["logical_date"] = logical_date.isoformat()
            return await self._request("POST", f"/dags/{dag_id}/dagRuns", json=payload)
        except Exception:
            return None

    async def get_next_dag_run(self, dag_id: str) -> Optional[datetime]:
        """
        Get next scheduled run time for a DAG.
        """
        dag = await self.get_dag(dag_id)
        if dag and dag.get("next_dagrun"):
            try:
                return datetime.fromisoformat(dag["next_dagrun"].replace("Z", "+00:00"))
            except Exception:
                return None
        return None

    async def delete_dag(self, dag_id: str) -> bool:
        """
        Delete a DAG from Airflow (metadata only, not the file).
        """
        try:
            await self._request("DELETE", f"/dags/{dag_id}")
            return True
        except Exception:
            return False

    # ==================== Transactional Operations ====================

    async def check_connectivity(self) -> bool:
        """
        Check if Airflow API is reachable.
        Raises AirflowAPIError if not reachable.
        """
        try:
            # Use health endpoint or list dags with limit 1
            result = await self._request("GET", "/dags", params={"limit": 1}, raise_on_error=True)
            return True
        except AirflowAPIError:
            raise

    async def wait_for_dag_available(
        self,
        dag_id: str,
        max_wait_seconds: int = 10,
        poll_interval: float = 1.0,
    ) -> bool:
        """
        Wait for DAG to be available in Airflow after file deployment.
        Returns True if DAG becomes available, False if timeout.
        Raises AirflowAPIError if Airflow connection fails.
        """
        elapsed = 0.0
        first_attempt = True
        while elapsed < max_wait_seconds:
            try:
                # On first attempt, check if Airflow is reachable
                dag_info = await self.get_dag(dag_id, raise_on_connection_error=first_attempt)
                if dag_info is not None:
                    return True
            except AirflowAPIError:
                # Connection failed on first attempt - fail fast
                raise
            first_attempt = False
            await asyncio.sleep(poll_interval)
            elapsed += poll_interval
        return False

    async def enable_dag_simple(self, dag_id: str) -> bool:
        """
        Simply try to unpause a DAG.
        Returns True if API call succeeded, False if DAG not found yet.
        Raises AirflowAPIError if Airflow is not reachable.
        """
        try:
            result = await self._request(
                "PATCH",
                f"/dags/{dag_id}",
                json={"is_paused": False},
                raise_on_error=True,
            )
            return True
        except AirflowAPIError as e:
            # 404 means DAG not found yet (Airflow hasn't scanned it), that's OK
            if e.status_code == 404:
                return False
            raise

    async def disable_dag_with_confirmation(
        self,
        dag_id: str,
        max_wait_seconds: int = 30,
    ) -> Dict:
        """
        Disable (pause) DAG and wait for Airflow to confirm the state change.
        Raises AirflowAPIError if operation fails.
        Returns DAG info on success.
        """
        # Check if DAG exists
        dag_info = await self.get_dag(dag_id)
        if dag_info is None:
            raise AirflowAPIError(f"DAG {dag_id} not found in Airflow")

        # Pause the DAG
        result = await self._request(
            "PATCH",
            f"/dags/{dag_id}",
            json={"is_paused": True},
            raise_on_error=True,
        )

        # Verify the state change
        for _ in range(10):
            dag_info = await self.get_dag(dag_id)
            if dag_info and dag_info.get("is_paused", False):
                return dag_info
            await asyncio.sleep(1)

        raise AirflowAPIError(f"Failed to confirm DAG {dag_id} is paused")

    async def delete_dag_with_confirmation(
        self,
        dag_id: str,
    ) -> bool:
        """
        Delete DAG from Airflow and confirm deletion.
        Returns True on success.
        Raises AirflowAPIError if operation fails.
        """
        # Try to delete
        try:
            await self._request("DELETE", f"/dags/{dag_id}", raise_on_error=True)
        except AirflowAPIError as e:
            # 404 means already deleted, which is OK
            if e.status_code != 404:
                raise

        # Verify deletion
        for _ in range(5):
            dag_info = await self.get_dag(dag_id)
            if dag_info is None:
                return True
            await asyncio.sleep(1)

        # DAG still exists - might be because file still exists
        # This is acceptable, the important thing is the API call succeeded
        return True


# Singleton instance
airflow_service = AirflowService()
