# 🧠 RAG Teaching Material - AI Context & Workflow

*Tài liệu này dành cho AI Coding Assistant đọc để nắm bắt nhanh ngữ cảnh, luồng dữ liệu và các "luật ngầm" của dự án mà không cần scan lại toàn bộ Source Code.*

---

## 1. Tech Stack & Architecture
- **Backend:** FastAPI (Python), Qdrant (Vector Search), Google Gemini 3 Flash (via LangChain/LiteLLM), python-pptx (Tạo Slide).
- **Frontend:** React (TypeScript), Vite, TailwindCSS (chạy local qua CSS thuần/tokens).
- **Kiến trúc chính:** Hệ thống RAG (Retrieval-Augmented Generation) chuyên dụng cho EdTech. Nhận đầu vào là file PDF/DOCX (giáo trình) và sinh ra Bài giảng, Slide (PPTX/PDF), Quiz (Moodle/Kahoot).

---

## 2. Core Workflows (Luồng dữ liệu chính)

### A. Document Pipeline (Xử lý tài liệu)
1. **Upload & Convert** (`/documents/convert`): PDF/DOCX -> Markdown (giữ nguyên bảng biểu, callout). Hỗ trợ OCR cho ảnh.
2. **Process** (`/documents/process`): Markdown -> Chunks.
3. **Index** (`/documents/pipeline/index-markdown`): Nhúng (Embed) chunks vào Qdrant.

### B. Lesson Generation (Sinh Bài giảng - Core RAG)
Nằm tại `backend/app/routes/project_rag.py`.
- Lấy đề cương (TOC) -> Sinh từng Section.
- **Thuật toán lấy ngữ cảnh (Fair Retrieval):** Dùng `_interleave_by_source` (Round-robin) để đảm bảo nếu user chọn 3 file nguồn, chunks của cả 3 file được chia đều, tránh hiện tượng "đói dữ liệu" (starvation).
- **Trình render Frontend:** Dùng `EnhancedMarkdownRenderer` (không dùng `ReactMarkdown` thuần) để hỗ trợ Github-style Callouts (`> [!NOTE]`) và Mermaid.js diagrams.

### C. Slide Generation (Sinh Slide)
Nằm tại `backend/app/routes/slides.py`.
- **Mô hình sư phạm:** Áp dụng **Assertion-Evidence 2.0**. (Tiêu đề slide là luận điểm, không phải nhãn chủ đề. VD: "Cache giảm tải 80%" thay vì "Giới thiệu Cache").
- **Visual Prompt:** AI tự động đề xuất ý tưởng hình ảnh (diagram/chart) cho mỗi slide thông qua field `visual_prompt`.
- **Phân phối:** LLM tự quyết định số lượng slide dựa trên khoảng `[min_count, max_count]` để phù hợp với logic nội dung.

### D. Quiz System (Hệ thống câu hỏi)
- **Quiz Bài giảng (Nội dung chính):** Mặc định sinh **6 câu** (3 Trắc nghiệm + 3 Tự luận) gắn chặt vào cuối bài giảng. Có "Phân tích đáp án sai" (MCQ) và "Nhận xét sư phạm" (Tự luận).
- **Quiz Luyện tập (Interactive):** Trang riêng (`QuizPage.tsx`). Mặc định **5 câu**. Hỗ trợ chấm điểm trực tiếp và **Export sang GIFT (.txt cho Moodle) hoặc CSV (cho Kahoot)**.

---

## 3. "Luật ngầm" & Cấu trúc Prompt (Quan trọng)

Mọi cấu trúc prompt của hệ thống được quản lý tập trung tại `backend/app/prompts/project_rag_section_profiles.py`.

**Quy tắc sinh nội dung chính (`main_content`):**
Hệ thống **không** sinh text tóm tắt khô khan, mà bị ép tuân thủ Giàn giáo sư phạm (Pedagogical Scaffolding):
1. **Thematic Synthesis:** Không liệt kê "Theo file A... theo file B...". Phải đập trộn theo "Chủ đề".
2. **Hook:** Bắt buộc mở đầu bằng 1 câu hỏi/tình huống gợi mở.
3. **Explain:** Giảng giải kèm trích dẫn nguồn `📚 Nguồn: [Tên file]`. Có thể chèn Mẹo ghi nhớ (`> 💡`) hoặc Lưu ý (`> 📝`).
4. **Concept Check:** Chèn một câu kiểm tra nhanh (`> 🤔`) ở giữa bài.
5. **Glossary:** Tự động trích xuất từ khóa khó làm "Từ điển thuật ngữ" (`> [!NOTE] 📖`) ở cuối phần.

---

## 4. Hướng dẫn cho AI trong các Session mới

1. **Khi sửa UI/Markdown:** Hãy nhớ file `EnhancedMarkdownRenderer.tsx` là bộ parser chính.
2. **Khi sửa luồng AI/Prompt:** Tuyệt đối KHÔNG sửa file RAG chính (`project_rag.py`) mà hãy vào `project_rag_section_profiles.py` hoặc `project_rag_system_prompts.py`.
3. **Không import thư viện mới nếu không cần thiết:** Hệ thống ưu tiên giải pháp Native/Vanilla CSS và xử lý chuỗi ở Frontend thay vì cài thêm npm packages.
4. **Export Quiz:** Chỉ export Quiz ở trang Luyện tập (Giai đoạn 2), không export Quiz gắn trong Bài giảng (vì đã có trong file DOCX tải về).
