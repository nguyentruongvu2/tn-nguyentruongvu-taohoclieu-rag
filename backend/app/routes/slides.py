"""Slide generation route — Production-grade.

POST /api/slides/generate-outline  -> section-aware JSON outline (LLM)
POST /api/slides/download-pptx     -> .pptx binary (python-pptx)
GET  /api/slides/health            -> python-pptx availability probe

Design principles (Reynolds "Presentation Zen" + Duarte "slide:ology"):
  - Assertion-Evidence titles: title = key claim, bullets = supporting evidence
  - One idea per slide
  - Section-aware: lesson headers drive slide count distribution
  - Speaker notes add context, never repeat bullets
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import os
import uuid
import shutil
from typing import List
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Request, Response, UploadFile, File
from pydantic import BaseModel, Field, field_validator

from ..rag_pipeline import rag_pipeline
from ..auth_db import save_slide_draft, load_slide_draft
from ..services.slide_renderers import (
    pptx_renderer, pdf_renderer,
    PPTX_OK, PPTX_ERROR, PDF_OK, PDF_ERROR,
    make_download_headers,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/slides", tags=["slides"])


# ── Pydantic models ───────────────────────────────────────────────────────────

class SlideItem(BaseModel):
    title: str = Field(..., min_length=1, max_length=150)
    bullet_points: List[str] = Field(..., min_length=1)
    speaker_notes: str = Field(default="")
    visual_prompt: str = Field(default="")  # AI-suggested image/diagram idea for this slide
    talking_points: List[str] = Field(default_factory=list) # What the teacher should say
    estimated_duration: int = Field(default=60) # Estimated time in seconds

    @field_validator("bullet_points")
    @classmethod
    def clean_bullets(cls, v: List[str]) -> List[str]:
        cleaned = []
        for b in v:
            text = b.strip()
            if not text:
                continue
            # Force summarizing bullet to be short (max ~15 words)
            words = text.split()
            if len(words) > 15:
                text = " ".join(words[:15]) + "..."
            cleaned.append(text)
        if not cleaned:
            raise ValueError("bullet_points cannot be empty")
        return cleaned


class SlideSchema(BaseModel):
    slides: List[SlideItem] = Field(..., min_length=1)


class GenerateOutlineRequest(BaseModel):
    lesson_content: str = Field(..., min_length=30)
    num_slides: int = Field(default=8, ge=3, le=25)


class GenerateOutlineResponse(BaseModel):
    slides: List[SlideItem]
    total: int


class DownloadPptxRequest(BaseModel):
    slides: List[SlideItem]
    title: str = Field(default="Bài giảng")
    template_path: str | None = Field(default=None)


class DownloadPdfRequest(BaseModel):
    slides: List[SlideItem]
    title: str = Field(default="Bài giảng")


# ── Section-aware content parser ─────────────────────────────────────────────

def _parse_sections(content: str) -> list[dict]:
    """
    Extract markdown sections from lesson content.
    Returns [{title, body, weight}] where weight = word count of body.
    Used to distribute slides proportionally across lesson sections.
    """
    # Match # Heading or ## Heading or numbered "1. Title"
    header_re = re.compile(r"^(#{1,3}\s+.+|[0-9]+\.\s+[A-ZÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚÝĂĐƠƯ].+)$", re.MULTILINE)
    positions = [(m.start(), m.group().strip()) for m in header_re.finditer(content)]

    if not positions:
        return [{"title": "Nội dung chính", "body": content, "weight": len(content.split())}]

    sections = []
    for i, (pos, heading) in enumerate(positions):
        end = positions[i + 1][0] if i + 1 < len(positions) else len(content)
        body = content[pos + len(heading):end].strip()
        sections.append({
            "title": re.sub(r"^#+\s*", "", heading).strip(),
            "body": body,
            "weight": max(len(body.split()), 1),
        })
    return sections


def _distribute_slides(sections: list[dict], total: int) -> list[dict]:
    """
    Distribute `total` content slides proportionally across sections.
    Always reserves 1 for title + 1 for summary.
    """
    content_slots = max(total - 2, len(sections))
    total_weight = sum(s["weight"] for s in sections)
    distributed = []
    assigned = 0
    for i, sec in enumerate(sections):
        if i == len(sections) - 1:
            count = content_slots - assigned  # remainder goes to last section
        else:
            count = max(1, round(sec["weight"] / total_weight * content_slots))
        assigned += count
        distributed.append({**sec, "slide_count": count})
    return distributed


# ── Prompts ───────────────────────────────────────────────────────────────────

_TITLE_SLIDE_PROMPT = """\
Generate 1 TITLE slide for a lecture presentation.
Title: "{deck_title}"
Key themes covered: {themes}

