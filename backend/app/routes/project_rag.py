"""Project-based RAG APIs (Controller)."""
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import PlainTextResponse, Response
from typing import Any
import json
import logging
from ..security import get_current_user

# Models
from ..services.project_rag_service import (
    ProjectCreateRequest, ProjectCreateResponse, ProjectUpdateRequest,
    SectionPayload, DocumentCreateRequest, DocumentResponse, OutlineRequest,
    OutlineResponse, GenerateSectionRequest, BatchGenerateRequest,
    UpdateSectionRequest, CreateSectionRequest, GenerateProjectOutlineRequest
)

# Services
from ..services.project_rag_service import *
from ..services.project_rag_service import (
    _serialize_retrieved_chunk, _map_control_sentinel_to_user_message, _detect_structure_lock_violations, 
    _apply_structure_lock, _extract_control_sentinel, _normalize_context_text_for_llm, 
    _filter_unbounded_derived_sections, _enforce_hard_section_format, _build_download_filename_with_ext, 
    _build_context_text, _retrieve_full_section_context_with_rerank, _normalize_teaching_outline_sections, 
    _retrieve_summary_context, _fallback_section_evaluation, _merge_retrieval_results, _render_project_markdown, 
    _parse_outline_to_sections, _render_project_docx_bytes, _compact_markdown_spacing, _build_main_content_heading_anchor_prompt, 
    _strip_disallowed_section_blocks, _extract_heading_hints_from_retrieved, _strip_duplicate_section_heading, 
    _evaluate_and_save_background, _normalize_kb_ids, _retrieve_context_with_retry, _parse_section_json_response, 
    _build_source_info_from_retrieved, _build_download_filename, _strip_verification_block, _render_project_pdf_bytes, 
    _extract_verification_verdict
)

router = APIRouter(tags=["project-rag"])
logger = logging.getLogger(__name__)

@router.post("/projects", response_model=ProjectCreateResponse)
async def create_project_endpoint(
    request: ProjectCreateRequest,
    current_user: dict = Depends(get_current_user),
) -> ProjectCreateResponse:
    enforce_rate_limit(current_user["id"])

    clean_kb_ids = _normalize_kb_ids(request.knowledge_base_ids)
    if not clean_kb_ids:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "Vui lòng chọn ít nhất 1 Knowledge Base trước khi tạo dự án bài giảng.",
            },
        )

    project = create_editor_project(
        user_id=current_user["id"],
        title=request.title,
        description=request.description,
        knowledge_base_ids=clean_kb_ids,
        level=request.level,
        doc_format=request.format,
        teaching_tone=request.teaching_tone,
    )
    return ProjectCreateResponse(
        id=str(project["id"]),
        project_id=str(project["id"]),
        title=str(project["title"]),
        description=str(project.get("description") or ""),
        knowledge_base_ids=[str(item) for item in project.get("knowledge_base_ids", [])],
        level=str(project.get("level") or "basic"),
        format=str(project.get("format") or "markdown"),
        teaching_tone=str(project.get("teaching_tone") or ""),
        created_at=str(project["created_at"]),
        updated_at=str(project.get("updated_at") or project["created_at"]),
    )


