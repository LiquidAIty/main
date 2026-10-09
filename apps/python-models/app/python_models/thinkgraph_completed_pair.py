"""Saved ThinkGraph Card extraction and completed User/Main pair settlement."""
from __future__ import annotations

from copy import deepcopy
import json
from typing import Any, Callable, Literal

from engraphis.core.interfaces import MemoryType, Scope
from pydantic import BaseModel, ConfigDict, Field, model_validator

from .engraphis import (
    THINK_INCIDENCE_KIND,
    existing_entity_for_name,
    graph_revision,
    THINKGRAPH_INTAKE_LOCK,
    validated_think_metadata,
    get_service,
    project_id,
)
from .thinkgraph_relationships import (
    ThinkGraphIntakeError,
    apply_accepted_decision,
    classify_relationships,
    project_relationship_vocabulary,
    relationship_vocabulary_state,
    source_pair,
    text_hash,
    classify_relationship,
)


def _subject_directory_for_project(project: str) -> dict[str, Any]:
    from app.python_models.canonical_subject_directory import (
        build_canonical_subject_directory,
    )

    return build_canonical_subject_directory(project)


def _strict_card_json(value: Any) -> Any:
    if isinstance(value, str):
        raw = value.strip()
        if raw.startswith("```json") and raw.endswith("```"):
            raw = raw[7:-3].strip()
        try:
            return json.loads(raw)
        except (TypeError, ValueError) as error:
            raise ThinkGraphIntakeError(
                "thinkgraph_card_output_invalid_json"
            ) from error
    return value


class _StructuredModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        str_strip_whitespace=True,
        use_enum_values=True,
    )


class ThinkGraphThink(_StructuredModel):
    summary: str = Field(min_length=1, max_length=100_000)


class ThinkGraphStructuredRelation(_StructuredModel):
    source: str = Field(min_length=1, max_length=256)
    relation: str = Field(
        min_length=1,
        max_length=512,
        description=(
            "A concise free-form directed relationship grounded in the completed pair. "
            "Do not choose a canonical ThinkGraph edge predicate; Jev classifies it later."
        ),
    )
    target: str = Field(min_length=1, max_length=256)


class ThinkGraphStructuredFact(_StructuredModel):
    """The one saved-Card Think accepted by the Engraphis structured extractor."""

    content: str = Field(min_length=1, max_length=100_000)
    title: str = Field(min_length=1, max_length=256)
    mtype: Literal["episodic"] = "episodic"
    importance: float = Field(default=0.0, ge=0.0, le=1.0)
    keywords: list[str] = Field(default_factory=list, max_length=16)
    entities: list[str] = Field(min_length=2, max_length=20)
    relations: list[ThinkGraphStructuredRelation] = Field(
        min_length=1,
        max_length=10,
    )
    think: ThinkGraphThink

    @model_validator(mode="after")
    def validate_think(self) -> "ThinkGraphStructuredFact":
        if self.content != self.think.summary:
            raise ValueError("thinkgraph_card_content_summary_mismatch")
        entity_keys = [value.casefold() for value in self.entities]
        if len(entity_keys) != len(set(entity_keys)):
            raise ValueError("thinkgraph_card_entity_duplicate")
        endpoint_keys: list[str] = []
        relationship_keys: set[tuple[str, str, str]] = set()
        for relationship in self.relations:
            source_key = relationship.source.casefold()
            target_key = relationship.target.casefold()
            if source_key == target_key:
                raise ValueError("thinkgraph_card_pair_self_reference")
            identity = (
                source_key,
                relationship.relation.casefold(),
                target_key,
            )
            if identity in relationship_keys:
                raise ValueError("thinkgraph_card_pair_duplicate")
            relationship_keys.add(identity)
            endpoint_keys.extend((source_key, target_key))
        if set(entity_keys) != set(endpoint_keys):
            raise ValueError(
                "thinkgraph_card_entities_must_be_relationship_endpoints"
            )
        return self


class _SavedCardStructuredResult:
    """LLM protocol bridge: the saved Card already performed the model call."""

    def __init__(self, value: Any, provider: str, model: str) -> None:
        self.value = value
        self.provider = provider
        self.model = model

    def extract_json(self, _prompt: str, _schema: dict[str, Any]) -> Any:
        return self.value


def _engraphis_structured_extractor(llm: Any) -> Any:
    from engraphis.backends.extractor import StructuredLLMExtractor

    extractor_type = StructuredLLMExtractor.with_schema(
        ThinkGraphStructuredFact
    )
    return extractor_type(llm, max_facts=1)


