#!/usr/bin/env python3
"""
修复AI对话创建的标签，将其node_type改为'detail'（粒度标签）
"""
import sys
import os

# 添加项目路径
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, text
from app.core.config import settings

def main():
    # 创建数据库连接
    engine = create_engine(settings.DATABASE_URL.replace('+aiomysql', '+pymysql'))

    with engine.connect() as conn:
        # 查看当前状态
        result = conn.execute(text("""
            SELECT id, name, node_type, source_table
            FROM big_tag_nodes
            WHERE source_table = 'multi_table' OR name = '全国酒店综合推荐表'
        """))
        rows = result.fetchall()

        print("当前状态：")
        for row in rows:
            print(f"  ID={row[0]}, 名称={row[1]}, node_type={row[2]}, source_table={row[3]}")

        if not rows:
            print("没有找到需要更新的标签")
            return

        # 执行更新
        result = conn.execute(text("""
            UPDATE big_tag_nodes
            SET node_type = 'detail', updated_at = NOW()
            WHERE (source_table = 'multi_table' OR name = '全国酒店综合推荐表')
              AND node_type = 'tag'
        """))
        conn.commit()

        print(f"\n已更新 {result.rowcount} 条记录")

        # 验证更新
        result = conn.execute(text("""
            SELECT id, name, node_type, source_table
            FROM big_tag_nodes
            WHERE source_table = 'multi_table' OR name = '全国酒店综合推荐表'
        """))
        rows = result.fetchall()

        print("\n更新后状态：")
        for row in rows:
            print(f"  ID={row[0]}, 名称={row[1]}, node_type={row[2]}, source_table={row[3]}")

if __name__ == "__main__":
    main()
