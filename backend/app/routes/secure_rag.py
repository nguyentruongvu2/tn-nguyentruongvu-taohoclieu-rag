"""Secure API surface with JWT auth and per-document ownership checks.

Endpoints required by architecture prompt:
- POST /upload
- GET /documents
- POST /generate (toc | section | edit | teaching_doc)
- POST /chat
- GET /documents/{document_id}/detail
- GET /documents/{document_id}/preview
"""

from __future__ import annotations

import asyncio
import os
import re
import unicodedata
import uuid
from pathlib import Path
from typing import Any, Literal

import json
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
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
from ..prompts.secure_rag_system_prompts import (
    SECURE_TEACHING_DOC_SYSTEM_PROMPT,
    SECURE_TOC_SYSTEM_PROMPT,
)
from ..prompts.secure_rag_user_prompts import (
    build_insufficient_teaching_doc,
    build_teaching_doc_action_expand_prompt,
    build_teaching_doc_expand_prompt,
)
from ..rag_pipeline import rag_pipeline
from ..security import enforce_rate_limit, get_current_user
from .convert import (
    OCR_UNCLEAR_MESSAGE,
)
from .rag import (
    ChatSource,
    _build_edit_prompt,
    _build_subsection_prompt,
    _enforce_single_subsection_output,
    _sanitize_extracted_content,
    _select_relevant_chunks,
)
from .secure_rag_helpers import (
    _build_context_blocks,
    _build_contextual_chat_query,
    _ensure_required_teaching_sections,
    _evaluate_quality,
    _extract_and_clean_document,
    _format_quality_section,
    _heuristic_quality_scores,
    _raise_if_out_of_context,
)
from .secure_rag_models import (
    ChatConversationCreateRequest,
    ChatConversationDeleteResponse,
    ChatConversationItem,
    ChatConversationListResponse,
    ChatConversationResponse,
    ChatMessageItem,
    ChatMessageListResponse,
    GenerateRequest,
    GenerateResponse,
    GenerateTeachingDocRequest,
    GenerateTeachingDocResponse,
    SecureChatRequest,
    SecureChatResponse,
    SecureChunkPreview,
    SecureDeleteResponse,
    SecureDocumentDetailResponse,
    SecureReprocessResponse,
    SecureUploadResponse,
    TeachingContextChunk,
)

router = APIRouter(tags=["secure-rag"])

USER_UPLOAD_ROOT = Path(os.getenv("UPLOAD_DIR", "./uploads")).resolve() / "users"
USER_UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)


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


def _clean_citation_structure_value(value: Any, kind: Literal["chapter", "section", "subsection"]) -> str:
    text = str(value or "").strip()
    if not text:
        return ""

    text = re.sub(r"^[+\-*•]+\s*", "", text)
    text = re.sub(r"\s+", " ", text).strip(" -:;,")
    if not text:
        return ""

    # Avoid exposing raw breadcrumb paths such as "2 > 2.4 > 2.4.1".
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

        processed_body_lines = _compact_unit_lines(body_lines)

        if section_kind == "main_content":
            processed_body_lines = _inject_main_content_citations(body_lines, source_contexts)
        elif section_kind == "examples":
            processed_body_lines = _inject_examples_citations_or_self_tag(body_lines, source_contexts)

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


@router.post("/upload", response_model=SecureUploadResponse)
async def secure_upload(
    file: UploadFile = File(...),
    ocr_mode: str = Query(
        "auto",
        description="Deprecated. OCR mode is always automatic.",
    ),
    current_user: dict = Depends(get_current_user),
) -> SecureUploadResponse:
    enforce_rate_limit(current_user["id"])

    file_ext = os.path.splitext(file.filename or "")[1].lower()
    if file_ext not in {".pdf", ".docx"}:
        raise HTTPException(status_code=400, detail="Secure upload supports PDF or DOCX")

    data = await file.read()
    if len(data) > 100 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (limit 100MB)")

    user_dir = USER_UPLOAD_ROOT / str(current_user["id"])
    user_dir.mkdir(parents=True, exist_ok=True)
    stored_name = f"{uuid.uuid4().hex}{file_ext or '.bin'}"
    stored_path = user_dir / stored_name
    stored_path.write_bytes(data)

    try:
        markdown, markdown_for_index, pages, ocr_quality, ocr_used = await asyncio.wait_for(
            asyncio.to_thread(_extract_and_clean_document, data=data, file_ext=file_ext),
            timeout=600.0,
        )
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="Document extraction timed out. Please try again.")

    if (
        file_ext == ".pdf"
        and ocr_mode in {"auto", "on", "off"}
        and ocr_quality == "bad"
        and not markdown.strip()
    ):
        raise HTTPException(
            status_code=422,
            detail=OCR_UNCLEAR_MESSAGE,
        )

    if not markdown_for_index.strip() or not markdown.strip():
        raise HTTPException(
            status_code=422,
            detail=OCR_UNCLEAR_MESSAGE,
        )

    source_tag = f"u{current_user['id']}-{uuid.uuid4().hex}"
    document_id = str(uuid.uuid4())
    try:
        indexed = await asyncio.wait_for(
            asyncio.to_thread(
                rag_pipeline.index_markdown,
                markdown=markdown_for_index,
                source=source_tag,
                collection_name=None,
                chunk_size=1200,
                chunk_overlap=120,
                total_pages=pages,
                doc_id=document_id,
                file_name=file.filename or "document.pdf",
            ),
            timeout=600.0,
        )
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="Document indexing timed out. Please try again.")

    collection = str(indexed.get("collection", ""))
    chunks = int(indexed.get("chunks_indexed", 0))
    doc = create_document(
        user_id=current_user["id"],
        original_filename=file.filename or "document.pdf",
        stored_file_path=str(stored_path),
        markdown=markdown,
        source_tag=source_tag,
        collection_name=collection,
        chunks_count=chunks,
        embeddings_count=chunks,
        status="ready",
        document_id=document_id,
    )

    return SecureUploadResponse(
        success=True,
        document_id=str(doc["id"]),
        file_name=str(doc["original_filename"]),
        collection=collection,
        chunks_indexed=chunks,
        quality=ocr_quality,
        ocr_used=ocr_used,
        message="Document uploaded and indexed",
    )


