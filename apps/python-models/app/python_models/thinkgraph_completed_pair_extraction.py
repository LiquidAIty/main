"""Saved ThinkGraph Card structured extraction contract and result projection."""

from __future__ import annotations

from copy import deepcopy
import json
from typing import Any, Literal

from engraphis.core.interfaces import MemoryType
from pydantic import BaseModel, ConfigDict, Field, model_validator

from .thinkgraph_relationship_vocabulary import ThinkGraphIntakeError


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
    prompt, schema = extractor.extraction_contract(
        pair_text,
        context=context_text,
    )
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
    return schema, prompt


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
