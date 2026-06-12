"""Database schema init + incremental migrations for PostgreSQL."""

from __future__ import annotations

from .connection import _connect, _column_exists, _table_exists


# ── Column-level migrations ───────────────────────────────────────────────────

def _ensure_auth_user_columns(conn) -> None:
    migration_statements = [
        ("email",                          "ALTER TABLE users ADD COLUMN email TEXT"),
        ("status",                         "ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'pending_verification'))"),
        ("failed_login_attempts",          "ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER NOT NULL DEFAULT 0"),
        ("locked_until",                   "ALTER TABLE users ADD COLUMN locked_until TIMESTAMPTZ"),
        ("last_failed_login",              "ALTER TABLE users ADD COLUMN last_failed_login TIMESTAMPTZ"),
        ("email_verification_token_hash",  "ALTER TABLE users ADD COLUMN email_verification_token_hash TEXT"),
        ("email_verification_expires_at",  "ALTER TABLE users ADD COLUMN email_verification_expires_at TIMESTAMPTZ"),
        ("email_verified_at",              "ALTER TABLE users ADD COLUMN email_verified_at TIMESTAMPTZ"),
        ("avatar_url",                     "ALTER TABLE users ADD COLUMN avatar_url TEXT"),
    ]
    for column, statement in migration_statements:
        if not _column_exists(conn, "users", column):
            conn.execute(statement)


def _ensure_project_editor_columns(conn) -> None:
    project_migrations = [
        ("description",             "ALTER TABLE projects ADD COLUMN description TEXT NOT NULL DEFAULT ''"),
        ("knowledge_base_ids_json", "ALTER TABLE projects ADD COLUMN knowledge_base_ids_json JSONB NOT NULL DEFAULT '[]'"),
        ("level",                   "ALTER TABLE projects ADD COLUMN level TEXT NOT NULL DEFAULT 'basic'"),
        ("format",                  "ALTER TABLE projects ADD COLUMN format TEXT NOT NULL DEFAULT 'markdown'"),
        ("updated_at",              "ALTER TABLE projects ADD COLUMN updated_at TIMESTAMPTZ"),
        ("teaching_tone",           "ALTER TABLE projects ADD COLUMN teaching_tone TEXT NOT NULL DEFAULT ''"),
        ("syllabus_doc_id",         "ALTER TABLE projects ADD COLUMN syllabus_doc_id TEXT REFERENCES documents(id) ON DELETE SET NULL"),
    ]
    for column, statement in project_migrations:
        if not _column_exists(conn, "projects", column):
            conn.execute(statement)

    section_migrations = [
        ("retrieved_chunks_json", "ALTER TABLE project_editor_sections ADD COLUMN retrieved_chunks_json JSONB NOT NULL DEFAULT '[]'"),
        ("evaluation_json",       "ALTER TABLE project_editor_sections ADD COLUMN evaluation_json JSONB"),
    ]
    for column, statement in section_migrations:
        if not _column_exists(conn, "project_editor_sections", column):
            conn.execute(statement)

    conn.execute("UPDATE projects SET updated_at = COALESCE(updated_at, created_at) WHERE updated_at IS NULL")


