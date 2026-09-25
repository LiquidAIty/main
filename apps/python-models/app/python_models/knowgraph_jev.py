"""Write-lifecycle Jev classification for native, source-grounded Graphiti facts.

Graphiti remains the fact, entity, provenance, and temporal authority.  This
module returns one bounded canonical relationship Choice for each fact touched
by the active Graphiti ingest. The ingest owner persists successful metadata on
that same relationship; this module never admits, rejects, or rewrites facts.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import json
import os
from typing import Any, Callable

import httpx

from .jev_edge_ontology import (
    SHARED_JEV_RELATIONSHIPS,
    SHARED_JEV_RELATIONSHIP_CRITERIA,
)
from .engraphis import (
    PROJECT_RELATIONSHIP_VOCABULARY_MAXIMUM,
    PROJECT_RELATIONSHIP_VOCABULARY_VERSION,
    relationship_choice_plan,
    relationship_vocabulary_hash,
)
from .jev_validation import (
    validate_rounded_choice_winner,
    validate_rounded_probability_distribution,
)


JEV_MODEL = "typesafe/jev-1.13"
JEV_ENDPOINT = "https://openrouter.ai/api/alpha/decisions"
MAX_JEV_CONCURRENCY = 4
MAX_FACTS_PER_BATCH = 64

KNOWGRAPH_CONTROL_OUTCOMES = ("INSUFFICIENT_CONTEXT",)
KNOWGRAPH_JEV_CHOICES = SHARED_JEV_RELATIONSHIPS + KNOWGRAPH_CONTROL_OUTCOMES

_KNOWGRAPH_RELATIONSHIP_CRITERIA = {
    **SHARED_JEV_RELATIONSHIP_CRITERIA,
    "INSUFFICIENT_CONTEXT": "The supplied native fact and source context do not support a canonical choice.",
}


class KnowGraphJevError(RuntimeError):
    """A real KnowGraph Jev Choice could not be obtained or validated."""


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _bounded_text(value: Any, limit: int) -> str:
    text = str(value or "").strip()
    if len(text) > limit:
        raise KnowGraphJevError("knowgraph_jev_input_limit")
    return text


def _entity(value: Any) -> dict[str, str]:
    item = value if isinstance(value, dict) else {}
    return {
        "uuid": _bounded_text(item.get("uuid"), 512),
        "name": _bounded_text(item.get("name"), 512),
    }


def _episode_context(value: Any) -> list[dict[str, Any]]:
    episodes = value if isinstance(value, list) else []
    if len(episodes) > 8:
        raise KnowGraphJevError("knowgraph_jev_episode_context_limit")
    bounded: list[dict[str, Any]] = []
    for raw in episodes:
        item = raw if isinstance(raw, dict) else {}
        content = item.get("content_preview", item.get("content", item.get("snippet", "")))
        bounded.append({
            key: item.get(key)
            for key in (
                "uuid", "name", "source", "source_name", "source_description",
                "source_url", "source_type", "document_id", "created_at", "valid_at",
                "reference_time", "fetched_at",
            )
            if item.get(key) is not None
        } | {"content": _bounded_text(content, 4_000)})
    return bounded


def _nearby_context(value: Any) -> list[dict[str, Any]]:
    facts = value if isinstance(value, list) else []
    if len(facts) > 8:
        raise KnowGraphJevError("knowgraph_jev_nearby_context_limit")
    return [{
        "native_fact_uuid": _bounded_text(item.get("nativeFactUuid"), 512),
        "source": _entity(item.get("sourceEntity")),
        "target": _entity(item.get("targetEntity")),
        "native_relation": _bounded_text(item.get("nativeRelation"), 1_000),
        "fact": _bounded_text(item.get("fact"), 2_000),
    } for item in facts if isinstance(item, dict)]


def _failure_status(error: Exception) -> str:
    message = str(error)
    if "timeout" in message:
        return "timeout"
    if "limit" in message:
        return "unavailable"
    if "response_invalid" in message or "input_invalid" in message:
        return "invalid"
    if "unavailable" in message or "key_unavailable" in message:
        return "unavailable"
    return "error"


def _validate_jev_response(
    response: dict[str, Any],
    *,
    choices: tuple[str, ...] = KNOWGRAPH_JEV_CHOICES,
    relationship_vocabulary: tuple[str, ...] = SHARED_JEV_RELATIONSHIPS,
    choice_plan: dict[str, Any] | None = None,
) -> dict[str, Any]:
    try:
        answer = response["answers"]["relationship"]
        if answer.get("type") != "choice":
            raise ValueError("answer type")
        winner = str(answer["choice"])
        if winner not in choices:
            raise ValueError("winner")
        raw = answer["probabilities"]
        if not isinstance(raw, dict) or set(raw) != set(choices):
            raise ValueError("probability keys")
        probabilities = validate_rounded_probability_distribution(raw, choices)
        validate_rounded_choice_winner(winner, probabilities)
        distribution = probabilities
    except (KeyError, TypeError, ValueError, OverflowError) as error:
        raise KnowGraphJevError("knowgraph_jev_response_invalid") from error
    common = {
        "winner": winner,
        "distribution": distribution,
        "provider": str(response.get("provider") or ""),
        "requested_model": JEV_MODEL,
        "resolved_model": str(response.get("model") or ""),
        "usage": response.get("usage") if isinstance(response.get("usage"), dict) else {},
        "question_schema_version": "knowgraph.relationship-choice.v3",
        "vocabulary_version": PROJECT_RELATIONSHIP_VOCABULARY_VERSION,
        "vocabulary_hash": relationship_vocabulary_hash(
            relationship_vocabulary
        ),
        "vocabulary_count": len(relationship_vocabulary),
        "vocabulary_at_maximum": (
            len(relationship_vocabulary)
            >= PROJECT_RELATIONSHIP_VOCABULARY_MAXIMUM
        ),
        "choice_options": list(choices),
        "relationship_proposal_status": str(
            (choice_plan or {}).get("proposal_status") or "reused_canonical"
        ),
        "novel_relationship_candidate": str(
            (choice_plan or {}).get("novel_candidate") or ""
        ),
        "evaluated_at": _utc_now(),
    }
    if winner in KNOWGRAPH_CONTROL_OUTCOMES:
        return {
            **common,
            "status": "unavailable",
            "control_outcome": winner,
            "failure_reason": "knowgraph_jev_insufficient_context",
        }
    return {
        **common,
        "status": "success",
        "label_confidence": distribution[winner],
    }


def classify_knowgraph_fact(
    fact: dict[str, Any],
    *,
    relationship_vocabulary: tuple[str, ...] = SHARED_JEV_RELATIONSHIPS,
    transport: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Map one native Graphiti fact to the shared semantic edge vocabulary."""
    native_fact_uuid = _bounded_text(fact.get("nativeFactUuid"), 512)
    source = _entity(fact.get("sourceEntity"))
    target = _entity(fact.get("targetEntity"))
    native_relation = _bounded_text(fact.get("nativeRelation"), 1_000)
    statement = _bounded_text(fact.get("fact"), 8_000)
    if not native_fact_uuid or not source["uuid"] or not target["uuid"] or not statement:
        raise KnowGraphJevError("knowgraph_jev_input_invalid")
    choice_plan = relationship_choice_plan(
        native_relation,
        relationship_vocabulary,
        KNOWGRAPH_CONTROL_OUTCOMES,
    )
    choices = tuple(choice_plan["choices"])
    criteria = {
        name: SHARED_JEV_RELATIONSHIP_CRITERIA.get(
            name,
            f"The native directed fact is best represented by the canonical predicate {name}.",
        )
        for name in choices
        if name not in KNOWGRAPH_CONTROL_OUTCOMES
    } | {
        "INSUFFICIENT_CONTEXT": _KNOWGRAPH_RELATIONSHIP_CRITERIA[
            "INSUFFICIENT_CONTEXT"
        ],
    }

    body = {
        "model": JEV_MODEL,
        "state": {
            "description": (
                "One existing source-grounded native Graphiti EntityEdge. Classify only its "
                "directed factual relationship; never judge whether the fact may exist."
            ),
            "native_fact_uuid": native_fact_uuid,
            "source_entity_a": source,
            "target_entity_b": target,
            "direction": "A -> B",
            "native_graphiti_relationship": native_relation,
            "graphiti_fact": statement,
            "current_project_relationship_vocabulary": list(
                relationship_vocabulary
            ),
            "supporting_source_episodes": _episode_context(fact.get("supportingEpisodes")),
            "temporal_fields": {
                key: fact.get(key)
                for key in (
                    "createdAt", "referenceTime", "validAt", "invalidAt", "expiredAt",
                )
                if fact.get(key) is not None
            },
            "bounded_nearby_factual_context": _nearby_context(fact.get("nearbyFacts")),
        },
        "questions": {
            "relationship": {
                "type": "choice",
                "instructions": (
                    "Choose the current project semantic relationship that best describes the existing directed "
                    "Graphiti fact source_entity_a -> target_entity_b. The native relation, natural-"
                    "language fact, exact supporting episodes, temporal fields, and bounded nearby "
                    "facts are context. Prefer an existing canonical predicate whenever it accurately "
                    "expresses the fact. The optional novel candidate is only another Choice option; "
                    "select it only when every existing predicate is less accurate. Do not assess "
                    "truth, source quality, admission, deletion, or "
                    "entity validity. If no shared semantic relationship can be supported, choose "
                    "INSUFFICIENT_CONTEXT. It is a control outcome, never a persisted edge label. "
                    "The native Graphiti fact remains unchanged and usable either way."
                ),
                "criteria": criteria,
            }
        },
    }
    if choice_plan["novel_candidate"]:
        body["state"]["optional_novel_relationship_candidate"] = (
            choice_plan["novel_candidate"]
        )
    if len(json.dumps(body, ensure_ascii=False, default=str).encode("utf-8")) > 240_000:
        raise KnowGraphJevError("knowgraph_jev_input_limit")

    if transport is None:
        api_key = os.environ.get("OPENROUTER_API_KEY", "").strip()
        if not api_key:
            raise KnowGraphJevError("knowgraph_jev_key_unavailable")
        try:
            with httpx.Client(timeout=45.0, follow_redirects=False) as client:
                result = client.post(
                    JEV_ENDPOINT,
                    headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                    json=body,
                )
                result.raise_for_status()
                response = result.json()
        except httpx.TimeoutException as error:
            raise KnowGraphJevError("knowgraph_jev_timeout") from error
        except (httpx.HTTPError, json.JSONDecodeError, ValueError) as error:
            raise KnowGraphJevError("knowgraph_jev_unavailable") from error
    else:
        response = transport(body)
    if not isinstance(response, dict):
        raise KnowGraphJevError("knowgraph_jev_response_invalid")
    return _validate_jev_response(
        response,
        choices=choices,
        relationship_vocabulary=relationship_vocabulary,
        choice_plan=choice_plan,
    )