@router.post("/documents/{document_id}/reprocess", response_model=SecureReprocessResponse)
async def secure_reprocess_document(
    document_id: str,
    current_user: dict = Depends(get_current_user),
) -> SecureReprocessResponse:
    enforce_rate_limit(current_user["id"])

    doc = get_document_for_user(document_id, current_user["id"], current_user["role"])
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found or access denied")

    stored_file_path = str(doc.get("stored_file_path") or "").strip()
    if not stored_file_path:
        raise HTTPException(status_code=422, detail="Stored file path is missing")

    stored_path = Path(stored_file_path).resolve()
    if not stored_path.exists() or not stored_path.is_file():
        raise HTTPException(status_code=404, detail="Stored file not found")

    file_ext = stored_path.suffix.lower()
    if file_ext not in {".pdf", ".docx"}:
        raise HTTPException(status_code=400, detail="Stored file type is not supported")

    source_tag = str(doc.get("source_tag") or "").strip()
    if not source_tag:
        raise HTTPException(status_code=422, detail="Source tag is missing")

    collection_name = str(doc.get("collection_name") or "").strip() or None
    try:
        chunk_delete_result = await asyncio.wait_for(
            asyncio.to_thread(
                rag_pipeline.delete_chunks_by_source,
                source_tag=source_tag,
                collection_name=collection_name,
            ),
            timeout=60.0,
        )
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="Chunk deletion timed out.")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to delete old chunks: {exc}")

    if not chunk_delete_result.get("success", False):
        remaining = int(chunk_delete_result.get("remaining_count", 0) or 0)
        raise HTTPException(
            status_code=500,
            detail=f"Old chunks were not fully deleted (remaining={remaining})",
        )

    data = stored_path.read_bytes()
    try:
        markdown, markdown_for_index, pages, ocr_quality, ocr_used = await asyncio.wait_for(
            asyncio.to_thread(_extract_and_clean_document, data=data, file_ext=file_ext),
            timeout=600.0,
        )
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="Document extraction timed out.")

    if file_ext == ".pdf" and ocr_quality == "bad" and not markdown.strip():
        raise HTTPException(status_code=422, detail=OCR_UNCLEAR_MESSAGE)

    if not markdown_for_index.strip() or not markdown.strip():
        raise HTTPException(status_code=422, detail=OCR_UNCLEAR_MESSAGE)

    try:
        indexed = await asyncio.wait_for(
            asyncio.to_thread(
                rag_pipeline.index_markdown,
                markdown=markdown_for_index,
                source=source_tag,
                collection_name=collection_name,
                chunk_size=1200,
                chunk_overlap=120,
                total_pages=pages,
                doc_id=document_id,
                file_name=str(doc.get("original_filename") or stored_path.name),
            ),
            timeout=600.0,
        )
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="Document indexing timed out.")

    new_collection = str(indexed.get("collection", ""))
    chunks = int(indexed.get("chunks_indexed", 0))
    updated = update_document_processing_result(
        document_id=document_id,
        markdown=markdown,
        collection_name=new_collection,
        chunks_count=chunks,
        embeddings_count=chunks,
        status="ready",
    )
    if not updated:
        raise HTTPException(status_code=500, detail="Failed to update document metadata")

    return SecureReprocessResponse(
        success=True,
        document_id=document_id,
        file_name=str(updated.get("original_filename") or stored_path.name),
        collection=new_collection,
        chunks_deleted=int(chunk_delete_result.get("deleted_count", 0) or 0),
        chunks_indexed=chunks,
        quality=ocr_quality,
        ocr_used=ocr_used,
        message="Document reprocessed and reindexed",
    )


@router.get("/documents")
async def secure_list_documents(current_user: dict = Depends(get_current_user)):
    enforce_rate_limit(current_user["id"])
    docs = list_documents(current_user["id"], current_user["role"])
    return {"success": True, "documents": docs}


