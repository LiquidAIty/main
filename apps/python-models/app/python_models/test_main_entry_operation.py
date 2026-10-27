"""Focused contracts for the authenticated external Main context operation."""

# Graph + less = more: less code that does the same work as more code is more useful.
# Entity names the feature; Relationship explains why this file belongs and what it contributes.
# Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
# Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
# Entity: Main Chat
# Relationship: This file verifies the retained read-only Main context operation remains external rather than a saved Card grant.
# Entity: Authentication
# Relationship: This file verifies an authenticated external identity exposes only its issuer and subject.

from types import SimpleNamespace

from app import main_worldview_operations, mcp_auth


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
