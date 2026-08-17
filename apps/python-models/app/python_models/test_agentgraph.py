"""PostgreSQL integration proof for the canonical IDF replacement boundary."""

import psycopg
import pytest

from app.python_models import provider_config
from app.python_models.postgres import connect_postgres

PROJECT_ID = "20ac92da-01fd-4cf6-97cc-0672421e751a"
DECK_ID = "deck_builder"


def test_postgres_connection_names_missing_injected_password(monkeypatch) -> None:
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("DATABASE_URL_FILE", raising=False)
    monkeypatch.delenv("POSTGRES_PASSWORD", raising=False)
    monkeypatch.delenv("POSTGRES_PASSWORD_FILE", raising=False)
    monkeypatch.setattr(provider_config, "_env_loaded", True)
    with pytest.raises(RuntimeError, match="missing_required_config: POSTGRES_PASSWORD"):
        connect_postgres()


def test_postgres_connection_prefers_injected_database_url(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_connect(**kwargs):
        captured.update(kwargs)
        return object()

    monkeypatch.setenv(
        "DATABASE_URL",
        "postgresql://runtime-user:runtime-secret@database.internal:5432/runtime-db",
    )
    monkeypatch.setenv("POSTGRES_PASSWORD", "split-secret-must-not-win")
    monkeypatch.setattr(psycopg, "connect", fake_connect)

    connect_postgres(autocommit=False)

    assert captured == {
        "user": "runtime-user",
        "password": "runtime-secret",
        "dbname": "runtime-db",
        "host": "database.internal",
        "port": "5432",
        "autocommit": False,
    }


def test_invalid_database_url_error_never_echoes_secret(monkeypatch) -> None:
    secret = "must-not-appear-in-error"
    monkeypatch.setenv(
        "DATABASE_URL",
        f"postgresql://runtime-user:{secret}%XX@database.internal/runtime-db",
    )

    with pytest.raises(RuntimeError) as failure:
        connect_postgres()

    assert str(failure.value) == "invalid_config: DATABASE_URL"
    assert secret not in str(failure.value)


def test_saved_idf_schema_is_relational_and_legacy_prompt_stores_are_read_only() -> None:
    provider_config.ensure_env_loaded(force=True)
    with connect_postgres() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT table_name, column_name, data_type
            FROM information_schema.columns
            WHERE table_schema='ag_catalog'
              AND table_name IN ('saved_idfs', 'saved_idf_revisions')
            ORDER BY table_name, ordinal_position
            """
        )
        columns = {(table, column): data_type for table, column, data_type in cursor.fetchall()}
        assert columns[("saved_idfs", "idf_id")] == "uuid"
        assert columns[("saved_idf_revisions", "content_markdown")] == "text"
        assert columns[("saved_idf_revisions", "content_sha256")] == "text"
        assert not any(data_type == "jsonb" for data_type in columns.values())

        cursor.execute(
            """
            SELECT table_name, privilege_type
            FROM information_schema.role_table_grants
            WHERE table_schema='ag_catalog'
              AND grantee='liquidaity-user'
              AND table_name IN (
                'input_data_files', 'agent_assignments',
                'agent_context_references', 'agent_results'
              )
            """
        )
        legacy_privileges = set(cursor.fetchall())
        assert all(
            privilege == "SELECT"
            for _table, privilege in legacy_privileges
        )
