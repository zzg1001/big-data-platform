"""
标签管理平台 - API Schema
"""
from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel


# ==================== 标签维度 ====================

class TagDimensionBase(BaseModel):
    name: str
    display_name: str
    id_field: str
    description: Optional[str] = None


class TagDimensionCreate(TagDimensionBase):
    pass


class TagDimensionUpdate(BaseModel):
    name: Optional[str] = None
    display_name: Optional[str] = None
    id_field: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None


class TagDimensionResponse(TagDimensionBase):
    id: int
    is_preset: bool = False
    is_active: bool = True
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ==================== 标签项目 ====================

class TagProjectBase(BaseModel):
    name: str
    description: Optional[str] = None
    color: Optional[str] = "#1890ff"
    icon: Optional[str] = None


class TagProjectCreate(TagProjectBase):
    pass


class TagProjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None
    icon: Optional[str] = None


class TagProjectResponse(TagProjectBase):
    id: int
    node_count: int = 0
    tag_count: int = 0
    is_active: bool = True
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ==================== 标签节点 ====================

class TagNodeBase(BaseModel):
    name: str
    description: Optional[str] = None
    node_type: str = "tag"  # category, type, tag, detail
    parent_id: Optional[int] = None
    project_id: Optional[int] = None
    dimension_id: Optional[int] = None  # 维度ID（维度标签专用）
    color: Optional[str] = "#1890ff"
    icon: Optional[str] = None
    sort_order: Optional[int] = 0


class TagNodeCreate(TagNodeBase):
    pass


class TagNodeUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    node_type: Optional[str] = None
    parent_id: Optional[int] = None
    project_id: Optional[int] = None
    dimension_id: Optional[int] = None
    color: Optional[str] = None
    icon: Optional[str] = None
    sort_order: Optional[int] = None
    rule_type: Optional[str] = None
    rule_config: Optional[str] = None
    is_active: Optional[bool] = None


class TagNodeResponse(TagNodeBase):
    id: int
    project_id: Optional[int] = None
    dimension_id: Optional[int] = None
    path: Optional[str] = None
    level: int
    rule_type: Optional[str] = None
    rule_config: Optional[str] = None
    tag_table_name: Optional[str] = None
    source_datasource_id: Optional[int] = None
    source_table: Optional[str] = None
    source_node_id: Optional[int] = None  # 模版标签引用的原标签ID
    ai_generated: bool = False
    ai_confidence: Optional[int] = None
    usage_count: int = 0
    is_active: bool = True
    created_at: datetime
    updated_at: datetime
    # 额外字段
    parent_name: Optional[str] = None
    children_count: Optional[int] = 0
    dimension_name: Optional[str] = None  # 维度显示名

    class Config:
        from_attributes = True


class TagNodeTree(BaseModel):
    """树形节点"""
    id: int
    name: str
    description: Optional[str] = None
    node_type: str
    color: Optional[str] = None
    icon: Optional[str] = None
    level: int
    parent_id: Optional[int] = None  # 父节点ID
    project_id: Optional[int] = None  # 所属项目ID
    dimension_id: Optional[int] = None  # 维度ID
    usage_count: int = 0
    rule_type: Optional[str] = None
    rule_config: Optional[str] = None  # 规则配置JSON
    source_table: Optional[str] = None  # 源表
    tag_table_name: Optional[str] = None  # 标签结果表
    children: List["TagNodeTree"] = []


# ==================== 标签数据 ====================

class TagDataCreate(BaseModel):
    tag_node_id: int
    datasource_id: Optional[int] = None
    table_name: Optional[str] = None
    row_id: Optional[str] = None
    tagged_by: str = "manual"


class TagDataResponse(BaseModel):
    id: int
    tag_node_id: int
    tag_name: Optional[str] = None
    datasource_id: Optional[int] = None
    datasource_name: Optional[str] = None
    table_name: Optional[str] = None
    row_id: Optional[str] = None
    tagged_by: str
    ai_confidence: Optional[int] = None
    created_at: datetime

    class Config:
        from_attributes = True


# ==================== 规则标签 ====================

class CompositeTagRef(BaseModel):
    """复合智能标签来源引用"""
    id: int
    name: str


class RuleTagConfig(BaseModel):
    """规则标签配置"""
    datasource_id: Optional[int] = None  # 为空时使用平台仓库
    source_table: Optional[str] = None  # 全库模式时可能为空
    sql_condition: Optional[str] = None  # WHERE条件
    full_sql: Optional[str] = None  # 完整SQL
    composite_tags: Optional[List[CompositeTagRef]] = None  # 复合智能标签来源
    source: Optional[str] = None  # 来源标识：ai, ai_chat, sql, composite, graph
    tag_table_name: Optional[str] = None  # AI生成的目标表名


class RuleTagCreate(BaseModel):
    """创建规则标签"""
    name: str
    description: Optional[str] = None
    parent_id: Optional[int] = None
    node_type: Optional[str] = "tag"  # tag=维度标签, detail=粒度标签
    dimension_id: Optional[int] = None  # 维度ID（维度标签专用）
    color: Optional[str] = "#1890ff"
    rule_config: RuleTagConfig


# ==================== 行级标签 ====================

class RowTagConfig(BaseModel):
    """行级标签配置"""
    datasource_id: int
    source_table: str
    source_columns: List[str]  # 选择的源字段
    tag_columns: List[dict]  # 新建的标签字段 [{name, type, description}]
    target_table: str  # 目标表名


