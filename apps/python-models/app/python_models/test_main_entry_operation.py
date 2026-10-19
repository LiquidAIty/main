"""Focused contracts for the authenticated external saved-Main entry operation."""

# Entity: Main Chat
# Relationship: This file verifies external missions enter through the saved Main route, preserve server-owned identity, and return only an observed terminal result.
# Entity: MCP Host
# Relationship: This file verifies main.context and main.submit are external entry operations rather than saved Card grants.
# Entity: Authentication
# Relationship: This file verifies Main submission forwards only the issuer and subject from a verified external identity plus the expected server-owned Main binding.
# Entity: Run Ledger
# Relationship: This file verifies the external result parser requires one completed and ended outer Run and preserves real stream failure without a success shape.
# Entity: Data Anchors
# Relationship: This file verifies selected Data Anchors pass through the bounded Main submission unchanged.

import asyncio
import json
from types import SimpleNamespace

from app import main_worldview_operations, mcp_auth


def _event(name: str, payload: dict) -> str:
    return f"event: {name}\ndata: {json.dumps(payload)}\n\n"


def test_verified_external_identity_exposes_only_issuer_and_subject(monkeypatch):
    token = SimpleNamespace(
        expires_at=4102444800,
        subject="auth0|owner",
        claims={"iss": "https://tenant.example/", "sub": "auth0|owner"},
    )
    monkeypatch.setattr(mcp_auth, "get_access_token", lambda: token)
    assert mcp_auth.authenticated_external_identity() == {
        "issuer": "https://tenant.example/",
        "subject": "auth0|owner",
    }
    token.claims["internal"] = {"kind": "catalog-reader"}
    assert mcp_auth.authenticated_external_identity() is None


def test_main_submit_parser_requires_one_terminal_run_and_preserves_recipient():
    raw = "".join([
        _event("run", {
            "runId": "run-one", "cardId": "card_main_chat",
            "requestedParticipant": {"cardId": "builder", "label": "Builder"},
        }),
        _event("tool_start", {"runId": "run-one"}),
        _event("tool_result", {"runId": "run-one"}),
        _event("done", {
            "runId": "run-one", "cardId": "card_main_chat",
            "participant": {"cardId": "builder", "label": "Builder"},
            "fullText": "Completed through saved Builder.",
        }),
        _event("end", {
            "runId": "run-one", "cardId": "card_main_chat",
            "requestedParticipant": {"cardId": "builder", "label": "Builder"},
        }),
    ])

    assert main_worldview_operations._main_submit_result(raw) == {
        "ok": True,
        "runId": "run-one",
        "state": "completed",
        "cardId": "card_main_chat",
        "participant": {"cardId": "builder", "label": "Builder"},
        "requestedParticipant": {"cardId": "builder", "label": "Builder"},
        "result": "Completed through saved Builder.",
        "completionObserved": True,
        "streamEnded": True,
        "toolEvents": 2,
    }


def test_main_submit_parser_reports_real_stream_failure_without_success_shape():
    raw = "".join([
        _event("run", {"runId": "run-one", "cardId": "card_main_chat"}),
        _event("error", {
            "runId": "run-one", "code": "hermes_gateway_closed_during_turn",
            "message": "Hermes disconnected.",
        }),
        _event("end", {"runId": "run-one", "cardId": "card_main_chat"}),
    ])

    assert main_worldview_operations._main_submit_result(raw) == {
        "ok": False,
        "runId": "run-one",
        "error": "hermes_gateway_closed_during_turn",
        "errorMessage": "Hermes disconnected.",
        "completionObserved": False,
        "streamEnded": True,
    }
    assert main_worldview_operations._main_submit_result(
        _event("done", {"runId": "run-one", "fullText": "not settled"}),
    )["error"] == "main_submit_completion_missing"


def test_main_submit_uses_verified_identity_and_server_owned_main_binding(monkeypatch):
    observed = {}
    monkeypatch.setattr(
        mcp_auth,
        "authenticated_external_identity",
        lambda: {"issuer": "https://tenant.example/", "subject": "auth0|owner"},
    )

    def submit(route, payload, **options):
        observed.update({"route": route, "payload": payload, "options": options})
        return "".join([
            _event("run", {"runId": "run-one", "cardId": "card_main_chat"}),
            _event("done", {
                "runId": "run-one", "cardId": "card_main_chat",
                "participant": {"cardId": "builder"}, "fullText": "done",
            }),
            _event("end", {
                "runId": "run-one", "cardId": "card_main_chat",
                "requestedParticipant": {"cardId": "builder"},
            }),
        ])

    monkeypatch.setattr(main_worldview_operations, "post_backend_text_sync", submit)
    result = asyncio.run(main_worldview_operations.main_submit(
        input="@Builder implement the bounded UI change",
        dataAnchors=[{"kind": "thinkgraph", "id": "think-one"}],
        projectId="project-one",
        deckId="deck_builder",
        _callerCardId="card_main_chat",
    ))

    assert result["ok"] is True
    assert observed["route"] == "/api/main/session/chat"
    assert observed["options"] == {
        "timeout_seconds": 540.0,
        "require_internal_secret": True,
    }
    payload = observed["payload"]
    assert payload["projectId"] == "project-one"
    assert payload["deckId"] == "deck_builder"
    assert payload["expectedMainCardId"] == "card_main_chat"
    assert payload["externalIssuer"] == "https://tenant.example/"
    assert payload["externalSubject"] == "auth0|owner"
    assert payload["message"] == "@Builder implement the bounded UI change"
    assert payload["dataAnchors"] == [{"kind": "thinkgraph", "id": "think-one"}]
    assert payload["clientMessageId"].startswith("msg_")
    assert payload["clientReplyMessageId"].startswith("msg_")
    assert payload["clientMessageId"] != payload["clientReplyMessageId"]


def test_main_entry_operations_are_external_only_not_card_grants():
    definitions = {
        definition.canonical_id: definition
        for definition in main_worldview_operations.main_worldview_operation_definitions(
            frozenset({"internal-plugin", "external-mcp"}),
            frozenset({"internal-plugin"}),
        )
    }
    for name in ("main.context", "main.submit"):
        assert definitions[name].external_entry is True
        assert definitions[name].grant_eligible is False
    assert set(definitions["main.submit"].parameters_schema["properties"]) == {
        "input", "dataAnchors",
    }
