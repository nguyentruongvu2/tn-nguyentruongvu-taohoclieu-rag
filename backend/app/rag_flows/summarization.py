from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from ..prompts.rag_pipeline_system_prompts import RAG_SUMMARY_SYSTEM_PROMPT
from ..prompts.rag_pipeline_user_prompts import build_rag_summary_user_prompt

if TYPE_CHECKING:
    from ..rag_pipeline import RAGPipeline


logger = logging.getLogger(__name__)


def summarize_document(pipeline: "RAGPipeline", text: str, max_chars: int = 7000) -> str:
    raw = (text or "").strip()
    if not raw:
        return ""

    if len(raw) <= max_chars:
        return raw

    if not pipeline.gemini_api_key:
        return raw[:max_chars].rstrip() + "\n\n[Tóm tắt dự phòng do giới hạn độ dài ngữ cảnh.]"

    prompt = f"{RAG_SUMMARY_SYSTEM_PROMPT}\n\n{build_rag_summary_user_prompt()}"
    try:
        summary, _ = pipeline.generate_with_gemini_from_markdown(raw[:24000], prompt)
        clean_summary = (summary or "").strip()
        if clean_summary:
            return clean_summary[:max_chars]
    except Exception as exc:
        logger.warning("Summarization failed, fallback to truncation: %s", exc)

    return raw[:max_chars].rstrip() + "\n\n[Tóm tắt dự phòng do lỗi trong quá trình tóm tắt.]"
