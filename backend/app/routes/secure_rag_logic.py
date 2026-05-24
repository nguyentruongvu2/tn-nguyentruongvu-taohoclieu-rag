from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import unicodedata
import uuid
from pathlib import Path
from typing import Any, Literal

logger = logging.getLogger(__name__)

from fastapi import HTTPException, UploadFile
from fastapi.responses import FileResponse, PlainTextResponse, StreamingResponse

from ..auth_db import (
    append_chat_message,
    create_chat_conversation,
    create_document,
    delete_chat_conversation,
    delete_document,
    estimate_tokens_from_text,
    get_chat_conversation_for_user,
    get_document_for_user,
    list_chat_conversations,
    list_chat_messages,
    list_documents,
    save_generated_content,
    update_document_processing_result,
    upsert_usage,
)
from ..markdown_advanced_divider_cleaner import AdvancedMarkdownCleaner
from ..markdown_cleaner import clean_markdown_advanced
from ..prompts.secure_rag_system_prompts import (
    SECURE_QUALITY_EVAL_SYSTEM_PROMPT,
    SECURE_TEACHING_DOC_SYSTEM_PROMPT,
    SECURE_TOC_SYSTEM_PROMPT,
)
from ..prompts.secure_rag_user_prompts import (
    build_contextual_chat_query,
    build_insufficient_teaching_doc,
    build_quality_eval_user_prompt,
    build_teaching_doc_action_expand_prompt,
    build_teaching_doc_expand_prompt,
)
from ..rag_pipeline import rag_pipeline
from .convert import (
    OCR_UNCLEAR_MESSAGE,
    _extract_from_docx,
    _extract_from_pdf_with_meta,
    _normalize_math_formulas,
    _normalize_paragraph_line_breaks,
    _promote_markdown_headings,
    _repair_math_symbol_glyphs,
    _sanitize_markdown_for_output,
)
from .rag import (
    ChatSource,
    _build_edit_prompt,
    _build_subsection_prompt,
    _enforce_single_subsection_output,
    _sanitize_extracted_content,
    _select_relevant_chunks,
)
from .secure_rag_models import (
    ChatConversationItem,
    SecureChunkPreview,
    TeachingContextChunk,
)

logger = logging.getLogger(__name__)

# Constants
REQUIRED_SECTION_VARIANTS: dict[str, list[str]] = {
    "learning_objectives": ["## Learning Objectives", "## Mục tiêu học tập", "## Muc tieu hoc tap"],
    "main_content": ["## Main Content", "## Nội dung chính", "## Noi dung chinh"],
    "detailed_explanation": ["## Detailed Explanation", "## Giải thích chi tiết", "## Giai thich chi tiet"],
    "examples": ["## Examples", "## Ví dụ", "## Vi du"],
    "summary": ["## Summary", "## Tóm tắt", "## Tom tat"],
    "review_questions": ["## Review Questions", "## Câu hỏi ôn tập", "## Cau hoi on tap"],
}

# ── Text Processing Helpers ──────────────────────────────────────────────────

def _build_sentence_safe_snippet(text: str, max_chars: int = 360) -> str:
    raw = (text or "").strip()
    if len(raw) <= max_chars:
        return raw

    window = raw[: max_chars + 80]
    last_punc = max(window.rfind("."), window.rfind("!"), window.rfind("?"))
    if last_punc >= int(max_chars * 0.6):
        return window[: last_punc + 1].strip()

    last_space = window.rfind(" ")
    if last_space >= int(max_chars * 0.6):
        return window[:last_space].strip()

    return raw[:max_chars].strip()


def _normalize_plain_text(text: str) -> str:
    base = unicodedata.normalize("NFKD", text or "")
    ascii_only = "".join(ch for ch in base if not unicodedata.combining(ch))
    cleaned = re.sub(r"\s+", " ", ascii_only.lower()).strip()
    return cleaned


def _normalize_text_for_citation_match(text: str) -> str:
    normalized = unicodedata.normalize("NFD", text or "")
    normalized = "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")
    normalized = normalized.replace("đ", "d").replace("Đ", "D")
    normalized = re.sub(r"[^a-zA-Z0-9\s]", " ", normalized.lower())
    return re.sub(r"\s+", " ", normalized).strip()


def _tokenize_for_citation_match(text: str) -> set[str]:
    normalized = _normalize_text_for_citation_match(text)
    return {token for token in normalized.split() if len(token) >= 3 and not token.isdigit()}


def _remove_forbidden_phrase_segments(text: str) -> str:
    value = (text or "").strip()
    if not value:
        return ""

    forbidden_patterns = [
        r"phù\s*hợp\s*với\s*ngữ\s*cảnh\s*của\s*tài\s*liệu",
        r"phu\s*hop\s*voi\s*ngu\s*canh\s*cua\s*tai\s*lieu",
    ]
    segments = re.split(r"(?<=[.!?])\s+", value)
    filtered_segments: list[str] = []
    for segment in segments:
        if any(re.search(pattern, segment, flags=re.IGNORECASE) for pattern in forbidden_patterns):
            continue
        filtered_segments.append(segment.strip())

    return re.sub(r"\s+", " ", " ".join(item for item in filtered_segments if item)).strip(" -:;,")

# ── Metadata & Citation Helpers ───────────────────────────────────────────────

def _metadata_source_label(metadata: dict[str, Any]) -> str:
    return str(
        metadata.get("file_name")
        or metadata.get("title")
        or metadata.get("source")
        or metadata.get("source_file")
        or metadata.get("filename")
        or ""
    ).strip()


def _metadata_page_number(metadata: dict[str, Any]) -> int:
    value = metadata.get("start_page", metadata.get("page_number", metadata.get("page", -1)))
    try:
        page = int(value)
        return page if page > 0 else -1
    except (TypeError, ValueError):
        return -1


def _coerce_positive_page(value: Any) -> int | None:
    try:
        page = int(value)
    except (TypeError, ValueError):
        return None
    return page if page > 0 else None


def _format_page_label(start_page: int | None, end_page: int | None) -> str:
    if start_page is None and end_page is None:
        return ""
    if start_page is not None and end_page is not None and start_page != end_page:
        return f"Trang {start_page}–{end_page}"
    page = start_page if start_page is not None else end_page
    return f"Trang {page}" if page is not None else ""


