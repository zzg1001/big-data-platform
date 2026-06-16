-- 添加 source_node_id 字段到 big_tag_nodes 表
-- 用于模版标签引用原标签，实现名字同步

-- MySQL 语法
ALTER TABLE big_tag_nodes
ADD COLUMN source_node_id BIGINT NULL COMMENT '模版标签引用的原标签ID，用于同步名字等信息';

-- 添加索引
CREATE INDEX idx_tag_node_source ON big_tag_nodes(source_node_id);

-- 添加外键约束
ALTER TABLE big_tag_nodes
ADD CONSTRAINT fk_tag_node_source FOREIGN KEY (source_node_id) REFERENCES big_tag_nodes(id) ON DELETE SET NULL;