@router.delete("/documents/{document_id}", response_model=SecureDeleteResponse)
async def secure_delete_document(
    document_id: str,
    current_user: dict = Depends(get_current_user),
) -> SecureDeleteResponse:
    enforce_rate_limit(current_user["id"])

    doc = get_document_for_user(document_id, current_user["id"], current_user["role"])
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found or access denied")

    source_tag = str(doc.get("source_tag") or "")
    collection_name = str(doc.get("collection_name") or "") or None
    stored_file_path = str(doc.get("stored_file_path") or "").strip()

    try:
        chunk_delete_result = await asyncio.wait_for(
            asyncio.to_thread(
                rag_pipeline.delete_chunks_by_source,
                source_tag=source_tag,
                collection_name=collection_name,
            ),
            timeout=60.0,
        )
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="Chunk deletion timed out.")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to delete chunks: {exc}")

    if not chunk_delete_result.get("success", False):
        remaining = int(chunk_delete_result.get("remaining_count", 0) or 0)
        raise HTTPException(
            status_code=500,
            detail=f"Chunks were not fully deleted (remaining={remaining})",
        )

    if stored_file_path:
        try:
            file_path = Path(stored_file_path).resolve()
            if file_path.exists() and file_path.is_file():
                file_path.unlink()
        except Exception:
            # Keep delete idempotent for DB/chunks even if file cleanup fails.
            pass

    deleted = delete_document(document_id)
    if not deleted:
        raise HTTPException(status_code=500, detail="Failed to delete document record")

    return SecureDeleteResponse(
        success=True,
        document_id=document_id,
        chunks_deleted=int(chunk_delete_result.get("deleted_count", 0) or 0),
        message="Document and related chunks deleted",
    )


@router.get("/documents/{document_id}/detail", response_model=SecureDocumentDetailResponse)
async def secure_document_detail(
    document_id: str,
    current_user: dict = Depends(get_current_user),
) -> SecureDocumentDetailResponse:
    enforce_rate_limit(current_user["id"])

    doc = get_document_for_user(document_id, current_user["id"], current_user["role"])
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found or access denied")

    source_tag = str(doc.get("source_tag") or "")
    collection_name = str(doc.get("collection_name") or "") or None

    try:
        raw_chunks = await asyncio.wait_for(
            asyncio.to_thread(
                rag_pipeline.get_chunks_by_source,
                source_tag=source_tag,
                collection_name=collection_name,
                limit=80,
            ),
            timeout=30.0,
        )
    except asyncio.TimeoutError:
        raw_chunks = []
    chunks: list[SecureChunkPreview] = []
    for chunk in raw_chunks:
        md = chunk.get("metadata", {}) if isinstance(chunk.get("metadata"), dict) else {}
        full_text = str(chunk.get("text", ""))
        chunks.append(
            SecureChunkPreview(
                chunk_id=str(chunk.get("chunk_id", "")),
                snippet=full_text,
                content=full_text,
                h1=str(md.get("h1", "")) if md.get("h1") else None,
                h2=str(md.get("h2", "")) if md.get("h2") else None,
                h3=str(md.get("h3", "")) if md.get("h3") else None,
                page_number=_metadata_page_number(md),
            )
        )

    safe_document = {
        "id": str(doc.get("id", "")),
        "original_filename": str(doc.get("original_filename", "")),
        "collection_name": str(doc.get("collection_name", "")),
        "chunks_count": int(doc.get("chunks_count", 0) or 0),
        "status": str(doc.get("status", "ready")),
        "created_at": str(doc.get("created_at", "")),
        "updated_at": str(doc.get("updated_at", "")),
    }

    return SecureDocumentDetailResponse(
        success=True,
        document=safe_document,
        markdown=str(doc.get("markdown") or ""),
        chunks=chunks,
    )


@router.get("/documents/{document_id}/preview")
async def secure_document_preview(
    document_id: str,
    current_user: dict = Depends(get_current_user),
):
    enforce_rate_limit(current_user["id"])

    doc = get_document_for_user(document_id, current_user["id"], current_user["role"])
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found or access denied")

    stored_path = Path(str(doc.get("stored_file_path") or "")).resolve()
    if not stored_path.exists() or not stored_path.is_file():
        markdown = str(doc.get("markdown") or "").strip()
        if markdown:
            return PlainTextResponse(
                content=markdown,
                media_type="text/markdown; charset=utf-8",
            )
        raise HTTPException(status_code=404, detail="Stored file not found")

    suffix = stored_path.suffix.lower()
    if suffix == ".pdf":
        media_type = "application/pdf"
    elif suffix == ".docx":
        media_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    else:
        media_type = "application/octet-stream"

    return FileResponse(
        path=str(stored_path),
        media_type=media_type,
        filename=str(doc.get("original_filename") or stored_path.name),
        content_disposition_type="inline",
    )


