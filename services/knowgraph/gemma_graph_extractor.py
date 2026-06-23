# @graph entity: Gemma Schema-Guided Graph Extractor
# @graph role: ontology-slice-guided-local-graph-extraction
# @graph relates_to: Research Memory Delta, Local Gemma Chunker, SLM Graph Worker
# @graph depends_on: Docker Model Runner, KnowGraph EmbeddingGemma Client
# @graph feeds_to: KnowGraph, ThinkGraph
"""Schema-guided local Gemma graph extraction (Python rails).

Replaces generic "chunk this document" prompting in the graph path with a
bounded, ontology-slice-guided extraction. The FIRST frontier Research Agent
pass supplies an OWL-shaped ``OntologySlice`` (allowed classes/relations/
patterns/properties + known anchors + source/status rules) inside its single
structured result — no second model call. Deterministic structure (no model)
splits source material into bounded physical units. Local Gemma then turns ONE
physical unit + the slice into source-grounded semantic evidence units.

This mirrors the existing TypeScript contract in
``apps/backend/src/slmGraph/slmGraphWorker.ts`` (SlmGraphInput/SlmGraphExtraction
+ fail-closed normalization) and adds: allowed-vocabulary enforcement (disallowed
classes/relations are rejected), an evidence-span faithfulness guard (no external
assertion without text actually present in the unit), and an explicit direct /
interpretation / unresolved status per assertion.

Local Gemma here ONLY does the bounded schema-guided graph job: it never
researches, searches the web, orchestrates retrieval, or writes user-facing
prose. There is NO cloud fallback — unavailable/unfaithful output fails honestly.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any, Callable

import gemma_chunker  # reuse the local Gemma chat config + stdlib transport

# Assertion status vocabulary -> research-memory outcome vocabulary.
STATUS_TO_OUTCOME = {
    "direct_fact": "directly_stated",
    "directly_stated": "directly_stated",
    "supported": "supported",
    "contradicted": "contradicted",
    "qualified": "qualified",
    "interpretation": "hypothesis",
    "hypothesis": "hypothesis",
    "uncertain": "uncertain",
    "unresolved": "unresolved",
}
EXTERNAL_STATUSES = {"direct_fact", "directly_stated", "supported", "contradicted", "qualified"}


class GemmaGraphExtractionError(RuntimeError):
    """Local Gemma graph extraction unavailable or produced unusable output.
    No cloud fallback — fail honestly."""


# --------------------------------------------------------------------------- #
# frontier-produced ontology slice (reuses the slmGraphWorker slice fields)
# --------------------------------------------------------------------------- #
@dataclass
class OntologySlice:
    target_graph: str                                   # knowgraph | thinkgraph
    allowed_classes: list[str] = field(default_factory=list)
    allowed_relations: list[str] = field(default_factory=list)
    allowed_relation_patterns: list[str] = field(default_factory=list)  # "Company has_ticker_symbol Ticker"
    allowed_properties: list[str] = field(default_factory=list)
    known_entity_anchors: list[str] = field(default_factory=list)
    source_required: bool = True
    fact_interpretation_rule: str = (
        "Mark a claim direct_fact only with supporting evidence_text from this unit; "
        "otherwise use interpretation or unresolved. Never invent classes, relations, or values."
    )


@dataclass
class PhysicalUnit:
    text: str
    source_ref: str
    kind: str                     # page | heading | paragraph | table | figure_caption | transcript_segment
    position: int = 0
    page: int | None = None
    section: str = ""


@dataclass
class SemanticEvidenceUnit:
    evidence_text: str            # exact span from the physical unit
    source_ref: str
    position: int
    page: int | None
    section: str
    entities: list[dict[str, Any]]
    relations: list[dict[str, Any]]
    assertions: list[dict[str, Any]]   # {subject, predicate, object, status, outcome, evidence_text}
    confidence: float
    uncertainty: list[str]
    status: str                   # dominant status: direct_fact | interpretation | unresolved


def _clean(value: object) -> str:
    return "" if value is None else str(value).strip()


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip().lower()


def _slug(label: str) -> str:
    return re.sub(r"^_+|_+$", "", re.sub(r"[^a-z0-9]+", "_", label.lower()))[:60] or "entity"


# --------------------------------------------------------------------------- #
# deterministic physical-unit segmentation (NO model)
# --------------------------------------------------------------------------- #
_TIMESTAMP_RE = re.compile(r"^\s*\d{1,2}:\d{2}(:\d{2})?\b")


def _classify_unit(block: str) -> str:
    stripped = block.strip()
    first_line = stripped.splitlines()[0] if stripped else ""
    if first_line.startswith("#") or (len(stripped) <= 80 and stripped.endswith(":")):
        return "heading"
    if "|" in stripped and stripped.count("|") >= 2:
        return "table"
    if re.match(r"^(figure|fig\.|image|caption|photo)\b", first_line, re.I):
        return "figure_caption"
    if _TIMESTAMP_RE.match(first_line):
        return "transcript_segment"
    return "paragraph"


def segment_physical_units(text: str, *, source_ref: str, page: int | None = None,
                           section: str = "") -> list[PhysicalUnit]:
    """Split source material into bounded physical units using deterministic
    structure only — pages, headings, paragraphs, tables, captions, transcript
    segments. No model call participates in physical segmentation."""
    cleaned = str(text or "").replace("\r\n", "\n").strip()
    if not cleaned:
        return []
    blocks = [b.strip() for b in re.split(r"\n\s*\n", cleaned) if b.strip()]
    units: list[PhysicalUnit] = []
    current_section = section
    for i, block in enumerate(blocks):
        kind = _classify_unit(block)
        if kind == "heading":
            current_section = block.lstrip("#").strip().rstrip(":")
        units.append(PhysicalUnit(text=block, source_ref=source_ref, kind=kind,
                                  position=i, page=page, section=current_section))
    return units


# --------------------------------------------------------------------------- #
# schema-guided prompt + fail-closed parse (mirrors slmGraphWorker)
# --------------------------------------------------------------------------- #
def build_extraction_prompt(unit: PhysicalUnit, slice_: OntologySlice) -> tuple[str, str]:
    system = "\n".join([
        "You are a local schema-guided graph extraction worker. Do ONE bounded OWL graph",
        "extraction over the given text unit. Return JSON ONLY (no markdown, no prose).",
        "Use ONLY the allowed classes and relations. Never invent classes, relations, or values.",
        "Every assertion MUST include an exact evidence_text copied verbatim from the unit text,",
        "and a status of direct_fact, interpretation, or unresolved. Put anything unsure into",
        "uncertainty. Do not research, search, or write a user-facing answer.",
        "Required JSON keys: entities, relations, assertions, uncertainty, confidence.",
        "entities: [{label,type}]  relations: [{from,to,type}]",
        "assertions: [{subject,predicate,object,status,evidence_text}]",
    ])
    user = "\n".join([
        f"targetGraph: {slice_.target_graph}",
        f"sourceRef: {unit.source_ref or '(none)'}",
        f"allowedClasses: {json.dumps(slice_.allowed_classes)}",
        f"allowedRelations: {json.dumps(slice_.allowed_relations)}",
        f"allowedRelationPatterns: {json.dumps(slice_.allowed_relation_patterns)}",
        f"allowedProperties: {json.dumps(slice_.allowed_properties)}",
        f"knownEntityAnchors: {json.dumps(slice_.known_entity_anchors)}",
        f"sourceRequired: {str(bool(slice_.source_required)).lower()}",
        f"rule: {slice_.fact_interpretation_rule}",
        "",
        "text:",
        unit.text,
    ])
    return system, user


def _extract_json_object(content: str) -> dict[str, Any]:
    content = str(content or "").strip()
    try:
        parsed = json.loads(content)
    except ValueError:
        match = re.search(r"\{[\s\S]*\}", content)
        if not match:
            raise GemmaGraphExtractionError("extractor did not return a JSON object")
        try:
            parsed = json.loads(match.group(0))
        except ValueError as exc:
            raise GemmaGraphExtractionError("extractor returned invalid JSON") from exc
    if not isinstance(parsed, dict):
        raise GemmaGraphExtractionError("extractor output was not a JSON object")
    return parsed


def _as_list(value: object) -> list:
    return value if isinstance(value, list) else []


# --------------------------------------------------------------------------- #
# ontology enforcement
# --------------------------------------------------------------------------- #
@dataclass
class EnforcementResult:
    entities: list[dict[str, Any]]
    relations: list[dict[str, Any]]
    assertions: list[dict[str, Any]]
    rejected_classes: list[str]
    rejected_relations: list[str]
    rejected_sourceless: int
    rejected_unfaithful: int


def enforce_ontology(parsed: dict[str, Any], unit: PhysicalUnit, slice_: OntologySlice) -> EnforcementResult:
    """Keep only allowed classes/relations; require faithful evidence_text + a
    source for external assertions. Disallowed items are rejected (fail closed for
    that item), never written, and reported."""
    allowed_classes = {c.lower() for c in slice_.allowed_classes}
    allowed_relations = {r.lower() for r in slice_.allowed_relations}
    unit_norm = _norm(unit.text)

    entities, rejected_classes = [], []
    for raw in _as_list(parsed.get("entities")):
        if not isinstance(raw, dict):
            continue
        label = _clean(raw.get("label") or raw.get("name"))
        etype = _clean(raw.get("type") or raw.get("class") or "entity")
        if not label:
            continue
        if allowed_classes and etype.lower() not in allowed_classes:
            rejected_classes.append(etype)
            continue
        entities.append({"id": _slug(label), "label": label, "type": etype})

    relations, rejected_relations = [], []
    for raw in _as_list(parsed.get("relations")):
        if not isinstance(raw, dict):
            continue
        frm = _clean(raw.get("from") or raw.get("source"))
        to = _clean(raw.get("to") or raw.get("target"))
        rtype = _clean(raw.get("type") or raw.get("relation"))
        if not (frm and to and rtype):
            continue
        if allowed_relations and rtype.lower() not in allowed_relations:
            rejected_relations.append(rtype)
            continue
        relations.append({"from": frm, "to": to, "type": rtype})

    assertions, rejected_sourceless, rejected_unfaithful = [], 0, 0
    for raw in _as_list(parsed.get("assertions")):
        if not isinstance(raw, dict):
            continue
        subject = _clean(raw.get("subject"))
        predicate = _clean(raw.get("predicate"))
        obj = _clean(raw.get("object"))
        status = _clean(raw.get("status")).lower() or "interpretation"
        evidence_text = _clean(raw.get("evidence_text"))
        if not (subject and predicate and obj):
            continue
        if allowed_relations and predicate.lower() not in allowed_relations:
            rejected_relations.append(predicate)
            continue
        # External (fact/support/contradiction) assertions require faithful evidence text.
        if status in EXTERNAL_STATUSES:
            if not evidence_text or (slice_.source_required and not unit.source_ref):
                rejected_sourceless += 1
                continue
            if _norm(evidence_text) not in unit_norm:
                rejected_unfaithful += 1
                continue
        assertions.append({
            "subject": subject, "predicate": predicate, "object": obj,
            "status": status, "outcome": STATUS_TO_OUTCOME.get(status, "interpretation"),
            "evidence_text": evidence_text,
        })

    return EnforcementResult(entities, relations, assertions, rejected_classes,
                             rejected_relations, rejected_sourceless, rejected_unfaithful)


# --------------------------------------------------------------------------- #
# local Gemma call + extraction
# --------------------------------------------------------------------------- #
def _call_gemma(system: str, user: str, *, config: gemma_chunker.GemmaChunkerConfig,
                transport: Callable[[str, dict, float], dict] | None = None) -> str:
    transport = transport or gemma_chunker._http_post_json
    body = transport(
        config.url,
        {"model": config.model, "temperature": 0,
         "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]},
        config.timeout_s,
    )
    try:
        return str(body["choices"][0]["message"]["content"])
    except (KeyError, IndexError, TypeError) as exc:
        raise GemmaGraphExtractionError("extractor response missing message content") from exc


@dataclass
class ExtractionRun:
    units: list[SemanticEvidenceUnit]
    enforcement: EnforcementResult
    raw_preview: str
    output_chars: int


def extract_semantic_units(
    unit: PhysicalUnit, slice_: OntologySlice, *,
    call_fn: Callable[[str, str], str] | None = None,
    config: gemma_chunker.GemmaChunkerConfig | None = None,
) -> ExtractionRun:
    """One bounded physical unit + ontology slice -> source-grounded semantic
    evidence units. Fails honestly on unavailable/unusable output (no fallback)."""
    config = config or gemma_chunker.GemmaChunkerConfig.from_env()
    system, user = build_extraction_prompt(unit, slice_)
    if call_fn is not None:
        content = call_fn(system, user)
    else:
        content = _call_gemma(system, user, config=config)

    parsed = _extract_json_object(content)
    enforcement = enforce_ontology(parsed, unit, slice_)
    confidence = parsed.get("confidence")
    try:
        confidence = float(confidence)
    except (TypeError, ValueError):
        confidence = 0.0
    uncertainty = [str(u) for u in _as_list(parsed.get("uncertainty")) if _clean(u)]

    units: list[SemanticEvidenceUnit] = []
    if enforcement.assertions or enforcement.entities or enforcement.relations:
        statuses = {a["status"] for a in enforcement.assertions}
        dominant = ("direct_fact" if "direct_fact" in statuses or "directly_stated" in statuses
                    else "unresolved" if "unresolved" in statuses
                    else "interpretation")
        # The retained evidence span is the union of faithful assertion evidence,
        # falling back to the physical unit text so the path back to source survives.
        spans = [a["evidence_text"] for a in enforcement.assertions if a["evidence_text"]]
        evidence_text = " ".join(dict.fromkeys(spans)) or unit.text
        units.append(SemanticEvidenceUnit(
            evidence_text=evidence_text[:1200], source_ref=unit.source_ref, position=unit.position,
            page=unit.page, section=unit.section, entities=enforcement.entities,
            relations=enforcement.relations, assertions=enforcement.assertions,
            confidence=confidence, uncertainty=uncertainty, status=dominant))

    return ExtractionRun(units=units, enforcement=enforcement,
                         raw_preview=str(content)[:600], output_chars=len(str(content)))


# --------------------------------------------------------------------------- #
# build a validated ResearchMemoryDelta from extracted material
# --------------------------------------------------------------------------- #
@dataclass
class SourceMaterial:
    text: str
    source_ref: str
    source_url: str = ""
    source_title: str = ""
    page: int | None = None
    section: str = ""


def extract_material_to_delta(
    *, project_id: str, run_id: str, research_summary: str, project_consequence: str,
    ontology_slice: OntologySlice, materials: list[SourceMaterial],
    prior_reasoning_refs: list[str] | None = None,
    call_fn: Callable[[str, str], str] | None = None,
    config: gemma_chunker.GemmaChunkerConfig | None = None,
) -> dict[str, Any]:
    """Run the full schema-guided extraction over local material and assemble a
    validated ResearchMemoryDelta whose retained material is the retained semantic
    evidence units (embedded later — never every physical unit)."""
    import research_memory_delta as rmd

    source_lookup = {m.source_ref: m for m in materials}
    all_units: list[SemanticEvidenceUnit] = []
    physical_count = 0
    totals = {"rejected_classes": 0, "rejected_relations": 0, "rejected_sourceless": 0,
              "rejected_unfaithful": 0, "output_chars": 0}
    for material in materials:
        for unit in segment_physical_units(material.text, source_ref=material.source_ref,
                                            page=material.page, section=material.section):
            physical_count += 1
            run = extract_semantic_units(unit, ontology_slice, call_fn=call_fn, config=config)
            all_units.extend(run.units)
            totals["rejected_classes"] += len(run.enforcement.rejected_classes)
            totals["rejected_relations"] += len(run.enforcement.rejected_relations)
            totals["rejected_sourceless"] += run.enforcement.rejected_sourceless
            totals["rejected_unfaithful"] += run.enforcement.rejected_unfaithful
            totals["output_chars"] += run.output_chars

    assertions: list[rmd.DeltaAssertion] = []
    observations: list[rmd.Observation] = []
    retained: list[rmd.RetainedChunkInput] = []
    uncertainty: list[str] = []
    target = ontology_slice.target_graph or "knowgraph"
    for evu in all_units:
        mat = source_lookup.get(evu.source_ref)
        for a in evu.assertions:
            assertions.append(rmd.DeltaAssertion(
                subject=a["subject"], predicate=a["predicate"], object=a["object"], outcome=a["outcome"],
                evidence_text=a["evidence_text"], source_ref=evu.source_ref,
                source_url=mat.source_url if mat else "", source_title=mat.source_title if mat else ""))
        for ent in evu.entities:
            observations.append(rmd.Observation(text=f"{ent['label']} ({ent['type']})",
                                                source_ref=evu.source_ref, entity=ent["label"]))
        uncertainty.extend(evu.uncertainty)
        # Retain ONLY the semantic evidence unit text (embedded later); not the physical unit.
        retained.append(rmd.RetainedChunkInput(text=evu.evidence_text, kind="source_evidence",
                                               store=target, source_ref=evu.source_ref))

    delta = rmd.ResearchMemoryDelta(
        project_id=project_id, run_id=run_id, research_summary=research_summary,
        project_consequence=project_consequence,
        source_refs=[rmd.SourceRef(m.source_ref, m.source_url, m.source_title) for m in materials],
        assertions=assertions, observations=observations,
        uncertainty=list(dict.fromkeys(uncertainty)), retained_material=retained,
        prior_reasoning_refs=list(prior_reasoning_refs or []))

    return {"delta": delta, "semantic_units": all_units,
            "physical_units": physical_count, "totals": totals}