class RowTagCreate(BaseModel):
    """创建行级标签任务"""
    name: str
    description: Optional[str] = None
    parent_id: Optional[int] = None
    color: Optional[str] = "#52c41a"
    config: RowTagConfig


class AITagRequest(BaseModel):
    """AI打标请求"""
    tag_node_id: int
    sample_count: int = 100  # 采样数量
    tag_prompt: Optional[str] = None  # 自定义提示词


# ==================== 行级标签任务 ====================

class TagFieldConfig(BaseModel):
    """标签字段配置"""
    name: str  # 字段名
    description: Optional[str] = None  # 字段描述
    type_id: int  # 绑定的类型节点ID


class RowTagTaskCreate(BaseModel):
    """创建行级标签任务"""
    name: str
    description: Optional[str] = None
    parent_id: Optional[int] = None
    color: Optional[str] = "#52c41a"
    # 数据源配置
    datasource_id: Optional[int] = None  # 为空时使用平台仓库
    source_table: str
    source_columns: List[str]  # 选择的源字段（用于AI分析）
    tag_fields: List[TagFieldConfig]  # 标签字段配置，每个字段绑定一个类型
    target_table: Optional[str] = None  # 目标表名，为空则自动生成


class RowTagTaskExecute(BaseModel):
    """执行行级标签任务"""
    tag_node_id: int
    batch_size: int = 100  # 每批处理行数
    ai_prompt: Optional[str] = None  # 自定义AI提示词


class RowTagTaskResponse(BaseModel):
    """行级标签任务响应"""
    id: int
    name: str
    status: str  # pending, running, completed, failed
    total_rows: int
    processed_rows: int
    created_at: datetime


# ==================== 数据集标签 ====================

class DatasetTagCreate(BaseModel):
    """从筛选数据创建数据集标签"""
    name: str
    description: Optional[str] = None
    parent_id: Optional[int] = None
    color: Optional[str] = "#fa8c16"
    # 数据筛选
    source_tag_ids: List[int]  # 基于哪些标签筛选
    filter_condition: Optional[str] = None  # 额外的WHERE条件
    # 目标配置
    target_table: Optional[str] = None  # 为空则自动生成


class TagPreviewRequest(BaseModel):
    """标签预览请求"""
    tag_node_id: int
    limit: int = 100


# ==================== 统计 ====================

class TagStatistics(BaseModel):
    total_nodes: int
    category_count: int
    tag_count: int
    total_tagged_data: int
    ai_generated_count: int  # AI打标任务数
    rule_tag_count: int  # SQL规则任务数（不含AI打标和复合智能标签）
    composite_tag_count: int = 0  # 复合智能标签任务数
    graph_tag_count: int = 0  # Graph Intelligence任务数
    top_tags: List[dict]


# ==================== AI 对话打标 ====================

class ChatMessage(BaseModel):
    """对话消息"""
    role: str  # "user" | "assistant"
    content: str
    timestamp: Optional[datetime] = None


class DataSchema(BaseModel):
    """数据圈选方案"""
    name: str  # 方案名称
    description: Optional[str] = None  # 方案说明
    table: str  # 表名
    fields: List[str]  # 字段列表
    join_key: Optional[str] = None  # 关联键


class CreateChatRequest(BaseModel):
    """创建对话会话请求"""
    table_name: Optional[str] = None  # 为空时获取整个库的表信息（全库模式）
    first_message: Optional[str] = None  # 用户的第一条消息（全库模式时使用）


class CreateChatResponse(BaseModel):
    """创建对话会话响应"""
    session_id: str
    table_schema: str
    sample_data: List[dict]
    initial_message: str


class SendMessageRequest(BaseModel):
    """发送消息请求"""
    session_id: str
    message: str


class SendMessageResponse(BaseModel):
    """发送消息响应"""
    session_id: str
    reply: str
    schema: Optional[DataSchema] = None  # AI 给出的方案
    generated_sql: Optional[str] = None  # 最终宽表 SQL
    is_final: bool = False
    task_name: Optional[str] = None  # AI 生成的任务名称
    task_desc: Optional[str] = None  # AI 生成的任务描述
    table_name: Optional[str] = None  # AI 生成的表名（tag_业务推导）


class ConfirmSchemaRequest(BaseModel):
    """确认方案请求"""
    session_id: str
    schema: DataSchema


class ChatSessionResponse(BaseModel):
    """对话会话信息响应"""
    session_id: str
    table_name: Optional[str] = None
    messages: List[ChatMessage]
    confirmed_schemas: List[DataSchema] = []  # 已确认的方案列表
    generated_sql: Optional[str] = None


# ==================== 维度标签批量创建 ====================

class DimensionTagItem(BaseModel):
    """单个维度标签"""
    name: str
    description: Optional[str] = None


class BatchDimensionTagCreate(BaseModel):
    """批量创建维度标签请求"""
    type_name: str  # 类型标签名称（AI推断）
    type_description: Optional[str] = None  # 类型标签描述
    parent_id: Optional[int] = None  # 父节点ID（可选，为空时创建在根目录）
    dimension_id: int  # 维度ID
    tags: List[DimensionTagItem]  # 子标签列表
    rule_config: RuleTagConfig  # 规则配置（共享）


class BatchDimensionTagResponse(BaseModel):
    """批量创建维度标签响应"""
    type_node: TagNodeResponse  # 创建的类型标签
    tag_nodes: List[TagNodeResponse]  # 创建的子标签列表
