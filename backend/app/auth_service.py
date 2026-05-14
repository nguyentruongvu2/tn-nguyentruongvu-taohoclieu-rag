"""Authentication service layer with validation, lockout, and token issuance."""

from __future__ import annotations

import os
import re
import secrets
import hashlib
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException, status
from .auth_db import (
    create_user,
    get_user_by_email,
    get_user_by_username,
    is_account_locked,
    record_auth_login_attempt,
    register_failed_login,
    update_last_login,
    save_password_reset_token,
    get_valid_password_reset_token,
    mark_password_reset_token_used,
    update_user_password,
    update_user_profile,
)
from .security import create_access_token, hash_password, verify_password

PASSWORD_POLICY_RE = re.compile(
    r"^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,128}$"
)

LOGIN_RATE_LIMIT_PER_MINUTE = int(os.getenv("AUTH_LOGIN_RATE_LIMIT_PER_MINUTE", "5"))
REGISTER_RATE_LIMIT_PER_MINUTE = int(os.getenv("AUTH_REGISTER_RATE_LIMIT_PER_MINUTE", "10"))
LOCK_AFTER_FAILED_ATTEMPTS = int(os.getenv("AUTH_LOCK_AFTER_FAILED_ATTEMPTS", "5"))
ACCOUNT_LOCK_MINUTES = int(os.getenv("AUTH_ACCOUNT_LOCK_MINUTES", "15"))
REQUIRE_EMAIL_VERIFICATION = (
    os.getenv("AUTH_REQUIRE_EMAIL_VERIFICATION", "false").strip().lower() == "true"
)
# Keep tokens alive longer by default for integration/UAT sessions (~3 days).
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "4320"))

_login_buckets: dict[str, deque[float]] = defaultdict(deque)
_register_buckets: dict[str, deque[float]] = defaultdict(deque)

# Use a stable hash to reduce timing side-channel differences for unknown emails.
_DUMMY_HASH = hash_password("DummyPassword123!")


def _auth_error(
    status_code: int,
    message: str,
    error_code: str,
    headers: dict[str, str] | None = None,
) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={
            "success": False,
            "message": message,
            "error_code": error_code,
        },
        headers=headers or {},
    )


def _enforce_bucket_rate_limit(
    bucket: dict[str, deque[float]],
    key: str,
    limit_per_minute: int,
) -> None:
    now = datetime.now(timezone.utc).timestamp()
    queue = bucket[key]
    cutoff = now - 60.0
    while queue and queue[0] < cutoff:
        queue.popleft()

    if len(queue) >= max(1, limit_per_minute):
        raise _auth_error(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            message="Bạn thao tác quá nhanh. Vui lòng thử lại sau.",
            error_code="RATE_LIMIT_EXCEEDED",
        )
    queue.append(now)


def _normalize_email(email: str) -> str:
    normalized = str(email or "").strip().lower()
    if not normalized:
        raise _auth_error(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            message="Email không được để trống.",
            error_code="VALIDATION_ERROR",
        )
    if "@" not in normalized:
        raise _auth_error(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            message="Email phải chứa @.",
            error_code="VALIDATION_ERROR",
        )
    return normalized


def _validate_password(password: str) -> None:
    if not PASSWORD_POLICY_RE.match(password or ""):
        raise _auth_error(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            message=(
                "Mật khẩu phải từ 8-128 ký tự, bao gồm ít nhất một chữ hoa, một chữ thường, một số và một ký tự đặc biệt (@$!%*?&)."
            ),
            error_code="WEAK_PASSWORD",
        )


def _build_username_from_email(email: str) -> str:
    local = email.split("@", 1)[0]
    base = re.sub(r"[^a-zA-Z0-9._-]", "", local).strip("._-") or "user"
    candidate = base[:40]
    if not get_user_by_username(candidate):
        return candidate

    for _ in range(20):
        suffix = secrets.token_hex(2)
        with_suffix = f"{candidate[:34]}-{suffix}"
        if not get_user_by_username(with_suffix):
            return with_suffix
    return f"user-{secrets.token_hex(4)}"


def _new_email_verification_token() -> tuple[str, str, str]:
    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    expires_at = datetime.now(timezone.utc) + timedelta(hours=24)
    return token, token_hash, expires_at.isoformat()


