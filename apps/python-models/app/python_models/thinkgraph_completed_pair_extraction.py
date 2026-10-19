"""Saved ThinkGraph Card structured extraction contract and result projection."""

# Entity: ThinkGraph
# Relationship: This file defines and validates the saved ThinkGraph Card's completed-pair extraction contract and projects one bounded Think per distinct Entity.

from __future__ import annotations

from copy import deepcopy
import json
from typing import Any, Literal

from engraphis.core.interfaces import MemoryType
from pydantic import BaseModel, ConfigDict, Field, model_validator

from .thinkgraph_relationship_vocabulary import ThinkGraphIntakeError


class _StructuredModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        str_strip_whitespace=True,
        use_enum_values=True,
    )


class ThinkGraphThink(_StructuredModel):
    summary: str = Field(min_length=1, max_length=100_000)
    detail: str | None = Field(default=None, min_length=1)


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
    """One Entity-specific Think accepted by the Engraphis structured extractor."""

    content: str = Field(min_length=1, max_length=100_000)
    title: str = Field(min_length=1, max_length=256)
    mtype: Literal["episodic"] = "episodic"
    importance: float = Field(default=0.0, ge=0.0, le=1.0)
    keywords: list[str] = Field(default_factory=list, max_length=16)
    entity: str = Field(min_length=1, max_length=256)
    entities: list[str] = Field(min_length=1, max_length=20)
    relations: list[ThinkGraphStructuredRelation] = Field(
        default_factory=list,
        max_length=10,
    )
    think: ThinkGraphThink

    @model_validator(mode="after")
    def validate_think(self) -> "ThinkGraphStructuredFact":
        if self.content != self.think.summary:
            raise ValueError("thinkgraph_card_content_summary_mismatch")
        entity_keys = [value.casefold() for value in self.entities]
        if len(entity_keys) != len(set(entity_keys)):
            raise ValueError("thinkgraph_card_chunk_entity_duplicate")
        if self.entity.casefold() not in set(entity_keys):
            raise ValueError("thinkgraph_card_entity_missing_from_chunk")
        relationship_keys: set[tuple[str, str, str]] = set()
        for relationship in self.relations:
            source_key = relationship.source.casefold()
            target_key = relationship.target.casefold()
            if source_key == target_key:
                raise ValueError("thinkgraph_card_pair_self_reference")
            if source_key != self.entity.casefold():
                raise ValueError("thinkgraph_card_relationship_source_must_match_entity")
            if source_key not in set(entity_keys) or target_key not in set(entity_keys):
                raise ValueError("thinkgraph_card_relationship_entity_missing_from_chunk")
            identity = (
                source_key,
                relationship.relation.casefold(),
                target_key,
            )
            if identity in relationship_keys:
                raise ValueError("thinkgraph_card_pair_duplicate")
            relationship_keys.add(identity)
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
    return extractor_type(llm, max_facts=20)


def llm_structured_contract(
    pair_text: str,
    context: dict[str, Any],
) -> tuple[dict[str, Any], str]:
    extractor = _engraphis_structured_extractor(
        _SavedCardStructuredResult({}, "schema-only", "schema-only")
    )
    context_text = json.dumps(context, ensure_ascii=False, sort_keys=True)
    prompt, schema = extractor.extraction_contract(
        pair_text,
        context=context_text,
    )
    prompt += (
        "\nTHINKGRAPH ENTITY-SPECIFIC THINKS:\n"
        "Return zero or more objects in the facts array with mtype='episodic'. Return an "
        "empty facts array when the completed pair adds no useful current Project reasoning. A completed "
        "pair may yield Thinks for several useful Entities, but never more than one Think "
        "for the same Entity in this pair. Every Think attaches only to its exact `entity`. "
        "Write `think.summary` as one simple, concise, self-contained paragraph sized for "
        "the compact Entity card. Use optional `think.detail` for any longer technical "
        "explanation, Relationship reasoning, caveats, or other depth; detail remains part "
        "of the same Think and may be as long as useful. Store the identical compact body in "
        "`content` and `think.summary`. Do not copy one Entity's Think onto another Entity. "
        "The supplied project_graph_grounding contains one most Relevant and one distinct most "
        "Recent record per authority. Treat the Relevant record as stronger context than mere "
        "recency. Steelman the user's actual intent, compare the new pair with prior "
        "Thinks, and return a refinement, correction, contradiction, genuinely new idea, or "
        "empty facts; never restate a near-duplicate basic idea as new. "
        "Preserve material decisions, questions, preferences, corrections, assumptions, "
        "and uncertainty relevant to that Entity. Relationships remain separate directed "
        "Entity-to-Entity edges: list each relationship exactly once, under the fact whose "
        "`entity` is its source. Each relation object has exactly source, relation, and "
        "target. In each fact, `entities` contains its one Think Entity plus every exact "
        "target Entity used by that fact's Relationships. Use concise free-form "
        "relationship language grounded in the pair, not a "
        "normalized edge label. Jev alone chooses the durable relationship label and math. "
        "Inspect the supplied Project Entity map before naming Entities. Reuse an exact "
        "existing canonical name when it is the same Entity; add a new canonical name only "
        "when the completed pair genuinely introduces a distinct Entity. The map supplies "
        "identity and Relationships, never hidden Think or Know content. Do not browse, "
        "research, infer facts from the Entity map, read prior Think "
        "bodies, create multiple Thinks for one Entity, or add generic wrapper concepts.\n"
    )
    return schema, prompt


