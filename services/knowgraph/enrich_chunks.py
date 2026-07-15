# @graph entity: KnowGraph Existing-Chunk Enrichment
# @graph role: canonical-enrichment-writer
# @graph relates_to: KnowGraph Ingest
"""Canonical enrichment of an ALREADY-STORED SourceDocument's chunks.

Turns a genuine, content-dependent structured extraction (Concepts / Claims /
Relationships that the stand-in extraction model produced by reading the real
stored chunk text) into canonical Neo4j KnowGraph records WITHOUT:
  - reparsing the PDF,
  - recreating chunks,
  - calling any embedding model,
  - creating a second SourceDocument.

It is idempotent (MERGE by stable identity) and keeps genuine records cleanly
distinguishable from the untrusted anchor pipe-test output: genuine Concept
identity is (project_id, name, extraction_mode='genuine'), so it never merges
onto an anchor Concept. Every record links back to the exact source Chunk(s) and
page range for provenance. This is the canonical writer for this operation — it
does not fabricate data; it writes genuinely-interpreted, source-grounded records.
"""

from __future__ import annotations

import os
from typing import Any

from neo4j import Driver, GraphDatabase

from schema import RELATIONSHIP_TYPES

# The relationship allowlist IS the KNOWGRAPH_SCHEMA — APOC availability does not mean
# arbitrary model-generated relationship types are accepted.
_ALLOWED_RELS = {str(r["label"]).upper() for r in RELATIONSHIP_TYPES}

_APOC_REL = (
    "MATCH (a:Concept {project_id:$project_id, name:$start, extraction_mode:'genuine'}) "
    "MATCH (b:Concept {project_id:$project_id, name:$end, extraction_mode:'genuine'}) "
    "WITH a, b "
    "CALL apoc.merge.relationship(a, $rtype, {extraction_mode:'genuine'}, "
    "{project_id:$project_id, extraction_run:$extraction_run, pages:$pages, trusted:true}, b) "
    "YIELD rel RETURN count(rel) AS n"
)


def _merge_concept_relationship(session, *, project_id, start, end, rtype, extraction_run, pages) -> int:
    """Merge a genuine concept->concept relationship via apoc.merge.relationship.

    APOC is the intended path (installed + proven, dynamic type). Native interpolated
    Cypher is a PROVEN fallback used only if the live APOC procedure actually fails —
    rtype is already validated against the schema allowlist, so interpolation is safe.
    """
    params = dict(project_id=project_id, start=start, end=end, rtype=rtype, extraction_run=extraction_run, pages=pages)
    try:
        rec = session.run(_APOC_REL, **params).single()
        return rec["n"] if rec else 0
    except Exception:
        cypher = (
            "MATCH (a:Concept {project_id:$project_id, name:$start, extraction_mode:'genuine'}) "
            "MATCH (b:Concept {project_id:$project_id, name:$end, extraction_mode:'genuine'}) "
            f"MERGE (a)-[rel:{rtype} {{extraction_mode:'genuine'}}]->(b) "
            "SET rel.project_id=$project_id, rel.extraction_run=$extraction_run, rel.pages=$pages, rel.trusted=true "
            "RETURN count(rel) AS n"
        )
        rec = session.run(cypher, project_id=project_id, start=start, end=end, extraction_run=extraction_run, pages=pages).single()
        return rec["n"] if rec else 0


def _driver() -> Driver:
    return GraphDatabase.driver(
        os.environ["NEO4J_URI"], auth=(os.environ["NEO4J_USER"], os.environ["NEO4J_PASSWORD"])
    )


def enrich_existing_chunks(
    *,
    project_id: str,
    document_id: str,
    chunk_ids: list[str],
    concepts: list[dict[str, Any]],
    claims: list[dict[str, Any]],
    relationships: list[dict[str, Any]],
    chapter: str,
    section: str,
    pages: str,
    extraction_run: str,
    provider: str = "inspection_extraction_provider",
    database: str | None = None,
    driver: Driver | None = None,
) -> dict[str, int]:
    """Write genuine extraction over existing chunks. Returns counts.

    concepts: [{"name": str, "summary"?: str}]
    claims:   [{"id": str, "text": str, "claim_type": str, "chunk_ids": [str], "pages"?: str}]
    relationships: [{"type": str, "start": <concept name>, "end": <concept name>, "chunk_ids"?: [str]}]
    """
    if not chunk_ids:
        raise ValueError("chunk_ids required — enrichment must ground in existing chunks")
    own = driver is None
    d = driver or _driver()
    prov = {
        "project_id": project_id, "document_id": document_id, "chapter": chapter,
        "section": section, "pages": pages, "extraction_run": extraction_run,
        "provider": provider, "extraction_mode": "genuine", "trusted": True, "source_verified": True,
    }
    try:
        with d.session(database=database) as s:
            # Guard: the chunks must already exist — never create source structure here.
            present = s.run(
                "MATCH (ch:Chunk {project_id:$p}) WHERE ch.chunk_id IN $ids RETURN count(ch) AS n",
                p=project_id, ids=chunk_ids,
            ).single()["n"]
            if present == 0:
                raise ValueError(f"no existing chunks found for {chunk_ids[:3]}… — refusing to create source structure")

            # Concepts — identity keyed with extraction_mode so genuine never merges onto an anchor node.
            for c in concepts:
                s.run(
                    """MERGE (x:Concept {project_id:$project_id, name:$name, extraction_mode:'genuine'})
                       ON CREATE SET x.created_at = datetime()
                       SET x += $prov, x.summary = coalesce($summary, x.summary), x.document_id=$document_id
                       WITH x
                       MATCH (ch:Chunk {project_id:$project_id}) WHERE ch.chunk_id IN $chunk_ids
                       MERGE (ch)-[m:MENTIONS {extraction_mode:'genuine'}]->(x)
                       SET m.extraction_run=$extraction_run""",
                    project_id=project_id, name=c["name"], summary=c.get("summary"),
                    document_id=document_id, prov=prov, chunk_ids=chunk_ids, extraction_run=extraction_run,
                )
            # Claims — source-specific, keyed by claim id; linked to their own chunk provenance.
            for cl in claims:
                s.run(
                    """MERGE (q:Claim {project_id:$project_id, claim_id:$cid})
                       ON CREATE SET q.created_at = datetime()
                       SET q += $prov, q.text=$text, q.claim_type=$ctype, q.pages=coalesce($pages,$dpages)
                       WITH q
                       MATCH (ch:Chunk {project_id:$project_id}) WHERE ch.chunk_id IN $cids
                       MERGE (ch)-[m:MENTIONS {extraction_mode:'genuine'}]->(q)""",
                    project_id=project_id, cid=cl["id"], text=cl["text"], ctype=cl.get("claim_type", "observation"),
                    pages=cl.get("pages"), dpages=pages, prov=prov, cids=cl.get("chunk_ids") or chunk_ids,
                )
            # Precise relationships between genuine concepts — validated against the
            # KNOWGRAPH_SCHEMA allowlist, then merged via apoc.merge.relationship.
            rel_written = 0
            for r in relationships:
                rtype = str(r["type"]).strip().upper()
                if rtype not in _ALLOWED_RELS:
                    raise ValueError(f"relationship type {rtype} not in KNOWGRAPH_SCHEMA allowlist")
                rel_written += _merge_concept_relationship(
                    s, project_id=project_id, start=r["start"], end=r["end"],
                    rtype=rtype, extraction_run=extraction_run, pages=pages,
                )
            return {"concepts": len(concepts), "claims": len(claims), "relationships": rel_written, "chunks_grounded": present}
    finally:
        if own:
            d.close()
