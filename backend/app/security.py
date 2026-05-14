"""JWT auth, RBAC dependencies, and basic rate limiting."""

from __future__ import annotations

import os
import time
import hmac
import hashlib
import base64
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError, InvalidHashError

from .auth_db import get_user_by_id

SECRET_KEY = os.getenv("JWT_SECRET_KEY", "dev-only-change-this-secret")
ALGORITHM = "HS256"
# Keep login session longer in test/staging by default (3 days) to avoid frequent re-login.
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "4320"))
RATE_LIMIT_PER_MINUTE = int(os.getenv("RATE_LIMIT_PER_MINUTE", "120"))

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")
_argon2_hasher = PasswordHasher()

_user_buckets: dict[int, deque[float]] = defaultdict(deque)


def hash_password(password: str) -> str:
    return _argon2_hasher.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    if not hashed_password:
        return False

    if hashed_password.startswith("$argon2"):
        try:
            return bool(_argon2_hasher.verify(hashed_password, plain_password))
        except (VerifyMismatchError, VerificationError, InvalidHashError):
            return False

    # Backward compatibility for previously stored PBKDF2 hashes.
    try:
        scheme, iter_raw, salt_raw, hash_raw = hashed_password.split("$", 3)
        if scheme != "pbkdf2_sha256":
            return False
        iterations = int(iter_raw)
        salt = base64.urlsafe_b64decode(salt_raw.encode("ascii"))
        expected = base64.urlsafe_b64decode(hash_raw.encode("ascii"))
        actual = hashlib.pbkdf2_hmac("sha256", plain_password.encode("utf-8"), salt, iterations)
        return hmac.compare_digest(actual, expected)
    except Exception:
        return False


def create_access_token(subject: dict[str, Any], expires_delta: timedelta | None = None) -> str:
    to_encode = subject.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any] | None:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        return None


def _auth_error(detail: str = "Could not validate credentials") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_user(token: str = Depends(oauth2_scheme)) -> dict[str, Any]:
    payload = decode_access_token(token)
    if not payload:
        raise _auth_error()

    user_id = payload.get("user_id")
    role = payload.get("role")
    if user_id is None or role not in {"user", "admin"}:
        raise _auth_error()

    user = get_user_by_id(int(user_id))
    if not user or not int(user.get("is_active", 0)):
        raise _auth_error("Inactive or missing user")

    return {
        "id": int(user["id"]),
        "username": str(user["username"]),
        "email": str(user.get("email") or ""),
        "role": str(user["role"]),
    }


def require_admin(current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin privileges required")
    return current_user


def enforce_rate_limit(user_id: int) -> None:
    now = time.time()
    q = _user_buckets[user_id]
    window_start = now - 60.0
    while q and q[0] < window_start:
        q.popleft()

    if len(q) >= RATE_LIMIT_PER_MINUTE:
        raise HTTPException(
            status_code=429,
            detail=f"Rate limit exceeded ({RATE_LIMIT_PER_MINUTE}/minute)",
        )
    q.append(now)