def classify_knowgraph_facts(
    facts: list[dict[str, Any]],
    *,
    relationship_vocabulary: tuple[str, ...] = SHARED_JEV_RELATIONSHIPS,
    classifier: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Classify a bounded fact set while preserving one result per native fact."""
    if len(facts) > MAX_FACTS_PER_BATCH:
        raise KnowGraphJevError("knowgraph_jev_batch_too_large")
    results: list[dict[str, Any]] = [{} for _ in facts]
    if not facts:
        return results

    classify = classifier or (
        lambda fact: classify_knowgraph_fact(
            fact,
            relationship_vocabulary=relationship_vocabulary,
        )
    )
    with ThreadPoolExecutor(
        max_workers=min(MAX_JEV_CONCURRENCY, len(facts)),
        thread_name_prefix="knowgraph-jev",
    ) as executor:
        future_indexes = {
            executor.submit(classify, fact): index
            for index, fact in enumerate(facts)
        }
        for future in as_completed(future_indexes):
            index = future_indexes[future]
            native_id = str(facts[index].get("nativeFactUuid") or "").strip()
            try:
                results[index] = {"nativeFactUuid": native_id, **future.result()}
            except Exception as error:
                results[index] = {
                    "nativeFactUuid": native_id,
                    "status": _failure_status(error),
                    "requested_model": JEV_MODEL,
                    "question_schema_version": "knowgraph.relationship-choice.v3",
                    "vocabulary_version": PROJECT_RELATIONSHIP_VOCABULARY_VERSION,
                    "vocabulary_hash": relationship_vocabulary_hash(
                        relationship_vocabulary
                    ),
                    "vocabulary_count": len(relationship_vocabulary),
                    "evaluated_at": _utc_now(),
                    "failure_reason": str(error).strip() or type(error).__name__,
                }
    return results
