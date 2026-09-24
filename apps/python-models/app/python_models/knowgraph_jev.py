"""Write-lifecycle Jev classification for native, source-grounded Graphiti facts.

Graphiti remains the fact, entity, provenance, and temporal authority.  This
module returns one bounded canonical relationship Choice for each fact touched
by the active Graphiti ingest. The ingest owner persists successful metadata on
that same relationship; this module never admits, rejects, or rewrites facts.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from typing import Any, Callable

import httpx


JEV_MODEL = "typesafe/jev-1.13"
JEV_ENDPOINT = "https://openrouter.ai/api/alpha/decisions"
MAX_JEV_CONCURRENCY = 4
MAX_FACTS_PER_BATCH = 64

KNOWGRAPH_RELATIONSHIPS = (
    "IS_A", "PART_OF", "HAS_PART", "LOCATED_IN",
    "OWNS", "OPERATES", "PRODUCES", "PROVIDES", "USES", "DEPENDS_ON",
    "CAUSES", "AFFECTS",
    "PARTNERS_WITH", "COMPETES_WITH", "CONTRACTS_WITH", "SUPPLIES",
    "FUNDS", "INVESTS_IN", "ACQUIRES",
    "REGULATES", "GOVERNS",
    "REPORTS", "MEASURES",
    "ASSOCIATED_WITH",
    "OTHER_RELATION", "INSUFFICIENT_CONTEXT",
)
KNOWGRAPH_RELATIONSHIP_SCHEMA_VERSION = "knowgraph.relationships.v1"
KNOWGRAPH_RELATIONSHIP_SCHEMA_HASH = hashlib.sha256(
    json.dumps(KNOWGRAPH_RELATIONSHIPS, separators=(",", ":")).encode("utf-8")
).hexdigest()

_RELATIONSHIP_CRITERIA = {
    "IS_A": "A is an instance, subtype, or category member of B.",
    "PART_OF": "A is a constituent, division, component, or member of B.",
    "HAS_PART": "A contains B as a constituent, division, component, or member.",
    "LOCATED_IN": "A is physically or organizationally located in B.",
    "OWNS": "A has ownership of B.",
    "OPERATES": "A runs, manages, or controls the operation of B.",
    "PRODUCES": "A manufactures, creates, or generates B.",
    "PROVIDES": "A furnishes B as a product, service, resource, or capability.",
    "USES": "A employs B as a tool, input, platform, or resource.",
    "DEPENDS_ON": "A requires B as an enabling condition, input, or prerequisite.",
    "CAUSES": "A produces or brings about B.",
    "AFFECTS": "A materially influences or changes B without a stronger causal claim.",
    "PARTNERS_WITH": "A and B have a cooperative partnership or joint arrangement.",
    "COMPETES_WITH": "A and B compete in a market, contract, capability, or objective.",
    "CONTRACTS_WITH": "A has a contractual relationship with B.",
    "SUPPLIES": "A supplies goods, components, services, or resources to B.",
    "FUNDS": "A provides funding to B.",
    "INVESTS_IN": "A makes an investment in B.",
    "ACQUIRES": "A purchases or takes control of B.",
    "REGULATES": "A sets or enforces rules governing B.",
    "GOVERNS": "A exercises governing authority over B.",
    "REPORTS": "A states, publishes, or formally communicates information about B.",
    "MEASURES": "A quantifies, evaluates, or records a measure of B.",
    "ASSOCIATED_WITH": "A and B have a supported factual association not captured more specifically.",
    "OTHER_RELATION": "A and B have a supported factual relationship outside this vocabulary.",
    "INSUFFICIENT_CONTEXT": "The supplied native fact and source context do not support a canonical choice.",
}


class KnowGraphJevError(RuntimeError):
    """A real KnowGraph Jev Choice could not be obtained or validated."""


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _bounded_text(value: Any, limit: int) -> str:
    return str(value or "").strip()[:limit]


def _entity(value: Any) -> dict[str, str]:
    item = value if isinstance(value, dict) else {}
    return {
        "uuid": _bounded_text(item.get("uuid"), 512),
        "name": _bounded_text(item.get("name"), 512),
    }


def _episode_context(value: Any) -> list[dict[str, Any]]:
    episodes = value if isinstance(value, list) else []
    bounded: list[dict[str, Any]] = []
    for raw in episodes[:8]:
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
    return [{
        "native_fact_uuid": _bounded_text(item.get("nativeFactUuid"), 512),
        "source": _entity(item.get("sourceEntity")),
        "target": _entity(item.get("targetEntity")),
        "native_relation": _bounded_text(item.get("nativeRelation"), 1_000),
        "fact": _bounded_text(item.get("fact"), 2_000),
    } for item in facts[:8] if isinstance(item, dict)]


def _failure_status(error: Exception) -> str:
    message = str(error)
    if "timeout" in message:
        return "timeout"
    if "response_invalid" in message or "input_invalid" in message:
        return "invalid"
    if "unavailable" in message or "key_unavailable" in message:
        return "unavailable"
    return "error"


def _validate_jev_response(response: dict[str, Any]) -> dict[str, Any]:
    try:
        answer = response["answers"]["relationship"]
        if answer.get("type") != "choice":
            raise ValueError("answer type")
        winner = str(answer["choice"])
        if winner not in KNOWGRAPH_RELATIONSHIPS:
            raise ValueError("winner")
        raw = answer["probabilities"]
        if not isinstance(raw, dict) or set(raw) != set(KNOWGRAPH_RELATIONSHIPS):
            raise ValueError("probability keys")
        probabilities = {name: float(raw[name]) for name in KNOWGRAPH_RELATIONSHIPS}
        if any(not math.isfinite(value) or value < 0 or value > 1
               for value in probabilities.values()):
            raise ValueError("probability values")
        total = sum(probabilities.values())
        if total <= 0:
            raise ValueError("probability total")
        distribution = {name: value / total for name, value in probabilities.items()}
    except (KeyError, TypeError, ValueError, OverflowError) as error:
        raise KnowGraphJevError("knowgraph_jev_response_invalid") from error
    return {
        "status": "success",
        "winner": winner,
        "distribution": distribution,
        "label_confidence": distribution[winner],
        "provider": str(response.get("provider") or ""),
        "requested_model": JEV_MODEL,
        "resolved_model": str(response.get("model") or ""),
        "usage": response.get("usage") if isinstance(response.get("usage"), dict) else {},
        "question_schema_version": "knowgraph.relationship-choice.v1",
        "vocabulary_version": KNOWGRAPH_RELATIONSHIP_SCHEMA_VERSION,
        "vocabulary_hash": KNOWGRAPH_RELATIONSHIP_SCHEMA_HASH,
        "evaluated_at": _utc_now(),
    }


def classify_knowgraph_fact(
    fact: dict[str, Any],
    *,
    transport: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Map one native Graphiti fact to the bounded KnowGraph vocabulary."""
    native_fact_uuid = _bounded_text(fact.get("nativeFactUuid"), 512)
    source = _entity(fact.get("sourceEntity"))
    target = _entity(fact.get("targetEntity"))
    native_relation = _bounded_text(fact.get("nativeRelation"), 1_000)
    statement = _bounded_text(fact.get("fact"), 8_000)
    if not native_fact_uuid or not source["uuid"] or not target["uuid"] or not statement:
        raise KnowGraphJevError("knowgraph_jev_input_invalid")

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
                    "Choose the best canonical factual relationship for the existing directed "
                    "Graphiti fact source_entity_a -> target_entity_b. The native relation, natural-"
                    "language fact, exact supporting episodes, temporal fields, and bounded nearby "
                    "facts are context. Do not assess truth, source quality, admission, deletion, or "
                    "entity validity. OTHER_RELATION means a supported relationship outside the "
                    "vocabulary. INSUFFICIENT_CONTEXT means no canonical relationship can be chosen. "
                    "Neither choice removes or weakens the native Graphiti fact."
                ),
                "criteria": _RELATIONSHIP_CRITERIA,
            }
        },
    }

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
    return _validate_jev_response(response)


