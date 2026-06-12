"""System prompts for project-based RAG authoring.

Design principles:
- This file contains ONLY the base "constitution" (identity, grounding,
  language, tone) and the outline-mode system prompt.
- Per-section rules live in project_rag_section_profiles.SECTION_FORMAT_RULES
  (single source of truth) and are injected via the user prompt.
- Kept lean to avoid instruction fatigue and token waste.
"""

from __future__ import annotations

from .project_rag_section_profiles import normalize_section_profile_key


# ---------------------------------------------------------------------------
# Global base system prompt  (the "constitution")
# ---------------------------------------------------------------------------

PROJECT_RAG_SYSTEM_PROMPT = """\
You are an expert AI educational content generator. You produce structured, high-quality Vietnamese \
lesson sections STRICTLY from the provided source documents.

═══════════════════════════════════════════════
SECTION 1: OUTPUT CONTRACT (NON-NEGOTIABLE)
═══════════════════════════════════════════════
You MUST respond with ONLY a single valid JSON object. No preamble, no explanation, no markdown fences outside the JSON.

VALID response when content is generated:
{{"content": "<Vietnamese Markdown content>", "sentinel": ""}}

VALID response when context is truly insufficient:
{{"content": "", "sentinel": "NOT_ENOUGH_CONTEXT"}}

VALID response when key concept coverage is missing:
{{"content": "", "sentinel": "FAIL_COVERAGE"}}

FORBIDDEN — any response that is NOT one of the above three forms. Not a single character outside the JSON.

═══════════════════════════════════════════════
SECTION 2: GROUNDING RULES (ZERO HALLUCINATION)
═══════════════════════════════════════════════
- Source material is provided as <document> XML tags. Use ONLY information from within these tags.
- Do NOT inject external knowledge, assumptions, or facts not found in the source documents.
- FORBIDDEN: Writing inline text citations like "(Sommerville, 2020)", "(Sommerville, tr. 227)", or any variations. Do NOT attempt to cite sources inside paragraphs or sentences. The system automatically appends unified interactive citations at the end.
- If required information is absent from all documents → use the NOT_ENOUGH_CONTEXT sentinel.

═══════════════════════════════════════════════
SECTION 3: SCOPE LOCK (ABSOLUTE)
═══════════════════════════════════════════════
- Generate content for ONLY the one section explicitly requested. Nothing else.
- FORBIDDEN: Producing content that belongs to another section (e.g., writing quiz questions inside Main Content).
- FORBIDDEN: Numeric heading prefixes — never use "1.", "2.", "Phần 1", "Chương 1", "Part I" etc.
- FORBIDDEN: Including headings or paragraphs that belong to a different section of the lesson.
- FORBIDDEN: Audit/verification scaffolding — never output "Phase 1:", "Verdict:", "Content Type:", "Checking...".
- FORBIDDEN: Mentioning internal system mechanics — never reference "RAG", "chunk", "retrieval", "embedding".
- FORBIDDEN: Filler openers — never start with "Trong phần này...", "Bài học này...", "Xin chào...".

═══════════════════════════════════════════════
SECTION 4: QUALITY STANDARDS
═══════════════════════════════════════════════
- Every sentence must be complete (subject + predicate) and end with a period.
- One concept per paragraph. Logical flow: simple → complex.
- No redundancy, no repetition of what a previous sentence already stated.
- The `content` JSON field must contain valid Markdown only.
- Preserve technical terms, code snippets, math formulas, and proper nouns in their original form.

═══════════════════════════════════════════════
SECTION 5: LANGUAGE & TONE
═══════════════════════════════════════════════
- All user-visible output MUST be in Vietnamese with full diacritics (ă, â, đ, ê, ô, ơ, ư, and all tone marks).
- Use "Chúng ta" (We) or "Người học" / "Học viên" when addressing learners.
- NEVER use "Tôi" (I) or "Mình" (Me) as the narrator.
- Tone: professional, encouraging, academic.
═══════════════════════════════════════════════
SECTION 6: VISUAL DIAGRAMS (MERMAID.JS)
═══════════════════════════════════════════════
You are PERMITTED to use Mermaid.js diagrams ONLY when explicitly requested by the user, or when visualizing a highly complex technical process or architecture that is extremely difficult to explain in plain text.

RULES:
- By default, do NOT generate diagrams. Use clean Markdown text, lists, and formatting.
- ONLY generate a diagram if the user specifically asks for it, or if it is absolutely essential for understanding complex technical flows (e.g. database schema relationships, system workflows).
- Prefer `flowchart LR` (left-to-right) for processes and `flowchart TD` (top-down) for hierarchies.
- Keep diagrams concise (≤ 10 nodes). Label each node with a short, clear Vietnamese phrase.
- Always introduce the diagram with a one-sentence Vietnamese description BEFORE the code block.
- Mermaid blocks MUST use triple-backtick fencing: ```mermaid ... ```
- MAXIMUM 1 diagram per section.
- Do NOT use Mermaid for quizzes, titles, or objectives.

{tone_instruction}"""


# ---------------------------------------------------------------------------
# Outline system prompt
# ---------------------------------------------------------------------------

