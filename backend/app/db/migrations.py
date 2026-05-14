"""Database schema init + incremental migrations."""

from __future__ import annotations

import sqlite3

from .connection import _connect, _column_exists


# ── Column-level migrations ───────────────────────────────────────────────────

def _ensure_auth_user_columns(conn: sqlite3.Connection) -> None:
    migration_statements = [
        ("email", "ALTER TABLE users ADD COLUMN email TEXT"),
        ("status", "ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'pending_verification'))"),
        ("failed_login_attempts", "ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER NOT NULL DEFAULT 0"),
        ("locked_until", "ALTER TABLE users ADD COLUMN locked_until TEXT"),
        ("last_failed_login", "ALTER TABLE users ADD COLUMN last_failed_login TEXT"),
        ("email_verification_token_hash", "ALTER TABLE users ADD COLUMN email_verification_token_hash TEXT"),
        ("email_verification_expires_at", "ALTER TABLE users ADD COLUMN email_verification_expires_at TEXT"),
        ("email_verified_at", "ALTER TABLE users ADD COLUMN email_verified_at TEXT"),
    ]
    for column, statement in migration_statements:
        if not _column_exists(conn, "users", column):
            conn.execute(statement)


def _ensure_project_editor_columns(conn: sqlite3.Connection) -> None:
    project_migrations = [
        ("description", "ALTER TABLE projects ADD COLUMN description TEXT NOT NULL DEFAULT ''"),
        ("knowledge_base_ids_json", "ALTER TABLE projects ADD COLUMN knowledge_base_ids_json TEXT NOT NULL DEFAULT '[]'"),
        ("level", "ALTER TABLE projects ADD COLUMN level TEXT NOT NULL DEFAULT 'basic'"),
        ("format", "ALTER TABLE projects ADD COLUMN format TEXT NOT NULL DEFAULT 'markdown'"),
        ("updated_at", "ALTER TABLE projects ADD COLUMN updated_at TEXT"),
        ("teaching_tone", "ALTER TABLE projects ADD COLUMN teaching_tone TEXT NOT NULL DEFAULT ''"),
    ]
    for column, statement in project_migrations:
        if not _column_exists(conn, "projects", column):
            conn.execute(statement)

    section_migrations = [
        ("retrieved_chunks_json", "ALTER TABLE project_editor_sections ADD COLUMN retrieved_chunks_json TEXT NOT NULL DEFAULT '[]'"),
        ("evaluation_json", "ALTER TABLE project_editor_sections ADD COLUMN evaluation_json TEXT"),
    ]
    for column, statement in section_migrations:
        if not _column_exists(conn, "project_editor_sections", column):
            conn.execute(statement)

    conn.execute("UPDATE projects SET updated_at = COALESCE(updated_at, created_at) WHERE updated_at IS NULL OR TRIM(updated_at) = ''")
    conn.execute("UPDATE project_editor_sections SET retrieved_chunks_json = COALESCE(NULLIF(TRIM(retrieved_chunks_json), ''), '[]') WHERE retrieved_chunks_json IS NULL OR TRIM(retrieved_chunks_json) = ''")


def _ensure_quiz_table(conn: sqlite3.Connection) -> None:
    """Migration: ensure quiz_attempts table exists for older DB files."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS quiz_attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            project_id TEXT,
            score INTEGER NOT NULL,
            total INTEGER NOT NULL,
            percentage REAL NOT NULL,
            num_questions INTEGER NOT NULL,
            variation_seed INTEGER,
            answers_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user_created ON quiz_attempts(user_id, datetime(created_at) DESC)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_quiz_attempts_project ON quiz_attempts(project_id, datetime(created_at) DESC)")


def _ensure_slide_drafts(conn: sqlite3.Connection) -> None:
    """Migration: create slide_drafts table for older DB files."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS slide_drafts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            project_id TEXT NOT NULL,
            title TEXT NOT NULL DEFAULT '',
            slides_json TEXT NOT NULL DEFAULT '[]',
            layouts_json TEXT NOT NULL DEFAULT '{}',
            slide_count INTEGER NOT NULL DEFAULT 0,
            saved_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_slide_drafts_project ON slide_drafts(project_id, datetime(saved_at) DESC)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_slide_drafts_user ON slide_drafts(user_id, datetime(saved_at) DESC)")


def _backfill_user_email(conn: sqlite3.Connection) -> None:
    rows = conn.execute("SELECT id, username FROM users WHERE email IS NULL OR TRIM(email) = ''").fetchall()
    for row in rows:
        username  = str(row["username"] or "user").strip().lower() or "user"
        candidate = f"{username}@local.test"
        suffix    = 1
        while conn.execute(
            "SELECT 1 FROM users WHERE email = ? COLLATE NOCASE AND id != ? LIMIT 1",
            (candidate, int(row["id"])),
        ).fetchone():
            candidate = f"{username}+{suffix}@local.test"
            suffix += 1
        conn.execute("UPDATE users SET email = ? WHERE id = ?", (candidate, int(row["id"])))


def _ensure_chat_multi_document(conn: sqlite3.Connection) -> None:
    if not _column_exists(conn, "chat_conversations", "document_ids_json"):
        conn.execute("ALTER TABLE chat_conversations ADD COLUMN document_ids_json TEXT NOT NULL DEFAULT '[]'")
    
    # Backfill if document_id exists
    conn.execute("""
        UPDATE chat_conversations 
        SET document_ids_json = '["' || document_id || '"]' 
        WHERE document_id IS NOT NULL 
        AND (document_ids_json IS NULL OR document_ids_json = '[]')
    """)


