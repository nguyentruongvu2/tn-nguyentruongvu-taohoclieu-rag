from __future__ import annotations

from typing import TYPE_CHECKING

from ..prompts.rag_pipeline_system_prompts import RAG_OUTLINE_SYSTEM_PROMPT
from ..prompts.rag_pipeline_user_prompts import build_rag_outline_user_prompt

if TYPE_CHECKING:
    from ..rag_pipeline import RAGPipeline


def generate_outline(pipeline: "RAGPipeline", topic: str, context: str) -> str:
    safe_topic = (topic or "").strip() or "Chủ đề bài giảng"
    safe_context = (context or "").strip()
    if not safe_context:
        return (
            f"# {safe_topic}\n\n"
            "## Mục tiêu học tập\n"
            "## Nội dung chính\n"
            "## Tóm tắt\n"
            "## Câu hỏi ôn tập"
        )

    prompt = f"{RAG_OUTLINE_SYSTEM_PROMPT}\n\n{build_rag_outline_user_prompt(safe_topic)}"
    outline, _ = pipeline.generate_with_gemini_from_markdown(
        markdown=safe_context,
        prompt=prompt,
    )
    cleaned = (outline or "").strip()
    if cleaned:
        return cleaned

    return (
        f"# {safe_topic}\n\n"
        "## Mục tiêu học tập\n"
        "## Nội dung chính\n"
        "## Tóm tắt\n"
        "## Câu hỏi ôn tập"
    )
