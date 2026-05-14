"""Project, editor sections, and chat conversation CRUD."""

from __future__ import annotations

import json
import sqlite3
import uuid
from typing import Any

from .connection import _connect, _utc_now


# ── Projects ──────────────────────────────────────────────────────────────────

def create_project(user_id: int, title: str) -> dict[str, Any]:
    project_id = str(uuid.uuid4())
    now        = _utc_now()
    with _connect() as conn:
        conn.execute(
            "INSERT INTO projects(id, user_id, title, created_at) VALUES (?, ?, ?, ?)",
            (project_id, int(user_id), title.strip(), now),
        )
    return get_project_by_id(project_id)


def create_editor_project(
    user_id: int, title: str, description: str,
    knowledge_base_ids: list[str], level: str, doc_format: str,
    teaching_tone: str = "",
) -> dict[str, Any]:
    project_id  = str(uuid.uuid4())
    now         = _utc_now()
    safe_kb_ids = [str(i).strip() for i in (knowledge_base_ids or []) if str(i).strip()]
    kb_json     = json.dumps(safe_kb_ids, ensure_ascii=True)
    safe_tone   = (teaching_tone or "").strip().lower()
    with _connect() as conn:
        conn.execute(
            "INSERT INTO projects(id, user_id, title, description, knowledge_base_ids_json, level, format, teaching_tone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (project_id, int(user_id), title.strip(), (description or "").strip(),
             kb_json, (level or "basic").strip() or "basic",
             (doc_format or "markdown").strip() or "markdown", safe_tone, now, now),
        )
    row = get_project_by_id(project_id)
    if not row:
        return {}
    row["knowledge_base_ids"] = safe_kb_ids
    return row


def list_projects(user_id: int, role: str, limit: int = 100, offset: int = 0) -> list[dict[str, Any]]:
    with _connect() as conn:
        if role == "admin":
            rows = conn.execute(
                "SELECT * FROM projects ORDER BY datetime(created_at) DESC LIMIT ? OFFSET ?",
                (limit, offset),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM projects WHERE user_id = ? ORDER BY datetime(created_at) DESC LIMIT ? OFFSET ?",
                (int(user_id), limit, offset),
            ).fetchall()
    normalized = []
    for row in rows:
        data = dict(row)
        try:
            data["knowledge_base_ids"] = json.loads(data.get("knowledge_base_ids_json") or "[]")
        except Exception:
            data["knowledge_base_ids"] = []
        normalized.append(data)
    return normalized


def list_editor_projects(user_id: int, role: str, limit: int = 100, offset: int = 0) -> list[dict[str, Any]]:
    rows     = list_projects(user_id, role, limit=limit, offset=offset)
    projects = []
    for row in rows:
        project_id = str(row.get("id"))
        sections   = list_editor_sections(project_id)
        projects.append({
            "id":                project_id,
            "project_id":        project_id,
            "title":             str(row.get("title") or ""),
            "description":       str(row.get("description") or ""),
            "knowledge_base_ids": [str(i) for i in list(row.get("knowledge_base_ids") or [])],
            "level":             str(row.get("level") or "basic"),
            "format":            str(row.get("format") or "markdown"),
            "teaching_tone":     str(row.get("teaching_tone") or ""),
            "created_at":        str(row.get("created_at") or ""),
            "updated_at":        str(row.get("updated_at") or row.get("created_at") or ""),
            "sections_count":    len(sections),
        })
    return projects


def get_project_by_id(project_id: str) -> dict[str, Any] | None:
    with _connect() as conn:
        row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    if not row:
        return None
    data = dict(row)
    try:
        data["knowledge_base_ids"] = json.loads(data.get("knowledge_base_ids_json") or "[]")
    except Exception:
        data["knowledge_base_ids"] = []
    return data


def get_project_for_user(project_id: str, user_id: int, role: str) -> dict[str, Any] | None:
    with _connect() as conn:
        if role == "admin":
            row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        else:
            row = conn.execute(
                "SELECT * FROM projects WHERE id = ? AND user_id = ?", (project_id, int(user_id))
            ).fetchone()
    if not row:
        return None
    data = dict(row)
    try:
        data["knowledge_base_ids"] = json.loads(data.get("knowledge_base_ids_json") or "[]")
    except Exception:
        data["knowledge_base_ids"] = []
    return data


def delete_project_for_user(project_id: str, user_id: int, role: str) -> bool:
    with _connect() as conn:
        if role == "admin":
            cur = conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        else:
            cur = conn.execute(
                "DELETE FROM projects WHERE id = ? AND user_id = ?", (project_id, int(user_id))
            )
    return cur.rowcount > 0


