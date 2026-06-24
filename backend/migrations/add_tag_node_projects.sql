-- 标签节点↔项目 成员关系表迁移
-- 描述: 让同一个标签节点可同时归属多个项目（多对多），实现"标签全局唯一、各项目共享引用"。
--       标签本身（身份/规则/打标数据）仍只存一份，改一处所有项目生效。
-- 说明: 应用启动时 Base.metadata.create_all 也会自动建此表；本脚本用于手动建表 + 回填存量数据。
--       脚本幂等，可重复执行。

-- 1. 创建成员关系表
CREATE TABLE IF NOT EXISTS big_tag_node_projects (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    node_id BIGINT NOT NULL,
    project_id BIGINT NOT NULL,
    created_by BIGINT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_node_project UNIQUE (node_id, project_id),
    CONSTRAINT fk_nodeproj_node FOREIGN KEY (node_id) REFERENCES big_tag_nodes(id) ON DELETE CASCADE,
    CONSTRAINT fk_nodeproj_project FOREIGN KEY (project_id) REFERENCES big_tag_projects(id) ON DELETE CASCADE,
    CONSTRAINT fk_nodeproj_user FOREIGN KEY (created_by) REFERENCES big_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_nodeproj_node ON big_tag_node_projects(node_id);
CREATE INDEX idx_nodeproj_project ON big_tag_node_projects(project_id);

-- 2. 回填：把现有 big_tag_nodes.project_id 的归属关系迁移为成员关系
--    INSERT IGNORE 配合唯一约束保证可重复执行
INSERT IGNORE INTO big_tag_node_projects (node_id, project_id, created_at)
SELECT id, project_id, NOW()
FROM big_tag_nodes
WHERE project_id IS NOT NULL AND is_active = TRUE;
