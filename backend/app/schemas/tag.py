"""
标签管理平台 - API Schema
"""
from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel


# ==================== 标签节点 ====================

class TagNodeBase(BaseModel):
    name: str
    description: Optional[str] = None
    node_type: str = "tag"  # category 或 tag
    parent_id: Optional[int] = None
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
    color: Optional[str] = None
    icon: Optional[str] = None
    sort_order: Optional[int] = None
    rule_type: Optional[str] = None
    rule_config: Optional[str] = None
    is_active: Optional[bool] = None


class TagNodeResponse(TagNodeBase):
    id: int
    path: Optional[str] = None
    level: int
    rule_type: Optional[str] = None
    rule_config: Optional[str] = None
    tag_table_name: Optional[str] = None
    source_datasource_id: Optional[int] = None
    source_table: Optional[str] = None
    ai_generated: bool = False
    ai_confidence: Optional[int] = None
    usage_count: int = 0
    is_active: bool = True
    created_at: datetime
    updated_at: datetime
    # 额外字段
    parent_name: Optional[str] = None
    children_count: Optional[int] = 0

    class Config:
        from_attributes = True


class TagNodeTree(BaseModel):
    """树形节点"""
    id: int
    name: str
    description: Optional[str] = None
    node_type: str
    color: str
    icon: Optional[str] = None
    level: int
    usage_count: int = 0
    rule_type: Optional[str] = None
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

class RuleTagConfig(BaseModel):
    """规则标签配置"""
    datasource_id: Optional[int] = None  # 为空时使用平台仓库
    source_table: str
    sql_condition: Optional[str] = None  # WHERE条件
    full_sql: Optional[str] = None  # 完整SQL


class RuleTagCreate(BaseModel):
    """创建规则标签"""
    name: str
    description: Optional[str] = None
    parent_id: Optional[int] = None
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
    ai_generated_count: int
    rule_tag_count: int
    top_tags: List[dict]
