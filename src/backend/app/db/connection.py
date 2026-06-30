"""Database connection primitives shared across all db modules.

Uses psycopg (v3) to connect to PostgreSQL.  The connection is configured
via environment variables so it works both locally and inside Docker.
"""

from __future__ import annotations

import os
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Generator

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

# ── Connection parameters (read from env) ─────────────────────────────────────

def _get_dsn() -> str:
    host     = os.getenv("POSTGRES_HOST", "localhost")
    port     = os.getenv("POSTGRES_PORT", "5432")
    dbname   = os.getenv("POSTGRES_DB",   "rag_teaching_material")
    user     = os.getenv("POSTGRES_USER", "rag_user")
    password = os.getenv("POSTGRES_PASSWORD", "rag_secure_password_2024")
    return f"host={host} port={port} dbname={dbname} user={user} password={password}"

_pool: ConnectionPool | None = None

def get_pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        _pool = ConnectionPool(
            conninfo=_get_dsn(),
            min_size=int(os.getenv("DB_POOL_MIN", "2")),
            max_size=int(os.getenv("DB_POOL_MAX", "10")),
            kwargs={"row_factory": dict_row},
        )
    return _pool


# ── Helpers ───────────────────────────────────────────────────────────────────

def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()

@contextmanager
def _connect() -> Generator[psycopg.Connection, None, None]:
    """Get a connection from the global pool with dict-style rows."""
    with get_pool().connection() as conn:
        yield conn


def _column_exists(conn: psycopg.Connection, table: str, column: str) -> bool:
    """Check whether *column* exists in *table* via information_schema."""
    row = conn.execute(
        """
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = %s
          AND column_name  = %s
        """,
        (table, column),
    ).fetchone()
    return row is not None


def _table_exists(conn: psycopg.Connection, table: str) -> bool:
    """Check whether *table* exists in the public schema."""
    row = conn.execute(
        """
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name   = %s
        """,
        (table,),
    ).fetchone()
    return row is not None
