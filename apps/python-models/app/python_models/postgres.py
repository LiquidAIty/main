"""Canonical Python connection to LiquidAIty's application Postgres."""

from __future__ import annotations

import os


def connect_postgres(*, autocommit: bool = True):
    """Use injected connection settings without a source-level password fallback."""
    import psycopg

    from app.python_models.provider_config import ensure_env_loaded

    ensure_env_loaded()
    database_url = os.environ.get("DATABASE_URL", "").strip()
    if not database_url:
        raise RuntimeError("missing_required_config: DATABASE_URL")
    try:
        connection_args = psycopg.conninfo.conninfo_to_dict(database_url)
    except Exception:
        raise RuntimeError("invalid_config: DATABASE_URL") from None
    return psycopg.connect(**connection_args, autocommit=autocommit)
