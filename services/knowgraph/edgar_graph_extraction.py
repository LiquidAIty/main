# @graph entity: EDGAR Core-Seed Graph Extraction Entrypoint
# @graph role: run-existing-knowgraph-pipeline-over-cached-edgar-evidence
# @graph depends_on: Gemma Schema-Guided Graph Extractor, Research Memory Delta, Docker Model Runner
# @graph feeds_to: KnowGraph
"""Run the EXISTING schema-guided local-Gemma KnowGraph extraction pipeline over the
already-cached EDGAR evidence sections, persisting durable source-backed entities and
reified relation assertions into the active project's Neo4j KnowGraph.

This is a THIN ORCHESTRATION ONLY. It reuses, unchanged:
  * gemma_graph_extractor.extract_material_to_delta  (local Gemma extraction + ontology enforce)
  * research_memory_delta.write_knowgraph_external    (the pipeline's own KnowGraph writer)

No new extraction logic, no regex/keyword/co-occurrence, no second direct writer, no cloud
fallback. Source text is ONLY the existing cached EDGAR sections. The model/provider is whatever
gemma_chunker is configured for (local Gemma via Docker Model Runner). Idempotent: a fixed run_id
makes the MERGE-keyed assertion/entity ids stable across re-runs.

  py -3.12 services/knowgraph/edgar_graph_extraction.py [--sections N] [--paras M]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Callable

import assertion_vectors as av
import gemma_graph_extractor as gge
import research_memory_delta as rmd

PROJECT = "20ac92da-01fd-4cf6-97cc-0672421e751a"


def _model_tag(model: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", model.lower()).strip("_") or "local_gemma"


def _agent_card_call_fn(provider: str, model_slug: str) -> Callable[[str, str], str]:
    """Drive the EXISTING extractor through the EXISTING agent-card model client
    (autogen_provider_env._build_model_client) — the same client the agent cards use. Only the
    model transport changes; the extractor's prompt, ontology enforcement, faithfulness guard,
    and persistence are untouched. The provider module loads apps/backend/.env itself (no env
    parsing here, no hand-rolled HTTP)."""
    import asyncio

    pm = Path(__file__).resolve().parents[2] / "apps" / "python-models" / "app" / "python_models"
    if str(pm) not in sys.path:
        sys.path.insert(0, str(pm))
    import autogen_provider_env as ape
    from autogen_core.models import SystemMessage, UserMessage

    client = ape._build_model_client(ape.AutoGenAgentConfig(
        provider=provider, provider_model_id=model_slug, temperature=0))

    def call(system: str, user: str) -> str:
        result = asyncio.run(client.create([
            SystemMessage(content=system),
            UserMessage(content=user, source="edgar_extractor"),
        ]))
        content = result.content
        return content if isinstance(content, str) else str(content)

    return call

_SEED = Path(__file__).resolve().parent / "edgar_seed_data"
_EVIDENCE = _SEED / "evidence_sections.jsonl"
_CACHE = _SEED / "cache"

# Controlled EDGAR ontology slice. The extractor REJECTS any class/relation outside this set.
EDGAR_ALLOWED_CLASSES = [
    "Organization", "Person", "GovernmentAgency", "Program", "Product", "Technology",
    "Facility", "Geography", "Market", "FinancialInstrument", "Issuer",
]
EDGAR_ALLOWED_RELATIONS = [
    "SUPPLIES", "CUSTOMER_OF", "PARTNERS_WITH", "CONTRACTED_BY", "DEVELOPS", "OPERATES",
    "PARTICIPATES_IN", "REGULATED_BY", "LOCATED_IN", "DEPENDS_ON", "MANUFACTURES", "USES",
    "HAS_RISK_EXPOSURE",
]
EDGAR_RELATION_PATTERNS = [
    "Organization SUPPLIES Organization", "Organization CUSTOMER_OF Organization",
    "Organization REGULATED_BY GovernmentAgency", "Organization DEVELOPS Product",
    "Organization OPERATES Facility", "Organization PARTNERS_WITH Organization",
    "Organization HAS_RISK_EXPOSURE Market",
]


def _load_sections() -> list[dict]:
    return [json.loads(line) for line in _EVIDENCE.read_text(encoding="utf-8").splitlines() if line.strip()]


def _raw_text(sec: dict) -> str:
    # Use the cached rawText (retains paragraph structure for deterministic unit segmentation);
    # the durable normalizedText is whitespace-collapsed and would be one giant unit.
    cache = _CACHE / f"{sec['accessionNumber'].replace('/', '_')}__{sec['sectionItemId']}.json"
    if cache.exists():
        return str(json.loads(cache.read_text(encoding="utf-8")).get("rawText", ""))
    return str(sec.get("normalizedText", ""))


def _bound_paras(text: str, max_paras: int) -> str:
    if not max_paras or max_paras <= 0:
        return text
    blocks = [b for b in re.split(r"\n\s*\n", text) if b.strip()]
    return "\n\n".join(blocks[:max_paras])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sections", type=int, default=0, help="limit number of evidence sections (0 = all 29)")
    ap.add_argument("--paras", type=int, default=0, help="cap paragraphs per section (0 = full section)")
    ap.add_argument("--model", type=str, default="local-gemma",
                    help="extraction model: 'local-gemma' or 'openrouter:<slug>' (e.g. openrouter:moonshotai/kimi-k2.6)")
    args = ap.parse_args()

    call_fn = None
    model_label = "local-gemma"
    if args.model and args.model != "local-gemma":
        if not args.model.startswith("openrouter:"):
            print(f"[edgar-extract] unsupported --model {args.model!r}; use local-gemma or openrouter:<slug>")
            return 2
        slug = args.model.split(":", 1)[1]
        call_fn = _agent_card_call_fn("openrouter", slug)
        model_label = slug
    # Distinct run per model so a stronger model's output never collides with the gemma run.
    run_id = f"edgar_core_graph::{_model_tag(model_label)}"

    sections = _load_sections()
    if args.sections > 0:
        sections = sections[: args.sections]

    materials: list[gge.SourceMaterial] = []
    for sec in sections:
        text = _bound_paras(_raw_text(sec), args.paras)
        if not text.strip():
            continue
        ref = f"{sec['accessionNumber']}__{sec['sectionItemId']}"
        materials.append(gge.SourceMaterial(
            text=text, source_ref=ref, source_url=sec["originalSecFilingUrl"],
            source_title=f"{sec['issuer']} {sec['formType']} item {sec['sectionItemId']}"))

    slice_ = gge.OntologySlice(
        target_graph="knowgraph",
        allowed_classes=list(EDGAR_ALLOWED_CLASSES),
        allowed_relations=list(EDGAR_ALLOWED_RELATIONS),
        allowed_relation_patterns=list(EDGAR_RELATION_PATTERNS),
        known_entity_anchors=sorted({s["issuer"] for s in sections}),
    )

    built = gge.extract_material_to_delta(
        project_id=PROJECT, run_id=run_id,
        research_summary="EDGAR core-seed entity/relation extraction over cached 10-K/10-Q sections.",
        project_consequence="Durable source-backed entities and reified relation assertions from EDGAR evidence.",
        ontology_slice=slice_, materials=materials, call_fn=call_fn)
    delta = built["delta"]
    print(f"[edgar-extract] model={model_label} run_id={run_id}")
    print(f"[edgar-extract] materials={len(materials)} physical_units={built['physical_units']} totals={built['totals']}")
    print(f"[edgar-extract] delta assertions={len(delta.assertions)} observations={len(delta.observations)}")

    validation = rmd.validate_delta(delta)
    if not validation.ok:
        print(f"[edgar-extract] delta_invalid: {validation.errors}")
        return 2

    driver, config = av._connect_live()
    db = config["database"]
    try:
        kg = rmd.write_knowgraph_external(driver, delta, validation=validation, database=db)
        rows = rmd.read_knowgraph_external(driver, PROJECT, run_id, database=db)
    finally:
        driver.close()

    print(f"[edgar-extract] persisted knowgraph: assertions={len(kg.get('assertion_ids', []))} "
          f"sources={len(kg.get('source_refs', []))}")
    print(f"[edgar-extract] read-back assertions={len(rows)}")
    for r in rows[:10]:
        print(f"  [{r['outcome']}] {r['subject']} {r['predicate']} {r['object']} "
              f"ref={r['source_ref']} ev={(r['evidence_text'] or '')[:60]!r}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
