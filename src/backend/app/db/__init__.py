"""app/db — Database layer package.

Splits the monolithic auth_db.py into focused modules:
  connection.py  — DB path, _connect, _utc_now, _column_exists
  migrations.py  — init_auth_db + schema migrations/backfills
  users.py       — User & auth CRUD
  documents.py   — RAG document, chunk, generated_content CRUD
  projects.py    — Project + editor sections + chat CRUD
  quiz.py        — Quiz attempts CRUD
  slides.py      — Slide draft persistence
  stats.py       — Usage stats, request logs, admin helpers

All public names are re-exported here for backward compatibility.
Existing code that does `from ..auth_db import X` continues to work
because auth_db.py itself does `from .db import *`.
"""

from .migrations import init_auth_db  # noqa: F401

from .users import (  # noqa: F401
    create_user,
    get_user_by_username,
    get_user_by_email,
    get_user_by_id,
    list_users,
    update_last_login,
    register_failed_login,
    reset_failed_login_attempts,
    is_account_locked,
    record_auth_login_attempt,
    any_admin_exists,
    set_user_active,
    count_admin_users,
    delete_user_by_id,
    save_password_reset_token,
    get_valid_password_reset_token,
    mark_password_reset_token_used,
    update_user_password,
    update_user_profile,
)

from .documents import (  # noqa: F401
    create_document,
    get_document_by_id,
    get_document_for_user,
    list_documents,
    list_documents_by_user,
    delete_document,
    update_document_processing_result,
    save_generated_content,
    create_project_document,
    get_project_document_by_id,
    list_project_documents,
    get_document_with_sections,
    get_document_for_export,
    set_document_sections,
    update_project_section,
    update_document_progress,
)

from .projects import (  # noqa: F401
    create_project,
    create_editor_project,
    list_projects,
    list_editor_projects,
    get_project_by_id,
    get_project_for_user,
    delete_project_for_user,
    update_editor_project_for_user,
    create_editor_section,
    delete_editor_section,
    replace_editor_sections,
    list_editor_sections,
    get_editor_section_by_id,
    get_editor_section_for_user,
    update_editor_section,
    get_editor_project_detail_for_user,
    create_chat_conversation,
    get_chat_conversation_by_id,
    get_chat_conversation_for_user,
    list_chat_conversations,
    delete_chat_conversation,
    append_chat_message,
    list_chat_messages,
    get_projects_referencing_document,
)

from .quiz import (  # noqa: F401
    save_quiz_attempt,
    list_quiz_attempts,
    get_quiz_stats,
)

from .slides import (  # noqa: F401
    save_slide_draft,
    load_slide_draft,
)

from .stats import (  # noqa: F401
    upsert_usage,
    log_request,
    list_usage,
    list_logs,
    estimate_tokens_from_text,
    dumps_json,
)