def _clean_citation_structure_value(value: Any, kind: Literal["chapter", "section", "subsection"]) -> str:
    text = str(value or "").strip()
    if not text:
        return ""

    text = re.sub(r"^[+\-*•]+\s*", "", text)
    text = re.sub(r"\s+", " ", text).strip(" -:;,")
    if not text:
        return ""

    if ">" in text:
        candidates = [part.strip() for part in text.split(">") if part.strip()]
        text = candidates[-1] if candidates else ""
    if not text:
        return ""

    if kind == "chapter":
        if re.fullmatch(r"\d+", text):
            return f"Chương {text}"
        if re.match(r"^(chuong|chương|chapter)\s+", text, flags=re.IGNORECASE):
            return text
        if len(text) > 90:
            return ""
        return text

    if re.fullmatch(r"\d+(?:\.\d+){1,4}", text):
        return ""
    if len(text) > 120:
        text = re.split(r"[;|]", text, maxsplit=1)[0].strip()
    return text


def _resolve_page_span_from_metadata(metadata: dict[str, Any]) -> tuple[int | None, int | None]:
    start_page = _coerce_positive_page(metadata.get("start_page", metadata.get("page_start")))
    end_page = _coerce_positive_page(metadata.get("end_page", metadata.get("page_end")))

    if start_page is None and end_page is None:
        fallback = _coerce_positive_page(metadata.get("page_number", metadata.get("page")))
        start_page = fallback
        end_page = fallback

    if start_page is None:
        start_page = end_page
    if end_page is None:
        end_page = start_page
    if start_page is not None and end_page is not None and end_page < start_page:
        start_page, end_page = end_page, start_page
    return start_page, end_page


def _extract_teaching_context_chunk(item: dict[str, Any]) -> TeachingContextChunk:
    metadata = item.get("metadata", {}) if isinstance(item.get("metadata"), dict) else {}
    source = _metadata_source_label(metadata)
    file_name = str(metadata.get("file_name") or source or metadata.get("title") or "").strip()

    chapter = _clean_citation_structure_value(
        metadata.get("chapter_title") or metadata.get("chapter") or metadata.get("h1"),
        "chapter",
    )
    section = _clean_citation_structure_value(
        metadata.get("section_title") or metadata.get("section") or metadata.get("h2"),
        "section",
    )
    subsection = _clean_citation_structure_value(
        metadata.get("subsection_title") or metadata.get("subsection") or metadata.get("h3"),
        "subsection",
    )
    start_page, end_page = _resolve_page_span_from_metadata(metadata)
    page_label = _format_page_label(start_page, end_page)

    score = float(item.get("rerank_score", item.get("hybrid_score", item.get("_score", 0.0))))
    relevance = "Cao" if score >= 0.8 else "Trung bình" if score >= 0.55 else "Thấp"

    full_text = str(item.get("text", "") or "").strip()
    snippet = _remove_forbidden_phrase_segments(_build_sentence_safe_snippet(full_text, max_chars=360))

    return TeachingContextChunk(
        source=source or file_name,
        title=str(metadata.get("title", "") or "").strip(),
        page_number=_metadata_page_number(metadata),
        snippet=snippet,
        full_text=full_text or None,
        clean_content=snippet,
        relevance=relevance,
        file_name=file_name or (source or None),
        chapter=chapter or None,
        section=section or None,
        subsection=subsection or None,
        page=page_label or None,
        start_page=start_page,
        end_page=end_page,
    )


def _refine_teaching_contexts(
    contexts: list[TeachingContextChunk],
    max_items: int,
) -> list[TeachingContextChunk]:
    if not contexts:
        return []

    items = [ctx for ctx in contexts if (ctx.clean_content or ctx.snippet or "").strip()]
    if not items:
        return []

    scored_items = [
        ctx
        for ctx in items
        if str(ctx.relevance or "").strip().lower() in {"cao", "trung bình", "trung binh"}
    ]
    if scored_items:
        items = scored_items

    deduped: list[TeachingContextChunk] = []
    seen: set[str] = set()
    for ctx in items:
        key_payload = " ".join(
            [
                str(ctx.file_name or ctx.source or ""),
                str(ctx.chapter or ""),
                str(ctx.section or ""),
                str(ctx.subsection or ""),
                str(ctx.clean_content or ctx.snippet or "")[:160],
            ]
        )
        key = _normalize_text_for_citation_match(key_payload)
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(ctx)

    def _rank(ctx: TeachingContextChunk) -> tuple[int, int]:
        relevance = str(ctx.relevance or "").strip().lower()
        relevance_score = 2 if relevance == "cao" else 1 if relevance in {"trung bình", "trung binh"} else 0
        snippet_len = len(str(ctx.clean_content or ctx.snippet or ""))
        return relevance_score, snippet_len

    deduped.sort(key=_rank, reverse=True)
    return deduped[: max(1, int(max_items))]

# ── Teaching Document Formatting ─────────────────────────────────────────────

def _strip_existing_teaching_citation_lines(markdown_text: str) -> str:
    text = (markdown_text or "").replace("\r\n", "\n")
    kept_lines: list[str] = []
    for raw_line in text.split("\n"):
        line = raw_line.strip()
        if re.match(r"^📚\s*Nguồn\s*:", line, flags=re.IGNORECASE):
            continue
        if re.match(r"^📌\s*Ví\s*dụ\s*minh\s*họa\s*\(tự\s*sinh\)", line, flags=re.IGNORECASE):
            continue
        kept_lines.append(raw_line.rstrip())

    cleaned = "\n".join(kept_lines)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def _classify_teaching_doc_heading(label: str, level: int) -> str:
    normalized = _normalize_text_for_citation_match(label)

    if "muc tieu hoc tap" in normalized or "learning objectives" in normalized:
        return "learning_objectives"
    if (
        "gioi thieu" in normalized
        or "introduction" in normalized
        or "overview" in normalized
        or "mo dau" in normalized
    ):
        return "introduction"
    if "tom tat" in normalized or "summary" in normalized:
        return "summary"
    if (
        level == 1
        or "tieu de bai hoc" in normalized
        or "ten bai hoc" in normalized
        or "lesson title" in normalized
    ):
        return "title"
    if "vi du" in normalized or "example" in normalized:
        return "examples"
    if (
        "noi dung chinh" in normalized
        or "main content" in normalized
        or "giai thich chi tiet" in normalized
        or "detailed explanation" in normalized
    ):
        return "main_content"
    if "cau hoi on tap" in normalized or "review questions" in normalized:
        return "review_questions"
    return "other"


