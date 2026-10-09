"""Jev classification and durable annotation of actual Graphiti facts."""

from __future__ import annotations

import hashlib
import json
import math
import os
from datetime import datetime
from typing import Any

import httpx

import graphiti_runtime

KNOWGRAPH_JEV_MODEL = "typesafe/jev-1.13"
KNOWGRAPH_JEV_QUESTION_SCHEMA_VERSION = "knowgraph.relationship-choice.v3"
KNOWGRAPH_JEV_CONTROL_OUTCOMES = {"INSUFFICIENT_CONTEXT"}
MAX_JEV_FACTS_PER_INGEST = 64


def _sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def graphiti_value(edge: Any, name: str) -> Any:
    if isinstance(edge, dict):
        return edge.get(name)
    return getattr(edge, name, None)


def _json_safe(value: Any) -> Any:
    return json.loads(json.dumps(value, default=str))


def graphiti_fact_signature(fact: dict[str, Any]) -> str:
    semantic_identity = {
        "source": fact["sourceEntity"]["uuid"],
        "target": fact["targetEntity"]["uuid"],
        "graphiti_relation": fact["graphitiRelation"],
        "fact": fact["fact"],
    }
    return _sha256_hex(json.dumps(semantic_identity, sort_keys=True, separators=(",", ":")))


async def read_project_relationship_vocabulary(
    project_id: str,
) -> dict[str, Any]:
    base_url = os.getenv("PYTHON_RAILS_URL", "http://127.0.0.1:8003").strip().rstrip("/")
    if not base_url:
        raise RuntimeError("knowgraph_jev_python_rails_unavailable")
    async with httpx.AsyncClient(timeout=30.0, follow_redirects=False) as client:
        response = await client.post(
            f"{base_url}/graph/relationship-vocabulary/read",
            json={"projectId": project_id},
        )
        response.raise_for_status()
        payload = response.json()
    labels = payload.get("labels") if isinstance(payload, dict) else None
    if (
        not isinstance(labels, list)
        or not 20 <= len(labels) <= 255
        or any(not isinstance(label, str) or not label for label in labels)
    ):
        raise RuntimeError("knowgraph_relationship_vocabulary_invalid")
    return payload


def relationship_vocabulary_guidance(
    guidance: str | None,
    vocabulary: dict[str, Any],
) -> str:
    labels = [str(label) for label in vocabulary["labels"]]
    existing = str(guidance or "").strip()
    instruction = (
        "For each Graphiti relationship name, first prefer an exact predicate "
        "from CURRENT_SHARED_PROJECT_RELATIONSHIP_VOCABULARY when it accurately fits. "
        "If none fits, propose one concise UPPER_SNAKE_CASE predicate: prefer one word, "
        "use two only when necessary, and never exceed three words. Do not invent a "
        "synonym for an existing predicate. Keep the natural-language fact fully "
        "expressive and continue normal entity and factual relationship extraction.\n"
        "CURRENT_SHARED_PROJECT_RELATIONSHIP_VOCABULARY:\n"
        + json.dumps(labels, ensure_ascii=False, separators=(",", ":"))
    )
    return f"{existing}\n\n{instruction}" if existing else instruction


