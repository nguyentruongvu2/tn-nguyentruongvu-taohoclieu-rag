"""User-task prompts for project-based RAG authoring.

Design principles:
- Lean "task assignment" frame: passes dynamic data, references format rules.
- All detailed section rules come from SECTION_FORMAT_RULES (single source).
- Quiz-specific logic (modes, existing-question handling) is kept here as
  it represents business logic, not redundant instruction.
- Section prompt returns structured JSON {content, sentinel} for reliable parsing.
"""

import re

from .project_rag_section_profiles import get_section_format_rules, normalize_section_profile_key
from .project_rag_system_prompts import resolve_section_scope


# ---------------------------------------------------------------------------
# Outline user prompt
# ---------------------------------------------------------------------------

OUTLINE_USER_PROMPT_TEMPLATE = """\
You are an expert educator.

Generate a teaching outline for the lesson based on the Topic title and the Teacher requirement.

Topic title: {document_title}
Teacher requirement: {user_prompt}

REQUIREMENTS:
- Organize the outline using Markdown headings (# for main chapters/topics, ## for sections, ### for subsections).
- The outline should contain only headings. No paragraphs or introduction text.
- Ensure the outline has a logical learning progression.
- Vietnamese with proper diacritics.
- Use ONLY the provided context.
"""


# ---------------------------------------------------------------------------
# Section user prompt  ← returns JSON {content, sentinel}
# ---------------------------------------------------------------------------

SECTION_USER_PROMPT_TEMPLATE = """\
Generate ONE section of a lesson.

LESSON TOPIC: {lesson_title}
SECTION: {section_title}
SCOPE: {section_scope}
LEARNER LEVEL: {learner_level}
USER INSTRUCTION: {user_prompt}

{reference_sections_block}

LESSON STRUCTURE (for reference only — generate ONLY the current section):
1. Tiêu đề  2. Mục tiêu học tập  3. Giới thiệu  4. Nội dung chính
5. Ví dụ minh họa  6. Tóm tắt  7. Câu hỏi ôn tập

RULES:
- All content MUST strictly align with the LESSON TOPIC: {lesson_title}.
- Maintain consistency with any REFERENCE SECTIONS provided above.
- ONLY generate content for: {section_title}
- Do NOT generate any other section or create a new TOC.
- Use ONLY the provided context. Do NOT introduce out-of-context concepts.
- If required information is missing → sentinel "NOT_ENOUGH_CONTEXT"
- If coverage incomplete → sentinel "FAIL_COVERAGE"
- Output in Vietnamese with proper diacritics.
- Preserve technical terms, code, formulas in original language.
- No audit/phase/verdict scaffolding in output.

{quiz_context_block}

SECTION FORMAT RULES (STRICT — verify compliance before finalizing):
{section_format_rules}

JSON OUTPUT CONTRACT (MANDATORY):
Return ONLY a valid JSON object — no text before or after, no markdown fences.
{{
  "content": "<Vietnamese Markdown content for this section only>",
  "sentinel": "<empty string | NOT_ENOUGH_CONTEXT | FAIL_COVERAGE>"
}}

Sentinel rules:
- ""               → content generated successfully
- "NOT_ENOUGH_CONTEXT" → context lacks information; set content to ""
- "FAIL_COVERAGE"  → major concept groups missing; set content to ""
"""


# ---------------------------------------------------------------------------
# Section edit user prompt
# ---------------------------------------------------------------------------

SECTION_EDIT_USER_PROMPT_TEMPLATE = """\
Edit the existing section content according to user instruction.

Lesson Topic: {lesson_title}
Section title: {section_title}
User instruction: {user_prompt}

{reference_sections_block}

Requirements:
- All edits MUST remain consistent with the Lesson Topic: {lesson_title}.
- Preserve consistency with any REFERENCE SECTIONS provided above.
- Preserve meaning unless user explicitly asks to change it.
- Improve clarity and formatting.
- Keep output as Markdown for this section only.
- Write all output text in Vietnamese with proper diacritics.
- Preserve technical terms, code, formulas in original language.
"""


# ---------------------------------------------------------------------------
# Template safety
# ---------------------------------------------------------------------------

def _safe_template(template: str) -> str:
    return (
        template.replace("{", "{{")
        .replace("}", "}}")
        .replace("{{document_title}}", "{document_title}")
        .replace("{{lesson_title}}", "{lesson_title}")
        .replace("{{user_prompt}}", "{user_prompt}")
        .replace("{{section_title}}", "{section_title}")
        .replace("{{section_scope}}", "{section_scope}")
        .replace("{{learner_level}}", "{learner_level}")
        .replace("{{section_format_rules}}", "{section_format_rules}")
        .replace("{{quiz_context_block}}", "{quiz_context_block}")
        .replace("{{reference_sections_block}}", "{reference_sections_block}")
        .replace("{{sections_list}}", "{sections_list}")
        .replace("{{sections_guidance_blocks}}", "{sections_guidance_blocks}")
    )