def update_editor_project_for_user(
    project_id: str, user_id: int, role: str,
    title: str | None = None, description: str | None = None,
    knowledge_base_ids: list[str] | None = None,
    level: str | None = None, doc_format: str | None = None,
    teaching_tone: str | None = None,
) -> dict[str, Any] | None:
    existing = get_project_for_user(project_id, user_id, role)
    if not existing:
        return None
    now             = _utc_now()
    merged_title    = str(title if title is not None else existing.get("title") or "").strip()
    merged_desc     = str(description if description is not None else existing.get("description") or "").strip()
    merged_level    = str(level if level is not None else existing.get("level") or "basic").strip() or "basic"
    merged_format   = str(doc_format if doc_format is not None else existing.get("format") or "markdown").strip() or "markdown"
    merged_tone     = str(teaching_tone if teaching_tone is not None else existing.get("teaching_tone") or "").strip().lower()
    if knowledge_base_ids is None:
        merged_kb = [str(i).strip() for i in existing.get("knowledge_base_ids", []) if str(i).strip()]
    else:
        merged_kb = [str(i).strip() for i in knowledge_base_ids if str(i).strip()]
    kb_json = json.dumps(merged_kb, ensure_ascii=True)
    with _connect() as conn:
        if role == "admin":
            conn.execute(
                "UPDATE projects SET title=?,description=?,knowledge_base_ids_json=?,level=?,format=?,teaching_tone=?,updated_at=? WHERE id=?",
                (merged_title, merged_desc, kb_json, merged_level, merged_format, merged_tone, now, project_id),
            )
        else:
            conn.execute(
                "UPDATE projects SET title=?,description=?,knowledge_base_ids_json=?,level=?,format=?,teaching_tone=?,updated_at=? WHERE id=? AND user_id=?",
                (merged_title, merged_desc, kb_json, merged_level, merged_format, merged_tone, now, project_id, int(user_id)),
            )
    updated = get_project_for_user(project_id, user_id, role)
    if not updated:
        return None
    updated["knowledge_base_ids"] = merged_kb
    return updated


# ── Editor Sections ───────────────────────────────────────────────────────────

def _normalize_editor_section_record(row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    data = dict(row)
    try:
        parsed = json.loads(data.get("retrieved_chunks_json") or "[]")
        data["retrieved_chunks"] = parsed if isinstance(parsed, list) else []
    except Exception:
        data["retrieved_chunks"] = []
    try:
        raw = data.get("evaluation_json")
        parsed_eval = json.loads(raw) if raw else None
        data["evaluation"] = parsed_eval if isinstance(parsed_eval, dict) else None
    except Exception:
        data["evaluation"] = None
    data.pop("retrieved_chunks_json", None)
    data.pop("evaluation_json", None)
    return data


def create_editor_section(
    project_id: str, title: str, prompt: str, order_index: int | None = None
) -> dict[str, Any]:
    now        = _utc_now()
    section_id = str(uuid.uuid4())
    with _connect() as conn:
        if order_index is None:
            row        = conn.execute("SELECT COALESCE(MAX(order_index), -1) + 1 AS next_order FROM project_editor_sections WHERE project_id = ?", (project_id,)).fetchone()
            safe_order = int(row["next_order"]) if row else 0
        else:
            safe_order = max(0, int(order_index))
            conn.execute("UPDATE project_editor_sections SET order_index = order_index + 1, updated_at = ? WHERE project_id = ? AND order_index >= ?", (now, project_id, safe_order))
        conn.execute(
            "INSERT INTO project_editor_sections(id, project_id, title, content_markdown, prompt, retrieved_chunks_json, evaluation_json, order_index, updated_at) VALUES (?, ?, ?, '', ?, '[]', NULL, ?, ?)",
            (section_id, project_id, title.strip(), (prompt or "").strip(), safe_order, now),
        )
        conn.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (now, project_id))
    return get_editor_section_by_id(section_id) or {}


def delete_editor_section(section_id: str, user_id: int, role: str) -> bool:
    current = get_editor_section_for_user(section_id, user_id, role)
    if not current:
        return False
    project_id    = str(current.get("project_id") or "")
    current_order = int(current.get("order_index") or 0)
    now = _utc_now()
    with _connect() as conn:
        deleted = conn.execute("DELETE FROM project_editor_sections WHERE id = ?", (section_id,))
        if deleted.rowcount <= 0:
            return False
        conn.execute("UPDATE project_editor_sections SET order_index = order_index - 1, updated_at = ? WHERE project_id = ? AND order_index > ?", (now, project_id, current_order))
        conn.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (now, project_id))
    return True


