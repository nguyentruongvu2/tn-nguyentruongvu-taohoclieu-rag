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
from typing import List, Optional
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

class DiagramNode(BaseModel):
    id: str
    label: str
    x: Optional[float] = None
    y: Optional[float] = None

class DiagramLink(BaseModel):
    source: str
    target: str
    label: str = ""

class SlideDiagram(BaseModel):
    nodes: List[DiagramNode] = Field(default_factory=list)
    links: List[DiagramLink] = Field(default_factory=list)

class SlideItem(BaseModel):
    title: str = Field(..., min_length=1, max_length=150)
    bullet_points: List[str] = Field(..., min_length=1)
    speaker_notes: str = Field(default="")
    visual_prompt: str = Field(default="")  # AI-suggested image/diagram idea for this slide
    talking_points: List[str] = Field(default_factory=list) # What the teacher should say
    estimated_duration: int = Field(default=60) # Estimated time in seconds
    diagram: Optional[SlideDiagram] = Field(default=None)

    @field_validator("bullet_points")
    @classmethod
    def clean_bullets(cls, v: List[str]) -> List[str]:
        cleaned = []
        for b in v:
            text = b.strip()
            if not text:
                continue
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
You are an expert academic presentation designer.
Generate 1 TITLE slide for a lecture presentation based on the provided Lesson Preview and Topic.

Topic/Title: "{deck_title}"
Key themes (Sections): {themes}
Lesson Preview Content:
\"\"\"
{lesson_preview}
\"\"\"

Rules:
- title: MUST be exactly or based closely on the Topic/Title "{deck_title}" (Vietnamese, ≤12 words. Do NOT use generic placeholders like "Tiêu đề bài học" if the Lesson Preview has a more specific title).
- bullet_points: exactly 3 items — the 3 core questions this specific lecture answers, extracted directly from the actual lesson content (each item MUST be ≤ 8 words, Vietnamese).
- speaker_notes: 2 sentences the presenter says to open the class, reflecting the real topic.

Return ONLY JSON: {{"title":"...","bullet_points":["...","...","..."],"speaker_notes":"..."}}"""

_SECTION_PROMPT = """\
You are an expert academic presentation designer using the Assertion-Evidence methodology.

Analyze the section content below and generate exactly {target_count} slides.
Do NOT generate more or fewer slides than {target_count}.

SECTION: "{section_title}"

RULES FOR EACH SLIDE:
1. ASSERTION TITLE — State the key insight or claim the student should remember in Vietnamese (≤12 words).
   ✓ "Caching giảm tải server tới 80% trong traffic cao"  ✗ "Giới thiệu về Caching"
2. EVIDENCE BULLETS (Quy tắc 6x6) — max 6 bullets, each MUST be ≤ 8 words in Vietnamese.
   Use keywords, facts, numbers, steps. NEVER write full sentences. Keep them extremely short and punchy.
   * Ví dụ tồi (dài dòng, nhiều chữ): "Bộ nhớ cache giúp tối ưu tốc độ bằng cách lưu trữ tạm thời dữ liệu thường truy cập." (16 từ)
   * Ví dụ tốt (ngắn gọn): "Lưu tạm dữ liệu truy cập nhiều" (7 từ)
   * Ví dụ tồi: "Giảm tải cho cơ sở dữ liệu và tăng trải nghiệm người dùng cuối tốt hơn." (14 từ)
   * Ví dụ tốt: "Giảm tải database, tăng trải nghiệm" (6 từ)
3. SPEAKER NOTES — 2–3 sentences. Add analogy, real-world example, or common misconception.
   NEVER repeat the bullets verbatim.