def _is_heading_unit_start(line: str) -> bool:
    stripped = (line or "").strip()
    if not stripped:
        return False
    if re.match(r"^#{3,6}\s+\S+", stripped):
        return True
    if re.match(r"^\d+(?:\.\d+){1,4}\s*[:.)-]?\s+\S+", stripped):
        return True
    if re.match(r"^(?:Ví\s*dụ|Vi\s*du)\s*\d*\s*[:\-]", stripped, flags=re.IGNORECASE):
        return True
    return False


def _split_body_into_heading_units(body_lines: list[str]) -> list[list[str]]:
    if not body_lines:
        return []

    units: list[list[str]] = []
    current: list[str] = []

    for line in body_lines:
        if _is_heading_unit_start(line) and any(item.strip() for item in current):
            units.append(current)
            current = [line]
            continue
        current.append(line)

    if current:
        units.append(current)
    return units or [body_lines]


def _compact_unit_lines(lines: list[str]) -> list[str]:
    compacted: list[str] = []
    blank_count = 0
    for raw_line in lines:
        line = raw_line.rstrip()
        if not line.strip():
            blank_count += 1
            if blank_count <= 1:
                compacted.append("")
            continue
        blank_count = 0
        compacted.append(line)

    while compacted and not compacted[-1].strip():
        compacted.pop()
    return compacted


def _extract_heading_title_from_line(line: str) -> str | None:
    stripped = (line or "").strip()
    if not stripped:
        return None

    heading_match = re.match(r"^#{1,6}\s+(.+?)\s*$", stripped)
    if heading_match:
        return heading_match.group(1).strip(" -:;,.")

    numbered_match = re.match(r"^\d+(?:\.\d+){1,4}\s*[:.)-]?\s+(.+?)\s*$", stripped)
    if numbered_match:
        return numbered_match.group(1).strip(" -:;,.")

    return None


def _sanitize_teaching_line(line: str) -> str:
    value = (line or "").strip()
    if not value:
        return ""
    if re.match(r"^📚\s*Nguồn\s*:", value, flags=re.IGNORECASE):
        return ""
    if re.match(r"^📌\s*Ví\s*dụ\s*minh\s*họa\s*\(tự\s*sinh\)", value, flags=re.IGNORECASE):
        return ""
    if value.strip() == "---":
        return ""
    if re.search(r"\b(chunk|metadata|retrieval)\b", value, flags=re.IGNORECASE):
        return ""
    return _remove_forbidden_phrase_segments(value)


def _format_main_content_unit(unit_lines: list[str], unit_index: int) -> list[str]:
    sanitized_lines = [_sanitize_teaching_line(raw_line) for raw_line in unit_lines]
    sanitized_lines = [line for line in sanitized_lines if line]

    if not sanitized_lines:
        heading = f"Tiểu mục {unit_index}"
        return [
            f"### {heading}",
            "",
            f"{heading} trình bày ý chính theo ngữ cảnh tài liệu đã truy hồi.",
        ]

    first_idx = next((idx for idx, line in enumerate(sanitized_lines) if line.strip()), 0)
    first_line = sanitized_lines[first_idx]
    heading_title = _extract_heading_title_from_line(first_line)
    body_start = first_idx + 1 if heading_title else first_idx

    if not heading_title:
        heading_title = f"Tiểu mục {unit_index}"

    body_candidates = [line for line in sanitized_lines[body_start:] if line.strip()]

    paragraphs: list[str] = []
    buffer: list[str] = []
    for line in body_candidates:
        if _is_heading_unit_start(line):
            continue
        if not line.strip():
            if buffer:
                paragraphs.append(" ".join(buffer).strip())
                buffer.clear()
            continue
        buffer.append(line.strip())

    if buffer:
        paragraphs.append(" ".join(buffer).strip())

    paragraphs = [re.sub(r"\s+", " ", paragraph).strip() for paragraph in paragraphs if paragraph.strip()]
    paragraphs = paragraphs[:2]

    if not paragraphs:
        paragraphs = [
            f"{heading_title} là ý chính giúp người học nắm bản chất và cách áp dụng trong thực tế.",
        ]

    rendered: list[str] = [f"### {heading_title}", ""]
    rendered.append(paragraphs[0])
    if len(paragraphs) > 1:
        rendered.append("")
        rendered.append(paragraphs[1])
    return rendered


def _resolve_context_page_span(ctx: TeachingContextChunk) -> tuple[int | None, int | None]:
    start_page = _coerce_positive_page(ctx.start_page)
    end_page = _coerce_positive_page(ctx.end_page)

    if start_page is None and end_page is None and (ctx.page or "").strip():
        digits = re.findall(r"\d+", str(ctx.page))
        if len(digits) >= 2:
            start_page = _coerce_positive_page(digits[0])
            end_page = _coerce_positive_page(digits[1])
        elif len(digits) == 1:
            start_page = _coerce_positive_page(digits[0])
            end_page = start_page

    if start_page is None and end_page is None:
        page_number = _coerce_positive_page(ctx.page_number)
        start_page = page_number
        end_page = page_number

    if start_page is None:
        start_page = end_page
    if end_page is None:
        end_page = start_page
    if start_page is not None and end_page is not None and end_page < start_page:
        start_page, end_page = end_page, start_page

    return start_page, end_page


def _context_source_key(ctx: TeachingContextChunk) -> str:
    file_name = _normalize_text_for_citation_match(str(ctx.file_name or ctx.source or ""))
    chapter = _normalize_text_for_citation_match(str(ctx.chapter or ""))
    section = _normalize_text_for_citation_match(str(ctx.section or ""))
    subsection = _normalize_text_for_citation_match(str(ctx.subsection or ""))
    return f"{file_name}||{chapter}||{section}||{subsection}"


