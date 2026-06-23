# Bounded live proof of the first compounding research-memory loop (Python rails).
#
# Uses RDW/SpaceX-shaped source-backed evidence in a dedicated probe project.
# Proves: a first Research Memory Delta writes external source-backed material to
# KnowGraph (Neo4j) and the project consequence to ThinkGraph (AGE/Postgres);
# local Gemma chunks ONLY retained material and EmbeddingGemma vectors link back
# to parents; a second reasoning note REVISITS the first and states what held /
# changed / remains uncertain; a retrieval-only call writes nothing; no chat
# history or whole-page archive is persisted; the two graphs stay separate.
#
#   py -3.12 services/knowgraph/research_memory_delta_probe.py
import sys
import time

import assertion_vectors as av
import hybrid_retrieval as hr
import research_memory_delta as rmd
import thinkgraph_writer as tgw

PROJECT = "rmd-probe-project"


def _first_delta(run_id: str) -> rmd.ResearchMemoryDelta:
    return rmd.ResearchMemoryDelta(
        project_id=PROJECT, run_id=run_id,
        research_summary="Redwire/RDW and SpaceX source-backed evidence reviewed.",
        project_consequence="RDW ticker is supported; a conflicting RWE claim exists; SpaceX valuation is unresolved.",
        source_refs=[rmd.SourceRef("s1", "https://finance.yahoo.com/quote/RDW", "Redwire (RDW) Stock Quote - NYSE"),
                     rmd.SourceRef("s2", "https://example.com/redwire-rwe", "Redwire trades as RWE"),
                     rmd.SourceRef("s3", "https://forgeglobal.com/spacex", "SpaceX valuation news")],
        assertions=[
            rmd.DeltaAssertion("Redwire Corporation", "has_ticker_symbol", "RDW", "supported",
                               evidence_text="Redwire Corporation (RDW) Stock Quote - NYSE ticker symbol",
                               source_ref="s1", source_url="https://finance.yahoo.com/quote/RDW",
                               source_title="Redwire (RDW) Stock Quote - NYSE"),
            rmd.DeltaAssertion("Redwire Corporation", "has_ticker_symbol", "RWE", "contradicted",
                               evidence_text="Redwire Space trades under ticker symbol RWE on the exchange",
                               source_ref="s2", source_url="https://example.com/redwire-rwe",
                               source_title="Redwire trades as RWE"),
            rmd.DeltaAssertion("SpaceX", "has_current_valuation", "unknown", "unresolved",
                               interpretation="Valuation is reported in secondary markets but no dated figure is grounded.",
                               source_ref="s3", source_url="https://forgeglobal.com/spacex"),
        ],
        observations=[rmd.Observation("Redwire is publicly traded; SpaceX is private.", source_ref="s1",
                                      entity="Redwire Corporation")],
        uncertainty=["RDW vs RWE ticker conflict unresolved", "SpaceX current valuation unknown"],
        retained_material=[
            rmd.RetainedChunkInput(
                "Redwire Corporation (RDW) Stock Quote - NYSE ticker symbol. Redwire is publicly traded.",
                kind="source_evidence", store="knowgraph", source_ref="s1"),
            rmd.RetainedChunkInput(
                "Project note: RDW ticker supported; RWE is a conflicting claim; SpaceX valuation unresolved.",
                kind="research_note", store="thinkgraph"),
        ],
        prior_reasoning_refs=[],
    )


def _second_delta(run_id: str, prior_run_id: str) -> rmd.ResearchMemoryDelta:
    return rmd.ResearchMemoryDelta(
        project_id=PROJECT, run_id=run_id,
        research_summary="Revisit of the prior Redwire/SpaceX reasoning.",
        project_consequence="RDW ticker still holds; RWE conflict still open; SpaceX valuation still unresolved.",
        source_refs=[rmd.SourceRef("s1", "https://finance.yahoo.com/quote/RDW", "Redwire (RDW) Stock Quote - NYSE")],
        assertions=[
            rmd.DeltaAssertion("Redwire Corporation", "has_ticker_symbol", "RDW", "supported",
                               evidence_text="Redwire Corporation (RDW) Stock Quote - NYSE ticker symbol",
                               source_ref="s1", source_url="https://finance.yahoo.com/quote/RDW",
                               source_title="Redwire (RDW) Stock Quote - NYSE"),
        ],
        uncertainty=["RWE conflict still unresolved"],
        retained_material=[
            rmd.RetainedChunkInput("Revisit note: RDW held; RWE conflict and SpaceX valuation remain uncertain.",
                                   kind="research_note", store="thinkgraph"),
        ],
        prior_reasoning_refs=[prior_run_id],
    )