@router.post("/generate", response_model=GenerateResponse)
async def secure_generate(
    request: GenerateRequest,
    current_user: dict = Depends(get_current_user),
) -> GenerateResponse:
    enforce_rate_limit(current_user["id"])

    doc = get_document_for_user(request.document_id, current_user["id"], current_user["role"])
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found or access denied")

    mode = request.mode.strip().lower()
    markdown = str(doc.get("markdown") or "")
    if not markdown:
        raise HTTPException(status_code=422, detail="Document markdown is empty")

    if mode == "toc":
        default_prompt = SECURE_TOC_SYSTEM_PROMPT
        prompt = request.prompt or default_prompt
        try:
            raw_answer, gemini_real_call = await asyncio.wait_for(
                asyncio.to_thread(
                    rag_pipeline.generate_with_gemini_from_markdown,
                    markdown=markdown,
                    prompt=prompt,
                ),
                timeout=600.0,
            )
        except asyncio.TimeoutError:
            raise HTTPException(status_code=504, detail="LLM generation timed out. Please try again.")
        content = (raw_answer or "").strip()
        upsert_usage(
            current_user["id"],
            request_inc=0,
            llm_calls=1,
            token_usage=estimate_tokens_from_text(markdown, prompt, content),
        )
        return GenerateResponse(
            success=True,
            document_id=request.document_id,
            mode=mode,
            content=content,
            gemini_real_call=gemini_real_call,
            llm_model=rag_pipeline.gemini_llm_model,
        )

    if mode == "teaching_doc":
        topic = (request.topic or request.section_title or "").strip()
        if not topic:
            raise HTTPException(status_code=422, detail="topic is required for teaching_doc mode")

        collection_name = str(doc.get("collection_name") or "") or None
        source_tag = str(doc.get("source_tag") or "") or None

        try:
            retrieved, cohere_real_call, retrieval_info = await asyncio.wait_for(
                asyncio.to_thread(
                    rag_pipeline.retrieve_until_sufficient,
                    query=topic,
                    retrieval_tasks=[
                        {
                            "collection_name": collection_name,
                            "source_filter": source_tag,
                            "vector_weight": 0.65,
                            "keyword_weight": 0.35,
                        }
                    ],
                    top_k_levels=[3, 4, 5, 6, 8, 10],
                    min_unique_chunks=3,
                    min_total_chars=1100,
                    min_unique_sources=1,
                    final_top_k=max(3, min(12, request.top_k)),
                    use_rerank=True,
                ),
                timeout=600.0,
            )
        except asyncio.TimeoutError:
            raise HTTPException(status_code=504, detail="Retrieval timed out. Please try again.")

        context_text = _build_context_blocks(retrieved)
        if not context_text:
            base_doc = build_insufficient_teaching_doc(topic)
            evaluation = {
                "relevance": 2,
                "faithfulness": 5,
                "completeness": 2,
                "clarity": 4,
                "strengths": "Clearly reports missing context and avoids unsupported claims.",
                "weaknesses": "There is no retrieved evidence to generate complete content.",
                "improvements": "Add relevant source material and retry retrieval.",
            }
            final_content = f"{base_doc}\n\n{_format_quality_section(evaluation)}"
            upsert_usage(
                current_user["id"],
                request_inc=0,
                llm_calls=0,
                token_usage=estimate_tokens_from_text(topic, final_content),
            )
            return GenerateResponse(
                success=True,
                document_id=request.document_id,
                mode=mode,
                content=final_content,
                gemini_real_call=False,
                llm_model=rag_pipeline.gemini_llm_model,
                evaluation=evaluation,
            )

        try:
            outline_markdown = await asyncio.wait_for(
                asyncio.to_thread(rag_pipeline.generate_outline, topic, context_text),
                timeout=60.0,
            )
        except asyncio.TimeoutError:
            raise HTTPException(status_code=504, detail="Outline generation timed out.")

        expand_prompt = (
            f"{SECURE_TEACHING_DOC_SYSTEM_PROMPT}\n\n"
            f"{build_teaching_doc_expand_prompt(topic, outline_markdown)}"
        )

        try:
            generated_doc, generation_real_call = await asyncio.wait_for(
                asyncio.to_thread(
                    rag_pipeline.generate_with_gemini_from_markdown,
                    markdown=context_text,
                    prompt=expand_prompt,
                ),
                timeout=600.0,
            )
        except asyncio.TimeoutError:
            raise HTTPException(status_code=504, detail="LLM generation timed out. Please try again.")
        formatted_doc = rag_pipeline.format_output(generated_doc)
        formatted_doc = _ensure_required_teaching_sections(formatted_doc)

        grounding = _raise_if_out_of_context(formatted_doc, retrieved)

        try:
            evaluation, eval_real_call = await asyncio.wait_for(
                asyncio.to_thread(_evaluate_quality, topic, formatted_doc, context_text),
                timeout=60.0,
            )
        except asyncio.TimeoutError:
            evaluation, eval_real_call = _heuristic_quality_scores(topic, formatted_doc, context_text), False
        evaluation["grounding_status"] = "pass"
        evaluation["grounding_unsupported_ratio"] = grounding["unsupported_ratio"]
        evaluation["grounding_evidence_quotes"] = grounding["evidence_quotes"]
        evaluation["retrieval"] = retrieval_info
        final_content = f"{formatted_doc}\n\n{_format_quality_section(evaluation)}"

        upsert_usage(
            current_user["id"],
            request_inc=0,
            llm_calls=1 if (generation_real_call or eval_real_call or cohere_real_call) else 0,
            token_usage=estimate_tokens_from_text(topic, context_text, outline_markdown, final_content),
        )
        return GenerateResponse(
            success=True,
            document_id=request.document_id,
            mode=mode,
            content=final_content,
            gemini_real_call=generation_real_call or eval_real_call,
            llm_model=rag_pipeline.gemini_llm_model,
            evaluation=evaluation,
        )

    if mode == "section":
        if not (request.section_title or "").strip():
            raise HTTPException(status_code=422, detail="section_title is required for section mode")
        if not (request.section_id or "").strip():
            raise HTTPException(status_code=422, detail="section_id is required for section mode")

        section_title = request.section_title.strip()
        selected_chunks, _ = _select_relevant_chunks(
            section_title=section_title,
            all_chunks=markdown,
            top_k=request.top_k,
            prompt=None,
        )
        context = "\n\n".join(selected_chunks).strip() or markdown
        prompt = _build_subsection_prompt(
            subsection=section_title,
            context=context,
            prompt=request.prompt,
            document_id=request.document_id,
            section_id=request.section_id,
            optional_previous_summary=request.optional_previous_summary,
        )
        try:
            raw_answer, gemini_real_call = await asyncio.wait_for(
                asyncio.to_thread(
                    rag_pipeline.generate_with_gemini_from_markdown,
                    markdown=context,
                    prompt=prompt,
                ),
                timeout=600.0,
            )
        except asyncio.TimeoutError:
            raise HTTPException(status_code=504, detail="LLM generation timed out. Please try again.")
        content = _sanitize_extracted_content(raw_answer)
        content = _enforce_single_subsection_output(section_title, content)
        save_generated_content(
            document_id=request.document_id,
            user_id=current_user["id"],
            section_id=request.section_id,
            section_title=section_title,
            content=content,
        )
        upsert_usage(
            current_user["id"],
            request_inc=0,
            llm_calls=1,
            token_usage=estimate_tokens_from_text(context, prompt, content),
        )
        return GenerateResponse(
            success=True,
            document_id=request.document_id,
            mode=mode,
            content=content,
            gemini_real_call=gemini_real_call,
            llm_model=rag_pipeline.gemini_llm_model,
        )

    if mode == "edit":
        if not (request.section_title or "").strip():
            raise HTTPException(status_code=422, detail="section_title is required for edit mode")
        if not (request.section_id or "").strip():
            raise HTTPException(status_code=422, detail="section_id is required for edit mode")
        if not (request.current_content or "").strip():
            raise HTTPException(status_code=422, detail="current_content is required for edit mode")
        if not (request.user_instruction or "").strip():
            raise HTTPException(status_code=422, detail="user_instruction is required for edit mode")

        prompt = _build_edit_prompt(
            section_title=request.section_title.strip(),
            user_instruction=request.user_instruction.strip(),
            prompt=request.prompt,
        )
        try:
            raw_answer, gemini_real_call = await asyncio.wait_for(
                asyncio.to_thread(
                    rag_pipeline.generate_with_gemini_from_markdown,
                    markdown=request.current_content,
                    prompt=prompt,
                ),
                timeout=600.0,
            )
        except asyncio.TimeoutError:
            raise HTTPException(status_code=504, detail="LLM generation timed out. Please try again.")
        content = _sanitize_extracted_content(raw_answer)
        content = _enforce_single_subsection_output(request.section_title.strip(), content)
        save_generated_content(
            document_id=request.document_id,
            user_id=current_user["id"],
            section_id=request.section_id,
            section_title=request.section_title.strip(),
            content=content,
        )
        upsert_usage(
            current_user["id"],
            request_inc=0,
            llm_calls=1,
            token_usage=estimate_tokens_from_text(request.current_content, prompt, content),
        )
        return GenerateResponse(
            success=True,
            document_id=request.document_id,
            mode=mode,
            content=content,
            gemini_real_call=gemini_real_call,
            llm_model=rag_pipeline.gemini_llm_model,
        )

    raise HTTPException(status_code=422, detail="mode must be one of: toc, section, edit, teaching_doc")


