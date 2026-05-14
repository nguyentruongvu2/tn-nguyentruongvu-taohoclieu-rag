"""Slide draft persistence."""

from __future__ import annotations

import json
from typing import Any

from .connection import _connect, _utc_now


def save_slide_draft(
    project_id: str,
    title: str,
    slides: list,
    layouts: dict,
    user_id: int | None = None,
) -> dict[str, Any]:
    """Upsert (overwrite) latest slide draft for a project+user."""
    now          = _utc_now()
    slides_json  = json.dumps(slides,  ensure_ascii=False)
    layouts_json = json.dumps(layouts, ensure_ascii=False)

    with _connect() as conn:
        if user_id:
            conn.execute(
                "DELETE FROM slide_drafts WHERE project_id = ? AND user_id = ?",
                (project_id, int(user_id)),
            )
        else:
            conn.execute(
                "DELETE FROM slide_drafts WHERE project_id = ? AND user_id IS NULL",
                (project_id,),
            )
        cur = conn.execute(
            """
            INSERT INTO slide_drafts(user_id, project_id, title, slides_json, layouts_json, slide_count, saved_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                int(user_id) if user_id else None,
                str(project_id).strip(),
                str(title or "").strip()[:200],
                slides_json,
                layouts_json,
                len(slides),
                now,
            ),
        )
    return {"id": int(cur.lastrowid), "slide_count": len(slides), "saved_at": now}


def load_slide_draft(
    project_id: str,
    user_id: int | None = None,
) -> dict[str, Any] | None:
    """Load latest slide draft for a project."""
    with _connect() as conn:
        if user_id:
            row = conn.execute(
                "SELECT * FROM slide_drafts WHERE project_id = ? AND user_id = ? ORDER BY datetime(saved_at) DESC LIMIT 1",
                (str(project_id), int(user_id)),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT * FROM slide_drafts WHERE project_id = ? ORDER BY datetime(saved_at) DESC LIMIT 1",
                (str(project_id),),
            ).fetchone()
    if not row:
        return None
    data = dict(row)
    try:
        data["slides"]  = json.loads(data.get("slides_json")  or "[]")
        data["layouts"] = json.loads(data.get("layouts_json") or "{}")
    except Exception:
        data["slides"]  = []
        data["layouts"] = {}
    return data
