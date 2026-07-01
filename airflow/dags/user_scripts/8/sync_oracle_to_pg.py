# -*- coding: utf-8 -*-
"""
TG_ECC_MSEG  Oracle -> PostgreSQL 批量同步

逻辑：
  1. 从 Oracle 按条件分批读取
  2. 批量 UPSERT 写入 PG（按主键冲突更新，可重复运行、幂等）

依赖：pip install oracledb "psycopg[binary]"
"""
import re
import sys
import time

import oracledb
import psycopg
from psycopg import sql
from sshtunnel import SSHTunnelForwarder

# =========================================================================
# 连接配置
# =========================================================================
ORA = dict(
    host="10.178.149.70",
    port=1521,
    service_name="BI",
    user="TAIKE",
    password="TAIKE!apo974",
)

# PG 不对外开放，需先 SSH 登录到这台机器，再连其本机 5432
SSH = dict(
    host="10.193.109.25",
    port=22,
    user="root",
    password="Yfs@202509!",
)

PG = dict(
    # PG 在远程机器本机监听，隧道转发后用 127.0.0.1
    remote_host="127.0.0.1",  # PG 在远程机器上的监听地址
    remote_port=5432,         # PG 在远程机器上的端口
    dbname="wuhu",            # 库名
    user="wuhu_user",
    password="B92P5xxX4w!",
)

# 源查询
SOURCE_SQL = (
    'SELECT * FROM OWSTG."TG_ECC_MSEG" '
    "WHERE werks = '5B20' AND BATCH_ID >= '3997073'"
)

# 目标表（schema 未明确，按生成的 DDL 默认 owstg；如在 public 改成 "public"）
PG_SCHEMA = "public"
PG_TABLE = "tg_ecc_mseg"

# 主键列（冲突判断用），对应 PG 列名
PK_COLS = ["mblnr", "mjahr", "zeile", "db_name", "batch_id"]

BATCH_SIZE = 5000             # 每批读取/写入行数
# =========================================================================


def log(msg):
    print(msg, flush=True)


def pg_ident(oracle_col):
    """Oracle 列名 -> PG 列名：普通列转小写；含特殊字符（如 /BEV2/..）保留原样。"""
    if re.fullmatch(r"[A-Za-z0-9_]+", oracle_col):
        return oracle_col.lower()
    return oracle_col  # 保留原始大小写（带斜杠等）


def main():
    # ---- 连接 Oracle ----
    ora_dsn = oracledb.makedsn(ORA["host"], ORA["port"], service_name=ORA["service_name"])
    log(f"[Oracle] 连接 {ORA['host']}:{ORA['port']}/{ORA['service_name']} ...")
    ora_conn = oracledb.connect(
        user=ORA["user"], password=ORA["password"], dsn=ora_dsn, tcp_connect_timeout=15
    )
    ora_cur = ora_conn.cursor()
    ora_cur.arraysize = BATCH_SIZE          # 提升批量读取性能
    log("[Oracle] 执行查询 ...")
    ora_cur.execute(SOURCE_SQL)

    # 动态取列名并映射到 PG
    ora_cols = [d[0] for d in ora_cur.description]
    pg_cols = [pg_ident(c) for c in ora_cols]
    log(f"[Oracle] 共 {len(ora_cols)} 列")

    # ---- 构造 UPSERT 语句 ----
    target = sql.Identifier(PG_SCHEMA, PG_TABLE)
    col_idents = [sql.Identifier(c) for c in pg_cols]
    placeholders = sql.SQL(", ").join(sql.Placeholder() * len(pg_cols))
    pk_idents = [sql.Identifier(c) for c in PK_COLS]
    update_cols = [c for c in pg_cols if c not in PK_COLS]
    set_clause = sql.SQL(", ").join(
        sql.SQL("{col} = EXCLUDED.{col}").format(col=sql.Identifier(c))
        for c in update_cols
    )
    upsert = sql.SQL(
        "INSERT INTO {target} ({cols}) VALUES ({vals}) "
        "ON CONFLICT ({pk}) DO UPDATE SET {set_clause}"
    ).format(
        target=target,
        cols=sql.SQL(", ").join(col_idents),
        vals=placeholders,
        pk=sql.SQL(", ").join(pk_idents),
        set_clause=set_clause,
    )

    # ---- 建立 SSH 隧道 ----
    log(f"[SSH] 连接 {SSH['user']}@{SSH['host']}:{SSH['port']} 建立隧道 ...")
    tunnel = SSHTunnelForwarder(
        (SSH["host"], SSH["port"]),
        ssh_username=SSH["user"],
        ssh_password=SSH["password"],
        remote_bind_address=(PG["remote_host"], PG["remote_port"]),
    )
    tunnel.start()
    local_port = tunnel.local_bind_port
    log(f"[SSH] 隧道已建立  本地 127.0.0.1:{local_port} -> "
        f"远程 {PG['remote_host']}:{PG['remote_port']}")

    # ---- 通过隧道连接 PG 并分批写入 ----
    log(f"[PG] 连接 127.0.0.1:{local_port}/{PG['dbname']} ...")
    pg_conn = psycopg.connect(
        host="127.0.0.1", port=local_port, dbname=PG["dbname"],
        user=PG["user"], password=PG["password"], connect_timeout=15,
    )

    total = 0
    batch_no = 0
    t0 = time.time()
    log(f"[同步] 每批 {BATCH_SIZE} 行，开始 ...")
    try:
        with pg_conn.cursor() as pg_cur:
            while True:
                rows = ora_cur.fetchmany(BATCH_SIZE)
                if not rows:
                    break
                batch_no += 1
                tb = time.time()
                pg_cur.executemany(upsert, rows)
                pg_conn.commit()
                total += len(rows)
                log(
                    f"  第 {batch_no} 批：{len(rows)} 行  "
                    f"(累计 {total} 行，本批 {time.time() - tb:.1f}s，"
                    f"总耗时 {time.time() - t0:.1f}s)"
                )
        log(f"\n>>> 完成：共 {batch_no} 批，同步 {total} 行，耗时 {time.time() - t0:.1f}s")
    except Exception:
        pg_conn.rollback()
        raise
    finally:
        ora_cur.close()
        ora_conn.close()
        pg_conn.close()
        tunnel.stop()


if __name__ == "__main__":
    main()
