"""Native Engraphis settlement for one completed User/Main pair."""

from __future__ import annotations

from copy import deepcopy
from typing import Any, Callable

from engraphis.core.interfaces import MemoryType, Scope

from .engraphis import (
    THINK_INCIDENCE_KIND,
    THINKGRAPH_INTAKE_LOCK,
    existing_entity_for_name,
    get_service,
    graph_revision,
    validated_think_metadata,
)
from .thinkgraph_completed_pair_extraction import (
    extract_saved_card_facts,
    project_saved_card_think,
)
from .thinkgraph_completed_pair_preparation import (
    existing_source_pair_thinks,
    pair_reference,
    source_pair,
    validate_completed_pair_payload,
)
from .thinkgraph_relationship_classification import (
    classify_relationship,
    classify_relationships,
)
from .thinkgraph_relationship_settlement import apply_accepted_decision
from .thinkgraph_relationship_vocabulary import (
    ThinkGraphIntakeError,
    project_relationship_vocabulary,
    relationship_vocabulary_state,
)


def _save_think_memory(
    service: Any,
    *,
    workspace_id: str,
    completed: dict[str, Any],
    output: dict[str, Any],
    card_run: dict[str, str],
    pair_reference_value: str,
    finalizer: Callable[[str], None],
) -> dict[str, Any]:
    """Append one Engraphis Think and settle its preclassified graph atomically."""
    source_pair_value = source_pair(completed)
    metadata = {
        # Keep the Card's free-form relationship language inside the Think. By
        # nesting it below `think`, Engraphis's structured graph feeder cannot
        # mistake those proposals for already-classified durable edges.
        "structured_extraction": {
            "think": {
                "summary": output["summary"],
                "entities": deepcopy(output["entities"]),
                "relationships": deepcopy(output["relationships"]),
            },
        },
        "consolidation_exempt": True,
        "thinkgraph_origin": {
            "authority": "thinkgraph",
            "writer": "saved_thinkgraph_card",
            "card_id": card_run["cardId"],
            "card_revision_id": card_run["revisionId"],
            "run_id": card_run["runId"],
            "profile": card_run["profile"],
            "hermes_session_id": card_run["hermesSessionId"],
            "resolved_provider": card_run["resolvedProvider"],
            "resolved_model": card_run["resolvedModel"],
            "completed_pair_reference": pair_reference_value,
            "fact_index": 0,
            "fact_count": 1,
            "source_pair": source_pair_value,
        },
        "provenance": {
            "source": "saved_thinkgraph_card",
            "trusted": True,
            "review_state": "approved",
            "trust_origin": "saved_card_runtime",
        },
    }

    def existing() -> dict[str, Any] | None:
        matches = existing_source_pair_thinks(
            service.store,
            workspace_id=workspace_id,
            pair_reference=pair_reference_value,
        )
        if not matches:
            return None
        return {
            "id": matches[0].id,
            "op": "noop",
            "reason": "completed pair already has an authoritative Think",
        }

    return service.engine.remember_with_resolution(
        output["summary"],
        workspace_id=workspace_id,
        mtype=MemoryType.EPISODIC,
        scope=Scope.WORKSPACE,
        title=output["title"],
        importance=output["importance"],
        keywords=output["keywords"],
        metadata=metadata,
        resolve_conflicts=False,
        subject_key=f"thinkgraph:{pair_reference_value}",
        claim_kind="think",
        _trusted_graph_keys=frozenset({"structured_extraction"}),
        _transactional_validator=existing,
        _transactional_finalizer=finalizer,
    )


