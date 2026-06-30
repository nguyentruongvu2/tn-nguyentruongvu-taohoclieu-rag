"""Secure API surface with JWT auth and per-document ownership checks.

Endpoints required by architecture prompt:
- POST /upload
- GET /documents
- POST /generate (toc | section | edit | teaching_doc)
- POST /chat
- GET /documents/{document_id}/detail
- GET /documents/{document_id}/preview
"""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, BackgroundTasks
from fastapi.responses import FileResponse, PlainTextResponse, StreamingResponse

from ..auth_db import (
    create_chat_conversation,
    create_document,
    delete_chat_conversation,
    delete_document,
    estimate_tokens_from_text,
    get_chat_conversation_for_user,
    get_document_for_user,
    list_chat_conversations,
    list_chat_messages,
    list_documents,
    update_document_processing_result,
    upsert_usage,
    append_chat_message,
)
from ..prompts.secure_rag_system_prompts import (
    SECURE_TEACHING_DOC_SYSTEM_PROMPT,
    SECURE_TOC_SYSTEM_PROMPT,
)
from ..prompts.secure_rag_user_prompts import (
    build_insufficient_teaching_doc,
    build_teaching_doc_action_expand_prompt,
    build_teaching_doc_expand_prompt,
)
from ..rag_pipeline import rag_pipeline
from ..security import enforce_rate_limit, get_current_user
from .convert import OCR_UNCLEAR_MESSAGE
from .rag import (
    ChatSource,
    _build_edit_prompt,
    _build_subsection_prompt,
    _enforce_single_subsection_output,
    _sanitize_extracted_content,
    _select_relevant_chunks,
)
from .secure_rag_logic import (
    _apply_teaching_doc_citation_rules,
    _build_action_instruction,
    _build_context_blocks,
    _build_contextual_chat_query,
    _ensure_required_teaching_sections,
    _evaluate_quality,
    _extract_and_clean_document,
    _extract_teaching_context_chunk,
    _format_main_source_line,
    _format_quality_section,
    _heuristic_quality_scores,
    _metadata_source_label,
    _metadata_page_number,
    _raise_if_out_of_context,
    _refine_teaching_contexts,
    execute_secure_chat,
    execute_secure_chat_stream,
)
from .secure_rag_models import (
    ChatConversationCreateRequest,
    ChatConversationDeleteResponse,
    ChatConversationItem,
    ChatConversationListResponse,
    ChatConversationResponse,
    ChatMessageItem,
    ChatMessageListResponse,
    GenerateRequest,
    GenerateResponse,
    GenerateTeachingDocRequest,
    GenerateTeachingDocResponse,
    SecureChatRequest,
    SecureChatResponse,
    SecureChunkPreview,
    SecureDeleteResponse,
    SecureDocumentDetailResponse,
    SecureReprocessResponse,
    SecureUploadResponse,
)

router = APIRouter(tags=["secure-rag"])

USER_UPLOAD_ROOT = Path(os.getenv("UPLOAD_DIR", "./uploads")).resolve() / "users"
USER_UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)


def process_uploaded_document_task(
    document_id: str,
    user_id: int,
    file_name: str,
    file_ext: str,
    data: bytes,
    stored_path: Path,
    source_tag: str,
):
    try:
        from ..db.documents import update_document_progress, update_document_processing_result
        
        # Step 1: Extraction
        update_document_progress(document_id, progress=10, status="processing")
        
        markdown, markdown_for_index, pages, ocr_quality, ocr_used = _extract_and_clean_document(
            data=data, file_ext=file_ext
        )
        
        if not markdown_for_index.strip() or not markdown.strip():
            raise ValueError(OCR_UNCLEAR_MESSAGE)
            
        update_document_progress(document_id, progress=30, status="processing")
        
        # Step 2: Indexing (Embedding is handled in loop and updates progress from 30% to 95%)
        indexed = rag_pipeline.index_markdown(
            markdown=markdown_for_index,
            source=source_tag,
            collection_name=None,
            chunk_size=1200,
            chunk_overlap=120,
            total_pages=pages,
            doc_id=document_id,
            file_name=file_name,
        )
        
        collection = str(indexed.get("collection", ""))
        chunks = int(indexed.get("chunks_indexed", 0))
        
        # Step 3: Finalize
        update_document_processing_result(
            document_id=document_id,
            markdown=markdown,
            collection_name=collection,
            chunks_count=chunks,
            embeddings_count=chunks,
            status="ready",
        )
        update_document_progress(document_id, progress=100, status="ready")
        
    except Exception as e:
        import logging
        logger = logging.getLogger(__name__)
        logger.error(f"Background document processing failed for {document_id}: {e}", exc_info=True)
        try:
            from ..db.documents import update_document_progress
            update_document_progress(document_id, progress=0, status="failed", error=str(e))
        except Exception:
            pass


