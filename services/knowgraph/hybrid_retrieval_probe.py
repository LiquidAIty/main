"""Bounded live probe for the canonical, read-only KnowGraph doorway."""

from __future__ import annotations

import argparse
import sys

import hybrid_retrieval as hr


def _content_count(driver, database: str | None) -> int:
    records, _, _ = driver.execute_query(
        "MATCH (n) WHERE NOT n:__Migration RETURN count(n) AS n",
        database_=database,
    )
    return int(records[0]["n"])


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Canonical KnowGraph retrieval live probe")
    parser.add_argument("--project-id", required=True)
    parser.add_argument("--anchors", nargs="+", default=[])
    parser.add_argument("--query", required=True)
    parser.add_argument("--max-results", type=int, default=12)
    args = parser.parse_args(argv)

    try:
        hr.assert_all_read_only()
        driver, config = hr._connect_live()
    except Exception as exc:
        print(f"RESULT=FAILED blocker=connect_or_contract {exc}")
        return 2

    try:
        before = _content_count(driver, config["database"])
        result = hr.retrieve_knowgraph_context(
            hr.KnowGraphRetrievalRequest(
                project_id=args.project_id,
                query=args.query,
                anchors=args.anchors,
                max_results=args.max_results,
            ),
            driver=driver,
            database=config["database"],
        )
        after = _content_count(driver, config["database"])
    except Exception as exc:
        print(f"RESULT=FAILED blocker=canonical_retrieval {exc}")
        return 2
    finally:
        driver.close()

    checks = [
        ("read-only execution", before == after),
        ("structured state", result.retrieval_state in {"evidence", "empty"}),
        ("bounded results", len(result.assertions) <= args.max_results),
        ("chunk vector channel", result.retrieval_modes.get("vector") is True),
        ("knowledge assertion fulltext channel", result.retrieval_modes.get("fulltext") is True),
        ("OpenRouter embedding model", hr.EMBEDDING_MODEL == "openai/text-embedding-3-large"),
        ("3072 dimensions", hr.EMBEDDING_DIMENSIONS == 3072),
        (
            "canonical provenance",
            all(a.get("assertion_id") and a.get("chunk_refs") and a.get("document_id") for a in result.assertions),
        ),
    ]
    print("[probe] " + " | ".join(result.retrieval_notes))
    for name, ok in checks:
        print(f"[probe] verify: {'PASS' if ok else 'FAIL'} {name}")
    if all(ok for _, ok in checks):
        print(f"RESULT=CANONICAL_KNOWGRAPH_RETRIEVAL_{result.retrieval_state.upper()}")
        return 0
    print("RESULT=FAILED")
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
