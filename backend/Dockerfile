# Minimal backend Docker image - services only, no library compilation
FROM python:3.11-slim

WORKDIR /app

# Install minimal system dependencies only
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-vie \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better layer caching
COPY requirements*.txt ./

# Install Python dependencies - lightweight only
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY app app/

# Create uploads directory
RUN mkdir -p uploads

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/docs')" || exit 1

# Run application with Gunicorn for production
# Fallback to 4 workers. You can override WEB_CONCURRENCY in docker-compose
CMD ["gunicorn", "app.main:app", "--workers", "4", "--worker-class", "uvicorn.workers.UvicornWorker", "--bind", "0.0.0.0:8000"]
