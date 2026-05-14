"""Routes package for FastAPI application.

Exports the currently supported routers only.
"""

from . import auth, convert, project_rag, quiz, secure_rag, slides

__all__ = ["auth", "convert", "project_rag", "quiz", "secure_rag", "slides"]