4. TALKING POINTS — 3-5 bullet points of a presentation script (Kịch bản thuyết trình) for the speaker.
5. ESTIMATED DURATION — integer (in seconds) for how long the slide should be presented (e.g. 60, 90, 120).
6. VISUAL SUGGESTION (visual_prompt) & DIAGRAM (diagram) — Describe a specific flowchart, diagram, layout, or chart that illustrates this slide best.
   If the slide's visual prompt can be represented structurally as a flowchart or pipeline, you MUST also generate a structured "diagram" object.
   The "diagram" object must contain:
   - "nodes": a list of components, each with "id" (short unique ID like "A", "B", "C") and "label" (brief Vietnamese name, ≤4 words).
   - "links": a list of connections, each with "source" (source node ID), "target" (target node ID), and optional "label" (brief description of connection, ≤3 words).
   If the slide does NOT require a diagram or flowchart (e.g. simple list of facts), set "diagram" to null.
   ✓ "Sơ đồ gồm 3 khối hộp ngang: Client → Cache → Server. Mũi tên 2 chiều giữa Client và Cache thể hiện truy vấn nhanh; mũi tên đứt đoạn từ Cache đến Server thể hiện đồng bộ định kỳ."
   ✗ "Hình ảnh minh họa cache" hoặc "Sơ đồ luồng"
7. Language: Vietnamese. Keep technical terms (API, cache, gradient, SQL, etc.) in English.

SECTION CONTENT:
{body}

Return ONLY a valid JSON array (no wrapper object):
[
  {{
    "title": "[Assertion — key claim in ≤12 words]",
    "bullet_points": ["[Fact/step ≤8 words]", "..."],
    "speaker_notes": "[2–3 sentences for the presenter]",
    "talking_points": ["[Script point 1]", "[Script point 2]", "..."],
    "estimated_duration": 60,
    "visual_prompt": "[Descriptive structure of flowchart or diagram in Vietnamese]",
    "diagram": {{
      "nodes": [
        {{"id": "A", "label": "Client"}},
        {{"id": "B", "label": "Cache"}},
        {{"id": "C", "label": "Server"}}
      ],
      "links": [
        {{"source": "A", "target": "B", "label": "Gửi yêu cầu"}},
        {{"source": "B", "target": "C", "label": "Miss cache"}}
      ]
    }}
  }},
  ...
]"""

_SUMMARY_PROMPT = """\
You are an expert academic presentation designer.
Generate 1 SUMMARY slide for a lecture presentation based on the Lesson Preview.

Topic/Title: "{deck_title}"
Sections covered: {sections_list}
Lesson Preview Content:
\"\"\"
{lesson_preview}
\"\"\"

Rules:
- title: "Tổng kết: [key insight from the lesson in ≤8 words, Vietnamese]"
- bullet_points: exactly 4 action-oriented takeaways students should remember, based on the actual lesson content. Each bullet point MUST be ≤ 8 words, Vietnamese.
  Format: "Hiểu được [khái niệm] / Áp dụng được [kỹ năng] / Nhận biết được [đặc điểm] / Phân biệt được [phân loại]..."
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


async def _gen_title_slide(deck_title: str, section_titles: list[str], lesson_preview: str) -> SlideItem:
    try:
        themes = ", ".join(section_titles[:5])
        prompt = _TITLE_SLIDE_PROMPT.format(deck_title=deck_title, themes=themes, lesson_preview=lesson_preview)
        raw = await asyncio.to_thread(_llm_sync, prompt, 400)
        data = _extract_json_object(raw)
        return SlideItem.model_validate(data)
    except Exception as exc:
        logger.warning("Failed to generate title slide via LLM, using fallback: %s", exc)
        return SlideItem(
            title=deck_title[:150] or "Bài giảng",
            bullet_points=["Giới thiệu nội dung bài học", "Các chủ đề chính", "Mục tiêu học tập"],
            speaker_notes="Chào mừng các bạn đến với buổi học hôm nay. Chúng ta sẽ cùng nhau tìm hiểu về chủ đề này.",
            talking_points=["Giới thiệu giảng viên và môn học", "Tổng quan nội dung chính"],
            estimated_duration=60,
        )


