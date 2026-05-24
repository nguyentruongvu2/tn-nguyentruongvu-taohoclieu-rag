"""Quiz generation route.

POST /api/quiz/generate-quiz
- Input : lesson_content (string), num_questions (int 1-20), variation_seed (optional int)
- Output: { questions: [ { id, question, options[4], correct_answer, explanation, type } ] }
- LLM   : Gemini via rag_pipeline (async-wrapped) + failover.
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
import re
import time

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from ..rag_pipeline import rag_pipeline
from ..auth_db import save_quiz_attempt, list_quiz_attempts, get_quiz_stats
from ..messages import MSG

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/quiz", tags=["quiz"])


# ── Models ────────────────────────────────────────────────────────────────────

class GenerateQuizRequest(BaseModel):
    lesson_content: str = Field(..., min_length=20)
    num_questions: int = Field(default=5, ge=1, le=20)
    variation_seed: int | None = Field(default=None)


class QuizQuestion(BaseModel):
    id: str
    question: str
    options: list[str]
    correct_answer: str
    explanation: str
    restudy_hint: str = Field(default="") # Hint for what section to re-read if wrong
    type: str


class GenerateQuizResponse(BaseModel):
    questions: list[QuizQuestion]
    variation_seed: int


# ── Question-type definitions ─────────────────────────────────────────────────

_Q_TYPES = {
    "knowledge":     "KNOWLEDGE (Nhận biết): Test recall of facts, terms, basic concepts.",
    "comprehension": "COMPREHENSION (Hiểu): Test understanding of facts and ideas by organizing, comparing, translating, interpreting.",
    "application":   "APPLICATION (Áp dụng): Test using acquired knowledge to solve problems in new situations.",
    "analysis":      "ANALYSIS (Phân tích): Test examining and breaking information into parts, identifying motives or causes.",
}

# ── Prompt builder ────────────────────────────────────────────────────────────

_PROMPT_TEMPLATE = """\
You are an expert academic assessment designer.

TASK: Generate exactly {n} multiple-choice questions from the lesson content below.
VARIATION_SEED: {seed}

QUESTION TYPE DISTRIBUTION ({n} total):
{type_list}
Each entry MUST include "type" field: "knowledge"|"comprehension"|"application"|"analysis".

DOMAIN: Auto-detect subject (CS/Math/Business/Humanities) and adapt question framing.

RULES:
- Each question targets a DIFFERENT concept.
- No two questions share the same opening phrase or structure.
- Vary correct answer position (not always A).
- Answerable ONLY by someone who truly understands the material. Do NOT copy text verbatim.
- QUESTION DESIGN (SCENARIO-BASED): For "application" and "analysis" questions, you MUST create a practical, real-world scenario or problem statement rather than asking direct theoretical questions.
- DISTRACTOR DESIGN (CRITICAL): The 3 incorrect options (distractors) must NOT be obviously wrong. They MUST represent common student misconceptions, partial understandings, or logical errors based on the context.
- Natural Vietnamese, domain-appropriate technical terms.
- Explanation: 1-2 sentences. You MUST explain WHY the correct answer is right AND briefly point out the logical flaw in the most tempting distractor.
- Restudy Hint: Identify the specific section or concept name from the lesson that the student should review if they fail this question (e.g., "Mục 2.1: Cách hoạt động của RAM").

OUTPUT: Return ONLY valid JSON, no markdown, no extra text:
{{"questions":[{{"type":"...","question":"...","options":["A. ...","B. ...","C. ...","D. ..."],"correct_answer":"A","explanation":"...","restudy_hint":"..."}}]}}

