# API Endpoints Cần Thiết cho RAG Teaching Material Editor

## 🎯 Phần I: Project Management (Danh sách bài giảng)

### 1. Lấy danh sách tất cả dự án bài giảng

```
GET /api/teaching-projects
Response: Array<{
  id: string;
  title: string;
  description: string;
  created_at: string;
  updated_at: string;
  sections_count: number;
  knowledge_bases: string[];  // IDs
  level: "CB" | "TC" | "NC";  // Cơ bản, Trung cấp, Nâng cao
  format: "MD" | "PDF" | "DOCX";
}>
```

### 2. Tạo dự án bài giảng mới

```
POST /api/teaching-projects
Request: {
  title: string;
  description: string;
  knowledge_bases: string[];  // IDs of selected knowledge bases
  level: "CB" | "TC" | "NC";
  format: "MD" | "PDF" | "DOCX";
}
Response: {
  id: string;
  title: string;
  created_at: string;
  // Khởi tạo 1 section mặc định (Mục tiêu) để bắt đầu
}
```

### 3. Lấy chi tiết 1 dự án (Project Detail + Sections)

```
GET /api/teaching-projects/:id
Response: {
  id: string;
  title: string;
  description: string;
  sections: Array<{
    id: string;
    title: string;
    prompt: string;
    content: string;  // Markdown
    order: number;
    created_at: string;
    updated_at: string;
  }>;
  knowledge_bases: string[];
  level: string;
  format: string;
}
```

### 4. Cập nhật tên/mô tả dự án

```
PATCH /api/teaching-projects/:id
Request: {
  title?: string;
  description?: string;
}
Response: { success: boolean }
```

### 5. Xóa dự án

```
DELETE /api/teaching-projects/:id
Response: { success: boolean }
```

---

## 📚 Phần II: Section Management (Quản lý sections trong Editor)

### 6. Thêm section mới

```
POST /api/teaching-projects/:id/sections
Request: {
  title: string;
  prompt?: string;
  order?: number;
}
Response: {
  id: string;
  title: string;
  prompt: string;
  content: "";
  order: number;
}
```

### 7. Cập nhật section (Title, Prompt, Content, Order)

```
PATCH /api/teaching-projects/:id/sections/:sectionId
Request: {
  title?: string;
  prompt?: string;
  content?: string;
  order?: number;
}
Response: { success: boolean }
```

### 8. Xóa section

```
DELETE /api/teaching-projects/:id/sections/:sectionId
Response: { success: boolean }
```

### 9. Reorder sections (Drag & Drop)

```
PATCH /api/teaching-projects/:id/sections/reorder
Request: {
  sections: Array<{ id: string; order: number }>;
}
Response: { success: boolean }
```

---

## 🤖 Phần III: AI Generation (Tạo nội dung bằng AI + RAG)

### 10. Generate nội dung cho 1 section (Streaming/WebSocket)

```
POST /api/teaching-projects/:id/sections/:sectionId/generate
Request: {
  prompt: string;
  knowledge_bases?: string[];  // IDs (optional: override project's default)
}
Response Stream: {
  type: "streaming";
  data: "Đây là nội dung được tạo bởi AI..."
}
```

_Hoặc dùng WebSocket cho streaming realtime thay vì streaming HTTP_

### 11. Lấy chunks liên quan (Knowledge Base Context)

```
GET /api/teaching-projects/:id/sections/:sectionId/chunks
Query: ?prompt=...
Response: Array<{
  id: string;
  text: string;
  relevance: number;  // 0-100
  source_file: string;
  page_number?: number;
}>
```

### 12. Xem chi tiết 1 chunk (Source file)

```
GET /api/chunks/:chunkId/detail
Response: {
  id: string;
  text: string;
  source_file: string;
  page_number: number;
  related_chunks: string[];  // IDs
}
```

---

## 📥 Phần IV: Export (Xuất file)

### 13. Xuất Markdown

```
GET /api/teaching-projects/:id/export/markdown
Response: Markdown file (.md)
Header: Content-Type: text/markdown
```

### 14. Xuất PDF

```
GET /api/teaching-projects/:id/export/pdf
Response: PDF file (.pdf)
Header: Content-Type: application/pdf
```