# Keep both URLs to avoid breaking older FE builds.
@router.post("/generate/teaching-doc", response_model=GenerateTeachingDocResponse)
@router.post("/secure_rag/generate_teaching_material", response_model=GenerateTeachingDocResponse)
async def secure_generate_teaching_doc(
    request: GenerateTeachingDocRequest,
    current_user: dict = Depends(get_current_user),
) -> GenerateTeachingDocResponse:
    enforce_rate_limit(current_user["id"])

    prompt = (request.prompt or "").strip()
    if not prompt:
        raise HTTPException(status_code=422, detail="prompt is required")

    action = (request.action or "generate").lower()
    if action not in {"generate", "regenerate", "improve"}:
        raise HTTPException(status_code=422, detail="action must be generate, regenerate, or improve")

    action_instruction = _build_action_instruction(request)

    selected_ids = [doc_id.strip() for doc_id in request.document_ids if (doc_id or "").strip()]
    selected_ids = list(dict.fromkeys(selected_ids))
    if not selected_ids:
        raise HTTPException(status_code=422, detail="Vui lòng chọn tài liệu")

    safe_top_k = max(3, min(12, int(request.top_k or 6)))
    citation_contexts: list[TeachingContextChunk] = []
    contexts_for_ui: list[TeachingContextChunk] = []
    retrieval_tasks: list[dict[str, Any]] = []

    for document_id in selected_ids:
        doc = get_document_for_user(document_id, current_user["id"], current_user["role"])
        if not doc:
            raise HTTPException(status_code=404, detail=f"Document {document_id} not found or access denied")

        retrieval_tasks.append(
            {
                "collection_name": str(doc.get("collection_name") or "") or None,
                "source_filter": str(doc.get("source_tag") or "") or None,
                "vector_weight": 0.65,
                "keyword_weight": 0.35,
            }
        )

    try:
        merged, cohere_real_call, retrieval_info = await asyncio.wait_for(
            asyncio.to_thread(
                rag_pipeline.retrieve_until_sufficient,
                query=prompt,
                retrieval_tasks=retrieval_tasks,
                top_k_levels=[3, 4, 5, 6, 8, 10, 12],
                min_unique_chunks=4,
                min_total_chars=1400,
                min_unique_sources=1,
                final_top_k=safe_top_k,
                use_rerank=True,
            ),
            timeout=600.0,
        )
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="Retrieval timed out. Please try again.")

    if not merged:
        raise HTTPException(status_code=422, detail="Không đủ dữ liệu từ tài liệu")

    raw_contexts = [_extract_teaching_context_chunk(item) for item in merged]
    citation_contexts = _refine_teaching_contexts(
        raw_contexts,
        max_items=max(4, min(8, safe_top_k)),
    )
    contexts_for_ui = citation_contexts[:3]

    context_text = _build_context_blocks(merged)
    if not context_text:
        raise HTTPException(status_code=422, detail="Không đủ dữ liệu từ tài liệu")

    try:
        outline_markdown = await asyncio.wait_for(
            asyncio.to_thread(rag_pipeline.generate_outline, prompt, context_text),
            timeout=60.0,
        )
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="Outline generation timed out.")

    requested_format = (request.format or request.output_format or "lecture").strip() or "lecture"

    expand_prompt = (
        f"{SECURE_TEACHING_DOC_SYSTEM_PROMPT}\n\n"
        f"{build_teaching_doc_action_expand_prompt(prompt, action, action_instruction, request.level, requested_format, request.length, outline_markdown)}"
    )

    try:
        generated_doc, generation_real_call = await asyncio.wait_for(
            asyncio.to_thread(
                rag_pipeline.generate_with_gemini_from_markdown,
                markdown=context_text,
                prompt=expand_prompt,
            ),
            timeout=600.0,
        )
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="LLM generation timed out. Please try again.")
    base_doc = rag_pipeline.format_output(generated_doc)
    base_doc = _ensure_required_teaching_sections(base_doc)
    final_content = _apply_teaching_doc_citation_rules(
        base_doc,
        citation_contexts or raw_contexts,
    )

    grounding = _raise_if_out_of_context(base_doc, merged)

    try:
        evaluation, eval_real_call = await asyncio.wait_for(
            asyncio.to_thread(_evaluate_quality, prompt, base_doc, context_text),
            timeout=60.0,
        )
    except asyncio.TimeoutError:
        evaluation, eval_real_call = _heuristic_quality_scores(prompt, base_doc, context_text), False
    evaluation["grounding_status"] = "pass"
    evaluation["grounding_unsupported_ratio"] = grounding["unsupported_ratio"]
    evaluation["grounding_evidence_quotes"] = grounding["evidence_quotes"]
    evaluation["retrieval"] = retrieval_info

    upsert_usage(
        current_user["id"],
        request_inc=0,
        llm_calls=1 if (generation_real_call or eval_real_call or cohere_real_call) else 0,
        token_usage=estimate_tokens_from_text(prompt, context_text, outline_markdown, final_content),
    )

    return GenerateTeachingDocResponse(
        success=True,
        content_markdown=final_content,
        contexts=contexts_for_ui,
        evaluation=evaluation,
        gemini_real_call=generation_real_call or eval_real_call,
        llm_model=rag_pipeline.gemini_llm_model,
    )


