"""Saved Card configuration projection for one invocation."""
# Graph + less = more: less code that does the same work as more code is more useful.
# Entity names the feature; Relationship explains why this file belongs and what it contributes.
# Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
# Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
# Entity: Card Invocation
# Relationship: This file produces the exact saved runtime configuration used to prepare one Card execution.
#
# Entity: Saved Cards
# Relationship: This file projects the target Card's saved provider, model, reasoning, tools, skills, toolsets, MCP references, and subagent configuration.

from __future__ import annotations

from typing import Any

from app.python_models.saved_card_contract import (
    CardDomainError,
    canonical_card_tools_and_toolsets,
    card_runtime,
    json_object,
    reasoning_effort_selection,
    string_list,
    subagent_model_selection,
    subagent_type_selection,
    validate_auto_runtime_options,
    validate_saved_provider_selection,
)


def saved_invocation_configuration(card: dict[str, Any]) -> dict[str, Any]:
    options = json_object(card.get("runtimeOptions"), "runtime_options")
    runtime = card_runtime(card)
    auto_tools, auto_model = validate_auto_runtime_options(options, runtime)
    ceiling, toolsets = canonical_card_tools_and_toolsets(options)
    provider, access_mode = validate_saved_provider_selection(
        options.get("provider"), options.get("accessMode"),
    )
    model_key = str(options.get("modelKey") or "")
    provider_model_id = str(options.get("providerModelId") or model_key)
    if not provider or not model_key or not provider_model_id:
        raise CardDomainError("card_model_configuration_incomplete")
    runtime_options: dict[str, Any] = {}
    if options.get("autoTools") is not None:
        runtime_options["autoTools"] = auto_tools
    if options.get("autoModel") is not None:
        runtime_options["autoModel"] = auto_model
    configuration = options.get("configuration")
    if configuration is not None:
        if not isinstance(configuration, dict):
            raise CardDomainError("card_configuration_invalid")
        runtime_options["configuration"] = dict(configuration)
    subagent_model = subagent_model_selection(options.get("subagentModel"))
    if subagent_model is not None:
        runtime_options["subagentModel"] = subagent_model
    subagent_type = subagent_type_selection(options.get("subagentType"))
    if subagent_type is not None:
        if runtime.get("kind") != "hermes":
            raise CardDomainError("card_subagent_type_requires_card_runtime")
        runtime_options["subagentType"] = subagent_type
    reasoning_effort = reasoning_effort_selection(options.get("reasoningEffort"))
    return {
        "options": options, "runtime": runtime, "autoTools": auto_tools,
        "autoModel": auto_model, "ceiling": ceiling,
        "reasoningEffort": reasoning_effort,
        "callConfig": {
            "systemPrompt": str(card.get("prompt") or ""), "runtime": runtime,
            "provider": {"accessMode": access_mode, "provider": provider,
                         "modelKey": model_key, "providerModelId": provider_model_id},
            "runtimeOptions": runtime_options, "enabledTools": ceiling,
            "skills": string_list(options.get("skills"), "skills"),
            "toolsets": toolsets,
            "mcpConnectionIds": string_list(options.get("mcpConnectionIds"), "mcp_connection_ids"),
        },
    }