### 15. Xuất DOCX (Optional)

```
GET /api/teaching-projects/:id/export/docx
Response: Word file (.docx)
Header: Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document
```

---

## 💾 Phần V: Auto-Save (Lưu ngầm)

### 16. Auto-save section nội dung (Debounced)

```
PATCH /api/teaching-projects/:id/sections/:sectionId/auto-save
Request: {
  content: string;
  title?: string;
  prompt?: string;
}
Response: {
  success: boolean;
  updated_at: string;
  version?: number;  // Cho conflict resolution sau này
}
```

---

## 🔍 Phần VI: Knowledge Base Selection

### 17. Lấy danh sách Knowledge Bases (cho modal tạo project)

```
GET /api/knowledge-bases
Response: Array<{
  id: string;
  name: string;
  description: string;
  document_count: number;
  chunk_count: number;
  created_at: string;
}>
```

### 18. Lấy chi tiết 1 Knowledge Base

```
GET /api/knowledge-bases/:id
Response: {
  id: string;
  name: string;
  description: string;
  documents: Array<{
    id: string;
    filename: string;
    upload_date: string;
  }>;
  total_chunks: number;
}
```

---

## 📋 Summary Table

| Feature              | Method | Endpoint                                                  | Priority  |
| -------------------- | ------ | --------------------------------------------------------- | --------- |
| List Projects        | GET    | `/api/teaching-projects`                                  | 🔴 HIGH   |
| Create Project       | POST   | `/api/teaching-projects`                                  | 🔴 HIGH   |
| Get Project Detail   | GET    | `/api/teaching-projects/:id`                              | 🔴 HIGH   |
| Update Project       | PATCH  | `/api/teaching-projects/:id`                              | 🟡 MEDIUM |
| Delete Project       | DELETE | `/api/teaching-projects/:id`                              | 🟡 MEDIUM |
| Add Section          | POST   | `/api/teaching-projects/:id/sections`                     | 🔴 HIGH   |
| Update Section       | PATCH  | `/api/teaching-projects/:id/sections/:sectionId`          | 🔴 HIGH   |
| Delete Section       | DELETE | `/api/teaching-projects/:id/sections/:sectionId`          | 🟡 MEDIUM |
| Reorder Sections     | PATCH  | `/api/teaching-projects/:id/sections/reorder`             | 🟡 MEDIUM |
| Generate Content     | POST   | `/api/teaching-projects/:id/sections/:sectionId/generate` | 🔴 HIGH   |
| Get Chunks           | GET    | `/api/teaching-projects/:id/sections/:sectionId/chunks`   | 🔴 HIGH   |
| Export Markdown      | GET    | `/api/teaching-projects/:id/export/markdown`              | 🔴 HIGH   |
| Export PDF           | GET    | `/api/teaching-projects/:id/export/pdf`                   | 🟡 MEDIUM |
| List Knowledge Bases | GET    | `/api/knowledge-bases`                                    | 🔴 HIGH   |

---

## 🛠️ Technology Stack Recommendations

### Backend Framework

- **FastAPI** (Python): Async, WebSocket support, auto-docs
- **Node.js + Express**: TypeScript friendly
- **Django + DRF**: Mature, ORM with migrations

### Streaming

- **Server-Sent Events (SSE)**: Simple for text streaming
- **WebSocket**: Better for bi-directional communication
- **gRPC**: High-performance alternative

### Database

- **PostgreSQL** + **SQLAlchemy/Prisma**: Structured data
- **MongoDB**: Flexible schema (nếu documents động)

### Vector DB (for RAG)

- **Pinecone**: Managed, easy to scale
- **Weaviate**: Open-source, powerful
- **Milvus**: High-performance, open-source

---

## 📡 Error Handling

Tất cả endpoints nên return:

```json
{
  "success": boolean,
  "data": any,
  "error": {
    "code": string,
    "message": string,
    "details": any
  }
}
```

Common error codes:

- `PROJECT_NOT_FOUND`
- `SECTION_NOT_FOUND`
- `INVALID_PROMPT`
- `AI_GENERATION_FAILED`
- `KNOWLEDGE_BASE_NOT_FOUND`
- `EXPORT_FAILED`