def _build_source_entry_tokens(ctx: TeachingContextChunk) -> set[str]:
    payload = " ".join(
        [
            str(ctx.clean_content or ""),
            str(ctx.snippet or ""),
            str(ctx.file_name or ctx.source or ""),
            str(ctx.chapter or ""),
            str(ctx.section or ""),
            str(ctx.subsection or ""),
        ]
    )
    return _tokenize_for_citation_match(payload)


def _format_main_source_line_from_indices(
    source_contexts: list[TeachingContextChunk],
    indices: list[int],
) -> str:
    if not indices:
        return "📚 Nguồn: Tài liệu nguồn"

    first_ctx = source_contexts[indices[0]]
    file_name = (first_ctx.file_name or first_ctx.source or "").strip() or "Tài liệu nguồn"

    structure_parts = [
        str(first_ctx.chapter or "").strip(),
        str(first_ctx.section or "").strip(),
        str(first_ctx.subsection or "").strip(),
    ]
    structure_parts = [part for part in structure_parts if part]

    start_values: list[int] = []
    end_values: list[int] = []
    for idx in indices:
        start_page, end_page = _resolve_context_page_span(source_contexts[idx])
        if start_page is not None:
            start_values.append(start_page)
        if end_page is not None:
            end_values.append(end_page)

    page_label = ""
    if start_values and end_values:
        start_page = min(start_values)
        end_page = max(end_values)
        if end_page < start_page:
            start_page, end_page = end_page, start_page
        page_label = _format_page_label(start_page, end_page)

    base_text = f"📚 Nguồn: {file_name}"
    if structure_parts:
        base_text = f"{base_text} – {', '.join(structure_parts)}"
    return f"{base_text} ({page_label})" if page_label else base_text


def _format_main_source_line(ctx: TeachingContextChunk) -> str:
    return _format_main_source_line_from_indices([ctx], [0])


def _select_main_content_source_indices(
    unit_text: str,
    source_contexts: list[TeachingContextChunk],
    source_tokens: list[set[str]],
    max_sources: int = 3,
) -> list[int]:
    if not source_contexts:
        return []

    unit_tokens = _tokenize_for_citation_match(unit_text)
    ranked: list[tuple[int, int, int]] = []

    for idx, tokens in enumerate(source_tokens):
        overlap = len(unit_tokens & tokens) if unit_tokens else 0
        relevance = str(source_contexts[idx].relevance or "").strip().lower()
        relevance_score = 2 if relevance == "cao" else 1 if relevance in {"trung bình", "trung binh"} else 0
        ranked.append((overlap, relevance_score, idx))

    ranked.sort(key=lambda item: (item[0], item[1], -item[2]), reverse=True)
    if not ranked:
        return []

    best_overlap, _best_relevance, best_idx = ranked[0]
    selected = [best_idx]

    if best_overlap <= 0:
        return selected

    best_key = _context_source_key(source_contexts[best_idx])
    min_overlap = max(1, best_overlap - 1)

    for overlap, _relevance_score, idx in ranked[1:]:
        if len(selected) >= max(1, int(max_sources)):
            break
        if overlap < min_overlap:
            continue
        if _context_source_key(source_contexts[idx]) != best_key:
            continue
        selected.append(idx)

    return selected


def _pick_source_for_unit(
    unit_text: str,
    source_contexts: list[TeachingContextChunk],
    source_tokens: list[set[str]],
    used_indices: set[int],
) -> tuple[int | None, int]:
    if not source_contexts:
        return None, 0

    unit_tokens = _tokenize_for_citation_match(unit_text)
    ranked: list[tuple[int, int, int]] = []

    for idx, tokens in enumerate(source_tokens):
        overlap = len(unit_tokens & tokens) if unit_tokens else 0
        relevance = str(source_contexts[idx].relevance or "").strip().lower()
        relevance_score = 2 if relevance == "cao" else 1 if relevance in {"trung bình", "trung binh"} else 0
        ranked.append((overlap, relevance_score, idx))

    ranked.sort(key=lambda item: (item[0], item[1], -item[2]), reverse=True)

    for overlap, _relevance_score, idx in ranked:
        if idx not in used_indices and (overlap > 0 or not used_indices):
            return idx, overlap

    best_overlap, _best_relevance, best_idx = ranked[0]
    return best_idx, best_overlap


def _normalize_heading_candidate_for_citation(line: str) -> str:
    value = (line or "").strip()
    if not value:
        return ""

    value = re.sub(r"^#{1,6}\s+", "", value).strip()
    value = re.sub(r"^\d+(?:\.\d+){0,4}\s*[:.)-]?\s+", "", value).strip()
    return value


def _is_non_citable_subsection_heading(label: str) -> bool:
    normalized = _normalize_text_for_citation_match(
        _normalize_heading_candidate_for_citation(label)
    )
    if not normalized:
        return False

    non_citable_keywords = [
        "tieu de bai hoc",
        "ten bai hoc",
        "lesson title",
        "muc tieu hoc tap",
        "learning objective",
        "learning objectives",
        "gioi thieu",
        "introduction",
        "overview",
        "mo dau",
        "dan nhap",
        "tom tat",
        "tong ket",
        "summary",
        "ket luan",
    ]

    return any(keyword in normalized for keyword in non_citable_keywords)