def register_user(
    email: str,
    password: str,
    confirm_password: str,
    ip_address: str | None,
) -> dict[str, Any]:
    normalized_email = _normalize_email(email)
    _enforce_bucket_rate_limit(
        _register_buckets,
        f"{ip_address or 'unknown'}:{normalized_email}",
        REGISTER_RATE_LIMIT_PER_MINUTE,
    )
    _validate_password(password)

    if password != confirm_password:
        raise _auth_error(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            message="Mật khẩu xác nhận không khớp.",
            error_code="PASSWORD_MISMATCH",
        )

    existing = get_user_by_email(normalized_email)
    if existing:
        raise _auth_error(
            status_code=status.HTTP_409_CONFLICT,
            message="Không thể đăng ký với thông tin đã cung cấp.",
            error_code="REGISTRATION_FAILED",
        )

    verification_token = None
    verification_hash = None
    verification_expires_at = None
    account_status = "active"
    if REQUIRE_EMAIL_VERIFICATION:
        verification_token, verification_hash, verification_expires_at = _new_email_verification_token()
        account_status = "pending_verification"

    user = create_user(
        username=_build_username_from_email(normalized_email),
        email=normalized_email,
        password_hash=hash_password(password),
        role="user",
        status=account_status,
        email_verification_token_hash=verification_hash,
        email_verification_expires_at=verification_expires_at,
    )

    response: dict[str, Any] = {
        "success": True,
        "message": "Đăng ký thành công.",
        "user": {
            "id": int(user["id"]),
            "email": str(user.get("email") or normalized_email),
            "status": str(user.get("status") or account_status),
            "role": str(user.get("role") or "user"),
        },
    }
    # Expose token only for local testing flows; production should send email.
    if verification_token and os.getenv("AUTH_EXPOSE_VERIFICATION_TOKEN", "false").lower() == "true":
        response["verification_token"] = verification_token
    return response


def login_user(email: str, password: str, ip_address: str | None) -> dict[str, Any]:
    normalized_email = _normalize_email(email)
    _enforce_bucket_rate_limit(
        _login_buckets,
        f"{ip_address or 'unknown'}:{normalized_email}",
        LOGIN_RATE_LIMIT_PER_MINUTE,
    )

    user = get_user_by_email(normalized_email)
    if not user:
        # Constant-time-ish mitigation path for unknown users.
        verify_password(password, _DUMMY_HASH)
        record_auth_login_attempt(
            email=normalized_email,
            ip_address=ip_address,
            success=False,
            reason="invalid_credentials",
            user_id=None,
        )
        raise _auth_error(
            status_code=status.HTTP_401_UNAUTHORIZED,
            message="Email hoặc mật khẩu không đúng.",
            error_code="INVALID_CREDENTIALS",
            headers={"WWW-Authenticate": "Bearer"},
        )

    is_locked, retry_after = is_account_locked(user)
    if is_locked:
        record_auth_login_attempt(
            email=normalized_email,
            ip_address=ip_address,
            success=False,
            reason="account_locked",
            user_id=int(user["id"]),
        )
        raise _auth_error(
            status_code=status.HTTP_423_LOCKED,
            message="Tài khoản tạm thời bị khóa do đăng nhập sai nhiều lần. Vui lòng thử lại sau.",
            error_code="ACCOUNT_LOCKED",
            headers={"Retry-After": str(retry_after)},
        )

    if str(user.get("status") or "active") == "pending_verification":
        raise _auth_error(
            status_code=status.HTTP_403_FORBIDDEN,
            message="Tài khoản chưa xác thực email.",
            error_code="EMAIL_NOT_VERIFIED",
        )

    if not int(user.get("is_active", 0)):
        raise _auth_error(
            status_code=status.HTTP_403_FORBIDDEN,
            message="Tài khoản không khả dụng.",
            error_code="ACCOUNT_INACTIVE",
        )

    if not verify_password(password, str(user["password_hash"])):
        updated = register_failed_login(
            user_id=int(user["id"]),
            lock_after_failures=LOCK_AFTER_FAILED_ATTEMPTS,
            lock_minutes=ACCOUNT_LOCK_MINUTES,
        )
        reason = "invalid_credentials"
        if updated:
            locked_after_fail, _ = is_account_locked(updated)
            if locked_after_fail:
                reason = "locked_after_failures"
        record_auth_login_attempt(
            email=normalized_email,
            ip_address=ip_address,
            success=False,
            reason=reason,
            user_id=int(user["id"]),
        )
        raise _auth_error(
            status_code=status.HTTP_401_UNAUTHORIZED,
            message="Email hoặc mật khẩu không đúng.",
            error_code="INVALID_CREDENTIALS",
            headers={"WWW-Authenticate": "Bearer"},
        )

    update_last_login(int(user["id"]))
    record_auth_login_attempt(
        email=normalized_email,
        ip_address=ip_address,
        success=True,
        reason="ok",
        user_id=int(user["id"]),
    )

    expires_delta = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    token = create_access_token(
        {
            "user_id": int(user["id"]),
            "role": str(user["role"]),
            "username": str(user["username"]),
            "email": str(user.get("email") or normalized_email),
        },
        expires_delta=expires_delta,
    )

    return {
        "success": True,
        "message": "Đăng nhập thành công.",
        "data": {
            "access_token": token,
            "token_type": "bearer",
            "expires_in": int(expires_delta.total_seconds()),
            "user": {
                "user_id": int(user["id"]),
                "username": str(user["username"]),
                "email": str(user.get("email") or normalized_email),
                "role": str(user["role"]),
            },
        },
    }


