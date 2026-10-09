"""Graph selection, AutoTools/AutoModel, and canonical Card IDF preparation."""

from __future__ import annotations

import json
from typing import Any

from pydantic import ValidationError

from app.python_models import saved_cards
from app.python_models.card_invocation_authority import (
    authorize_invocation_sender,
    execution_authority_fingerprint,
    saved_invocation_configuration,
)
from app.python_models.card_invocation_tools import resolve_effective_card_tools
from app.python_models.card_run_auto_model import (
    AutoModelSelectionError,
    select_auto_model,
)
from app.python_models.card_run_auto_tools import select_auto_tools
from app.python_models.card_run_selection_context import selection_context
from app.python_models.card_script import (
    CardScriptValidationError,
    script_presentation,
)
from app.python_models.canonical_subject_directory import (
    append_canonical_subject_directory,
    build_canonical_subject_directory,
)
from app.python_models.data_anchor import empty_graph_projection, resolve_data_anchors
from app.python_models.data_anchor_contract import DataAnchorError
from app.python_models.graph_reference_contracts import (
    DATA_ANCHOR_ID_FIELDS,
    DataAnchorReference,
    graph_record_fields,
    graph_record_identity,
)
from app.python_models.idf import materialize_idf
from app.python_models.idf_contract import InputMaterializationError
from app.python_models.idf_projection import estimate_text_tokens, idf_public
from app.python_models.saved_card_contract import (
    CardDomainError,
    card_is_enabled,
    card_runtime,
    is_magnetic_taskgraph_runtime,
    required_content,
    required_text,
)


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
    authorize_invocation_sender(
        str(payload.get("senderCardId") or "").strip(), card_id, card, cards,
        loaded["deck"]["edges"],
    )
    saved = saved_invocation_configuration(card)
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
    (
        call_config,
        presented_tools,
        ordinary_tool_contracts,
        tool_definitions,
        project_worldview,
    ) = (
        resolve_effective_card_tools(
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
    execution_authority_sha256 = execution_authority_fingerprint(
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
        "_ordinaryToolContracts": ordinary_tool_contracts,
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
    fingerprint = execution_authority_fingerprint(
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