@router.post("/upload", response_model=SecureUploadResponse)
async def secure_upload(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    ocr_mode: str = Query("auto", description="Deprecated"),
    current_user: dict = Depends(get_current_user),
) -> SecureUploadResponse:
    enforce_rate_limit(current_user["id"])

    file_ext = os.path.splitext(file.filename or "")[1].lower()
    if file_ext not in {".pdf", ".docx"}:
        raise HTTPException(status_code=400, detail="Secure upload supports PDF or DOCX")

    data = await file.read()
    if len(data) > 100 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (limit 100MB)")

    user_dir = USER_UPLOAD_ROOT / str(current_user["id"])
    user_dir.mkdir(parents=True, exist_ok=True)
    stored_name = f"{uuid.uuid4().hex}{file_ext or '.bin'}"
    stored_path = user_dir / stored_name
    stored_path.write_bytes(data)

    source_tag = f"u{current_user['id']}-{uuid.uuid4().hex}"
    document_id = str(uuid.uuid4())
    
    # Pre-create the document record with status "processing"
    doc = create_document(
        user_id=current_user["id"],
        original_filename=file.filename or "document.pdf",
        stored_file_path=str(stored_path),
        markdown="",
        source_tag=source_tag,
        collection_name="",
        chunks_count=0,
        embeddings_count=0,
        status="processing",
        document_id=document_id,
    )

    # Launch background processing task
    background_tasks.add_task(
        process_uploaded_document_task,
        document_id=document_id,
        user_id=current_user["id"],
        file_name=file.filename or "document.pdf",
        file_ext=file_ext,
        data=data,
        stored_path=stored_path,
        source_tag=source_tag,
    )

    return SecureUploadResponse(
        success=True,
        document_id=str(doc["id"]),
        file_name=str(doc["original_filename"]),
        collection="",
        chunks_indexed=0,
        quality="medium",
        ocr_used=False,
        message="Tệp đã tải lên máy chủ. Đang tiến hành xử lý...",
    )


@router.post("/documents/{document_id}/reprocess", response_model=SecureReprocessResponse)
async def secure_reprocess_document(
    document_id: str,
    current_user: dict = Depends(get_current_user),
) -> SecureReprocessResponse:
    enforce_rate_limit(current_user["id"])
    doc = get_document_for_user(document_id, current_user["id"], current_user["role"])
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    stored_file_path = str(doc.get("stored_file_path") or "").strip()
    stored_path = Path(stored_file_path).resolve()
    if not stored_path.exists():
        raise HTTPException(status_code=404, detail="Stored file not found")

    file_ext = stored_path.suffix.lower()
    source_tag = str(doc.get("source_tag") or "")
    collection_name = str(doc.get("collection_name") or "") or None

    # Delete old chunks
    await asyncio.to_thread(rag_pipeline.delete_chunks_by_source, source_tag=source_tag, collection_name=collection_name)

    data = stored_path.read_bytes()
    markdown, markdown_for_index, pages, ocr_quality, ocr_used = await asyncio.to_thread(
        _extract_and_clean_document, data=data, file_ext=file_ext
    )

    indexed = await asyncio.to_thread(
        rag_pipeline.index_markdown,
        markdown=markdown_for_index,
        source=source_tag,
        collection_name=collection_name,
        total_pages=pages,
        doc_id=document_id,
        file_name=str(doc.get("original_filename") or stored_path.name),
    )

    new_collection = str(indexed.get("collection", ""))
    chunks = int(indexed.get("chunks_indexed", 0))
    update_document_processing_result(document_id, markdown, new_collection, chunks, chunks, "ready")

    return SecureReprocessResponse(
        success=True,
        document_id=document_id,
        file_name=str(doc.get("original_filename") or stored_path.name),
        collection=new_collection,
        chunks_deleted=0, # Simplified for brevity
        chunks_indexed=chunks,
        quality=ocr_quality,
        ocr_used=ocr_used,
        message="Document reprocessed",
    )