Rules:
- title: catchy hook question or bold claim (≤10 words, Vietnamese)
- bullet_points: exactly 3 items — the 3 big questions this lecture answers
- speaker_notes: 2 sentences the presenter says to open the class

Return ONLY JSON: {{"title":"...","bullet_points":["...","...","..."],"speaker_notes":"..."}}"""

_SECTION_PROMPT = """\
You are an expert academic presentation designer using the Assertion-Evidence methodology.

Analyze the section content below and generate between {min_count} and {max_count} slides.
You decide the exact number — base it on content complexity and number of distinct ideas.
Do NOT pad with extra slides just to hit the maximum.

SECTION: "{section_title}"

RULES FOR EACH SLIDE:
1. ASSERTION TITLE — state the key insight or claim the student should remember.
   ✓ "Caching giảm tải server tới 80% trong traffic cao"  ✗ "Giới thiệu về Caching"
2. EVIDENCE BULLETS (Quy tắc 6x6) — max 6 bullets, each MUST be ≤ 8 words. 
   Use keywords, facts, numbers, steps. NEVER write full sentences.
3. SPEAKER NOTES — 2–3 sentences. Add analogy, real-world example, or common misconception.
   NEVER repeat the bullets verbatim.
4. TALKING POINTS — 3-5 bullet points of a presentation script (Kịch bản thuyết trình) for the speaker.
5. ESTIMATED DURATION — integer (in seconds) for how long the slide should be presented (e.g. 60, 90, 120).
6. VISUAL SUGGESTION — describe a specific image, diagram, or chart that would illustrate this
   slide best. Be concrete: "Sơ đồ luồng dữ liệu Client→Cache→Server" not just "Sơ đồ".
7. Language: Vietnamese. Keep technical terms (API, cache, gradient, SQL, etc.) in English.

SECTION CONTENT:
{body}

Return ONLY a valid JSON array (no wrapper object):
[
  {{
    "title": "[Assertion — key claim in ≤12 words]",
    "bullet_points": ["[Fact/step ≤10 words]", "..."],
    "speaker_notes": "[2–3 sentences for the presenter]",
    "talking_points": ["[Script point 1]", "[Script point 2]", "..."],
    "estimated_duration": 60,
    "visual_prompt": "[Concrete image or diagram suggestion in Vietnamese]"
  }},
  ...
]"""

_SUMMARY_PROMPT = """\
Generate 1 SUMMARY slide for a lecture on: "{deck_title}"

Sections covered: {sections_list}

Rules:
- title: "Tổng kết: [key insight in ≤8 words]"
- bullet_points: exactly 4 action-oriented takeaways students should remember
  Format: "Hiểu được / Áp dụng được / Nhận biết được / Phân biệt được ..."
- speaker_notes: 2 sentences encouraging students to review and apply knowledge