def _validate_settle_payload(
    payload: dict[str, Any],
) -> tuple[dict[str, Any], str, Any, dict[str, str]]:
    if not isinstance(payload, dict):
        raise ValueError("thinkgraph_completed_pair_payload_invalid")
    completed_keys = {
        "projectId", "deckId", "conversationId", "runId", "cardId",
        "hermesSessionId", "completedAt", "userMessage", "mainResponse",
    }
    extras = {"pairReference", "structuredOutput", "cardRun"}
    if set(payload) - completed_keys - extras:
        raise ValueError("thinkgraph_completed_pair_payload_invalid")
    completed = validate_completed_pair_payload({
        key: payload[key] for key in completed_keys if key in payload
    })
    pair_reference_value = str(payload.get("pairReference") or "")
    if pair_reference_value != pair_reference(completed):
        raise ValueError("thinkgraph_pair_reference_invalid")
    structured_output = payload.get("structuredOutput")
    if not isinstance(structured_output, (str, dict, list)):
        raise ValueError("thinkgraph_card_output_invalid_json")
    raw_run = payload.get("cardRun")
    if not isinstance(raw_run, dict):
        raise ValueError("thinkgraph_card_run_invalid")
    allowed_run = {
        "runId", "cardId", "revisionId", "profile", "hermesSessionId",
        "resolvedProvider", "resolvedModel",
    }
    if set(raw_run) - allowed_run:
        raise ValueError("thinkgraph_card_run_invalid")
    card_run = {key: str(raw_run.get(key) or "") for key in allowed_run}
    if any(not card_run[key] for key in allowed_run):
        raise ValueError("thinkgraph_card_run_invalid")
    return completed, pair_reference_value, structured_output, card_run


def _existing_completed_pair_result(
    *,
    project: str,
    pair_reference_value: str,
    card_run: dict[str, str],
    revision_before: str,
    memory_id: str,
) -> dict[str, Any]:
    return {
        "ok": True,
        "projectId": project,
        "pairReference": pair_reference_value,
        "thinkMemoryId": memory_id,
        "thinkMemoryIds": [memory_id],
        "intakeOperation": "noop",
        "intakeOperations": ["noop"],
        "revision": revision_before,
        "revisionChanged": False,
        "status": "completed",
        "cardRun": card_run,
        "relationships": [],
        "newSubjects": [],
        "changedNodeIds": [],
        "changedEdgeIds": [],
        "affectedNodeIds": [],
    }


