-- 标签维度表迁移
-- 执行时间: 2026-06-14
-- 描述: 新增维度管理功能，支持智能-维度标签

-- 1. 创建维度表
CREATE TABLE IF NOT EXISTS big_tag_dimensions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,           -- 维度标识: user_dimension
    display_name VARCHAR(100) NOT NULL,   -- 显示名: 用户维度
    id_field VARCHAR(100) NOT NULL,       -- ID字段: user_id
    description VARCHAR(500),
    is_preset BOOLEAN DEFAULT FALSE,      -- 是否预设
    is_active BOOLEAN DEFAULT TRUE,
    created_by BIGINT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES big_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. 插入预设维度
INSERT INTO big_tag_dimensions (name, display_name, id_field, description, is_preset) VALUES
('user_dimension', '用户维度', 'user_id', '以用户ID为唯一标识的标签维度', TRUE),
('sku_dimension', '商品维度', 'sku_id', '以商品SKU为唯一标识的标签维度', TRUE),
('hotel_dimension', '酒店维度', 'hotel_id', '以酒店ID为唯一标识的标签维度', TRUE),
('order_dimension', '订单维度', 'order_id', '以订单ID为唯一标识的标签维度', TRUE);

-- 3. 给 big_tag_nodes 表添加 dimension_id 列
ALTER TABLE big_tag_nodes
ADD COLUMN dimension_id BIGINT NULL AFTER project_id;

-- 4. 添加外键约束
ALTER TABLE big_tag_nodes
ADD CONSTRAINT fk_tag_node_dimension
FOREIGN KEY (dimension_id) REFERENCES big_tag_dimensions(id);

-- 5. 添加索引
CREATE INDEX idx_tag_node_dimension ON big_tag_nodes(dimension_id);
