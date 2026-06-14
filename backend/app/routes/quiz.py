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

class AnalyzeContentRequest(BaseModel):
    lesson_content: str = Field(..., min_length=5)

class AnalyzeContentResponse(BaseModel):
    suggested_count: int
    complexity: str
    reasoning: str

class GenerateQuizRequest(BaseModel):
    lesson_content: str = Field(..., min_length=5)
    num_questions: int = Field(default=5, ge=1, le=20)
    variation_seed: int | None = Field(default=None)
    bloom_level: str | None = Field(default="mix")
    custom_instruction: str | None = Field(default="")


class QuizQuestion(BaseModel):
    id: str
    question: str
    options: list[str]
    correct_answer: str
    explanation: str
    explanations: dict[str, str] = Field(default_factory=dict)
    restudy_hint: str = Field(default="") # Hint for what section to re-read if wrong
    type: str
    chapter: str = Field(default="")
    topic: str = Field(default="")
    difficulty: str = Field(default="")


class GenerateQuizResponse(BaseModel):
    questions: list[QuizQuestion]
    variation_seed: int


# ── Question-type definitions ─────────────────────────────────────────────────

_Q_TYPES = {
    "knowledge":     "Nhận biết (Knowledge): Tập trung vào Khái niệm, Thuật ngữ, Vai trò, Định nghĩa.",
    "comprehension": "Thông hiểu (Comprehension): Tập trung vào Giải thích, Mục đích, Ý nghĩa, Nguyên nhân.",
    "application":   "Vận dụng (Application): Tập trung vào Áp dụng tình huống, Thực hiện quy trình.",
    "analysis":      "Vận dụng cao (Analysis): Tập trung vào So sánh, Đánh giá, Lựa chọn giải pháp, Phân tích tình huống phức tạp.",
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
- CHUẨN HÓA THUẬT NGỮ CHUYÊN NGÀNH: Giữ nguyên các thuật ngữ chuyên ngành CNTT và Scrum Guide bằng tiếng Anh như "Scrum Master", "Product Owner", "Sprint", "Increment", "Backlog", "User Story", v.v. Không được dịch gượng ép sang tiếng Việt (tránh dịch máy không tự nhiên). Sử dụng các thuật ngữ quen thuộc trong giáo trình đại học và Scrum Guide.
- Option Explanations (CRITICAL): You MUST provide a detailed explanation for each of the four choices (A, B, C, D) in Vietnamese in the "explanations" object. Explain why the correct option is correct, and point out the specific logical flaw or error in understanding for each incorrect option. Do not genericize; be specific to each choice.
- General Explanation: Provide a 1-2 sentence overall explanation in the "explanation" field (usually explaining why the correct answer is right) for backward compatibility.
- Restudy Hint: Identify the specific section or concept name from the lesson that the student should review if they fail this question (e.g., "Mục 2.1: Cách hoạt động của RAM").
- Topic Field (CRITICAL): Identify the exact heading text (e.g., "2.3.1 Thuật ngữ và Vai trò trong Scrum" or "2.3 Scrum Roles") from the LESSON CONTENT that this question belongs to. Output it in the "topic" field.
- Chapter Field (CRITICAL): Identify which chapter or major heading (e.g., "Chương 2. Scrum Framework" or "Chương 1. Tổng quan") from the LESSON CONTENT this question belongs to. Output it in the "chapter" field.

OUTPUT: Return ONLY valid JSON, no markdown, no extra text:
{{"questions":[{{"type":"...","chapter":"...","topic":"...","question":"...","options":["A. ...","B. ...","C. ...","D. ..."],"correct_answer":"A","explanation":"...","explanations":{{"A":"...","B":"...","C":"...","D":"..."}},"restudy_hint":"..."}}]}}

LESSON CONTENT:
{content}
"""


def _detect_bloom_levels_from_instruction(instruction: str) -> list[str]:
    if not instruction:
        return []
    
    import unicodedata
    normalized = unicodedata.normalize("NFD", instruction)
    stripped = "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")
    stripped = stripped.replace("đ", "d").replace("Đ", "D").lower()
    
    detected = []
    
    if any(k in stripped for k in ["nhan biet", "nho", "knowledge"]):
        detected.append("knowledge")
    if any(k in stripped for k in ["thong hieu", "hieu", "comprehension"]):
        detected.append("comprehension")
    if any(k in stripped for k in ["ap dung", "van dung", "application"]):
        detected.append("application")
    if any(k in stripped for k in ["phan tich", "analysis"]):
        detected.append("analysis")
        
    return detected


def _build_prompt(content: str, n: int, seed: int, bloom_level: str = "mix", custom_instruction: str = "") -> str:
    type_keys = list(_Q_TYPES.keys())
    
    # Check if bloom level is explicitly mentioned in custom instruction
    detected = _detect_bloom_levels_from_instruction(custom_instruction)
    
    if detected:
        assigned = [detected[i % len(detected)] for i in range(n)]
    elif bloom_level and bloom_level.lower() in type_keys:
        assigned = [bloom_level.lower()] * n
    else:
        assigned = [type_keys[i % len(type_keys)] for i in range(n)]
        rng = random.Random(seed)
        rng.shuffle(assigned)

    counts: dict[str, int] = {}
    for t in assigned:
        counts[t] = counts.get(t, 0) + 1

    type_list = "\n".join(
        f"  [{t.upper()} x{counts.get(t, 0)}] {desc}"
        for t, desc in _Q_TYPES.items() if counts.get(t, 0) > 0
    )

    # Scale content: more questions = more context, but cap waste
    max_chars = min(10000 + n * 2000, 80000)
    
    custom_rule = f"\n- CUSTOM USER INSTRUCTION (CRITICAL): {custom_instruction}\n" if custom_instruction else ""

    return _PROMPT_TEMPLATE.format(
        n=n,
        seed=seed,
        type_list=type_list,
        content=content[:max_chars].strip(),
    ) + custom_rule


# ── JSON helpers ──────────────────────────────────────────────────────────────

def _repair_json(s: str) -> str:
    s = s.strip()
    # Find the first '{' to start parsing
    start_idx = s.find('{')
    if start_idx == -1:
        return s
    s = s[start_idx:]
    
    in_quote = False
    escape = False
    stack = []
    clean_chars = []
    
    for char in s:
        if escape:
            clean_chars.append(char)
            escape = False
            continue
        if char == '\\':
            clean_chars.append(char)
            escape = True
            continue
        if char == '"':
            in_quote = not in_quote
            clean_chars.append(char)
            continue
        
        if not in_quote:
            if char == '{':
                stack.append('}')
            elif char == '[':
                stack.append(']')
            elif char in ('}', ']'):
                if stack and stack[-1] == char:
                    stack.pop()
                else:
                    continue
        clean_chars.append(char)
        
    repaired = "".join(clean_chars)
    if in_quote:
        repaired += '"'
    while stack:
        repaired += stack.pop()
        
    return repaired


def _heal_malformed_quiz_json(s: str) -> str:
    # Repair options array that forgot to close before other question fields
    # Example: "options": [ "A. ...", "B. ...", "C. ...", "D. ...", "correct_answer": "A" ... ]
    # We find the 4th option and close the bracket.
    import re
    pattern = r'("options"\s*:\s*\[\s*(?:"(?:[^"\\]|\\.)*"\s*,\s*){3}"(?:[^"\\]|\\.)*")\s*,\s*((?:\s*"[a-zA-Z_]+"\s*:\s*(?:"(?:[^"\\]|\\.)*"|\d+|true|false|null)\s*,?)+)\s*\]'
    
    def repl(m):
        options_part = m.group(1)
        rest_part = m.group(2)
        rest_part = rest_part.rstrip().rstrip(',')
        return f"{options_part}\n      ],\n      {rest_part}"
        
    return re.sub(pattern, repl, s)


def _extract_json(raw: str) -> dict:
    cleaned = re.sub(r"```(?:json)?", "", raw, flags=re.IGNORECASE).strip().strip("`").strip()
    cleaned = _heal_malformed_quiz_json(cleaned)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass
    
    # Try self-healing JSON repair
    try:
        repaired = _repair_json(cleaned)
        return json.loads(repaired)
    except Exception:
        pass
        
    match = re.search(r"\{.*\}", cleaned, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass
    logger.error("Failed to parse JSON. Raw LLM response was:\n%s", raw)
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


def _call_llm_sync(prompt: str, n: int) -> str:
    """Sync LLM call — runs in thread pool via asyncio.to_thread."""
    # Scale output budget: ~500 tokens/question overhead for detailed Vietnamese explanations
    max_output = min(1500 + n * 500, 8192)
    raw_text, _ = rag_pipeline._generate_content_with_failover(
        prompt,
        temperature=0.65,
        max_output_tokens=max_output,
        response_mime_type="application/json",
    )
    return raw_text


async def _call_llm(lesson_content: str, num_questions: int, seed: int, bloom_level: str = "mix", custom_instruction: str = "") -> list[dict]:
    attempts = 3
    last_exc = None
    current_seed = seed
    
    for attempt in range(1, attempts + 1):
        try:
            prompt = _build_prompt(lesson_content, num_questions, current_seed, bloom_level, custom_instruction)
            logger.info("Calling LLM to generate quiz (attempt %d/%d, seed=%d)", attempt, attempts, current_seed)
            raw_text = await asyncio.to_thread(_call_llm_sync, prompt, num_questions)
            parsed = _extract_json(raw_text)
            questions = parsed.get("questions", [])
            if not isinstance(questions, list):
                raise ValueError("LLM returned non-list questions")
            return questions
        except Exception as exc:
            last_exc = exc
            logger.warning(
                "Quiz generation attempt %d failed: %s. Retrying with new seed...",
                attempt,
                exc
            )
            # Change seed so LLM outputs a different response next time
            current_seed = (current_seed + random.randint(1, 1000)) % 10000
            if attempt < attempts:
                await asyncio.sleep(1.5)
                
    logger.error("All %d attempts to generate quiz failed.", attempts)
    raise last_exc

# ── Endpoint ──────────────────────────────────────────────────────────────────

def _call_llm_analyze_sync(content: str) -> str:
    prompt = f"""\
You are an expert educational content analyzer.
Analyze the following lesson content to suggest the optimal number of multiple-choice questions for a quiz.
Consider:
1. The number of distinct core concepts.
2. The complexity of the material.
Usually, 1-2 questions per core concept is ideal. Max 20 questions. Min 3 questions.

OUTPUT FORMAT: Return ONLY valid JSON in this exact structure, no markdown, no extra text:
{{"suggested_count": 8, "complexity": "Medium", "reasoning": "Tài liệu chứa 4 khái niệm chính..."}}

LESSON CONTENT:
{content[:6000]}
"""
    raw_text, _ = rag_pipeline._generate_content_with_failover(
        prompt,
        temperature=0.3,
        max_output_tokens=400,
        response_mime_type="application/json",
    )
    return raw_text

@router.post("/analyze-content", response_model=AnalyzeContentResponse)
async def analyze_content(body: AnalyzeContentRequest):
    """Analyze lesson content to suggest quiz configuration."""
    try:
        raw_text = await asyncio.to_thread(_call_llm_analyze_sync, body.lesson_content)
        parsed = _extract_json(raw_text)
        return AnalyzeContentResponse(
            suggested_count=max(3, min(20, int(parsed.get("suggested_count", 5)))),
            complexity=str(parsed.get("complexity", "Medium")),
            reasoning=str(parsed.get("reasoning", ""))
        )
    except Exception as exc:
        logger.error("Quiz analysis failed: %s", exc)
        word_count = len(body.lesson_content.split())
        suggested = max(3, min(20, int(word_count / 100)))
        return AnalyzeContentResponse(
            suggested_count=suggested,
            complexity="Unknown",
            reasoning="Phân tích dựa trên độ dài (tính năng AI đang bận)."
        )

def _normalize_heading_key(text: str) -> str:
    if not text:
        return ""
    import unicodedata
    text = text.lower()
    normalized = unicodedata.normalize("NFD", text)
    stripped = "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")
    stripped = stripped.replace("đ", "d").replace("Đ", "D")
    stripped = re.sub(r'[^a-z0-9\s]', ' ', stripped)
    return " ".join(stripped.split())


def _extract_heading_number(text: str) -> str | None:
    text_clean = text.strip()
    # 1. Match "Chương 2", "Chuong 2", "Chapter 2", "Phần 1", "Phan A"
    m = re.match(r'^(?:chương|chuong|chapter|phần|phan|part)\s+(\w+)', text_clean, re.IGNORECASE)
    if m:
        return m.group(1)
    # 2. Match standard section numbering like "2.3.1", "2.3"
    m = re.match(r'^(\d+(?:\.\d+)*)', text_clean)
    if m:
        return m.group(1).rstrip('.')
    return None


def parse_heading_tree(markdown_text: str) -> dict:
    tree = {}
    header_pattern = re.compile(r'^(#{1,6})\s+(.*)$')
    
    # Step 1: Collect all headings and their heading numbers
    headings = []
    for line in markdown_text.splitlines():
        line = line.strip()
        match = header_pattern.match(line)
        if match:
            level = len(match.group(1))
            heading_text = match.group(2).strip().rstrip('#').strip()
            num_seq = _extract_heading_number(heading_text)
            headings.append({
                "raw_text": heading_text,
                "level": level,
                "num_seq": num_seq,
                "norm_key": _normalize_heading_key(heading_text)
            })
            
    # Map of heading numbers to their raw texts for hierarchy resolution
    num_to_text = {}
    for h in headings:
        if h["num_seq"]:
            num_to_text[h["num_seq"]] = h["raw_text"]
            
    # Step 2: Build parent/ancestors list for each heading
    for i, h in enumerate(headings):
        ancestors = []
        
        # Method A: Numeric sequence prefix match (extremely robust against random document orders)
        if h["num_seq"]:
            parts = h["num_seq"].split(".")
            for length in range(1, len(parts)):
                parent_seq = ".".join(parts[:length])
                if parent_seq in num_to_text:
                    ancestors.append(num_to_text[parent_seq])
                    
        # Method B: Text-level sequential fallback (for unnumbered headings)
        if not ancestors:
            temp_headers = {}
            for prev_h in headings[:i]:
                temp_headers[prev_h["level"]] = prev_h["raw_text"]
                for l in list(temp_headers.keys()):
                    if l > prev_h["level"]:
                        del temp_headers[l]
            ancestors = [temp_headers[l] for l in sorted(temp_headers.keys()) if l < h["level"]]
            
        tree[h["norm_key"]] = {
            "raw_text": h["raw_text"],
            "level": h["level"],
            "ancestors": ancestors
        }
    return tree


def is_chapter_heading(text: str) -> bool:
    text_clean = text.strip()
    if re.match(r'^(chương|chuong|chapter|phần|phan|part)\b', text_clean, re.IGNORECASE):
        return True
    if re.match(r'^\d+(\.|\s)\s*[^\d\.]', text_clean):
        return True
    if re.match(r'^\d+\s*$', text_clean):
        return True
    return False


def find_closest_heading(raw_text: str, tree: dict) -> str | None:
    if not tree:
        return None
    
    norm_raw = _normalize_heading_key(raw_text)
    if not norm_raw:
        return None
        
    if norm_raw in tree:
        return norm_raw
        
    best_key = None
    best_score = 0.0
    raw_words = set(norm_raw.split())
    
    for key in tree.keys():
        if norm_raw in key or key in norm_raw:
            key_words = set(key.split())
            intersection = raw_words.intersection(key_words)
            union = raw_words.union(key_words)
            score = len(intersection) / len(union) if union else 0.0
            score += 0.5
            if score > best_score:
                best_score = score
                best_key = key
                
    if not best_key:
        for key in tree.keys():
            key_words = set(key.split())
            intersection = raw_words.intersection(key_words)
            union = raw_words.union(key_words)
            score = len(intersection) / len(union) if union else 0.0
            if score > best_score and score >= 0.2:
                best_score = score
                best_key = key
                
    return best_key


def determine_chapter_topic(matched_key: str, tree: dict) -> tuple[str, str]:
    node = tree[matched_key]
    path = node["ancestors"] + [node["raw_text"]]
    
    chapter = None
    for heading in path:
        if is_chapter_heading(heading):
            chapter = heading
            break
            
    if not chapter:
        chapter = path[0]
        
    topic = path[-1]
    
    if len(path) > 1 and chapter == topic:
        chapter_candidates = [h for h in node["ancestors"] if is_chapter_heading(h)]
        if chapter_candidates:
            chapter = chapter_candidates[0]
        else:
            chapter = node["ancestors"][0]
            
    return chapter, topic


@router.post("/generate-quiz", response_model=GenerateQuizResponse)
async def generate_quiz(body: GenerateQuizRequest):
    """Generate diverse academic MCQ quiz using Gemini (non-blocking)."""
    seed = body.variation_seed if body.variation_seed is not None else int(time.time()) % 10000
    
    logger.info("[QUIZ_MAPPING] lesson_content length=%d, first 500 chars: %r", len(body.lesson_content), body.lesson_content[:500])

    try:
        raw_questions = await _call_llm(
            body.lesson_content, 
            body.num_questions, 
            seed,
            body.bloom_level,
            body.custom_instruction
        )
    except Exception as exc:
        logger.error("Quiz LLM failed (seed=%d): %s", seed, exc, exc_info=True)
        raise HTTPException(status_code=502, detail=MSG.quiz.llm_failed)

    # Pre-parse heading tree from lesson content to mapping parent chapters
    heading_tree = parse_heading_tree(body.lesson_content)

    questions: list[QuizQuestion] = []
    for raw in raw_questions:
        if not _validate(raw):
            logger.warning("Skipping invalid question: %s", str(raw)[:120])
            continue
        q_type = str(raw.get("type", "knowledge")).lower().strip()
        if q_type not in _VALID_TYPES:
            q_type = "knowledge"
        
        # Parse or fallback explanations
        raw_exps = raw.get("explanations", {})
        if not isinstance(raw_exps, dict):
            raw_exps = {}
        exps = {}
        for choice in ["A", "B", "C", "D"]:
            val = raw_exps.get(choice) or raw_exps.get(choice.lower()) or raw["explanation"]
            exps[choice] = str(val).strip()

        # Map chapter and topic using the heading tree
        raw_chapter = str(raw.get("chapter") or "").strip()
        raw_topic = str(raw.get("topic") or "").strip()
        
        chapter_mapped = raw_chapter
        topic_mapped = raw_topic
        
        logger.info("[QUIZ_MAPPING] raw_chapter=%r, raw_topic=%r", raw_chapter, raw_topic)
        logger.info("[QUIZ_MAPPING] heading_tree_keys=%r", list(heading_tree.keys()) if heading_tree else [])
        
        if heading_tree:
            matched_key = None
            if raw_topic:
                matched_key = find_closest_heading(raw_topic, heading_tree)
                logger.info("[QUIZ_MAPPING] matched_key by raw_topic=%r", matched_key)
            if not matched_key and raw_chapter:
                matched_key = find_closest_heading(raw_chapter, heading_tree)
                logger.info("[QUIZ_MAPPING] matched_key by raw_chapter=%r", matched_key)
                
            if matched_key:
                chapter_mapped, topic_mapped = determine_chapter_topic(matched_key, heading_tree)
                logger.info("[QUIZ_MAPPING] chapter_mapped=%r, topic_mapped=%r from matched_key", chapter_mapped, topic_mapped)
            else:
                first_key = list(heading_tree.keys())[0] if heading_tree else None
                if first_key:
                    chapter_mapped, _ = determine_chapter_topic(first_key, heading_tree)
                else:
                    if not chapter_mapped:
                        chapter_mapped = "Chương chung"
                if not topic_mapped:
                    topic_mapped = raw_topic if raw_topic else "Chung"
        else:
            if not chapter_mapped:
                chapter_mapped = "Chương chung"
            if not topic_mapped:
                topic_mapped = raw_topic if raw_topic else "Chung"

        # Determine difficulty based on Bloom Level (q_type)
        difficulty_map = {
            "knowledge": "Dễ",
            "comprehension": "Trung bình",
            "application": "Khó",
            "analysis": "Nâng cao"
        }
        difficulty = difficulty_map.get(q_type, "Dễ")

        questions.append(QuizQuestion(
            id=f"q{len(questions) + 1}",
            question=raw["question"].strip(),
            options=[str(o).strip() for o in raw["options"]],
            correct_answer=raw["correct_answer"].upper().strip(),
            explanation=raw["explanation"].strip(),
            explanations=exps,
            restudy_hint=str(raw.get("restudy_hint", "")).strip(),
            type=q_type,
            chapter=chapter_mapped,
            topic=topic_mapped,
            difficulty=difficulty
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
