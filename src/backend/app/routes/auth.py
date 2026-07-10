"""Authentication and admin monitoring routes."""

from __future__ import annotations

from pathlib import Path
import shutil

from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile, File
from fastapi.responses import FileResponse
from ..config import UPLOAD_DIR_PATH

from ..auth_db import (
    count_admin_users,
    delete_user_by_id,
    delete_document,
    get_user_by_id,
    list_documents_by_user,
    list_documents,
    list_logs,
    list_usage,
    list_users,
    set_user_active,
    update_user_profile,
    get_admin_dashboard_stats,
)
from ..auth_service import (
    login_user,
    register_user,
    request_password_reset,
    confirm_password_reset,
    update_my_profile,
    update_my_password,
)
from ..rag_pipeline import rag_pipeline
from ..security import (
    get_current_user,
    require_admin,
)

router = APIRouter(tags=["auth"])


class RegisterRequest(BaseModel):
    email: str
    password: str = Field(min_length=8, max_length=128)
    confirm_password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    email: str
    password: str


class RegisterResponse(BaseModel):
    success: bool
    message: str
    user: dict


class LoginResponse(BaseModel):
    success: bool
    message: str
    data: dict


class ForgotPasswordRequest(BaseModel):
    email: str


class ResetPasswordRequest(BaseModel):
    token: str
    password: str = Field(min_length=8, max_length=128)
    confirm_password: str = Field(min_length=8, max_length=128)


class SimpleResponse(BaseModel):
    success: bool
    message: str


class UpdateProfileRequest(BaseModel):
    username: str | None = None
    email: str | None = None
    avatar_url: str | None = None


class UpdatePasswordRequest(BaseModel):
    old_password: str
    new_password: str = Field(min_length=8, max_length=128)
    confirm_password: str = Field(min_length=8, max_length=128)


class UserLockRequest(BaseModel):
    locked: bool


def _cleanup_document_artifacts(document: dict) -> int:
    """Delete vector chunks and uploaded file for a document before DB cascade."""
    source_tag = str(document.get("source_tag") or "")
    collection_name = str(document.get("collection_name") or "") or None

    chunk_delete_result = rag_pipeline.delete_chunks_by_source(
        source_tag=source_tag,
        collection_name=collection_name,
    )
    if not chunk_delete_result.get("success", False):
        remaining = int(chunk_delete_result.get("remaining_count", 0) or 0)
        raise HTTPException(
            status_code=500,
            detail=f"Chunks were not fully deleted for document {document.get('id')} (remaining={remaining})",
        )

    stored_file_path = str(document.get("stored_file_path") or "").strip()
    if stored_file_path:
        try:
            file_path = Path(stored_file_path).resolve()
            if file_path.exists() and file_path.is_file():
                file_path.unlink()
        except Exception:
            # Keep DB cleanup path resilient even when file is already gone.
            pass

    return int(chunk_delete_result.get("deleted_count", 0) or 0)


def _cleanup_user_upload_dirs(user_id: int) -> int:
    """Best-effort cleanup for user upload directories under common roots."""
    routes_dir = Path(__file__).resolve().parent
    candidates = {
        (routes_dir / "../../uploads/users" / str(user_id)).resolve(),
        (routes_dir / "../../../uploads/users" / str(user_id)).resolve(),
    }

    removed_dirs = 0
    for user_dir in candidates:
        if not user_dir.exists() or not user_dir.is_dir():
            continue
        try:
            shutil.rmtree(user_dir, ignore_errors=False)
            removed_dirs += 1
        except Exception:
            # Keep account deletion resilient even if file cleanup partially fails.
            pass
    return removed_dirs


@router.post("/register", response_model=RegisterResponse)
async def register(payload: RegisterRequest, request: Request):
    return register_user(
        email=str(payload.email),
        password=payload.password,
        confirm_password=payload.confirm_password,
        ip_address=request.client.host if request.client else None,
    )


@router.post("/login", response_model=LoginResponse)
async def login(payload: LoginRequest, request: Request):
    return login_user(
        email=str(payload.email),
        password=payload.password,
        ip_address=request.client.host if request.client else None,
    )


@router.post("/forgot-password", response_model=SimpleResponse)
async def forgot_password(payload: ForgotPasswordRequest, request: Request):
    return request_password_reset(
        email=str(payload.email),
        ip_address=request.client.host if request.client else None,
    )


@router.post("/reset-password", response_model=SimpleResponse)
async def reset_password(payload: ResetPasswordRequest):
    return confirm_password_reset(
        token=payload.token,
        new_password=payload.password,
        confirm_password=payload.confirm_password,
    )


@router.get("/me")
async def me(current_user: dict = Depends(get_current_user)):
    return {"success": True, "user": current_user}


@router.patch("/me/profile")
async def update_profile(
    payload: UpdateProfileRequest,
    current_user: dict = Depends(get_current_user),
):
    return update_my_profile(
        user_id=int(current_user["id"]),
        username=payload.username,
        email=payload.email,
        avatar_url=payload.avatar_url,
    )


@router.patch("/me/password", response_model=SimpleResponse)
async def update_password(
    payload: UpdatePasswordRequest,
    current_user: dict = Depends(get_current_user),
):
    return update_my_password(
        user_id=int(current_user["id"]),
        old_password=payload.old_password,
        new_password=payload.new_password,
        confirm_password=payload.confirm_password,
    )