def classify_knowgraph_facts(
    facts: list[dict[str, Any]],
    *,
    classifier: Callable[[dict[str, Any]], dict[str, Any]] = classify_knowgraph_fact,
) -> list[dict[str, Any]]:
    """Classify a bounded fact set while preserving one result per native fact."""
    if len(facts) > MAX_FACTS_PER_BATCH:
        raise KnowGraphJevError("knowgraph_jev_batch_too_large")
    results: list[dict[str, Any]] = [{} for _ in facts]
    if not facts:
        return results

    with ThreadPoolExecutor(
        max_workers=min(MAX_JEV_CONCURRENCY, len(facts)),
        thread_name_prefix="knowgraph-jev",
    ) as executor:
        future_indexes = {
            executor.submit(classifier, fact): index
            for index, fact in enumerate(facts)
        }
        for future in as_completed(future_indexes):
            index = future_indexes[future]
            native_id = _bounded_text(facts[index].get("nativeFactUuid"), 512)
            try:
                results[index] = {"nativeFactUuid": native_id, **future.result()}
            except Exception as error:
                results[index] = {
                    "nativeFactUuid": native_id,
                    "status": _failure_status(error),
                    "requested_model": JEV_MODEL,
                    "question_schema_version": "knowgraph.relationship-choice.v1",
                    "vocabulary_version": KNOWGRAPH_RELATIONSHIP_SCHEMA_VERSION,
                    "vocabulary_hash": KNOWGRAPH_RELATIONSHIP_SCHEMA_HASH,
                    "evaluated_at": _utc_now(),
                    "failure_reason": str(error).strip() or type(error).__name__,
                }
    return results
