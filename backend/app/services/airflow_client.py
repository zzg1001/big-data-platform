"""
Airflow REST API client for DAG management.
Ensures transactional consistency between Big Data Platform and Airflow.
"""
import httpx
from typing import Optional, Dict, Any
from datetime import datetime

from app.core.config import settings


class AirflowAPIError(Exception):
    """Exception raised when Airflow API call fails."""
    def __init__(self, message: str, status_code: int = None, detail: str = None):
        self.message = message
        self.status_code = status_code
        self.detail = detail
        super().__init__(self.message)


class AirflowClient:
    """Client for Airflow REST API operations."""

    def __init__(self):
        self.base_url = settings.AIRFLOW_API_URL or "http://airflow-webserver:8080"
        self.username = settings.AIRFLOW_USERNAME or "admin"
        self.password = settings.AIRFLOW_PASSWORD or "admin"
        self.timeout = 30.0

    def _get_auth(self):
        """Get basic auth tuple."""
        return (self.username, self.password)

    def _get_headers(self):
        """Get common headers."""
        return {
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    async def _request(
        self,
        method: str,
        endpoint: str,
        data: Dict = None,
        params: Dict = None,
    ) -> Dict[str, Any]:
        """Make async HTTP request to Airflow API."""
        url = f"{self.base_url}/api/v1{endpoint}"

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            try:
                response = await client.request(
                    method=method,
                    url=url,
                    json=data,
                    params=params,
                    auth=self._get_auth(),
                    headers=self._get_headers(),
                )

                if response.status_code >= 400:
                    detail = response.text
                    try:
                        detail = response.json().get("detail", response.text)
                    except Exception:
                        pass
                    raise AirflowAPIError(
                        message=f"Airflow API error: {response.status_code}",
                        status_code=response.status_code,
                        detail=detail,
                    )

                if response.status_code == 204:
                    return {"success": True}

                return response.json()

            except httpx.RequestError as e:
                raise AirflowAPIError(
                    message=f"Airflow connection error: {str(e)}",
                    detail=str(e),
                )

    async def get_dag(self, dag_id: str) -> Optional[Dict]:
        """Get DAG info from Airflow."""
        try:
            return await self._request("GET", f"/dags/{dag_id}")
        except AirflowAPIError as e:
            if e.status_code == 404:
                return None
            raise

    async def pause_dag(self, dag_id: str) -> Dict:
        """Pause a DAG in Airflow."""
        return await self._request(
            "PATCH",
            f"/dags/{dag_id}",
            data={"is_paused": True},
        )

    async def unpause_dag(self, dag_id: str) -> Dict:
        """Unpause (activate) a DAG in Airflow."""
        return await self._request(
            "PATCH",
            f"/dags/{dag_id}",
            data={"is_paused": False},
        )

    async def delete_dag(self, dag_id: str) -> Dict:
        """Delete a DAG from Airflow."""
        return await self._request("DELETE", f"/dags/{dag_id}")

    async def trigger_dag(self, dag_id: str, conf: Dict = None) -> Dict:
        """Trigger a DAG run."""
        data = {
            "logical_date": datetime.utcnow().isoformat() + "Z",
        }
        if conf:
            data["conf"] = conf

        return await self._request(
            "POST",
            f"/dags/{dag_id}/dagRuns",
            data=data,
        )

    async def get_dag_run(self, dag_id: str, dag_run_id: str) -> Dict:
        """Get a specific DAG run."""
        return await self._request(
            "GET",
            f"/dags/{dag_id}/dagRuns/{dag_run_id}",
        )

    async def wait_for_dag_available(
        self,
        dag_id: str,
        max_retries: int = 30,
        retry_interval: float = 2.0,
    ) -> bool:
        """Wait for DAG to be available in Airflow after file deployment."""
        import asyncio

        for _ in range(max_retries):
            dag_info = await self.get_dag(dag_id)
            if dag_info:
                return True
            await asyncio.sleep(retry_interval)

        return False

    async def ensure_dag_state(
        self,
        dag_id: str,
        is_paused: bool,
        max_retries: int = 10,
        retry_interval: float = 1.0,
    ) -> bool:
        """Ensure DAG is in the expected state, with retries."""
        import asyncio

        for _ in range(max_retries):
            dag_info = await self.get_dag(dag_id)
            if dag_info and dag_info.get("is_paused") == is_paused:
                return True
            await asyncio.sleep(retry_interval)

        return False


# Global client instance
airflow_client = AirflowClient()