# ── Full schema init ──────────────────────────────────────────────────────────

def init_auth_db() -> None:
    """Create all tables + run incremental migrations."""
    with _connect() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                email TEXT,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('user', 'admin')),
                status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'pending_verification')),
                is_active INTEGER NOT NULL DEFAULT 1,
                failed_login_attempts INTEGER NOT NULL DEFAULT 0,
                locked_until TEXT,
                last_failed_login TEXT,
                email_verification_token_hash TEXT,
                email_verification_expires_at TEXT,
                email_verified_at TEXT,
                created_at TEXT NOT NULL,
                last_login TEXT
            );

            CREATE TABLE IF NOT EXISTS password_reset_tokens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                token_hash TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                used_at TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_hash
            ON password_reset_tokens(token_hash);

            CREATE TABLE IF NOT EXISTS auth_login_attempts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                email TEXT,
                ip_address TEXT,
                success INTEGER NOT NULL,
                reason TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
            );
            CREATE INDEX IF NOT EXISTS idx_auth_login_attempts_created
            ON auth_login_attempts(datetime(created_at) DESC);

            CREATE TABLE IF NOT EXISTS documents (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                original_filename TEXT NOT NULL,
                stored_file_path TEXT,
                source_tag TEXT NOT NULL UNIQUE,
                collection_name TEXT,
                markdown TEXT,
                chunks_count INTEGER NOT NULL DEFAULT 0,
                embeddings_count INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'ready',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS chunks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                document_id TEXT NOT NULL,
                chunk_id TEXT,
                metadata_json TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS generated_content (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                document_id TEXT NOT NULL,
                user_id INTEGER NOT NULL,
                section_id TEXT NOT NULL,
                section_title TEXT NOT NULL,
                content TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(document_id, section_id),
                FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS project_documents (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                title TEXT NOT NULL,
                source_document_ids_json TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS project_sections (
                id TEXT PRIMARY KEY,
                document_id TEXT NOT NULL,
                title TEXT NOT NULL,
                content TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'empty' CHECK(status IN ('empty', 'generated', 'edited')),
                sort_order INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(document_id) REFERENCES project_documents(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS usage_stats (
                user_id INTEGER PRIMARY KEY,
                request_count INTEGER NOT NULL DEFAULT 0,
                llm_calls INTEGER NOT NULL DEFAULT 0,
                token_usage INTEGER NOT NULL DEFAULT 0,
                last_activity TEXT,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS request_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                endpoint TEXT NOT NULL,
                method TEXT NOT NULL,
                status_code INTEGER NOT NULL,
                llm_calls INTEGER NOT NULL DEFAULT 0,
                token_usage INTEGER NOT NULL DEFAULT 0,
                ip_address TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS chat_conversations (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                document_id TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS chat_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
                content TEXT NOT NULL,
                metadata_json TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY(conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_chat_conversations_user_updated
            ON chat_conversations(user_id, datetime(updated_at) DESC);
            CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_created
            ON chat_messages(conversation_id, datetime(created_at) ASC);
            CREATE INDEX IF NOT EXISTS idx_projects_user_created
            ON projects(user_id, datetime(created_at) DESC);
            CREATE INDEX IF NOT EXISTS idx_project_documents_project_updated
            ON project_documents(project_id, datetime(updated_at) DESC);
            CREATE INDEX IF NOT EXISTS idx_project_sections_document_sort
            ON project_sections(document_id, sort_order ASC);

            CREATE TABLE IF NOT EXISTS project_editor_sections (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                title TEXT NOT NULL,
                content_markdown TEXT NOT NULL DEFAULT '',
                prompt TEXT NOT NULL DEFAULT '',
                retrieved_chunks_json TEXT NOT NULL DEFAULT '[]',
                evaluation_json TEXT,
                order_index INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_project_editor_sections_project_order
            ON project_editor_sections(project_id, order_index ASC, datetime(updated_at) DESC);

            CREATE TABLE IF NOT EXISTS quiz_attempts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                project_id TEXT,
                score INTEGER NOT NULL,
                total INTEGER NOT NULL,
                percentage REAL NOT NULL,
                num_questions INTEGER NOT NULL,
                variation_seed INTEGER,
                answers_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
            );
            CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user_created
            ON quiz_attempts(user_id, datetime(created_at) DESC);
            CREATE INDEX IF NOT EXISTS idx_quiz_attempts_project
            ON quiz_attempts(project_id, datetime(created_at) DESC);

            CREATE TABLE IF NOT EXISTS slide_drafts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                project_id TEXT NOT NULL,
                title TEXT NOT NULL DEFAULT '',
                slides_json TEXT NOT NULL DEFAULT '[]',
                layouts_json TEXT NOT NULL DEFAULT '{}',
                slide_count INTEGER NOT NULL DEFAULT 0,
                saved_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
            );
            CREATE INDEX IF NOT EXISTS idx_slide_drafts_project
            ON slide_drafts(project_id, datetime(saved_at) DESC);
            CREATE INDEX IF NOT EXISTS idx_slide_drafts_user
            ON slide_drafts(user_id, datetime(saved_at) DESC);
        """)
        _ensure_auth_user_columns(conn)
        _ensure_project_editor_columns(conn)
        _ensure_quiz_table(conn)
        _ensure_slide_drafts(conn)
        _ensure_chat_multi_document(conn)
        _backfill_user_email(conn)
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_ci ON users(email COLLATE NOCASE)"
        )