def llm_structured_contract(
    pair_text: str,
    context: dict[str, Any],
) -> tuple[dict[str, Any], str]:
    extractor = _engraphis_structured_extractor(
        _SavedCardStructuredResult({}, "schema-only", "schema-only")
    )
    context_text = json.dumps(context, ensure_ascii=False, sort_keys=True)
    prompt = extractor._build_prompt(pair_text, context_text)
    prompt += (
        "\nTHINKGRAPH TEMPORAL THINK:\n"
        "Return exactly one object in the facts array with mtype='episodic' and "
        "one `think` object. Store the same complete combined meaning in `content` "
        "and `think.summary`. Preserve material decisions, questions, preferences, "
        "corrections, assumptions, and uncertainty in that one self-contained summary. "
        "Extract canonical concept names and only meaningful directed relationships "
        "grounded in this completed pair. Every entity must be a source or target, and "
        "every source and target must be present in entities. Each relation object has "
        "exactly source, relation, and target. The relation is concise free-form semantic "
        "language from the pair, not a normalized edge label. Do not choose or emit a "
        "canonical ThinkGraph predicate: Jev alone performs that later classification. "
        "Do not browse, research, infer from the subject directory, read prior Think "
        "bodies, split the pair into multiple memories, or add generic wrapper concepts.\n"
    )
    return extractor._output_schema(), prompt


def extract_saved_card_facts(
    value: Any,
    *,
    pair_text: str,
    context: dict[str, Any],
    card_run: dict[str, str],
) -> list[Any]:
    strict_value = _strict_card_json(value)
    if (
        not isinstance(strict_value, dict)
        or set(strict_value) != {"facts"}
        or not isinstance(strict_value.get("facts"), list)
        or len(strict_value["facts"]) != 1
    ):
        raise ThinkGraphIntakeError("thinkgraph_card_single_think_required")
    extractor = _engraphis_structured_extractor(
        _SavedCardStructuredResult(
            strict_value,
            card_run["resolvedProvider"],
            card_run["resolvedModel"],
        )
    )
    facts = extractor.extract(
        pair_text,
        context=json.dumps(context, ensure_ascii=False, sort_keys=True),
    )
    if len(facts) != 1 or any(
        isinstance(fact.metadata, dict)
        and fact.metadata.get("extraction_fallback")
        for fact in facts
    ):
        raise ThinkGraphIntakeError("thinkgraph_card_llm_structured_invalid")
    return facts


def project_saved_card_think(facts: list[Any]) -> dict[str, Any]:
    """Mechanically project the one validated Engraphis structured fact."""
    if len(facts) != 1:
        raise ThinkGraphIntakeError("thinkgraph_card_single_think_required")
    fact = facts[0]
    if fact.mtype != MemoryType.EPISODIC:
        raise ThinkGraphIntakeError("thinkgraph_card_single_think_required")
    metadata = fact.metadata if isinstance(fact.metadata, dict) else {}
    structured = metadata.get("structured_extraction")
    if not isinstance(structured, dict):
        raise ThinkGraphIntakeError("thinkgraph_card_think_payload_invalid")
    raw_think = structured.get("think")
    entities = structured.get("entities")
    relationships = structured.get("relations")
    if (
        not isinstance(raw_think, dict)
        or raw_think.get("summary") != fact.content
        or not isinstance(entities, list)
        or not isinstance(relationships, list)
    ):
        raise ThinkGraphIntakeError("thinkgraph_card_think_payload_invalid")
    return {
        "summary": str(fact.content),
        "title": str(fact.title or ""),
        "importance": float(fact.importance),
        "keywords": list(fact.keywords),
        "entities": deepcopy(entities),
        "relationships": deepcopy(relationships),
    }


def pair_reference(payload: dict[str, Any]) -> str:
    encoded = json.dumps(
        source_pair(payload), ensure_ascii=False, sort_keys=True,
        separators=(",", ":"),
    )
    return f"pair_{text_hash(encoded)}"


def _existing_source_pair_thinks(
    store: Any,
    *,
    workspace_id: str,
    pair_reference: str,
) -> list[Any]:
    rows = store.conn.execute(
        "SELECT id FROM memories WHERE workspace_id=? "
        "AND valid_to IS NULL AND expired_at IS NULL "
        "ORDER BY COALESCE(ingested_at,0) DESC, id DESC",
        (workspace_id,),
    ).fetchall()
    matches: list[tuple[int, Any]] = []
    for row in rows:
        memory = store.get_memory(str(row["id"]))
        think = validated_think_metadata(memory) if memory is not None else None
        metadata = memory.metadata if memory is not None else {}
        origin = (
            metadata.get("thinkgraph_origin")
            if isinstance(metadata, dict) else None
        )
        if (
            think is not None
            and isinstance(origin, dict)
            and origin.get("completed_pair_reference") == pair_reference
        ):
            raw_index = origin.get("fact_index")
            fact_index = raw_index if isinstance(raw_index, int) and raw_index >= 0 else 1_000_000
            matches.append((fact_index, memory))
    return [memory for _index, memory in sorted(
        matches,
        key=lambda item: (item[0], str(item[1].id)),
    )]


