-- 添加粒度标签分类迁移
-- 执行时间: 2026-06-14
-- 描述: 为所有现有项目添加"粒度标签"默认分类

-- 为每个现有项目添加"粒度标签"分类（如果不存在）
INSERT INTO big_tag_nodes (name, description, project_id, node_type, level, color, created_at, updated_at)
SELECT
    '粒度标签',
    'AI对话生成的粒度标签分类',
    p.id,
    'category',
    1,
    '#1890ff',
    NOW(),
    NOW()
FROM big_tag_projects p
WHERE NOT EXISTS (
    SELECT 1 FROM big_tag_nodes n
    WHERE n.project_id = p.id
    AND n.name = '粒度标签'
    AND n.node_type = 'category'
);

-- 更新项目节点计数
UPDATE big_tag_projects p
SET node_count = (
    SELECT COUNT(*) FROM big_tag_nodes n WHERE n.project_id = p.id
);
