"""User-task prompt builders for core RAG pipeline actions."""

from __future__ import annotations


def build_rag_answer_user_prompt(query: str, context_blocks: list[str], chat_history: str = "") -> str:
    prompt = ""
    if chat_history:
        prompt += f"Chat History:\n{chat_history}\n\n"
    prompt += (
        f"Question: {query}\n\n"
        "Output language: Vietnamese (with proper diacritics).\n\n"
        "Context:\n"
        + "\n\n".join(context_blocks)
    )
    return prompt


def build_rag_summary_user_prompt() -> str:
    return "Summarize the input context into structured key points. Output must be Vietnamese with proper diacritics."


def build_rag_outline_user_prompt(topic: str) -> str:
    return f"Generate a lecture outline for this topic. Output headings in Vietnamese with proper diacritics:\n{topic}"
