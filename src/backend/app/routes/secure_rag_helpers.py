from __future__ import annotations

import re
import unicodedata
from typing import Any, Literal

from fastapi import HTTPException

from ..markdown_advanced_divider_cleaner import AdvancedMarkdownCleaner
from ..markdown_cleaner import clean_markdown_advanced
from ..prompts.secure_rag_system_prompts import SECURE_QUALITY_EVAL_SYSTEM_PROMPT
from ..prompts.secure_rag_user_prompts import build_contextual_chat_query, build_quality_eval_user_prompt
from ..rag_pipeline import rag_pipeline
from .convert import (
    _extract_from_docx,
    _extract_from_pdf_with_meta,
    _normalize_paragraph_line_breaks,
    _normalize_math_formulas,
    _promote_markdown_headings,
    _repair_math_symbol_glyphs,
    _sanitize_markdown_for_output,
)

REQUIRED_SECTION_VARIANTS: dict[str, list[str]] = {
    "learning_objectives": ["## Learning Objectives", "## Mục tiêu học tập", "## Muc tieu hoc tap"],
    "main_content": ["## Main Content", "## Nội dung chính", "## Noi dung chinh"],
    "detailed_explanation": ["## Detailed Explanation", "## Giải thích chi tiết", "## Giai thich chi tiet"],
    "examples": ["## Examples", "## Ví dụ", "## Vi du"],
    "summary": ["## Summary", "## Tóm tắt", "## Tom tat"],
    "review_questions": ["## Review Questions", "## Câu hỏi ôn tập", "## Cau hoi on tap"],
}


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


def _normalize_plain_text(text: str) -> str:
    base = unicodedata.normalize("NFKD", text or "")
    ascii_only = "".join(ch for ch in base if not unicodedata.combining(ch))
    cleaned = re.sub(r"\s+", " ", ascii_only.lower()).strip()
    return cleaned


def _normalize_heading_value(raw_heading: str) -> str:
    heading = re.sub(r"^\s*#{1,6}\s*", "", raw_heading or "")
    heading = re.sub(r"^\s*(?:\d+(?:[\.)]\d+)*)[\.)]?\s+", "", heading)
    heading = re.sub(r"\s+", " ", heading).strip()
    heading = heading.strip("-:,. ")
    return _normalize_plain_text(heading)


def _build_context_blocks(results: list[dict]) -> str:
    blocks: list[str] = []
    for idx, item in enumerate(results, 1):
        md = item.get("metadata", {}) if isinstance(item.get("metadata"), dict) else {}
        source = str(
            md.get("file_name")
            or md.get("source")
            or md.get("source_file")
            or md.get("filename")
            or ""
        )
        title = str(md.get("title", ""))
        page_number = int(md.get("start_page", md.get("page_number", md.get("page", -1))) or -1)
        text = str(item.get("text", "")).strip()
        if not text:
            continue
            
        source_attr = f' source="{source}"' if source else ""
        title_attr = f' title="{title}"' if title else ""
        page_attr = f' page="{page_number}"' if page_number != -1 else ""
        
        blocks.append(
            f'<document id="{idx}"{source_attr}{title_attr}{page_attr}>\n{text}\n</document>'
        )
    return "\n\n".join(blocks).strip()


def _clamp_score(value: int) -> int:
    return max(1, min(5, int(value)))


def _tokenize_for_grounding(text: str) -> set[str]:
    normalized = _normalize_plain_text(text)
    return {t for t in re.findall(r"[a-z0-9_\-]+", normalized) if len(t) >= 3}


def _split_sentences_for_grounding(markdown_text: str) -> list[str]:
    plain_lines: list[str] = []
    for line in (markdown_text or "").splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("#"):
            continue
        if stripped.startswith("|"):
            continue
        if re.match(r"^\s*[-*+]\s+", stripped):
            plain_lines.append(stripped)
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


def _evaluate_quality(topic: str, content: str, context: str) -> tuple[dict, bool]:
    if not rag_pipeline.gemini_api_key:
        return _heuristic_quality_scores(topic, content, context), False

    eval_prompt = (
        f"{SECURE_QUALITY_EVAL_SYSTEM_PROMPT}\n\n"
        f"{build_quality_eval_user_prompt(topic, content)}"
    )

    try:
        raw_eval, gemini_real_call = rag_pipeline.generate_with_gemini_from_markdown(
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


def _build_contextual_chat_query(history: list[dict[str, Any]], question: str) -> str:
    return build_contextual_chat_query(history, question)


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
            # Keep original cleaned text if sanitization removed structure but content is meaningful.
            markdown = markdown_for_index

    return markdown, markdown_for_index, pages, ocr_quality, ocr_used
