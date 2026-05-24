"""Usage statistics, request logs, and admin helper utilities — PostgreSQL version."""

from __future__ import annotations

import json
from typing import Any

from .connection import _connect, _utc_now


def upsert_usage(user_id: int, request_inc: int = 0, llm_calls: int = 0, token_usage: int = 0) -> None:
    now = _utc_now()
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO usage_stats(user_id, request_count, llm_calls, token_usage, last_activity)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT(user_id) DO UPDATE SET
                request_count = usage_stats.request_count + EXCLUDED.request_count,
                llm_calls     = usage_stats.llm_calls     + EXCLUDED.llm_calls,
                token_usage   = usage_stats.token_usage   + EXCLUDED.token_usage,
                last_activity = EXCLUDED.last_activity
            """,
            (user_id, request_inc, llm_calls, token_usage, now),
        )
        conn.commit()


def log_request(
    user_id: int | None,
    endpoint: str,
    method: str,
    status_code: int,
    ip_address: str | None,
    llm_calls: int = 0,
    token_usage: int = 0,
) -> None:
    with _connect() as conn:
        conn.execute(
            "INSERT INTO request_logs(user_id, endpoint, method, status_code, llm_calls, token_usage, ip_address, created_at) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
            (user_id, endpoint, method, status_code, llm_calls, token_usage, ip_address, _utc_now()),
        )
        conn.commit()


def list_usage() -> list[dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT u.id AS user_id, u.username, u.role,
                   COALESCE(us.request_count, 0) AS request_count,
                   COALESCE(us.llm_calls, 0) AS llm_calls,
                   COALESCE(us.token_usage, 0) AS token_usage,
                   us.last_activity
            FROM users u
            LEFT JOIN usage_stats us ON us.user_id = u.id
            ORDER BY COALESCE(us.last_activity, u.created_at) DESC
            """
        ).fetchall()
    return [dict(r) for r in rows]


def list_logs(limit: int = 200) -> list[dict[str, Any]]:
    safe_limit = max(1, min(1000, int(limit)))
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT rl.*, u.username
            FROM request_logs rl
            LEFT JOIN users u ON u.id = rl.user_id
            ORDER BY rl.created_at DESC
            LIMIT %s
            """,
            (safe_limit,),
        ).fetchall()
    return [dict(r) for r in rows]


def estimate_tokens_from_text(*parts: str) -> int:
    """Rough token count estimate for mixed VI/EN content (~4 chars/token)."""
    total_chars = sum(len(p or "") for p in parts)
    return max(1, total_chars // 4)


def dumps_json(data: Any) -> str:
    return json.dumps(data, ensure_ascii=True)