# ---------------------------------------------------------------------------
# Detection helpers
# ---------------------------------------------------------------------------

def _is_question_section(section_title: str) -> bool:
    title = re.sub(r"\s+", " ", (section_title or "").strip().lower())
    return any(
        key in title
        for key in [
            "câu hỏi", "cau hoi", "ôn tập", "on tap", "quiz",
            "trắc nghiệm", "trac nghiem", "bài tập", "bai tap",
        ]
    )


def _detect_question_generation_mode(user_prompt: str, existing_section_content: str = "") -> str:
    prompt = re.sub(r"\s+", " ", (user_prompt or "").strip().lower())

    additional_keywords = [
        "sinh them", "sinh thêm", "bo sung", "bổ sung",
        "additional", "existing questions", "khong lap", "không lặp",
        "do not repeat",
    ]
    core_keywords = [
        "kien thuc cot loi", "kiến thức cốt lõi", "core knowledge",
        "key concept", "khai niem cot loi", "khái niệm cốt lõi",
    ]

    if any(key in prompt for key in additional_keywords):
        return "additional"
    if any(key in prompt for key in core_keywords):
        return "core"

    if (existing_section_content or "").strip():
        return "additional"
    return "standard"


def _trim_existing_questions_context(existing_section_content: str, max_chars: int = 1600) -> str:
    text = (existing_section_content or "").strip()
    if not text:
        return ""
    if len(text) <= max_chars:
        return text
    return f"{text[:max_chars].rstrip()}\n...(truncated)"


# ---------------------------------------------------------------------------
# Quiz context block builder
# ---------------------------------------------------------------------------

def _build_quiz_context_block(user_prompt: str, existing_section_content: str = "") -> str:
    """Build quiz-specific instructions if the section is a quiz.

    Returns an empty string for non-quiz sections.
    This handles the business logic of different quiz generation modes.
    """
    mode = _detect_question_generation_mode(user_prompt, existing_section_content)

    if mode == "additional":
        existing_questions = _trim_existing_questions_context(existing_section_content)
        existing_block = (
            "EXISTING QUESTIONS (do NOT repeat these):\n"
            "```\n"
            f"{existing_questions}\n"
            "```\n"
        ) if existing_questions else (
            "No existing questions available; ensure no internal repetition.\n"
        )
        return (
            "QUIZ MODE: ADDITIONAL QUESTIONS.\n"
            "Generate 6 NEW questions different from existing ones.\n"
            f"{existing_block}"
        )

    if mode == "core":
        return (
            "QUIZ MODE: CORE KNOWLEDGE.\n"
            "Focus on key concepts from context; ignore minor details.\n"
        )

    return ""


# ---------------------------------------------------------------------------
# Learner level guidance
# ---------------------------------------------------------------------------

def _build_level_guidance(learner_level: str) -> str:
    """Map learner level codes to descriptive guidance strings."""
    level = (learner_level or "").strip().upper()
    if level in {"CB", "BASIC"}:
        return "Basic: simple explanations, approachable terminology, relatable examples."
    if level in {"TC", "INTERMEDIATE"}:
        return "Intermediate: more depth, comparisons, and practical application notes."
    if level in {"NC", "ADVANCED"}:
        return "Advanced: deep analysis, edge cases, complex examples, best practices."
    return "Balanced: adjust depth based on context; keep content accessible."


# ---------------------------------------------------------------------------
# Public prompt builders
# ---------------------------------------------------------------------------

def build_outline_user_prompt(document_title: str, user_prompt: str) -> str:
    return _safe_template(OUTLINE_USER_PROMPT_TEMPLATE).format(
        document_title=(document_title or "Tài liệu chưa đặt tên").strip(),
        user_prompt=(user_prompt or "").strip(),
    )


def build_section_user_prompt(
    section_title: str,
    user_prompt: str,
    lesson_title: str = "",
    learner_level: str = "",
    existing_section_content: str = "",
    reference_sections: list[dict[str, str]] | None = None,
) -> str:
    section_key = normalize_section_profile_key(section_title)
    format_rules = get_section_format_rules(section_title)
    if user_prompt.strip():
        override_instruction = (
            "⚠️ OVERRIDE RULE (CRITICAL):\n"
            "- The USER INSTRUCTION takes absolute precedence over the format rules below.\n"
            "- If the USER INSTRUCTION conflicts with any of the rules below, you MUST follow the USER INSTRUCTION.\n\n"
        )
        format_rules = override_instruction + format_rules
    section_scope = resolve_section_scope(section_title)
    level_guidance = _build_level_guidance(learner_level)

    # Build quiz context block only for quiz sections
    quiz_block = ""
    if section_key == "quiz":
        quiz_block = _build_quiz_context_block(user_prompt, existing_section_content)

    # Build reference sections block
    ref_block = ""
    if reference_sections:
        lines = ["REFERENCE SECTIONS (Maintain consistency with these):"]
        for ref in reference_sections:
            title = ref.get("title") or "Unnamed Section"
            content = ref.get("content") or ""
            if content.strip():
                # Trim long reference content to save tokens
                if len(content) > 1200:
                    content = content[:1200] + "\n...(truncated)"
                lines.append(f"### {title}\n{content}")
        if len(lines) > 1:
            ref_block = "\n\n".join(lines)

    return _safe_template(SECTION_USER_PROMPT_TEMPLATE).format(
        lesson_title=(lesson_title or "Nội dung bài học").strip(),
        section_title=(section_title or "Mục chưa đặt tên").strip(),
        section_scope=section_scope,
        learner_level=level_guidance,
        user_prompt=(user_prompt or "").strip(),
        section_format_rules=format_rules,
        quiz_context_block=quiz_block,
        reference_sections_block=ref_block,
    )