def extract_saved_card_facts(
    value: Any,
    *,
    pair_text: str,
    context: dict[str, Any],
    card_run: dict[str, str],
) -> list[Any]:
    if (
        not isinstance(value, dict)
        or set(value) != {"facts"}
        or not isinstance(value.get("facts"), list)
        or not 0 <= len(value["facts"]) <= 20
    ):
        raise ThinkGraphIntakeError("thinkgraph_card_entity_think_count_invalid")
    if not value["facts"]:
        return []
    extractor = _engraphis_structured_extractor(
        _SavedCardStructuredResult(
            value,
            card_run["resolvedProvider"],
            card_run["resolvedModel"],
        )
    )
    facts = extractor.extract(
        pair_text,
        context=json.dumps(context, ensure_ascii=False, sort_keys=True),
    )
    if len(facts) != len(value["facts"]) or any(
        isinstance(fact.metadata, dict)
        and fact.metadata.get("extraction_fallback")
        for fact in facts
    ):
        raise ThinkGraphIntakeError("thinkgraph_card_llm_structured_invalid")
    return facts


def project_saved_card_thinks(facts: list[Any]) -> list[dict[str, Any]]:
    """Mechanically project one validated Think per distinct Entity."""

    if not 0 <= len(facts) <= 20:
        raise ThinkGraphIntakeError("thinkgraph_card_entity_think_count_invalid")
    outputs: list[dict[str, Any]] = []
    entity_keys: set[str] = set()
    relationship_keys: set[tuple[str, str, str]] = set()
    relationship_count = 0
    for fact in facts:
        if fact.mtype != MemoryType.EPISODIC:
            raise ThinkGraphIntakeError("thinkgraph_card_entity_think_count_invalid")
        metadata = fact.metadata if isinstance(fact.metadata, dict) else {}
        structured = metadata.get("structured_extraction")
        if not isinstance(structured, dict):
            raise ThinkGraphIntakeError("thinkgraph_card_think_payload_invalid")
        raw_think = structured.get("think")
        entity = structured.get("entity")
        relationships = structured.get("relations", [])
        if (
            not isinstance(raw_think, dict)
            or raw_think.get("summary") != fact.content
            or not isinstance(entity, str)
            or not entity.strip()
            or not isinstance(relationships, list)
        ):
            raise ThinkGraphIntakeError("thinkgraph_card_think_payload_invalid")
        entity_key = entity.casefold()
        if entity_key in entity_keys:
            raise ThinkGraphIntakeError("thinkgraph_card_entity_duplicate")
        entity_keys.add(entity_key)
        for relationship in relationships:
            if not isinstance(relationship, dict):
                raise ThinkGraphIntakeError("thinkgraph_card_think_payload_invalid")
            identity = tuple(
                str(relationship.get(key) or "").casefold()
                for key in ("source", "relation", "target")
            )
            if identity in relationship_keys:
                raise ThinkGraphIntakeError("thinkgraph_card_pair_duplicate")
            relationship_keys.add(identity)
        relationship_count += len(relationships)
        if relationship_count > 20:
            raise ThinkGraphIntakeError("thinkgraph_card_relationship_limit_invalid")
        outputs.append({
            "summary": str(fact.content),
            "detail": raw_think.get("detail"),
            "title": str(fact.title or ""),
            "importance": float(fact.importance),
            "keywords": list(fact.keywords),
            "entity": entity,
            "relationships": deepcopy(relationships),
        })
    return outputs