@router.get("/projects")
async def list_projects_endpoint(
    limit: int = 100,
    offset: int = 0,
    current_user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    enforce_rate_limit(current_user["id"])
    rows = list_editor_projects(current_user["id"], current_user["role"], limit=limit, offset=offset)
    return {
        "success": True,
        "projects": rows,
    }


@router.get("/projects/{project_id}")
async def get_project_detail_endpoint(
    project_id: str,
    current_user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    enforce_rate_limit(current_user["id"])
    project = get_editor_project_detail_for_user(project_id, current_user["id"], current_user["role"])
    if not project:
        raise HTTPException(status_code=404, detail="Project not found or access denied")
    return {"success": True, "project": project}


@router.patch("/projects/{project_id}")
async def update_project_endpoint(
    project_id: str,
    request: ProjectUpdateRequest,
    current_user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    enforce_rate_limit(current_user["id"])

    normalized_kb_ids: list[str] | None = None
    if request.knowledge_base_ids is not None:
        normalized_kb_ids = _normalize_kb_ids(request.knowledge_base_ids)
        if not normalized_kb_ids:
            raise HTTPException(
                status_code=422,
                detail={
                    "message": "Dự án bài giảng phải có ít nhất 1 Knowledge Base.",
                },
            )

    updated = update_editor_project_for_user(
        project_id=project_id,
        user_id=current_user["id"],
        role=current_user["role"],
        title=request.title,
        description=request.description,
        knowledge_base_ids=normalized_kb_ids,
        level=request.level,
        doc_format=request.format,
        teaching_tone=request.teaching_tone,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Project not found or access denied")

    sections = list_editor_sections(project_id)
    payload = {
        "id": str(updated.get("id") or project_id),
        "project_id": str(updated.get("id") or project_id),
        "title": str(updated.get("title") or ""),
        "description": str(updated.get("description") or ""),
        "knowledge_base_ids": list(updated.get("knowledge_base_ids") or []),
        "level": str(updated.get("level") or "basic"),
        "format": str(updated.get("format") or "markdown"),
        "teaching_tone": str(updated.get("teaching_tone") or ""),
        "created_at": str(updated.get("created_at") or ""),
        "updated_at": str(updated.get("updated_at") or updated.get("created_at") or ""),
        "sections_count": len(sections),
    }
    return {"success": True, "project": payload}


@router.delete("/projects/{project_id}")
async def delete_project_endpoint(
    project_id: str,
    current_user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    enforce_rate_limit(current_user["id"])
    deleted = delete_project_for_user(project_id, current_user["id"], current_user["role"])
    if not deleted:
        raise HTTPException(status_code=404, detail="Project not found or access denied")
    return {"success": True, "project_id": project_id}


@router.post("/sections")
async def create_section_endpoint(
    request: CreateSectionRequest,
    current_user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    enforce_rate_limit(current_user["id"])
    project = get_project_for_user(request.project_id, current_user["id"], current_user["role"])
    if not project:
        raise HTTPException(status_code=404, detail="Project not found or access denied")

    prompt_value = (request.prompt or "").strip() or get_section_user_intent_hint(request.title)

    created = create_editor_section(
        project_id=request.project_id,
        title=request.title,
        prompt=prompt_value,
        order_index=request.order,
    )
    return {"success": True, "section": created}


@router.delete("/sections/{section_id}")
async def delete_section_endpoint(
    section_id: str,
    current_user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    enforce_rate_limit(current_user["id"])
    deleted = delete_editor_section(section_id, current_user["id"], current_user["role"])
    if not deleted:
        raise HTTPException(status_code=404, detail="Section not found")
    return {"success": True, "section_id": section_id}


@router.post("/projects/{project_id}/generate-outline")
async def generate_project_outline_endpoint(
    project_id: str,
    request: GenerateProjectOutlineRequest,
    current_user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    enforce_rate_limit(current_user["id"])

    project = get_project_for_user(project_id, current_user["id"], current_user["role"])
    if not project:
        raise HTTPException(status_code=404, detail="Project not found or access denied")

    source_ids = _normalize_kb_ids(project.get("knowledge_base_ids", []))
    if not source_ids:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "Dự án chưa có Knowledge Base. Vui lòng chọn ít nhất 1 tài liệu nguồn trước khi vào phần soạn thảo.",
            },
        )

    docs_owned = list_documents(current_user["id"], current_user["role"])
    source_id_set = {str(sid) for sid in source_ids}
    source_docs = [d for d in docs_owned if str(d.get("id")) in source_id_set]

    if not source_docs:
        raise HTTPException(status_code=422, detail="No source documents selected for retrieval")

    retrieved = await asyncio.to_thread(
        _retrieve_context_with_retry, query=request.prompt, selected_source_docs=source_docs,
    )
    context_text = _build_context_text(retrieved)
    if not context_text:
        raise HTTPException(status_code=422, detail="Insufficient context for outline generation")

    outline_prompt = build_outline_user_prompt(
        document_title=str(project.get("title") or "Tài liệu chưa đặt tên"),
        user_prompt=request.prompt,
    )
    system_prompt = build_project_rag_system_prompt(task="outline")
    final_prompt = build_project_rag_combined_prompt(user_prompt=request.prompt, task_prompt=outline_prompt)
    raw, gemini_real_call = await asyncio.to_thread(
        rag_pipeline.generate_with_gemini_from_markdown,
        context_text,
        f"{system_prompt}\n\n{final_prompt}",
    )

    parsed = _normalize_teaching_outline_sections(_parse_outline_to_sections(raw))

    replaced = replace_editor_sections(
        project_id=project_id,
        sections=[
            {
                "title": str(item.get("title") or "").strip(),
                "prompt": get_section_user_intent_hint(str(item.get("title") or "").strip()),
                "order_index": int(item.get("order_index") or idx),
            }
            for idx, item in enumerate(parsed)
        ],
    )

    level_map = {
        str(item.get("title") or "").strip(): int(item.get("level") or 1)
        for item in parsed
    }

    return {
        "success": True,
        "project_id": project_id,
        "prompt": request.prompt,
        "gemini_real_call": gemini_real_call,
        "llm_model": rag_pipeline.gemini_llm_model,
        "sections": [
            {
                **item,
                "level": level_map.get(str(item.get("title") or "").strip(), 1),
            }
            for item in replaced
        ],
    }


@router.post("/documents", response_model=DocumentResponse)
async def create_document_endpoint(
    request: DocumentCreateRequest,
    current_user: dict = Depends(get_current_user),
) -> DocumentResponse:
    enforce_rate_limit(current_user["id"])
    project = get_project_for_user(request.project_id, current_user["id"], current_user["role"])
    if not project:
        raise HTTPException(status_code=404, detail="Project not found or access denied")

    clean_source_ids = [doc_id.strip() for doc_id in request.source_document_ids if doc_id and doc_id.strip()]
    clean_source_ids = list(dict.fromkeys(clean_source_ids))

    doc = create_project_document(
        project_id=request.project_id,
        title=request.title.strip(),
        source_document_ids=clean_source_ids,
    )
    return DocumentResponse(
        doc_id=str(doc["id"]),
        project_id=str(doc["project_id"]),
        title=str(doc["title"]),
        created_at=str(doc["created_at"]),
        updated_at=str(doc["updated_at"]),
        sections=[],
        source_document_ids=clean_source_ids,
    )


@router.post("/generate-outline", response_model=OutlineResponse, deprecated=True)
async def generate_outline_endpoint(
    request: OutlineRequest,
    current_user: dict = Depends(get_current_user),
) -> OutlineResponse:
    """Deprecated: use POST /projects/{project_id}/generate-outline instead."""
    logger.warning("Deprecated endpoint /generate-outline called by user %s", current_user["id"])
    enforce_rate_limit(current_user["id"])

    doc = get_document_with_sections(request.doc_id, current_user["id"], current_user["role"])
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found or access denied")

    source_ids = request.selected_documents or doc.get("source_document_ids", [])
    all_docs_owned = list_documents(current_user["id"], current_user["role"])
    source_id_set_old = {str(sid) for sid in source_ids}
    source_docs = [d for d in all_docs_owned if str(d.get("id")) in source_id_set_old]

    if not source_docs:
        raise HTTPException(status_code=422, detail="No source documents selected for retrieval")

    retrieved = await asyncio.to_thread(
        _retrieve_context_with_retry, query=request.prompt, selected_source_docs=source_docs,
    )
    context_text = _build_context_text(retrieved)
    if not context_text:
        raise HTTPException(status_code=422, detail="Insufficient context for outline generation")

    outline_prompt = build_outline_user_prompt(document_title=str(doc.get("title") or "Tài liệu chưa đặt tên"), user_prompt=request.prompt)
    system_prompt = build_project_rag_system_prompt(task="outline")
    final_prompt = build_project_rag_combined_prompt(user_prompt=request.prompt, task_prompt=outline_prompt)
    raw, _ = await asyncio.to_thread(
        rag_pipeline.generate_with_gemini_from_markdown,
        context_text,
        f"{system_prompt}\n\n{final_prompt}",
    )

    sections = _normalize_teaching_outline_sections(_parse_outline_to_sections(raw))
    if not sections:
        raise HTTPException(status_code=422, detail="Model did not return a valid Markdown outline")

    saved_sections = set_document_sections(doc_id=request.doc_id, sections=sections)
    return OutlineResponse(
        doc_id=request.doc_id,
        sections=[
            SectionPayload(
                section_id=str(item["id"]),
                title=str(item["title"]),
                content=str(item.get("content") or ""),
                status=str(item.get("status") or "empty"),
            )
            for item in saved_sections
        ],
    )


def _do_batch_retrieval(
    group_type: str,
    sections: list[dict[str, Any]],
    source_docs: list[dict[str, Any]],
    global_prompt: str,
    lesson_title: str = "",
) -> list[dict[str, Any]]:
    """Helper to perform optimized retrieval for a group of sections."""
    # Combine titles for the query, anchored by the lesson title
    combined_titles = " + ".join([str(s.get("title") or "") for s in sections])
    query = f"{lesson_title}\n{combined_titles}\n{global_prompt}".strip()

    if group_type == "INTRO_GROUP":
        # Intro needs high-density concept chunks from the start of the source
        return _retrieve_context_with_retry(
            query=query,
            selected_source_docs=source_docs,
            min_total_chars=2000,
            max_chunks=10,
        )
    elif group_type == "OUTRO_GROUP":
        # Outro needs broad summary context
        return _retrieve_summary_context(
            query=query,
            selected_source_docs=source_docs,
            min_total_chars=2500,
            max_chunks=24,
        )

    # Fallback to standard retrieval if group unknown
    return _retrieve_context_with_retry(query=query, selected_source_docs=source_docs)


@router.post("/generate-batch-sections")
async def generate_batch_sections_endpoint(
    request: BatchGenerateRequest,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Optimized generation for multiple related sections (Batch Mode)."""
    enforce_rate_limit(current_user["id"])

    project = get_project_for_user(request.project_id, current_user["id"], current_user["role"])
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # ── 1. Load all requested sections ────────────────────────────────────
    sections = []
    for sid in request.section_ids:
        s = get_editor_section_for_user(sid, current_user["id"], current_user["role"])
        if s and str(s.get("project_id")) == request.project_id:
            sections.append(s)

    if not sections:
        raise HTTPException(status_code=404, detail="No valid sections found for batching")

    # ── 2. Identify batch optimization group ──────────────────────────────
    titles = [str(s.get("title") or "") for s in sections]
    group_type = get_batch_group_type(titles)

    # ── 3. Optimized Retrieval ────────────────────────────────────────────
    source_ids = _normalize_kb_ids(project.get("knowledge_base_ids", []))
    docs_owned = list_documents(current_user["id"], current_user["role"])
    source_docs = [d for d in docs_owned if str(d.get("id")) in {str(sid) for sid in source_ids}]

    if not source_docs:
        raise HTTPException(status_code=422, detail="No source documents available")

    retrieved = await asyncio.to_thread(
        _do_batch_retrieval,
        group_type=group_type,
        sections=sections,
        source_docs=source_docs,
        global_prompt=request.prompt,
        lesson_title=str(project.get("title") or ""),
    )
    context_text = _build_context_text(retrieved)
    if not context_text:
        return {"sections": {}, "message": "Insufficient context for batch generation"}

    # ── 4. Build Prompts ──────────────────────────────────────────────────
    sections_info = [{"id": str(s["id"]), "title": str(s["title"])} for s in sections]
    system_prompt = build_project_rag_batch_system_prompt(sections_info)
    user_prompt = build_project_rag_batch_user_prompt(
        sections=sections_info,
        user_prompt=request.prompt,
        lesson_title=str(project.get("title") or ""),
        learner_level=str(project.get("level") or "basic"),
    )

    # ── 5. Generate with LLM (JSON Mode) ──────────────────────────────────
    raw, _ = await asyncio.to_thread(
        rag_pipeline.generate_with_gemini_from_markdown,
        context_text,
        f"{system_prompt}\n\n{user_prompt}",
    )

    # ── 6. Parse and Unwrap ───────────────────────────────────────────────
    # We use a similar multi-step parse as the single section logic
    parsed_batch = {"sections": {}}
    cleaned = re.sub(r"^```(?:json)?\s*", "", (raw or "").strip(), flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*```$", "", cleaned).strip()

    try:
        parsed_data = json.loads(cleaned)
        batch_map = parsed_data.get("sections", {})
    except (json.JSONDecodeError, ValueError):
        # Try to find JSON block in text
        obj_match = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if obj_match:
            try:
                parsed_data = json.loads(obj_match.group())
                batch_map = parsed_data.get("sections", {})
            except:
                batch_map = {}
        else:
            batch_map = {}

    results = {}
    for s in sections:
        sid = str(s["id"])
        stitle = str(s["title"])
        
        # Extract data for this specific section from the batch map
        sdata = batch_map.get(sid) or {}
        content_markdown = str(sdata.get("content") or "").strip()
        sentinel = str(sdata.get("sentinel") or "").strip().upper()

        # Local cleanup
        content_markdown = _strip_duplicate_section_heading(content_markdown, stitle)
        content_markdown = _apply_structure_lock(content_markdown)
        
        # If sentinel is set, map it to user message
        if sentinel:
            content_markdown = _map_control_sentinel_to_user_message(sentinel, stitle) or content_markdown

        # Update DB
        update_editor_section(
            section_id=sid,
            user_id=current_user["id"],
            role=current_user["role"],
            content_markdown=content_markdown,
        )

        # Queue background evaluation
        if content_markdown and not sentinel:
            background_tasks.add_task(
                _evaluate_and_save_background,
                section_id=sid,
                user_id=current_user["id"],
                role=current_user["role"],
                section_name=stitle,
                context_text=context_text,
                generated_content=content_markdown,
            )

        results[sid] = {
            "section_id": sid,
            "title": stitle,
            "content": content_markdown,
            "status": "generated" if content_markdown and not sentinel else "empty",
            "sentinel": sentinel
        }

    return {"sections": results, "group_type": group_type}


@router.post("/generate-section")
async def generate_section_endpoint(
    request: GenerateSectionRequest,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    enforce_rate_limit(current_user["id"])

    project = get_project_for_user(request.project_id, current_user["id"], current_user["role"])
    if not project:
        raise HTTPException(status_code=404, detail="Project not found or access denied")

    section = get_editor_section_for_user(request.section_id, current_user["id"], current_user["role"])
    if not section or str(section.get("project_id")) != request.project_id:
        raise HTTPException(status_code=404, detail="Section not found")

    source_ids = _normalize_kb_ids(project.get("knowledge_base_ids", []))
    if not source_ids:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "Dự án chưa có Knowledge Base. Vui lòng chọn ít nhất 1 tài liệu nguồn trước khi vào phần soạn thảo.",
            },
        )

    docs_owned = list_documents(current_user["id"], current_user["role"])
    source_id_set = {str(sid) for sid in source_ids}
    source_docs = [d for d in docs_owned if str(d.get("id")) in source_id_set]

    if not source_docs:
        raise HTTPException(status_code=422, detail="No source documents selected for retrieval")

    section_title = str(section.get("title") or "")
    retrieval_profile = get_retrieval_profile(section_title)
    is_main_content = retrieval_profile.key == "main_content"

    lesson_title = str(project.get("title") or "").strip()
    retrieve_query = f"{lesson_title}\n{section_title}\n{request.prompt}"
    if is_main_content:
        retrieve_query = (
            f"{lesson_title}\n{section_title}\n{request.prompt}\n"
            "heading, subheading, khái niệm cốt lõi, định nghĩa, điều kiện áp dụng, cách hoạt động, ví dụ minh họa, cú pháp hoặc công thức xuất hiện trong tài liệu"
        )
    elif retrieval_profile.key in {"example", "application"}:
        retrieve_query = (
            f"{lesson_title}\n{section_title}\n{request.prompt}\n"
            "ví dụ minh họa, tình huống, yêu cầu, dữ liệu đầu vào, các bước thực hiện, câu lệnh liên quan, kết quả mong đợi"
        )
    elif retrieval_profile.key == "quiz":
        retrieve_query = (
            f"{lesson_title}\n{section_title}\n{request.prompt}\n"
            "source heading logic, syntax rules, command behavior, application scenarios, what happens if, how to solve, result prediction"
        )
    elif retrieval_profile.key == "summary":
        retrieve_query = (
            f"{lesson_title}\n{section_title}\n{request.prompt}\n"
            "tổng hợp đầy đủ ý chính, khái niệm cốt lõi, mục tiêu, nội dung chính, ví dụ minh họa, ứng dụng thực tế, kết luận"
        )

    def _do_section_retrieval() -> list[dict[str, Any]]:
        """Sync helper — runs on thread pool via asyncio.to_thread."""
        if is_main_content:
            focused_chunks = _retrieve_context_with_retry(
                query=retrieve_query,
                selected_source_docs=source_docs,
                min_total_chars=retrieval_profile.min_total_chars,
                max_chunks=max(retrieval_profile.max_chunks, 12),
                top_k_levels=list(retrieval_profile.top_k_levels),
            )
            broad_chunks = _retrieve_full_section_context_with_rerank(
                query=retrieve_query,
                selected_source_docs=source_docs,
                max_chunks=max(retrieval_profile.max_chunks * 2, 24),
            )
            result = _merge_retrieval_results(
                primary=focused_chunks,
                secondary=broad_chunks,
                max_chunks=max(retrieval_profile.max_chunks, 12),
            )
            return result if result else (focused_chunks or broad_chunks)
        elif retrieval_profile.key == "summary":
            return _retrieve_summary_context(
                query=retrieve_query,
                selected_source_docs=source_docs,
                min_total_chars=retrieval_profile.min_total_chars,
                max_chunks=retrieval_profile.max_chunks,
                top_k_levels=list(retrieval_profile.top_k_levels),
            )
        elif retrieval_profile.mode == "full_section":
            result = _retrieve_full_section_context_with_rerank(
                query=retrieve_query,
                selected_source_docs=source_docs,
                max_chunks=retrieval_profile.max_chunks,
            )
            if not result:
                result = _retrieve_context_with_retry(
                    query=retrieve_query,
                    selected_source_docs=source_docs,
                    min_total_chars=retrieval_profile.min_total_chars,
                    max_chunks=max(6, retrieval_profile.max_chunks // 2),
                    top_k_levels=[4, 5, 6, 8],
                )
            return result
        else:
            return _retrieve_context_with_retry(
                query=retrieve_query,
                selected_source_docs=source_docs,
                min_total_chars=retrieval_profile.min_total_chars,
                max_chunks=retrieval_profile.max_chunks,
                top_k_levels=list(retrieval_profile.top_k_levels),
            )

    retrieved = await asyncio.to_thread(_do_section_retrieval)
    context_text = _build_context_text(retrieved)
    if not context_text:
        sentinel = "NOT_ENOUGH_CONTEXT"
        content = _map_control_sentinel_to_user_message(sentinel, section_title) or sentinel
        evaluation = _fallback_section_evaluation(section_name=section_title, generated_content=sentinel)
        updated = update_editor_section(
            section_id=request.section_id,
            user_id=current_user["id"],
            role=current_user["role"],
            content_markdown=content,
            prompt=request.prompt,
            retrieved_chunks=[],
            evaluation=evaluation,
        )
        if not updated:
            raise HTTPException(status_code=404, detail="Section not found")

        return {
            "success": True,
            "project_id": request.project_id,
            "section_id": request.section_id,
            "content": content,
            "retrieved_chunks": [],
            "gemini_real_call": False,
            "grounding_verdict": "INSUFFICIENT_CONTEXT",
            "out_of_context_concepts": [],
            "section_scope_issues": [],
            "structure_lock_issues": [],
            "evaluation": evaluation,
            "evaluation_real_call": False,
            "retrieval_profile": {
                "section_key": retrieval_profile.key,
                "mode": retrieval_profile.mode,
                "top_k_levels": list(retrieval_profile.top_k_levels),
                "strategy": RETRIEVAL_MAP.get(retrieval_profile.key, ""),
            },
            "llm_model": rag_pipeline.gemini_llm_model,
            "context_count": 0,
        }

    generation_context_text = context_text
    if retrieval_profile.key == "summary":
        normalized_context = _normalize_context_text_for_llm(context_text)
        if normalized_context:
            generation_context_text = normalized_context

    # ── Fetch reference sections for context alignment ────────────────────
    all_sections = list_editor_sections(request.project_id)
    reference_sections = []
    
    is_generating_quiz = any(k in section_title.lower() for k in ["quiz", "trắc nghiệm", "bài tập"])

    # Identify high-value context sections: Giới thiệu (Intro) and Mục tiêu (Objectives)
    for s in all_sections:
        s_title = str(s.get("title") or "").lower()
        s_content = str(s.get("content_markdown") or s.get("content") or "").strip()
        if not s_content:
            continue
        # Don't use the current section as its own reference
        if str(s.get("id")) == request.section_id:
            continue
        
        # Check for Intro or Objectives
        is_intro = any(k in s_title for k in ["giới thiệu", "gioi thieu", "introduction"])
        is_obj = any(k in s_title for k in ["mục tiêu", "muc tieu", "objective"])
        
        # Double-Grounding: If generating quiz, fetch the main content as well
        is_main = is_generating_quiz and any(k in s_title for k in ["nội dung", "noi dung", "main content", "phần chính"])
        
        if is_intro or is_obj or is_main:
            reference_sections.append({
                "title": str(s.get("title")),
                "content": s_content
            })

    section_prompt = build_section_user_prompt(
        section_title=section_title,
        user_prompt=request.prompt,
        lesson_title=lesson_title,
        learner_level=str(project.get("level") or ""),
        existing_section_content=str(section.get("content_markdown") or ""),
        reference_sections=reference_sections,
    )
    if is_main_content:
        heading_hints = _extract_heading_hints_from_retrieved(retrieved)
        source_info = _build_source_info_from_retrieved(retrieved)
        heading_anchor_prompt = _build_main_content_heading_anchor_prompt(heading_hints, source_info)
        section_prompt = f"{section_prompt}\n\n{heading_anchor_prompt}"

    section_system_prompt = build_project_rag_system_prompt(
        section_title=section_title,
        task="section",
        teaching_tone=str(project.get("teaching_tone") or ""),
    )

    # ── Merge ALL structural constraints into initial prompt ──────────────
    structure_constraints = (
        "\n\nSTRUCTURAL RULES (MUST FOLLOW):\n"
        f"- Generate content ONLY for this section: {section_title}\n"
        "- Do NOT use numeric heading prefixes (1., 2., Chapter, Phần, Chương)\n"
        "- Do NOT include headings belonging to other sections\n"
        "- Do NOT output audit/verification scaffolding (Phase 1/2/3, Content Type, Verdict)\n"
        "- Return only Vietnamese Markdown content grounded in provided context\n"
        "- If context is insufficient, return exactly: NOT_ENOUGH_CONTEXT"
    )
    final_prompt = build_project_rag_combined_prompt(
        user_prompt=request.prompt, task_prompt=section_prompt,
    ) + structure_constraints

    # ── Call 1: Main generation (async) ───────────────────────────────────
    raw, gemini_real_call = await asyncio.to_thread(
        rag_pipeline.generate_with_gemini_from_markdown,
        generation_context_text,
        f"{section_system_prompt}\n\n{final_prompt}",
    )

    # ── Parse JSON response (new contract) with Markdown fallback ─────────
    lesson_only, json_sentinel = _parse_section_json_response(raw)

    # ── Legacy structure checks (on content string) ───────────────────────
    # These run after JSON unwrapping so they only see the Markdown payload.
    verification_verdict, out_of_context_concepts = _extract_verification_verdict(lesson_only)
    # If the LLM still embedded a verification block inside content, strip it.
    lesson_only = _strip_verification_block(lesson_only)
    if verification_verdict == "INVALID":
        lesson_only = _filter_unbounded_derived_sections(lesson_only)
    lesson_only = _strip_disallowed_section_blocks(section_title, lesson_only)
    lesson_only = _apply_structure_lock(lesson_only)

    content = _strip_duplicate_section_heading(lesson_only, section_title)
    content = _apply_structure_lock(content)
    content = _enforce_hard_section_format(
        section_title,
        content,
        retrieved_chunks=retrieved,
        selected_source_docs=source_docs,
    )
    if is_main_content:
        content = _compact_markdown_spacing(content, max_blank_lines=1)
    if not content:
        raise HTTPException(status_code=422, detail="Empty generated content")

    # ── Sentinel resolution: JSON sentinel takes priority ─────────────────
    sentinel = json_sentinel or _extract_control_sentinel(content)
    if sentinel:
        content = _map_control_sentinel_to_user_message(sentinel, section_title) or content
        evaluation = _fallback_section_evaluation(section_name=section_title, generated_content=sentinel)
        evaluation_real_call = False
        if sentinel == "NOT_ENOUGH_CONTEXT":
            verification_verdict = "INSUFFICIENT_CONTEXT"
        elif sentinel == "FAIL_COVERAGE":
            verification_verdict = "INVALID"
    else:
        if is_main_content:
            content = _compact_markdown_spacing(content, max_blank_lines=1)
        # ── Evaluation runs as BackgroundTask (no longer blocks response) ─
        evaluation = _fallback_section_evaluation(section_name=section_title, generated_content=content)
        evaluation_real_call = False  # will be updated in background
        background_tasks.add_task(
            _evaluate_and_save_background,
            section_id=request.section_id,
            user_id=current_user["id"],
            role=current_user["role"],
            section_name=section_title,
            context_text=context_text,
            generated_content=content,
        )

    section_scope_issues = []
    structure_lock_issues = _detect_structure_lock_violations(content)

    serialized_retrieved_chunks = [_serialize_retrieved_chunk(item) for item in retrieved]

    updated = update_editor_section(
        section_id=request.section_id,
        user_id=current_user["id"],
        role=current_user["role"],
        content_markdown=content,
        prompt=request.prompt,
        retrieved_chunks=serialized_retrieved_chunks,
        evaluation=evaluation,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Section not found")

    return {
        "success": True,
        "project_id": request.project_id,
        "section_id": request.section_id,
        "content": str(updated.get("content_markdown") or ""),
        "retrieved_chunks": serialized_retrieved_chunks,
        "gemini_real_call": gemini_real_call,
        "evaluation": evaluation,
        "evaluation_real_call": evaluation_real_call,
        "grounding_verdict": verification_verdict,
        "out_of_context_concepts": out_of_context_concepts,
        "section_scope_issues": section_scope_issues,
        "structure_lock_issues": structure_lock_issues,
        "retrieval_profile": {
            "section_key": retrieval_profile.key,
            "mode": retrieval_profile.mode,
            "top_k_levels": list(retrieval_profile.top_k_levels),
            "strategy": RETRIEVAL_MAP.get(retrieval_profile.key, ""),
        },
        "llm_model": rag_pipeline.gemini_llm_model,
        "context_count": len(retrieved),
    }


@router.patch("/sections/{section_id}")
async def update_section_endpoint(
    section_id: str,
    request: UpdateSectionRequest,
    current_user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    enforce_rate_limit(current_user["id"])

    updated = update_editor_section(
        section_id=section_id,
        user_id=current_user["id"],
        role=current_user["role"],
        title=request.title,
        content_markdown=request.content,
        prompt=request.prompt,
        order_index=request.order,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Section not found")

    return {"success": True, "section": updated}


@router.get("/projects/{project_id}/export/md")
async def export_project_markdown_endpoint(
    project_id: str,
    current_user: dict = Depends(get_current_user),
):
    enforce_rate_limit(current_user["id"])
    project = get_editor_project_detail_for_user(project_id, current_user["id"], current_user["role"])
    if not project:
        raise HTTPException(status_code=404, detail="Project not found or access denied")

    markdown = _render_project_markdown(project)
    filename_ascii, filename_utf8 = _build_download_filename(str(project.get("title") or ""))
    return PlainTextResponse(
        content=markdown,
        media_type="text/markdown; charset=utf-8",
        headers={
            "Content-Disposition": (
                f"attachment; filename=\"{filename_ascii}\"; "
                f"filename*=UTF-8''{filename_utf8}"
            )
        },
    )


@router.get("/projects/{project_id}/export/pdf")
async def export_project_pdf_endpoint(
    project_id: str,
    current_user: dict = Depends(get_current_user),
):
    enforce_rate_limit(current_user["id"])
    project = get_editor_project_detail_for_user(project_id, current_user["id"], current_user["role"])
    if not project:
        raise HTTPException(status_code=404, detail="Project not found or access denied")

    try:
        pdf_bytes = _render_project_pdf_bytes(project)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    filename_ascii, filename_utf8 = _build_download_filename_with_ext(
        str(project.get("title") or ""),
        "pdf",
    )
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": (
                f"attachment; filename=\"{filename_ascii}\"; "
                f"filename*=UTF-8''{filename_utf8}"
            )
        },
    )


@router.get("/projects/{project_id}/export/docx")
async def export_project_docx_endpoint(
    project_id: str,
    current_user: dict = Depends(get_current_user),
):
    enforce_rate_limit(current_user["id"])
    project = get_editor_project_detail_for_user(project_id, current_user["id"], current_user["role"])
    if not project:
        raise HTTPException(status_code=404, detail="Project not found or access denied")

    try:
        docx_bytes = _render_project_docx_bytes(project)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    filename_ascii, filename_utf8 = _build_download_filename_with_ext(
        str(project.get("title") or ""),
        "docx",
    )
    return Response(
        content=docx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={
            "Content-Disposition": (
                f"attachment; filename=\"{filename_ascii}\"; "
                f"filename*=UTF-8''{filename_utf8}"
            )
        },
    )


@router.get("/document/{doc_id}", response_model=DocumentResponse)
async def get_document_endpoint(
    doc_id: str,
    current_user: dict = Depends(get_current_user),
) -> DocumentResponse:
    enforce_rate_limit(current_user["id"])

    doc = get_document_with_sections(doc_id, current_user["id"], current_user["role"])
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found or access denied")

    return DocumentResponse(
        doc_id=str(doc.get("id")),
        project_id=str(doc.get("project_id")),
        title=str(doc.get("title")),
        created_at=str(doc.get("created_at")),
        updated_at=str(doc.get("updated_at")),
        sections=[
            SectionPayload(
                section_id=str(section.get("id")),
                title=str(section.get("title")),
                content=str(section.get("content") or ""),
                status=str(section.get("status") or "empty"),
            )
            for section in doc.get("sections", [])
        ],
        source_document_ids=[str(item) for item in doc.get("source_document_ids", [])],
    )


@router.get("/document/{doc_id}/export")
@router.get("/export/document/{doc_id}")
async def export_document_endpoint(
    doc_id: str,
    current_user: dict = Depends(get_current_user),
):
    enforce_rate_limit(current_user["id"])

    export_data = get_document_for_export(doc_id, current_user["id"], current_user["role"])
    if not export_data:
        raise HTTPException(status_code=404, detail="Document not found or access denied")

    lines = [f"# {export_data['title']}", ""]
    for section in export_data["sections"]:
        lines.append(f"## {section['title']}")
        lines.append("")
        lines.append(section.get("content") or "")
        lines.append("")

    markdown = "\n".join(lines).strip() + "\n"
    filename_ascii, filename_utf8 = _build_download_filename(str(export_data.get("title") or ""))
    return PlainTextResponse(
        content=markdown,
        media_type="text/markdown; charset=utf-8",
        headers={
            "Content-Disposition": (
                f"attachment; filename=\"{filename_ascii}\"; "
                f"filename*=UTF-8''{filename_utf8}"
            )
        },
    )