def replace_editor_sections(project_id: str, sections: list[dict[str, Any]]) -> list[dict[str, Any]]:
    now        = _utc_now()
    normalized = [{"title": str(i.get("title") or "").strip(), "prompt": str(i.get("prompt") or "").strip(), "order_index": int(i.get("order_index") or 0)} for i in sections if str(i.get("title") or "").strip()]
    with _connect() as conn:
        conn.execute("DELETE FROM project_editor_sections WHERE project_id = ?", (project_id,))
        for idx, item in enumerate(normalized):
            conn.execute(
                "INSERT INTO project_editor_sections(id, project_id, title, content_markdown, prompt, retrieved_chunks_json, evaluation_json, order_index, updated_at) VALUES (?, ?, ?, '', ?, '[]', NULL, ?, ?)",
                (str(uuid.uuid4()), project_id, item["title"], item["prompt"], int(item.get("order_index", idx)), now),
            )
        conn.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (now, project_id))
    return list_editor_sections(project_id)


def list_editor_sections(project_id: str) -> list[dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT id, project_id, title, content_markdown, prompt, retrieved_chunks_json, evaluation_json, order_index, updated_at FROM project_editor_sections WHERE project_id = ? ORDER BY order_index ASC, datetime(updated_at) DESC",
            (project_id,),
        ).fetchall()
    return [_normalize_editor_section_record(row) for row in rows]


def get_editor_section_by_id(section_id: str) -> dict[str, Any] | None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT id, project_id, title, content_markdown, prompt, retrieved_chunks_json, evaluation_json, order_index, updated_at FROM project_editor_sections WHERE id = ?",
            (section_id,),
        ).fetchone()
    return _normalize_editor_section_record(row) if row else None


def get_editor_section_for_user(section_id: str, user_id: int, role: str) -> dict[str, Any] | None:
    with _connect() as conn:
        if role == "admin":
            row = conn.execute("SELECT s.id, s.project_id, s.title, s.content_markdown, s.prompt, s.retrieved_chunks_json, s.evaluation_json, s.order_index, s.updated_at FROM project_editor_sections s WHERE s.id = ?", (section_id,)).fetchone()
        else:
            row = conn.execute("SELECT s.id, s.project_id, s.title, s.content_markdown, s.prompt, s.retrieved_chunks_json, s.evaluation_json, s.order_index, s.updated_at FROM project_editor_sections s JOIN projects p ON p.id = s.project_id WHERE s.id = ? AND p.user_id = ?", (section_id, int(user_id))).fetchone()
    return _normalize_editor_section_record(row) if row else None


def update_editor_section(
    section_id: str, user_id: int, role: str,
    title: str | None = None, content_markdown: str | None = None,
    prompt: str | None = None, retrieved_chunks: list[dict[str, Any]] | None = None,
    evaluation: dict[str, Any] | None = None, order_index: int | None = None,
) -> dict[str, Any] | None:
    current = get_editor_section_for_user(section_id, user_id, role)
    if not current:
        return None
    now            = _utc_now()
    next_title     = str(title).strip() if title is not None else str(current.get("title") or "")
    next_content   = str(content_markdown) if content_markdown is not None else str(current.get("content_markdown") or "")
    next_prompt    = str(prompt) if prompt is not None else str(current.get("prompt") or "")
    next_chunks    = retrieved_chunks if retrieved_chunks is not None else list(current.get("retrieved_chunks") or [])
    next_eval      = evaluation if evaluation is not None else current.get("evaluation")
    next_order     = int(order_index) if order_index is not None else int(current.get("order_index") or 0)
    with _connect() as conn:
        conn.execute(
            "UPDATE project_editor_sections SET title=?,content_markdown=?,prompt=?,retrieved_chunks_json=?,evaluation_json=?,order_index=?,updated_at=? WHERE id=?",
            (next_title, next_content, next_prompt, json.dumps(next_chunks, ensure_ascii=True),
             json.dumps(next_eval, ensure_ascii=True) if next_eval is not None else None,
             next_order, now, section_id),
        )
        conn.execute("UPDATE projects SET updated_at = ? WHERE id = ?", (now, str(current.get("project_id"))))
    return get_editor_section_by_id(section_id)


def get_editor_project_detail_for_user(project_id: str, user_id: int, role: str) -> dict[str, Any] | None:
    project = get_project_for_user(project_id, user_id, role)
    if not project:
        return None
    sections = list_editor_sections(project_id)
    return {
        "id":                str(project.get("id")),
        "title":             str(project.get("title") or ""),
        "description":       str(project.get("description") or ""),
        "knowledge_base_ids": list(project.get("knowledge_base_ids") or []),
        "level":             str(project.get("level") or "basic"),
        "format":            str(project.get("format") or "markdown"),
        "teaching_tone":     str(project.get("teaching_tone") or ""),
        "created_at":        str(project.get("created_at") or ""),
        "updated_at":        str(project.get("updated_at") or project.get("created_at") or ""),
        "sections":          sections,
    }