def _inject_main_content_citations(
    body_lines: list[str],
    source_contexts: list[TeachingContextChunk],
) -> list[str]:
    units = _split_body_into_heading_units(body_lines)
    if not units:
        return []

    source_tokens = [_build_source_entry_tokens(ctx) for ctx in source_contexts]
    output_lines: list[str] = []

    for unit_index, unit in enumerate(units, start=1):
        formatted_unit = _format_main_content_unit(unit, unit_index)
        output_lines.extend(formatted_unit)

        raw_unit_first_line = next((line for line in unit if (line or "").strip()), "")
        formatted_unit_heading = formatted_unit[0] if formatted_unit else ""
        if _is_non_citable_subsection_heading(raw_unit_first_line) or _is_non_citable_subsection_heading(formatted_unit_heading):
            if output_lines and output_lines[-1].strip():
                output_lines.append("")
            continue

        selected_indices = _select_main_content_source_indices(
            unit_text="\n".join(formatted_unit),
            source_contexts=source_contexts,
            source_tokens=source_tokens,
            max_sources=3,
        )

        if selected_indices:
            citation_line = _format_main_source_line_from_indices(
                source_contexts=source_contexts,
                indices=selected_indices,
            )
        elif source_contexts:
            citation_line = _format_main_source_line(source_contexts[0])
        else:
            citation_line = "📚 Nguồn: Tài liệu nguồn"

        if output_lines and output_lines[-1].strip():
            output_lines.append("")
        output_lines.append(citation_line)
        output_lines.append("")
        output_lines.append("---")
        output_lines.append("")

    while output_lines and not output_lines[-1].strip():
        output_lines.pop()
    return output_lines


def _inject_examples_citations_or_self_tag(
    body_lines: list[str],
    source_contexts: list[TeachingContextChunk],
) -> list[str]:
    units = _split_body_into_heading_units(body_lines)
    if not units:
        return []

    source_tokens = [_build_source_entry_tokens(ctx) for ctx in source_contexts]
    used_indices: set[int] = set()
    output_lines: list[str] = []

    for unit in units:
        compacted = _compact_unit_lines(unit)
        if compacted:
            output_lines.extend(compacted)

        picked_idx, overlap = _pick_source_for_unit(
            unit_text="\n".join(compacted),
            source_contexts=source_contexts,
            source_tokens=source_tokens,
            used_indices=used_indices,
        )

        if picked_idx is not None and overlap >= 2:
            used_indices.add(picked_idx)
            note_line = _format_main_source_line(source_contexts[picked_idx])
        else:
            note_line = "📌 Ví dụ minh họa (tự sinh)"

        if output_lines and output_lines[-1].strip():
            output_lines.append("")
        output_lines.append(note_line)
        output_lines.append("")

    while output_lines and not output_lines[-1].strip():
        output_lines.pop()
    return output_lines


def _apply_teaching_doc_citation_rules(
    markdown_text: str,
    source_contexts: list[TeachingContextChunk],
) -> str:
    cleaned = _strip_existing_teaching_citation_lines(markdown_text)
    if not cleaned.strip():
        return ""

    lines = cleaned.split("\n")
    preamble: list[str] = []
    blocks: list[dict[str, Any]] = []
    current_block: dict[str, Any] | None = None

    for raw_line in lines:
        heading_match = re.match(r"^\s*(#{1,6})\s+(.+?)\s*$", raw_line)
        if heading_match and len(heading_match.group(1)) <= 2:
            if current_block is not None:
                blocks.append(current_block)
            current_block = {
                "heading_line": raw_line.strip(),
                "heading_level": len(heading_match.group(1)),
                "heading_text": heading_match.group(2).strip(),
                "body_lines": [],
            }
            continue

        if current_block is None:
            preamble.append(raw_line.rstrip())
        else:
            current_block["body_lines"].append(raw_line.rstrip())

    if current_block is not None:
        blocks.append(current_block)

    rendered_parts: list[str] = []

    preamble_text = "\n".join(preamble).strip()
    if preamble_text:
        rendered_parts.append(preamble_text)

    for block in blocks:
        heading_line = str(block.get("heading_line") or "").strip()
        heading_level = int(block.get("heading_level") or 2)
        heading_text = str(block.get("heading_text") or "").strip()
        body_lines = list(block.get("body_lines") or [])
        section_kind = _classify_teaching_doc_heading(heading_text, heading_level)

        if section_kind == "main_content":
            processed_body_lines = _inject_main_content_citations(body_lines, source_contexts)
        elif section_kind == "examples":
            processed_body_lines = _inject_examples_citations_or_self_tag(body_lines, source_contexts)
        else:
            processed_body_lines = _compact_unit_lines(body_lines)

        section_text = heading_line
        body_text = "\n".join(processed_body_lines).strip()
        if body_text:
            section_text = f"{section_text}\n{body_text}".strip()

        if section_text:
            rendered_parts.append(section_text)

    final_text = "\n\n".join(part for part in rendered_parts if part).strip()
    sanitized_lines: list[str] = []
    for raw_line in final_text.split("\n"):
        stripped = raw_line.strip()
        if not stripped:
            sanitized_lines.append("")
            continue
        if re.search(r"\b(chunk|metadata|retrieval)\b", stripped, flags=re.IGNORECASE):
            continue
        cleaned_line = _remove_forbidden_phrase_segments(raw_line)
        if cleaned_line:
            sanitized_lines.append(cleaned_line)
            continue
        if re.match(r"^#{1,6}\s+", stripped) or stripped == "---":
            sanitized_lines.append(stripped)

    final_text = "\n".join(sanitized_lines).strip()
    final_text = re.sub(r"\n{3,}", "\n\n", final_text)
    return final_text

# ── Document Processing & Quality Logic ──────────────────────────────────────

def _extract_and_clean_document(
    data: bytes,
    file_ext: str,
) -> tuple[str, str, int, Literal["good", "medium", "bad"], bool]:
    ocr_quality: Literal["good", "medium", "bad"] = "good"
    ocr_used = False

    if file_ext == ".pdf":
        extracted_text, pages, ocr_quality, ocr_used = _extract_from_pdf_with_meta(
            data,
            ocr_mode="auto",
        )
    else:
        extracted_text = _extract_from_docx(data)
        pages = 0

    extracted_text = _repair_math_symbol_glyphs(extracted_text)
    try:
        cleaner = AdvancedMarkdownCleaner()
        markdown_raw, _ = cleaner.clean_markdown_divider_based(extracted_text)
    except Exception:
        markdown_raw, _ = clean_markdown_advanced(extracted_text, debug=False)

    markdown_for_index = _normalize_math_formulas((markdown_raw or "").strip())
    markdown_for_index = _promote_markdown_headings(markdown_for_index)
    markdown_for_index = _normalize_paragraph_line_breaks(markdown_for_index)
    markdown = _sanitize_markdown_for_output(markdown_for_index)
    markdown = _normalize_paragraph_line_breaks(markdown)
    
    if not markdown.strip() and markdown_for_index.strip():
        page_marker_only = bool(
            re.fullmatch(
                r"(?is)\s*#+\s*(?:page|trang)\s*\d+\s*(?:/\s*\d+)?\s*",
                markdown_for_index.strip(),
            )
        )
        if not page_marker_only and len(markdown_for_index.strip()) >= 30:
            markdown = markdown_for_index

    return markdown, markdown_for_index, pages, ocr_quality, ocr_used


