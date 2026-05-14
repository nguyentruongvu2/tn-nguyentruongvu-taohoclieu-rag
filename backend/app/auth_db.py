"""Backward-compatibility shim for auth_db.

All logic has been moved to the `app/db/` package.
This file re-exports everything so existing imports continue to work
without any changes in routes or other modules.
"""

# Re-export entire public API from the db package
from .db import *  # noqa: F401, F403
from .db import AUTH_DB_PATH  # noqa: F401 — explicit for type checkers