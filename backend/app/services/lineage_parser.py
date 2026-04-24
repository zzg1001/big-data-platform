"""
SQL lineage parser service.
"""
from typing import List, Dict, Set, Tuple, Optional
from dataclasses import dataclass
import re

import sqlparse
from sqlparse.sql import IdentifierList, Identifier, Where, Parenthesis
from sqlparse.tokens import Keyword, DML


@dataclass
class LineageNode:
    """Represents a table in the lineage graph."""
    name: str
    schema: Optional[str] = None
    alias: Optional[str] = None
    columns: List[str] = None

    def __post_init__(self):
        if self.columns is None:
            self.columns = []

    @property
    def full_name(self) -> str:
        if self.schema:
            return f"{self.schema}.{self.name}"
        return self.name


@dataclass
class LineageEdge:
    """Represents a dependency between tables."""
    source: str  # Source table (being read from)
    target: str  # Target table (being written to)
    columns: List[Tuple[str, str]] = None  # [(source_col, target_col)]

    def __post_init__(self):
        if self.columns is None:
            self.columns = []


class LineageParser:
    """Service for parsing SQL and extracting data lineage."""

    def __init__(self):
        self.source_tables: Set[str] = set()
        self.target_tables: Set[str] = set()
        self.cte_names: Set[str] = set()

    def parse(self, sql: str) -> Dict:
        """Parse SQL and extract lineage information."""
        self.source_tables = set()
        self.target_tables = set()
        self.cte_names = set()

        # Parse SQL
        parsed = sqlparse.parse(sql)

        for statement in parsed:
            self._process_statement(statement)

        # Build lineage graph
        nodes = []
        edges = []

        # Remove CTEs from source tables (they're intermediate)
        actual_sources = self.source_tables - self.cte_names

        for table in actual_sources:
            nodes.append({"id": table, "type": "source", "name": table})

        for table in self.target_tables:
            nodes.append({"id": table, "type": "target", "name": table})
            # Create edges from sources to target
            for source in actual_sources:
                edges.append({"source": source, "target": table})

        return {
            "nodes": nodes,
            "edges": edges,
            "source_tables": list(actual_sources),
            "target_tables": list(self.target_tables),
            "ctes": list(self.cte_names),
        }

    def _process_statement(self, statement):
        """Process a single SQL statement."""
        # Check statement type
        stmt_type = statement.get_type()

        if stmt_type == "SELECT":
            self._extract_from_tables(statement)
        elif stmt_type == "INSERT":
            self._process_insert(statement)
        elif stmt_type == "CREATE":
            self._process_create(statement)
        elif stmt_type == "UPDATE":
            self._process_update(statement)
        else:
            # Try to extract tables anyway
            self._extract_from_tables(statement)

        # Extract CTEs
        self._extract_ctes(statement)

    def _extract_ctes(self, statement):
        """Extract Common Table Expression (CTE) names."""
        tokens = list(statement.flatten())

        i = 0
        while i < len(tokens):
            if tokens[i].ttype is Keyword and tokens[i].value.upper() == "WITH":
                # Look for CTE names
                j = i + 1
                while j < len(tokens):
                    if tokens[j].ttype is Keyword and tokens[j].value.upper() == "AS":
                        # Previous non-whitespace token should be CTE name
                        k = j - 1
                        while k > i and tokens[k].is_whitespace:
                            k -= 1
                        if k > i:
                            cte_name = tokens[k].value.strip('"\'`')
                            self.cte_names.add(cte_name.lower())
                    elif tokens[j].ttype is Keyword and tokens[j].value.upper() == "SELECT":
                        break
                    j += 1
            i += 1

    def _extract_from_tables(self, statement):
        """Extract tables from FROM and JOIN clauses."""
        from_seen = False

        for token in statement.tokens:
            if token.ttype is Keyword:
                if token.value.upper() in ("FROM", "JOIN", "INNER JOIN", "LEFT JOIN",
                                           "RIGHT JOIN", "FULL JOIN", "CROSS JOIN"):
                    from_seen = True
                elif token.value.upper() in ("WHERE", "GROUP", "ORDER", "LIMIT", "HAVING"):
                    from_seen = False
            elif from_seen:
                if isinstance(token, IdentifierList):
                    for identifier in token.get_identifiers():
                        self._add_source_table(identifier)
                elif isinstance(token, Identifier):
                    self._add_source_table(token)
                elif isinstance(token, Parenthesis):
                    # Subquery
                    self._extract_from_tables(token)

    def _add_source_table(self, identifier):
        """Add a table to source tables."""
        if isinstance(identifier, Identifier):
            name = identifier.get_real_name()
            if name:
                self.source_tables.add(name.lower().strip('"\'`'))
        elif hasattr(identifier, "value"):
            name = identifier.value.strip().strip('"\'`')
            if name and not name.upper() in ("SELECT", "FROM", "WHERE", "AND", "OR"):
                self.source_tables.add(name.lower())

    def _process_insert(self, statement):
        """Process INSERT statement to get target table."""
        tokens = list(statement.flatten())

        for i, token in enumerate(tokens):
            if token.ttype is Keyword and token.value.upper() == "INTO":
                # Next non-whitespace token should be table name
                for j in range(i + 1, len(tokens)):
                    if not tokens[j].is_whitespace and tokens[j].value != "(":
                        table_name = tokens[j].value.strip('"\'`')
                        self.target_tables.add(table_name.lower())
                        break
                break

        # Also extract source tables from SELECT part
        self._extract_from_tables(statement)

    def _process_create(self, statement):
        """Process CREATE TABLE AS SELECT statement."""
        sql_upper = statement.value.upper()

        if "CREATE" in sql_upper and "TABLE" in sql_upper:
            tokens = list(statement.flatten())

            table_seen = False
            for i, token in enumerate(tokens):
                if token.ttype is Keyword and token.value.upper() == "TABLE":
                    table_seen = True
                elif table_seen and not token.is_whitespace:
                    if token.value.upper() not in ("IF", "NOT", "EXISTS"):
                        table_name = token.value.strip('"\'`')
                        self.target_tables.add(table_name.lower())
                        break

            # Extract source tables from SELECT part
            if "AS" in sql_upper and "SELECT" in sql_upper:
                self._extract_from_tables(statement)

    def _process_update(self, statement):
        """Process UPDATE statement."""
        tokens = list(statement.flatten())

        for i, token in enumerate(tokens):
            if token.ttype is Keyword and token.value.upper() == "UPDATE":
                # Next non-whitespace token should be table name
                for j in range(i + 1, len(tokens)):
                    if not tokens[j].is_whitespace:
                        table_name = tokens[j].value.strip('"\'`')
                        self.target_tables.add(table_name.lower())
                        break
                break

        # Extract source tables from SET and WHERE clauses
        self._extract_from_tables(statement)

    def get_table_dependencies(self, sqls: List[str]) -> Dict[str, Set[str]]:
        """Get table dependencies from multiple SQL statements."""
        dependencies = {}  # target -> set of sources

        for sql in sqls:
            result = self.parse(sql)
            for target in result["target_tables"]:
                if target not in dependencies:
                    dependencies[target] = set()
                dependencies[target].update(result["source_tables"])

        return dependencies
