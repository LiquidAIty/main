# Entity: Application Database
# Relationship: This file verifies Python rails requires and safely parses the one DATABASE_URL authority while preserving caller-selected autocommit behavior.

from __future__ import annotations

import pytest

from app.python_models import postgres, provider_config


def test_postgres_requires_the_one_database_url_authority(monkeypatch) -> None:
    monkeypatch.setattr(provider_config, "ensure_env_loaded", lambda: None)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("POSTGRES_PASSWORD", "unused-fallback")

    with pytest.raises(RuntimeError, match="missing_required_config: DATABASE_URL"):
        postgres.connect_postgres()


def test_postgres_rejects_malformed_database_url_without_echoing_it(monkeypatch) -> None:
    import psycopg

    monkeypatch.setattr(provider_config, "ensure_env_loaded", lambda: None)
    monkeypatch.setenv("DATABASE_URL", "not-a-database-url-with-secret")
    monkeypatch.setattr(
        psycopg.conninfo,
        "conninfo_to_dict",
        lambda _value: (_ for _ in ()).throw(ValueError("secret detail")),
    )

    with pytest.raises(RuntimeError) as error:
        postgres.connect_postgres()

    assert str(error.value) == "invalid_config: DATABASE_URL"
    assert "secret" not in str(error.value)


def test_postgres_passes_parsed_connection_and_caller_autocommit(monkeypatch) -> None:
    import psycopg

    monkeypatch.setattr(provider_config, "ensure_env_loaded", lambda: None)
    monkeypatch.setenv(
        "DATABASE_URL",
        "postgresql://owner:password@database.internal:5432/app",
    )
    calls: list[dict] = []
    monkeypatch.setattr(
        psycopg,
        "connect",
        lambda **kwargs: calls.append(kwargs) or object(),
    )

    postgres.connect_postgres(autocommit=False)

    assert calls == [{
        "user": "owner",
        "password": "password",
        "dbname": "app",
        "host": "database.internal",
        "port": "5432",
        "autocommit": False,
    }]
