# WORKFLOW HE THONG END-TO-END (RAG Teaching Material)

## 1) Giai thich nhanh ve "001" va Gemini Embedding 2

Trong code hien tai, embedding model dang chay la:

- `GEMINI_EMBEDDING_MODEL=models/gemini-embedding-001`

Diem de nham:

- Chuoi cu: `models/embedding-001` (khong co `gemini-`) la config cu/khac ngu canh, de gay fallback local.
- Chuoi moi dung trong he thong nay: `models/gemini-embedding-001`.

Vi sao van thay "001" nhung khong phai "Embedding 1" theo cach hieu cu:

- Ten model do nha cung cap dat theo API naming, suffix `001` khong dong nghia voi viec he thong dang dung embedding fallback 256 dims.
- Dau hieu runtime da chay embedding Gemini dung la vector kich thuoc lon (3072), tung gay mismatch voi collection cu 256 dims.
- Vi vay he thong da doi sang collection moi (`rag_markdown_chunks_gem2`) de dong bo voi embedding Gemini hien tai.

## 2) Kien truc tong quan

- Frontend: React + TypeScript + Axios
- Backend API: FastAPI
- Auth/usage/doc metadata: SQLite layer qua `auth_db`
- Convert + OCR: `pdfplumber`, `pypdfium2`, `PaddleOCR`/`Tesseract` fallback
- Chunking: LangChain splitters (`MarkdownHeaderTextSplitter`, `RecursiveCharacterTextSplitter`)
- Vector store: ChromaDB
- Embedding/LLM: Google Gemini API
- Rerank: Cohere (neu bat)

## 3) App bootstrap va route wiring

File chinh:

- `backend/app/main.py`

Chu trinh khoi dong:

1. `lifespan()` khoi tao DB auth (`init_auth_db()`), tao admin local neu chua co.
2. Gan `CORSMiddleware` (allow methods/headers/origins).
3. Gan middleware `auth_context_middleware` de parse Bearer token, log request, cap nhat usage.
4. Include routers:
   - `app.include_router(auth.router, prefix="/auth")`
   - `app.include_router(secure_rag.router)`

## 4) Workflow Upload -> Convert/OCR -> Chunk -> Index -> Persist

Frontend trigger:

1. User chon file tai dashboard (`frontend/src/pages/UserDashboard.tsx`, `handleFileUpload`).
2. FE goi `secureUploadDocument(file, onProgress)` (`frontend/src/services/api.ts`).
3. Axios `onUploadProgress` cap nhat % (`uploadProgress`) va progress bar tren UI.

Backend endpoint:

- `POST /upload` trong `backend/app/routes/secure_rag.py` (`secure_upload`).

Chi tiet backend flow (`secure_upload`):

1. Xac thuc JWT (`Depends(get_current_user)`), rate limit (`enforce_rate_limit`).
2. Validate file ext (`.pdf`/`.docx`) + size <= 50MB.
3. Luu file vao user storage: `/uploads/users/{user_id}/{uuid}.ext`.
4. Goi `_extract_and_clean_document(data, file_ext)`:
   - PDF: `_extract_from_pdf_with_meta(..., ocr_mode="auto")`
   - DOCX: `_extract_from_docx(...)`
   - Cleaner: `AdvancedMarkdownCleaner` (fallback `clean_markdown_advanced`)
   - Chuan hoa cong thuc + heading + sanitize output:
     - `_normalize_math_formulas`
     - `_promote_markdown_headings`
     - `_sanitize_markdown_for_output`
5. Neu OCR qua kem va markdown rong -> HTTP 422.
6. Index vao RAG:
   - `rag_pipeline.index_markdown(markdown_for_index, source_tag, ...)`
7. Tao ban ghi document:
   - `create_document(...)` trong auth/doc DB.
8. Tra `SecureUploadResponse` (document_id, collection, chunks_indexed, quality, ocr_used).

## 5) OCR page-level cache (toi uu moi)

File:

- `backend/app/routes/convert.py`

Config:

- `OCR_CACHE_ENABLED=true`
- `OCR_CACHE_DIR=/app/uploads/ocr_page_cache` (trong Docker env)

Co che:

1. Khi xu ly PDF OCR, he thong tinh fingerprint file (`sha256(file bytes)`).
2. Moi trang OCR duoc cache rieng theo key: `fingerprint + page_index`.
3. Reprocess hoac upload lai cung file:
   - Trang nao co cache -> doc text tu cache (cache hit).
   - Trang nao chua co -> OCR roi ghi cache.

Tac dung:

- Giam manh thoi gian reprocess tai lieu scan/image-heavy.

## 6) Workflow Reprocess document

Frontend:

- User bam reprocess tai dashboard (`handleReprocessDoc`), goi `reprocessSecureDocument(documentId)`.

Backend:

- Endpoint `POST /documents/{document_id}/reprocess` (`secure_reprocess_document`).

Flow:

1. Kiem tra quyen so huu doc + file da luu ton tai.
2. Xac dinh `source_tag` va `collection_name` cua doc cu.
3. Xoa chunks cu trong Chroma theo source:
   - `rag_pipeline.delete_chunks_by_source(...)`
