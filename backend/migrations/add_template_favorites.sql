-- 创建模版收藏表
-- 用于收藏分类标签到模版（只存储引用关系，不复制标签）

CREATE TABLE IF NOT EXISTS big_tag_template_favorites (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    node_id BIGINT NOT NULL COMMENT '收藏的标签节点ID',
    created_by BIGINT COMMENT '创建人',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_favorite_node FOREIGN KEY (node_id) REFERENCES big_tag_nodes(id) ON DELETE CASCADE,
    CONSTRAINT fk_favorite_user FOREIGN KEY (created_by) REFERENCES big_users(id) ON DELETE SET NULL,

    INDEX idx_template_favorite_node (node_id),
    INDEX idx_template_favorite_user (created_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='模版收藏表';
