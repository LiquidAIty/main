from __future__ import annotations

from app.python_models.idf import InputDataFileError, assemble_input_data_file


def test_idf_is_the_exact_validated_model_input() -> None:
    document = assemble_input_data_file(
        project_id="project-1",
        deck_id="deck-builder",
        conversation_id="conversation-1",
        run_id="run:1",
        originating_card_id="card_main_chat",
        system_text="Saved system prompt",
        user_text="Exact user input",
        dynamic_context_markdown="- selected ThinkGraph node tg:1",
        native_references=[
            {"authority": "thinkgraph", "nativeId": "tg:1", "required": True}
        ],
        idf_id="idf:test",
        created_at="2026-08-14T00:00:00Z",
    )

    assert document["idfId"] == "idf:test"
    assert document["systemText"] == "Saved system prompt"
    assert document["userText"] == "Exact user input"
    assert "selected ThinkGraph node tg:1" in document["modelInputMarkdown"]
    assert "thinkgraph:tg:1 [required]" in document["modelInputMarkdown"]
    assert "Saved system prompt" in document["contentMarkdown"]
    assert "Exact user input" in document["contentMarkdown"]
    assert "thinkgraph:tg:1 [required]" in document["contentMarkdown"]
    assert len(document["contentSha256"]) == 64


def test_idf_transport_rejects_invalid_structure_without_interpreting_content() -> None:
    try:
        assemble_input_data_file(
            project_id="project-1",
            deck_id="deck-builder",
            conversation_id="conversation-1",
            run_id="",
            originating_card_id="card_main_chat",
            system_text="",
            user_text="Any natural language remains valid.",
        )
    except InputDataFileError as error:
        assert str(error) == "idf_run_id_invalid"
    else:
        raise AssertionError("invalid structural identity was accepted")


def test_idf_errors_do_not_echo_model_input_or_secret_shaped_text() -> None:
    secret = "sk-secret-that-must-never-appear"
    try:
        assemble_input_data_file(
            project_id="project-1",
            deck_id="deck-builder",
            conversation_id="conversation-1",
            run_id="run:1",
            originating_card_id="card_main_chat",
            system_text="",
            user_text=secret,
            native_references=[
                {"authority": "thinkgraph", "nativeId": secret, "unexpected": secret}
            ],
        )
    except InputDataFileError as error:
        assert str(error) == "idf_native_reference_invalid"
        assert secret not in str(error)
    else:
        raise AssertionError("invalid reference authority was accepted")