4. Doc lai file goc tu disk.
5. Chay lai `_extract_and_clean_document(...)` (bao gom OCR cache).
6. Index lai qua `rag_pipeline.index_markdown(...)`.
7. Cap nhat metadata doc (`update_document_processing_result`).
8. Tra ve so chunk da xoa/tao moi + OCR quality/ocr_used.

## 7) Workflow Generate noi dung

### 7.1 Endpoint `/generate` (single document)

File:

- `backend/app/routes/secure_rag.py` (`secure_generate`)

Cac mode:

- `toc`: tao muc luc heading.
- `section`: tao noi dung cho section cu the.
- `edit`: sua section theo user instruction.
- `teaching_doc`: truy xuat context + tong hop teaching doc.

Flow chung:

1. Check ownership document.
2. Lay markdown/doc context.
3. Theo mode thi build prompt rieng.
4. Goi Gemini qua `rag_pipeline.generate_with_gemini_from_markdown(...)`.
5. Hau xu ly output (sanitize, enforce heading neu can).
6. Ghi usage (`upsert_usage`) va tra response.

### 7.2 Endpoint `/generate/teaching-doc` (multi document)

File:

- `backend/app/routes/secure_rag.py` (`secure_generate_teaching_doc`)

Flow:

1. Validate input (`prompt`, `document_ids`, `action`).
2. Lap qua tung document:
   - check ownership
   - retrieve + rerank qua `rag_pipeline.search_knowledge_base(...)`
3. Merge chunk theo score cao nhat, cat top_k.
4. Build context text (`_build_context_blocks`).
5. Summarize context (`rag_pipeline.summarize_document`).
6. Tao outline (`rag_pipeline.generate_outline`).
7. Expand thanh tai lieu day du (Gemini generate).
8. Grounding check (`_raise_if_out_of_context`) + quality eval (`_evaluate_quality`).
9. Tra `content_markdown`, `contexts`, `evaluation`.

## 8) Workflow Chat theo document

Frontend:

- FE goi `secureAskChat(...)`.

Backend:

- Endpoint `POST /chat` (`secure_chat` trong `secure_rag.py`).

Flow:

1. Xac dinh conversation (tao moi neu chua co).
2. Xac dinh document hieu luc (request doc id -> conversation doc id -> fallback doc dau tien cua user).
3. Lay lich su chat gan day (`list_chat_messages`) de tao contextual query (`_build_contextual_chat_query`).
4. Retrieve hybrid:
   - `rag_pipeline.retrieve_hybrid(...)`
5. Rerank:
   - `rag_pipeline.rerank(...)`
6. Sinh cau tra loi:
   - `rag_pipeline.answer_with_gemini(...)`
7. Luu message user/assistant vao DB conversation.
8. Tra answer + source chunks + model flags.

## 9) Chunking + indexing internals

File:

- `backend/app/chunking.py`
- `backend/app/rag_pipeline.py`

Pipeline trong `index_markdown(...)`:

1. `chunk_markdown(...)`:
   - Stage 1: chia theo heading (giu metadata h1/h2/h3)
   - Stage 2: recursive split theo chunk_size/chunk_overlap
2. Build metadata cho moi chunk (`source`, `title`, `page_number`, heading metadata).
3. Embed tung chunk:
   - `_embed_document(...)` -> Gemini embedding
   - Neu loi API thi fallback `_local_embedding(...)` (256 dims)
4. Upsert vao Chroma collection.

Truy van:

- Query embed: `_embed_query(...)`
- Hybrid retrieval + keyword/vector score
- (Tuy chon) Cohere rerank
- Gemini answer/generation tren context da chon

## 10) Input -> Output map (ngan gon)

### Upload

- Input: file PDF/DOCX + JWT
- Output: document_id + chunks_indexed + OCR metadata

### Reprocess

- Input: document_id + JWT
- Output: chunks_deleted/chunks_indexed moi + OCR metadata

### Generate teaching document

- Input: prompt + danh sach document_ids + level/length/format
- Output: content_markdown + contexts + evaluation

### Chat

- Input: question + document_id/conversation_id
- Output: answer + evidence sources + conversation state

## 11) Cac file can nam khi debug/bao tri

Backend core:

- `backend/app/main.py`: app lifecycle, middleware, router wiring
- `backend/app/routes/secure_rag.py`: upload/reprocess/doc APIs/generate/chat
- `backend/app/routes/convert.py`: extraction + OCR + cache theo trang
- `backend/app/rag_pipeline.py`: embedding/index/retrieve/rerank/generate
- `backend/app/chunking.py`: chunk strategy va metadata

Frontend core:

- `frontend/src/pages/UserDashboard.tsx`: upload progress, list/reprocess, chat interactions
- `frontend/src/services/api.ts`: HTTP client mapping toi backend endpoints

Runtime config:

- `.env`, `.env.example`, `docker-compose.yml`

## 12) Luu y van hanh quan trong

1. Neu doi embedding mode/size, can doi collection Chroma moi de tranh dimension mismatch.
2. OCR cache nen dat tren volume ben vung neu muon giu toc do reprocess qua lan restart container.
3. Khi benchmark, can test ca upload lan dau va reprocess de thay ro loi ich cache.
4. Neu backend log bao Gemini embedding fail, he thong co fallback local embedding; ket qua van chay nhung chat luong/toc do co the khac.
