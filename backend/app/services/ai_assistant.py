"""
AI assistant service using Anthropic Claude API.
"""
from typing import Optional, List
import json

import anthropic

from app.core.config import settings
from app.schemas.ai import (
    AITextToSQLResponse,
    AISQLOptimizeResponse,
    AIExplainResponse,
    AIGenerateDAGResponse,
    AIDDLConvertResponse,
    DDLTypeMapping,
    AIFixDDLResponse,
)


class AIAssistant:
    """AI assistant for SQL generation, optimization, and DAG creation using Claude."""

    def __init__(self):
        self.client = anthropic.Anthropic(
            api_key=settings.ANTHROPIC_AUTH_TOKEN,
            base_url=settings.ANTHROPIC_BASE_URL,
        )
        self.model = settings.CLAUDE_MODEL

    def _call_claude(self, system_prompt: str, user_prompt: str, temperature: float = 0.1) -> str:
        """Call Claude API and return the response content."""
        response = self.client.messages.create(
            model=self.model,
            max_tokens=4096,
            system=system_prompt,
            messages=[
                {"role": "user", "content": user_prompt}
            ],
        )
        return response.content[0].text

    def text_to_sql(
        self,
        natural_language: str,
        table_schema: str,
        dialect: str = "postgresql",
    ) -> AITextToSQLResponse:
        """Convert natural language to SQL query."""
        system_prompt = f"""You are an expert SQL developer. Convert natural language queries to {dialect} SQL.

Given the following table schema:
{table_schema}

Rules:
1. Generate valid {dialect} SQL
2. Use proper table and column names from the schema
3. Include appropriate JOINs when needed
4. Add comments explaining complex logic
5. Be careful with NULL handling
"""

        user_prompt = f"Convert this to SQL: {natural_language}"

        content = self._call_claude(system_prompt, user_prompt)

        # Parse response to extract SQL and explanation
        sql = self._extract_sql(content)
        explanation = content.replace(sql, "").strip()

        return AITextToSQLResponse(
            sql=sql,
            explanation=explanation or "SQL generated based on your request.",
            confidence=0.85,
        )

    def optimize_sql(self, sql: str, dialect: str = "postgresql") -> AISQLOptimizeResponse:
        """Analyze and optimize SQL query."""
        system_prompt = f"""You are an expert {dialect} database performance tuner.
Analyze the given SQL query and provide optimization suggestions.

Return your response in JSON format:
{{
    "optimized_sql": "the optimized SQL query",
    "suggestions": ["list of optimization suggestions"],
    "explanation": "detailed explanation of changes"
}}
"""

        content = self._call_claude(system_prompt, f"Optimize this SQL:\n{sql}")

        try:
            # Try to parse as JSON
            json_content = self._extract_json(content)
            data = json.loads(json_content)
            return AISQLOptimizeResponse(
                original_sql=sql,
                optimized_sql=data.get("optimized_sql", sql),
                suggestions=data.get("suggestions", []),
                explanation=data.get("explanation", ""),
            )
        except json.JSONDecodeError:
            # Fallback if response is not JSON
            return AISQLOptimizeResponse(
                original_sql=sql,
                optimized_sql=sql,
                suggestions=[content],
                explanation="See suggestions for details.",
            )

    def explain_sql(self, sql: str) -> AIExplainResponse:
        """Explain what a SQL query does."""
        system_prompt = """You are an expert SQL teacher.
Explain the given SQL query in simple terms.

Return your response in JSON format:
{
    "explanation": "detailed explanation of what the query does",
    "tables_used": ["list of tables referenced"],
    "operations": ["list of SQL operations used (SELECT, JOIN, WHERE, etc.)"]
}
"""

        content = self._call_claude(system_prompt, f"Explain this SQL:\n{sql}")

        try:
            json_content = self._extract_json(content)
            data = json.loads(json_content)
            return AIExplainResponse(
                sql=sql,
                explanation=data.get("explanation", ""),
                tables_used=data.get("tables_used", []),
                operations=data.get("operations", []),
            )
        except json.JSONDecodeError:
            return AIExplainResponse(
                sql=sql,
                explanation=content,
                tables_used=[],
                operations=[],
            )

    def generate_dag(
        self,
        name: str,
        description: str,
        sql_content: str,
        cron_expression: str,
        datasource_config: dict,
        dependencies: Optional[List[str]] = None,
        alert_email: Optional[str] = None,
    ) -> AIGenerateDAGResponse:
        """Generate Airflow DAG code."""
        dag_id = name.lower().replace(" ", "_").replace("-", "_")

        deps_code = ""
        if dependencies:
            deps_code = f"""
    # Wait for upstream DAGs
    from airflow.sensors.external_task import ExternalTaskSensor

    wait_tasks = []
    for dep_dag in {dependencies}:
        wait_task = ExternalTaskSensor(
            task_id=f"wait_for_{{dep_dag}}",
            external_dag_id=dep_dag,
            mode="reschedule",
        )
        wait_tasks.append(wait_task)
"""

        alert_code = ""
        if alert_email:
            alert_code = f"""
    default_args["email"] = ["{alert_email}"]
    default_args["email_on_failure"] = True
"""

        dag_code = f'''"""
Auto-generated DAG: {name}
Description: {description}
Generated by Big Data Platform AI Assistant
"""
from datetime import datetime, timedelta
from airflow import DAG
from airflow.providers.common.sql.operators.sql import SQLExecuteQueryOperator

default_args = {{
    "owner": "bigdata_platform",
    "depends_on_past": False,
    "start_date": datetime(2024, 1, 1),
    "retries": 1,
    "retry_delay": timedelta(minutes=5),
}}
{alert_code}

with DAG(
    dag_id="{dag_id}",
    default_args=default_args,
    description="{description}",
    schedule_interval="{cron_expression}",
    catchup=False,
    tags=["bigdata_platform", "auto_generated"],
) as dag:
{deps_code}
    execute_sql = SQLExecuteQueryOperator(
        task_id="execute_sql",
        conn_id="{datasource_config.get('conn_id', 'default_conn')}",
        sql="""
{sql_content}
        """,
    )
'''

        return AIGenerateDAGResponse(
            dag_id=dag_id,
            dag_code=dag_code,
            explanation=f"Generated DAG '{dag_id}' that executes the provided SQL on schedule '{cron_expression}'.",
        )

    def convert_ddl(
        self,
        source_ddl: str,
        source_db_type: str,
        target_db_type: str,
        target_table: Optional[str] = None,
        target_schema: Optional[str] = None,
    ) -> AIDDLConvertResponse:
        """Convert DDL from source database type to target database type using AI."""

        # Type mapping reference for the AI
        type_mapping_hints = """
Common type mappings:
- MySQL INT/BIGINT -> Hive BIGINT, PostgreSQL INTEGER/BIGINT
- MySQL VARCHAR(n) -> Hive STRING, PostgreSQL VARCHAR(n)
- MySQL TEXT/LONGTEXT -> Hive STRING, PostgreSQL TEXT
- MySQL DATETIME/TIMESTAMP -> Hive TIMESTAMP, PostgreSQL TIMESTAMP
- MySQL DECIMAL(p,s) -> Hive DECIMAL(p,s), PostgreSQL NUMERIC(p,s)
- MySQL TINYINT(1)/BOOLEAN -> Hive BOOLEAN, PostgreSQL BOOLEAN
- MySQL FLOAT/DOUBLE -> Hive DOUBLE, PostgreSQL REAL/DOUBLE PRECISION
- MySQL DATE -> Hive DATE, PostgreSQL DATE
- MySQL BLOB/LONGBLOB -> Hive BINARY, PostgreSQL BYTEA
- MySQL ENUM -> Hive STRING, PostgreSQL VARCHAR or custom ENUM
- MySQL JSON -> Hive STRING, PostgreSQL JSONB

Special considerations:
- Hive: No PRIMARY KEY, use STORED AS ORC/PARQUET, PARTITIONED BY for large tables
- PostgreSQL: Support constraints, indexes, SERIAL for auto-increment
- SQL Server: Use NVARCHAR for Unicode, IDENTITY for auto-increment
"""

        system_prompt = f"""You are an expert database architect. Convert the given DDL from {source_db_type} to {target_db_type}.

{type_mapping_hints}

Return your response in JSON format:
{{
    "target_ddl": "the converted CREATE TABLE statement",
    "type_mappings": [
        {{"column_name": "col1", "source_type": "INT", "target_type": "BIGINT", "warning": "optional warning"}},
        ...
    ],
    "explanation": "explanation of the conversion",
    "warnings": ["list of any warnings or considerations"]
}}

Rules:
1. Generate valid {target_db_type} DDL syntax
2. Map data types appropriately between databases
3. Handle constraints according to target database capabilities
4. For Hive, remove PRIMARY KEY constraints and use appropriate storage format
5. Preserve column order and comments where possible
6. Flag any potential data loss or compatibility issues in warnings
"""

        user_prompt = f"""Convert this {source_db_type} DDL to {target_db_type}:

{source_ddl}

"""
        if target_table:
            user_prompt += f"Use '{target_table}' as the target table name.\n"
        if target_schema:
            user_prompt += f"Use '{target_schema}' as the target schema.\n"

        content = self._call_claude(system_prompt, user_prompt)

        try:
            # Extract JSON from response
            json_content = self._extract_json(content)
            data = json.loads(json_content)

            type_mappings = [
                DDLTypeMapping(
                    column_name=m.get("column_name", ""),
                    source_type=m.get("source_type", ""),
                    target_type=m.get("target_type", ""),
                    warning=m.get("warning"),
                )
                for m in data.get("type_mappings", [])
            ]

            return AIDDLConvertResponse(
                source_db_type=source_db_type,
                target_db_type=target_db_type,
                source_ddl=source_ddl,
                target_ddl=data.get("target_ddl", ""),
                type_mappings=type_mappings,
                explanation=data.get("explanation", ""),
                warnings=data.get("warnings", []),
            )
        except json.JSONDecodeError:
            # Fallback if response is not JSON
            return AIDDLConvertResponse(
                source_db_type=source_db_type,
                target_db_type=target_db_type,
                source_ddl=source_ddl,
                target_ddl=self._extract_sql(content),
                type_mappings=[],
                explanation=content,
                warnings=["Could not parse detailed type mappings from AI response"],
            )

    def _extract_json(self, content: str) -> str:
        """Extract JSON from AI response (handling markdown code blocks)."""
        if "```json" in content:
            start = content.find("```json") + 7
            end = content.find("```", start)
            if end > start:
                return content[start:end].strip()
        elif "```" in content:
            start = content.find("```") + 3
            end = content.find("```", start)
            if end > start:
                return content[start:end].strip()
        return content.strip()

    def _extract_sql(self, content: str) -> str:
        """Extract SQL from AI response."""
        # Look for SQL in code blocks
        if "```sql" in content.lower():
            start = content.lower().find("```sql") + 6
            end = content.find("```", start)
            if end > start:
                return content[start:end].strip()

        if "```" in content:
            start = content.find("```") + 3
            end = content.find("```", start)
            if end > start:
                return content[start:end].strip()

        # Return content as-is if no code blocks
        return content.strip()

    def fix_ddl(
        self,
        ddl: str,
        error: str,
        target_db_type: str,
    ) -> AIFixDDLResponse:
        """Use AI to fix DDL based on error message."""

        system_prompt = f"""You are an expert database architect. Your task is to fix a DDL statement that failed to execute.

Analyze the error message and the DDL, then provide a corrected version that will work on {target_db_type}.

Return your response in JSON format:
{{
    "fixed_ddl": "the corrected CREATE TABLE statement",
    "explanation": "explanation of what was wrong and how you fixed it",
    "changes": ["list of specific changes made"]
}}

Rules:
1. Generate valid {target_db_type} DDL syntax
2. Fix syntax errors, unsupported data types, or constraint issues
3. If the table already exists error, add IF NOT EXISTS clause
4. If data type is not supported, convert to the closest equivalent type
5. For {target_db_type}, ensure all syntax is compatible
6. Keep the table structure as close to original as possible
7. Only output the fixed DDL, no explanation in the DDL itself
"""

        user_prompt = f"""The following DDL failed to execute on {target_db_type}:

DDL:
{ddl}

Error message:
{error}

Please analyze and provide a corrected DDL that will work on {target_db_type}.
"""

        content = self._call_claude(system_prompt, user_prompt)

        try:
            json_content = self._extract_json(content)
            data = json.loads(json_content)

            return AIFixDDLResponse(
                original_ddl=ddl,
                fixed_ddl=data.get("fixed_ddl", ""),
                explanation=data.get("explanation", ""),
                changes=data.get("changes", []),
            )
        except json.JSONDecodeError:
            # Fallback if response is not JSON
            fixed_ddl = self._extract_sql(content)
            return AIFixDDLResponse(
                original_ddl=ddl,
                fixed_ddl=fixed_ddl,
                explanation=content,
                changes=["Could not parse detailed changes from AI response"],
            )
