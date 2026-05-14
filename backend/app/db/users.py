"""User authentication & account management CRUD."""

from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Any

from .connection import _connect, _utc_now


def create_user(
    username: str,
    password_hash: str,
    role: str = "user",
    email: str | None = None,
    status: str = "active",
    email_verification_token_hash: str | None = None,
    email_verification_expires_at: str | None = None,
) -> dict[str, Any]:
    now              = _utc_now()
    normalized_email = (email or "").strip().lower() or None
    with _connect() as conn:
        cur = conn.execute(
            """
            INSERT INTO users(
                username, email, password_hash, role, status,
                email_verification_token_hash, email_verification_expires_at,
                email_verified_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                username.strip(),
                normalized_email,
                password_hash,
                role,
                status,
                email_verification_token_hash,
                email_verification_expires_at,
                now if status == "active" else None,
                now,
            ),
        )
        user_id = int(cur.lastrowid)
    return get_user_by_id(user_id)


def get_user_by_username(username: str) -> dict[str, Any] | None:
    with _connect() as conn:
        row = conn.execute("SELECT * FROM users WHERE username = ?", (username.strip(),)).fetchone()
    return dict(row) if row else None


def get_user_by_email(email: str) -> dict[str, Any] | None:
    normalized = email.strip().lower()
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE email = ? COLLATE NOCASE", (normalized,)
        ).fetchone()
    return dict(row) if row else None


def get_user_by_id(user_id: int) -> dict[str, Any] | None:
    with _connect() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return dict(row) if row else None


def list_users() -> list[dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT u.id, u.username, u.email, u.role, u.status, u.is_active,
                   u.created_at, u.last_login, u.failed_login_attempts, u.locked_until,
                   COALESCE(us.request_count, 0) AS request_count,
                   COALESCE(us.llm_calls, 0) AS llm_calls,
                   COALESCE(us.token_usage, 0) AS token_usage,
                   us.last_activity
            FROM users u
            LEFT JOIN usage_stats us ON us.user_id = u.id
            ORDER BY datetime(u.created_at) DESC
            """
        ).fetchall()
    return [dict(r) for r in rows]


def update_last_login(user_id: int) -> None:
    with _connect() as conn:
        conn.execute(
            "UPDATE users SET last_login = ?, failed_login_attempts = 0, locked_until = NULL WHERE id = ?",
            (_utc_now(), user_id),
        )


def register_failed_login(
    user_id: int,
    lock_after_failures: int = 5,
    lock_minutes: int = 15,
) -> dict[str, Any] | None:
    now     = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    with _connect() as conn:
        row = conn.execute(
            "SELECT failed_login_attempts FROM users WHERE id = ?", (user_id,)
        ).fetchone()
        if not row:
            return None
        attempts     = int(row["failed_login_attempts"] or 0) + 1
        locked_until = None
        if attempts >= max(1, lock_after_failures):
            locked_until = (now + timedelta(minutes=max(1, lock_minutes))).isoformat()
            attempts     = 0
        conn.execute(
            "UPDATE users SET failed_login_attempts = ?, locked_until = ?, last_failed_login = ? WHERE id = ?",
            (attempts, locked_until, now_iso, user_id),
        )
    return get_user_by_id(user_id)


def reset_failed_login_attempts(user_id: int) -> None:
    with _connect() as conn:
        conn.execute(
            "UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?",
            (user_id,),
        )


def is_account_locked(user: dict[str, Any]) -> tuple[bool, int]:
    raw = str(user.get("locked_until") or "").strip()
    if not raw:
        return (False, 0)
    try:
        locked_until = datetime.fromisoformat(raw)
    except Exception:
        return (False, 0)
    now = datetime.now(timezone.utc)
    if locked_until.tzinfo is None:
        locked_until = locked_until.replace(tzinfo=timezone.utc)
    if locked_until <= now:
        return (False, 0)
    return (True, max(1, int((locked_until - now).total_seconds())))


def record_auth_login_attempt(
    email: str,
    ip_address: str | None,
    success: bool,
    reason: str,
    user_id: int | None = None,
) -> None:
    with _connect() as conn:
        conn.execute(
            "INSERT INTO auth_login_attempts(user_id, email, ip_address, success, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (user_id, (email or "").strip().lower(), ip_address, 1 if success else 0, reason, _utc_now()),
        )


def any_admin_exists() -> bool:
    with _connect() as conn:
        row = conn.execute("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").fetchone()
    return row is not None


def set_user_active(user_id: int, is_active: bool) -> dict[str, Any] | None:
    with _connect() as conn:
        cur = conn.execute(
            "UPDATE users SET is_active = ? WHERE id = ?", (1 if is_active else 0, user_id)
        )
        if cur.rowcount <= 0:
            return None
    return get_user_by_id(user_id)


def count_admin_users() -> int:
    with _connect() as conn:
        row = conn.execute("SELECT COUNT(*) AS total FROM users WHERE role = 'admin'").fetchone()
    return int(row["total"]) if row else 0


def delete_user_by_id(user_id: int) -> bool:
    with _connect() as conn:
        cur = conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
        return cur.rowcount > 0


def save_password_reset_token(user_id: int, token_hash: str, expires_at: str) -> None:
    with _connect() as conn:
        conn.execute(
            "INSERT INTO password_reset_tokens(user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)",
            (user_id, token_hash, expires_at, _utc_now()),
        )


def get_valid_password_reset_token(token_hash: str) -> dict[str, Any] | None:
    now = _utc_now()
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM password_reset_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?",
            (token_hash, now)
        ).fetchone()
    return dict(row) if row else None


def mark_password_reset_token_used(token_id: int) -> None:
    with _connect() as conn:
        conn.execute(
            "UPDATE password_reset_tokens SET used_at = ? WHERE id = ?",
            (_utc_now(), token_id),
        )


def update_user_password(user_id: int, password_hash: str) -> bool:
    with _connect() as conn:
        cur = conn.execute(
            "UPDATE users SET password_hash = ? WHERE id = ?",
            (password_hash, user_id),
        )
        return cur.rowcount > 0


def update_user_profile(user_id: int, username: str | None, email: str | None) -> dict[str, Any] | None:
    updates = []
    params = []
    if username is not None:
        updates.append("username = ?")
        params.append(username.strip())
    if email is not None:
        updates.append("email = ?")
        params.append(email.strip().lower())
    
    if not updates:
        return get_user_by_id(user_id)
        
    params.append(user_id)
    query = f"UPDATE users SET {', '.join(updates)} WHERE id = ?"
    
    with _connect() as conn:
        conn.execute(query, tuple(params))
        
    return get_user_by_id(user_id)
