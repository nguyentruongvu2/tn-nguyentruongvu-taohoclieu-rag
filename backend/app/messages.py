"""
messages.py — Centralized Vietnamese string constants for backend responses.

WHY: Prevents Vietnamese strings scattered across route handlers (quiz.py,
     slides.py, auth.py…). All HTTP detail messages reference MSG.* constants.
     Easy to audit, easy to update, and a foundation for future i18n.

USAGE:
    from app.messages import MSG
    raise HTTPException(status_code=502, detail=MSG.quiz.llm_failed)
"""

from __future__ import annotations
from dataclasses import dataclass


@dataclass(frozen=True)
class _QuizMsg:
    llm_failed: str = "Tạo quiz thất bại. Vui lòng thử lại."
    no_valid_questions: str = (
        "Không tạo được câu hỏi hợp lệ. Nội dung bài giảng có thể quá ngắn."
    )
    save_failed: str = "Lưu kết quả thất bại"
    stats_failed: str = "Lấy thống kê thất bại"


@dataclass(frozen=True)
class _SlideMsg:
    pptx_init_failed: str = "python-pptx init failed"
    reportlab_unavailable: str = "reportlab not available"
    export_pptx_failed: str = "Xuất PPTX thất bại."
    export_pdf_failed: str = "Xuất PDF thất bại."
    server_error: str = "Lỗi server."
    no_server: str = "Không kết nối được server."


@dataclass(frozen=True)
class _AuthMsg:
    invalid_session: str = (
        "Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại."
    )
    login_failed: str = "Đăng nhập thất bại."
    register_failed: str = "Đăng ký thất bại."
    permission_denied: str = "Không có quyền truy cập."


@dataclass(frozen=True)
class _CommonMsg:
    server_error: str = "Lỗi máy chủ. Vui lòng thử lại."
    not_found: str = "Không tìm thấy tài nguyên."
    invalid_data: str = "Dữ liệu không hợp lệ."


@dataclass(frozen=True)
class _MSG:
    quiz: _QuizMsg = _QuizMsg()
    slide: _SlideMsg = _SlideMsg()
    auth: _AuthMsg = _AuthMsg()
    common: _CommonMsg = _CommonMsg()


MSG = _MSG()