@router.get("/chat/conversations", response_model=ChatConversationListResponse)
async def secure_list_chat_conversations(
    current_user: dict = Depends(get_current_user),
) -> ChatConversationListResponse:
    rows = list_chat_conversations(current_user["id"], current_user["role"], limit=100)
    conversations = [
        ChatConversationItem(
            id=str(item.get("id", "")),
            title=str(item.get("title", "Cuoc hoi thoai moi")),
            document_id=str(item.get("document_id")) if item.get("document_id") else None,
            document_ids=item.get("document_ids", []),
            created_at=str(item.get("created_at", "")),
            updated_at=str(item.get("updated_at", "")),
            last_message=str(item.get("last_message")) if item.get("last_message") else None,
        )
        for item in rows
    ]
    return ChatConversationListResponse(success=True, conversations=conversations)


@router.post("/chat/conversations", response_model=ChatConversationResponse)
async def secure_create_chat_conversation(
    request: ChatConversationCreateRequest,
    current_user: dict = Depends(get_current_user),
) -> ChatConversationResponse:
    if request.document_ids:
        for doc_id in request.document_ids:
            doc = get_document_for_user(doc_id, current_user["id"], current_user["role"])
            if not doc:
                raise HTTPException(status_code=404, detail=f"Document {doc_id} not found or access denied")
    elif request.document_id:
        doc = get_document_for_user(request.document_id, current_user["id"], current_user["role"])
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found or access denied")

    raw_title = (request.title or "").strip()
    title = raw_title[:120] if raw_title else "Cuoc hoi thoai moi"
    conversation = create_chat_conversation(
        user_id=current_user["id"],
        title=title,
        document_id=request.document_id,
        document_ids=request.document_ids,
    )

    return ChatConversationResponse(
        success=True,
        conversation=ChatConversationItem(
            id=str(conversation.get("id", "")),
            title=str(conversation.get("title", "Cuoc hoi thoai moi")),
            document_id=str(conversation.get("document_id")) if conversation.get("document_id") else None,
            document_ids=conversation.get("document_ids", []),
            created_at=str(conversation.get("created_at", "")),
            updated_at=str(conversation.get("updated_at", "")),
            last_message=None,
        ),
    )


@router.get("/chat/conversations/{conversation_id}/messages", response_model=ChatMessageListResponse)
async def secure_get_chat_messages(
    conversation_id: str,
    current_user: dict = Depends(get_current_user),
) -> ChatMessageListResponse:
    conversation = get_chat_conversation_for_user(conversation_id, current_user["id"], current_user["role"])
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found or access denied")

    rows = list_chat_messages(conversation_id, limit=100)
    messages = [
        ChatMessageItem(
            id=int(item.get("id", 0)),
            role=str(item.get("role", "assistant")),
            content=str(item.get("content", "")),
            metadata=item.get("metadata"),
            created_at=str(item.get("created_at", "")),
        )
        for item in rows
    ]
    return ChatMessageListResponse(success=True, conversation_id=conversation_id, messages=messages)


