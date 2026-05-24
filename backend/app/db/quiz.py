"""Quiz attempt persistence — PostgreSQL version."""

from __future__ import annotations

import json
from typing import Any

from .connection import _connect, _utc_now


def save_quiz_attempt(
    score: int,
    total: int,
    num_questions: int,
    answers: dict,
    user_id: int | None = None,
    project_id: str | None = None,
    variation_seed: int | None = None,
) -> dict[str, Any]:
    pct = round((score / total * 100), 1) if total > 0 else 0.0
    now = _utc_now()
    with _connect() as conn:
        cur = conn.execute(
            """
            INSERT INTO quiz_attempts(
                user_id, project_id, score, total, percentage,
                num_questions, variation_seed, answers_json, created_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                int(user_id) if user_id else None,
                (str(project_id).strip() or None) if project_id else None,
                int(score),
                int(total),
                pct,
                int(num_questions),
                int(variation_seed) if variation_seed is not None else None,
                json.dumps(answers, ensure_ascii=False),
                now,
            ),
        )
        attempt_id = int(cur.fetchone()["id"])
        conn.commit()
    return {"id": attempt_id, "score": score, "total": total, "percentage": pct, "created_at": now}


def list_quiz_attempts(
    user_id: int | None = None,
    project_id: str | None = None,
    limit: int = 20,
) -> list[dict[str, Any]]:
    with _connect() as conn:
        if user_id and project_id:
            rows = conn.execute(
                "SELECT * FROM quiz_attempts WHERE user_id=%s AND project_id=%s ORDER BY created_at DESC LIMIT %s",
                (int(user_id), str(project_id), limit),
            ).fetchall()
        elif user_id:
            rows = conn.execute(
                "SELECT * FROM quiz_attempts WHERE user_id=%s ORDER BY created_at DESC LIMIT %s",
                (int(user_id), limit),
            ).fetchall()
        elif project_id:
            rows = conn.execute(
                "SELECT * FROM quiz_attempts WHERE project_id=%s ORDER BY created_at DESC LIMIT %s",
                (str(project_id), limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM quiz_attempts ORDER BY created_at DESC LIMIT %s",
                (limit,),
            ).fetchall()
    return [dict(r) for r in rows]


def get_quiz_stats(
    user_id: int | None = None,
    project_id: str | None = None,
) -> dict[str, Any]:
    """Return aggregate stats: attempts, avg_score, best_score, last_attempt."""
    with _connect() as conn:
        if user_id and project_id:
            row = conn.execute(
                "SELECT COUNT(*) as attempts, AVG(percentage) as avg_pct, MAX(percentage) as best_pct, MAX(created_at) as last_at FROM quiz_attempts WHERE user_id=%s AND project_id=%s",
                (int(user_id), str(project_id)),
            ).fetchone()
        elif user_id:
            row = conn.execute(
                "SELECT COUNT(*) as attempts, AVG(percentage) as avg_pct, MAX(percentage) as best_pct, MAX(created_at) as last_at FROM quiz_attempts WHERE user_id=%s",
                (int(user_id),),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT COUNT(*) as attempts, AVG(percentage) as avg_pct, MAX(percentage) as best_pct, MAX(created_at) as last_at FROM quiz_attempts"
            ).fetchone()
    if not row or not row["attempts"]:
        return {"attempts": 0, "avg_percentage": None, "best_percentage": None, "last_attempt_at": None}
    return {
        "attempts":         int(row["attempts"]),
        "avg_percentage":   round(float(row["avg_pct"] or 0), 1),
        "best_percentage":  round(float(row["best_pct"] or 0), 1),
        "last_attempt_at":  str(row["last_at"] or ""),
    }
