"""Canonical Python connection to LiquidAIty's application Postgres."""

from __future__ import annotations

import os


def connect_postgres(*, autocommit: bool = True):
    """Use the same environment contract and defaults as the backend pool."""
    import psycopg

    return psycopg.connect(
        host=os.environ.get("POSTGRES_HOST", "localhost"),
        port=int(os.environ.get("POSTGRES_PORT", "5433")),
        dbname=os.environ.get("POSTGRES_DB", "liquidaity"),
        user=os.environ.get("POSTGRES_USER", "liquidaity-user"),
        password=os.environ.get("POSTGRES_PASSWORD", "LiquidAIty"),
        autocommit=autocommit,
    )
