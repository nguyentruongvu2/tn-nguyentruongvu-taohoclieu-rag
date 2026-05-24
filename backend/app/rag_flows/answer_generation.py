from __future__ import annotations

from typing import Dict, List, Tuple, TYPE_CHECKING

from ..prompts.rag_pipeline_system_prompts import RAG_ANSWER_SYSTEM_PROMPT
from ..prompts.rag_pipeline_user_prompts import build_rag_answer_user_prompt

if TYPE_CHECKING:
    from ..rag_pipeline import RAGPipeline


def answer_with_gemini(
    pipeline: "RAGPipeline",
    query: str,
    contexts: List[Dict[str, object]],
) -> Tuple[str, bool]:
    if not pipeline.gemini_api_key:
        fallback = []
        for idx, item in enumerate(contexts[:3], 1):
            md = item.get("metadata", {})
            source = md.get("file_name") or md.get("source", "")
            page = md.get("start_page", md.get("page_number", -1))
            snippet = str(item.get("text", ""))[:220]
            fallback.append(f"[Source {idx}] {source} (page {page}): {snippet}")
        return (
            "The system is running in fallback mode because GEMINI_API_KEY is missing. "
            "Most relevant snippets are listed below:\n\n"
            + "\n\n".join(fallback)
        ), False

    context_blocks = []
    for idx, item in enumerate(contexts, 1):
        md = item.get("metadata", {})
        title = md.get("title") or md.get("file_name", "")
        page_number = md.get("start_page", md.get("page_number", -1))
        source = md.get("file_name") or md.get("source", "")
        
        source_attr = f' source="{source}"' if source else ""
        title_attr = f' title="{title}"' if title else ""
        page_attr = f' page="{page_number}"' if page_number != -1 else ""
        
        text = str(item.get("text", "")).strip()
        context_blocks.append(f'<document id="{idx}"{source_attr}{title_attr}{page_attr}>\n{text}\n</document>')

    prompt = f"{RAG_ANSWER_SYSTEM_PROMPT}\n\n{build_rag_answer_user_prompt(query, context_blocks)}"
    return pipeline._generate_content_with_failover(prompt)


def answer_with_gemini_stream(
    pipeline: "RAGPipeline",
    query: str,
    contexts: List[Dict[str, object]],
    chat_history: str = "",
):
    if not pipeline.gemini_api_key:
        fallback = []
        for idx, item in enumerate(contexts[:3], 1):
            md = item.get("metadata", {})
            source = md.get("file_name") or md.get("source", "")
            page = md.get("start_page", md.get("page_number", -1))
            snippet = str(item.get("text", ""))[:220]
            fallback.append(f"[Source {idx}] {source} (page {page}): {snippet}")
        yield "The system is running in fallback mode because GEMINI_API_KEY is missing. Most relevant snippets are listed below:\n\n" + "\n\n".join(fallback)
        return

    context_blocks = []
    for idx, item in enumerate(contexts, 1):
        md = item.get("metadata", {})
        title = md.get("title") or md.get("file_name", "")
        page_number = md.get("start_page", md.get("page_number", -1))
        source = md.get("file_name") or md.get("source", "")
        
        source_attr = f' source="{source}"' if source else ""
        title_attr = f' title="{title}"' if title else ""
        page_attr = f' page="{page_number}"' if page_number != -1 else ""
        
        text = str(item.get("text", "")).strip()
        context_blocks.append(f'<document id="{idx}"{source_attr}{title_attr}{page_attr}>\n{text}\n</document>')

    prompt = f"{RAG_ANSWER_SYSTEM_PROMPT}\n\n{build_rag_answer_user_prompt(query, context_blocks, chat_history)}"
    for chunk in pipeline._stream_content_with_failover(prompt):
        yield chunk
