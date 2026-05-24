"""RAG document, chunk, generated content, and project-document CRUD — PostgreSQL version."""

from __future__ import annotations

import json
import uuid
from typing import Any

from .connection import _connect, _utc_now


# ── Core RAG Documents ────────────────────────────────────────────────────────

def create_document(
    user_id: int,
    original_filename: str,
    stored_file_path: str,
    markdown: str,
    source_tag: str,
    collection_name: str,
    chunks_count: int,
    embeddings_count: int,
    status: str = "ready",
    document_id: str | None = None,
) -> dict[str, Any]:
    doc_id = (str(document_id).strip() if document_id else "") or str(uuid.uuid4())
    now    = _utc_now()
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO documents(
                id, user_id, original_filename, stored_file_path, source_tag,
                collection_name, markdown, chunks_count, embeddings_count,
                status, created_at, updated_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (doc_id, user_id, original_filename, stored_file_path, source_tag,
             collection_name, markdown, chunks_count, embeddings_count, status, now, now),
        )
        conn.commit()
    return get_document_by_id(doc_id)


def get_document_by_id(document_id: str) -> dict[str, Any] | None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM documents WHERE id = %s", (document_id,)
        ).fetchone()
    return dict(row) if row else None


def get_document_for_user(document_id: str, user_id: int, role: str) -> dict[str, Any] | None:
    with _connect() as conn:
        if role == "admin":
            row = conn.execute(
                "SELECT * FROM documents WHERE id = %s", (document_id,)
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT * FROM documents WHERE id = %s AND user_id = %s",
                (document_id, user_id),
            ).fetchone()
    return dict(row) if row else None


def list_documents(user_id: int, role: str) -> list[dict[str, Any]]:
    with _connect() as conn:
        if role == "admin":
            rows = conn.execute(
                "SELECT * FROM documents ORDER BY created_at DESC"
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM documents WHERE user_id = %s ORDER BY created_at DESC",
                (user_id,),
            ).fetchall()
    return [dict(r) for r in rows]


def list_documents_by_user(user_id: int) -> list[dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM documents WHERE user_id = %s ORDER BY created_at DESC", (user_id,)
        ).fetchall()
    return [dict(r) for r in rows]


def delete_document(document_id: str) -> bool:
    with _connect() as conn:
        cur = conn.execute(
            "DELETE FROM documents WHERE id = %s RETURNING id", (document_id,)
        )
        deleted = cur.fetchone() is not None
        conn.commit()
    return deleted


def update_document_processing_result(
    document_id: str,
    markdown: str,
    collection_name: str,
    chunks_count: int,
    embeddings_count: int,
    status: str = "ready",
) -> dict[str, Any] | None:
    with _connect() as conn:
        cur = conn.execute(
            """
            UPDATE documents
            SET markdown = %s, collection_name = %s, chunks_count = %s,
                embeddings_count = %s, status = %s, updated_at = %s
            WHERE id = %s
            RETURNING id
            """,
            (markdown, collection_name, int(chunks_count), int(embeddings_count),
             status, _utc_now(), document_id),
        )
        if not cur.fetchone():
            return None
        conn.commit()
    return get_document_by_id(document_id)