@router.get("/documents")
async def secure_list_documents(current_user: dict = Depends(get_current_user)):
    enforce_rate_limit(current_user["id"])
    docs = list_documents(current_user["id"], current_user["role"])
    return {"success": True, "documents": docs}


@router.delete("/documents/{document_id}", response_model=SecureDeleteResponse)
async def secure_delete_document(
    document_id: str,
    current_user: dict = Depends(get_current_user),
) -> SecureDeleteResponse:
    enforce_rate_limit(current_user["id"])
    doc = get_document_for_user(document_id, current_user["id"], current_user["role"])
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    source_tag = str(doc.get("source_tag") or "")
    collection_name = str(doc.get("collection_name") or "") or None
    stored_file_path = str(doc.get("stored_file_path") or "")

    delete_result = await asyncio.to_thread(
        rag_pipeline.delete_chunks_by_source, source_tag=source_tag, collection_name=collection_name
    )
    chunks_deleted = delete_result.get("deleted_count", 0)

    # Fallback to database count if Qdrant returns 0 (e.g. if chunks not indexed or empty in collection)
    if not chunks_deleted and doc:
        chunks_deleted = doc.get("chunks_count") or doc.get("embeddings_count") or 0

    if stored_file_path:
        try:
            Path(stored_file_path).unlink(missing_ok=True)
        except Exception: pass

    delete_document(document_id)
    return SecureDeleteResponse(success=True, document_id=document_id, chunks_deleted=chunks_deleted, message="Deleted")


@router.get("/documents/{document_id}/references")
async def secure_document_references(
    document_id: str,
    current_user: dict = Depends(get_current_user),
):
    enforce_rate_limit(current_user["id"])
    doc = get_document_for_user(document_id, current_user["id"], current_user["role"])
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    from ..auth_db import get_projects_referencing_document
    projects = get_projects_referencing_document(document_id, current_user["id"])
    return {"success": True, "projects": projects}



@router.get("/documents/{document_id}/detail", response_model=SecureDocumentDetailResponse)
async def secure_document_detail(
    document_id: str,
    current_user: dict = Depends(get_current_user),
) -> SecureDocumentDetailResponse:
    enforce_rate_limit(current_user["id"])
    doc = get_document_for_user(document_id, current_user["id"], current_user["role"])
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    source_tag = str(doc.get("source_tag") or "")
    collection_name = str(doc.get("collection_name") or "") or None

    raw_chunks = await asyncio.to_thread(rag_pipeline.get_chunks_by_source, source_tag=source_tag, collection_name=collection_name, limit=80)
    chunks = [
        SecureChunkPreview(
            chunk_id=str(c.get("chunk_id", "")),
            snippet=str(c.get("text", "")),
            content=str(c.get("text", "")),
            page_number=_metadata_page_number(c.get("metadata", {}))
        ) for c in raw_chunks
    ]

    return SecureDocumentDetailResponse(
        success=True,
        document=doc,
        markdown=str(doc.get("markdown") or ""),
        chunks=chunks
    )


@router.get("/documents/{document_id}/preview")
async def secure_document_preview(
    document_id: str,
    current_user: dict = Depends(get_current_user),
):
    enforce_rate_limit(current_user["id"])
    doc = get_document_for_user(document_id, current_user["id"], current_user["role"])
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    stored_path = Path(str(doc.get("stored_file_path") or "")).resolve()
    if not stored_path.exists():
        return PlainTextResponse(content=str(doc.get("markdown") or ""))

    return FileResponse(path=str(stored_path), filename=str(doc.get("original_filename")))


