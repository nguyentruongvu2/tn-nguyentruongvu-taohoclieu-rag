"""User-task prompts for secure RAG generation workflows."""

from __future__ import annotations

from typing import Any


def build_insufficient_teaching_doc(topic: str) -> str:
    safe_topic = (topic or "Chủ đề chưa xác định").strip()
    return (
        f"# {safe_topic}\n\n"
        "## Mục tiêu học tập\n"
        "- Chưa đủ bằng chứng từ kho tri thức để xác định đầy đủ mục tiêu học tập.\n\n"
        "## Nội dung chính\n"
        "- Chưa tìm thấy ngữ cảnh phù hợp trong các tài liệu đã chọn.\n\n"
        "## Giải thích chi tiết\n"
        "- Hệ thống chưa thể mở rộng nội dung do ngữ cảnh hiện có chưa đủ.\n"
        "- Vui lòng bổ sung thêm tài liệu nguồn và thử lại.\n\n"
        "## Ví dụ\n"
        "- Chưa có ví dụ phù hợp vì thiếu bằng chứng trong tài liệu nguồn.\n\n"
        "## Tóm tắt\n"
        "- Chưa đủ cơ sở để tạo tài liệu giảng dạy đáng tin cậy.\n\n"
        "## Câu hỏi ôn tập\n"
        "1. Cần bổ sung tài liệu nguồn nào cho chủ đề này?\n"
        "2. Những bằng chứng trọng yếu nào còn thiếu để hoàn thiện bài giảng?"
    )


def build_quality_eval_user_prompt(topic: str, content: str) -> str:
    return (
        "Return EXACTLY in this format and do not add extra text:\n"
        "Độ liên quan: X/5\n"
        "Độ chính xác: X/5\n"
        "Độ đầy đủ: X/5\n"
        "Độ rõ ràng: X/5\n"
        "Điểm mạnh: ...\n"
        "Điểm yếu: ...\n"
        "Gợi ý cải thiện: ...\n\n"
        f"Topic: {topic}\n\n"
        f"Generated content:\n{content}"
    )


def build_contextual_chat_query(history: list[dict[str, Any]], question: str) -> str:
    trimmed_question = (question or "").strip()
    if not trimmed_question or not history:
        return trimmed_question

    recent_turns: list[str] = []
    for item in history[-6:]:
        role = "User" if item.get("role") == "user" else "Assistant"
        content = str(item.get("content") or "").strip()
        if content:
            recent_turns.append(f"{role}: {content[:300]}")

    if not recent_turns:
        return trimmed_question

    return "Recent conversation context:\n" + "\n".join(recent_turns) + f"\n\nCurrent question: {trimmed_question}"


def build_teaching_doc_expand_prompt(topic: str, outline_markdown: str) -> str:
    return (
        f"Topic: {topic}\n\n"
        "Generated outline:\n"
        f"{outline_markdown}\n\n"
        "Expand this into a complete teaching document. Output must be Vietnamese with proper diacritics and follow the required structure."
    )


def build_teaching_doc_action_expand_prompt(
    user_prompt: str,
    action: str,
    action_instruction: str,
    level: str,
    requested_format: str,
    length: str,
    outline_markdown: str,
) -> str:
    return (
        f"User request: {user_prompt}\n"
        f"Action: {action}\n"
        f"Additional instruction: {action_instruction}\n"
        f"Level: {level}\n"
        f"Output format: {requested_format}\n"
        f"Length: {length}\n\n"
        "Outline to expand:\n"
        f"{outline_markdown}\n\n"
        "Expand into a complete teaching document. Output must be Vietnamese with proper diacritics and strictly follow the required structure."
    )
