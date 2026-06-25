-- 智能-实体标签：加「宽表节点」层，按用户给的例子重构现有「用户」实体(dimension 2)
-- 结构：实体 用户 → 宽表「基础信息」(tag_user_basic_info) → 6 个类型标签
-- 注意：含数据重构，建议用配套 Python 脚本执行（需取新建宽表节点 id 再回填父子）。

-- 1. 实体 id_field 规范英文（与 AI 生成 SQL 里的 `AS user_id` 对齐）
UPDATE big_tag_dimensions SET id_field = 'user_id' WHERE id = 2 AND id_field = '用户_id';

-- 2. 新建宽表节点「基础信息」
INSERT INTO big_tag_nodes (name, node_type, dimension_id, tag_table_name, level, path, color, parent_id, project_id, is_active, created_at, updated_at)
VALUES ('基础信息', 'wide_table', 2, 'tag_user_basic_info', 1, '', '#722ed1', NULL, 1, TRUE, NOW(), NOW());
-- 取上面 INSERT 的 id 记为 @W：
SET @W = LAST_INSERT_ID();
UPDATE big_tag_nodes SET path = CONCAT('/', @W) WHERE id = @W;

-- 3. 把该实体下 6 个类型标签挂到宽表节点下（全局父子）
UPDATE big_tag_nodes SET parent_id = @W
 WHERE node_type = 'type' AND dimension_id = 2 AND is_active = TRUE;

-- 4. 宽表节点 + 6 个类型标签 加入项目1 的成员关系（per-project 父=宽表）
INSERT IGNORE INTO big_tag_node_projects (node_id, project_id, parent_id, created_at)
VALUES (@W, 1, NULL, NOW());
UPDATE big_tag_node_projects np
  JOIN big_tag_nodes n ON n.id = np.node_id
  SET np.parent_id = @W
 WHERE n.node_type = 'type' AND n.dimension_id = 2 AND np.project_id = 1;
INSERT IGNORE INTO big_tag_node_projects (node_id, project_id, parent_id, created_at)
SELECT id, 1, @W, NOW() FROM big_tag_nodes
 WHERE node_type = 'type' AND dimension_id = 2 AND is_active = TRUE;

-- 5. 旧的实体级自动表名清掉（宽表名移到宽表节点）
UPDATE big_tag_dimensions SET tag_table_name = NULL WHERE id = 2;
-- 空的 tag_entity_2（若存在）由运维在仓库侧 DROP。
