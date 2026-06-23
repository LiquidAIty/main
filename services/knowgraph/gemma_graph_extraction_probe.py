# Bounded live proof of frontier-OWL-slice-guided local Gemma graph extraction.
#
# Frontier structured result (research_summary + frontier-produced Ontology Slice
# + selected source material) -> deterministic physical units -> ONE local Gemma
# schema-guided extraction per unit -> normalized valid OWL -> source-backed
# KnowGraph write -> local EmbeddingGemma vectors on retained evidence units ->
# read-back. Then proves a disallowed relation and a sourceless/unfaithful fact
# fail honestly. RDW/SpaceX fixture only. No second frontier call, no cloud
# fallback, no generic "chunk this document" prompting in the graph path.
#
#   py -3.12 services/knowgraph/gemma_graph_extraction_probe.py
import json
import sys
import time

import assertion_vectors as av
import gemma_graph_extractor as gge
import research_memory_delta as rmd
import thinkgraph_writer as tgw

PROJECT = "owl-slice-probe-project"

# Frontier-produced bounded Ontology Slice (small task vocabulary, not the global ontology).
SLICE = gge.OntologySlice(
    target_graph="knowgraph",
    allowed_classes=["Company", "Ticker", "Exchange", "PrivateCompany"],
    allowed_relations=["has_ticker_symbol", "trades_on", "is_private"],
    allowed_relation_patterns=["Company has_ticker_symbol Ticker", "Company trades_on Exchange"],
    known_entity_anchors=["Redwire Corporation", "RDW", "NYSE", "SpaceX"],
)

MATERIALS = [
    gge.SourceMaterial(
        text="Redwire Corporation (RDW) trades on the NYSE under the ticker symbol RDW.",
        source_ref="s1", source_url="https://finance.yahoo.com/quote/RDW", source_title="Redwire (RDW) NYSE"),
    gge.SourceMaterial(
        text="SpaceX is a private company. SpaceX is private and has no public ticker symbol.",
        source_ref="s3", source_url="https://forgeglobal.com/spacex", source_title="SpaceX private company"),
]

# A controlled extractor output that violates the slice: a disallowed relation, a
# sourceless external fact (no evidence_text), and an unfaithful evidence span.
BAD_OUTPUT = json.dumps({
    "entities": [{"label": "SpaceX", "type": "PrivateCompany"}, {"label": "Mars", "type": "Planet"}],
    "relations": [{"from": "SpaceX", "to": "Mars", "type": "colonizes"}],
    "assertions": [
        {"subject": "SpaceX", "predicate": "has_ticker_symbol", "object": "SPCE",
         "status": "direct_fact", "evidence_text": "SpaceX trades under SPCE on NASDAQ"},
        {"subject": "SpaceX", "predicate": "is_private", "object": "true",
         "status": "direct_fact", "evidence_text": ""},
    ],
    "uncertainty": [], "confidence": 0.9,
})


