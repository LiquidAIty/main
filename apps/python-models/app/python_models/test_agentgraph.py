"""PostgreSQL integration proof for the canonical IDF replacement boundary."""

from uuid import uuid4

import pytest

from app.python_models.idf import create_input_data_file, read_input_data_file
from app.python_models.postgres import connect_postgres

PROJECT_ID = "20ac92da-01fd-4cf6-97cc-0672421e751a"
DECK_ID = "deck_builder"


def test_postgres_connection_names_missing_injected_password(monkeypatch) -> None:
    monkeypatch.delenv("POSTGRES_PASSWORD", raising=False)
    monkeypatch.delenv("POSTGRES_PASSWORD_FILE", raising=False)
    with pytest.raises(RuntimeError, match="missing_required_config: POSTGRES_PASSWORD"):
        connect_postgres()


def test_idf_postgres_round_trip_preserves_exact_model_input() -> None:
    identity = uuid4().hex
    connection = connect_postgres(autocommit=False)
    try:
        created = create_input_data_file(
            project_id=PROJECT_ID,
            deck_id=DECK_ID,
            conversation_id="main",
            run_id=f"idf-test:{identity}",
            originating_card_id="card_main_chat",
            system_text="Saved system",
            user_text="Exact input",
            card_context={
                "cardId": "card_main_chat", "title": "Main",
                "prompt": "Saved system", "runtimeType": "main_chat",
                "executionMode": "single",
            },
            dynamic_context_markdown="Dynamic context",
            native_references=[
                {"authority": "knowgraph", "nativeId": "node:one", "required": True}
            ],
            idf_id=f"idf:{identity}",
            connection=connection,
        )["idf"]
        loaded = read_input_data_file(
            project_id=PROJECT_ID, idf_id=created["idfId"], connection=connection
        )
        assert loaded == created
        assert "Dynamic context" in loaded["modelInputMarkdown"]
        assert '"nativeId": "node:one"' in loaded["modelInputMarkdown"]
    finally:
        connection.rollback()
        connection.close()
