-- 更新AI对话创建的标签为粒度标签
-- 执行时间: 2026-06-14
-- 描述: 将通过AI对话(ai_chat)创建的标签的node_type从'tag'改为'detail'

-- 更新所有source为'ai_chat'的标签为粒度标签
UPDATE big_tag_nodes
SET node_type = 'detail',
    updated_at = NOW()
WHERE rule_config LIKE '%"source": "ai_chat"%'
  AND node_type = 'tag';

-- 或者根据source_table为'multi_table'来判断（全库模式）
UPDATE big_tag_nodes
SET node_type = 'detail',
    updated_at = NOW()
WHERE source_table = 'multi_table'
  AND node_type = 'tag';

-- 查看更新结果
SELECT id, name, node_type, source_table,
       JSON_EXTRACT(rule_config, '$.source') as source
FROM big_tag_nodes
WHERE rule_type = 'sql';
