"""
AI assistant service using Anthropic Claude API.
"""
from typing import Optional, List
import json
import logging

import anthropic

# 配置日志
logger = logging.getLogger(__name__)

from app.core.config import settings
from app.schemas.ai import (
    AITextToSQLResponse,
    AISQLOptimizeResponse,
    AIExplainResponse,
    AIGenerateDAGResponse,
    AIDDLConvertResponse,
    DDLTypeMapping,
    AIFixDDLResponse,
    AIGenerateCronResponse,
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

    def _call_claude_with_history(
        self, system_prompt: str, messages: List[dict], temperature: float = 0.3
    ) -> str:
        """调用 Claude API 支持多轮对话"""
        response = self.client.messages.create(
            model=self.model,
            max_tokens=4096,
            system=system_prompt,
            messages=messages,
            temperature=temperature,
        )
        return response.content[0].text

    def chat_for_tagging(
        self,
        table_schema: str,
        sample_data: List[dict],
        messages: List[dict],
        user_message: str,
        confirmed_schemas: List[dict] = None,
    ) -> dict:
        """
        打标对话 - 迭代累积模式
        每次用户描述业务场景，AI 给出一个数据圈选方案（表+字段）
        用户确认后累积，最终组合成宽表

        返回: {
            "reply": str,
            "schema": Optional[dict],  # 方案：{name, description, table, fields, join_key}
            "sql": Optional[str],      # 最终宽表SQL
            "is_final": bool
        }
        """
        sample_json = json.dumps(sample_data, ensure_ascii=False, indent=2, default=str)
        confirmed_schemas = confirmed_schemas or []

        # 构建已确认方案的描述
        confirmed_desc = ""
        if confirmed_schemas:
            confirmed_desc = "\n\n## 已确认的方案（用户已确认，将组合到最终宽表）\n"
            for i, schema in enumerate(confirmed_schemas, 1):
                confirmed_desc += f"{i}. 【{schema['name']}】\n"
                confirmed_desc += f"   - 表: {schema['table']}\n"
                confirmed_desc += f"   - 字段: {', '.join(schema['fields'])}\n"
                if schema.get('join_key'):
                    confirmed_desc += f"   - 关联键: {schema['join_key']}\n"
                confirmed_desc += f"   - 说明: {schema.get('description', '')}\n"

        system_prompt = f"""你是业务顾问，帮用户整理数据。用自然的人话沟通，像同事聊天一样。

## 内部参考（绝不展示给用户）
{table_schema}

{sample_json}
{confirmed_desc}

## 沟通原则
1. **说人话**：像同事聊天，不要像机器人
2. **主动推荐**：告诉用户可以从哪些角度看，让他选
3. **让用户少说话**：给默认方案，用户说"行"就过
4. **禁止技术词汇**：不说表名、字段名、数据库、SQL、生成、确认

## 对话示例

用户：我出差帮推荐个酒店
你：去哪个城市？酒店的话可以看价格、评分、位置、早餐这些，你比较在意哪个？

用户：深圳，看性价比
你：好，深圳酒店按性价比排。我先给你整理：酒店名、价格、评分、地址。还要加房型、设施这些吗？

用户：不用
你：那就这些：
- 深圳的酒店
- 按性价比排
- 看：酒店名、价格、评分、地址

这些维度够了吗？还要补充什么？

用户：够了 / 可以 / 行
你：（返回JSON方案）

## 关键话术
- 问确认时说：「这些维度够了吗？还要补充什么？」
- 不要说：「确认吗？」「是否生成？」「请确认」
- 用户说「行」「可以」「够了」「就这样」「同意」时，返回JSON

## 响应格式

普通对话：自然的文字回复

用户同意后返回JSON：
{{"type": "schema", "name": "方案名称", "description": "描述", "table": "表名", "fields": ["字段1", "字段2"], "join_key": "关联字段", "explanation": "方案说明"}}

汇总宽表时返回JSON：
{{"type": "final", "sql": "SQL语句", "task_name": "任务名称", "task_desc": "任务描述", "table_name": "tag_业务推导", "explanation": "说明"}}

注意：
- task_name：根据业务场景推断一个简洁的中文名称，如「深圳酒店性价比分析」「高价值客户画像」
- task_desc：根据业务场景推断一段描述，说明这个任务的目的和内容，如「筛选深圳地区性价比高的酒店，包含价格、评分、地址等信息」
- table_name：英文小写+下划线，格式为 tag_业务推断，如「tag_hotel_value」「tag_high_value_customer」「tag_shenzhen_hotel」，前端会自动加时间戳

## SQL格式要求（非常重要）
生成的SQL必须美化格式，每个子句换行，适当缩进：

正确示例：
SELECT
    h.hotel_name,
    h.price,
    h.rating,
    h.address
FROM hotel h
WHERE h.city = '深圳'
    AND h.price <= 500
ORDER BY h.rating / h.price DESC

错误示例（禁止）：
SELECT h.hotel_name, h.price, h.rating, h.address FROM hotel h WHERE h.city = '深圳' AND h.price <= 500 ORDER BY h.rating / h.price DESC
"""

        # 构建消息历史
        chat_messages = [{"role": m["role"], "content": m["content"]} for m in messages]
        chat_messages.append({"role": "user", "content": user_message})

        # 打印日志：用户消息和相关上下文
        logger.info("=" * 50)
        logger.info("[AI Chat] 用户消息: %s", user_message)
        logger.info("[AI Chat] 可用表结构:\n%s", table_schema[:500] + "..." if len(table_schema) > 500 else table_schema)
        if confirmed_schemas:
            logger.info("[AI Chat] 已确认方案: %s", json.dumps(confirmed_schemas, ensure_ascii=False, indent=2))

        response = self._call_claude_with_history(system_prompt, chat_messages)

        # 打印日志：AI 响应
        logger.info("[AI Chat] AI 响应: %s", response[:500] + "..." if len(response) > 500 else response)

        result = {"reply": response, "schema": None, "sql": None, "is_final": False}

        # 检查是否包含 JSON 响应
        if '"type":' in response or '"type" :' in response:
            try:
                json_start = response.find("{")
                json_end = response.rfind("}") + 1
                if json_start >= 0 and json_end > json_start:
                    json_str = response[json_start:json_end]
                    data = json.loads(json_str)

                    if data.get("type") == "schema":
                        # 返回方案
                        result["schema"] = {
                            "name": data.get("name", "未命名方案"),
                            "description": data.get("description", ""),
                            "table": data.get("table", ""),
                            "fields": data.get("fields", []),
                            "join_key": data.get("join_key", ""),
                        }
                        result["reply"] = data.get("explanation", response)
                        logger.info("[AI Chat] 解析到方案: %s", json.dumps(result["schema"], ensure_ascii=False))

                    elif data.get("type") == "final":
                        # 返回最终 SQL
                        result["sql"] = data.get("sql")
                        result["is_final"] = True
                        result["task_name"] = data.get("task_name", "数据分析任务")
                        result["task_desc"] = data.get("task_desc", "")
                        result["table_name"] = data.get("table_name", "tag_analysis")
                        result["reply"] = data.get("explanation", response)
                        logger.info("[AI Chat] 解析到最终SQL: %s", result["sql"][:200] if result["sql"] else "无")
                        logger.info("[AI Chat] 任务名称: %s, 描述: %s, 表名: %s", result["task_name"], result["task_desc"], result["table_name"])

            except json.JSONDecodeError as e:
                logger.warning("[AI Chat] JSON解析失败: %s", str(e))

        logger.info("=" * 50)
        return result

    def chat_for_dimension_tagging(
        self,
        table_schema: str,
        sample_data: List[dict],
        messages: List[dict],
        user_message: str,
        dimension_info: dict,  # {display_name, id_field}
        confirmed_tags: List[dict] = None,
    ) -> dict:
        """
        维度标签对话 - 基于选定维度生成标签

        约束：
        1. 生成的SQL必须包含维度的ID字段
        2. 一次只生成一个类型标签 + 多个子维度标签
        3. 类型标签由AI根据用户描述推断

        返回: {
            "reply": str,
            "tags": Optional[List[dict]],  # 标签列表：[{name, description}]
            "type_name": Optional[str],    # 类型标签名称
            "type_description": Optional[str],  # 类型标签描述
            "sql": Optional[str],          # 完整SQL
            "is_final": bool
        }
        """
        sample_json = json.dumps(sample_data, ensure_ascii=False, indent=2, default=str)
        confirmed_tags = confirmed_tags or []
        dimension_name = dimension_info.get("display_name", "维度")
        id_field = dimension_info.get("id_field", "id")

        # 构建已确认标签的描述
        confirmed_desc = ""
        if confirmed_tags:
            confirmed_desc = "\n\n## 已确认的标签（将生成SQL）\n"
            for i, tag in enumerate(confirmed_tags, 1):
                confirmed_desc += f"{i}. {tag['name']}: {tag.get('description', '')}\n"

        system_prompt = f"""你是标签助手。当前是【{dimension_name}】，一次性列出所有可做的基础标签供用户勾选。

## 当前维度
- 维度：{dimension_name}
- ID字段：{id_field}
{confirmed_desc}

## 实际数据（根据这个推荐，不要编造）
{table_schema}

样本：
{sample_json}

## 核心原则
1. 首次回复：一次性列出所有能做的基础标签，返回JSON格式供前端渲染勾选框
2. 用户可以勾选、取消勾选、补充新标签
3. 用户说"确认/生成/好了"时，根据最终选择生成SQL

## 首次回复格式（必须返回JSON）

用户问"帮我做标签"或类似请求时，直接返回：
{{"type": "tag_suggestions", "message": "根据数据，可做以下标签，请勾选：", "suggestions": [
  {{"type_name": "性别标签", "type_description": "用户性别", "field": "gender", "values": [
    {{"name": "男", "description": "男性", "condition": "gender='M'"}},
    {{"name": "女", "description": "女性", "condition": "gender='F'"}}
  ]}},
  {{"type_name": "年龄标签", "type_description": "年龄段", "field": "age", "values": [
    {{"name": "青年", "description": "18-35岁", "condition": "age BETWEEN 18 AND 35"}},
    {{"name": "中年", "description": "36-55岁", "condition": "age BETWEEN 36 AND 55"}},
    {{"name": "老年", "description": "55岁以上", "condition": "age > 55"}}
  ]}}
]}}

## 用户补充时
用户说"加一个XX标签"，返回新的完整suggestions列表（包含原有的+新增的）

## 用户确认时（非常重要！）
当用户消息包含"请为以下标签生成SQL"时，必须为每个选中的类型生成SQL。

用户可能选择了多个类型，例如：
请为以下标签生成SQL：[{{"type_name":"性别标签","values":[...]}},{{"type_name":"部门标签","values":[...]}}]

返回JSON数组，每个类型一个对象：
[
  {{"type": "dimension_tags", "type_name": "性别标签", "type_description": "性别分类", "tags": [{{"name": "男", "description": "男性"}}, {{"name": "女", "description": "女性"}}], "sql": "SELECT {id_field}, CASE WHEN gender='M' THEN '男' WHEN gender='F' THEN '女' ELSE '未知' END AS tag_name FROM 表名"}},
  {{"type": "dimension_tags", "type_name": "部门标签", "type_description": "部门分类", "tags": [...], "sql": "SELECT {id_field}, CASE WHEN ... END AS tag_name FROM 表名"}}
]

## 规则
- 首次：返回 tag_suggestions
- 确认时：返回 dimension_tags 数组（每个选中的类型一个对象）
- 每个对象必须包含: type, type_name, type_description, tags, sql
- SQL格式：SELECT {id_field}, CASE WHEN 条件 THEN '标签名' ... ELSE '其他' END AS tag_name FROM 表名
- tags数组包含该类型下所有值标签
"""

        # 构建消息历史
        chat_messages = [{"role": m["role"], "content": m["content"]} for m in messages]
        chat_messages.append({"role": "user", "content": user_message})

        # 打印日志
        logger.info("=" * 50)
        logger.info("[AI Dimension Chat] 维度: %s, ID字段: %s", dimension_name, id_field)
        logger.info("[AI Dimension Chat] 用户消息: %s", user_message)

        response = self._call_claude_with_history(system_prompt, chat_messages)

        logger.info("[AI Dimension Chat] AI 响应: %s", response[:500] + "..." if len(response) > 500 else response)

        result = {"reply": response, "tags": None, "type_name": None, "type_description": None, "sql": None, "is_final": False}

        # 检查是否包含 JSON 响应
        if '"type":' in response or '"type" :' in response:
            try:
                # 尝试找到JSON（可能是对象或数组）
                json_start = response.find("[") if "[" in response and (response.find("[") < response.find("{") or "{" not in response) else response.find("{")
                json_end = response.rfind("]") + 1 if response.find("[") == json_start else response.rfind("}") + 1

                if json_start >= 0 and json_end > json_start:
                    json_str = response[json_start:json_end]
                    parsed = json.loads(json_str)

                    # 如果是数组，返回所有类型标签
                    if isinstance(parsed, list) and len(parsed) > 0:
                        # 验证所有元素都是 dimension_tags
                        valid_items = [item for item in parsed if item.get("type") == "dimension_tags"]
                        if valid_items:
                            result["dimension_tags_list"] = valid_items  # 返回完整列表
                            result["is_final"] = True
                            result["reply"] = f"已生成 {len(valid_items)} 个类型标签"
                            logger.info("[AI Dimension Chat] AI返回了%d个类型标签", len(valid_items))
                    else:
                        data = parsed
                        if data.get("type") == "dimension_tags":
                            result["tags"] = data.get("tags", [])
                            result["type_name"] = data.get("type_name", "标签")
                            result["type_description"] = data.get("type_description", "")
                            result["sql"] = data.get("sql")
                            result["is_final"] = True
                            result["reply"] = data.get("explanation", response)
                            logger.info("[AI Dimension Chat] 解析到维度标签: type=%s, tags=%s",
                                        result["type_name"],
                                        json.dumps(result["tags"], ensure_ascii=False))

            except json.JSONDecodeError as e:
                logger.warning("[AI Dimension Chat] JSON解析失败: %s", str(e))

        logger.info("=" * 50)
        return result

    def chat_for_dimension_definition(
        self,
        table_schema: str,
        messages: List[dict],
        user_message: str,
    ) -> dict:
        """
        维度定义对话 - 用户通过AI对话来定义维度

        AI扫描数据库表结构，推荐合适的维度定义：
        - name: 维度标识（英文）
        - display_name: 显示名（中文）
        - id_field: ID字段

        返回: {
            "reply": str,
            "dimension": Optional[dict],  # {name, display_name, id_field, description}
            "is_final": bool
        }
        """
        system_prompt = f"""你是数据助手。用户要定义维度，你帮忙检查数据库里有没有对应的ID字段。

## 数据库表结构
{table_schema}

## 规则
1. 用户说要什么维度，你就在表里找对应的ID字段
2. 找到了直接给出定义，让用户确认
3. 找不到就说没有
4. 回复要简洁，不要废话

## 示例

用户：用户维度
你：找到 user_id 字段。
- 标识：user_dimension
- 名称：用户维度
- ID字段：user_id

确认？

用户：确认/行/可以
你：（返回JSON）

## JSON格式（用户确认后才返回）
{{"type": "dimension", "name": "user_dimension", "display_name": "用户维度", "id_field": "user_id", "description": "用户维度"}}
"""

        # 构建消息历史
        chat_messages = [{"role": m["role"], "content": m["content"]} for m in messages]
        chat_messages.append({"role": "user", "content": user_message})

        logger.info("=" * 50)
        logger.info("[AI Dimension Define] 用户消息: %s", user_message)

        response = self._call_claude_with_history(system_prompt, chat_messages)

        logger.info("[AI Dimension Define] AI 响应: %s", response[:500] + "..." if len(response) > 500 else response)

        result = {"reply": response, "dimension": None, "is_final": False}

        # 检查是否包含 JSON 响应
        if '"type":' in response or '"type" :' in response:
            try:
                json_start = response.find("{")
                json_end = response.rfind("}") + 1
                if json_start >= 0 and json_end > json_start:
                    json_str = response[json_start:json_end]
                    data = json.loads(json_str)

                    if data.get("type") == "dimension":
                        result["dimension"] = {
                            "name": data.get("name", ""),
                            "display_name": data.get("display_name", ""),
                            "id_field": data.get("id_field", ""),
                            "description": data.get("description", ""),
                        }
                        result["is_final"] = True
                        result["reply"] = data.get("explanation", response)
                        logger.info("[AI Dimension Define] 解析到维度: %s",
                                    json.dumps(result["dimension"], ensure_ascii=False))

            except json.JSONDecodeError as e:
                logger.warning("[AI Dimension Define] JSON解析失败: %s", str(e))

        logger.info("=" * 50)
        return result

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

    def generate_cron(self, description: str) -> AIGenerateCronResponse:
        """Generate cron expression from natural language description."""
        from datetime import datetime
        from croniter import croniter

        def calculate_next_runs(cron_expr: str) -> list:
            """计算未来5次执行时间"""
            next_runs = []
            try:
                base_time = datetime.now()
                cron = croniter(cron_expr, base_time)
                for _ in range(5):
                    next_time = cron.get_next(datetime)
                    next_runs.append(next_time.strftime("%Y-%m-%d %H:%M"))
            except Exception:
                pass
            return next_runs

        system_prompt = """你是一个 cron 表达式专家。将用户的自然语言描述转换为标准的 5 位 cron 表达式。

cron 格式：分钟 小时 日 月 星期
- 分钟: 0-59
- 小时: 0-23
- 日: 1-31 (L 表示最后一天)
- 月: 1-12
- 星期: 0-7 (0和7都是周日, 1是周一)

特殊字符：
- * 表示任意值
- */n 表示每隔n
- L 表示最后（用于日期字段表示月末）
- 1-5 表示范围（周一到周五）
- 1,3,5 表示列表

请返回 JSON 格式：
{
    "cron_expression": "5位cron表达式",
    "explanation": "用中文解释这个表达式的含义"
}

注意：理解用户的真实意图，灵活处理各种表达方式。"""

        user_prompt = description
        content = self._call_claude(system_prompt, user_prompt)

        try:
            json_content = self._extract_json(content)
            data = json.loads(json_content)

            cron_expr = data.get("cron_expression", "0 0 * * *")
            explanation = data.get("explanation", "")

            return AIGenerateCronResponse(
                cron_expression=cron_expr,
                explanation=explanation,
                next_runs=calculate_next_runs(cron_expr),
            )
        except json.JSONDecodeError:
            return AIGenerateCronResponse(
                cron_expression="0 0 * * *",
                explanation="解析失败，使用默认值：每天凌晨0点执行",
                next_runs=calculate_next_runs("0 0 * * *"),
            )
