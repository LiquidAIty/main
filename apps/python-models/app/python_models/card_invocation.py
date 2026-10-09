"""Exact saved-Card authority, graph selection, and canonical IDF preparation."""

from __future__ import annotations

import json
from typing import Any

from pydantic import ValidationError

from app.python_models import agentgraph_topology, saved_cards
from app.python_models.card_script import (
    CardScriptValidationError,
    script_presentation,
)
from app.python_models.card_run_selection import (
    AutoModelSelectionError,
    select_auto_model,
    select_auto_tools,
    selection_context,
)
from app.python_models.canonical_subject_directory import (
    append_canonical_subject_directory,
    build_canonical_subject_directory,
)
from app.python_models.data_anchor import empty_graph_projection, resolve_data_anchors
from app.python_models.data_anchor_contract import DataAnchorError
from app.python_models.idf import (
    InputMaterializationError,
    estimate_text_tokens,
    idf_public,
    materialize_idf,
)
from app.python_models.graph_reference_contracts import (
    DATA_ANCHOR_ID_FIELDS,
    DataAnchorReference,
    graph_record_fields,
    graph_record_identity,
)
from app.python_models.postgres import connect_postgres
from app.python_models.project_worldview import (
    ProjectWorldviewError,
    resolve_project_worldview,
)
from app.python_models.saved_card_contract import (
    CardDomainError,
    validate_auto_runtime_options,
    canonical_json,
    card_is_enabled,
    card_runtime,
    is_magnetic_taskgraph_runtime,
    json_object,
    required_content,
    required_text,
    runtime_owner,
    saved_openai_runtime,
    sha256_text,
    string_list,
    subagent_model_selection,
    subagent_type_selection,
    validate_saved_provider_selection,
)
from app.python_models.tool_catalog import materialize_live_tool_catalog_with_failures

_OPTIONAL_TOOL_CATALOG_FAMILIES = frozenset({"cbm", "graphiti"})

_DATA_ANCHOR_LIMIT = 16

_FORBIDDEN_INVOCATION_CONTEXT_FIELDS = (
    "builderOperation", "agentBuilderOperation", "agentBuilderGuidance",
    "buildTarget", "selectedCardTarget",
    "contextMarkdown",
    "keyContext",
    "visibleMessages",
    "priorResults",
    "outputRequirements",
    "tools",
)

def _reject_non_graph_invocation_context(payload: dict[str, Any]) -> None:
    """Fail closed when a caller tries to bypass mission + graph references."""

    for field in _FORBIDDEN_INVOCATION_CONTEXT_FIELDS:
        if field in payload:
            raise CardDomainError(f"invocation_context_field_forbidden:{field}")

def _normalized_data_anchors(value: Any) -> list[dict[str, Any]]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise CardDomainError("data_anchors_invalid")
    if len(value) > _DATA_ANCHOR_LIMIT:
        raise CardDomainError("data_anchor_limit_exceeded")
    normalized: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            raise CardDomainError("data_anchor_invalid")
        try:
            anchor = DataAnchorReference.model_validate(item).model_dump(exclude_unset=True)
        except ValidationError as error:
            raise CardDomainError("data_anchor_invalid") from error
        try:
            identity = graph_record_identity(anchor)
        except ValueError as error:
            raise CardDomainError("data_anchor_identity_invalid") from error
        if identity in seen:
            raise CardDomainError("data_anchor_duplicate")
        seen.add(identity)
        bounded_expansion = anchor.get("boundedExpansion")
        if bounded_expansion < 0 or bounded_expansion > 3:
            raise CardDomainError("data_anchor_expansion_invalid")
        result_limit = int(anchor.get("resultLimit", 24))
        if result_limit < 1 or result_limit > 24:
            raise CardDomainError("data_anchor_result_limit_invalid")
        normalized.append({
            **graph_record_fields(*identity),
            "reason": required_text(anchor.get("reason"), "data_anchor_reason")[:2_000],
            "priority": int(anchor.get("priority", 0)),
            "boundedExpansion": bounded_expansion,
            "resultLimit": result_limit,
            "required": anchor.get("required") is True,
            "_inputOrder": index,
        })
    return normalized