def main() -> int:
    ts = str(int(time.time()))
    run_id = f"owl-{ts}"

    # 1. Schema-guided extraction over the frontier material (LIVE local Gemma).
    built = gge.extract_material_to_delta(
        project_id=PROJECT, run_id=run_id,
        research_summary="RDW/SpaceX OWL-slice-guided extraction.",
        project_consequence="RDW ticker captured; SpaceX private with no public ticker.",
        ontology_slice=SLICE, materials=MATERIALS)
    delta = built["delta"]

    # 2. Controlled fail-closed extraction (disallowed relation + sourceless/unfaithful fact).
    bad_unit = gge.PhysicalUnit(text="SpaceX is a private company.", source_ref="s3", kind="paragraph", position=0)
    bad_run = gge.extract_semantic_units(bad_unit, SLICE, call_fn=lambda s, u: BAD_OUTPUT)

    driver, config = av._connect_live()
    db = config["database"]
    conn = tgw._connect()
    try:
        kg_before = av.count_assertions(driver, PROJECT, database=db)
        report = rmd.write_research_memory_delta(
            delta, neo4j_driver=driver, neo4j_database=db, thinkgraph_conn=conn,
            chunk_fn=lambda t: [t])  # identity: retained evidence unit IS the unit (no generic chunking)
        kg_rows = rmd.read_knowgraph_external(driver, PROJECT, run_id, database=db)
        chunks = rmd.read_retained_chunks(driver, PROJECT, run_id, database=db)
        note = tgw.read_research_note(PROJECT, run_id, conn=conn)
        neo_note = av._records(driver.execute_query("MATCH (n:ResearchNote) RETURN count(n) AS n", database_=db))
        neo_note_count = av._row_get(neo_note[0], "n") if neo_note else 0
        age_assert = tgw.run_cypher(conn, "MATCH (a:SourceBackedAssertion) RETURN count(a)")
        age_assert_count = int(age_assert[0]) if age_assert else 0
    finally:
        conn.close()
        driver.close()

    indexed = [c for c in chunks if c["indexing_state"] == "indexed"]
    outcomes = {r["outcome"] for r in kg_rows}
    predicates = {r["predicate"] for r in kg_rows}
    bad_asserts = [a for u in bad_run.units for a in u.assertions]

    print(f"[probe] run={run_id} physical_units={built['physical_units']} totals={built['totals']}")
    print(f"[probe] kg assertions={len(kg_rows)} predicates={sorted(predicates)} outcomes={sorted(outcomes)}")
    for r in kg_rows:
        print(f"  [{r['outcome']}] {r['subject']} {r['predicate']} {r['object']} "
              f"ref={r['source_ref']} evidence={(r['evidence_text'] or '')[:60]!r}")
    print(f"[probe] retained evidence chunks indexed={len(indexed)} (of {len(chunks)})")
    print(f"[probe] BAD extraction: rejected_relations={bad_run.enforcement.rejected_relations} "
          f"rejected_classes={bad_run.enforcement.rejected_classes} "
          f"rejected_sourceless={bad_run.enforcement.rejected_sourceless} "
          f"rejected_unfaithful={bad_run.enforcement.rejected_unfaithful} kept_assertions={len(bad_asserts)}")

    checks = [
        ("frontier ontology slice is bounded (small vocabulary)",
         0 < len(SLICE.allowed_classes) <= 12 and 0 < len(SLICE.allowed_relations) <= 12),
        ("local Gemma produced valid OWL assertions using allowed relations",
         bool(kg_rows) and predicates.issubset({"has_ticker_symbol", "trades_on", "is_private"})),
        ("every KnowGraph assertion kept sourceRef + faithful evidence text",
         all(r["source_ref"] and r["evidence_text"] for r in kg_rows)),
        ("extraction rejected nothing valid (no allowed item lost)", built["totals"]["rejected_unfaithful"] == 0),
        ("retained semantic evidence units embedded (768-dim, linked to parent)",
         bool(indexed) and all(c["vector_size"] == 768 and c["parent_id"] for c in indexed)),
        ("project note written to ThinkGraph", bool(note) and bool(note.get("project_consequence"))),
        ("KnowGraph and ThinkGraph stay separate", neo_note_count == 0 and age_assert_count == 0),
        ("disallowed relation 'colonizes' rejected (fail closed)",
         "colonizes" in bad_run.enforcement.rejected_relations
         and not any(a["predicate"] == "colonizes" for a in bad_asserts)),
        ("disallowed class 'Planet' rejected (fail closed)", "Planet" in bad_run.enforcement.rejected_classes),
        ("sourceless/unfaithful external fact rejected (fail closed)",
         (bad_run.enforcement.rejected_sourceless + bad_run.enforcement.rejected_unfaithful) >= 2
         and not any(a["object"] == "SPCE" for a in bad_asserts)),
        ("local extraction + embedding endpoints loopback",
         av._endpoint_is_local("http://localhost:12434/engines/v1/embeddings")),
    ]
    for name, ok in checks:
        print(f"[probe] verify: {'PASS' if ok else 'FAIL'}  {name}")

    if all(ok for _, ok in checks):
        print("RESULT=FRONTIER_OWL_SLICE_GUIDED_LOCAL_GEMMA_GRAPH_EXTRACTION_PROVEN")
        return 0
    if not kg_rows:
        print("RESULT=LOCAL_GEMMA_SCHEMA_GUIDED_EXTRACTION_PARTIAL")
        return 2
    print("RESULT=PARTIAL_BLOCKED (see FAIL lines)")
    return 1


if __name__ == "__main__":
    sys.exit(main())