async def _gen_section_slides(section: dict) -> list[SlideItem]:
    """Call LLM to generate exactly target_count slides."""
    target_count = section["target_count"]
    try:
        body_truncated = section["body"][:2800]  # slightly more context for better decisions
        prompt = _SECTION_PROMPT.format(
            target_count=target_count,
            section_title=section["title"],
            body=body_truncated,
        )
        # Token budget: enough for target_count slides with visual_prompt field
        tokens = min(400 + target_count * 450, 3200)
        raw = await asyncio.to_thread(_llm_sync, prompt, tokens)
        items = _extract_json_array(raw)
        # Enforce hard cap at target_count to prevent runaway
        return [SlideItem.model_validate(it) for it in items[:target_count]]
    except Exception as exc:
        logger.warning("Failed to generate slides for section '%s', using fallback: %s", section["title"], exc)
        # Generate target_count simple fallback slides
        fallbacks = []
        for i in range(target_count):
            suffix = f" (phần {i+1})" if target_count > 1 else ""
            fallbacks.append(SlideItem(
                title=f"{section['title']}{suffix}",
                bullet_points=["Xem chi tiết nội dung trong tài liệu học tập", "Tìm hiểu các khái niệm liên quan", "Thực hành bài tập vận dụng"],
                speaker_notes=f"Chúng ta sẽ đi qua nội dung phần {section['title']}. Hãy theo dõi tài liệu và slide.",
                talking_points=[f"Giới thiệu chủ đề {section['title']}"],
                estimated_duration=90,
            ))
        return fallbacks


async def _gen_summary_slide(deck_title: str, section_titles: list[str], lesson_preview: str) -> SlideItem:
    try:
        sections_list = " | ".join(section_titles)
        prompt = _SUMMARY_PROMPT.format(deck_title=deck_title, sections_list=sections_list, lesson_preview=lesson_preview)
        raw = await asyncio.to_thread(_llm_sync, prompt, 400)
        data = _extract_json_object(raw)
        return SlideItem.model_validate(data)
    except Exception as exc:
        logger.warning("Failed to generate summary slide via LLM, using fallback: %s", exc)
        return SlideItem(
            title="Tổng kết bài học",
            bullet_points=["Tóm tắt kiến thức cốt lõi đã học", "Ôn tập các khái niệm quan trọng", "Áp dụng kiến thức vào thực tế", "Giải đáp thắc mắc của người học"],
            speaker_notes="Như vậy chúng ta đã kết thúc bài học hôm nay. Các bạn hãy dành thời gian ôn tập và thực hành thêm nhé.",
            talking_points=["Tóm tắt các ý chính", "Dặn dò ôn tập và bài tập về nhà"],
            estimated_duration=120,
        )


def _split_long_slides(slides: list[SlideItem]) -> list[SlideItem]:
    new_slides = []
    for slide in slides:
        if len(slide.bullet_points) > 6:
            bullets = slide.bullet_points
            for i in range(0, len(bullets), 6):
                chunk = bullets[i:i+6]
                title = slide.title if i == 0 else f"{slide.title} (tiếp theo)"
                notes = slide.speaker_notes if i == 0 else ""
                visual = slide.visual_prompt if i == 0 else ""
                diagram = slide.diagram if i == 0 else None
                new_slides.append(SlideItem(
                    title=title,
                    bullet_points=chunk,
                    speaker_notes=notes,
                    visual_prompt=visual,
                    diagram=diagram,
                ))
        else:
            new_slides.append(slide)
    return new_slides


def validate_slide_diagram(slide: SlideItem) -> SlideItem:
    if not slide.diagram:
        return slide
        
    # 1. Clean nodes: remove duplicates, limit to max 5
    seen_ids = set()
    valid_nodes = []
    for node in slide.diagram.nodes:
        node.id = node.id.strip().upper()
        node.label = node.label.strip()
        if node.id and node.label and node.id not in seen_ids and len(valid_nodes) < 5:
            seen_ids.add(node.id)
            valid_nodes.append(node)
            
    # 2. Clean links: source and target must be in seen_ids, no self-loops, no duplicates
    seen_links = set()
    valid_links = []
    for link in slide.diagram.links:
        link.source = link.source.strip().upper()
        link.target = link.target.strip().upper()
        link.label = link.label.strip()
        if link.source in seen_ids and link.target in seen_ids:
            if link.source != link.target:
                link_key = (link.source, link.target)
                if link_key not in seen_links:
                    seen_links.add(link_key)
                    valid_links.append(link)
                    
    # If we have less than 2 nodes, diagram is not meaningful
    if len(valid_nodes) < 2:
        slide.diagram = None
    else:
        slide.diagram.nodes = valid_nodes
        slide.diagram.links = valid_links
        
    return slide