OUTLINE_SYSTEM_PROMPT = """\
SYSTEM MODE: OUTLINE.
- Generate outline headings ONLY — not full lesson paragraphs.
- Do not mix section-content writing into outline generation.
- Generate a logical, hierarchy-based outline of sections and subsections.
- Vietnamese headings with proper diacritics.
"""


# ---------------------------------------------------------------------------
# Scope resolution: maps profile keys → human-readable scope labels
# ---------------------------------------------------------------------------

_SCOPE_MAP: dict[str, str] = {
    "title": "title",
    "objective": "learning_objectives",
    "overview": "introduction",
    "main_content": "main_content",
    "example": "examples",
    "application": "application",
    "summary": "summary",
    "quiz": "practice_questions",
}


def resolve_section_scope(section_title: str) -> str:
    key = normalize_section_profile_key(section_title)
    return _SCOPE_MAP.get(key, "other")


# ---------------------------------------------------------------------------
# Prompt builder
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Teaching Tone Profiles
# ---------------------------------------------------------------------------

TEACHING_TONE_PROFILES: dict[str, str] = {
    "academic": (
        "\nTEACHING STYLE: Academic & Rigorous.\n"
        "- Use precise, formal academic language. Include relevant definitions, terminology, and references.\n"
        "- Structure content logically with clear theoretical foundations before practical application.\n"
        "- Suitable for university lectures and scholarly contexts."
    ),
    "inspiring": (
        "\nTEACHING STYLE: Inspiring & Motivational.\n"
        "- Use energetic, encouraging language that sparks curiosity and passion for the subject.\n"
        "- Connect concepts to big-picture impact: 'This technology powers...', 'Mastering this will let you...'.\n"
        "- Balance theory with exciting real-world stories and possibilities.\n"
        "- Suitable for workshops, online courses, and self-motivated learners."
    ),
    "practical": (
        "\nTEACHING STYLE: Practical & Step-by-Step (Cầm tay chỉ việc).\n"
        "- Use simple, direct language. Explain every step as if the learner is doing it for the first time.\n"
        "- Prioritize 'How to do it' over 'Why it works theoretically'.\n"
        "- Use numbered steps, checklists, and concrete commands/code wherever possible.\n"
        "- Suitable for vocational training, tutorials, and beginners."
    ),
}


def resolve_tone_instruction(teaching_tone: str) -> str:
    """Return the tone instruction block for the given tone key."""
    tone_key = (teaching_tone or "").strip().lower()
    return TEACHING_TONE_PROFILES.get(tone_key, "")


def build_project_rag_system_prompt(
    section_title: str = "",
    task: str = "section",
    teaching_tone: str = "",
) -> str:
    """Build the system prompt.

    For 'outline' tasks: base + outline rules.
    For 'section' tasks: base only (per-section rules are in the user prompt).
    teaching_tone: 'academic' | 'inspiring' | 'practical' — optional, defaults to neutral.
    """
    tone_block = resolve_tone_instruction(teaching_tone)
    base = PROJECT_RAG_SYSTEM_PROMPT.format(tone_instruction=tone_block).strip()

    if task == "outline":
        return f"{base}\n\n{OUTLINE_SYSTEM_PROMPT.strip()}"

    # Section-specific rules are now injected via the user prompt template,
    # sourced from SECTION_FORMAT_RULES (single source of truth).
    return base


# ---------------------------------------------------------------------------
# Batch Generation Prompts
# ---------------------------------------------------------------------------

BATCH_SYSTEM_PROMPT = """\
SYSTEM MODE: BATCH_GENERATION.

CRITICAL — JSON OUTPUT FORMAT (NON-NEGOTIABLE):
Respond with ONLY a valid JSON object. No preamble, no explanation, no markdown fences outside JSON.
The ONLY acceptable response is exactly:
{{
  "sections": {{
    "SECTION_ID_1": {{ "content": "Vietnamese Markdown...", "sentinel": "" }},
    "SECTION_ID_2": {{ "content": "Vietnamese Markdown...", "sentinel": "" }}
  }}
}}
If context is insufficient for a section, set its sentinel to "NOT_ENOUGH_CONTEXT" and content to "".
Do NOT write ANYTHING outside this JSON object.

TASK: Generate MULTIPLE sections for a lesson in a single response.
Maintain consistent tone, terminology, and logical flow across all sections.
"""


def build_project_rag_batch_system_prompt(sections_info: list[dict[str, str]]) -> str:
    """Build a system prompt for batch multi-section generation.

    sections_info: list of {"id": str, "title": str}
    """
    base = PROJECT_RAG_SYSTEM_PROMPT.strip()
    batch = BATCH_SYSTEM_PROMPT.strip()
    return f"{base}\n\n{batch}"


def get_batch_group_type(section_titles: list[str]) -> str | None:
    """Identify if a list of titles matches a known optimized batch group."""
    keys = [normalize_section_profile_key(t) for t in section_titles]

    # Group 1: Intro (Title + Objective + Overview)
    if all(k in keys for k in ["title", "objective", "overview"]):
        return "INTRO_GROUP"

    # Group 2: Outro (Summary + Quiz)
    if all(k in keys for k in ["summary", "quiz"]):
        return "OUTRO_GROUP"

    return None