def request_password_reset(email: str, ip_address: str | None) -> dict[str, Any]:
    normalized_email = _normalize_email(email)
    user = get_user_by_email(normalized_email)
    
    if not user:
        return {
            "success": True,
            "message": "Nếu email hợp lệ, hướng dẫn khôi phục mật khẩu sẽ được gửi đến bạn."
        }
    
    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    expires_at = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    
    save_password_reset_token(int(user["id"]), token_hash, expires_at)
    
    # In a real system we'd send an email here.
    print(f"PASSWORD RESET LINK: /reset-password?token={token}")
    
    response: dict[str, Any] = {
        "success": True,
        "message": "Nếu email hợp lệ, hướng dẫn khôi phục mật khẩu sẽ được gửi đến bạn."
    }
    if os.getenv("AUTH_EXPOSE_VERIFICATION_TOKEN", "false").lower() == "true":
        response["reset_token"] = token
        
    return response


def confirm_password_reset(token: str, new_password: str, confirm_password: str) -> dict[str, Any]:
    if new_password != confirm_password:
        raise _auth_error(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            message="Mật khẩu xác nhận không khớp.",
            error_code="PASSWORD_MISMATCH",
        )
        
    _validate_password(new_password)
    
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    reset_record = get_valid_password_reset_token(token_hash)
    
    if not reset_record:
        raise _auth_error(
            status_code=status.HTTP_400_BAD_REQUEST,
            message="Mã khôi phục không hợp lệ hoặc đã hết hạn.",
            error_code="INVALID_TOKEN",
        )
        
    user_id = int(reset_record["user_id"])
    hashed_pw = hash_password(new_password)
    update_user_password(user_id, hashed_pw)
    mark_password_reset_token_used(int(reset_record["id"]))
    
    return {
        "success": True,
        "message": "Mật khẩu đã được cập nhật thành công. Vui lòng đăng nhập bằng mật khẩu mới."
    }


def update_my_profile(user_id: int, username: str | None, email: str | None) -> dict[str, Any]:
    # Check for email collision
    if email:
        normalized_email = _normalize_email(email)
        existing = get_user_by_email(normalized_email)
        if existing and existing["id"] != user_id:
            raise _auth_error(
                status_code=status.HTTP_409_CONFLICT,
                message="Email này đã được sử dụng bởi người dùng khác.",
                error_code="EMAIL_IN_USE",
            )
        email = normalized_email

    # Check for username collision
    if username:
        username = username.strip()
        existing = get_user_by_username(username)
        if existing and existing["id"] != user_id:
            raise _auth_error(
                status_code=status.HTTP_409_CONFLICT,
                message="Tên người dùng này đã được sử dụng.",
                error_code="USERNAME_IN_USE",
            )

    updated_user = update_user_profile(user_id, username, email)
    if not updated_user:
        raise _auth_error(
            status_code=status.HTTP_404_NOT_FOUND,
            message="Không tìm thấy người dùng.",
            error_code="USER_NOT_FOUND",
        )
        
    return {
        "success": True,
        "message": "Cập nhật thông tin thành công.",
        "user": {
            "user_id": int(updated_user["id"]),
            "username": str(updated_user["username"]),
            "email": str(updated_user.get("email") or ""),
            "role": str(updated_user["role"]),
        }
    }


def update_my_password(user_id: int, old_password: str, new_password: str, confirm_password: str) -> dict[str, Any]:
    from .auth_db import get_user_by_id
    user = get_user_by_id(user_id)
    if not user:
        raise _auth_error(
            status_code=status.HTTP_404_NOT_FOUND,
            message="Không tìm thấy người dùng.",
            error_code="USER_NOT_FOUND",
        )

    if not verify_password(old_password, user["password_hash"]):
        raise _auth_error(
            status_code=status.HTTP_401_UNAUTHORIZED,
            message="Mật khẩu cũ không chính xác.",
            error_code="INVALID_OLD_PASSWORD",
        )

    if new_password != confirm_password:
        raise _auth_error(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            message="Mật khẩu xác nhận không khớp.",
            error_code="PASSWORD_MISMATCH",
        )

    _validate_password(new_password)
    
    hashed_pw = hash_password(new_password)
    update_user_password(user_id, hashed_pw)
    
    return {
        "success": True,
        "message": "Cập nhật mật khẩu thành công."
    }
