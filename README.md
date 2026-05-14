# RAG Teaching Material - Document Processor

📚 Stage 1: Document upload → Markdown conversion → Side-by-side preview

## Features

✅ **PDF & DOCX Support** - Upload either format  
✅ **Smart Conversion** - Tables, headings, formatting preserved  
✅ **Real-time Preview** - Original + Markdown side-by-side  
✅ **Copy-Friendly** - Export raw Markdown from UI  
✅ **Progress Tracking** - Upload feedback with progress bar  

## Tech Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Backend** | FastAPI 0.135 | REST API for document processing |
| **Frontend** | React 18.2 + TypeScript 5.2 | UI with real-time preview |
| **PDF Processing** | pdfplumber 0.11 | Extract text & table structure |
| **DOCX Processing** | python-docx 1.2 | Extract text & formatting |
| **Styling** | Tailwind CSS 3.3 | Modern responsive design |
| **HTTP Client** | Axios 1.6 | Frontend API communication |

## Quick Start

```bash
# Backend (Terminal 1)
cd backend
python -m venv venv && venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload

# Frontend (Terminal 2)
cd frontend
npm install
npm run dev
```

Visit **http://localhost:3000** → Upload file → View conversion ✨

## Project Structure

```
RAG_Teaching_Material/
├── backend/                  # FastAPI application
│   ├── app/
│   │   ├── main.py          # Server entry point
│   │   ├── config.py        # Configuration (paths, limits)
│   │   └── routes/
│   │       └── documents.py # Document processing endpoints
│   └── requirements.txt      # Dependencies (9 packages, no ML libs)
├── frontend/                 # React TypeScript application
│   ├── src/
│   │   ├── App.tsx          # Main component + state
│   │   ├── components/      # UI components
│   │   ├── services/        # API client
│   │   └── types/           # TypeScript interfaces
│   └── package.json         # Dependencies
└── uploads/                  # Uploaded file storage
```

## API Endpoints

```
POST /documents/upload    Upload file + get Markdown
└─ File: multipart/form-data
└─ Returns: { markdown: string, original_filename: string }

GET  /docs                Swagger API documentation (FastAPI)
```

## Configuration

**Backend** (`backend/app/config.py`):
- `UPLOAD_DIR`: `./uploads/`
- `MAX_FILE_SIZE`: 50 MB
- `ALLOWED_EXTENSIONS`: .pdf, .docx

**Frontend** (`frontend/src/services/api.ts`):
- `VITE_API_BASE_URL`: `http://localhost:8000`

## Dependencies

**Backend** - 9 lightweight packages:
```
✓ fastapi               REST framework
✓ uvicorn[standard]     ASGI server
✓ python-multipart      Multipart form handling
✓ pydantic              Validation
✓ pdfplumber            PDF extraction
✓ python-docx           DOCX processing
✓ python-dotenv         Environment variables
✓ aiofiles              Async file ops
```

**Frontend** - Core packages via npm:
```
✓ react                 UI library
✓ typescript            Type safety
✓ vite                  Build tool
✓ tailwindcss           Styling
✓ axios                 HTTP client
✓ react-markdown        Markdown rendering
```

## Usage Example

1. **Open app**: http://localhost:3000
2. **Select file**: Drag & drop or click
3. **View preview**:
   - **Left panel**: Original document
   - **Right panel**: Markdown conversion
   - **Bottom**: Raw Markdown (copyable)
4. **Export**: Copy Markdown text from bottom section

Supported formats:
- 📄 PDF files (.pdf)
- 📝 Word documents (.docx)
- File limit: 50 MB

## Known Limitations

- PDFs with complex layouts: Basic level preservation
- Embedded images: Extracted as metadata references
- Form fields: Treated as regular text
- Password-protected PDFs: Not supported
- Scanned PDFs (image-based): Text extraction limited

These are Stage 1 limitations; future versions will add OCR support.

## Development

**Install dependencies:**
```bash
# Backend
cd backend && pip install -r requirements.txt

# Frontend
cd frontend && npm install
```

**Run in development mode:**
```bash
# Backend with auto-reload
uvicorn app.main:app --reload --port 8000

# Frontend with HMR
npm run dev
```

**Build frontend:**
```bash
cd frontend && npm run build
# Output in: frontend/dist/
```

**Type checking:**
```bash
cd frontend && npx tsc --noEmit
```

## Troubleshooting

### Backend won't start?
```bash
# Check Python version
python --version  # Must be 3.11+

# Verify imports
python -c "from app.main import app; print('OK')"
```

### Frontend build fails?
```bash
# Clear cache & rebuild
rm -r node_modules package-lock.json
npm install
npm run build
```

### Port conflicts?
```bash
# Windows: Find process on port 3000
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# macOS/Linux
lsof -i :3000
kill -9 <PID>
```

### Uploads not working?
- Check `uploads/` directory exists
- Verify file is .pdf or .docx
- File size < 50 MB
- Backend running: `curl http://localhost:8000/docs`

## Next Steps

Future stages could add:
- 🔍 Search across uploaded documents
- 🗂️ Document organization & tagging
- 💾 Save conversion history
- 📊 Statistics & analytics
- 🤖 AI-powered summarization
- 🔗 Vector store integration for RAG

## License

Educational material for teaching purposes.

---

**Status:** ✅ Ready for local development  
**Last Updated:** 2024  
**Stage:** 1 (Document Processing)