def save_generated_content(
    document_id: str,
    user_id: int,
    section_id: str,
    section_title: str,
    content: str,
) -> None:
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO generated_content(document_id, user_id, section_id, section_title, content, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT(document_id, section_id) DO UPDATE SET
                section_title = EXCLUDED.section_title,
                content       = EXCLUDED.content,
                updated_at    = EXCLUDED.updated_at
            """,
            (document_id, user_id, section_id, section_title, content, _utc_now()),
        )
        conn.commit()


# ── Project Documents & Sections ──────────────────────────────────────────────

def create_project_document(
    project_id: str,
    title: str,
    source_document_ids: list[str],
) -> dict[str, Any]:
    doc_id      = str(uuid.uuid4())
    now         = _utc_now()
    source_json = json.dumps(source_document_ids or [], ensure_ascii=True)
    with _connect() as conn:
        conn.execute(
            "INSERT INTO project_documents(id, project_id, title, source_document_ids_json, created_at, updated_at) VALUES (%s, %s, %s, %s, %s, %s)",
            (doc_id, project_id, title.strip(), source_json, now, now),
        )
        conn.commit()
    row = get_project_document_by_id(doc_id)
    return row if row else {}


def get_project_document_by_id(doc_id: str) -> dict[str, Any] | None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM project_documents WHERE id = %s", (doc_id,)
        ).fetchone()
    if not row:
        return None
    data = dict(row)
    src  = data.get("source_document_ids_json")
    try:
        data["source_document_ids"] = json.loads(src) if isinstance(src, str) else (src or [])
    except Exception:
        data["source_document_ids"] = []
    return data


def list_project_documents(project_id: str) -> list[dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM project_documents WHERE project_id = %s ORDER BY updated_at DESC",
            (project_id,),
        ).fetchall()
    docs = []
    for row in rows:
        data = dict(row)
        src  = data.get("source_document_ids_json")
        try:
            data["source_document_ids"] = json.loads(src) if isinstance(src, str) else (src or [])
        except Exception:
            data["source_document_ids"] = []
        docs.append(data)
    return docs


def get_document_with_sections(doc_id: str, user_id: int, role: str) -> dict[str, Any] | None:
    with _connect() as conn:
        if role == "admin":
            doc_row = conn.execute(
                "SELECT d.* FROM project_documents d WHERE d.id = %s", (doc_id,)
            ).fetchone()
        else:
            doc_row = conn.execute(
                """
                SELECT d.* FROM project_documents d
                JOIN projects p ON p.id = d.project_id
                WHERE d.id = %s AND p.user_id = %s
                """,
                (doc_id, int(user_id)),
            ).fetchone()
        if not doc_row:
            return None
        section_rows = conn.execute(
            "SELECT id, title, content, status, sort_order, updated_at FROM project_sections WHERE document_id = %s ORDER BY sort_order ASC",
            (doc_id,),
        ).fetchall()

    doc = dict(doc_row)
    src = doc.get("source_document_ids_json")
    try:
        doc["source_document_ids"] = json.loads(src) if isinstance(src, str) else (src or [])
    except Exception:
        doc["source_document_ids"] = []
    doc["sections"] = [dict(row) for row in section_rows]
    return doc


def get_document_for_export(doc_id: str, user_id: int, role: str) -> dict[str, Any] | None:
    doc = get_document_with_sections(doc_id, user_id, role)
    if not doc:
        return None
    return {
        "id":       str(doc.get("id")),
        "title":    str(doc.get("title") or "Untitled Document"),
        "sections": list(doc.get("sections", [])),
    }


def set_document_sections(doc_id: str, sections: list[dict[str, str]]) -> list[dict[str, Any]]:
    now = _utc_now()
    with _connect() as conn:
        conn.execute("DELETE FROM project_sections WHERE document_id = %s", (doc_id,))
        for idx, section in enumerate(sections):
            conn.execute(
                "INSERT INTO project_sections(id, document_id, title, content, status, sort_order, updated_at) VALUES (%s, %s, %s, %s, 'empty', %s, %s)",
                (section["section_id"], doc_id, section["title"], "", int(idx), now),
            )
        conn.execute(
            "UPDATE project_documents SET updated_at = %s WHERE id = %s", (now, doc_id)
        )
        conn.commit()
    doc = get_project_document_by_id(doc_id)
    if not doc:
        return []
    loaded = get_document_with_sections(doc_id, user_id=0, role="admin")
    return list(loaded.get("sections", [])) if loaded else []


def update_project_section(
    section_id: str,
    content: str,
    status: str,
    user_id: int,
    role: str,
) -> dict[str, Any] | None:
    safe_status = status if status in {"empty", "generated", "edited"} else "edited"
    now = _utc_now()
    with _connect() as conn:
        if role == "admin":
            sec_row = conn.execute(
                "SELECT s.id, s.document_id FROM project_sections s WHERE s.id = %s", (section_id,)
            ).fetchone()
        else:
            sec_row = conn.execute(
                """
                SELECT s.id, s.document_id FROM project_sections s
                JOIN project_documents d ON d.id = s.document_id
                JOIN projects p ON p.id = d.project_id
                WHERE s.id = %s AND p.user_id = %s
                """,
                (section_id, int(user_id)),
            ).fetchone()
        if not sec_row:
            return None
        doc_id = str(sec_row["document_id"])
        conn.execute(
            "UPDATE project_sections SET content = %s, status = %s, updated_at = %s WHERE id = %s",
            (content, safe_status, now, section_id),
        )
        conn.execute(
            "UPDATE project_documents SET updated_at = %s WHERE id = %s", (now, doc_id)
        )
        updated = conn.execute(
            "SELECT id, title, content, status, sort_order, updated_at FROM project_sections WHERE id = %s",
            (section_id,),
        ).fetchone()
        conn.commit()
    return dict(updated) if updated else None