def _authorize_invocation_sender(
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
            and agentgraph_topology._card_has_orchestrator_authority(sender)
            and any(
                target["cardId"] == card_id
                for target in agentgraph_topology._direct_card_targets(
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
            for target in agentgraph_topology._direct_card_targets(
                sender_id, cards, edges
            )
        )
    if sender is None or not authorized:
        raise CardDomainError("card_invocation_edge_authority_required")

def _execution_authority_fingerprint(
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

def _saved_invocation_configuration(card: dict[str, Any]) -> dict[str, Any]:
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

def _resolve_effective_card_tools(
    payload: dict[str, Any], *, loaded: dict[str, Any],
    options: dict[str, Any], runtime: dict[str, Any], ceiling: list[str],
    call_config: dict[str, Any], runtime_options: dict[str, Any],
) -> tuple[dict[str, Any], list[str], list[dict[str, Any]], dict[str, Any]]:
    catalog_state = str(
        payload.get("discoveredToolCatalogState") or "available"
    ).strip()
    if catalog_state not in {"available", "unavailable"}:
        raise CardDomainError("discovered_tool_catalog_state_invalid")
    unavailable_catalog_families = set(string_list(
        payload.get("unavailableToolCatalogFamilies"),
        "unavailable_tool_catalog_families",
    ))
    if not unavailable_catalog_families <= _OPTIONAL_TOOL_CATALOG_FAMILIES:
        raise CardDomainError("unavailable_tool_catalog_family_invalid")
    discovered_tools = payload.get("discoveredTools") or []
    if not isinstance(discovered_tools, list):
        raise CardDomainError("discovered_tools_invalid")
    if catalog_state == "unavailable" and discovered_tools:
        raise CardDomainError("discovered_tool_catalog_state_invalid")
    raw_discovered_failures = payload.get("discoveredToolFailures") or {}
    if (
        not isinstance(raw_discovered_failures, dict)
        or any(
            not isinstance(name, str) or not name.strip()
            or not isinstance(reason, str) or not reason.strip()
            for name, reason in raw_discovered_failures.items()
        )
    ):
        raise CardDomainError("discovered_tool_failures_invalid")
    catalog, normalized_failures = materialize_live_tool_catalog_with_failures(
        discovered_tools
    )
    tool_catalog_failures = {
        **{str(name): str(reason) for name, reason in raw_discovered_failures.items()},
        **normalized_failures,
    }
    catalog_failure = next(iter(tool_catalog_failures.values()), None)
    by_id = {item["canonicalId"]: item for item in catalog}
    catalog_ceiling = list(ceiling)
    unknown_tools = [name for name in catalog_ceiling if name not in by_id]
    unexpected_unknown_tools = [
        name for name in unknown_tools
        if (
            catalog_state == "available"
            and name not in tool_catalog_failures
            and (
                "." not in name
                or name.split(".", 1)[0] not in unavailable_catalog_families
            )
        )
    ]
    if unexpected_unknown_tools:
        raise CardDomainError(
            f"configured_tool_unknown:{unexpected_unknown_tools[0]}"
        )
    ineligible_tools = [
        name for name in catalog_ceiling
        if name in by_id and by_id[name].get("grantEligible") is not True
    ]
    if ineligible_tools:
        raise CardDomainError(
            f"configured_tool_not_grant_eligible:{ineligible_tools[0]}"
        )
    selected_mcp_connections = set(call_config["mcpConnectionIds"])
    connection_granted_tools = [
        item["canonicalId"] for item in catalog
        if (
            "external-mcp" in item.get("publications", [])
            and str(item.get("provider") or "") in selected_mcp_connections
        )
    ]
    # An individual saved tool is its own grant. A saved MCP connection is the
    # optional broader form: it grants the catalog currently published by that
    # connection. Neither form depends on the other.
    catalog_ceiling = list(dict.fromkeys([*catalog_ceiling, *connection_granted_tools]))

    def unavailable_reason(name: str) -> str | None:
        if name in tool_catalog_failures:
            return tool_catalog_failures[name]
        definition = by_id.get(name)
        if definition is None:
            family = name.split(".", 1)[0] if "." in name else ""
            return (
                "catalog_unavailable"
                if (
                    catalog_state == "unavailable"
                    or family in unavailable_catalog_families
                )
                else "capability_unavailable"
            )
        if definition.get("available") is not True:
            return (
                "catalog_unavailable"
                if catalog_state == "unavailable"
                else "capability_unavailable"
            )
        if runtime.get("kind") != "hermes":
            return None
        if set(definition.get("publications") or []) & {
            "card-runtime", "external-mcp",
        }:
            return None
        return "hermes_capability_owner_unsupported"

    unavailable_tool_reasons = {
        name: reason for name in catalog_ceiling
        if (reason := unavailable_reason(name)) is not None
    }
    unavailable_tools = list(unavailable_tool_reasons)
    effective_tools = [
        name for name in catalog_ceiling
        if unavailable_reason(name) is None
    ]
    # The normalized live catalog is the execution-availability and
    # saved-grant owner. Builder IDD data is not read on this path.
    try:
        project_worldview = resolve_project_worldview(
            loaded["projectId"],
            list(effective_tools),
            connector=connect_postgres,
        )
    except ProjectWorldviewError as error:
        raise CardDomainError(str(error)) from error
    project_enabled_tools = set(project_worldview["enabledCapabilities"])
    selected_tools = [
        name for name in effective_tools if name in project_enabled_tools
    ]
    call_config["enabledTools"] = selected_tools
    call_config["unavailableTools"] = unavailable_tools
    call_config["unavailableToolReasons"] = unavailable_tool_reasons
    call_config["toolCatalogFailure"] = catalog_failure
    call_config["toolCatalogFailures"] = tool_catalog_failures
    call_config["projectWorldview"] = project_worldview
    # `tools` remains the saved Card's deliberately selected presentation.
    presented_tools = [
        name for name in catalog_ceiling
        if name in selected_tools and name in by_id
    ]
    try:
        script_plan = script_presentation(
            options.get("script"),
            selected_tools=selected_tools,
            default_agent_tools=presented_tools,
        )
    except CardScriptValidationError as error:
        raise CardDomainError(str(error)) from error
    if options.get("script") is not None:
        runtime_options["script"] = script_plan["script"]
    call_config["scriptPresentation"] = {
        "mode": script_plan["mode"],
    }
    call_config["presentedTools"] = script_plan["presentedTools"]
    tool_definitions = [by_id[name] for name in call_config["presentedTools"]]
    return call_config, presented_tools, tool_definitions, project_worldview

def _prepare_invocation(
    payload: dict[str, Any],
    *,
    require_assignment: bool = True,
    include_tool_definitions: bool = True,
) -> dict[str, Any]:
    project_ref = required_text(payload.get("projectId"), "project_id")
    deck_id = required_text(payload.get("deckId"), "deck_id")
    card_id = required_text(payload.get("cardId"), "card_id")
    assignment = (
        required_content(payload.get("assignment"), "assignment")
        if require_assignment
        else str(payload.get("assignment") or "")
    )
    loaded = saved_cards.load_deck(project_ref, deck_id)
    cards = {card["id"]: card for card in loaded["deck"]["nodes"]}
    card = cards.get(card_id)
    if card is None:
        raise CardDomainError("card_not_found")
    if not card_is_enabled(card):
        raise CardDomainError("card_disabled")
    _authorize_invocation_sender(
        str(payload.get("senderCardId") or "").strip(), card_id, card, cards,
        loaded["deck"]["edges"],
    )
    saved = _saved_invocation_configuration(card)
    options = saved["options"]
    runtime = saved["runtime"]
    auto_tools = saved["autoTools"]
    auto_model = saved["autoModel"]
    ceiling = saved["ceiling"]
    owner = saved["runtimeOwner"]
    requested_reasoning_effort = saved["reasoningEffort"]
    call_config = saved["callConfig"]
    runtime_options = call_config["runtimeOptions"]
    deck_revision = str((loaded.get("meta") or {}).get("deckRevision") or "")
    card_identity = {"cardId": card_id, "title": card["title"]}
    call_config, presented_tools, tool_definitions, project_worldview = (
        _resolve_effective_card_tools(
            payload, loaded=loaded, options=options, runtime=runtime,
            ceiling=ceiling, call_config=call_config,
            runtime_options=runtime_options,
        )
    )
    # Hermes thread ownership binds only stable saved-Card/runtime identity.
    # Live catalog schemas and availability can change after a plugin reconnect;
    # those remain per-turn tool evidence and must not invalidate the Card's
    # already-established Hermes thread. The saved revision hash already covers
    # the Card's prompt, grants, tools, skills, and other saved configuration.
    execution_authority_sha256 = _execution_authority_fingerprint(
        project_id=loaded["projectId"], deck_id=deck_id, card_id=card_id,
        card_revision_id=card["_cardRevisionId"],
        card_revision_sha256=card["_cardRevisionSha256"], runtime=runtime,
        provider=call_config["provider"],
        openai_runtime=runtime_options.get("openaiRuntime"),
    )
    runtime_options["executionAuthorityFingerprint"] = execution_authority_sha256
    return {
        "ok": True,
        "ephemeral": True,
        "projectId": loaded["projectId"],
        "deckId": deck_id,
        "deckRevision": deck_revision,
        "cardRevisionId": card["_cardRevisionId"],
        "cardRevision": card["_cardRevision"],
        "cardRevisionSha256": card["_cardRevisionSha256"],
        "runtimeOwner": owner,
        "executionAuthorityFingerprint": execution_authority_sha256,
        "_outputRequirements": str(card.get("outputContract") or ""),
        "_autoTools": auto_tools,
        "_autoModel": auto_model,
        "_requestedReasoningEffort": requested_reasoning_effort,
        "_ordinaryBaselineTools": presented_tools,
        "_ordinaryToolContracts": [by_id[name] for name in presented_tools],
        "assignment": assignment,
        "cardIdentity": card_identity,
        "projectWorldview": project_worldview,
        "_callConfig": call_config,
        "_toolDefinitions": tool_definitions if include_tool_definitions else [],
    }

def _resolve_invocation_components(
    payload: dict[str, Any],
    *,
    selection_request: str | None = None,
) -> dict[str, Any]:
    """Resolve saved authority and optional graph data without materializing IDF."""

    _reject_non_graph_invocation_context(payload)
    prepared = _prepare_invocation(payload)
    output_requirements = prepared.pop("_outputRequirements")
    auto_tools = prepared.pop("_autoTools")
    auto_model = prepared.pop("_autoModel")
    requested_reasoning_effort = prepared.pop("_requestedReasoningEffort")
    ordinary_baseline_tools = prepared.pop("_ordinaryBaselineTools")
    ordinary_tool_contracts = prepared.pop("_ordinaryToolContracts")
    call_config = prepared.pop("_callConfig")
    assignment = prepared.pop("assignment")
    tool_definitions = prepared.pop("_toolDefinitions")
    references: list[dict[str, Any]] = []
    incoming_anchors = _normalized_data_anchors(payload.get("dataAnchors"))
    incoming_anchors.sort(key=lambda item: (-item["priority"], item["_inputOrder"]))
    anchors = incoming_anchors
    anchor_identities = [
        graph_record_identity(anchor)
        for anchor in anchors
        if any(str(anchor.get(field) or "").strip() for field in DATA_ANCHOR_ID_FIELDS)
    ]
    if len(anchor_identities) != len(set(anchor_identities)):
        raise CardDomainError("data_anchor_duplicate")
    for anchor in anchors:
        anchor.pop("_inputOrder", None)
        anchor.pop("priority", None)
    graph_projection = empty_graph_projection(prepared["projectId"])
    try:
        graph_seed, anchor_references = resolve_data_anchors(
            prepared["projectId"],
            anchors,
            deck_id=prepared["deckId"],
            card_id=prepared["cardIdentity"]["cardId"],
            graph_projection=graph_projection,
        )
    except DataAnchorError as error:
        raise CardDomainError(str(error)) from error
    existing_reference_ids = {graph_record_identity(reference) for reference in references}
    references.extend(
        reference for reference in anchor_references
        if graph_record_identity(reference) not in existing_reference_ids
    )
    images = payload.get("images") or []
    if not isinstance(images, list) or any(not isinstance(item, dict) for item in images):
        raise CardDomainError("images_invalid")
    decision_context: dict[str, Any] = {}
    if auto_tools or auto_model:
        exact_request = assignment if selection_request is None else selection_request
        if not isinstance(exact_request, str) or not exact_request.strip():
            raise CardDomainError("selection_request_required")
        estimated_visible_tokens = sum(estimate_text_tokens(value) for value in (
            call_config["systemPrompt"],
            output_requirements,
            assignment,
            graph_seed,
            json.dumps(
                ordinary_tool_contracts,
                ensure_ascii=False,
                separators=(",", ":"),
                default=str,
            ),
        ))
        try:
            decision_context = selection_context(
                current_request=exact_request,
                instructions=call_config["systemPrompt"],
                output_contract=output_requirements,
                graph_records=references,
                attachments=images,
                estimated_visible_tokens=estimated_visible_tokens,
            )
        except ValueError as error:
            raise CardDomainError("card_run_selection_context_invalid") from error
    auto_tools_decision: dict[str, Any] | None = None
    default_agent_tools = ordinary_baseline_tools
    if auto_tools:
        default_agent_tools, auto_tools_decision = select_auto_tools(
            baseline_tool_ids=ordinary_baseline_tools,
            tool_contracts=ordinary_tool_contracts,
            context=decision_context,
        )
    try:
        script_plan = script_presentation(
            call_config["runtimeOptions"].get("script"),
            selected_tools=call_config["enabledTools"],
            default_agent_tools=default_agent_tools,
        )
    except CardScriptValidationError as error:
        raise CardDomainError(str(error)) from error
    if "script" in call_config["runtimeOptions"]:
        call_config["runtimeOptions"]["script"] = script_plan["script"]
    call_config["scriptPresentation"] = {"mode": script_plan["mode"]}
    call_config["presentedTools"] = script_plan["presentedTools"]
    by_id = {
        str(item.get("canonicalId") or ""): item
        for item in ordinary_tool_contracts
    }
    tool_definitions = [by_id[name] for name in call_config["presentedTools"]]
    if auto_tools_decision is not None:
        auto_tools_decision = {
            **auto_tools_decision,
            # This is the actual model-visible result after explicit Card
            # Python AGENT/BOTH modes have been applied.
            "selectedToolIds": list(call_config["presentedTools"]),
        }
    auto_model_decision: dict[str, Any] | None = None
    if auto_model:
        try:
            call_config["provider"], auto_model_decision = select_auto_model(
                saved_provider=call_config["provider"],
                raw_candidates=payload.get("autoModelCandidates"),
                context={
                    **decision_context,
                    "actual_model_visible_tool_contracts": tool_definitions,
                },
                tools_required=(
                    bool(call_config["presentedTools"])
                    or script_plan["mode"] == "script"
                ),
                images_required=bool(images),
                reasoning_effort=requested_reasoning_effort,
            )
        except AutoModelSelectionError as error:
            error.auto_tools_decision = auto_tools_decision
            raise
    fingerprint = _execution_authority_fingerprint(
        project_id=prepared["projectId"], deck_id=prepared["deckId"],
        card_id=prepared["cardIdentity"]["cardId"],
        card_revision_id=prepared["cardRevisionId"],
        card_revision_sha256=prepared["cardRevisionSha256"],
        runtime=call_config["runtime"], provider=call_config["provider"],
        openai_runtime=call_config["runtimeOptions"].get("openaiRuntime"),
    )
    prepared["executionAuthorityFingerprint"] = fingerprint
    call_config["runtimeOptions"]["executionAuthorityFingerprint"] = fingerprint
    return {
        "prepared": prepared,
        "outputRequirements": output_requirements,
        "callConfig": call_config,
        "assignment": assignment,
        "toolDefinitions": tool_definitions,
        "graphText": graph_seed,
        "graphRecords": references,
        "resolvedGraphReads": anchor_references,
        "resolvedGraphProjection": graph_projection,
        "images": images,
        "autoToolsDecision": auto_tools_decision,
        "autoModelDecision": auto_model_decision,
    }

def materialize_invocation(
    payload: dict[str, Any],
    *,
    selection_request: str | None = None,
) -> dict[str, Any]:
    required_text(payload.get("runId"), "run_id")
    resolved = _resolve_invocation_components(
        payload,
        selection_request=selection_request,
    )
    prepared = resolved["prepared"]
    output_requirements = resolved["outputRequirements"]
    call_config = resolved["callConfig"]
    assignment = resolved["assignment"]
    tool_definitions = resolved["toolDefinitions"]
    graph_seed = resolved["graphText"]
    references = resolved["graphRecords"]
    anchor_references = resolved["resolvedGraphReads"]
    graph_projection = resolved["resolvedGraphProjection"]
    images = resolved["images"]
    auto_tools_decision = resolved["autoToolsDecision"]
    auto_model_decision = resolved["autoModelDecision"]
    subject_directory: dict[str, Any] | None = None
    if prepared["cardIdentity"]["cardId"] == "card_knowgraph":
        try:
            subject_directory = build_canonical_subject_directory(
                prepared["projectId"]
            )
            graph_seed = append_canonical_subject_directory(
                graph_seed, subject_directory
            )
        except DataAnchorError as error:
            raise CardDomainError(str(error)) from error
    try:
        materialized = materialize_idf(
            stable={
                "projectId": prepared["projectId"],
                "deckId": prepared["deckId"],
                "cardId": prepared["cardIdentity"]["cardId"],
                "cardTitle": prepared["cardIdentity"]["title"],
                "cardRevisionId": prepared["cardRevisionId"],
                "cardRevision": prepared["cardRevision"],
                "cardRevisionSha256": prepared["cardRevisionSha256"],
                "instructions": call_config["systemPrompt"],
                "outputContract": output_requirements,
                "runtime": call_config["runtime"],
                "provider": call_config["provider"],
                "runtimeOptions": call_config["runtimeOptions"],
            },
            variable={
                "task": assignment,
                "images": images,
            },
            capabilities={
                "enabledTools": call_config["enabledTools"],
                "unavailableTools": call_config["unavailableTools"],
                "unavailableToolReasons": call_config["unavailableToolReasons"],
                "presentedTools": call_config["presentedTools"],
                "toolDefinitions": tool_definitions,
                "scriptPresentation": call_config["scriptPresentation"],
                "skills": call_config["skills"],
                "toolsets": call_config["toolsets"],
                "mcpConnectionIds": call_config["mcpConnectionIds"],
            },
            graph_context=graph_seed,
            graph_records=references,
            graph_projection=graph_projection,
        )
    except InputMaterializationError as error:
        raise CardDomainError(str(error)) from error
    return {
        **prepared,
        "resolvedGraphReads": anchor_references,
        "resolvedGraphProjection": graph_projection,
        **({"canonicalSubjectDirectory": subject_directory}
           if subject_directory is not None else {}),
        "autoToolsDecision": auto_tools_decision,
        "autoModelDecision": auto_model_decision,
        **idf_public(materialized),
        "_materializedIdf": materialized,
    }

def prepare_main_chat(payload: dict[str, Any]) -> dict[str, Any]:
    """Preview saved Main authority without starting a Run."""
    project_ref = required_text(payload.get("projectId"), "project_id")
    deck_id = required_text(payload.get("deckId"), "deck_id")
    loaded = saved_cards.load_deck(project_ref, deck_id)
    main_cards = [
        card for card in loaded["deck"]["nodes"]
        if card_runtime(card).get("kind") == "hermes"
        and card_runtime(card).get("mode") == "main"
    ]
    if len(main_cards) != 1:
        raise CardDomainError("main_card_identity_ambiguous")
    message = str(payload.get("message") or "")
    prepared = _prepare_invocation({
        **payload,
        "projectId": loaded["projectId"],
        "deckId": deck_id,
        "cardId": main_cards[0]["id"],
        "assignment": "",
    }, require_assignment=False, include_tool_definitions=True)
    prepared.pop("_outputRequirements", None)
    prepared.pop("_autoTools", None)
    prepared.pop("_autoModel", None)
    prepared.pop("_requestedReasoningEffort", None)
    prepared.pop("_ordinaryBaselineTools", None)
    prepared.pop("_ordinaryToolContracts", None)
    prepared.pop("assignment", None)
    call_config = prepared.pop("_callConfig")
    prepared.pop("_toolDefinitions")
    return {
        **prepared,
        **({"message": message} if message else {}),
        "sessionProfile": call_config,
    }

def resolve_magnetic_taskgraph_card(
    project_ref: str,
    deck_id: str,
) -> dict[str, str]:
    """Resolve the one saved Mag One Card without materializing model input."""

    project_ref = required_text(project_ref, "project_id")
    deck_id = required_text(deck_id, "deck_id")
    loaded = saved_cards.load_deck(project_ref, deck_id)
    targets = [
        card for card in loaded["deck"]["nodes"]
        if card_is_enabled(card)
        and is_magnetic_taskgraph_runtime(card_runtime(card))
    ]
    if len(targets) != 1:
        raise CardDomainError("magnetic_taskgraph_card_identity_ambiguous")
    return {
        "projectId": loaded["projectId"],
        "deckId": deck_id,
        "cardId": targets[0]["id"],
    }

def prepare_run_invocation(
    payload: dict[str, Any],
    *,
    selection_request: str | None = None,
) -> dict[str, Any]:
    """Resolve one saved Card and materialize its current transient input."""

    prepared = materialize_invocation(
        payload,
        selection_request=selection_request,
    )
    expected_revision = str(payload.get("cardRevisionId") or "").strip()
    if expected_revision and prepared["cardRevisionId"] != expected_revision:
        raise CardDomainError("card_revision_changed")
    assert_selected_graph_data_resolved(payload, prepared)
    return prepared

def assert_selected_graph_data_resolved(
    payload: dict[str, Any],
    prepared: dict[str, Any],
) -> None:
    """Validate the exact optional graph selection without making it mandatory."""

    requested = _normalized_data_anchors(payload.get("dataAnchors"))
    if not requested:
        return

    resolved = {
        graph_record_identity(reference)
        for reference in prepared.get("resolvedGraphReads") or []
        if isinstance(reference, dict)
    }
    for anchor in requested:
        identity = graph_record_identity(anchor)
        if identity not in resolved:
            raise CardDomainError(
                f"selected_graph_data_reference_stale:{identity[0]}:{identity[1]}"
            )
    projection = prepared.get("resolvedGraphProjection")
    if not isinstance(projection, dict) or not (
        projection.get("nodes") or projection.get("edges")
    ):
        raise CardDomainError("selected_graph_data_projection_empty")
