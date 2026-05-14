"""Database connection primitives shared across all db modules."""

from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

# ── Persistent path ───────────────────────────────────────────────────────────
# Prioritize /app/uploads (Docker/Cloud volume mount); fall back to ./uploads
_BASE_DIR   = Path("/app/uploads") if Path("/app/uploads").exists() else Path("./uploads")
AUTH_DB_PATH = (_BASE_DIR / "rag_auth.db").resolve()
AUTH_DB_PATH.parent.mkdir(parents=True, exist_ok=True)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(str(AUTH_DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    return conn


def _column_exists(conn: sqlite3.Connection, table: str, column: str) -> bool:
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return any(str(row[1]) == column for row in rows)