@router.post("/generate", response_model=GenerateResponse)
async def secure_generate(
    request: GenerateRequest,
    current_user: dict = Depends(get_current_user),
) -> GenerateResponse:
    enforce_rate_limit(current_user["id"])
    doc = get_document_for_user(request.document_id, current_user["id"], current_user["role"])
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    mode = request.mode.strip().lower()
    markdown = str(doc.get("markdown") or "")

    if mode == "toc":
        raw_answer, gemini_call = await asyncio.to_thread(rag_pipeline.generate_with_gemini_from_markdown, markdown, request.prompt or SECURE_TOC_SYSTEM_PROMPT)
        return GenerateResponse(success=True, document_id=request.document_id, mode=mode, content=raw_answer, gemini_real_call=gemini_call, llm_model=rag_pipeline.gemini_llm_model)

    if mode == "teaching_doc":
        topic = (request.topic or request.section_title or "").strip()
        collection = str(doc.get("collection_name") or "") or None
        source = str(doc.get("source_tag") or "") or None

        retrieved, cohere_call, info = await asyncio.to_thread(rag_pipeline.retrieve_until_sufficient, query=topic, retrieval_tasks=[{"collection_name": collection, "source_filter": source}], use_rerank=True)
        context_text = _build_context_blocks(retrieved)
        
        if not context_text:
            content = build_insufficient_teaching_doc(topic)
            return GenerateResponse(success=True, document_id=request.document_id, mode=mode, content=content, gemini_real_call=False, llm_model=rag_pipeline.gemini_llm_model)

        outline = await asyncio.to_thread(rag_pipeline.generate_outline, topic, context_text)
        prompt = f"{SECURE_TEACHING_DOC_SYSTEM_PROMPT}\n\n{build_teaching_doc_expand_prompt(topic, outline)}"
        generated, gen_call = await asyncio.to_thread(rag_pipeline.generate_with_gemini_from_markdown, context_text, prompt)
        
        formatted = rag_pipeline.format_output(generated)
        formatted = _ensure_required_teaching_sections(formatted)
        _raise_if_out_of_context(formatted, retrieved)
        
        evaluation, eval_call = await _evaluate_quality(topic, formatted, context_text)
        final_content = f"{formatted}\n\n{_format_quality_section(evaluation)}"
        
        return GenerateResponse(success=True, document_id=request.document_id, mode=mode, content=final_content, gemini_real_call=gen_call or eval_call, llm_model=rag_pipeline.gemini_llm_model, evaluation=evaluation)

    if mode in ["section", "edit"]:
        section_title = request.section_title.strip()
        if mode == "section":
            chunks, _ = _select_relevant_chunks(section_title, markdown, top_k=request.top_k)
            context = "\n\n".join(chunks).strip() or markdown
            prompt = _build_subsection_prompt(section_title, context, request.prompt, request.document_id, request.section_id, request.optional_previous_summary)
        else:
            context = request.current_content
            prompt = _build_edit_prompt(section_title, request.user_instruction, request.prompt)

        raw_answer, gemini_call = await asyncio.to_thread(rag_pipeline.generate_with_gemini_from_markdown, context, prompt)
        content = _enforce_single_subsection_output(section_title, _sanitize_extracted_content(raw_answer))
        
        return GenerateResponse(success=True, document_id=request.document_id, mode=mode, content=content, gemini_real_call=gemini_call, llm_model=rag_pipeline.gemini_llm_model)

    raise HTTPException(status_code=422, detail="Invalid mode")