@router.delete("/chat/conversations/{conversation_id}", response_model=ChatConversationDeleteResponse)
async def secure_delete_chat_conversation(
    conversation_id: str,
    current_user: dict = Depends(get_current_user),
) -> ChatConversationDeleteResponse:
    conversation = get_chat_conversation_for_user(conversation_id, current_user["id"], current_user["role"])
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found or access denied")

    deleted = delete_chat_conversation(conversation_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Conversation not found")

    return ChatConversationDeleteResponse(
        success=True,
        conversation_id=conversation_id,
        message="Da xoa cuoc hoi thoai",
    )


@router.post("/chat", response_model=SecureChatResponse)
async def secure_chat(
    request: SecureChatRequest,
    current_user: dict = Depends(get_current_user),
) -> SecureChatResponse:
    enforce_rate_limit(current_user["id"])

    if not request.question.strip():
        raise HTTPException(status_code=422, detail="question is required")

    conversation_id = (request.conversation_id or "").strip() or None
    conversation: dict[str, Any] | None = None

    candidate_ids: list[str] = []
    if request.document_ids:
        candidate_ids = [d.strip() for d in request.document_ids if d.strip()]
    elif request.document_id:
        candidate_ids = [request.document_id.strip()]

    if candidate_ids:
        for doc_id in candidate_ids:
            try:
                doc_check = get_document_for_user(doc_id, current_user["id"], current_user["role"])
            except Exception:
                doc_check = None
            if not doc_check:
                raise HTTPException(
                    status_code=404,
                    detail=f"Document {doc_id} not found or access denied",
                )

    if conversation_id:
        conversation = get_chat_conversation_for_user(conversation_id, current_user["id"], current_user["role"])
        if not conversation:
            raise HTTPException(status_code=404, detail="Conversation not found or access denied")
    else:
        auto_title = request.question.strip()[:80]
        conversation = create_chat_conversation(
            user_id=current_user["id"],
            title=auto_title or "Cuoc hoi thoai moi",
            document_id=(request.document_id or None),
        )
        conversation_id = str(conversation.get("id", ""))

    effective_document_ids: list[str] = []
    if candidate_ids:
        effective_document_ids = candidate_ids
    elif conversation.get("document_id"):
        effective_document_ids = [str(conversation.get("document_id"))]

    if not effective_document_ids:
        docs = list_documents(current_user["id"], current_user["role"])
        if not docs:
            raise HTTPException(status_code=422, detail="Ban chua co tai lieu nao de chat")
        effective_document_ids = [str(docs[0].get("id") or "")]

    source_filters: list[str] = []
    for doc_id in effective_document_ids:
        try:
            doc_obj = get_document_for_user(doc_id, current_user["id"], current_user["role"])
        except Exception:
            doc_obj = None
        if not doc_obj:
            raise HTTPException(status_code=404, detail=f"Document {doc_id} not found or access denied")
        source_filters.append(str(doc_obj.get("source_tag") or ""))

    history = list_chat_messages(conversation_id, limit=12) if conversation_id else []
    contextual_query = _build_contextual_chat_query(history, request.question)

    retrieval_tasks = [
        {
            "source_filter": source_filters,
            "vector_weight": request.vector_weight,
            "keyword_weight": request.keyword_weight,
        }
    ]
    try:
        reranked, cohere_real_call, _ = await asyncio.wait_for(
            asyncio.to_thread(
                rag_pipeline.retrieve_until_sufficient,
                query=contextual_query,
                retrieval_tasks=retrieval_tasks,
                top_k_levels=[request.top_k, request.top_k + 4],
                min_unique_chunks=max(3, request.top_k // 2),
                min_total_chars=1200,
                min_unique_sources=1,
                final_top_k=request.top_k,
                use_rerank=request.use_rerank,
            ),
            timeout=600.0,
        )
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="Retrieval timed out. Please try again.")
    try:
        answer, gemini_real_call = await asyncio.wait_for(
            asyncio.to_thread(rag_pipeline.answer_with_gemini, contextual_query, reranked),
            timeout=600.0,
        )
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="LLM answer timed out. Please try again.")

    sources: list[ChatSource] = []
    for item in reranked:
        md = item.get("metadata", {})
        sources.append(
            ChatSource(
                chunk_id=str(item.get("id", "")),
                source=_metadata_source_label(md),
                title=str(md.get("title", "")),
                page_number=_metadata_page_number(md),
                h1=str(md.get("h1", "")) if md.get("h1") else None,
                h2=str(md.get("h2", "")) if md.get("h2") else None,
                h3=str(md.get("h3", "")) if md.get("h3") else None,
                score=float(item.get("rerank_score", item.get("hybrid_score", 0.0))),
                snippet=str(item.get("text", ""))[:320],
            )
        )

    token_usage = estimate_tokens_from_text(request.question, answer)
    upsert_usage(current_user["id"], request_inc=0, llm_calls=1, token_usage=token_usage)

    if conversation_id:
        append_chat_message(
            conversation_id=conversation_id,
            role="user",
            content=request.question.strip(),
            metadata={"document_ids": effective_document_ids},
        )
        append_chat_message(
            conversation_id=conversation_id,
            role="assistant",
            content=answer,
            metadata={
                "document_ids": effective_document_ids,
                "sources": [
                    {
                        "title": s.title,
                        "source": s.source,
                        "page_number": s.page_number,
                        "snippet": s.snippet
                    } for s in sources
                ],
                "source_chunk_ids": [str(item.get("id", "")) for item in reranked],
            },
        )

    return SecureChatResponse(
        success=True,
        answer=answer,
        sources=sources,
        conversation_id=conversation_id,
        gemini_real_call=gemini_real_call,
        cohere_rerank_real_call=cohere_real_call,
        llm_model=rag_pipeline.gemini_llm_model,
        rerank_model=rag_pipeline.cohere_rerank_model,
    )