def _contains_any_heading(text: str, variants: list[str]) -> bool:
    normalized_targets = [
        _normalize_heading_value(v.replace("#", "").strip())
        for v in variants
        if v.strip()
    ]
    if not normalized_targets:
        return False

    for line in (text or "").splitlines():
        stripped = line.strip()
        if not stripped.startswith("#"):
            continue
        heading_value = _normalize_heading_value(stripped)
        if not heading_value:
            continue
        if any(heading_value.startswith(target) for target in normalized_targets):
            return True
    return False


def _normalize_heading_value(raw_heading: str) -> str:
    heading = re.sub(r"^\s*#{1,6}\s*", "", raw_heading or "")
    heading = re.sub(r"^\s*(?:\d+(?:[\.)]\d+)*)[\.)]?\s+", "", heading)
    heading = re.sub(r"\s+", " ", heading).strip()
    heading = heading.strip("-:,. ")
    return _normalize_plain_text(heading)


def _ensure_required_teaching_sections(markdown_text: str) -> str:
    text = (markdown_text or "").strip()
    if not _contains_any_heading(text, REQUIRED_SECTION_VARIANTS["learning_objectives"]):
        text += "\n\n## Mục tiêu học tập\n- Xác định các mục tiêu học tập cốt lõi dựa trên bằng chứng trong ngữ cảnh đã truy hồi."
    if not _contains_any_heading(text, REQUIRED_SECTION_VARIANTS["main_content"]):
        text += "\n\n## Nội dung chính\n- Trình bày các ý trọng tâm theo trình tự logic và bám sát ngữ cảnh đã truy hồi."
    if not _contains_any_heading(text, REQUIRED_SECTION_VARIANTS["detailed_explanation"]):
        text += "\n\n## Giải thích chi tiết\n- Mở rộng từng ý chính chỉ dựa trên bằng chứng có trong ngữ cảnh."
    if not _contains_any_heading(text, REQUIRED_SECTION_VARIANTS["examples"]):
        text += "\n\n## Ví dụ\n- Bổ sung ví dụ khi có bằng chứng tương ứng trong ngữ cảnh."
    if not _contains_any_heading(text, REQUIRED_SECTION_VARIANTS["summary"]):
        text += "\n\n## Tóm tắt\n- Tổng hợp các điểm chính quan trọng dựa trên bằng chứng đã truy hồi."
    if not _contains_any_heading(text, REQUIRED_SECTION_VARIANTS["review_questions"]):
        text += "\n\n## Câu hỏi ôn tập\n1. Các ý cốt lõi của chủ đề này là gì?\n2. Kiến thức này có thể áp dụng trong những tình huống nào?"
    return text.strip()


def _clamp_score(value: int) -> int:
    return max(1, min(5, int(value)))


def _tokenize_for_grounding(text: str) -> set[str]:
    normalized = _normalize_plain_text(text)
    return {t for t in re.findall(r"[a-z0-9_\-]+", normalized) if len(t) >= 3}


def _split_sentences_for_grounding(markdown_text: str) -> list[str]:
    plain_lines: list[str] = []
    for line in (markdown_text or "").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or stripped.startswith("|"):
            continue
        plain_lines.append(stripped)

    text = "\n".join(plain_lines)
    parts = re.split(r"(?<=[\.!?;:])\s+|\n+", text)
    return [p.strip() for p in parts if p and p.strip()]


def _build_grounding_assessment(content: str, raw_context_chunks: list[dict[str, Any]]) -> dict[str, Any]:
    chunk_entries: list[dict[str, Any]] = []
    context_all_tokens: set[str] = set()

    for item in raw_context_chunks:
        text = str(item.get("text", "") or "").strip()
        if not text:
            continue
        tokens = _tokenize_for_grounding(text)
        if not tokens:
            continue
        chunk_entries.append({"text": text, "tokens": tokens})
        context_all_tokens.update(tokens)

    sentences = _split_sentences_for_grounding(content)
    checked = 0
    unsupported = 0
    evidence: list[str] = []

    for sentence in sentences:
        sent_tokens = _tokenize_for_grounding(sentence)
        if len(sent_tokens) < 8:
            continue
        checked += 1

        best_overlap = 0
        best_chunk_text = ""
        for entry in chunk_entries:
            shared = sent_tokens & entry["tokens"]
            overlap = len(shared)
            if overlap > best_overlap:
                best_overlap = overlap
                best_chunk_text = entry["text"]

        support_ratio = len(sent_tokens & context_all_tokens) / max(1, len(sent_tokens))
        supported = best_overlap >= 4 and support_ratio >= 0.35
        if not supported:
            unsupported += 1
            continue

        if best_chunk_text and len(evidence) < 5:
            excerpt = re.sub(r"\s+", " ", best_chunk_text).strip()[:180]
            evidence.append(excerpt)

    unsupported_ratio = (unsupported / checked) if checked else 1.0
    passed = checked > 0 and unsupported_ratio <= 0.35

    return {
        "pass": passed,
        "checked_sentences": checked,
        "unsupported_sentences": unsupported,
        "unsupported_ratio": round(unsupported_ratio, 3),
        "evidence_quotes": evidence,
    }


def _raise_if_out_of_context(content: str, raw_context_chunks: list[dict[str, Any]]) -> dict[str, Any]:
    grounding = _build_grounding_assessment(content, raw_context_chunks)
    if not grounding["pass"]:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "Noi dung vuot pham vi context. Vui long thu lai voi prompt cu the hon hoac tai lieu lien quan hon.",
                "grounding": grounding,
            },
        )
    return grounding