def _save_think_memory(
    service: Any,
    *,
    workspace_id: str,
    completed: dict[str, Any],
    output: dict[str, Any],
    card_run: dict[str, str],
    pair_reference: str,
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
            "completed_pair_reference": pair_reference,
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
        matches = _existing_source_pair_thinks(
            service.store,
            workspace_id=workspace_id,
            pair_reference=pair_reference,
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
        subject_key=f"thinkgraph:{pair_reference}",
        claim_kind="think",
        _trusted_graph_keys=frozenset({"structured_extraction"}),
        _transactional_validator=existing,
        _transactional_finalizer=finalizer,
    )


def _validate_completed_pair_payload(payload: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("thinkgraph_completed_pair_payload_invalid")
    allowed = {
        "projectId", "deckId", "conversationId", "runId", "cardId",
        "hermesSessionId", "completedAt", "userMessage", "mainResponse",
    }
    if set(payload) - allowed:
        raise ValueError("thinkgraph_completed_pair_payload_invalid")
    cleaned = dict(payload)
    for key in allowed:
        if key in cleaned and not isinstance(cleaned[key], str):
            raise ValueError("thinkgraph_completed_pair_payload_invalid")
    cleaned["projectId"] = project_id(str(cleaned.get("projectId") or ""))
    cleaned["userMessage"] = str(cleaned.get("userMessage") or "")
    cleaned["mainResponse"] = str(cleaned.get("mainResponse") or "")
    if not cleaned["userMessage"].strip() or not cleaned["mainResponse"].strip():
        raise ValueError("thinkgraph_completed_pair_text_required")
    return cleaned


def prepare_completed_pair(payload: dict[str, Any]) -> dict[str, Any]:
    """Prepare one saved-Card extraction without pre-writing a second Memory."""
    payload = _validate_completed_pair_payload(payload)
    project = payload["projectId"]
    pair_text = f"USER:\n{payload['userMessage']}\n\nMAIN:\n{payload['mainResponse']}"
    service = get_service()
    with THINKGRAPH_INTAKE_LOCK:
        workspace_id = service.store.get_or_create_workspace(project)
        revision_before = graph_revision(service.store, workspace_id)
        pair_reference_value = pair_reference(payload)
        existing = _existing_source_pair_thinks(
            service.store,
            workspace_id=workspace_id,
            pair_reference=pair_reference_value,
        )
        if existing:
            return {
                "ok": True,
                "projectId": project,
                "thinkMemoryIds": [memory.id for memory in existing],
                "pairReference": pair_reference_value,
                "intakeOperation": "noop",
                "structuredExtractionRequired": False,
                "revision": revision_before,
                "revisionChanged": False,
                "preparation": {
                    "status": "duplicate_noop",
                },
            }
        subject_directory = _subject_directory_for_project(project)
        enrichment_input = {
            "exact_user_message": payload["userMessage"],
            "exact_main_response": payload["mainResponse"],
            "canonical_subject_directory": subject_directory,
        }
        enrichment_schema, enrichment_prompt = llm_structured_contract(
            pair_text,
            enrichment_input,
        )
        return {
            "ok": True,
            "projectId": project,
            "pairReference": pair_reference_value,
            "intakeOperation": "pending",
            "structuredExtractionRequired": True,
            "revision": revision_before,
            "revisionChanged": False,
            "preparation": {"status": "completed_without_graph_mutation"},
            "enrichmentMode": "llm_structured",
            "enrichmentSchema": enrichment_schema,
            "enrichmentPrompt": enrichment_prompt,
            "enrichmentInput": enrichment_input,
            "canonicalSubjectDirectory": subject_directory,
        }


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
    completed = _validate_completed_pair_payload({
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
    *, project: str, pair_reference: str, card_run: dict[str, str],
    revision_before: str, memory_id: str,
) -> dict[str, Any]:
    return {
        "ok": True, "projectId": project, "pairReference": pair_reference,
        "thinkMemoryId": memory_id, "thinkMemoryIds": [memory_id],
        "intakeOperation": "noop", "intakeOperations": ["noop"],
        "revision": revision_before, "revisionChanged": False,
        "status": "completed", "cardRun": card_run, "relationships": [],
        "newSubjects": [], "changedNodeIds": [], "changedEdgeIds": [],
        "affectedNodeIds": [],
    }


def _settle_new_completed_pair(
    *, service: Any, store: Any, workspace_id: str, revision_before: str,
    completed: dict[str, Any], pair_reference: str, card_output: Any,
    card_run: dict[str, str], classifier: Callable[..., dict[str, Any]],
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
            pair_reference=pair_reference,
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
        "pairReference": pair_reference,
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
    completed, pair_reference, card_output, card_run = _validate_settle_payload(payload)
    project = completed["projectId"]
    service = get_service()
    with THINKGRAPH_INTAKE_LOCK:
        store = service.store
        workspace_id = store.get_or_create_workspace(project)
        revision_before = graph_revision(store, workspace_id)
        existing = _existing_source_pair_thinks(
            store,
            workspace_id=workspace_id,
            pair_reference=pair_reference,
        )
        if existing:
            return _existing_completed_pair_result(
                project=project, pair_reference=pair_reference,
                card_run=card_run, revision_before=revision_before,
                memory_id=str(existing[0].id),
            )
        return _settle_new_completed_pair(
            service=service, store=store, workspace_id=workspace_id,
            revision_before=revision_before, completed=completed,
            pair_reference=pair_reference, card_output=card_output,
            card_run=card_run, classifier=classifier,
        )
