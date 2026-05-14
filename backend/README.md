# Document Processing Backend

FastAPI backend service for document upload and Markdown conversion using Docling.

## Features

- **Document Upload**: Accept PDF and DOCX files via HTTP POST
- **Markdown Conversion**: Convert documents to clean Markdown using Docling library
- **Structure Preservation**: Maintain headers, tables, lists, and document structure
- **Error Handling**: Comprehensive error handling with informative messages
- **Logging**: Detailed logging for debugging and monitoring

## Project Structure

```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py              # FastAPI application entry point
│   ├── config.py            # Configuration and settings
│   └── routes/
│       ├── __init__.py
│       └── documents.py     # Document processing endpoints
├── requirements.txt         # Python dependencies
├── Dockerfile              # Docker image configuration
├── .dockerignore           # Files to exclude from Docker image
└── README.md               # This file
```

## Installation

### Local Development

1. **Create virtual environment**:
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

2. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

3. **Run the server**:
   ```bash
   uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
   ```

The API will be available at `http://localhost:8000`

## API Endpoints

### Upload Document
- **Endpoint**: `POST /documents/upload`
- **Content-Type**: `multipart/form-data`
- **Parameters**: 
  - `file` (binary): PDF or DOCX file

**Request Example**:
```bash
curl -X POST "http://localhost:8000/documents/upload" \
  -H "Content-Type: multipart/form-data" \
  -F "file=@document.pdf"
```

**Response Example**:
```json
{
  "filename": "document_20231215_143022.pdf",
  "markdown_content": "# Document Title\n\n## Section 1\n...",
  "original_filename": "document.pdf",
  "upload_timestamp": "20231215_143022"
}
```

### Health Check
- **Endpoint**: `GET /documents/health`
- **Response**: Service status and configuration

## Configuration

Environment variables (via `.env` file or system environment):

```
UPLOAD_DIR=../uploads              # Directory for temporary file storage
LOG_LEVEL=INFO                      # Logging level (DEBUG, INFO, WARNING, ERROR)
```

## Error Handling

The API returns appropriate HTTP status codes:

- `200 OK`: Successful document processing
- `400 Bad Request`: Invalid file type
- `413 Payload Too Large`: File exceeds size limit
- `422 Unprocessable Entity`: Conversion failed
- `500 Internal Server Error`: Unexpected server error

All errors include detailed messages in JSON format.

## Dependencies

Key dependencies and their purposes:

- **fastapi**: Web framework for building APIs
- **uvicorn**: ASGI server for running FastAPI
- **python-multipart**: Handle multipart/form-data uploads
- **docling**: Document conversion to Markdown
- **pydantic**: Data validation and settings management
- **aiofiles**: Async file operations

## Integration with RAG Pipeline

This module is designed as the first stage of a RAG pipeline. The output Markdown can be:

1. **Chunked** by headers using HierarchicalMarkdownHeaderTextSplitter
2. **Embedded** using vector embedding models (e.g., Google Gemini, OpenAI)
3. **Stored** in vector databases (ChromaDB, Pinecone, etc.)

The Markdown structure preservation is optimized for these downstream operations.

## Docker Deployment

Build and run with Docker:

```bash
# Build image
docker build -t doc-processing-backend .

# Run container
docker run -p 8000:8000 -v $(pwd)/uploads:/app/uploads doc-processing-backend
```

## Troubleshooting

### Common Issues

1. **Docling conversion errors**:
   - Ensure the PDF/DOCX file is not corrupted
   - Check file permissions in the uploads directory
   - Review logs for specific error messages

2. **Port already in use**:
   ```bash
   # Run on different port
   uvicorn app.main:app --port 8001
   ```

3. **CORS errors**:
   - Verify frontend origin is allowed in CORS configuration
   - Update `allow_origins` in `main.py` if needed

## Logging

Logs are output to console with timestamps. Common log levels:

- `DEBUG`: Detailed information for debugging
- `INFO`: General information about processing
- `WARNING`: Warnings about potential issues
- `ERROR`: Error messages with stack traces

## Performance Considerations

- **File size limit**: 50MB default (configurable)
- **Processing time**: Depends on document complexity, typically 1-5 seconds
- **Temporary storage**: Files are deleted after successful conversion

## Future Enhancements

- [ ] Async document processing with Celery
- [ ] Document cache for repeated files
- [ ] Configurable Markdown output options
- [ ] Batch document processing
- [ ] Webhook callbacks for async processing