@router.post("/generate/teaching-doc", response_model=GenerateTeachingDocResponse)
async def secure_generate_teaching_doc(
    request: GenerateTeachingDocRequest,
    current_user: dict = Depends(get_current_user),
) -> GenerateTeachingDocResponse:
    enforce_rate_limit(current_user["id"])
    
    prompt = request.prompt.strip()
    selected_ids = list(dict.fromkeys([d.strip() for d in request.document_ids if d.strip()]))
    if not selected_ids: raise HTTPException(status_code=422, detail="No documents selected")

    retrieval_tasks = []
    for doc_id in selected_ids:
        doc = get_document_for_user(doc_id, current_user["id"], current_user["role"])
        if not doc: raise HTTPException(status_code=404, detail=f"Document {doc_id} not found")
        retrieval_tasks.append({"collection_name": str(doc.get("collection_name") or ""), "source_filter": str(doc.get("source_tag") or "")})

    merged, cohere_call, info = await asyncio.to_thread(rag_pipeline.retrieve_until_sufficient, query=prompt, retrieval_tasks=retrieval_tasks, use_rerank=True)
    if not merged: raise HTTPException(status_code=422, detail="Insufficient data")

    raw_contexts = [_extract_teaching_context_chunk(item) for item in merged]
    citation_contexts = _refine_teaching_contexts(raw_contexts, max_items=6)
    context_text = _build_context_blocks(merged)

    outline = await asyncio.to_thread(rag_pipeline.generate_outline, prompt, context_text)
    action_instruction = _build_action_instruction(request)
    expand_prompt = f"{SECURE_TEACHING_DOC_SYSTEM_PROMPT}\n\n{build_teaching_doc_action_expand_prompt(prompt, request.action, action_instruction, request.level, request.output_format, request.length, outline)}"

    generated, gen_call = await asyncio.to_thread(rag_pipeline.generate_with_gemini_from_markdown, context_text, expand_prompt)
    base_doc = _ensure_required_teaching_sections(rag_pipeline.format_output(generated))
    final_content = _apply_teaching_doc_citation_rules(base_doc, citation_contexts)
    
    _raise_if_out_of_context(base_doc, merged)
    evaluation, eval_call = await _evaluate_quality(prompt, base_doc, context_text)

    return GenerateTeachingDocResponse(
        success=True,
        content_markdown=final_content,
        contexts=citation_contexts[:3],
        evaluation=evaluation,
        gemini_real_call=gen_call or eval_call,
        llm_model=rag_pipeline.gemini_llm_model
    )


@router.get("/chat/conversations", response_model=ChatConversationListResponse)
async def secure_list_chat_conversations(current_user: dict = Depends(get_current_user)) -> ChatConversationListResponse:
    rows = list_chat_conversations(current_user["id"], current_user["role"])
    conversations = [ChatConversationItem(**item) for item in rows]
    return ChatConversationListResponse(success=True, conversations=conversations)


@router.post("/chat/conversations", response_model=ChatConversationResponse)
async def secure_create_chat_conversation(request: ChatConversationCreateRequest, current_user: dict = Depends(get_current_user)) -> ChatConversationResponse:
    conv = create_chat_conversation(current_user["id"], request.title or "Cuoc hoi thoai moi", request.document_id, request.document_ids)
    return ChatConversationResponse(success=True, conversation=ChatConversationItem(**conv))


@router.get("/chat/conversations/{conversation_id}/messages", response_model=ChatMessageListResponse)
async def secure_list_chat_messages(conversation_id: str, current_user: dict = Depends(get_current_user)) -> ChatMessageListResponse:
    enforce_rate_limit(current_user["id"])
    messages = list_chat_messages(conversation_id, limit=50)
    return ChatMessageListResponse(
        success=True,
        conversation_id=conversation_id,
        messages=[ChatMessageItem(**msg) for msg in messages]
    )


@router.delete("/chat/conversations/{conversation_id}", response_model=ChatConversationDeleteResponse)
async def secure_delete_chat_conversation(conversation_id: str, current_user: dict = Depends(get_current_user)) -> ChatConversationDeleteResponse:
    delete_chat_conversation(conversation_id)
    return ChatConversationDeleteResponse(success=True, conversation_id=conversation_id, message="Deleted")


from fastapi_cache.decorator import cache
from ..cache import chat_key_builder

@router.post("/chat", response_model=SecureChatResponse)
@cache(expire=3600, key_builder=chat_key_builder)
async def secure_chat(
    request: SecureChatRequest,
    current_user: dict = Depends(get_current_user),
) -> SecureChatResponse:
    enforce_rate_limit(current_user["id"])
    return await execute_secure_chat(request, current_user)



@router.post("/chat/stream")
async def secure_chat_stream(
    request: SecureChatRequest,
    current_user: dict = Depends(get_current_user),
):
    enforce_rate_limit(current_user["id"])
    return await execute_secure_chat_stream(request, current_user)