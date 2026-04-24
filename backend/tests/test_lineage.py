"""
Tests for lineage parser.
"""
import pytest
from app.services.lineage_parser import LineageParser


def test_parse_simple_select():
    """Test parsing simple SELECT query."""
    parser = LineageParser()
    result = parser.parse("SELECT * FROM users")

    assert "users" in result["source_tables"]
    assert len(result["target_tables"]) == 0


def test_parse_select_with_join():
    """Test parsing SELECT with JOIN."""
    parser = LineageParser()
    sql = """
    SELECT u.name, o.total
    FROM users u
    JOIN orders o ON u.id = o.user_id
    """
    result = parser.parse(sql)

    assert "users" in result["source_tables"] or "u" in result["source_tables"]
    assert "orders" in result["source_tables"] or "o" in result["source_tables"]


def test_parse_insert_select():
    """Test parsing INSERT ... SELECT."""
    parser = LineageParser()
    sql = """
    INSERT INTO summary
    SELECT date, count(*) as cnt
    FROM events
    GROUP BY date
    """
    result = parser.parse(sql)

    assert "summary" in result["target_tables"]
    assert "events" in result["source_tables"]


def test_parse_create_table_as():
    """Test parsing CREATE TABLE AS SELECT."""
    parser = LineageParser()
    sql = """
    CREATE TABLE monthly_stats AS
    SELECT month, SUM(amount) as total
    FROM transactions
    GROUP BY month
    """
    result = parser.parse(sql)

    assert "monthly_stats" in result["target_tables"]
    assert "transactions" in result["source_tables"]


def test_parse_with_cte():
    """Test parsing query with CTE."""
    parser = LineageParser()
    sql = """
    WITH active_users AS (
        SELECT id, name FROM users WHERE status = 'active'
    )
    SELECT au.name, count(o.id) as order_count
    FROM active_users au
    JOIN orders o ON au.id = o.user_id
    GROUP BY au.name
    """
    result = parser.parse(sql)

    # CTE should be identified
    assert "active_users" in result["ctes"]
    # Source tables should not include CTE
    assert "users" in result["source_tables"]
    assert "orders" in result["source_tables"]


def test_get_table_dependencies():
    """Test getting dependencies from multiple SQLs."""
    parser = LineageParser()
    sqls = [
        "INSERT INTO dim_users SELECT * FROM raw_users",
        "INSERT INTO dim_orders SELECT * FROM raw_orders",
        "INSERT INTO fact_sales SELECT * FROM dim_users JOIN dim_orders ON dim_users.id = dim_orders.user_id",
    ]

    deps = parser.get_table_dependencies(sqls)

    assert "raw_users" in deps.get("dim_users", set())
    assert "raw_orders" in deps.get("dim_orders", set())
    assert "dim_users" in deps.get("fact_sales", set())
    assert "dim_orders" in deps.get("fact_sales", set())
