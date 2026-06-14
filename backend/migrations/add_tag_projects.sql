-- 标签项目表迁移
-- 执行时间: 2026-06-13
-- 描述: 新增标签项目功能，允许用户创建多个独立的标签体系项目

-- 1. 创建标签项目表
CREATE TABLE IF NOT EXISTS big_tag_projects (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(500),
    color VARCHAR(20) DEFAULT '#1890ff',
    icon VARCHAR(50),
    node_count BIGINT DEFAULT 0,
    tag_count BIGINT DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_by BIGINT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES big_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. 给 big_tag_nodes 表添加 project_id 列
ALTER TABLE big_tag_nodes
ADD COLUMN project_id BIGINT NULL AFTER description;

-- 3. 添加外键约束
ALTER TABLE big_tag_nodes
ADD CONSTRAINT fk_tag_node_project
FOREIGN KEY (project_id) REFERENCES big_tag_projects(id);

-- 4. 添加索引
CREATE INDEX idx_tag_node_project ON big_tag_nodes(project_id);

-- 5. (可选) 创建默认项目并将现有节点迁移到该项目
-- INSERT INTO big_tag_projects (name, description, color) VALUES ('默认项目', '系统默认项目', '#1890ff');
-- UPDATE big_tag_nodes SET project_id = (SELECT id FROM big_tag_projects WHERE name = '默认项目');