@router.get("/admin/users")
async def admin_users(_: dict = Depends(require_admin)):
    return {"success": True, "users": list_users()}


@router.get("/admin/stats")
async def admin_stats(_: dict = Depends(require_admin)):
    stats = get_admin_dashboard_stats()
    return {"success": True, "stats": stats}


@router.get("/admin/documents")
async def admin_documents(admin_user: dict = Depends(require_admin)):
    docs = list_documents(user_id=admin_user["id"], role="admin")
    # Dynamically read file size from disk for each document
    for doc in docs:
        file_path = doc.get("stored_file_path")
        file_size = 0
        if file_path:
            try:
                p = Path(file_path)
                if p.exists():
                    file_size = p.stat().st_size
            except Exception:
                pass
        doc["file_size"] = file_size
    return {"success": True, "documents": docs}


@router.get("/admin/usage")
async def admin_usage(_: dict = Depends(require_admin)):
    return {"success": True, "usage": list_usage()}


@router.get("/admin/logs")
async def admin_logs(
    limit: int = Query(200, ge=1, le=1000),
    _: dict = Depends(require_admin),
):
    return {"success": True, "logs": list_logs(limit=limit)}


@router.delete("/admin/documents/{document_id}")
async def admin_delete_document(document_id: str, _: dict = Depends(require_admin)):
    deleted = delete_document(document_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"success": True, "message": "Document deleted"}


@router.patch("/admin/users/{user_id}/lock")
async def admin_lock_user(
    user_id: int,
    payload: UserLockRequest,
    admin_user: dict = Depends(require_admin),
):
    target_user = get_user_by_id(user_id)
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")

    if payload.locked and user_id == int(admin_user["id"]):
        raise HTTPException(status_code=400, detail="Cannot lock your own account")

    is_target_admin = str(target_user.get("role", "")) == "admin"
    is_target_active = bool(int(target_user.get("is_active", 0)))
    if payload.locked and is_target_admin and is_target_active and count_admin_users() <= 1:
        raise HTTPException(status_code=400, detail="Cannot lock the last admin account")

    updated_user = set_user_active(user_id, is_active=not payload.locked)
    if not updated_user:
        raise HTTPException(status_code=500, detail="Failed to update user status")

    return {
        "success": True,
        "user": {
            "id": int(updated_user["id"]),
            "username": str(updated_user["username"]),
            "role": str(updated_user["role"]),
            "is_active": bool(int(updated_user["is_active"])),
        },
        "message": "User locked" if payload.locked else "User unlocked",
    }


@router.delete("/admin/users/{user_id}")
async def admin_delete_user(
    user_id: int,
    admin_user: dict = Depends(require_admin),
):
    if user_id == int(admin_user["id"]):
        raise HTTPException(status_code=400, detail="Cannot delete your own account")

    target_user = get_user_by_id(user_id)
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")

    if str(target_user.get("role", "")) == "admin" and count_admin_users() <= 1:
        raise HTTPException(status_code=400, detail="Cannot delete the last admin account")

    user_documents = list_documents_by_user(user_id)
    deleted_chunks = 0
    for document in user_documents:
        deleted_chunks += _cleanup_document_artifacts(document)

    removed_upload_dirs = _cleanup_user_upload_dirs(user_id)

    deleted = delete_user_by_id(user_id)
    if not deleted:
        raise HTTPException(status_code=500, detail="Failed to delete user")

    return {
        "success": True,
        "user_id": user_id,
        "documents_deleted": len(user_documents),
        "chunks_deleted": deleted_chunks,
        "upload_dirs_deleted": removed_upload_dirs,
        "message": "User and related data deleted",
    }


@router.post("/me/avatar")
async def upload_avatar(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    # Validate extension
    ext = Path(file.filename or "").suffix.lower()
    if ext not in {".png", ".jpg", ".jpeg", ".webp", ".gif"}:
        raise HTTPException(
            status_code=400,
            detail="Định dạng ảnh không hợp lệ. Chỉ hỗ trợ PNG, JPG, JPEG, WEBP, GIF."
        )

    user_id = current_user["id"]
    avatar_dir = UPLOAD_DIR_PATH / "users" / str(user_id) / "avatar"

    # Recreate dir to clean up old avatar with different extension
    if avatar_dir.exists():
        shutil.rmtree(avatar_dir)
    avatar_dir.mkdir(parents=True, exist_ok=True)

    filename = f"avatar{ext}"
    target_file = avatar_dir / filename

    try:
        with open(target_file, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Không thể lưu file ảnh: {exc}"
        )

    # Relative path is stored in database
    avatar_url = f"/api/auth/profile/avatar/{user_id}"
    update_user_profile(user_id=user_id, avatar_url=avatar_url)

    return {
        "success": True,
        "message": "Cập nhật ảnh đại diện thành công.",
        "avatar_url": avatar_url
    }


@router.get("/profile/avatar/{user_id}")
async def get_avatar(user_id: int):
    avatar_dir = UPLOAD_DIR_PATH / "users" / str(user_id) / "avatar"
    if avatar_dir.exists() and avatar_dir.is_dir():
        for f in avatar_dir.iterdir():
            if f.is_file() and f.name.startswith("avatar."):
                return FileResponse(str(f))
    raise HTTPException(status_code=404, detail="Avatar không tồn tại.")