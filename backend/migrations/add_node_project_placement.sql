-- 标签共享：父子结构改为「每个项目独立位置」+ 数据修复
-- 描述: 在 big_tag_node_projects 上增加 per-project 的 parent_id/sort_order，
--       让同一共享标签可在不同项目里挂到不同分类下，互不影响。
--       同时修复此前因"全局 parent_id"被覆盖而打乱的存量数据。
-- 注意: create_all 不会给已存在表加列，故此 ALTER 必须手动执行。

-- A. 成员表增加 per-project 位置列
ALTER TABLE big_tag_node_projects ADD COLUMN parent_id BIGINT NULL;
ALTER TABLE big_tag_node_projects ADD COLUMN sort_order BIGINT DEFAULT 0;
ALTER TABLE big_tag_node_projects
  ADD CONSTRAINT fk_nodeproj_parent FOREIGN KEY (parent_id) REFERENCES big_tag_nodes(id) ON DELETE SET NULL;

-- B. 解开被打乱的"规范父子"（node.parent_id）：
--    1) 父子跨了不同的来源项目；或 2) 违反层级规则（type 挂到了 type 下）
UPDATE big_tag_nodes c
JOIN big_tag_nodes p ON p.id = c.parent_id
SET c.parent_id = NULL
WHERE c.parent_id IS NOT NULL
  AND (
    (c.project_id IS NOT NULL AND p.project_id IS NOT NULL AND c.project_id <> p.project_id)
    OR (c.node_type = 'type' AND p.node_type = 'type')
  );

-- C. 找回掉队/孤儿节点：保证每个有效节点至少属于其来源项目
INSERT IGNORE INTO big_tag_node_projects (node_id, project_id, created_at)
SELECT id, project_id, NOW() FROM big_tag_nodes
WHERE project_id IS NOT NULL AND is_active = TRUE;

-- D. 回填各项目的挂载父节点：
--    用节点规范 parent，但仅当该 parent 也是同项目成员，否则在本项目置为根(NULL)
UPDATE big_tag_node_projects np
JOIN big_tag_nodes n ON n.id = np.node_id
LEFT JOIN big_tag_node_projects pp
  ON pp.node_id = n.parent_id AND pp.project_id = np.project_id
SET np.parent_id = CASE WHEN pp.id IS NOT NULL THEN n.parent_id ELSE NULL END;
