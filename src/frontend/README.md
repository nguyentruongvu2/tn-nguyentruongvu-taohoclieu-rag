# Document Processing Frontend

React + TypeScript frontend for document processing module in RAG pipeline.

## Features

- **File Upload**: Drag-and-drop and click-to-upload for PDF and DOCX files
- **Real-time Preview**: Display original PDF and converted Markdown side-by-side
- **Markdown Inspection**: View raw Markdown source with copy functionality
- **Error Handling**: Clear error messages for upload and conversion failures
- **Responsive Design**: Works on desktop and tablet devices
- **Type Safety**: Full TypeScript implementation

## Project Structure

```
frontend/
├── src/
│   ├── components/
│   │   ├── DocumentUpload.tsx      # File upload with drag-drop
│   │   ├── PDFViewer.tsx           # PDF preview display
│   │   ├── MarkdownViewer.tsx      # Markdown preview & raw view
│   │   └── ProcessingModal.tsx     # Loading indicator
│   ├── services/
│   │   └── api.ts                  # HTTP API client
│   ├── types/
│   │   └── index.ts                # TypeScript interfaces
│   ├── App.tsx                     # Main application
│   ├── main.tsx                    # React entry point
│   └── index.css                   # Global styles (Tailwind)
├── public/                          # Static assets
├── index.html                       # HTML template
├── vite.config.ts                  # Vite configuration
├── tsconfig.json                   # TypeScript configuration
├── tailwind.config.js              # Tailwind CSS configuration
├── postcss.config.cjs              # PostCSS configuration
├── package.json                    # Dependencies
├── Dockerfile                      # Docker image
├── .dockerignore                   # Docker exclude patterns
└── README.md                        # This file
```

## Installation

### Prerequisites

- Node.js 18+ and npm/yarn
- Backend running on `http://localhost:8000`

### Local Development

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment**:
   ```bash
   cp .env.example .env.local
   ```
   
   Edit `.env.local` if backend is running on different address:
   ```
   VITE_API_BASE_URL=http://localhost:8000
   ```

3. **Run development server**:
   ```bash
   npm run dev
   ```

   Application will be available at `http://localhost:3000`

4. **Build for production**:
   ```bash
   npm run build
   ```

## Usage

1. **Upload a document**:
   - Click the upload area or drag-and-drop a PDF/DOCX file
   - File is sent to backend for processing

2. **Review results**:
   - Left side: Original PDF preview
   - Right side: Converted Markdown content
   - Below: Raw Markdown source

3. **Copy Markdown**:
   - Click "Copy" button to copy Markdown to clipboard
   - Useful for integration with other tools

4. **Upload new document**:
   - Click "Upload New Document" button to start over

## Components

### DocumentUpload
Handles file selection with drag-and-drop support.
- Validates file type (PDF, DOCX)
- Shows visual feedback during upload
- Displays loading state

### PDFViewer
Embeds PDF using iframe for preview.
- Uses native browser PDF viewer
- Error handling for failed loads
- Cleanup of object URLs on unmount

### MarkdownViewer
Displays Markdown content with preview and raw source.
- Renders Markdown using React Markdown
- Styled with Tailwind CSS for clean appearance
- Copy-to-clipboard functionality
- Syntax highlighting for code blocks

### ProcessingModal
Shows loading indicator during backend processing.
- Displays file name being processed
- Shows estimated wait time
- Prevents user interaction during processing

## API Integration

The frontend communicates with FastAPI backend:

- **Upload endpoint**: `POST /documents/upload`
  - Content-Type: `multipart/form-data`
  - Returns Markdown content and metadata

- **Health check**: `GET /documents/health`
  - Verifies backend is running

## Styling

Uses Tailwind CSS for responsive, modern design:

- **Color scheme**: Blue and gray palette
- **Typography**: System font stack
- **Components**: Custom utility classes
- **Responsive**: Mobile, tablet, and desktop views

## Error Handling

Comprehensive error handling for:

- Invalid file types
- Large files (> 50MB)
- Network failures
- Backend processing errors
- PDF loading failures

All errors display user-friendly messages.

## Performance

- **Code splitting**: Vite automatically handles module splitting
- **Lazy loading**: Components load only when needed
- **Image optimization**: TailwindCSS utilities reduce CSS size
- **Build optimization**: Production build minified and optimized

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Mobile browsers (iOS Safari, Chrome Mobile)

## Docker Deployment

Build and run with Docker:

```bash
# Build image
docker build -t doc-processing-frontend .

# Run container
docker run -p 3000:3000 \
  -e VITE_API_BASE_URL=http://backend:8000 \
  doc-processing-frontend
```

## Environment Variables

- `VITE_API_BASE_URL`: Backend API base URL (default: `http://localhost:8000`)
  - Must be accessible from browser
  - In Docker, use service name: `http://backend:8000`

## Troubleshooting

### Frontend can't connect to backend
- Verify backend is running: `curl http://localhost:8000/documents/health`
- Check CORS configuration in backend
- Verify API URL in `.env.local`

### PDF viewer shows blank
- Some browsers require HTTPS for PDF.js
- Try accessing via different browser
- Check browser console for errors

### Build fails
- Clear node_modules: `rm -rf node_modules && npm install`
- Check Node.js version: `node --version` (should be 18+)
- Check for disk space

## Future Enhancements

- [ ] Document preview with thumbnail
- [ ] Batch upload support
- [ ] Markdown editing interface
- [ ] Export options (PDF, HTML, etc.)
- [ ] Processing history
- [ ] User authentication
- [ ] Document comparison tool