def build_section_edit_user_prompt(
    section_title: str,
    user_prompt: str,
    lesson_title: str = "",
    reference_sections: list[dict[str, str]] | None = None,
) -> str:
    # Build reference sections block
    ref_block = ""
    if reference_sections:
        lines = ["REFERENCE SECTIONS (Maintain consistency with these):"]
        for ref in reference_sections:
            title = ref.get("title") or "Unnamed Section"
            content = ref.get("content") or ""
            if content.strip():
                if len(content) > 1200:
                    content = content[:1200] + "\n...(truncated)"
                lines.append(f"### {title}\n{content}")
        if len(lines) > 1:
            ref_block = "\n\n".join(lines)

    return _safe_template(SECTION_EDIT_USER_PROMPT_TEMPLATE).format(
        lesson_title=(lesson_title or "Nội dung bài học").strip(),
        section_title=(section_title or "Mục chưa đặt tên").strip(),
        user_prompt=(user_prompt or "").strip(),
        reference_sections_block=ref_block,
    )


def build_project_rag_combined_prompt(user_prompt: str, task_prompt: str) -> str:
    cleaned_user_prompt = (user_prompt or "").strip()
    cleaned_task_prompt = (task_prompt or "").strip()
    if cleaned_task_prompt:
        # Task prompt already embeds user instruction with strict guardrails.
        return cleaned_task_prompt
    return cleaned_task_prompt or cleaned_user_prompt


# ---------------------------------------------------------------------------
# Batch User Prompts
# ---------------------------------------------------------------------------

BATCH_SECTION_USER_PROMPT_TEMPLATE = """\
Generate multiple related sections for a lesson.

LESSON TOPIC: {lesson_title}

SECTIONS TO GENERATE:
{sections_list}

LEARNER LEVEL: {learner_level}
INSTRUCTION: {user_prompt}

RULES:
- All content MUST strictly align with the LESSON TOPIC: {lesson_title}.
- ONLY generate content for the section IDs listed above.
- Maintain logical flow between sections.
- Use ONLY the provided context.
- If context is missing for a section → set its sentinel to "NOT_ENOUGH_CONTEXT".

{sections_guidance_blocks}

JSON OUTPUT CONTRACT (MANDATORY):
Return ONLY a valid JSON object.
{{
  "sections": {{
    "SECTION_ID_1": {{ "content": "Markdown...", "sentinel": "" }},
    "SECTION_ID_2": {{ "content": "Markdown...", "sentinel": "" }}
  }}
}}

All Markdown content in Vietnamese with proper diacritics.
"""


def build_project_rag_batch_user_prompt(
    sections: list[dict[str, str]],
    user_prompt: str,
    lesson_title: str = "",
    learner_level: str = "",
) -> str:
    """Build a combined user prompt for multiple sections.

    sections: list of {"id": str, "title": str}
    """
    sections_list_str = "\n".join([f"- {s['id']}: {s['title']}" for s in sections])
    level_guidance = _build_level_guidance(learner_level)

    guidance_blocks = []
    for s in sections:
        format_rules = get_section_format_rules(s["title"])
        if user_prompt.strip():
            override_instruction = (
                "⚠️ OVERRIDE RULE (CRITICAL):\n"
                "- The USER INSTRUCTION takes absolute precedence over the format rules below.\n"
                "- If the USER INSTRUCTION conflicts with any of the rules below, you MUST follow the USER INSTRUCTION.\n\n"
            )
            format_rules = override_instruction + format_rules
        block = (
            f"=== RULES FOR: {s['title']} (ID: {s['id']}) ===\n"
            f"{format_rules}\n"
        )
        guidance_blocks.append(block)

    return _safe_template(BATCH_SECTION_USER_PROMPT_TEMPLATE).format(
        lesson_title=(lesson_title or "Nội dung bài học").strip(),
        sections_list=sections_list_str,
        learner_level=level_guidance,
        user_prompt=(user_prompt or "").strip(),
        sections_guidance_blocks="\n\n".join(guidance_blocks),
    )