def _ensure_project_editor_history_table(conn) -> None:
    if not _table_exists(conn, "project_editor_history"):
        conn.execute("""
            CREATE TABLE project_editor_history (
                id               SERIAL PRIMARY KEY,
                project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                section_id       TEXT REFERENCES project_editor_sections(id) ON DELETE CASCADE,
                prompt           TEXT,
                content_markdown TEXT,
                created_at       TIMESTAMPTZ NOT NULL
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_project_editor_history_project ON project_editor_history(project_id, created_at DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_project_editor_history_section ON project_editor_history(section_id, created_at DESC)")


def _ensure_quiz_table(conn) -> None:
    if not _table_exists(conn, "quiz_attempts"):
        conn.execute("""
            CREATE TABLE quiz_attempts (
                id              SERIAL PRIMARY KEY,
                user_id         INTEGER,
                project_id      TEXT,
                score           INTEGER NOT NULL,
                total           INTEGER NOT NULL,
                percentage      REAL NOT NULL,
                num_questions   INTEGER NOT NULL,
                variation_seed  INTEGER,
                answers_json    JSONB NOT NULL DEFAULT '{}',
                created_at      TIMESTAMPTZ NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user_created ON quiz_attempts(user_id, created_at DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_quiz_attempts_project ON quiz_attempts(project_id, created_at DESC)")


def _ensure_slide_drafts(conn) -> None:
    if not _table_exists(conn, "slide_drafts"):
        conn.execute("""
            CREATE TABLE slide_drafts (
                id          SERIAL PRIMARY KEY,
                user_id     INTEGER,
                project_id  TEXT NOT NULL,
                title       TEXT NOT NULL DEFAULT '',
                slides_json JSONB NOT NULL DEFAULT '[]',
                layouts_json JSONB NOT NULL DEFAULT '{}',
                slide_count INTEGER NOT NULL DEFAULT 0,
                saved_at    TIMESTAMPTZ NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_slide_drafts_project ON slide_drafts(project_id, saved_at DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_slide_drafts_user ON slide_drafts(user_id, saved_at DESC)")


def _ensure_chat_multi_document(conn) -> None:
    if not _column_exists(conn, "chat_conversations", "document_ids_json"):
        conn.execute("ALTER TABLE chat_conversations ADD COLUMN document_ids_json JSONB NOT NULL DEFAULT '[]'")

    conn.execute("""
        UPDATE chat_conversations
        SET document_ids_json = to_jsonb(ARRAY[document_id])
        WHERE document_id IS NOT NULL
          AND (document_ids_json IS NULL OR document_ids_json = '[]'::jsonb)
    """)


def _ensure_document_progress_columns(conn) -> None:
    if not _column_exists(conn, "documents", "processing_progress"):
        conn.execute("ALTER TABLE documents ADD COLUMN processing_progress INTEGER NOT NULL DEFAULT 0")
    if not _column_exists(conn, "documents", "processing_error"):
        conn.execute("ALTER TABLE documents ADD COLUMN processing_error TEXT")


def _backfill_user_email(conn) -> None:
    rows = conn.execute(
        "SELECT id, username FROM users WHERE email IS NULL OR TRIM(email) = ''"
    ).fetchall()
    for row in rows:
        username  = str(row["username"] or "user").strip().lower() or "user"
        candidate = f"{username}@local.test"
        suffix    = 1
        while conn.execute(
            "SELECT 1 FROM users WHERE LOWER(email) = LOWER(%s) AND id != %s LIMIT 1",
            (candidate, int(row["id"])),
        ).fetchone():
            candidate = f"{username}+{suffix}@local.test"
            suffix += 1
        conn.execute("UPDATE users SET email = %s WHERE id = %s", (candidate, int(row["id"])))


# ── Full schema init ──────────────────────────────────────────────────────────

def init_auth_db() -> None:
    """Create all tables + run incremental migrations (PostgreSQL)."""
    with _connect() as conn:
        # ── users ──────────────────────────────────────────────────────────
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id                              SERIAL PRIMARY KEY,
                username                        TEXT NOT NULL UNIQUE,
                email                           TEXT,
                password_hash                   TEXT NOT NULL,
                role                            TEXT NOT NULL CHECK(role IN ('user', 'admin')),
                status                          TEXT NOT NULL DEFAULT 'active'
                                                    CHECK(status IN ('active', 'pending_verification')),
                is_active                       BOOLEAN NOT NULL DEFAULT TRUE,
                failed_login_attempts           INTEGER NOT NULL DEFAULT 0,
                locked_until                    TIMESTAMPTZ,
                last_failed_login               TIMESTAMPTZ,
                email_verification_token_hash   TEXT,
                email_verification_expires_at   TIMESTAMPTZ,
                email_verified_at               TIMESTAMPTZ,
                created_at                      TIMESTAMPTZ NOT NULL,
                last_login                      TIMESTAMPTZ,
                avatar_url                      TEXT
            )
        """)

        # ── password_reset_tokens ───────────────────────────────────────────
        conn.execute("""
            CREATE TABLE IF NOT EXISTS password_reset_tokens (
                id          SERIAL PRIMARY KEY,
                user_id     INTEGER NOT NULL,
                token_hash  TEXT NOT NULL,
                expires_at  TIMESTAMPTZ NOT NULL,
                used_at     TIMESTAMPTZ,
                created_at  TIMESTAMPTZ NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_hash
            ON password_reset_tokens(token_hash)
        """)

        # ── auth_login_attempts ─────────────────────────────────────────────
        conn.execute("""
            CREATE TABLE IF NOT EXISTS auth_login_attempts (
                id          SERIAL PRIMARY KEY,
                user_id     INTEGER,
                email       TEXT,
                ip_address  TEXT,
                success     BOOLEAN NOT NULL,
                reason      TEXT,
                created_at  TIMESTAMPTZ NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_auth_login_attempts_created
            ON auth_login_attempts(created_at DESC)
        """)

        # ── documents ───────────────────────────────────────────────────────
        conn.execute("""
            CREATE TABLE IF NOT EXISTS documents (
                id                  TEXT PRIMARY KEY,
                user_id             INTEGER NOT NULL,
                original_filename   TEXT NOT NULL,
                stored_file_path    TEXT,
                source_tag          TEXT NOT NULL UNIQUE,
                collection_name     TEXT,
                markdown            TEXT,
                chunks_count        INTEGER NOT NULL DEFAULT 0,
                embeddings_count    INTEGER NOT NULL DEFAULT 0,
                status              TEXT NOT NULL DEFAULT 'ready',
                created_at          TIMESTAMPTZ NOT NULL,
                updated_at          TIMESTAMPTZ NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        """)

        # ── chunks ──────────────────────────────────────────────────────────
        conn.execute("""
            CREATE TABLE IF NOT EXISTS chunks (
                id          SERIAL PRIMARY KEY,
                document_id TEXT NOT NULL,
                chunk_id    TEXT,
                metadata_json JSONB,
                created_at  TIMESTAMPTZ NOT NULL,
                FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
            )
        """)

        # ── generated_content ───────────────────────────────────────────────
        conn.execute("""
            CREATE TABLE IF NOT EXISTS generated_content (
                id              SERIAL PRIMARY KEY,
                document_id     TEXT NOT NULL,
                user_id         INTEGER NOT NULL,
                section_id      TEXT NOT NULL,
                section_title   TEXT NOT NULL,
                content         TEXT NOT NULL,
                updated_at      TIMESTAMPTZ NOT NULL,
                UNIQUE(document_id, section_id),
                FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE,
                FOREIGN KEY(user_id)     REFERENCES users(id)      ON DELETE CASCADE
            )
        """)

        # ── projects ────────────────────────────────────────────────────────
        conn.execute("""
            CREATE TABLE IF NOT EXISTS projects (
                id              TEXT PRIMARY KEY,
                user_id         INTEGER NOT NULL,
                title           TEXT NOT NULL,
                description     TEXT NOT NULL DEFAULT '',
                knowledge_base_ids_json JSONB NOT NULL DEFAULT '[]',
                level           TEXT NOT NULL DEFAULT 'basic',
                format          TEXT NOT NULL DEFAULT 'markdown',
                teaching_tone   TEXT NOT NULL DEFAULT '',
                syllabus_doc_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
                created_at      TIMESTAMPTZ NOT NULL,
                updated_at      TIMESTAMPTZ,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        """)

        # ── project_documents ────────────────────────────────────────────────
        conn.execute("""
            CREATE TABLE IF NOT EXISTS project_documents (
                id                      TEXT PRIMARY KEY,
                project_id              TEXT NOT NULL,
                title                   TEXT NOT NULL,
                source_document_ids_json JSONB NOT NULL DEFAULT '[]',
                created_at              TIMESTAMPTZ NOT NULL,
                updated_at              TIMESTAMPTZ NOT NULL,
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
            )
        """)

        # ── project_sections ─────────────────────────────────────────────────
        conn.execute("""
            CREATE TABLE IF NOT EXISTS project_sections (
                id          TEXT PRIMARY KEY,
                document_id TEXT NOT NULL,
                title       TEXT NOT NULL,
                content     TEXT NOT NULL DEFAULT '',
                status      TEXT NOT NULL DEFAULT 'empty'
                                CHECK(status IN ('empty', 'generated', 'edited')),
                sort_order  INTEGER NOT NULL DEFAULT 0,
                updated_at  TIMESTAMPTZ NOT NULL,
                FOREIGN KEY(document_id) REFERENCES project_documents(id) ON DELETE CASCADE
            )
        """)

        # ── usage_stats ──────────────────────────────────────────────────────
        conn.execute("""
            CREATE TABLE IF NOT EXISTS usage_stats (
                user_id         INTEGER PRIMARY KEY,
                request_count   INTEGER NOT NULL DEFAULT 0,
                llm_calls       INTEGER NOT NULL DEFAULT 0,
                token_usage     INTEGER NOT NULL DEFAULT 0,
                last_activity   TIMESTAMPTZ,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        """)

        # ── request_logs ─────────────────────────────────────────────────────
        conn.execute("""
            CREATE TABLE IF NOT EXISTS request_logs (
                id          SERIAL PRIMARY KEY,
                user_id     INTEGER,
                endpoint    TEXT NOT NULL,
                method      TEXT NOT NULL,
                status_code INTEGER NOT NULL,
                llm_calls   INTEGER NOT NULL DEFAULT 0,
                token_usage INTEGER NOT NULL DEFAULT 0,
                ip_address  TEXT,
                created_at  TIMESTAMPTZ NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
            )
        """)

        # ── chat_conversations ────────────────────────────────────────────────
        conn.execute("""
            CREATE TABLE IF NOT EXISTS chat_conversations (
                id                  TEXT PRIMARY KEY,
                user_id             INTEGER NOT NULL,
                title               TEXT NOT NULL,
                document_id         TEXT,
                document_ids_json   JSONB NOT NULL DEFAULT '[]',
                created_at          TIMESTAMPTZ NOT NULL,
                updated_at          TIMESTAMPTZ NOT NULL,
                FOREIGN KEY(user_id)    REFERENCES users(id)     ON DELETE CASCADE,
                FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE SET NULL
            )
        """)

        # ── chat_messages ─────────────────────────────────────────────────────
        conn.execute("""
            CREATE TABLE IF NOT EXISTS chat_messages (
                id              SERIAL PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                role            TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
                content         TEXT NOT NULL,
                metadata_json   JSONB,
                created_at      TIMESTAMPTZ NOT NULL,
                FOREIGN KEY(conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE
            )
        """)

        # ── project_editor_sections ────────────────────────────────────────────
        conn.execute("""
            CREATE TABLE IF NOT EXISTS project_editor_sections (
                id                  TEXT PRIMARY KEY,
                project_id          TEXT NOT NULL,
                title               TEXT NOT NULL,
                content_markdown    TEXT NOT NULL DEFAULT '',
                prompt              TEXT NOT NULL DEFAULT '',
                retrieved_chunks_json JSONB NOT NULL DEFAULT '[]',
                evaluation_json     JSONB,
                order_index         INTEGER NOT NULL DEFAULT 0,
                updated_at          TIMESTAMPTZ NOT NULL,
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
            )
        """)

        # ── quiz_attempts ─────────────────────────────────────────────────────
        conn.execute("""
            CREATE TABLE IF NOT EXISTS quiz_attempts (
                id              SERIAL PRIMARY KEY,
                user_id         INTEGER,
                project_id      TEXT,
                score           INTEGER NOT NULL,
                total           INTEGER NOT NULL,
                percentage      REAL NOT NULL,
                num_questions   INTEGER NOT NULL,
                variation_seed  INTEGER,
                answers_json    JSONB NOT NULL DEFAULT '{}',
                created_at      TIMESTAMPTZ NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
            )
        """)

        # ── slide_drafts ──────────────────────────────────────────────────────
        conn.execute("""
            CREATE TABLE IF NOT EXISTS slide_drafts (
                id          SERIAL PRIMARY KEY,
                user_id     INTEGER,
                project_id  TEXT NOT NULL,
                title       TEXT NOT NULL DEFAULT '',
                slides_json JSONB NOT NULL DEFAULT '[]',
                layouts_json JSONB NOT NULL DEFAULT '{}',
                slide_count INTEGER NOT NULL DEFAULT 0,
                saved_at    TIMESTAMPTZ NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
            )
        """)

        # ── Indexes ──────────────────────────────────────────────────────────
        conn.execute("CREATE INDEX IF NOT EXISTS idx_chat_conversations_user_updated ON chat_conversations(user_id, updated_at DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_created ON chat_messages(conversation_id, created_at ASC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_projects_user_created ON projects(user_id, created_at DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_project_documents_project_updated ON project_documents(project_id, updated_at DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_project_sections_document_sort ON project_sections(document_id, sort_order ASC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_project_editor_sections_project_order ON project_editor_sections(project_id, order_index ASC, updated_at DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user_created ON quiz_attempts(user_id, created_at DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_quiz_attempts_project ON quiz_attempts(project_id, created_at DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_slide_drafts_project ON slide_drafts(project_id, saved_at DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_slide_drafts_user ON slide_drafts(user_id, saved_at DESC)")
        conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_ci ON users(LOWER(email))")

        # ── Incremental migrations ────────────────────────────────────────────
        _ensure_auth_user_columns(conn)
        _ensure_project_editor_columns(conn)
        _ensure_project_editor_history_table(conn)
        _ensure_quiz_table(conn)
        _ensure_slide_drafts(conn)
        _ensure_chat_multi_document(conn)
        _ensure_document_progress_columns(conn)
        _backfill_user_email(conn)

        conn.commit()