LESSON CONTENT:
{content}
"""


def _build_prompt(content: str, n: int, seed: int) -> str:
    type_keys = list(_Q_TYPES.keys())
    assigned = [type_keys[i % len(type_keys)] for i in range(n)]
    rng = random.Random(seed)
    rng.shuffle(assigned)

    counts: dict[str, int] = {}
    for t in assigned:
        counts[t] = counts.get(t, 0) + 1

    type_list = "\n".join(
        f"  [{t.upper()} x{counts.get(t, 0)}] {desc}"
        for t, desc in _Q_TYPES.items()
    )

    # Scale content: more questions = more context, but cap waste
    max_chars = min(2500 + n * 350, 6000)

    return _PROMPT_TEMPLATE.format(
        n=n,
        seed=seed,
        type_list=type_list,
        content=content[:max_chars].strip(),
    )


# ── JSON helpers ──────────────────────────────────────────────────────────────

def _extract_json(raw: str) -> dict:
    cleaned = re.sub(r"```(?:json)?", "", raw, flags=re.IGNORECASE).strip().strip("`").strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass
    match = re.search(r"\{.*\}", cleaned, re.DOTALL)
    if match:
        return json.loads(match.group())
    raise ValueError("No valid JSON in LLM response")


_VALID_TYPES = {"knowledge", "comprehension", "application", "analysis"}


def _validate(raw: dict) -> bool:
    return (
        isinstance(raw.get("question"), str) and raw["question"].strip()
        and isinstance(raw.get("options"), list) and len(raw["options"]) == 4
        and all(isinstance(o, str) and o.strip() for o in raw["options"])
        and isinstance(raw.get("correct_answer"), str)
        and raw["correct_answer"].upper() in {"A", "B", "C", "D"}
        and isinstance(raw.get("explanation"), str) and raw["explanation"].strip()
    )


# ── LLM call (async-wrapped to avoid blocking event loop) ────────────────────

def _call_llm_sync(prompt: str, n: int) -> str:
    """Sync LLM call — runs in thread pool via asyncio.to_thread."""
    # Scale output budget: ~200 tokens/question overhead
    max_output = min(800 + n * 220, 2800)
    raw_text, _ = rag_pipeline._generate_content_with_failover(
        prompt,
        temperature=0.65,
        max_output_tokens=max_output,
    )
    return raw_text


async def _call_llm(lesson_content: str, num_questions: int, seed: int) -> list[dict]:
    prompt = _build_prompt(lesson_content, num_questions, seed)
    # Run blocking LLM I/O in thread pool — frees event loop for other requests
    raw_text = await asyncio.to_thread(_call_llm_sync, prompt, num_questions)
    parsed = _extract_json(raw_text)
    questions = parsed.get("questions", [])
    if not isinstance(questions, list):
        raise ValueError("LLM returned non-list questions")
    return questions


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post("/generate-quiz", response_model=GenerateQuizResponse)
async def generate_quiz(body: GenerateQuizRequest):
    """Generate diverse academic MCQ quiz using Gemini (non-blocking)."""
    seed = body.variation_seed if body.variation_seed is not None else int(time.time()) % 10000

    try:
        raw_questions = await _call_llm(body.lesson_content, body.num_questions, seed)
    except Exception as exc:
        logger.error("Quiz LLM failed (seed=%d): %s", seed, exc, exc_info=True)
        raise HTTPException(status_code=502, detail=MSG.quiz.llm_failed)

    questions: list[QuizQuestion] = []
    for raw in raw_questions:
        if not _validate(raw):
            logger.warning("Skipping invalid question: %s", str(raw)[:120])
            continue
        q_type = str(raw.get("type", "knowledge")).lower().strip()
        if q_type not in _VALID_TYPES:
            q_type = "knowledge"
        questions.append(QuizQuestion(
            id=f"q{len(questions) + 1}",
            question=raw["question"].strip(),
            options=[str(o).strip() for o in raw["options"]],
            correct_answer=raw["correct_answer"].upper().strip(),
            explanation=raw["explanation"].strip(),
            restudy_hint=str(raw.get("restudy_hint", "")).strip(),
            type=q_type,
        ))

    if not questions:
        raise HTTPException(
            status_code=422,
            detail=MSG.quiz.no_valid_questions,
        )

    return GenerateQuizResponse(questions=questions, variation_seed=seed)


# ── Save / History endpoints ──────────────────────────────────────────────────

class SaveAttemptRequest(BaseModel):
    score: int
    total: int
    num_questions: int
    answers: dict  # {questionId: selectedLetter}
    project_id: str | None = None
    variation_seed: int | None = None


class SaveAttemptResponse(BaseModel):
    id: int
    score: int
    total: int
    percentage: float
    created_at: str


class QuizStatsResponse(BaseModel):
    attempts: int
    avg_percentage: float | None
    best_percentage: float | None
    last_attempt_at: str | None


@router.post("/save-attempt", response_model=SaveAttemptResponse)
async def save_attempt(body: SaveAttemptRequest, request: Request):
    """Persist quiz result. user_id taken from JWT if available (optional)."""
    auth_user = getattr(request.state, "auth_user", None)
    user_id = int(auth_user["id"]) if auth_user else None
    try:
        result = await asyncio.to_thread(
            save_quiz_attempt,
            score=body.score,
            total=body.total,
            num_questions=body.num_questions,
            answers=body.answers,
            user_id=user_id,
            project_id=body.project_id,
            variation_seed=body.variation_seed,
        )
        return SaveAttemptResponse(**result)
    except Exception as exc:
        logger.error("save_attempt error: %s", exc)
        raise HTTPException(status_code=500, detail=f"{MSG.quiz.save_failed}: {exc}")


@router.get("/stats", response_model=QuizStatsResponse)
async def quiz_stats(request: Request, project_id: str | None = None):
    """Return aggregate quiz stats for the current user (or project)."""
    auth_user = getattr(request.state, "auth_user", None)
    user_id = int(auth_user["id"]) if auth_user else None
    try:
        stats = await asyncio.to_thread(get_quiz_stats, user_id=user_id, project_id=project_id)
        return QuizStatsResponse(**stats)
    except Exception as exc:
        logger.error("quiz_stats error: %s", exc)
        raise HTTPException(status_code=500, detail=f"{MSG.quiz.stats_failed}: {exc}")


@router.get("/history")
async def quiz_history(request: Request, project_id: str | None = None, limit: int = 10):
    """Recent quiz attempts for current user."""
    auth_user = getattr(request.state, "auth_user", None)
    user_id = int(auth_user["id"]) if auth_user else None
    try:
        rows = await asyncio.to_thread(
            list_quiz_attempts,
            user_id=user_id,
            project_id=project_id,
            limit=min(limit, 50),
        )
        return {"attempts": rows}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
