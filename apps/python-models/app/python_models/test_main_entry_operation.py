"""Focused contracts for authenticated Main context and credential trace privacy."""

# Entity: Main Chat
# Relationship: This file verifies the retained read-only Main context operation remains external rather than a saved Card grant.
# Entity: Authentication
# Relationship: Verifies authenticated context exposes only server-owned scope/grants and credential traces contain hashes rather than identities or tokens.

from types import SimpleNamespace
import pytest

from app import main_worldview_operations, mcp_auth


def test_verified_context_and_credential_trace_expose_only_their_declared_fields(monkeypatch):
    context = {"projectId": "project-one", "deckId": "deck", "conversationId": "conversation",
               "callerCardId": "main", "grantedTools": ["main.context"], "mainEntryAuthorized": True}
    token = SimpleNamespace(subject="private-owner", client_id="private-client", token="private-credential",
        claims={"sub": "private-owner", "project": {**context, "secret": "must-not-leak"}})
    monkeypatch.setattr(mcp_auth, "get_access_token", lambda: token)
    assert mcp_auth.authenticated_project_context() == context
    trace = mcp_auth.credential_trace_fields()
    assert set(trace) == {"subject_hash", "client_hash"}
    assert all(value and "private" not in value for value in trace.values())
    monkeypatch.setattr(mcp_auth, "get_access_token", lambda: None)
    assert mcp_auth.authenticated_project_context() is None
    assert mcp_auth.credential_trace_fields() == {}


@pytest.mark.parametrize("grants", [None, "main.context", [" main.context"], ["main.context", "main.context"], [None]])
def test_context_rejects_malformed_tool_authority(monkeypatch, grants):
    token = SimpleNamespace(claims={"project": {"projectId": "project-one", "deckId": "deck",
        "conversationId": "conversation", "callerCardId": "main", "grantedTools": grants}})
    monkeypatch.setattr(mcp_auth, "get_access_token", lambda: token)
    assert mcp_auth.authenticated_project_context() is None


def test_main_context_is_external_only_not_a_card_grant():
    definitions = {
        definition.canonical_id: definition
        for definition in main_worldview_operations.main_worldview_operation_definitions(
            frozenset({"internal-plugin", "external-mcp"}),
            frozenset({"internal-plugin"}),
        )
    }
    assert definitions["main.context"].external_entry is True
    assert definitions["main.context"].grant_eligible is False