@router.post("/chat/stream")
async def secure_chat_stream(
    request: SecureChatRequest,
    current_user: dict = Depends(get_current_user),
):
    if not request.question.strip():
        raise HTTPException(status_code=422, detail="question is required")

    conversation_id = (request.conversation_id or "").strip() or None
    conversation: dict[str, Any] | None = None

    if conversation_id:
        conversation = get_chat_conversation_for_user(conversation_id, current_user["id"], current_user["role"])
        if not conversation:
            raise HTTPException(status_code=404, detail="Conversation not found or access denied")
    else:
        auto_title = request.question.strip()[:80]
        conversation = create_chat_conversation(
            user_id=current_user["id"],
            title=auto_title or "Cuoc hoi thoai moi",
            document_id=(request.document_id or None),
        )
        conversation_id = str(conversation.get("id", ""))

    effective_document_ids: list[str] = []
    if request.document_ids:
        effective_document_ids = [d.strip() for d in request.document_ids if d.strip()]
    elif request.document_id:
        effective_document_ids = [request.document_id.strip()]
    elif conversation.get("document_id"):
        effective_document_ids = [str(conversation.get("document_id"))]

    if not effective_document_ids:
        docs = list_documents(current_user["id"], current_user["role"])
        if not docs:
            raise HTTPException(status_code=422, detail="Ban chua co tai lieu nao de chat")
        effective_document_ids = [str(docs[0].get("id") or "")]

    source_filters: list[str] = []
    for doc_id in effective_document_ids:
        doc_obj = get_document_for_user(doc_id, current_user["id"], current_user["role"])
        if not doc_obj:
            raise HTTPException(status_code=404, detail=f"Document {doc_id} not found or access denied")
        source_filters.append(str(doc_obj.get("source_tag") or ""))

    history = list_chat_messages(conversation_id, limit=12) if conversation_id else []
    contextual_query = _build_contextual_chat_query(history, request.question)

    retrieval_tasks = [
        {
            "source_filter": source_filters,
            "vector_weight": request.vector_weight,
            "keyword_weight": request.keyword_weight,
        }
    ]
    try:
        reranked, cohere_real_call, _ = await asyncio.wait_for(
            asyncio.to_thread(
                rag_pipeline.retrieve_until_sufficient,
                query=contextual_query,
                retrieval_tasks=retrieval_tasks,
                top_k_levels=[request.top_k, request.top_k + 4],
                min_unique_chunks=max(3, request.top_k // 2),
                min_total_chars=1200,
                min_unique_sources=1,
                final_top_k=request.top_k,
                use_rerank=request.use_rerank,
            ),
            timeout=600.0,
        )
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="Retrieval timed out. Please try again.")

    sources: list[ChatSource] = []
    for item in reranked:
        md = item.get("metadata", {})
        sources.append(
            ChatSource(
                chunk_id=str(item.get("id", "")),
                source=_metadata_source_label(md),
                title=str(md.get("title", "")),
                page_number=_metadata_page_number(md),
                h1=str(md.get("h1", "")) if md.get("h1") else None,
                h2=str(md.get("h2", "")) if md.get("h2") else None,
                h3=str(md.get("h3", "")) if md.get("h3") else None,
                score=float(item.get("rerank_score", item.get("hybrid_score", 0.0))),
                snippet=str(item.get("text", ""))[:320],
            )
        )

    def generate():
        metadata_chunk = {
            "type": "metadata",
            "conversation_id": conversation_id,
            "sources": [s.model_dump() for s in sources],
        }
        yield f"data: {json.dumps(metadata_chunk)}\n\n"

        full_answer = ""
        for chunk in rag_pipeline.answer_with_gemini_stream(contextual_query, reranked):
            full_answer += chunk
            chunk_data = {"type": "chunk", "content": chunk}
            yield f"data: {json.dumps(chunk_data)}\n\n"

        token_usage = estimate_tokens_from_text(request.question, full_answer)
        upsert_usage(current_user["id"], request_inc=0, llm_calls=1, token_usage=token_usage)

        if conversation_id:
            append_chat_message(
                conversation_id=conversation_id,
                role="user",
                content=request.question.strip(),
                metadata={"document_ids": effective_document_ids},
            )
            append_chat_message(
                conversation_id=conversation_id,
                role="assistant",
                content=full_answer,
                metadata={
                    "document_ids": effective_document_ids,
                    "sources": [
                        {
                            "title": s.title,
                            "source": s.source,
                            "page_number": s.page_number,
                            "snippet": s.snippet
                        } for s in sources
                    ],
                    "source_chunk_ids": [str(item.get("id", "")) for item in reranked],
                },
            )

        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")

def _build_action_instruction(request: GenerateTeachingDocRequest) -> str:
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
        return (
            "GOAL: Produce a stronger teaching-content version.\n"
            f"ADDITIONAL IMPROVEMENT REQUEST: {improve_prompt}"
        )

    if action == "regenerate":
        return (
            "GOAL: Regenerate a new version on the same topic, "
            "with different wording and examples while staying grounded in context."
        )

    return "GOAL: Generate the first complete teaching document from the request."