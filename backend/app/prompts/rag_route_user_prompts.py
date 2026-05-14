"""User-task prompt builders for shared RAG route helpers."""

from __future__ import annotations


def build_subsection_user_prompt(
    subsection: str,
    context: str,
    user_prompt: str | None,
    document_id: str,
    section_id: str,
    optional_previous_summary: str | None,
) -> str:
    extra = (user_prompt or "").strip()
    summary = (optional_previous_summary or "").strip()
    return (
        f"Document ID: {document_id}\n"
        f"Section ID: {section_id}\n"
        f"Target subsection: {subsection}\n\n"
        + (f"Previous summary:\n{summary}\n\n" if summary else "")
        + (f"Additional user instruction:\n{extra}\n\n" if extra else "")
        + f"CONTEXT:\n{context}"
    )


def build_edit_user_prompt(section_title: str, user_instruction: str, extra_prompt: str | None) -> str:
    extra = (extra_prompt or "").strip()
    return (
        f"Section to edit: {section_title}\n"
        f"User request: {user_instruction}\n\n"
        + (f"Additional instruction:\n{extra}\n" if extra else "")
    )
