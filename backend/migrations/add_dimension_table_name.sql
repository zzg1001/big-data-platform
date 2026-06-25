-- 智能-实体标签：一个实体一张画像宽表
-- 描述: 给 big_tag_dimensions（实体/维度）增加 tag_table_name 列，
--       记录该实体的画像宽表名。同一实体下所有类型标签 UPSERT 进这张表，每个类型标签为一列。
-- 注意: create_all 不会给已存在表加列，需手动执行。

ALTER TABLE big_tag_dimensions ADD COLUMN tag_table_name VARCHAR(255) NULL;