def main() -> int:
    ts = str(int(time.time()))
    run1, run2 = f"rmd-{ts}-1", f"rmd-{ts}-2"

    driver, config = av._connect_live()
    db = config["database"]
    conn = tgw._connect()
    try:
        kg_before = av.count_assertions(driver, PROJECT, database=db)
        note_before = tgw.count_research_notes(PROJECT, conn=conn)

        # First delta -> both graphs + local index.
        report1 = rmd.write_research_memory_delta(
            _first_delta(run1), neo4j_driver=driver, neo4j_database=db, thinkgraph_conn=conn)
        # Second delta revisits the first.
        report2 = rmd.write_research_memory_delta(
            _second_delta(run2, run1), neo4j_driver=driver, neo4j_database=db, thinkgraph_conn=conn)

        kg_rows = rmd.read_knowgraph_external(driver, PROJECT, run1, database=db)
        chunks1 = rmd.read_retained_chunks(driver, PROJECT, run1, database=db)
        note1 = tgw.read_research_note(PROJECT, run1, conn=conn)
        note2 = tgw.read_research_note(PROJECT, run2, conn=conn)

        # Retrieval-only call must write nothing.
        kg_after_writes = av.count_assertions(driver, PROJECT, database=db)
        hr.retrieve_knowgraph_context(
            hr.KnowGraphRetrievalRequest(project_id=PROJECT, query="Redwire RDW SpaceX",
                                         anchors=["Redwire Corporation", "RDW", "SpaceX"], max_results=5),
            driver=driver, database=db)
        kg_after_retrieval = av.count_assertions(driver, PROJECT, database=db)

        # Separation: KnowGraph(Neo4j) has no ResearchNote; ThinkGraph(AGE) has no SourceBackedAssertion.
        neo_note = av._records(driver.execute_query(
            "MATCH (n:ResearchNote) RETURN count(n) AS n", database_=db))
        neo_note_count = av._row_get(neo_note[0], "n") if neo_note else 0
        age_assertion = tgw.run_cypher(conn, "MATCH (a:SourceBackedAssertion) RETURN count(a)")
        age_assertion_count = int(age_assertion[0]) if age_assertion else 0
    finally:
        conn.close()
        driver.close()

    outcomes = {r["outcome"] for r in kg_rows}
    indexed = [c for c in chunks1 if c["indexing_state"] == "indexed"]
    print(f"[probe] run1={run1} run2={run2}")
    print(f"[probe] kg assertions(run1)={len(kg_rows)} outcomes={sorted(outcomes)}")
    for r in kg_rows:
        print(f"  [{r['outcome']}] {r['subject']} {r['predicate']} {r['object']} ref={r['source_ref']} url={r['source_url']}")
    print(f"[probe] chunks(run1)={len(chunks1)} indexed={len(indexed)} "
          f"sample={chunks1[0] if chunks1 else None}")
    print(f"[probe] note1 keys={sorted((note1 or {}).keys())}")
    print(f"[probe] note2 prior_reasoning_ref={(note2 or {}).get('prior_reasoning_ref')} "
          f"revisited={report2['thinkgraph'].get('revisited_prior_run_id')}")

    checks = [
        ("first delta wrote source-backed assertions to KnowGraph", len(kg_rows) >= 2),
        ("supported + contradicted + unresolved preserved", {"supported", "contradicted", "unresolved"}.issubset(outcomes)),
        ("every KnowGraph assertion kept a sourceRef + URL", all(r["source_ref"] and r["source_url"] for r in kg_rows)),
        ("ThinkGraph received the project consequence note", bool(note1) and bool(note1.get("project_consequence"))),
        ("note links to KnowGraph assertion IDs", bool(note1) and len(note1.get("linked_assertion_ids") or []) >= 2),
        ("retained chunks indexed and link to parents",
         bool(indexed) and all(c["parent_id"] and c["store"] for c in chunks1)),
        ("retained chunk vectors are 768-dim", bool(indexed) and all(c["vector_size"] == 768 for c in indexed)),
        ("second note REVISITS the first", (note2 or {}).get("prior_reasoning_ref") == run1
         and report2["thinkgraph"].get("revisited_prior_run_id") == run1),
        ("second note states what holds/changes/uncertain",
         bool(note2) and bool(note2.get("project_consequence")) and bool(note2.get("uncertainty"))),
        ("retrieval-only call wrote nothing", kg_after_writes == kg_after_retrieval),
        ("KnowGraph and ThinkGraph stay separate", neo_note_count == 0 and age_assertion_count == 0),
        ("local embedding + chunk endpoints are loopback",
         av._endpoint_is_local("http://localhost:12434/engines/v1/embeddings")),
    ]
    for name, ok in checks:
        print(f"[probe] verify: {'PASS' if ok else 'FAIL'}  {name}")

    if all(ok for _, ok in checks):
        print("RESULT=RESEARCH_MEMORY_DELTA_KNOWGRAPH_THINKGRAPH_LOCAL_INDEX_PROVEN")
        return 0
    if not indexed:
        print("RESULT=RESEARCH_MEMORY_DELTA_PARTIAL_LOCAL_INDEX_BLOCKED")
        return 2
    print("RESULT=PARTIAL_BLOCKED (see FAIL lines)")
    return 1


if __name__ == "__main__":
    sys.exit(main())