async def _call_knowgraph_jev(
    project_id: str,
    facts: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    base_url = os.getenv("PYTHON_RAILS_URL", "http://127.0.0.1:8003").strip().rstrip("/")
    if not base_url:
        raise RuntimeError("knowgraph_jev_python_rails_unavailable")
    async with httpx.AsyncClient(timeout=180.0, follow_redirects=False) as client:
        response = await client.post(
            f"{base_url}/knowgraph/jev/classify",
            json={"projectId": project_id, "facts": facts},
        )
        response.raise_for_status()
        payload = response.json()
    results = payload.get("results") if isinstance(payload, dict) else None
    if not isinstance(results, list) or len(results) != len(facts):
        raise RuntimeError("knowgraph_jev_response_invalid")
    if any(not isinstance(item, dict) for item in results):
        raise RuntimeError("knowgraph_jev_response_invalid")
    requested_ids = [str(fact.get("graphitiFactUuid") or "") for fact in facts]
    returned_ids = [str(item.get("graphitiFactUuid") or "") for item in results]
    if returned_ids != requested_ids or len(set(returned_ids)) != len(returned_ids):
        raise RuntimeError("knowgraph_jev_response_invalid")
    return results


async def _existing_jev_metadata(
    graphiti: Any,
    fact_ids: list[str],
) -> dict[str, dict[str, Any]]:
    if not fact_ids:
        return {}
    result = await graphiti.driver.execute_query(
        """
        MATCH ()-[fact]->()
        WHERE toString(fact.uuid) IN $fact_ids
        RETURN toString(fact.uuid) AS uuid,
               fact.jev_graphiti_signature AS graphiti_signature,
               fact.jev_relation_winner AS winner,
               fact.jev_relation_distribution_json AS distribution_json,
               fact.jev_label_confidence AS label_confidence,
               fact.jev_provider_confidence AS provider_confidence,
               fact.jev_requested_model AS requested_model,
               fact.jev_resolved_model AS resolved_model,
               fact.jev_question_schema_version AS question_schema_version,
               fact.jev_ontology_version AS ontology_version,
               fact.jev_ontology_hash AS ontology_hash,
               fact.jev_vocabulary_count AS vocabulary_count,
               fact.jev_choice_options_json AS choice_options_json
        """,
        fact_ids=fact_ids,
        routing_="r",
    )
    return {
        str(record.get("uuid") or ""): dict(record)
        for record in graphiti_runtime.graphiti_records(result)
        if str(record.get("uuid") or "")
    }


def _rounded_distribution(
    value: Any,
    choices: list[str],
) -> dict[str, float]:
    if not isinstance(value, dict) or set(value) != set(choices):
        raise ValueError("knowgraph_jev_distribution_invalid")
    distribution: dict[str, float] = {}
    for choice in choices:
        raw = value[choice]
        if isinstance(raw, bool):
            raise ValueError("knowgraph_jev_distribution_invalid")
        probability = float(raw)
        if not math.isfinite(probability) or not 0.0 <= probability <= 1.0:
            raise ValueError("knowgraph_jev_distribution_invalid")
        distribution[choice] = probability
    if not distribution or all(value == 0.0 for value in distribution.values()):
        raise ValueError("knowgraph_jev_distribution_invalid")
    lower = sum(max(0.0, value - 0.005) for value in distribution.values())
    upper = sum(min(1.0, value + 0.005) for value in distribution.values())
    if lower > 1.0 + 1e-12 or upper < 1.0 - 1e-12:
        raise ValueError("knowgraph_jev_distribution_invalid")
    return distribution


def _validated_decision_metadata(decision: dict[str, Any]) -> dict[str, Any]:
    winner = str(decision.get("winner") or "").strip()
    choices = decision.get("choice_options")
    if (
        not winner
        or winner in KNOWGRAPH_JEV_CONTROL_OUTCOMES
        or not isinstance(choices, list)
        or not choices
        or any(not isinstance(choice, str) or not choice for choice in choices)
        or len(set(choices)) != len(choices)
    ):
        raise ValueError("knowgraph_jev_decision_invalid")
    distribution = _rounded_distribution(decision.get("distribution"), choices)
    if winner not in distribution:
        raise ValueError("knowgraph_jev_decision_invalid")
    winner_upper = min(1.0, distribution[winner] + 0.005)
    if any(
        max(0.0, probability - 0.005) > winner_upper + 1e-12
        for choice, probability in distribution.items()
        if choice != winner
    ):
        raise ValueError("knowgraph_jev_decision_invalid")
    provider_confidence = decision.get("provider_confidence")
    if isinstance(provider_confidence, bool):
        raise ValueError("knowgraph_jev_provider_confidence_invalid")
    provider_confidence = float(provider_confidence)
    if not math.isfinite(provider_confidence) or not 0.0 <= provider_confidence <= 1.0:
        raise ValueError("knowgraph_jev_provider_confidence_invalid")
    label_confidence = decision.get("label_confidence")
    if isinstance(label_confidence, bool):
        raise ValueError("knowgraph_jev_label_confidence_invalid")
    label_confidence = float(label_confidence)
    if (
        not math.isfinite(label_confidence)
        or label_confidence != distribution[winner]
    ):
        raise ValueError("knowgraph_jev_label_confidence_invalid")
    return {
        "winner": winner,
        "distribution": distribution,
        "provider_confidence": provider_confidence,
        "label_confidence": label_confidence,
        "choice_options": choices,
    }


def _jev_annotation_is_current(
    metadata: dict[str, Any],
    *,
    graphiti_signature: str,
    vocabulary: dict[str, Any],
) -> bool:
    try:
        serialized = metadata.get("distribution_json")
        distribution = (
            json.loads(serialized) if isinstance(serialized, str) else dict(serialized)
        )
        serialized_choices = metadata.get("choice_options_json")
        choices = (
            json.loads(serialized_choices)
            if isinstance(serialized_choices, str)
            else list(serialized_choices)
        )
        validated = _validated_decision_metadata({
            "winner": metadata.get("winner"),
            "distribution": distribution,
            "provider_confidence": metadata.get("provider_confidence"),
            "label_confidence": metadata.get("label_confidence"),
            "choice_options": choices,
        })
        current_choices = set(str(label) for label in vocabulary["labels"])
        current_choices.update(KNOWGRAPH_JEV_CONTROL_OUTCOMES)
        stored_choices = set(validated["choice_options"])
        extra_choices = stored_choices - current_choices
        return (
            metadata.get("graphiti_signature") == graphiti_signature
            and metadata.get("question_schema_version")
            == KNOWGRAPH_JEV_QUESTION_SCHEMA_VERSION
            and metadata.get("requested_model") == KNOWGRAPH_JEV_MODEL
            and bool(str(metadata.get("resolved_model") or "").strip())
            and metadata.get("ontology_version") == vocabulary.get("version")
            and metadata.get("ontology_hash") == vocabulary.get("hash")
            and int(metadata.get("vocabulary_count")) == int(vocabulary.get("count"))
            and current_choices.issubset(stored_choices)
            and len(extra_choices) <= 1
        )
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        return False


async def _persist_jev_metadata(
    graphiti: Any,
    graphiti_fact_uuid: str,
    graphiti_signature: str,
    decision: dict[str, Any],
) -> dict[str, Any]:
    validated = _validated_decision_metadata(decision)
    winner = validated["winner"]
    distribution = validated["distribution"]
    result = await graphiti.driver.execute_query(
        """
        MATCH ()-[fact]->()
        WHERE toString(fact.uuid) = $graphiti_fact_uuid
        SET fact.jev_relation_winner = $winner,
              fact.jev_relation_distribution_json = $distribution_json,
              fact.jev_label_confidence = $label_confidence,
              fact.jev_provider_confidence = $provider_confidence,
            fact.jev_requested_model = $requested_model,
            fact.jev_resolved_model = $resolved_model,
            fact.jev_evaluated_at = $evaluated_at,
            fact.jev_question_schema_version = $question_schema_version,
            fact.jev_ontology_version = $ontology_version,
            fact.jev_ontology_hash = $ontology_hash,
            fact.jev_vocabulary_count = $vocabulary_count,
            fact.jev_relationship_candidate = $relationship_candidate,
            fact.jev_relationship_proposal_status = $relationship_proposal_status,
            fact.jev_vocabulary_promotion = $vocabulary_promotion,
            fact.jev_vocabulary_after_hash = $vocabulary_after_hash,
              fact.jev_vocabulary_after_count = $vocabulary_after_count,
              fact.jev_choice_options_json = $choice_options_json,
              fact.jev_graphiti_signature = $graphiti_signature
        RETURN toString(fact.uuid) AS uuid,
               fact.jev_graphiti_signature AS graphiti_signature,
               fact.jev_relation_winner AS winner,
               fact.jev_relation_distribution_json AS distribution_json,
               fact.jev_label_confidence AS label_confidence,
               fact.jev_provider_confidence AS provider_confidence,
               fact.jev_requested_model AS requested_model,
               fact.jev_resolved_model AS resolved_model,
               fact.jev_question_schema_version AS question_schema_version,
               fact.jev_ontology_version AS ontology_version,
               fact.jev_ontology_hash AS ontology_hash,
               fact.jev_vocabulary_count AS vocabulary_count,
               fact.jev_choice_options_json AS choice_options_json
        """,
        graphiti_fact_uuid=graphiti_fact_uuid,
        winner=winner,
        distribution_json=json.dumps(distribution, sort_keys=True, separators=(",", ":")),
        label_confidence=validated["label_confidence"],
        provider_confidence=validated["provider_confidence"],
        requested_model=str(decision.get("requested_model") or ""),
        resolved_model=str(decision.get("resolved_model") or ""),
        evaluated_at=str(decision.get("evaluated_at") or ""),
        question_schema_version=str(decision.get("question_schema_version") or ""),
        ontology_version=str(decision.get("vocabulary_version") or ""),
        ontology_hash=str(
            decision.get("vocabulary_after_hash")
            or decision.get("vocabulary_hash")
            or ""
        ),
        vocabulary_count=int(
            decision.get("vocabulary_after_count")
            or decision.get("vocabulary_count")
            or 0
        ),
        relationship_candidate=str(
            decision.get("novel_relationship_candidate") or ""
        ),
        relationship_proposal_status=str(
            decision.get("relationship_proposal_status") or ""
        ),
        vocabulary_promotion=str(decision.get("vocabulary_promotion") or ""),
        vocabulary_after_hash=str(decision.get("vocabulary_after_hash") or ""),
        vocabulary_after_count=int(
            decision.get("vocabulary_after_count")
            or decision.get("vocabulary_count")
            or 0
        ),
        choice_options_json=json.dumps(
            validated["choice_options"], separators=(",", ":")
        ),
        graphiti_signature=graphiti_signature,
    )
    records = graphiti_runtime.graphiti_records(result)
    if len(records) != 1 or str(records[0].get("uuid") or "") != graphiti_fact_uuid:
        raise RuntimeError("knowgraph_jev_persist_readback_missing")
    return dict(records[0])


async def _classify_and_persist_jev_facts(
    graphiti: Any,
    *,
    project_id: str,
    facts: list[dict[str, Any]],
    relationship_vocabulary: dict[str, Any],
) -> dict[str, Any]:
    """Idempotently repair bounded Jev annotations on existing Graphiti facts."""
    deduplicated: list[dict[str, Any]] = []
    seen: set[str] = set()
    for fact in facts:
        graphiti_fact_id = str(fact.get("graphitiFactUuid") or "").strip()
        if not graphiti_fact_id or graphiti_fact_id in seen:
            continue
        seen.add(graphiti_fact_id)
        deduplicated.append(fact)

    existing = await _existing_jev_metadata(
        graphiti,
        [str(fact["graphitiFactUuid"]) for fact in deduplicated],
    )
    changed: list[dict[str, Any]] = []
    skipped: list[str] = []
    for fact in deduplicated:
        graphiti_fact_id = str(fact["graphitiFactUuid"])
        signature = graphiti_fact_signature(fact)
        fact["_graphitiSignature"] = signature
        if _jev_annotation_is_current(
            existing.get(graphiti_fact_id) or {},
            graphiti_signature=signature,
            vocabulary=relationship_vocabulary,
        ):
            skipped.append(graphiti_fact_id)
        else:
            changed.append(fact)

    admitted = changed[:MAX_JEV_FACTS_PER_INGEST]
    unfinished = [
        str(fact["graphitiFactUuid"])
        for fact in changed[MAX_JEV_FACTS_PER_INGEST:]
    ]
    decisions: list[dict[str, Any]] = []
    call_failure_reason = ""
    if admitted:
        try:
            decisions = await _call_knowgraph_jev(project_id, [
                {
                    key: value
                    for key, value in fact.items()
                    if key != "_graphitiSignature"
                }
                for fact in admitted
            ])
        except Exception as error:
            call_failure_reason = str(error).strip() or type(error).__name__

    by_id = {
        str(decision.get("graphitiFactUuid") or ""): decision
        for decision in decisions
    }
    attempted: list[str] = []
    succeeded: list[str] = []
    failed: list[str] = []
    failure_reasons: dict[str, str] = {}
    for fact in admitted:
        graphiti_fact_id = str(fact["graphitiFactUuid"])
        attempted.append(graphiti_fact_id)
        if call_failure_reason:
            failed.append(graphiti_fact_id)
            failure_reasons[graphiti_fact_id] = call_failure_reason
            continue
        decision = by_id.get(graphiti_fact_id) or {}
        if decision.get("status") == "unfinished":
            unfinished.append(graphiti_fact_id)
            failure_reasons[graphiti_fact_id] = str(
                decision.get("failure_reason")
                or "knowgraph_jev_deadline_exceeded"
            )
            continue
        if decision.get("status") != "success":
            failed.append(graphiti_fact_id)
            failure_reasons[graphiti_fact_id] = str(
                decision.get("failure_reason")
                or "knowgraph_jev_result_invalid"
            )
            continue
        try:
            persisted = await _persist_jev_metadata(
                graphiti,
                graphiti_fact_id,
                str(fact["_graphitiSignature"]),
                decision,
            )
            if not _jev_annotation_is_current(
                persisted,
                graphiti_signature=str(fact["_graphitiSignature"]),
                vocabulary=relationship_vocabulary,
            ):
                raise RuntimeError("knowgraph_jev_persist_readback_invalid")
        except Exception as error:
            failed.append(graphiti_fact_id)
            failure_reasons[graphiti_fact_id] = (
                str(error).strip() or type(error).__name__
            )
            continue
        succeeded.append(graphiti_fact_id)

    still_unsettled = list(dict.fromkeys([*failed, *unfinished]))
    if still_unsettled:
        status = "partial" if succeeded or skipped else "unavailable"
    else:
        status = "success" if succeeded else "current"
    return {
        "status": status,
        "touched_fact_count": len(deduplicated),
        "classified_fact_count": len(succeeded),
        "reused_fact_count": len(skipped),
        "attempted_fact_uuids": attempted,
        "succeeded_fact_uuids": succeeded,
        "failed_fact_uuids": failed,
        "skipped_fact_uuids": skipped,
        "unfinished_fact_uuids": unfinished,
        "still_unsettled_fact_uuids": still_unsettled,
        **({"failure_reasons": failure_reasons} if failure_reasons else {}),
    }


async def classify_episode_facts_with_jev(
    graphiti: Any,
    *,
    project_id: str,
    edges: list[Any],
    nodes: list[Any],
    episode_id: str,
    source_name: str,
    source_reference: str,
    text: str,
    reference_time: datetime,
    relationship_vocabulary: dict[str, Any],
) -> dict[str, Any]:
    """Classify only new or materially changed facts returned by this episode."""
    names = {
        str(graphiti_value(node, "uuid") or ""): str(graphiti_value(node, "name") or "")
        for node in nodes
        if str(graphiti_value(node, "uuid") or "")
    }
    facts: list[dict[str, Any]] = []
    for edge in edges:
        graphiti_fact_id = str(graphiti_value(edge, "uuid") or "").strip()
        source_id = str(graphiti_value(edge, "source_node_uuid") or "").strip()
        target_id = str(graphiti_value(edge, "target_node_uuid") or "").strip()
        statement = str(graphiti_value(edge, "fact") or "").strip()
        if (
            not graphiti_fact_id or not source_id or not target_id or not statement
            or graphiti_value(edge, "invalid_at") is not None
            or graphiti_value(edge, "expired_at") is not None
        ):
            continue
        facts.append({
            "graphitiFactUuid": graphiti_fact_id,
            "sourceEntity": {"uuid": source_id, "name": names.get(source_id, "")},
            "targetEntity": {"uuid": target_id, "name": names.get(target_id, "")},
            "graphitiRelation": str(graphiti_value(edge, "name") or ""),
            "fact": statement,
            "supportingEpisodeUuids": [
                str(value) for value in (graphiti_value(edge, "episodes") or []) if str(value)
            ],
            "supportingEpisodes": [{
                "uuid": episode_id,
                "name": source_name,
                "source_name": source_name,
                "source_reference": source_reference,
                "source_path": source_reference,
                "source_type": "pdf_upload",
                "reference_time": reference_time.isoformat(),
                "content": text,
            }],
            "createdAt": _json_safe(graphiti_value(edge, "created_at")),
            "referenceTime": reference_time.isoformat(),
            "validAt": _json_safe(graphiti_value(edge, "valid_at")),
            "invalidAt": _json_safe(graphiti_value(edge, "invalid_at")),
            "expiredAt": _json_safe(graphiti_value(edge, "expired_at")),
        })

    for fact in facts:
        endpoints = {
            str(fact["sourceEntity"]["uuid"]), str(fact["targetEntity"]["uuid"]),
        }
        fact["nearbyFacts"] = [{
            key: other[key]
            for key in (
                "graphitiFactUuid", "sourceEntity", "targetEntity", "graphitiRelation", "fact",
            )
        } for other in facts if other is not fact and (
            str(other["sourceEntity"]["uuid"]) in endpoints
            or str(other["targetEntity"]["uuid"]) in endpoints
        )][:8]

    return await _classify_and_persist_jev_facts(
        graphiti,
        project_id=project_id,
        facts=facts,
        relationship_vocabulary=relationship_vocabulary,
    )
