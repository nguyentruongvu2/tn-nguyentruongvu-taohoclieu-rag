# AI Project Context - RAG Teaching Material

## 1. Project Overview
Hệ thống hỗ trợ soạn giảng dựa trên RAG (Retrieval-Augmented Generation).
- **Frontend**: React + Vite + TailwindCSS.
- **Backend**: FastAPI + Python.
- **AI**: Google Gemini (Content Gen) + Cohere (Rerank - Optional).
- **Database**: SQLite (Auth & Metadata) + Qdrant/Vector store (Document Chunks).

## 2. Refactored Structure (May 2026)
### Frontend API Layer (`frontend/src/services/api/`)
Mọi API call phải đi qua các module chuyên biệt:
- `client.ts`: Cấu hình Axios, Interceptors, Error Handling.
- `auth.ts`: Login, Register, Profile.
- `projects.ts`: Editor Project & Sections management.
- `documents.ts`: Upload, Convert, Process documents.
- `rag.ts`: AI Generation (TOC, Sections, Chat).
- `quiz.ts`: Question generation & results.
- `slides.ts`: Slide outline & Export.
- `admin.ts`: System monitoring.

**Quy tắc**: Không viết logic API trực tiếp trong Component. Luôn dùng `api.ts` (Proxy) hoặc trực tiếp từ `services/api/`.

### Backend Routing
- `main.py`: Entry point, include all routers.
- `/api/auth`: User & Admin logic.
- `/api/secure`: (secure_rag.py) Core RAG operations với quyền sở hữu document.
- `/api/projects`: Logic soạn thảo bài giảng theo Project.
- `/documents`: (convert.py) Logic chuyển đổi file sang Markdown.

## 3. Core Logic Flow
1. **Knowledge Ingestion**: User upload (PDF/DOCX) -> `convert.py` (Markdown) -> `rag_pipeline.py` (Chunking & Indexing).
2. **Teaching Project**: Create Project -> Generate TOC -> Generate Section-by-section.
3. **Context Injection**: Mỗi lần Gen nội dung, hệ thống sẽ retrieve Chunks từ Vector DB dựa trên `user_id` để đảm bảo an toàn dữ liệu.

## 4. Coding Standards for AI
- **Types**: Luôn sử dụng `frontend/src/types/api.ts` cho các phản hồi từ API.
- **Errors**: Xử lý lỗi qua `handleError` trong `client.ts` để hiển thị Toast đồng nhất.
- **Clean Code**: Giữ file dưới 500 dòng. Nếu quá lớn, hãy tách thành các `helpers.py` hoặc module nhỏ hơn.
