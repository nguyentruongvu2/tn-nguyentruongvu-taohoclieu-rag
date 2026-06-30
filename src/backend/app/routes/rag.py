"""Shared RAG route helpers used by secure endpoints.

This module contains lightweight prompt builders and text post-processing helpers
that were previously used by the legacy `/rag` route.
"""

from __future__ import annotations

import re
from typing import Optional

from pydantic import BaseModel

from ..prompts.rag_route_system_prompts import (
    RAG_EDIT_SYSTEM_PROMPT,
    RAG_SUBSECTION_SYSTEM_PROMPT,
)
from ..prompts.rag_route_user_prompts import (
    build_edit_user_prompt,
    build_subsection_user_prompt,
)


class ChatSource(BaseModel):
    chunk_id: str
    source: str
    title: str
    page_number: int = -1
    h1: str | None = None
    h2: str | None = None
    h3: str | None = None
    score: float = 0.0
    snippet: str = ""


def _sanitize_extracted_content(text: str) -> str:
    content = (text or "").strip()
    content = re.sub(r"^```(?:markdown|md)?\\s*", "", content, flags=re.IGNORECASE)
    content = re.sub(r"\\s*```$", "", content)
    return content.strip()


def _enforce_single_subsection_output(section_title: str, content: str) -> str:
    safe_title = (section_title or "").strip()
    body = _sanitize_extracted_content(content)
    if not safe_title:
        return body

    # If model output does not start with a heading, normalize it into one subsection.
    if not body.startswith("#"):
        return f"## {safe_title}\\n\\n{body}".strip()

    lines = body.splitlines()
    if not lines:
        return f"## {safe_title}"

    first = lines[0].strip()
    if not re.match(r"^#{1,6}\\s+", first):
        return f"## {safe_title}\\n\\n{body}".strip()

    # Replace first heading with requested title to avoid heading drift.
    lines[0] = re.sub(r"^#{1,6}\\s+.*$", f"## {safe_title}", first)
    return "\\n".join(lines).strip()


def _build_subsection_prompt(
    subsection: str,
    context: str,
    prompt: Optional[str],
    document_id: str,
    section_id: str,
    optional_previous_summary: Optional[str],
) -> str:
    user_prompt = build_subsection_user_prompt(
        subsection=subsection,
        context=context,
        user_prompt=prompt,
        document_id=document_id,
        section_id=section_id,
        optional_previous_summary=optional_previous_summary,
    )
    return f"{RAG_SUBSECTION_SYSTEM_PROMPT}\n\n{user_prompt}"


def _build_edit_prompt(section_title: str, user_instruction: str, prompt: Optional[str]) -> str:
    user_prompt = build_edit_user_prompt(
        section_title=section_title,
        user_instruction=user_instruction,
        extra_prompt=prompt,
    )
    return f"{RAG_EDIT_SYSTEM_PROMPT}\n\n{user_prompt}"


def _score_chunk(section_title: str, chunk: str) -> int:
    if not chunk:
        return 0
    tokens = {t for t in re.split(r"\\W+", section_title.lower()) if len(t) > 2}
    text = chunk.lower()
    return sum(1 for t in tokens if t in text)


def _select_relevant_chunks(
    section_title: str,
    all_chunks: str,
    top_k: int,
    prompt: Optional[str] = None,
):
    chunks = [c.strip() for c in re.split(r"\\n\\s*\\n", all_chunks or "") if c.strip()]
    if not chunks:
        return [], []

    scored = []
    for c in chunks:
        score = _score_chunk(section_title, c)
        if prompt:
            score += _score_chunk(prompt, c)
        scored.append((score, c))

    scored.sort(key=lambda x: x[0], reverse=True)
    k = max(1, min(int(top_k or 5), len(scored)))
    selected = [c for _, c in scored[:k]]
    return selected, scored
