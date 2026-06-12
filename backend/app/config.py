"""
Configuration module for FastAPI backend
Handles environment variables and application settings
"""

import os
from pathlib import Path

# Base directory for the application
BASE_DIR = Path(__file__).resolve().parent.parent

# Upload directory configuration
UPLOAD_DIR = os.getenv("UPLOAD_DIR", os.path.abspath(os.path.join(os.path.dirname(__file__), "../../uploads")))
UPLOAD_DIR_PATH = Path(UPLOAD_DIR).resolve()


# Create uploads directory if it doesn't exist
UPLOAD_DIR_PATH.mkdir(parents=True, exist_ok=True)

# FastAPI configuration
API_TITLE = "Document Processing API"
API_VERSION = "1.0.0"
API_DESCRIPTION = "Upload and convert PDF/DOCX documents to Markdown using Docling"

# Allowed file extensions
ALLOWED_EXTENSIONS = {".pdf", ".docx", ".doc"}
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB

# Logging configuration
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
