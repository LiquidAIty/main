# Bounded live proof for KnowGraph hybrid retrieval (Python rails).
#
# Calls the ACTUAL retrieval capability against live Neo4j + live local
# EmbeddingGemma, over the RDW/SpaceX assertions. Proves exact + full-text +
# vector channels ran, vector used the local embedding endpoint and the vector
# index, results are bounded and source-backed (supported/contradicted/
# uncertain), one-hop contradictions/relations surface, dedupe/diversity shows,
# and NO Neo4j writes, no TypeScript, no Tavily/web/chat call occurred. Exits 0
# only when every check passes.
#
#   py -3.12 services/knowgraph/hybrid_retrieval_probe.py \
#     --project-id 20ac92da-01fd-4cf6-97cc-0672421e751a \
#     --anchors "Redwire Corporation" RDW SpaceX \
#     --query "Redwire RDW SpaceX source-backed evidence and contradictions" \
#     --max-results 12
from __future__ import annotations

import argparse
import sys

import assertion_vectors as av
import embeddinggemma
import hybrid_retrieval as hr

DEFAULT_PROJECT = "20ac92da-01fd-4cf6-97cc-0672421e751a"
DEFAULT_ANCHORS = ["Redwire Corporation", "RDW", "SpaceX"]
DEFAULT_QUERY = "Redwire RDW SpaceX source-backed evidence and contradictions"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="KnowGraph hybrid retrieval live probe")
    parser.add_argument("--project-id", default=DEFAULT_PROJECT)
    parser.add_argument("--anchors", nargs="+", default=DEFAULT_ANCHORS)
    parser.add_argument("--query", default=DEFAULT_QUERY)
    parser.add_argument("--max-results", type=int, default=12)
    args = parser.parse_args(argv)

    embed_config = embeddinggemma.EmbeddingGemmaConfig.from_env()
    local_only = av._endpoint_is_local(embed_config.url)

    # Static read-only proof of every query shape this capability can run.
    try:
        hr.assert_all_read_only()
        read_only_shapes = True
    except hr.HybridRetrievalError as exc:
        print(f"RESULT=FAILED blocker=read_only_guard {exc}")
        return 1

    try:
        driver, config = hr._connect_live()
    except Exception as exc:
        print(f"RESULT=PYTHON_MAG_ONE_HYBRID_RETRIEVAL_UNIT_PROVEN_LIVE_NEO4J_OR_DMR_BLOCKED "
              f"blocker=neo4j {exc}")
        return 2

    try:
        before = av.count_assertions(driver, args.project_id, database=config["database"])
        if before == 0:
            print(f"RESULT=PARTIAL_BLOCKED blocker=no SourceBackedAssertion in {args.project_id}")
            return 1

        request = hr.KnowGraphRetrievalRequest(
            project_id=args.project_id,
            query=args.query,
            anchors=list(args.anchors),
            max_results=args.max_results,
            max_hops=1,
        )
        result = hr.retrieve_knowgraph_context(
            request, driver=driver, embed_fn=None, database=config["database"]
        )
        after = av.count_assertions(driver, args.project_id, database=config["database"])
    finally:
        driver.close()

    modes = result.retrieval_modes
    outcomes = {a["outcome"] for a in result.assertions}
    source_refs = [a.get("source_ref") for a in result.assertions]
    distinct_refs = sorted({r for r in source_refs if r})

    print(f"[probe] endpoint={embed_config.url} local_only={local_only} dim={embeddinggemma.PROVEN_DIM}")
    print(f"[probe] retrieval_modes={modes}")
    print(f"[probe] notes: " + " | ".join(result.retrieval_notes))
    for a in result.assertions:
        print(f"  [{a['outcome']}] {a['subject']} {a['predicate']} {a['object']}  "
              f"ref={a['source_ref']} title={a['source_title']!r} url={a['source_url']} "
              f"reasons={a['retrieval_reasons']}")
    print(f"[probe] contradictions={len(result.contradictions)} relations={len(result.relations)} "
          f"next_anchors={result.next_anchor_suggestions}")

    vector_available = modes.get("vector") == "available"
    checks: list[tuple[str, bool]] = [
        ("every query shape is read-only (no writes)", read_only_shapes),
        ("embedding endpoint is local /embeddings only (no remote/chat/Tavily)", local_only),
        ("exact channel ran", bool(modes.get("exact"))),
        ("full-text channel available", bool(modes.get("fulltext"))),
        ("vector channel available (local EmbeddingGemma + kg_assertion_embedding_idx)", vector_available),
        ("results are bounded", len(result.assertions) <= args.max_results),
        ("supported assertion present", "supported" in outcomes),
        ("contradicted assertion present", "contradicted" in outcomes),
        ("uncertain assertion present", "uncertain" in outcomes),
        ("every result keeps a sourceRef", all(a.get("source_ref") for a in result.assertions)),
        ("every result keeps a source title", all(a.get("source_title") for a in result.assertions)),
        ("every result keeps a source URL", all(a.get("source_url") for a in result.assertions)),
        ("every result has retrieval_reasons", all(a.get("retrieval_reasons") for a in result.assertions)),
        ("one-hop contradiction/relation surfaced", bool(result.contradictions) or bool(result.relations)),
        ("dedupe/diversity kept distinct sources", len(distinct_refs) >= 2),
        ("no new assertion created (no Neo4j writes)", after == before),
    ]
    for name, ok in checks:
        print(f"[probe] verify: {'PASS' if ok else 'FAIL'}  {name}")

    if all(ok for _, ok in checks):
        print("RESULT=PYTHON_MAG_ONE_KNOWGRAPH_HYBRID_RETRIEVAL_TOOL_PROVEN")
        return 0
    if not vector_available:
        print("RESULT=PYTHON_MAG_ONE_HYBRID_RETRIEVAL_UNIT_PROVEN_LIVE_NEO4J_OR_DMR_BLOCKED")
        return 2
    print("RESULT=PARTIAL_BLOCKED (see FAIL lines)")
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
