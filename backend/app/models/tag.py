"""
标签管理平台 - 统一树形结构模型
"""
from datetime import datetime
from sqlalchemy import Column, BigInteger, String, Boolean, DateTime, ForeignKey, Text, Index
from sqlalchemy.orm import relationship

from app.core.database import Base


class TagDimension(Base):
    """
    标签维度 - 定义标签的维度（如用户维度、商品维度）
    每个维度有唯一的ID字段
    """
    __tablename__ = "big_tag_dimensions"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False)  # 维度标识: user_dimension
    display_name = Column(String(100), nullable=False)  # 显示名: 用户维度
    id_field = Column(String(100), nullable=False)  # ID字段: user_id
    description = Column(String(500))
    is_preset = Column(Boolean, default=False)  # 是否预设
    is_active = Column(Boolean, default=True)
    created_by = Column(BigInteger, ForeignKey("big_users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # 关系
    nodes = relationship("TagNode", back_populates="dimension")


class TagProject(Base):
    """
    标签项目 - 用于组织标签体系
    每个项目包含独立的标签层级结构
    """
    __tablename__ = "big_tag_projects"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False)
    description = Column(String(500))

    # 项目封面颜色/图标
    color = Column(String(20), default="#1890ff")
    icon = Column(String(50))

    # 统计
    node_count = Column(BigInteger, default=0)  # 节点总数
    tag_count = Column(BigInteger, default=0)   # 标签数量

    # 状态
    is_active = Column(Boolean, default=True)

    # 审计
    created_by = Column(BigInteger, ForeignKey("big_users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # 关系
    nodes = relationship("TagNode", back_populates="project", cascade="all, delete-orphan")


class TagNode(Base):
    """
    标签节点 - 统一的树形结构
    可以是分类（文件夹）或标签（叶子节点）
    """
    __tablename__ = "big_tag_nodes"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False)
    description = Column(String(500))

    # 所属项目
    project_id = Column(BigInteger, ForeignKey("big_tag_projects.id"))

    # 所属维度（维度标签专用）
    dimension_id = Column(BigInteger, ForeignKey("big_tag_dimensions.id"))

    # 节点类型: category=分类, type=类型标签, tag=维度标签, detail=粒度标签, template=模版标签
    # 层级规则: category下可放任何, type下可放tag/detail/template, tag/detail/template下不能放任何
    node_type = Column(String(20), nullable=False, default="tag")

    # 树形结构
    parent_id = Column(BigInteger, ForeignKey("big_tag_nodes.id"))
    path = Column(String(500))  # 完整路径，如 /1/3/5 便于查询
    level = Column(BigInteger, default=1)  # 层级深度，根节点为1
    sort_order = Column(BigInteger, default=0)

    # 样式
    color = Column(String(20), default="#1890ff")
    icon = Column(String(50))

    # 标签规则（仅 node_type=tag 时有效）
    rule_type = Column(String(50))  # manual, sql, ai
    rule_config = Column(Text)  # JSON配置

    # 行级标签相关
    tag_table_name = Column(String(255))  # 标签数据表名
    source_datasource_id = Column(BigInteger)  # 数据源ID
    source_table = Column(String(255))  # 源表名

    # 模版标签引用（指向原始标签，用于同步名字等信息）
    source_node_id = Column(BigInteger, ForeignKey("big_tag_nodes.id"))

    # AI相关
    ai_generated = Column(Boolean, default=False)
    ai_confidence = Column(BigInteger)

    # 统计
    usage_count = Column(BigInteger, default=0)

    # 状态
    is_active = Column(Boolean, default=True)

    # 审计
    created_by = Column(BigInteger, ForeignKey("big_users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # 关系
    project = relationship("TagProject", back_populates="nodes")
    dimension = relationship("TagDimension", back_populates="nodes")
    parent = relationship("TagNode", remote_side=[id], backref="children", foreign_keys=[parent_id])
    source_node = relationship("TagNode", remote_side=[id], foreign_keys=[source_node_id])
    tag_data = relationship("TagData", back_populates="tag_node", cascade="all, delete-orphan")

    __table_args__ = (
        Index('idx_tag_node_parent', 'parent_id'),
        Index('idx_tag_node_path', 'path'),
        Index('idx_tag_node_type', 'node_type'),
        Index('idx_tag_node_project', 'project_id'),
        Index('idx_tag_node_dimension', 'dimension_id'),
    )


class TagData(Base):
    """
    标签数据 - 记录哪些数据被打上了哪个标签
    """
    __tablename__ = "big_tag_data"

    id = Column(BigInteger, primary_key=True, autoincrement=True)

    # 关联的标签节点
    tag_node_id = Column(BigInteger, ForeignKey("big_tag_nodes.id"), nullable=False)

    # 数据来源
    datasource_id = Column(BigInteger, ForeignKey("big_datasources.id"))
    table_name = Column(String(255))

    # 数据标识（行级标签时用于标识具体行）
    row_id = Column(String(255))  # 原表的主键值

    # 打标信息
    tagged_by = Column(String(50), default="manual")  # manual, rule, ai
    ai_confidence = Column(BigInteger)

    created_by = Column(BigInteger, ForeignKey("big_users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)

    # 关系
    tag_node = relationship("TagNode", back_populates="tag_data")
    datasource = relationship("DataSource")

    __table_args__ = (
        Index('idx_tag_data_node', 'tag_node_id'),
        Index('idx_tag_data_source', 'datasource_id', 'table_name'),
    )


class TagTemplateFavorite(Base):
    """
    模版收藏 - 收藏分类标签到模版（只存储引用关系，不复制标签）
    收藏后在侧边栏模版区显示，拖到画布时展开原标签及其子标签
    """
    __tablename__ = "big_tag_template_favorites"

    id = Column(BigInteger, primary_key=True, autoincrement=True)

    # 收藏的标签节点（必须是 category 类型）
    node_id = Column(BigInteger, ForeignKey("big_tag_nodes.id"), nullable=False)

    # 审计
    created_by = Column(BigInteger, ForeignKey("big_users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)

    # 关系
    node = relationship("TagNode")

    __table_args__ = (
        Index('idx_template_favorite_node', 'node_id'),
        Index('idx_template_favorite_user', 'created_by'),
    )
