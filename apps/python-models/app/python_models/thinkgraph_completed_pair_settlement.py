"""Engraphis settlement for one completed User/Main pair."""

# Graph + less = more: less code that does the same work as more code is more useful.
# Entity names the feature; Relationship explains why this file belongs and what it contributes.
# Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
# Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
# Entity: ThinkGraph
# Relationship: This file atomically settles a completed User/Main pair as bounded Entity-specific Thinks, exact attachments, and durable Engraphis relationships.
# Entity: Jev Decisions
# Relationship: This file requires a validated Jev choice for every proposed ThinkGraph relationship before writing or replacing its durable edge.

from __future__ import annotations

from copy import deepcopy
from typing import Any, Callable

from engraphis.core.interfaces import FactSpec, MemoryType, Node, Scope

from .engraphis import (
    THINK_INCIDENCE_KIND,
    THINKGRAPH_INTAKE_LOCK,
    exact_think_entity_ids,
    get_service,
    graph_revision,
    validated_think_metadata,
)
from .thinkgraph_completed_pair_extraction import (
    extract_saved_card_facts,
    project_saved_card_thinks,
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
from .thinkgraph_relationship_settlement import (
    apply_accepted_decision,
)
from .thinkgraph_relationship_vocabulary import (
    ThinkGraphIntakeError,
    project_relationship_vocabulary,
    relationship_vocabulary_state,
)


def _think_metadata(
    *,
    completed: dict[str, Any],
    output: dict[str, Any],
    card_run: dict[str, str],
    pair_reference_value: str,
    fact_index: int,
    fact_count: int,
) -> dict[str, Any]:
    """Build one exact Entity-specific Think envelope for Engraphis."""

    return {
        # The free-form proposals remain Think metadata and cannot become durable
        # edges until the finalizer applies their already-computed Jev decisions.
        "structured_extraction": {
            "think": {
                "summary": output["summary"],
                **({"detail": output["detail"]} if output.get("detail") else {}),
                "entity": output["entity"],
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
            "fact_index": fact_index,
            "fact_count": fact_count,
            "source_pair": source_pair(completed),
        },
        "provenance": {
            "source": "saved_thinkgraph_card",
            "trusted": True,
            "review_state": "approved",
            "trust_origin": "saved_card_runtime",
        },
    }


def _save_think_batch(
    service: Any,
    *,
    workspace_id: str,
    completed: dict[str, Any],
    outputs: list[dict[str, Any]],
    card_run: dict[str, str],
    pair_reference_value: str,
    finalizer: Callable[[list[dict[str, Any]]], None],
) -> list[dict[str, Any]]:
    """Append all Entity-specific Thinks and settle their graph state atomically."""

    fact_count = len(outputs)
    specs = [
        FactSpec(
            content=output["summary"],
            title=output["title"],
            mtype=MemoryType.EPISODIC,
            importance=output["importance"],
            keywords=output["keywords"],
            metadata=_think_metadata(
                completed=completed,
                output=output,
                card_run=card_run,
                pair_reference_value=pair_reference_value,
                fact_index=index,
                fact_count=fact_count,
            ),
            claim_kind="think",
        )
        for index, output in enumerate(outputs)
    ]

    def existing() -> list[dict[str, Any]] | None:
        matches = existing_source_pair_thinks(
            service.store,
            workspace_id=workspace_id,
            pair_reference=pair_reference_value,
        )
        if not matches:
            return None
        return [
            {
                "id": memory.id,
                "op": "noop",
                "reason": "completed pair already has authoritative Thinks",
            }
            for memory in matches
        ]

    return service.engine.remember_entities(
        specs,
        [
            Node(
                id="",
                name=output["entity"],
                ntype="person_or_concept",
                workspace_id=workspace_id,
                repo_id=None,
            )
            for output in outputs
        ],
        workspace_id=workspace_id,
        mtype=MemoryType.EPISODIC,
        scope=Scope.WORKSPACE,
        resolve_conflicts=False,
        _trusted_graph_keys=frozenset({"structured_extraction"}),
        _transactional_validator=existing,
        _transactional_finalizer=finalizer,
        source_kind=THINK_INCIDENCE_KIND,
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
    if not isinstance(structured_output, dict):
        raise ValueError("thinkgraph_card_output_invalid")
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
    memories: list[Any],
    entity_ids: dict[str, str],
) -> dict[str, Any]:
    memory_ids = [str(memory.id) for memory in memories]
    thinks = [
        {
            "engraphisMemoryId": memory_id,
            "engraphisEntityId": entity_ids[memory_id],
        }
        for memory_id in memory_ids
        if memory_id in entity_ids
    ]
    if len(thinks) != len(memory_ids):
        raise ThinkGraphIntakeError("thinkgraph_existing_attachment_invalid")
    return {
        "ok": True,
        "projectId": project,
        "pairReference": pair_reference_value,
        "thinkMemoryIds": memory_ids,
        "thinks": thinks,
        "intakeOperation": "noop",
        "intakeOperations": ["noop"] * len(memory_ids),
        "revision": revision_before,
        "revisionChanged": False,
        "status": "completed",
        "cardRun": card_run,
        "relationships": [],
        "newEntities": [],
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
    outputs = project_saved_card_thinks(facts)
    relationship_vocabulary = project_relationship_vocabulary(store, workspace_id)
    if not outputs:
        return {
            "ok": True,
            "projectId": project,
            "pairReference": pair_reference_value,
            "thinkMemoryIds": [],
            "thinks": [],
            "intakeOperation": "noop",
            "intakeOperations": [],
            "revision": revision_before,
            "revisionChanged": False,
            "status": "completed",
            "cardRun": card_run,
            "relationships": [],
            "newEntities": [],
            "relationshipVocabulary": relationship_vocabulary_state(
                relationship_vocabulary
            ),
            "changedNodeIds": [],
            "changedEdgeIds": [],
            "affectedNodeIds": [],
        }
    decisions_by_output: list[list[dict[str, Any]]] = []
    for output in outputs:
        relationships = output["relationships"]
        decisions_by_output.append(
            classify_relationships(
                store,
                workspace_id=workspace_id,
                payload=completed,
                summary=output["summary"],
                relationships=relationships,
                classifier=classifier,
                relationship_vocabulary=relationship_vocabulary,
            )
            if relationships
            else []
        )

    settled_graph: dict[str, Any] = {
        "attachments": [],
        "relationships": [],
        "newEntities": [],
        "changedNodeIds": [],
        "changedEdgeIds": [],
    }
    existing_entity_ids = {
        str(entity.id) for entity in store.list_entities()
        if entity.workspace_id == workspace_id and entity.repo_id is None
    }

    def finalize(results: list[dict[str, Any]]) -> None:
        if len(results) != len(outputs) or any(
            str(result.get("op") or "") != "add" for result in results
        ):
            raise ThinkGraphIntakeError("thinkgraph_think_batch_store_failed")
        memories = []
        for result in results:
            memory = store.get_memory(str(result.get("id") or ""))
            if memory is None:
                raise ThinkGraphIntakeError("thinkgraph_think_batch_store_failed")
            memories.append(memory)

        relationships: list[dict[str, Any]] = []
        new_entities: dict[str, dict[str, Any]] = {}
        changed_node_ids: list[str] = []
        changed_edge_ids: list[str] = []
        attachments: list[dict[str, str]] = []
        for output, decisions, memory, result in zip(
            outputs, decisions_by_output, memories, results, strict=True
        ):
            for relationship, decision in zip(
                output["relationships"], decisions, strict=True
            ):
                written = apply_accepted_decision(
                    store,
                    workspace_id=workspace_id,
                    payload=completed,
                    memory_id=memory.id,
                    relationship=relationship,
                    decision=decision,
                )
                relationships.append({"id": written["edge_id"], **written})
                changed_node_ids.extend((written["source"], written["target"]))
                changed_edge_ids.append(written["edge_id"])
                changed_edge_ids.extend(written["replaced_edge_ids"])
                for entity in written["new_entities"]:
                    entity_id = str(entity["engraphisEntityId"])
                    new_entities[entity_id] = dict(entity)

            entity_id = str(result.get("entity_id") or "")
            if not entity_id:
                raise ThinkGraphIntakeError("thinkgraph_think_batch_store_failed")
            entity_created = entity_id not in existing_entity_ids
            attachments.append({
                "engraphisMemoryId": memory.id,
                "engraphisEntityId": entity_id,
            })
            changed_node_ids.append(entity_id)
            if entity_created:
                new_entities[entity_id] = {
                    "canonicalName": output["entity"],
                    "engraphisEntityId": entity_id,
                }
            if entity_id in new_entities:
                new_entities[entity_id].update({
                    "engraphisMemoryId": memory.id,
                    "thinkContext": {
                        "title": output["title"],
                        "summary": output["summary"],
                    },
                })

        # Native text_mention incidences are references, not primary Think
        # attachments or Entity-to-Entity edges. Resolve after this batch's
        # Entities exist, within the same transaction; never backfill old Thinks.
        for output, memory in zip(outputs, memories, strict=True):
            service.engine._link_memory_entities(
                memory.id,
                "\n\n".join(filter(None, (output["summary"], output.get("detail")))),
                workspace_id=workspace_id,
                repo_id=None,
                valid_from=memory.valid_from,
            )

        settled_graph.update({
            "attachments": attachments,
            "relationships": relationships,
            "newEntities": list(new_entities.values()),
            "changedNodeIds": list(dict.fromkeys(changed_node_ids)),
            "changedEdgeIds": list(dict.fromkeys(changed_edge_ids)),
        })

    try:
        saved_thinks = _save_think_batch(
            service,
            workspace_id=workspace_id,
            completed=completed,
            outputs=outputs,
            card_run=card_run,
            pair_reference_value=pair_reference_value,
            finalizer=finalize,
        )
    except ThinkGraphIntakeError:
        raise
    except Exception as error:
        raise ThinkGraphIntakeError("thinkgraph_think_batch_store_failed") from error

    operations = [str(result.get("op") or "") for result in saved_thinks]
    if operations and all(operation == "noop" for operation in operations):
        existing = existing_source_pair_thinks(
            store,
            workspace_id=workspace_id,
            pair_reference=pair_reference_value,
        )
        exact_entities = exact_think_entity_ids(
            store,
            workspace_id=workspace_id,
            memory_ids=[str(memory.id) for memory in existing],
        )
        return _existing_completed_pair_result(
            project=project,
            pair_reference_value=pair_reference_value,
            card_run=card_run,
            revision_before=revision_before,
            memories=existing,
            entity_ids=exact_entities,
        )
    if len(saved_thinks) != len(outputs) or any(operation != "add" for operation in operations):
        raise ThinkGraphIntakeError("thinkgraph_think_batch_store_failed")

    memory_ids = [str(result.get("id") or "") for result in saved_thinks]
    exact_entities = exact_think_entity_ids(
        store,
        workspace_id=workspace_id,
        memory_ids=memory_ids,
    )
    for memory_id in memory_ids:
        memory = store.get_memory(memory_id)
        if (
            memory is None
            or validated_think_metadata(memory) is None
            or memory_id not in exact_entities
        ):
            raise ThinkGraphIntakeError("thinkgraph_think_batch_store_failed")
    if settled_graph["attachments"] != [
        {
            "engraphisMemoryId": memory_id,
            "engraphisEntityId": exact_entities[memory_id],
        }
        for memory_id in memory_ids
    ]:
        raise ThinkGraphIntakeError("thinkgraph_think_batch_store_failed")

    relationship_vocabulary_after = project_relationship_vocabulary(
        store, workspace_id
    )
    revision = graph_revision(store, workspace_id)
    return {
        "ok": True,
        "projectId": project,
        "pairReference": pair_reference_value,
        "thinkMemoryIds": memory_ids,
        "thinks": [
            {
                **attachment,
                "body": output["summary"],
            }
            for attachment, output in zip(
                settled_graph["attachments"], outputs, strict=True
            )
        ],
        "intakeOperation": "add",
        "intakeOperations": operations,
        "revision": revision,
        "revisionChanged": revision != revision_before,
        "status": "completed",
        "cardRun": card_run,
        "relationships": settled_graph["relationships"],
        "newEntities": settled_graph["newEntities"],
        "relationshipVocabulary": relationship_vocabulary_state(
            relationship_vocabulary_after
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
    """Append at most one Think per Entity plus separately classified Jev edges."""

    completed, pair_reference_value, card_output, card_run = (
        _validate_settle_payload(payload)
    )
    project = completed["projectId"]
    service = get_service(project)
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
            exact_entities = exact_think_entity_ids(
                store,
                workspace_id=workspace_id,
                memory_ids=[str(memory.id) for memory in existing],
            )
            return _existing_completed_pair_result(
                project=project,
                pair_reference_value=pair_reference_value,
                card_run=card_run,
                revision_before=revision_before,
                memories=existing,
                entity_ids=exact_entities,
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
