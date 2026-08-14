"""Canonical Python connection to LiquidAIty's application Postgres."""

from __future__ import annotations

import os


def connect_postgres(*, autocommit: bool = True):
    """Use injected connection settings without a source-level password fallback."""
    import psycopg

    password = os.environ.get("POSTGRES_PASSWORD", "").strip()
    if not password:
        raise RuntimeError("missing_required_config: POSTGRES_PASSWORD")

    return psycopg.connect(
        host=os.environ.get("POSTGRES_HOST", "localhost"),
        port=int(os.environ.get("POSTGRES_PORT", "5433")),
        dbname=os.environ.get("POSTGRES_DB", "liquidaity"),
        user=os.environ.get("POSTGRES_USER", "liquidaity-user"),
        password=password,
        autocommit=autocommit,
    )
