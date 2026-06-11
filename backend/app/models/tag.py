"""
标签管理平台 - 统一树形结构模型
"""
from datetime import datetime
from sqlalchemy import Column, BigInteger, String, Boolean, DateTime, ForeignKey, Text, Index
from sqlalchemy.orm import relationship

from app.core.database import Base


class TagNode(Base):
    """
    标签节点 - 统一的树形结构
    可以是分类（文件夹）或标签（叶子节点）
    """
    __tablename__ = "big_tag_nodes"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False)
    description = Column(String(500))

    # 节点类型: category=分类, type=类型(字段名), tag=标签(字段值)
    # 层级规则: category下可放任何, type下只能放tag, tag下不能放任何
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
    parent = relationship("TagNode", remote_side=[id], backref="children")
    tag_data = relationship("TagData", back_populates="tag_node", cascade="all, delete-orphan")

    __table_args__ = (
        Index('idx_tag_node_parent', 'parent_id'),
        Index('idx_tag_node_path', 'path'),
        Index('idx_tag_node_type', 'node_type'),
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