# ── Chat Conversations ────────────────────────────────────────────────────────

def create_chat_conversation(
    user_id: int, title: str, document_id: str | None = None, document_ids: list[str] | None = None
) -> dict[str, Any]:
    conversation_id = str(uuid.uuid4())
    now             = _utc_now()
    safe_ids        = [str(i).strip() for i in (document_ids or []) if str(i).strip()]
    if not safe_ids and document_id:
        safe_ids = [str(document_id).strip()]
    ids_json = json.dumps(safe_ids, ensure_ascii=True)

    with _connect() as conn:
        conn.execute(
            "INSERT INTO chat_conversations(id, user_id, title, document_id, document_ids_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (conversation_id, user_id, (title or "Cuoc hoi thoai moi").strip()[:120] or "Cuoc hoi thoai moi", document_id, ids_json, now, now),
        )
    return get_chat_conversation_by_id(conversation_id)


def _normalize_chat_conversation_record(row: sqlite3.Row | dict[str, Any] | None) -> dict[str, Any] | None:
    if not row:
        return None
    data = dict(row)
    try:
        data["document_ids"] = json.loads(data.get("document_ids_json") or "[]")
    except Exception:
        data["document_ids"] = [data["document_id"]] if data.get("document_id") else []
    return data


def get_chat_conversation_by_id(conversation_id: str) -> dict[str, Any] | None:
    with _connect() as conn:
        row = conn.execute("SELECT * FROM chat_conversations WHERE id = ?", (conversation_id,)).fetchone()
    return _normalize_chat_conversation_record(row)


def get_chat_conversation_for_user(conversation_id: str, user_id: int, role: str) -> dict[str, Any] | None:
    with _connect() as conn:
        if role == "admin":
            row = conn.execute("SELECT * FROM chat_conversations WHERE id = ?", (conversation_id,)).fetchone()
        else:
            row = conn.execute("SELECT * FROM chat_conversations WHERE id = ? AND user_id = ?", (conversation_id, user_id)).fetchone()
    return _normalize_chat_conversation_record(row)


def list_chat_conversations(user_id: int, role: str, limit: int = 50) -> list[dict[str, Any]]:
    safe_limit = max(1, min(200, int(limit)))
    last_msg_subquery = "(SELECT m.content FROM chat_messages m WHERE m.conversation_id = c.id ORDER BY datetime(m.created_at) DESC LIMIT 1) AS last_message"
    with _connect() as conn:
        if role == "admin":
            rows = conn.execute(f"SELECT c.*, {last_msg_subquery} FROM chat_conversations c ORDER BY datetime(c.updated_at) DESC LIMIT ?", (safe_limit,)).fetchall()
        else:
            rows = conn.execute(f"SELECT c.*, {last_msg_subquery} FROM chat_conversations c WHERE c.user_id = ? ORDER BY datetime(c.updated_at) DESC LIMIT ?", (user_id, safe_limit)).fetchall()
    return [_normalize_chat_conversation_record(r) for r in rows if r]


def delete_chat_conversation(conversation_id: str) -> bool:
    with _connect() as conn:
        cur = conn.execute("DELETE FROM chat_conversations WHERE id = ?", (conversation_id,))
        return cur.rowcount > 0


def append_chat_message(
    conversation_id: str, role: str, content: str, metadata: dict[str, Any] | None = None
) -> dict[str, Any]:
    from .stats import dumps_json
    now = _utc_now()
    with _connect() as conn:
        cur = conn.execute(
            "INSERT INTO chat_messages(conversation_id, role, content, metadata_json, created_at) VALUES (?, ?, ?, ?, ?)",
            (conversation_id, role, content, dumps_json(metadata or {}), now),
        )
        conn.execute("UPDATE chat_conversations SET updated_at = ? WHERE id = ?", (now, conversation_id))
        message_id = int(cur.lastrowid)
    with _connect() as conn:
        row = conn.execute("SELECT * FROM chat_messages WHERE id = ?", (message_id,)).fetchone()
    if not row:
        return {}
    message = dict(row)
    try:
        message["metadata"] = json.loads(message.get("metadata_json") or "{}")
    except Exception:
        message["metadata"] = {}
    return message


def list_chat_messages(conversation_id: str, limit: int = 40) -> list[dict[str, Any]]:
    safe_limit = max(1, min(200, int(limit)))
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY datetime(created_at) DESC LIMIT ?",
            (conversation_id, safe_limit),
        ).fetchall()
    ordered = [dict(r) for r in reversed(rows)]
    for msg in ordered:
        try:
            msg["metadata"] = json.loads(msg.get("metadata_json") or "{}")
        except Exception:
            msg["metadata"] = {}
    return ordered
