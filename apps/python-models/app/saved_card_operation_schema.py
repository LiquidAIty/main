"""Exact public schemas for saved Card create and configuration operations."""

from __future__ import annotations

from typing import Any

from app.application_tool_error import ApplicationToolError
from app.saved_card_operation_validation import (
    _CAPABILITY_LIST_FIELDS,
    _SUBAGENT_MODEL_FIELDS,
    _SUBAGENT_TYPES,
)


_CARD_CREATE_RUNTIME_KEYS = {"kind", "mode", "profile"}
_UPDATABLE_TOP_FIELDS = {"prompt", "title"}


def saved_card_operation_schema(name: str) -> dict[str, Any]:
    """Return the exact public schema for one saved-Card operation."""

    text = {"type": "string", "minLength": 1}
    names = {"type": "array", "items": text}
    identity = {key: text for key in ("projectId", "deckId")}
    model = {
        "type": "object",
        "additionalProperties": False,
        "properties": {key: text for key in sorted(_SUBAGENT_MODEL_FIELDS)},
        "required": sorted(_SUBAGENT_MODEL_FIELDS),
    }
    subagent = {
        **model,
        "properties": {key: text for key in sorted(_SUBAGENT_MODEL_FIELDS)},
    }
    if name == "card.create":
        properties = {
            **identity,
            **{
                key: text
                for key in (
                    "expectedRevision", "templateId", "title", "role", "prompt",
                )
            },
            "runtime": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    key: text for key in sorted(_CARD_CREATE_RUNTIME_KEYS)
                },
                "required": ["kind", "mode", "profile"],
            },
            "model": model,
            "subagentType": {"type": "string", "enum": sorted(_SUBAGENT_TYPES)},
            "subagentModel": subagent,
            "openaiRuntime": {
                "type": ["string", "null"],
                "enum": [None, "codex_app_server"],
            },
            "autoTools": {"type": "boolean"},
            "autoModel": {"type": "boolean"},
            **{key: names for key in sorted(_CAPABILITY_LIST_FIELDS)},
            "position": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    key: {"type": "number"} for key in ("x", "y")
                },
            },
        }
        required = [
            "projectId", "deckId", "expectedRevision", "templateId", "title",
            "role", "prompt", "runtime", "model",
        ]
    elif name == "card.update_configuration":
        fields = {
            **{key: {"type": "string"} for key in sorted(_UPDATABLE_TOP_FIELDS)},
            **{key: names for key in sorted(_CAPABILITY_LIST_FIELDS)},
            **{
                key: text
                for key in ("accessMode", "modelKey", "provider", "providerModelId")
            },
            "subagentModel": subagent,
            "subagentType": {"type": "string", "enum": sorted(_SUBAGENT_TYPES)},
            "openaiRuntime": {
                "type": ["string", "null"],
                "enum": [None, "codex_app_server"],
            },
            "autoTools": {"type": "boolean"},
            "autoModel": {"type": "boolean"},
            "configuration": {"type": "object"},
            "script": {"type": "object"},
            "subsystems": {"type": "array", "items": {"type": "object"}},
        }
        properties = {
            **identity,
            "cardId": text,
            "expectedRevision": text,
            "expectedCardRevisionId": text,
            "updates": {
                "type": "object",
                "properties": fields,
                "minProperties": 1,
                "additionalProperties": False,
            },
        }
        required = [
            "projectId", "deckId", "cardId", "expectedRevision",
            "expectedCardRevisionId", "updates",
        ]
    else:
        raise ApplicationToolError("saved_card_operation_unknown")
    return {
        "type": "object",
        "properties": properties,
        "required": required,
        "additionalProperties": False,
    }
