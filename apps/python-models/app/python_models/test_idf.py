from __future__ import annotations

from app.python_models.idf import InputDataFileError, assemble_input_data_file


CARD_CONTEXT = {
    "cardId": "card_main_chat",
    "title": "Main",
    "prompt": "Saved system prompt",
    "runtimeType": "main_chat",
    "runtimeBinding": "main_chat",
    "provider": "openai",
    "accessMode": "chatgpt-account",
    "modelKey": "saved-model",
    "providerModelId": "saved-model",
    "executionMode": "single",
    "tools": ["graphiti.search_nodes"],
}


def test_idf_is_the_exact_validated_model_input() -> None:
    document = assemble_input_data_file(
        project_id="project-1",
        deck_id="deck-builder",
        conversation_id="conversation-1",
        run_id="run:1",
        originating_card_id="card_main_chat",
        system_text="Saved system prompt",
        user_text="Exact user input",
        card_context=CARD_CONTEXT,
        dynamic_context_markdown=(
            "Search terms: PCM hysteresis, enthalpy curve.\n\n"
            "Handoff summary: inspect the selected ThinkGraph evidence."
        ),
        native_references=[
            {"authority": "thinkgraph", "nativeId": "tg:1", "required": True}
        ],
        idf_id="idf:test",
        created_at="2026-08-14T00:00:00Z",
    )

    assert document["idfId"] == "idf:test"
    assert document["systemText"] == "Saved system prompt"
    assert document["userText"] == "Exact user input"
    assert "PCM hysteresis" in document["modelInputMarkdown"]
    assert '"nativeId": "tg:1"' in document["modelInputMarkdown"]
    assert "Saved system prompt" in document["contentMarkdown"]
    assert "Exact user input" in document["contentMarkdown"]
    assert "Handoff summary" in document["contentMarkdown"]
    assert "[SYSTEM]" in document["contentMarkdown"]
    assert "[CARD]" in document["contentMarkdown"]
    assert "name: Main" in document["contentMarkdown"]
    assert "[JSON]" in document["contentMarkdown"]
    assert document["cardContext"] == CARD_CONTEXT
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
            card_context=CARD_CONTEXT,
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
            card_context=CARD_CONTEXT,
            native_references=[
                {"authority": "thinkgraph", "nativeId": secret, "unexpected": secret}
            ],
        )
    except InputDataFileError as error:
        assert str(error) == "idf_native_reference_invalid"
        assert secret not in str(error)
    else:
        raise AssertionError("invalid reference authority was accepted")


def test_coding_job_starts_as_one_hash_bound_draft() -> None:
    coder_context = {
        **CARD_CONTEXT,
        "cardId": "card_local_coder",
        "title": "Coder",
        "runtimeType": "assistant_agent",
        "runtimeBinding": "local_coder",
        "accessMode": "coder-oauth",
    }
    job_context = {
        "objective": "Add one focused regression test.",
        "planExcerpt": "Inspect, edit, test, report.",
        "contextSummary": "Use the current checkout.",
        "codeAnchors": ["apps/backend/src/coder"],
        "cbmQueries": ["search_graph LocalCoderAdapter"],
        "guardrails": ["Preserve unrelated changes."],
        "allowedFiles": ["apps/backend/src/coder/**"],
        "forbiddenWork": ["No provider fallback."],
        "proofRequired": ["Run the focused test."],
        "reportFormat": "CoderReport",
        "stopConditions": ["Stop after proof."],
        "writeMode": "edit",
    }

    document = assemble_input_data_file(
        project_id="project-1",
        deck_id="deck-builder",
        conversation_id="coder-review",
        run_id="coder:1",
        originating_card_id="card_local_coder",
        system_text="Saved Coder prompt",
        user_text=job_context["objective"],
        card_context=coder_context,
        purpose="coding_job",
        approval_status="draft",
        version=3,
        job_context=job_context,
        idf_id="idf:coder-test",
        created_at="2026-08-15T00:00:00Z",
    )

    assert document["purpose"] == "coding_job"
    assert document["approvalStatus"] == "draft"
    assert document["version"] == 3
    assert document["approvedSha256"] is None
    assert document["jobContext"] == job_context
    assert "Add one focused regression test." in document["modelInputMarkdown"]
    assert len(document["contentSha256"]) == 64