def _heuristic_quality_scores(topic: str, content: str, context: str) -> dict:
    section_hits = sum(
        1
        for variants in REQUIRED_SECTION_VARIANTS.values()
        if _contains_any_heading(content, variants)
    )

    topic_tokens = set(re.findall(r"[a-zA-Z0-9_\-]+", (topic or "").lower()))
    content_tokens = set(re.findall(r"[a-zA-Z0-9_\-]+", (content or "").lower()))
    overlap = len(topic_tokens & content_tokens)

    relevance = 5 if overlap >= 3 else 4 if overlap >= 1 else 2
    completeness = 5 if section_hits >= 6 else 4 if section_hits >= 4 else 2
    faithfulness = 4 if context.strip() else 2
    clarity = 4 if len(content.splitlines()) >= 10 else 3

    return {
        "relevance": _clamp_score(relevance),
        "faithfulness": _clamp_score(faithfulness),
        "completeness": _clamp_score(completeness),
        "clarity": _clamp_score(clarity),
        "strengths": "Cấu trúc rõ ràng và bám sát mục tiêu tạo tài liệu giảng dạy.",
        "weaknesses": "Chất lượng vẫn phụ thuộc vào độ bao phủ truy hồi và mức đầy đủ của ngữ cảnh.",
        "improvements": "Bổ sung thêm bằng chứng từ tài liệu nguồn để tăng độ chính xác và chiều sâu nội dung.",
    }


async def _evaluate_quality(topic: str, content: str, context: str) -> tuple[dict, bool]:
    if not rag_pipeline.gemini_api_key:
        return _heuristic_quality_scores(topic, content, context), False

    eval_prompt = (
        f"{SECURE_QUALITY_EVAL_SYSTEM_PROMPT}\n\n"
        f"{build_quality_eval_user_prompt(topic, content)}"
    )

    try:
        raw_eval, gemini_real_call = await asyncio.to_thread(
            rag_pipeline.generate_with_gemini_from_markdown,
            markdown=context,
            prompt=eval_prompt,
        )
        parsed = _heuristic_quality_scores(topic, content, context)

        for key, labels in [
            ("relevance", ["Độ liên quan", "Relevance"]),
            ("faithfulness", ["Độ chính xác", "Faithfulness", "Accuracy"]),
            ("completeness", ["Độ đầy đủ", "Completeness"]),
            ("clarity", ["Độ rõ ràng", "Clarity"]),
        ]:
            for label in labels:
                match = re.search(rf"{re.escape(label)}:\s*(\d)\s*/\s*5", raw_eval, flags=re.IGNORECASE)
                if match:
                    parsed[key] = _clamp_score(int(match.group(1)))
                    break

        strengths = re.search(r"(?:Điểm mạnh|Strengths):\s*(.+)", raw_eval, flags=re.IGNORECASE)
        weaknesses = re.search(r"(?:Điểm yếu|Weaknesses):\s*(.+)", raw_eval, flags=re.IGNORECASE)
        improvements = re.search(r"(?:Gợi ý cải thiện|Improvement suggestions):\s*(.+)", raw_eval, flags=re.IGNORECASE)

        if strengths and strengths.group(1).strip():
            parsed["strengths"] = strengths.group(1).strip()
        if weaknesses and weaknesses.group(1).strip():
            parsed["weaknesses"] = weaknesses.group(1).strip()
        if improvements and improvements.group(1).strip():
            parsed["improvements"] = improvements.group(1).strip()

        return parsed, gemini_real_call
    except Exception:
        return _heuristic_quality_scores(topic, content, context), False


def _format_quality_section(evaluation: dict) -> str:
    return (
        "### Đánh giá chất lượng\n\n"
        f"- Độ liên quan: {evaluation.get('relevance', 3)}/5\n"
        f"- Độ chính xác: {evaluation.get('faithfulness', 3)}/5\n"
        f"- Độ đầy đủ: {evaluation.get('completeness', 3)}/5\n"
        f"- Độ rõ ràng: {evaluation.get('clarity', 3)}/5\n\n"
        "### Nhận xét\n\n"
        f"- Điểm mạnh: {evaluation.get('strengths', '')}\n"
        f"- Điểm yếu: {evaluation.get('weaknesses', '')}\n"
        f"- Gợi ý cải thiện: {evaluation.get('improvements', '')}"
    )


async def _build_contextual_chat_query(history: list[dict[str, Any]], question: str) -> str:
    trimmed_question = (question or "").strip()
    if not trimmed_question or not history:
        return trimmed_question

    from ..prompts.rag_pipeline_system_prompts import RAG_QUERY_REWRITE_SYSTEM_PROMPT
    
    recent_turns: list[str] = []
    for item in history[-6:]:
        role = "User" if item.get("role") == "user" else "Assistant"
        content = str(item.get("content") or "").strip()
        if content:
            recent_turns.append(f"{role}: {content[:300]}")

    if not recent_turns:
        return trimmed_question

    chat_history_str = "\n".join(recent_turns)
    prompt = f"{RAG_QUERY_REWRITE_SYSTEM_PROMPT}\n\nChat History:\n{chat_history_str}\n\nLatest Question: {trimmed_question}"
    
    try:
        rewritten, _ = await asyncio.to_thread(
            rag_pipeline._generate_content_with_failover,
            prompt=prompt,
            temperature=0.0,
            max_output_tokens=150
        )
        if rewritten and len(rewritten.strip()) > 5:
            return rewritten.strip()
    except Exception as e:
        logger.error(f"Query rewrite failed: {e}")

    return trimmed_question


def _build_action_instruction(request: Any) -> str:
    action = (request.action or "generate").lower()

    if action == "improve":
        improve_prompt = (request.improve_prompt or "").strip()
        if not improve_prompt:
            raise HTTPException(status_code=422, detail="Please provide an improvement request")

        previous_content = (request.previous_content or "").strip()
        if previous_content:
            return (
                "GOAL: Improve the current teaching content while preserving flow and improving clarity.\n"
                f"ADDITIONAL IMPROVEMENT REQUEST: {improve_prompt}\n"
                "CURRENT CONTENT TO IMPROVE:\n"
                f"{previous_content}"
            )
        return f"GOAL: Produce a stronger teaching-content version.\nADDITIONAL IMPROVEMENT REQUEST: {improve_prompt}"

    if action == "regenerate":
        return "GOAL: Regenerate a new version on the same topic, with different wording and examples while staying grounded in context."

    return "GOAL: Generate the first complete teaching document from the request."


