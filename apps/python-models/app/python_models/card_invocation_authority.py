"""Saved Card, sender, execution, and configuration authority for one invocation."""

from __future__ import annotations

from typing import Any

from app.python_models import agentgraph_topology
from app.python_models.saved_card_contract import (
    CardDomainError,
    canonical_json,
    card_runtime,
    is_magnetic_taskgraph_runtime,
    json_object,
    runtime_owner,
    saved_openai_runtime,
    sha256_text,
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
    else:
        authorized = any(
            target["cardId"] == card_id
            for target in agentgraph_topology.direct_orchestrator_targets(
                sender_id, cards, edges
            )
        )
    if sender is None or not authorized:
        raise CardDomainError("card_invocation_edge_authority_required")


def execution_authority_fingerprint(
    *, project_id: str, deck_id: str, card_id: str,
    card_revision_id: str, card_revision_sha256: str,
    runtime: dict[str, Any], provider: dict[str, Any],
    openai_runtime: Any,
) -> str:
    return sha256_text(canonical_json({
        "schemaVersion": "liquidaity.card-execution-authority.v1",
        "projectId": project_id,
        "deckId": deck_id,
        "cardId": card_id,
        "cardRevisionId": card_revision_id,
        "cardRevisionSha256": card_revision_sha256,
        "runtime": runtime,
        "provider": provider,
        "openaiRuntime": openai_runtime,
    }))


def saved_invocation_configuration(card: dict[str, Any]) -> dict[str, Any]:
    options = json_object(card.get("runtimeOptions"), "runtime_options")
    runtime = card_runtime(card)
    auto_tools, auto_model = validate_auto_runtime_options(options, runtime)
    ceiling = string_list(options.get("tools"), "tools")
    provider, access_mode = validate_saved_provider_selection(
        options.get("provider"), options.get("accessMode"),
    )
    openai_runtime = saved_openai_runtime(options.get("openaiRuntime"), required=False)
    model_key = str(options.get("modelKey") or "")
    provider_model_id = str(options.get("providerModelId") or model_key)
    if not provider or not model_key or not provider_model_id:
        raise CardDomainError("card_model_configuration_incomplete")
    runtime_options: dict[str, Any] = {}
    if options.get("autoTools") is not None:
        runtime_options["autoTools"] = auto_tools
    if options.get("autoModel") is not None:
        runtime_options["autoModel"] = auto_model
    if openai_runtime is not None:
        runtime_options["openaiRuntime"] = openai_runtime
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
    if options.get("writeMode") is not None:
        write_mode = str(options.get("writeMode") or "read-only")
        if write_mode not in {"read-only", "edit"}:
            raise CardDomainError("card_write_mode_invalid")
        runtime_options["writeMode"] = write_mode
    reasoning_effort = str(options.get("reasoningEffort") or "").strip()
    if len(reasoning_effort) > 64:
        raise CardDomainError("card_reasoning_effort_invalid")
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
            "toolsets": string_list(options.get("toolsets"), "toolsets"),
            "mcpConnectionIds": string_list(options.get("mcpConnectionIds"), "mcp_connection_ids"),
        },
    }
