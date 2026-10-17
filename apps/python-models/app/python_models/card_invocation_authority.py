"""Saved Card, sender, execution, and configuration authority for one invocation."""
# Entity: Card Runs
# Relationship: Authorizes one Card invocation against exact orange or blue topology and projects its saved runtime, model, tools, skills, and subagent configuration.

from __future__ import annotations

from typing import Any

from app.python_models import agentgraph_topology
from app.python_models.saved_card_contract import (
    CardDomainError,
    canonical_card_tools_and_toolsets,
    card_runtime,
    is_magnetic_taskgraph_runtime,
    json_object,
    reasoning_effort_selection,
    runtime_owner,
    string_list,
    subagent_model_selection,
    subagent_type_selection,
    validate_auto_runtime_options,
    validate_saved_provider_selection,
)


def authorize_invocation_sender(
    sender_id: str,
    card_id: str,
    card: dict[str, Any],
    cards: dict[str, dict[str, Any]],
    edges: list[dict[str, Any]],
) -> None:
    if not sender_id:
        return
    if sender_id == card_id:
        raise CardDomainError("card_invocation_self_handoff_forbidden")
    sender = cards.get(sender_id)
    target_runtime = card_runtime(card)
    sender_runtime = card_runtime(sender) if sender is not None else None
    if is_magnetic_taskgraph_runtime(target_runtime):
        authorized = (
            sender_runtime is not None
            and sender_runtime.get("kind") == "hermes"
            and agentgraph_topology.card_has_orchestrator_authority(sender)
            and any(
                target["cardId"] == card_id
                for target in agentgraph_topology.direct_orchestrator_targets(
                    sender_id, cards, edges
                )
            )
        )
    elif sender_runtime is not None and is_magnetic_taskgraph_runtime(sender_runtime):
        authorized = any(
            edge["edgeType"] == "magentic_option"
            and {edge["source"], edge["target"]} == {sender_id, card_id}
            and edge.get("enabled") is not False
            for edge in edges
        )
    elif sender_runtime is not None:
        authorized = (
            sender_runtime.get("kind") == "hermes"
            and agentgraph_topology.card_has_orchestrator_authority(sender)
            and any(
                target["cardId"] == card_id
                for target in agentgraph_topology.direct_orchestrator_targets(
                    sender_id, cards, edges
                )
            )
        )
    else:
        authorized = False
    if sender is None or not authorized:
        raise CardDomainError("card_invocation_edge_authority_required")


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
            raise CardDomainError("card_subagent_type_requires_hermes")
        runtime_options["subagentType"] = subagent_type
    reasoning_effort = reasoning_effort_selection(options.get("reasoningEffort"))
    return {
        "options": options, "runtime": runtime, "autoTools": auto_tools,
        "autoModel": auto_model, "ceiling": ceiling,
        "runtimeOwner": runtime_owner(card), "reasoningEffort": reasoning_effort,
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