def _build_context_blocks(results: list[dict]) -> str:
    blocks: list[str] = []
    for idx, item in enumerate(results, 1):
        md = item.get("metadata", {}) if isinstance(item.get("metadata"), dict) else {}
        source = _metadata_source_label(md)
        title = str(md.get("title", ""))
        page_number = _metadata_page_number(md)
        text = str(item.get("text", "")).strip()
        if not text:
            continue
            
        source_attr = f' source="{source}"' if source else ""
        title_attr = f' title="{title}"' if title else ""
        page_attr = f' page="{page_number}"' if page_number != -1 else ""
        
        blocks.append(f'<document id="{idx}"{source_attr}{title_attr}{page_attr}>\n{text}\n</document>')
    return "\n\n".join(blocks).strip()


async def execute_secure_chat(
    request: Any,
    current_user: dict,
) -> Any:
    from .secure_rag_models import SecureChatResponse

    conversation_id = (request.conversation_id or "").strip() or None
    candidate_ids = request.document_ids or ([request.document_id] if request.document_id else [])

    if conversation_id:
        conversation = get_chat_conversation_for_user(conversation_id, current_user["id"], current_user["role"])
        if not conversation:
            raise HTTPException(status_code=404, detail="Conversation not found")
    else:
        conversation = create_chat_conversation(current_user["id"], request.question[:80], request.document_id)
        conversation_id = str(conversation.get("id", ""))

    effective_document_ids = candidate_ids or ([str(conversation.get("document_id"))] if conversation.get("document_id") else [])
    if not effective_document_ids:
        docs = list_documents(current_user["id"], current_user["role"])
        if not docs: raise HTTPException(status_code=422, detail="No documents")
        effective_document_ids = [str(docs[0].get("id"))]

    source_filters = []
    for doc_id in effective_document_ids:
        doc_obj = get_document_for_user(doc_id, current_user["id"], current_user["role"])
        if not doc_obj: raise HTTPException(status_code=404, detail=f"Doc {doc_id} not found")
        source_filters.append(str(doc_obj.get("source_tag") or ""))

    history = list_chat_messages(conversation_id, limit=12)
    contextual_query = await _build_contextual_chat_query(history, request.question)

    reranked, cohere_call, _ = await asyncio.to_thread(
        rag_pipeline.retrieve_until_sufficient,
        query=contextual_query,
        retrieval_tasks=[{"source_filter": source_filters, "vector_weight": request.vector_weight, "keyword_weight": request.keyword_weight}],
        final_top_k=request.top_k,
        use_rerank=request.use_rerank
    )

    answer, gemini_call = await asyncio.to_thread(rag_pipeline.answer_with_gemini, contextual_query, reranked)

    sources = []
    for item in reranked:
        md = item.get("metadata", {})
        sources.append(ChatSource(
            chunk_id=str(item.get("id", "")),
            source=_metadata_source_label(md),
            title=str(md.get("title", "")),
            page_number=_metadata_page_number(md),
            snippet=str(item.get("text", ""))[:320],
            score=float(item.get("rerank_score", 0.0))
        ))

    append_chat_message(conversation_id, "user", request.question, {"document_ids": effective_document_ids})
    append_chat_message(conversation_id, "assistant", answer, {"document_ids": effective_document_ids, "sources": [s.model_dump() for s in sources]})

    return SecureChatResponse(
        success=True, answer=answer, sources=sources, conversation_id=conversation_id,
        gemini_real_call=gemini_call, cohere_rerank_real_call=cohere_call,
        llm_model=rag_pipeline.gemini_llm_model, rerank_model=rag_pipeline.cohere_rerank_model
    )


async def execute_secure_chat_stream(
    request: Any,
    current_user: dict,
):
    conversation_id = (request.conversation_id or "").strip() or None
    if conversation_id:
        conversation = get_chat_conversation_for_user(conversation_id, current_user["id"], current_user["role"])
    else:
        conversation = create_chat_conversation(current_user["id"], request.question[:80], request.document_id)
        conversation_id = str(conversation.get("id", ""))

    effective_document_ids = request.document_ids or ([request.document_id] if request.document_id else [])
    source_filters = []
    for doc_id in (effective_document_ids or [str(conversation.get("document_id"))]):
        doc_obj = get_document_for_user(doc_id, current_user["id"], current_user["role"])
        source_filters.append(str(doc_obj.get("source_tag") or ""))

    history = list_chat_messages(conversation_id, limit=12)
    contextual_query = await _build_contextual_chat_query(history, request.question)

    reranked, cohere_call, _ = await asyncio.to_thread(
        rag_pipeline.retrieve_until_sufficient,
        query=contextual_query,
        retrieval_tasks=[{"source_filter": source_filters}],
        final_top_k=request.top_k,
        use_rerank=request.use_rerank
    )

    sources = [ChatSource(chunk_id=str(i.get("id", "")), source=_metadata_source_label(i.get("metadata", {})), title=str(i.get("metadata", {}).get("title", "")), snippet=str(i.get("text", ""))[:320]) for i in reranked]

    chat_history_str = ""
    if history:
        recent_turns = []
        for item in history[-4:]:
            role = "User" if item.get("role") == "user" else "Assistant"
            content = str(item.get("content") or "").strip()
            if content:
                recent_turns.append(f"{role}: {content[:300]}")
        chat_history_str = "\n".join(recent_turns)

    def generate():
        yield f"data: {json.dumps({'type': 'metadata', 'conversation_id': conversation_id, 'sources': [s.model_dump() for s in sources]})}\n\n"
        full_answer = ""
        for chunk in rag_pipeline.answer_with_gemini_stream(request.question, reranked, chat_history=chat_history_str):
            full_answer += chunk
            yield f"data: {json.dumps({'type': 'chunk', 'content': chunk})}\n\n"
        
        append_chat_message(conversation_id, "user", request.question, {"document_ids": effective_document_ids})
        append_chat_message(conversation_id, "assistant", full_answer, {"sources": [s.model_dump() for s in sources]})
        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")