def _settle_new_completed_pair(
    *,
    service: Any,
    store: Any,
    workspace_id: str,
    revision_before: str,
    completed: dict[str, Any],
    pair_reference_value: str,
    card_output: Any,
    card_run: dict[str, str],
    classifier: Callable[..., dict[str, Any]],
) -> dict[str, Any]:
    project = completed["projectId"]
    facts = extract_saved_card_facts(
        card_output,
        pair_text=(
            f"USER:\n{completed['userMessage']}\n\n"
            f"MAIN:\n{completed['mainResponse']}"
        ),
        context={
            "exact_user_message": completed["userMessage"],
            "exact_main_response": completed["mainResponse"],
        },
        card_run=card_run,
    )
    output = project_saved_card_think(facts)
    relationship_vocabulary = project_relationship_vocabulary(
        store,
        workspace_id,
    )
    decisions = classify_relationships(
        store,
        workspace_id=workspace_id,
        payload=completed,
        summary=output["summary"],
        relationships=output["relationships"],
        classifier=classifier,
        relationship_vocabulary=relationship_vocabulary,
    )
    settled_graph: dict[str, Any] = {
        "relationships": [],
        "newSubjects": [],
        "changedNodeIds": [],
        "changedEdgeIds": [],
    }

    def finalize(memory_id: str) -> None:
        memory = store.get_memory(memory_id)
        if memory is None:
            raise ThinkGraphIntakeError("thinkgraph_think_store_failed")
        relationships: list[dict[str, Any]] = []
        new_subjects: dict[str, dict[str, Any]] = {}
        changed_node_ids: list[str] = []
        changed_edge_ids: list[str] = []
        for relationship, decision in zip(
            output["relationships"], decisions, strict=True,
        ):
            written = apply_accepted_decision(
                store,
                workspace_id=workspace_id,
                payload=completed,
                memory_id=memory_id,
                relationship=relationship,
                decision=decision,
            )
            relationships.append({"id": written["edge_id"], **written})
            changed_node_ids.extend((written["source"], written["target"]))
            changed_edge_ids.append(written["edge_id"])
            changed_edge_ids.extend(written["replaced_edge_ids"])
            for subject in written["new_subjects"]:
                entity_id = str(subject["engraphisEntityId"])
                new_subjects[entity_id] = {
                    **subject,
                    "engraphisMemoryId": memory_id,
                    "thinkContext": {
                        "title": output["title"],
                        "summary": output["summary"],
                    },
                }

        # Direct structured-extractor incidence is the only authority that
        # attaches this Think to its accepted canonical endpoints.
        for entity_name in output["entities"]:
            row = existing_entity_for_name(
                store,
                workspace_id=workspace_id,
                name=entity_name,
            )
            if row is None:
                raise ThinkGraphIntakeError(
                    "thinkgraph_structured_entity_unsettled"
                )
            entity_id = str(row["id"])
            store.link_memory_entity(
                memory_id=memory_id,
                entity_id=entity_id,
                workspace_id=workspace_id,
                repo_id=None,
                source_kind=THINK_INCIDENCE_KIND,
                confidence=1.0,
                valid_from=memory.valid_from,
                ingested_at=memory.ingested_at,
                provenance={
                    "source": "structured_extractor",
                    "source_kind": THINK_INCIDENCE_KIND,
                    "memory_id": memory_id,
                },
                commit=False,
            )
            changed_node_ids.append(entity_id)
        settled_graph.update({
            "relationships": relationships,
            "newSubjects": list(new_subjects.values()),
            "changedNodeIds": list(dict.fromkeys(changed_node_ids)),
            "changedEdgeIds": list(dict.fromkeys(changed_edge_ids)),
        })

    try:
        saved_think = _save_think_memory(
            service,
            workspace_id=workspace_id,
            completed=completed,
            output=output,
            card_run=card_run,
            pair_reference_value=pair_reference_value,
            finalizer=finalize,
        )
    except ThinkGraphIntakeError:
        raise
    except Exception as error:
        raise ThinkGraphIntakeError("thinkgraph_think_store_failed") from error
    memory_id = str(saved_think.get("id") or "")
    memory = store.get_memory(memory_id) if memory_id else None
    if memory is None or validated_think_metadata(memory) is None:
        raise ThinkGraphIntakeError("thinkgraph_think_store_failed")
    operation = str(saved_think.get("op") or "")
    if operation == "noop" and not settled_graph["relationships"]:
        settled_graph = {
            "relationships": [],
            "newSubjects": [],
            "changedNodeIds": [],
            "changedEdgeIds": [],
        }
    revision = graph_revision(store, workspace_id)
    return {
        "ok": True,
        "projectId": project,
        "pairReference": pair_reference_value,
        "thinkMemoryId": memory_id,
        "thinkMemoryIds": [memory_id],
        "intakeOperation": operation,
        "intakeOperations": [operation],
        "revision": revision,
        "revisionChanged": revision != revision_before,
        "status": "completed",
        "cardRun": card_run,
        "pairSummary": output["summary"],
        "relationships": settled_graph["relationships"],
        "newSubjects": settled_graph["newSubjects"],
        "relationshipVocabulary": relationship_vocabulary_state(
            relationship_vocabulary
        ),
        "changedNodeIds": settled_graph["changedNodeIds"],
        "changedEdgeIds": settled_graph["changedEdgeIds"],
        "affectedNodeIds": sorted(settled_graph["changedNodeIds"]),
    }


def settle_completed_pair(
    payload: dict[str, Any],
    *,
    classifier: Callable[..., dict[str, Any]] = classify_relationship,
) -> dict[str, Any]:
    """Append one Engraphis episodic Think and only its Jev-classified edges."""
    completed, pair_reference_value, card_output, card_run = (
        _validate_settle_payload(payload)
    )
    project = completed["projectId"]
    service = get_service()
    with THINKGRAPH_INTAKE_LOCK:
        store = service.store
        workspace_id = store.get_or_create_workspace(project)
        revision_before = graph_revision(store, workspace_id)
        existing = existing_source_pair_thinks(
            store,
            workspace_id=workspace_id,
            pair_reference=pair_reference_value,
        )
        if existing:
            return _existing_completed_pair_result(
                project=project,
                pair_reference_value=pair_reference_value,
                card_run=card_run,
                revision_before=revision_before,
                memory_id=str(existing[0].id),
            )
        return _settle_new_completed_pair(
            service=service,
            store=store,
            workspace_id=workspace_id,
            revision_before=revision_before,
            completed=completed,
            pair_reference_value=pair_reference_value,
            card_output=card_output,
            card_run=card_run,
            classifier=classifier,
        )
