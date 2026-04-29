"""
Airflow REST API service for DAG management.
"""
import httpx
from typing import Optional, Dict, List
from datetime import datetime

from app.core.config import settings


class AirflowService:
    """Service for interacting with Airflow REST API."""

    def __init__(self):
        self.base_url = settings.AIRFLOW_API_URL
        self.auth = (settings.AIRFLOW_USERNAME, settings.AIRFLOW_PASSWORD)
        self.timeout = 30.0

    async def _request(
        self,
        method: str,
        endpoint: str,
        json: Optional[Dict] = None,
        params: Optional[Dict] = None,
    ) -> Optional[Dict]:
        """Make HTTP request to Airflow API."""
        url = f"{self.base_url}{endpoint}"
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.request(
                method=method,
                url=url,
                auth=self.auth,
                json=json,
                params=params,
            )
            if response.status_code == 404:
                return None
            response.raise_for_status()
            return response.json() if response.content else {}

    async def get_dag(self, dag_id: str) -> Optional[Dict]:
        """
        Get DAG information.
        Returns None if DAG doesn't exist.
        """
        try:
            return await self._request("GET", f"/dags/{dag_id}")
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


# Singleton instance
airflow_service = AirflowService()