Return ONLY JSON: {{"title":"...","bullet_points":["...","...","...","..."],"speaker_notes":"..."}}"""


# ── LLM helpers ───────────────────────────────────────────────────────────────

def _llm_sync(prompt: str, max_tokens: int = 1200) -> str:
    text, _ = rag_pipeline._generate_content_with_failover(
        prompt,
        temperature=0.3,
        max_output_tokens=max_tokens,
    )
    return text


def _extract_json_object(raw: str) -> dict:
    cleaned = re.sub(r"```(?:json)?", "", raw, flags=re.IGNORECASE).strip().strip("`").strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if m:
            return json.loads(m.group())
    raise ValueError("No JSON object found in LLM output")


def _extract_json_array(raw: str) -> list:
    cleaned = re.sub(r"```(?:json)?", "", raw, flags=re.IGNORECASE).strip().strip("`").strip()
    try:
        result = json.loads(cleaned)
        # Model might return {"slides": [...]} or just [...]
        if isinstance(result, list):
            return result
        if isinstance(result, dict):
            for key in ("slides", "slide", "items"):
                if isinstance(result.get(key), list):
                    return result[key]
    except json.JSONDecodeError:
        pass
    m = re.search(r"\[.*\]", cleaned, re.DOTALL)
    if m:
        return json.loads(m.group())
    raise ValueError("No JSON array found in LLM output")


async def _gen_title_slide(deck_title: str, section_titles: list[str]) -> SlideItem:
    themes = ", ".join(section_titles[:5])
    prompt = _TITLE_SLIDE_PROMPT.format(deck_title=deck_title, themes=themes)
    raw = await asyncio.to_thread(_llm_sync, prompt, 400)
    data = _extract_json_object(raw)
    return SlideItem.model_validate(data)


async def _gen_section_slides(section: dict) -> list[SlideItem]:
    """Call LLM with a slide range — LLM decides exact count based on content complexity."""
    body_truncated = section["body"][:2800]  # slightly more context for better decisions
    min_count = section["min_count"]
    max_count = section["max_count"]
    prompt = _SECTION_PROMPT.format(
        min_count=min_count,
        max_count=max_count,
        section_title=section["title"],
        body=body_truncated,
    )
    # Token budget: enough for max_count slides with visual_prompt field
    tokens = min(400 + max_count * 450, 3200)
    raw = await asyncio.to_thread(_llm_sync, prompt, tokens)
    items = _extract_json_array(raw)
    # Enforce hard cap at max_count to prevent runaway
    return [SlideItem.model_validate(it) for it in items[:max_count]]


async def _gen_summary_slide(deck_title: str, section_titles: list[str]) -> SlideItem:
    sections_list = " | ".join(section_titles)
    prompt = _SUMMARY_PROMPT.format(deck_title=deck_title, sections_list=sections_list)
    raw = await asyncio.to_thread(_llm_sync, prompt, 400)
    data = _extract_json_object(raw)
    return SlideItem.model_validate(data)


def _split_long_slides(slides: list[SlideItem]) -> list[SlideItem]:
    new_slides = []
    for slide in slides:
        if len(slide.bullet_points) > 5:
            bullets = slide.bullet_points
            for i in range(0, len(bullets), 5):
                chunk = bullets[i:i+5]
                title = slide.title if i == 0 else f"{slide.title} (tiếp theo)"
                notes = slide.speaker_notes if i == 0 else ""
                # Preserve visual_prompt on first chunk only
                visual = slide.visual_prompt if i == 0 else ""
                new_slides.append(SlideItem(
                    title=title,
                    bullet_points=chunk,
                    speaker_notes=notes,
                    visual_prompt=visual,
                ))
        else:
            new_slides.append(slide)
    return new_slides


async def _build_outline(lesson_content: str, num_slides: int, deck_title: str) -> list[SlideItem]:
    """
    Content-driven pipeline:
      1. Parse lesson into sections (by markdown headers)
      2. Assign a RANGE [min, max] of slides per section based on content weight
         — LLM decides exact count within that range
      3. Call LLM in parallel for each section
      4. Stitch: title slide | section slides | summary slide
    """
    sections = _parse_sections(lesson_content)
    content_budget = max(num_slides - 2, len(sections))  # reserve 1 title + 1 summary
    total_weight = sum(max(s["weight"], 1) for s in sections)

    # Assign [min_count, max_count] ranges instead of exact counts
    sections_with_range: list[dict] = []
    assigned = 0
    for i, sec in enumerate(sections):
        if i == len(sections) - 1:
            # Last section gets remaining budget
            ideal = content_budget - assigned
        else:
            ideal = max(1, round(sec["weight"] / total_weight * content_budget))
        assigned += ideal
        # Range: allow LLM ±1 from ideal, minimum 1
        min_c = max(1, ideal - 1)
        max_c = ideal + 1
        sections_with_range.append({**sec, "min_count": min_c, "max_count": max_c})

    section_titles = [s["title"] for s in sections]

    # Run title, all sections, and summary concurrently
    title_task    = asyncio.create_task(_gen_title_slide(deck_title, section_titles))
    summary_task  = asyncio.create_task(_gen_summary_slide(deck_title, section_titles))
    section_tasks = [asyncio.create_task(_gen_section_slides(sec)) for sec in sections_with_range]

    title_slide           = await title_task
    section_slides_nested = await asyncio.gather(*section_tasks, return_exceptions=True)
    summary_slide         = await summary_task

    # Flatten section slides; skip any section that errored
    content_slides: list[SlideItem] = []
    for result in section_slides_nested:
        if isinstance(result, Exception):
            logger.warning("Section slide gen failed: %s", result)
        else:
            content_slides.extend(result)

    all_slides = [title_slide] + content_slides + [summary_slide]
    return _split_long_slides(all_slides)




# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/health")
async def slides_health():
    return {"pptx_available": PPTX_OK, "pptx_error": PPTX_ERROR if not PPTX_OK else None}


@router.post("/generate-outline", response_model=GenerateOutlineResponse)
async def generate_outline(body: GenerateOutlineRequest):
    """Section-aware slide outline generation (parallel LLM calls)."""
    # Extract a sensible deck title from the first line of lesson content
    first_line = body.lesson_content.strip().splitlines()[0]
    deck_title  = re.sub(r"^#+\s*", "", first_line).strip()[:80] or "Bài giảng"

    try:
        slides = await _build_outline(body.lesson_content, body.num_slides, deck_title)
    except Exception as exc:
        logger.error("Outline error: %s", exc, exc_info=True)
        raise HTTPException(status_code=502, detail=f"Lỗi tạo nội dung slide: {exc}")

    return GenerateOutlineResponse(slides=slides, total=len(slides))


@router.post("/upload-template")
async def upload_template(file: UploadFile = File(...)):
    """Upload custom PPTX template for slide generation."""
    if not file.filename or not file.filename.lower().endswith(".pptx"):
        raise HTTPException(status_code=400, detail="Chỉ hỗ trợ upload file mẫu định dạng .pptx")
    
    upload_dir = os.path.join(os.path.dirname(__file__), '../../uploads/templates')
    os.makedirs(upload_dir, exist_ok=True)
    
    file_id = uuid.uuid4().hex
    file_path = os.path.join(upload_dir, f"{file_id}.pptx")
    
    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as exc:
        logger.error("Template upload error: %s", exc)
        raise HTTPException(status_code=500, detail="Không thể lưu file template.")
        
    return {"success": True, "template_path": file_path, "filename": file.filename}


@router.post("/download-pptx")
async def download_pptx(body: DownloadPptxRequest):
    """Slide JSON → .pptx bytes."""
    if not body.slides:
        raise HTTPException(status_code=400, detail="Không có slide để xuất.")
    if not PPTX_OK:
        raise HTTPException(status_code=503, detail=f"python-pptx chưa sẵn sàng: {PPTX_ERROR}")
    try:
        pptx_bytes = await asyncio.to_thread(pptx_renderer.generate, body.slides, body.title, body.template_path)
        if not pptx_bytes or len(pptx_bytes) < 100:
            raise ValueError("Render produced empty file")
        return Response(
            content=pptx_bytes,
            media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
            headers=make_download_headers(body.title, "pptx", len(body.slides)),
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("PPTX render: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Lỗi xuất file PPTX: {exc}")


@router.post("/download-pdf")
async def download_pdf(body: DownloadPdfRequest):
    """Slide JSON → .pdf bytes."""
    if not body.slides:
        raise HTTPException(status_code=400, detail="Không có slide để xuất.")
    if not PDF_OK:
        raise HTTPException(status_code=503, detail=f"reportlab chưa sẵn sàng: {PDF_ERROR}")
    try:
        pdf_bytes = await asyncio.to_thread(pdf_renderer.generate, body.slides, body.title)
        if not pdf_bytes or len(pdf_bytes) < 200:
            raise ValueError("PDF render produced empty file")
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers=make_download_headers(body.title, "pdf", len(body.slides)),
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("PDF render: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Lỗi xuất PDF: {exc}")


# ── Slide Draft Persistence ──────────────────────────────────────────────────────────────

class SaveDraftRequest(BaseModel):
    project_id: str = Field(..., min_length=1)
    title:      str = Field(default="")
    slides:     List[SlideItem]
    layouts:    dict = Field(default_factory=dict)


class SaveDraftResponse(BaseModel):
    id: int
    slide_count: int
    saved_at: str


@router.post("/save-draft", response_model=SaveDraftResponse)
async def save_draft_endpoint(body: SaveDraftRequest, request: Request):
    """Save slide deck to DB (overwrites previous draft for same project+user)."""
    auth_user = getattr(request.state, "auth_user", None)
    user_id   = int(auth_user["id"]) if auth_user else None
    try:
        slides_raw = [s.model_dump() for s in body.slides]
        result = await asyncio.to_thread(
            save_slide_draft,
            project_id=body.project_id,
            title=body.title,
            slides=slides_raw,
            layouts={str(k): v for k, v in body.layouts.items()},
            user_id=user_id,
        )
        return SaveDraftResponse(**result)
    except Exception as exc:
        logger.error("save_draft: %s", exc)
        raise HTTPException(status_code=500, detail=f"Lưu draft thất bại: {exc}")


@router.get("/load-draft/{project_id}")
async def load_draft_endpoint(project_id: str, request: Request):
    """Load latest saved slide draft for a project."""
    auth_user = getattr(request.state, "auth_user", None)
    user_id   = int(auth_user["id"]) if auth_user else None
    try:
        draft = await asyncio.to_thread(load_slide_draft, project_id=project_id, user_id=user_id)
        if not draft:
            return {"found": False, "slides": [], "layouts": {}, "title": "", "saved_at": None}
        return {
            "found":      True,
            "id":         draft["id"],
            "title":      draft.get("title", ""),
            "slides":     draft["slides"],
            "layouts":    draft["layouts"],
            "slide_count": draft.get("slide_count", len(draft["slides"])),
            "saved_at":   draft.get("saved_at", ""),
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
