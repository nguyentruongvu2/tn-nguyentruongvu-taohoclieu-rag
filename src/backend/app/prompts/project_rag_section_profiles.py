"""Section profiles for project-based RAG generation.

Design principles:
- SECTION_FORMAT_RULES is the SINGLE SOURCE OF TRUTH for each section.
  It combines: role, task, constraints, and output format.
- All instructions in English; output labels remain Vietnamese.
- Subject-agnostic: no hardcoded domain references.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Literal


RetrievalMode = Literal["top_k_range", "full_section"]


@dataclass(frozen=True)
class RetrievalProfile:
    key: str
    mode: RetrievalMode
    top_k_levels: tuple[int, ...]
    min_total_chars: int
    max_chunks: int


RETRIEVAL_MAP: dict[str, str] = {
    "title": "full_section",
    "objective": "top_k=3-5 (concept chunks)",
    "overview": "top_k=3-4 (intro chunks)",
    "main_content": "top_k=7-12 + full-section merge (hybrid search)",
    "example": "top_k=3-5 + scenario-solution grounding",
    "application": "top_k=2-3",
    "summary": "top_k=10-20 + chapter coverage (metadata)",
    "quiz": "top_k=6-10 + heading coverage (application focused)",
}


SECTION_USER_INTENT_HINTS: dict[str, str] = {
    "toc": "Tạo dàn ý bài giảng chi tiết, bao quát đầy đủ các tài liệu nguồn đã chọn",
    "title": "Đặt tiêu đề bài học mang tính mô tả cao và bao quát nội dung",
    "objective": "Xác định mục tiêu học tập cụ thể dựa trên kiến thức cốt lõi từ tài liệu",
    "overview": "Viết phần giới thiệu tổng quan, nêu bật các công nghệ/khái niệm chính từ nguồn tài liệu, có trích dẫn nguồn",
    "main_content": "Viết nội dung chính chi tiết, tổng hợp kiến thức từ tất cả tài liệu nguồn, bắt buộc đính kèm trích dẫn nguồn cho mỗi ý quan trọng",
    "example": "Tạo ví dụ minh họa thực tế dựa trên ngữ cảnh tài liệu, có giải thích và trích nguồn",
    "application": "Phân tích ứng dụng thực tế của kiến thức, liên hệ trực tiếp với các tình huống trong tài liệu",
    "summary": "Tóm tắt các điểm quan trọng nhất, đảm bảo không bỏ sót ý chính từ bất kỳ tài liệu nguồn nào",
    "quiz": "Tạo câu hỏi ôn tập kiểm tra kiến thức tổng hợp từ tất cả các nguồn tài liệu",
    "dynamic": "Viết nội dung phù hợp nhất với chủ đề '{section_title}', dựa sát vào tài liệu nguồn.",
    "default": "Viết nội dung chi tiết cho mục này, đảm bảo bám sát tài liệu nguồn và có trích dẫn đầy đủ",
}


# ---------------------------------------------------------------------------
# SECTION_FORMAT_RULES — Single source of truth for each section's contract.
# Combines: role, task description, constraints, and strict output format.
# Injected into user prompt as the FORMAT COMPLIANCE GATE.
# ---------------------------------------------------------------------------

SECTION_FORMAT_RULES: dict[str, str] = {

    # ── TITLE ────────────────────────────────────────────────────────────────
    "title": (
        "ROLE: Topic Summarizer.\n"
        "TASK: Write a single lesson title capturing the core topic.\n"
        "CONSTRAINTS:\n"
        "- Must align perfectly with the Lesson Topic provided.\n"
        "- Max 12 words. Plain text only — no Markdown, no quotes.\n"
        "- Must accurately reflect the main topic from context.\n"
        "- Professional, direct tone. Avoid vague words ('Introduction',\n"
        "  'Basics') unless context genuinely warrants them.\n"
        "OUTPUT: one line of title text, nothing else."
    ),

    # ── LEARNING OBJECTIVES ──────────────────────────────────────────────────
    "objective": (
        "ROLE: Instructional Design Expert.\n"
        "TASK: Write 3–5 specific, measurable learning objectives.\n"
        "CONSTRAINTS:\n"
        "- Objectives must strictly support the Lesson Topic provided.\n"
        "- Each objective starts with ONE Bloom's-aligned Vietnamese verb:\n"
        "  L1-Remember: Liệt kê, Nhận biết, Xác định\n"
        "  L2-Understand: Hiểu, Giải thích, Mô tả, Phân biệt\n"
        "  L3-Apply: Áp dụng, Thực hiện, Sử dụng, Tính toán\n"
        "  L4-Analyze: Phân tích, So sánh, Đánh giá nguyên nhân\n"
        "  L5-Evaluate: Đánh giá, Nhận xét, Lựa chọn phương án\n"
        "  L6-Create: Thiết kế, Xây dựng, Đề xuất\n"
        "- Pick verbs matching the depth of source content.\n"
        "- No repeated verbs. Every sentence must be grammatically complete.\n"
        "- Scope: derived only from provided context.\n"
        "OUTPUT:\n"
        "### Mục tiêu học tập\n"
        "* [Verb] [full objective]\n"
        "* [Verb] [full objective]\n"
        "* [Verb] [full objective]"
    ),

    # ── OVERVIEW / INTRODUCTION ──────────────────────────────────────────────
    "overview": (
        "ROLE: Expert Academic Instructor.\n"
        "TASK: Write a compelling introduction (4–5 sentences) that hooks the learner.\n"
        "CONSTRAINTS:\n"
        "- Sentence 1: Open with a real-world problem or relatable situation that this lesson solves.\n"
        "- Sentence 2: Introduce the core concept/technology by name and define it briefly.\n"
        "- Sentence 3: State WHY this matters (practical importance, industry relevance).\n"
        "- Sentence 4: Preview what the learner will be able to DO after this lesson (skill-oriented).\n"
        "- Sentence 5 (optional): A motivating statement or compelling statistic from the context.\n"
        "- No filler openers ('Trong phần này...', 'Bài học này...').\n"
        "- Every sentence must be complete and end with a period.\n"
        "- MUST cite source at the end: 📚 Nguồn: [File Name]\n"
        "OUTPUT:\n"
        "### Tổng quan\n"
        "[4-5 sentence paragraph — engaging, problem-first, skill-oriented]\n"
        "📚 Nguồn: [source file name]"
    ),

    # ── MAIN CONTENT ─────────────────────────────────────────────────────────
    "main_content": (
        "ROLE: Expert educator and content synthesizer.\n"
        "TASK: Rewrite the main content as clear, rich teaching material by synthesizing ALL provided source documents.\n"
        "CONSTRAINTS:\n"
        "- THEMATIC SYNTHESIS: Do NOT write 'Theo file A...' then 'Theo file B...'. Synthesize by CONCEPT.\n"
        "  Find the common themes across all files. If files conflict, state the general rule then note the nuance/exception.\n"
        "- Centralized Citations: Do NOT manually write inline '📚 Nguồn:' or footnotes in the text; the system automatically appends unified interactive citations at the end of subsections.\n"
        "- Fix any code/formula/syntax errors present in context.\n"
        "- Do NOT mention RAG, chunk, or the system process.\n"
        "PEDAGOGICAL SCAFFOLDING (MUST BE FOLLOWED STRICTLY IN THIS ORDER):\n"
        "  1. HOOK (Mở đầu): Start the section with 1 engaging question or real-world scenario that unifies the topic.\n"
        "  2. EXPLAIN (Giảng giải): Present the synthesized concepts clearly. Use paragraphs, bullet points, and bold text for readability.\n"
        "     - Add max 1 💡 **Mẹo ghi nhớ:** (Analogy) and 1 📝 **Lưu ý quan trọng:** (Misconception) if appropriate.\n"
        "  3. CONCEPT CHECK (Kiểm tra nhanh): After the main explanation, insert a quick mid-point check:\n"
        "     > 🤔 **Kiểm tra nhanh:** [1 short question to test understanding of the concept just explained]\n"
        "     > *Gợi ý:* [Brief hint]\n"
        "  4. GLOSSARY (Từ điển thuật ngữ): At the very end of the section, extract 2-4 difficult or new terms from the text and define them.\n"
        "     > [!NOTE] 📖 **Từ điển thuật ngữ**\n"
        "     > - **[Term 1]**: [Definition synthesized from context]\n"
        "     > - **[Term 2]**: [Definition]\n"
        "OUTPUT: refined Vietnamese Markdown — follow the scaffold structure exactly."
    ),

    # ── EXAMPLES ─────────────────────────────────────────────────────────────
    "example": (
        "ROLE: Instructional Content Specialist.\n"
        "TASK: Generate 2–3 concrete, illustrative examples that progressively increase in complexity.\n"
        "CONSTRAINTS:\n"
        "- Example 1: Simple/basic — illustrates the concept in its most straightforward form.\n"
        "- Example 2: Realistic — a practical scenario a learner might actually encounter.\n"
        "- Example 3 (if context supports): Complex/edge case — challenges the learner to think deeper.\n"
        "- Prefer examples already present in context. If none, synthesize from core logic\n"
        "  (only when safely derivable — else sentinel NOT_ENOUGH_CONTEXT).\n"
        "- Format by domain: code blocks for tech, equations for math/science,\n"
        "  case studies for humanities/social, scenarios for business.\n"
        "- Each example MUST start with 'Tình huống' or 'Yêu cầu'.\n"
        "- MANDATORY: After each example, add a 'Tại sao?' explanation block:\n"
        "  **Tại sao điều này quan trọng?** [1–2 sentences connecting the example back to the core concept]\n"
        "- Never show raw data without explaining its meaning.\n"
        "- Reuse terminology from context. Complete sentences only.\n"
        "- Cite source at the end of each example: 📚 Nguồn: [File Name]\n"
        "OUTPUT (repeat per example):\n"
        "### Ví dụ [N]: [Short descriptive name]\n"
        "- **Tình huống/Yêu cầu:** [problem description]\n"
        "- **Nội dung thực hiện:** [code / formula / steps]\n"
        "- **Kết quả mong đợi:** [expected outcome]\n"
        "- **Tại sao điều này quan trọng?** [connect back to the core concept]\n"
        "📚 Nguồn: [source file name]"
    ),

    # ── APPLICATION ──────────────────────────────────────────────────────────
    "application": (
        "ROLE: Practical Application Specialist.\n"
        "TASK: Describe 2–4 real-world applications of this section's concepts.\n"
        "CONSTRAINTS:\n"
        "- For each: name the domain, explain how the concept is used,\n"
        "  state the practical benefit.\n"
        "- Do NOT re-explain theory. Each application must be distinct.\n"
        "- Adapt to the subject domain (tech / science / humanities / business).\n"
        "- If context provides no basis → sentinel NOT_ENOUGH_CONTEXT.\n"
        "OUTPUT:\n"
        "### Ứng dụng thực tế\n"
        "**[Domain/context]:** [2–3 sentence description]\n"
        "(repeat per application)"
    ),

    # ── SUMMARY ──────────────────────────────────────────────────────────────
    "summary": (
        "ROLE: Knowledge Synthesizer.\n"
        "TASK: Summarize the section as a bullet list.\n"
        "CONSTRAINTS:\n"
        "- 3–5 bullets (2 allowed if context is sparse).\n"
        "- One bullet = one major concept group from context.\n"
        "- Strictly in-context; no hallucinated terms.\n"
        "- No prose, no sub-details, no bold inside bullets.\n"
        "- If any major concept group is missing → sentinel FAIL_COVERAGE.\n"
        "- If concept groups unidentifiable → sentinel NOT_ENOUGH_CONTEXT.\n"
        "OUTPUT: clean bullet list only — each line starts with '- '.\n"
        "No heading, no numbering, no text outside the bullets."
    ),

    # ── QUIZ ─────────────────────────────────────────────────────────────────
    "quiz": (
        "ROLE: Senior Assessment Design Expert with deep pedagogical expertise.\n"
        "TASK: Generate exactly 6 review questions (3 MCQ + 3 short-answer) tightly aligned to the lesson's Learning Objectives.\n"
        "CONSTRAINTS:\n"
        "- CRITICAL: Every question MUST map to one of the Learning Objectives stated in the lesson.\n"
        "- Coverage: MCQ questions should target lower-order (Nhận biết, Hiểu), short-answer should target higher-order (Áp dụng, Phân tích).\n"
        "- Base ALL questions ONLY on the provided lesson content and context.\n"
        "- Prefer scenario-based framing: 'How to...', 'What happens if...', 'What is the result of...'.\n"
        "- Every MCQ: 4 options (A/B/C/D), exactly one correct answer.\n"
        "- Distractors (wrong options) MUST be plausible — based on common misconceptions or partial understanding.\n"
        "- Every short-answer: a model answer + a teaching hint + a pedagogical insight block.\n"
        "- No external knowledge, no trick questions, no ambiguous phrasing.\n"
        "- If context insufficient → sentinel NOT_ENOUGH_CONTEXT.\n"
        "OUTPUT FORMAT: You MUST return pure Markdown text. Do NOT use JSON.\n"
        "Follow this exact structure for the output:\n\n"
        "### Phần 1: Câu hỏi Trắc nghiệm\n\n"
        "**Câu 1: [Nội dung câu hỏi]**\n"
        "- A. [Tùy chọn A]\n"
        "- B. [Tùy chọn B]\n"
        "- C. [Tùy chọn C]\n"
        "- D. [Tùy chọn D]\n"
        "\n> **Đáp án:** [A, B, C hoặc D] — **Giải thích:** [Giải thích ngắn gọn lý do đúng/sai]\n\n"
        "(Lặp lại cho 3 câu MCQ)\n\n"
        "### Phần 2: Câu hỏi Tự luận\n\n"
        "**Câu 1: [Nội dung câu hỏi]**\n"
        "\n> **Đáp án tham khảo:** [Câu trả lời mẫu]\n"
        "> **Gợi ý làm bài:** [Gợi ý/hướng dẫn phân tích]\n"
        "> **Mục tiêu đánh giá:** [Nhận biết/Hiểu/Áp dụng...]\n\n"
        "(Lặp lại cho 3 câu Tự luận)\n"

    ),
    
    # ── DYNAMIC FALLBACK ─────────────────────────────────────────────────────
    "dynamic": (
        "ROLE: Expert Content Synthesizer.\n"
        "TASK: Write content for the section titled '{section_title}'.\n"
        "CONSTRAINTS:\n"
        "- Analyze the meaning of '{section_title}' to determine the best format (e.g., if it's 'Exercises', generate a list of questions; if it's 'References', generate a list of links/books).\n"
        "- Present the information clearly using markdown formatting (bold, italics, lists, bullet points) as appropriate for the content type.\n"
        "- Ensure the tone is pedagogical and aligns with the rest of the lesson.\n"
        "- Synthesize information from the provided context.\n"
        "- Do NOT force a Hook, Concept Check, or Glossary unless it naturally fits the title.\n"
        "OUTPUT: Refined Vietnamese Markdown."
    ),
}


RETRIEVAL_PROFILES: dict[str, RetrievalProfile] = {
    "title": RetrievalProfile(
        key="title",
        mode="full_section",
        top_k_levels=(),
        min_total_chars=1000,
        max_chunks=120,
    ),
    "objective": RetrievalProfile(
        key="objective",
        mode="top_k_range",
        top_k_levels=(3, 4, 5),
        min_total_chars=900,
        max_chunks=5,
    ),
    "overview": RetrievalProfile(
        key="overview",
        mode="top_k_range",
        top_k_levels=(3, 4),
        min_total_chars=800,
        max_chunks=4,
    ),
    "main_content": RetrievalProfile(
        key="main_content",
        mode="top_k_range",
        top_k_levels=(7, 8, 10, 12),
        min_total_chars=2800,
        max_chunks=12,
    ),
    "example": RetrievalProfile(
        key="example",
        mode="top_k_range",
        top_k_levels=(3, 4, 5),
        min_total_chars=1200,
        max_chunks=5,
    ),
    "application": RetrievalProfile(
        key="application",
        mode="top_k_range",
        top_k_levels=(2, 3),
        min_total_chars=900,
        max_chunks=3,
    ),
    "summary": RetrievalProfile(
        key="summary",
        mode="top_k_range",
        top_k_levels=(8, 10, 12, 14, 16, 18),
        min_total_chars=1800,
        max_chunks=24,
    ),
    "quiz": RetrievalProfile(
        key="quiz",
        mode="top_k_range",
        top_k_levels=(6, 7, 8, 10),
        min_total_chars=1800,
        max_chunks=10,
    ),
    "dynamic": RetrievalProfile(
        key="dynamic",
        mode="top_k_range",
        top_k_levels=(5, 6, 8, 10),
        min_total_chars=1800,
        max_chunks=10,
    ),
}


def _strip_accents(text: str) -> str:
    normalized = unicodedata.normalize("NFD", text or "")
    stripped = "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")
    return stripped.replace("đ", "d").replace("Đ", "D")


def _normalize(text: str) -> str:
    raw = _strip_accents((text or "").lower())
    raw = re.sub(r"[^a-z0-9\s]", " ", raw)
    raw = re.sub(r"\s+", " ", raw).strip()
    return raw


def normalize_section_profile_key(section_title: str) -> str:
    label = _normalize(section_title)

    if any(key in label for key in ["tieu de", "lesson title", "title", "chu de"]):
        return "title"
    if any(key in label for key in ["muc tieu", "objective", "learning objective"]):
        return "objective"
    if any(key in label for key in ["gioi thieu", "overview", "mo dau", "dan nhap"]):
        return "overview"
    if any(key in label for key in ["noi dung chinh", "main content", "key concept", "khai niem chinh"]):
        return "main_content"
    if any(key in label for key in ["ung dung", "application", "thuc te"]):
        return "application"
    if any(key in label for key in ["vi du", "example", "minh hoa"]):
        return "example"
    if any(key in label for key in ["tom tat", "tong ket", "summary", "ket luan"]):
        return "summary"
    if any(key in label for key in ["cau hoi on tap", "on tap", "quiz", "trac nghiem"]):
        return "quiz"

    return "dynamic"


def get_retrieval_profile(section_title: str) -> RetrievalProfile:
    key = normalize_section_profile_key(section_title)
    return RETRIEVAL_PROFILES.get(key, RETRIEVAL_PROFILES["dynamic"])


def get_section_format_rules(section_title: str) -> str:
    key = normalize_section_profile_key(section_title)
    rule_template = SECTION_FORMAT_RULES.get(key, SECTION_FORMAT_RULES["dynamic"])
    if key == "dynamic" and "{section_title}" in rule_template:
        return rule_template.format(section_title=section_title)
    return rule_template


def get_section_user_intent_hint(section_title: str) -> str:
    key = normalize_section_profile_key(section_title)
    hint_template = SECTION_USER_INTENT_HINTS.get(key, SECTION_USER_INTENT_HINTS["default"])
    if key == "dynamic" and "{section_title}" in hint_template:
        return hint_template.format(section_title=section_title)
    return hint_template