def _merge_sections(sections: list[dict], target_count: int) -> list[dict]:
    """
    Merge adjacent sections until the total number of sections is target_count.
    Balances the weights (word counts) of the merged sections.
    """
    sections = [dict(s) for s in sections]  # copy
    while len(sections) > target_count:
        # Find the adjacent pair with the minimum combined weight
        min_idx = 0
        min_weight = sections[0]["weight"] + sections[1]["weight"]
        for i in range(1, len(sections) - 1):
            w = sections[i]["weight"] + sections[i + 1]["weight"]
            if w < min_weight:
                min_weight = w
                min_idx = i
        
        # Merge sections[min_idx] and sections[min_idx + 1]
        merged_body = f"{sections[min_idx]['body']}\n\n{sections[min_idx+1]['body']}"
        merged_title = f"{sections[min_idx]['title']} & {sections[min_idx+1]['title']}"
        # Truncate title if it becomes too long
        if len(merged_title) > 60:
            merged_title = merged_title[:57] + "..."
            
        sections[min_idx] = {
            "title": merged_title,
            "body": merged_body,
            "weight": sections[min_idx]["weight"] + sections[min_idx+1]["weight"]
        }
        sections.pop(min_idx + 1)
        
    return sections


def _should_exclude_section_from_slides(title: str) -> bool:
    """Check if a section should be excluded from content slides (e.g. Summary, Quiz)."""
    normalized = title.lower().strip()
    exclude_keywords = [
        "tóm tắt", "tom tat", "tổng kết", "tong ket", "summary", "conclusion", "kết luận", "ket luan",
        "câu hỏi", "cau hoi", "bài tập", "bai tap", "quiz", "trắc nghiệm", "trac nghiem", "ôn tập", "on tap"
    ]
    return any(kw in normalized for kw in exclude_keywords)


async def _build_outline(lesson_content: str, num_slides: int, deck_title: str) -> list[SlideItem]:
    """
    Content-driven pipeline:
      1. Parse lesson into sections (by markdown headers)
      2. Filter out redundant summary/quiz sections to keep slides focused
      3. If sections exceed content budget, merge them to respect slide count
      4. Assign target slides per section based on content weight
      5. Call LLM in parallel for each section
      6. Stitch: title slide | section slides | summary slide
    """
    all_sections = _parse_sections(lesson_content)
    
    # Filter out summary/quiz sections from regular content slides
    sections = [s for s in all_sections if not _should_exclude_section_from_slides(s["title"])]
    if not sections:
        sections = all_sections  # fallback if all were filtered out

    content_budget = num_slides - 2  # reserve 1 title + 1 summary
    if content_budget < 1:
        content_budget = 1

    # Merge adjacent sections if they exceed content budget
    if len(sections) > content_budget:
        sections = _merge_sections(sections, content_budget)

    total_weight = sum(max(s["weight"], 1) for s in sections)

    sections_with_target: list[dict] = []
    assigned = 0
    for i, sec in enumerate(sections):
        if i == len(sections) - 1:
            target = content_budget - assigned
        else:
            target = max(1, round(sec["weight"] / total_weight * content_budget))
        assigned += target
        sections_with_target.append({**sec, "target_count": target})

    section_titles = [s["title"] for s in sections]

    # Run title, all sections, and summary concurrently
    # Title slide only needs the beginning of the lecture (first 2500 characters)
    lesson_preview = lesson_content[:2500]

    # Construct a smart preview covering the entire document (first 2 sentences of each section) for the Summary slide
    summary_context_lines = []
    for sec in all_sections:
        sentences = [s.strip() for s in re.split(r'(?<=[.!?])\s+', sec["body"]) if s.strip()]
        preview_text = " ".join(sentences[:2])
        summary_context_lines.append(f"### Section: {sec['title']}\n{preview_text}")
    summary_preview = "\n\n".join(summary_context_lines)[:3000]

    title_task    = asyncio.create_task(_gen_title_slide(deck_title, section_titles, lesson_preview))
    summary_task  = asyncio.create_task(_gen_summary_slide(deck_title, section_titles, summary_preview))
    section_tasks = [asyncio.create_task(_gen_section_slides(sec)) for sec in sections_with_target]

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
    validated_slides = [validate_slide_diagram(s) for s in all_slides]
    return _split_long_slides(validated_slides)




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
