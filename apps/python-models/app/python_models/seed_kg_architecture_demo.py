"""Versioned, removable ThinkGraph demo for LiquidAIty graph architecture.

This is explicit seeded test reasoning, not accumulated production memory.  It
writes only the dedicated Engraphis workspace below through ThinkGraphEngraphis.
KnowGraph and CodeGraph references are pointers discovered and verified during
the seed's authoring run; neither authority is mutated here.
"""
from __future__ import annotations

import argparse
from collections import Counter
import json
from typing import Any, Iterable

from engraphis.service import MemoryService

from app.python_models.thinkgraph_engraphis import ThinkGraphEngraphis, get_thinkgraph


DEMO_PROJECT_ID = "20ac92da-01fd-4cf6-97cc-0672421e751a"
LEGACY_DEMO_PROJECT_ID = "7c624bf5-838a-4c33-99e1-083001bb1e90"
DEMO_PROJECT_CODE = "kg-architecture-demo-v1"
DEMO_WORKSPACE_LABEL = "Knowledge Graph Architecture — Demo Reasoning"
DEMO_CONVERSATION_ID = "main"
SEED_VERSION = 1
SEED_REVISION = 4
SEED_TIME = "2026-07-16T00:00:00Z"

BOOK_DOCUMENT_REF = "know:document:building-knowledge-graphs-full-book"
BOOK_CONTEXT_CHUNK_REF = "know:chunk:14d1d9178ca1dfb3cd8496afbfec2f4af6d96b32c543e14abc82fa49ab5012e1"
BOOK_DOMAIN_CHUNK_REF = "know:chunk:20c418ca681571e4a08a2ea43ac79649f973a7e0da9a7b3917cbf38fe2cbeba9"
BOOK_MODEL_CHUNK_REF = "know:chunk:162962bf30e07629688199b12e17890bec117f50b72521145e13dfcb2ea8c0b7"
ANALYSIS_REF = "analysis:76c5d5ab36cc09ecbae26b07"
ANALYSIS_COMMUNITY_REF = "community:1"
ANALYSIS_TOPIC_REF = "topic:graph:29a184b6"
ANALYSIS_GATEWAY_REF = "topic:data:a17c9aaa"
ANALYSIS_GAP_REF = "gap:daacd08da4e8"

CODE_INGEST_REF = "code:C-Projects-main.services.knowgraph.ingest.ingest_pdf"
CODE_TG_APPLY_REF = "code:C-Projects-main.apps.python-models.app.python_models.thinkgraph_engraphis.ThinkGraphEngraphis.apply_patch"
CODE_TG_PROJECTION_REF = "code:C-Projects-main.apps.python-models.app.python_models.thinkgraph_engraphis.ThinkGraphEngraphis.projection"
CODE_MCP_REF = "code:C-Projects-main.apps.python-models.app.mcp_host.list_tools"
CODE_TG_UI_REF = "code:C-Projects-main.client.src.components.knowledge.KnowledgeGraphFramework.KnowledgeGraphFramework"
CODE_CODEGRAPH_UI_REF = "code:C-Projects-main.client.src.components.codegraph.CodeGraphSurface.CodeGraphSurface"
ANALYZER_SOURCE_REF = "repo:services/knowgraph/analysis.py"


def _resource(
    suffix: str,
    label: str,
    kind: str,
    cluster: str,
    description: str,
    status: str = "seeded_demo",
    **properties: str | int | float | bool,
) -> dict[str, Any]:
    return {
        "id": f"kgdemo:v1:{suffix}",
        "label": label,
        "kind": kind,
        "properties": {
            "seeded_demo": True,
            "seed_version": SEED_VERSION,
            "cluster": cluster,
            "description": description,
            "display_label": " ".join(label.split()[:4]),
            "status": status,
            **properties,
        },
    }


def demo_resources() -> list[dict[str, Any]]:
    r = _resource
    return [
        r("workspace", DEMO_WORKSPACE_LABEL, "Project", "organizing", "Explicit test workspace; not organic production reasoning.", demo_workspace=DEMO_PROJECT_ID, demo_project_code=DEMO_PROJECT_CODE),
        r("goal", "Organizing principle: distinct authorities", "Goal", "organizing", "Keep reasoning, sourced evidence, and repository truth distinct while exchanging bounded views."),
        r("q-organizing", "Shared organizing principle?", "Question", "organizing", "What principle coordinates three graph authorities without merging them?"),
        r("q-canonical", "What is canonical in KnowGraph?", "Question", "knowgraph", "Separate sourced records from analytical discourse-network observations."),
        r("q-analysis", "Where should network analysis live?", "Question", "knowgraph", "Decide whether topics, communities, gateways, and gaps are canonical or derived."),
        r("q-extraction", "What may the LLM extract?", "Question", "knowgraph", "Bound semantic extraction while preserving deterministic structural records."),
        r("q-code-context", "How does Main request code context?", "Question", "communication", "Use bounded CodeGraph references rather than copied repository records."),
        r("q-hermes", "How does Hermes return research?", "Question", "communication", "Return sourced KnowGraph views with explicit provenance and epistemic level."),
        r("q-view-epistemic", "What must a Graph View declare?", "Question", "communication", "Expose authority, lifecycle, lineage, provenance, and epistemic level."),
        r("q-formal", "Where do RDF and OWL fit?", "Question", "formal-semantics", "Treat formal semantics as an export/design question unless implemented."),
        r("q-structure", "Which records stay deterministic?", "Question", "knowgraph", "Document, chunk, scope, and provenance identity must not be fabricated."),
        r("q-runtime", "What must pass before Mag One?", "Question", "proof", "Require one real graph-backed handoff loop before more visualization polish."),
        r("alt-universal", "One universal graph", "Alternative", "authority", "Use one database and renderer for every epistemic job.", status="rejected"),
        r("alt-three", "Three authority-specific graphs", "Alternative", "authority", "Preserve separate authorities with a bounded experimental unified projection.", status="selected"),
        r("alt-separate-analysis-db", "Separate analysis database", "Alternative", "knowgraph", "Place InfraNodus-like results beside canonical Neo4j.", status="rejected"),
        r("alt-layered-analysis", "Versioned analysis projection", "Alternative", "knowgraph", "Layer derived text-network results over canonical Neo4j records.", status="selected"),
        r("alt-llm-structure", "LLM-generated structure", "Alternative", "knowgraph", "Let semantic extraction invent document and chunk structure.", status="rejected"),
        r("alt-bounded-semantics", "Deterministic structure plus semantics", "Alternative", "knowgraph", "Create structure deterministically and bound semantic extraction.", status="selected"),
        r("alt-copy-records", "Copy full records between graphs", "Alternative", "communication", "Duplicate authority-owned records into receiving graphs.", status="rejected"),
        r("alt-reference-views", "References plus bounded projections", "Alternative", "communication", "Carry canonical pointers and compact projections in Graph Views.", status="selected"),
        r("dec-thinkgraph", "ThinkGraph owns reasoning", "Decision", "authority", "Revisable project reasoning belongs to Engraphis-backed ThinkGraph.", status="implemented"),
        r("dec-knowgraph", "KnowGraph owns sourced evidence", "Decision", "authority", "External claims and provenance remain under Python and Neo4j authority.", status="implemented"),
        r("dec-codegraph", "CodeGraph owns repository truth", "Decision", "authority", "CBM alone derives and writes repository structure.", status="implemented"),
        r("dec-canonical", "Document and Chunk stay canonical", "Decision", "knowgraph", "Native Neo4j Document and Chunk records remain the source structure.", status="implemented"),
        r("dec-derived", "InfraNodus analysis stays derived", "Decision", "knowgraph", "Topics, communities, gateways, and gaps are versioned derived analysis.", status="implemented"),
        r("dec-structural", "Structural nodes are deterministic", "Decision", "knowgraph", "Semantic extraction does not fabricate structural source records.", status="implemented"),
        r("dec-views", "Graph Views carry bounded context", "Decision", "communication", "Graph Views are the durable communication contract.", status="partial"),
        r("dec-tabs", "Tabs use authority grammar", "Decision", "visualization", "Each graph tab uses a renderer suited to its authority.", status="implemented"),
        r("dec-unified", "Unified remains experimental", "Decision", "visualization", "Unified is exploratory and does not replace specialized views.", status="partial"),
        r("dec-external", "InfraNodus MCP is optional", "Decision", "knowgraph", "External analysis is a provider result, never canonical truth.", status="partial"),
        r("dec-attribution", "Provider results stay distinct", "Decision", "knowgraph", "Local and external analysis retain provider identity.", status="implemented"),
        r("ev-book-document", "Canonical book document", "Evidence", "book-evidence", "The full O’Reilly book exists as a canonical KnowGraph document.", status="verified", knowgraph_ref=BOOK_DOCUMENT_REF),
        r("ev-book-context", "Context produces knowledge", "Evidence", "book-evidence", "The book says organizations need contextualized data to generate knowledge.", status="verified", knowgraph_ref=BOOK_CONTEXT_CHUNK_REF),
        r("ev-book-domain", "Model must match the domain", "Evidence", "book-evidence", "The property-graph model should match the problem domain.", status="verified", knowgraph_ref=BOOK_DOMAIN_CHUNK_REF),
        r("ev-book-model", "Rules shape graph models", "Evidence", "book-evidence", "Nodes, labels, relationships, properties, and rules form high-fidelity models.", status="verified", knowgraph_ref=BOOK_MODEL_CHUNK_REF),
        r("ev-analysis", "Local analysis is persisted", "Evidence", "analysis-evidence", "The latest local run has 350 nodes, 1,200 edges, 34 communities, and 25 gaps.", status="verified", knowgraph_ref=ANALYSIS_REF),
        r("code-ingest", "Canonical PDF ingestion path", "CodeFinding", "code-evidence", "neo4j-graphrag ingests PDFs through the existing Python pipeline.", status="implemented", codegraph_ref=CODE_INGEST_REF),
        r("code-thinkgraph", "Engraphis patch authority", "CodeFinding", "code-evidence", "ThinkGraph apply_patch preserves stable IDs, project scope, versions, and directed statements.", status="implemented", codegraph_ref=CODE_TG_APPLY_REF),
        r("code-projection", "Bounded ThinkGraph projection", "CodeFinding", "code-evidence", "Projection, neighborhood, and recall return project-scoped Engraphis data.", status="implemented", codegraph_ref=CODE_TG_PROJECTION_REF),
        r("code-mcp", "Canonical MCP host", "CodeFinding", "code-evidence", "One Python MCP host exposes graph read and analysis tools.", status="implemented", codegraph_ref=CODE_MCP_REF),
        r("code-ui", "Authority-specific graph UI", "CodeFinding", "code-evidence", "ThinkGraph and CodeGraph have specialized renderer paths.", status="implemented", codegraph_ref=CODE_TG_UI_REF, secondary_ref=CODE_CODEGRAPH_UI_REF),
        r("finding-separated", "Evidence and analysis are separated", "Finding", "findings", "Canonical book chunks remain distinct from local derived network observations.", status="supported"),
        r("finding-external-blocked", "External comparison is blocked", "Finding", "findings", "InfraNodus execution lacks configured command and credentials.", status="verified"),
        r("finding-thin-reasoning", "ThinkGraph needs realistic data", "Finding", "findings", "Infrastructure exists, but sparse reasoning weakens agent and UI tests.", status="supported"),
        r("finding-label-density", "Long labels crowd the graph", "Risk", "findings", "Concise labels and detailed properties are required for readable force layouts.", status="observed"),
        r("finding-ui-not-loop", "Full agent handoff remains unproven", "Finding", "findings", "A rendered graph does not prove an agent consumed bounded context.", status="verified"),
        r("finding-health-not-product", "Healthy service is not a workflow", "Finding", "findings", "Service health and API success do not prove the complete product loop.", status="verified"),
        r("finding-cbm-stale", "Local Python analyzer source", "CodeFinding", "findings", "Direct source confirms the analyzer, but refreshed CBM still omits its file and symbols.", status="unproven_in_codegraph", artifact_ref=ANALYZER_SOURCE_REF),
        r("proof-main", "Main receives bounded ThinkGraph", "RequiredProof", "proof", "Retrieve a compact reasoning neighborhood through the canonical ThinkGraph tool."),
        r("proof-hermes", "Hermes returns sourced KnowGraph", "RequiredProof", "proof", "Query real book evidence and return a bounded provenance-bearing view."),
        r("proof-coder", "Coder receives bounded CodeGraph", "RequiredProof", "proof", "Resolve current files and symbols without copying the repository graph."),
        r("proof-lifecycle", "Graph View lifecycle persists", "RequiredProof", "proof", "Persist candidate, attached, active, consumed, and returned only when truthful."),
        r("proof-idempotent", "Local analysis repeats idempotently", "RequiredProof", "proof", "The same source scope and configuration must reuse the same derived result."),
        r("proof-provider", "External result is attributed", "RequiredProof", "proof", "A real external comparison must identify provider, runtime, provenance, and permission."),
        r("proof-no-copy", "Authorities exchange references", "RequiredProof", "proof", "Verify no full authority-owned records are duplicated into ThinkGraph."),
        r("proof-runtime", "Main to Hermes to Mag One loop", "RequiredProof", "proof", "Run one real workflow where bounded graph context reaches the model."),
        r("next-compare", "Compare providers on one scope", "NextAction", "next-work", "Run local and official InfraNodus analysis over identical ordered chunks."),
        r("next-formal", "Decide formal export boundary", "ResearchNeed", "next-work", "Evaluate JSON-LD, RDF, and OWL exports without replacing the property graph."),
        r("next-normalize", "Improve aliases and normalization", "NextAction", "next-work", "Strengthen entity and phrase identity before expanding analysis semantics."),
        r("next-gap", "Test gap-directed research", "NextAction", "next-work", "Use one derived structural gap to request bounded sourced research."),
    ]


def demo_links() -> list[tuple[str, str, str]]:
    p = "kgdemo:v1:"
    links: list[tuple[str, str, str]] = []
    questions = ["q-organizing", "q-canonical", "q-analysis", "q-extraction", "q-code-context", "q-hermes", "q-view-epistemic", "q-formal", "q-structure", "q-runtime"]
    links.extend((p + "goal", "decomposes_into", p + q) for q in questions)
    links.extend([
        (p + "q-organizing", "considers", p + "alt-universal"), (p + "q-organizing", "considers", p + "alt-three"), (p + "q-organizing", "answers", p + "dec-thinkgraph"),
        (p + "q-canonical", "answers", p + "dec-knowgraph"), (p + "q-canonical", "requires", p + "dec-canonical"), (p + "q-canonical", "motivates", p + "dec-derived"),
        (p + "q-analysis", "considers", p + "alt-separate-analysis-db"), (p + "q-analysis", "considers", p + "alt-layered-analysis"), (p + "q-analysis", "answers", p + "dec-derived"),
        (p + "q-extraction", "considers", p + "alt-llm-structure"), (p + "q-extraction", "considers", p + "alt-bounded-semantics"), (p + "q-extraction", "answers", p + "dec-structural"),
        (p + "q-code-context", "considers", p + "alt-copy-records"), (p + "q-code-context", "answers", p + "dec-codegraph"),
        (p + "q-hermes", "considers", p + "alt-reference-views"), (p + "q-hermes", "answers", p + "dec-views"),
        (p + "q-view-epistemic", "answers", p + "dec-attribution"), (p + "q-view-epistemic", "requires", p + "proof-lifecycle"),
        (p + "q-formal", "motivates", p + "next-formal"), (p + "q-formal", "remains_unproven", p + "finding-health-not-product"),
        (p + "q-structure", "answers", p + "dec-canonical"), (p + "q-structure", "answers", p + "dec-structural"),
        (p + "q-runtime", "requires", p + "proof-runtime"), (p + "q-runtime", "motivates", p + "finding-ui-not-loop"),
        (p + "dec-thinkgraph", "selected_over", p + "alt-universal"), (p + "dec-codegraph", "selected_over", p + "alt-universal"),
        (p + "dec-derived", "selected_over", p + "alt-separate-analysis-db"), (p + "dec-derived", "supports", p + "alt-layered-analysis"),
        (p + "dec-structural", "selected_over", p + "alt-llm-structure"), (p + "dec-structural", "supports", p + "alt-bounded-semantics"),
        (p + "dec-views", "selected_over", p + "alt-copy-records"), (p + "dec-views", "supports", p + "alt-reference-views"),
    ])
    decisions = ["dec-thinkgraph", "dec-knowgraph", "dec-codegraph", "dec-canonical", "dec-derived", "dec-structural", "dec-views", "dec-tabs", "dec-unified", "dec-external", "dec-attribution"]
    links.extend((p + d, "supports", p + "goal") for d in decisions)
    links.extend([
        (p + "ev-book-document", "supports", p + "dec-knowgraph"), (p + "ev-book-document", "supports", p + "dec-canonical"),
        (p + "ev-book-context", "supports", p + "goal"), (p + "ev-book-context", "supports", p + "dec-views"),
        (p + "ev-book-domain", "supports", p + "dec-tabs"), (p + "ev-book-domain", "supports", p + "dec-structural"),
        (p + "ev-book-model", "supports", p + "dec-canonical"), (p + "ev-book-model", "supports", p + "dec-structural"),
        (p + "ev-analysis", "supports", p + "dec-derived"), (p + "ev-analysis", "supports", p + "dec-attribution"),
        (p + "code-ingest", "supports", p + "dec-canonical"), (p + "code-ingest", "supports", p + "dec-structural"),
        (p + "code-thinkgraph", "supports", p + "dec-thinkgraph"), (p + "code-thinkgraph", "supports", p + "dec-views"),
        (p + "code-projection", "supports", p + "proof-main"), (p + "code-projection", "supports", p + "dec-tabs"),
        (p + "code-mcp", "supports", p + "dec-attribution"), (p + "code-mcp", "supports", p + "proof-coder"),
        (p + "code-ui", "supports", p + "dec-tabs"), (p + "code-ui", "supports", p + "dec-unified"),
        (p + "finding-separated", "supports", p + "dec-derived"), (p + "finding-separated", "supports", p + "dec-canonical"),
        (p + "finding-external-blocked", "remains_unproven", p + "proof-provider"), (p + "finding-external-blocked", "motivates", p + "next-compare"),
        (p + "finding-thin-reasoning", "motivates", p + "workspace"), (p + "finding-thin-reasoning", "supports", p + "goal"),
        (p + "finding-label-density", "requires", p + "dec-tabs"), (p + "finding-label-density", "contradicts", p + "alt-universal"),
        (p + "finding-ui-not-loop", "requires", p + "proof-runtime"), (p + "finding-ui-not-loop", "contradicts", p + "dec-unified"),
        (p + "finding-health-not-product", "requires", p + "proof-lifecycle"), (p + "finding-health-not-product", "requires", p + "proof-runtime"),
        (p + "finding-cbm-stale", "requires", p + "proof-coder"), (p + "finding-cbm-stale", "contradicts", p + "code-ui"),
        (p + "proof-main", "depends_on", p + "dec-thinkgraph"), (p + "proof-hermes", "depends_on", p + "dec-knowgraph"),
        (p + "proof-coder", "depends_on", p + "dec-codegraph"), (p + "proof-lifecycle", "depends_on", p + "dec-views"),
        (p + "proof-idempotent", "depends_on", p + "dec-derived"), (p + "proof-provider", "depends_on", p + "dec-external"),
        (p + "proof-no-copy", "depends_on", p + "dec-views"), (p + "proof-runtime", "depends_on", p + "proof-no-copy"),
        (p + "next-compare", "depends_on", p + "proof-provider"), (p + "next-compare", "references", p + "ev-analysis"),
        (p + "next-formal", "depends_on", p + "dec-canonical"), (p + "next-formal", "references", p + "ev-book-model"),
        (p + "next-normalize", "depends_on", p + "dec-structural"), (p + "next-normalize", "motivates", p + "proof-idempotent"),
        (p + "next-gap", "depends_on", p + "ev-analysis"), (p + "next-gap", "requires", p + "proof-hermes"),
    ])
    return links


def demo_statements(resources: list[dict[str, Any]]) -> list[dict[str, Any]]:
    labels = {item["id"]: item["label"] for item in resources}
    return [
        {
            "id": f"kgdemo:v1:statement:{index:03d}",
            "subject": source,
            "predicateTerm": predicate,
            "object": target,
            "rationale": f"{labels[source]} {predicate.replace('_', ' ')} {labels[target]}.",
            "review": "seeded_demo",
            "tag": predicate,
            "properties": {"seeded_demo": True, "seed_version": SEED_VERSION},
        }
        for index, (source, predicate, target) in enumerate(demo_links(), start=1)
    ]


def demo_graph_views() -> list[dict[str, Any]]:
    base = {
        "schemaVersion": "graph-view.v1",
        "projectId": DEMO_PROJECT_ID,
        "conversationId": DEMO_CONVERSATION_ID,
        "producingRole": "seeded_demo",
        "receivingRole": "test_agent",
        "hopDepth": 1,
        "omittedNeighborCount": 0,
        "createdAt": SEED_TIME,
        "updatedAt": SEED_TIME,
        "runtime": {"seededDemo": True, "seedVersion": SEED_VERSION},
    }
    return [
        {
            **base,
            "viewId": "kgdemo:v1:view:knowgraph-organizing-principle",
            "displayLabel": "KnowGraph Evidence",
            "authority": "knowgraph",
            "status": "candidate",
            "rootCanonicalNodeIds": [BOOK_DOCUMENT_REF],
            "includedCanonicalNodeIds": [BOOK_DOCUMENT_REF, BOOK_CONTEXT_CHUNK_REF, BOOK_DOMAIN_CHUNK_REF, BOOK_MODEL_CHUNK_REF, ANALYSIS_REF, ANALYSIS_TOPIC_REF, ANALYSIS_GATEWAY_REF, ANALYSIS_GAP_REF],
            "includedRelationships": [],
            "records": [],
            "filter": {"nodeTypes": ["Document", "Chunk", "DerivedAnalysis"], "trustStates": ["source_backed", "derived_analysis"]},
            "query": "Book evidence for an authority-aware organizing principle",
            "note": "Candidate demo view; it has not been consumed by a model.",
            "provenanceRefs": [BOOK_CONTEXT_CHUNK_REF, BOOK_DOMAIN_CHUNK_REF, BOOK_MODEL_CHUNK_REF],
        },
        {
            **base,
            "viewId": "kgdemo:v1:view:codegraph-knowgraph-implementation",
            "displayLabel": "CodeGraph Implementation",
            "authority": "codegraph",
            "status": "candidate",
            "rootCanonicalNodeIds": [CODE_INGEST_REF],
            "includedCanonicalNodeIds": [CODE_INGEST_REF, CODE_TG_APPLY_REF, CODE_TG_PROJECTION_REF, CODE_MCP_REF, CODE_TG_UI_REF, CODE_CODEGRAPH_UI_REF],
            "includedRelationships": [],
            "records": [],
            "filter": {"nodeTypes": ["File", "Function", "Method"], "trustStates": ["cbm_resolved"]},
            "query": "Current graph authority, ingestion, MCP, persistence, and UI implementation",
            "note": "The analyzer source is excluded because the current CBM index does not resolve it.",
            "provenanceRefs": [CODE_INGEST_REF, CODE_TG_APPLY_REF, CODE_MCP_REF],
        },
        {
            **base,
            "viewId": "kgdemo:v1:view:architecture-decision-context",
            "displayLabel": "Architecture Context",
            "authority": "thinkgraph",
            "status": "attached",
            "rootCanonicalNodeIds": ["kgdemo:v1:goal"],
            "includedCanonicalNodeIds": ["kgdemo:v1:goal", "kgdemo:v1:q-organizing", "kgdemo:v1:alt-three", "kgdemo:v1:dec-thinkgraph", "kgdemo:v1:dec-knowgraph", "kgdemo:v1:dec-codegraph", "kgdemo:v1:dec-derived", "kgdemo:v1:dec-views", "kgdemo:v1:proof-runtime"],
            "includedRelationships": [],
            "records": [],
            "filter": {"nodeTypes": ["Goal", "Question", "Alternative", "Decision", "RequiredProof"], "trustStates": []},
            "query": "Why the three authorities stay distinct and communicate through views",
            "note": "Attached demo context only; no model consumption is claimed.",
            "provenanceRefs": [BOOK_CONTEXT_CHUNK_REF, CODE_TG_APPLY_REF],
        },
        {
            **base,
            "viewId": "kgdemo:v1:view:next-runtime-proof",
            "displayLabel": "Runtime Proof",
            "authority": "thinkgraph",
            "status": "attached",
            "parentViewId": "kgdemo:v1:view:architecture-decision-context",
            "rootCanonicalNodeIds": ["kgdemo:v1:proof-runtime"],
            "includedCanonicalNodeIds": ["kgdemo:v1:proof-main", "kgdemo:v1:proof-hermes", "kgdemo:v1:proof-coder", "kgdemo:v1:proof-no-copy", "kgdemo:v1:proof-runtime", "kgdemo:v1:finding-ui-not-loop", "kgdemo:v1:finding-health-not-product"],
            "includedRelationships": [],
            "records": [],
            "filter": {"nodeTypes": ["RequiredProof", "Finding"], "trustStates": []},
            "query": "Minimum honest context for the complete Main to Hermes to Mag One proof",
            "note": "Attached demo test packet; lifecycle must advance only during a real invocation.",
            "provenanceRefs": [CODE_MCP_REF, BOOK_DOCUMENT_REF],
        },
        {
            **base,
            "viewId": "kgdemo:v1:view:main-testing-context",
            "displayLabel": "Main Context",
            "authority": "thinkgraph",
            "status": "candidate",
            "receivingRole": "main_chat",
            "rootCanonicalNodeIds": ["kgdemo:v1:goal"],
            "includedCanonicalNodeIds": [
                "kgdemo:v1:goal", "kgdemo:v1:q-organizing", "kgdemo:v1:dec-thinkgraph",
                "kgdemo:v1:dec-knowgraph", "kgdemo:v1:dec-codegraph", "kgdemo:v1:dec-derived",
                "kgdemo:v1:dec-views", "kgdemo:v1:ev-book-context", "kgdemo:v1:ev-book-domain",
                "kgdemo:v1:ev-book-model", "kgdemo:v1:ev-analysis", "kgdemo:v1:code-ingest",
                "kgdemo:v1:code-mcp", "kgdemo:v1:proof-runtime",
            ],
            "includedRelationships": [],
            "records": [],
            "filter": {"nodeTypes": ["Goal", "Question", "Decision", "Evidence", "CodeFinding", "RequiredProof"], "trustStates": []},
            "query": "Seeded current architecture context for Main testing",
            "note": "Seeded candidate testing view; no prior invocation or consumption is claimed.",
            "provenanceRefs": [BOOK_CONTEXT_CHUNK_REF, BOOK_DOMAIN_CHUNK_REF, BOOK_MODEL_CHUNK_REF, CODE_INGEST_REF, CODE_MCP_REF],
        },
        {
            **base,
            "viewId": "kgdemo:v1:view:hermes-testing-context",
            "displayLabel": "Hermes Context",
            "authority": "thinkgraph",
            "status": "candidate",
            "receivingRole": "hermes",
            "rootCanonicalNodeIds": ["kgdemo:v1:q-hermes"],
            "includedCanonicalNodeIds": [
                "kgdemo:v1:goal", "kgdemo:v1:q-hermes", "kgdemo:v1:q-view-epistemic",
                "kgdemo:v1:dec-knowgraph", "kgdemo:v1:dec-derived", "kgdemo:v1:dec-views",
                "kgdemo:v1:ev-book-context", "kgdemo:v1:ev-book-domain", "kgdemo:v1:ev-book-model",
                "kgdemo:v1:ev-analysis", "kgdemo:v1:next-gap", "kgdemo:v1:proof-hermes",
                "kgdemo:v1:code-mcp",
            ],
            "includedRelationships": [],
            "records": [],
            "filter": {"nodeTypes": ["Goal", "Question", "Decision", "Evidence", "NextStep", "RequiredProof", "CodeFinding"], "trustStates": []},
            "query": "Seeded reasoning, book evidence, and analysis context for Hermes testing",
            "note": "Seeded candidate testing view; no prior invocation or consumption is claimed.",
            "provenanceRefs": [BOOK_CONTEXT_CHUNK_REF, BOOK_DOMAIN_CHUNK_REF, BOOK_MODEL_CHUNK_REF, ANALYSIS_REF, CODE_MCP_REF],
        },
        {
            **base,
            "viewId": "kgdemo:v1:view:coder-testing-context",
            "displayLabel": "Coder Context",
            "authority": "thinkgraph",
            "status": "candidate",
            "receivingRole": "coder",
            "rootCanonicalNodeIds": ["kgdemo:v1:proof-coder"],
            "includedCanonicalNodeIds": [
                "kgdemo:v1:goal", "kgdemo:v1:q-code-context", "kgdemo:v1:dec-codegraph",
                "kgdemo:v1:dec-views", "kgdemo:v1:code-ingest", "kgdemo:v1:code-thinkgraph",
                "kgdemo:v1:code-projection", "kgdemo:v1:code-mcp", "kgdemo:v1:code-ui",
                "kgdemo:v1:proof-coder", "kgdemo:v1:proof-runtime", "kgdemo:v1:proof-no-copy",
                "kgdemo:v1:finding-cbm-stale", "kgdemo:v1:ev-book-model",
            ],
            "includedRelationships": [],
            "records": [],
            "filter": {"nodeTypes": ["Goal", "Question", "Decision", "CodeFinding", "RequiredProof", "Finding", "Evidence"], "trustStates": []},
            "query": "Seeded goals, implementation references, and proof requirements for Coder testing",
            "note": "Seeded candidate testing view; no prior invocation or consumption is claimed.",
            "provenanceRefs": [CODE_INGEST_REF, CODE_TG_APPLY_REF, CODE_TG_PROJECTION_REF, CODE_MCP_REF, BOOK_MODEL_CHUNK_REF],
        },
    ]


def demo_view_statements() -> list[dict[str, Any]]:
    links = [
        ("graph-view:kgdemo:v1:view:knowgraph-organizing-principle", "produces_view", "kgdemo:v1:ev-book-document"),
        ("graph-view:kgdemo:v1:view:codegraph-knowgraph-implementation", "produces_view", "kgdemo:v1:code-ingest"),
        ("graph-view:kgdemo:v1:view:architecture-decision-context", "references", "kgdemo:v1:goal"),
        ("graph-view:kgdemo:v1:view:next-runtime-proof", "references", "kgdemo:v1:proof-runtime"),
        ("graph-view:kgdemo:v1:view:main-testing-context", "references", "kgdemo:v1:goal"),
        ("graph-view:kgdemo:v1:view:hermes-testing-context", "references", "kgdemo:v1:q-hermes"),
        ("graph-view:kgdemo:v1:view:coder-testing-context", "references", "kgdemo:v1:proof-coder"),
    ]
    return [
        {
            "id": f"kgdemo:v1:view-statement:{index}",
            "subject": source,
            "predicateTerm": predicate,
            "object": target,
            "rationale": "The persisted Graph View explicitly references this bounded demo context.",
            "review": "seeded_demo",
            "tag": predicate,
            "properties": {"seeded_demo": True, "seed_version": SEED_VERSION},
        }
        for index, (source, predicate, target) in enumerate(links, start=1)
    ]


def _chunks(items: list[dict[str, Any]], size: int) -> Iterable[list[dict[str, Any]]]:
    for offset in range(0, len(items), size):
        yield items[offset:offset + size]


def seed_demo(graph: ThinkGraphEngraphis) -> dict[str, Any]:
    resources = demo_resources()
    statements = demo_statements(resources)
    results: list[dict[str, Any]] = []
    for category, batches in (
        ("resources", list(_chunks(resources, 30))),
        ("statements", list(_chunks(statements, 25))),
    ):
        for ordinal, batch in enumerate(batches, start=1):
            authority = {
                "projectId": DEMO_PROJECT_ID,
                "conversationId": DEMO_CONVERSATION_ID,
                "cardId": "seed:kg-architecture-demo",
                "correlationId": f"kg-architecture-demo:v{SEED_VERSION}:r{SEED_REVISION}:{category}:{ordinal}",
            }
            patch = {"resources": batch} if category == "resources" else {"statements": batch}
            result = graph.apply_patch(authority, patch)
            if not result.get("ok"):
                raise RuntimeError(json.dumps(result, ensure_ascii=False))
            results.append({"batch": f"{category}:{ordinal}", "status": result["status"]})
    for view in demo_graph_views():
        graph.persist_graph_view(view)
    view_result = graph.apply_patch(
        {
            "projectId": DEMO_PROJECT_ID,
            "conversationId": DEMO_CONVERSATION_ID,
            "cardId": "seed:kg-architecture-demo",
            "correlationId": f"kg-architecture-demo:v{SEED_VERSION}:r{SEED_REVISION}:view-statements:1",
        },
        {"statements": demo_view_statements()},
    )
    if not view_result.get("ok"):
        raise RuntimeError(json.dumps(view_result, ensure_ascii=False))
    results.append({"batch": "view-statements:1", "status": view_result["status"]})
    projection = graph.projection(DEMO_PROJECT_ID, limit=500)
    return {
        "ok": True,
        "projectId": DEMO_PROJECT_ID,
        "workspaceLabel": DEMO_WORKSPACE_LABEL,
        "seedVersion": SEED_VERSION,
        "seedRevision": SEED_REVISION,
        "batches": results,
        "counts": projection["counts"],
        "nodeTypes": dict(sorted(Counter(node["type"] for node in projection["nodes"]).items())),
        "clusters": dict(sorted(Counter(str((node.get("properties") or {}).get("cluster") or "graph-view") for node in projection["nodes"]).items())),
        "graphViews": [view["viewId"] for view in demo_graph_views()],
        "revision": projection["revision"],
    }


def remove_demo(graph: ThinkGraphEngraphis, *, confirm: str, allow_shared_workspace: bool = False) -> dict[str, Any]:
    if confirm != DEMO_PROJECT_ID:
        raise ValueError(f"removal confirmation must equal {DEMO_PROJECT_ID}")
    if not allow_shared_workspace:
        raise ValueError("shared_active_workspace_removal_forbidden")
    service = MemoryService(graph.engine)
    known = {item["name"] for item in service.list_workspaces()["workspaces"]}
    if DEMO_PROJECT_ID not in known:
        return {"ok": True, "status": "already_absent", "projectId": DEMO_PROJECT_ID}
    result = service.delete_workspace(DEMO_PROJECT_ID, actor="kg-architecture-demo-removal")
    graph.store.conn.execute("DELETE FROM thinkgraph_patch_receipts WHERE project_id=?", (DEMO_PROJECT_ID,))
    graph.store.conn.commit()
    return {"ok": True, "status": "removed", "projectId": DEMO_PROJECT_ID, **result}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--remove", action="store_true", help="Remove only the dedicated demo workspace.")
    parser.add_argument("--confirm", default="", help=f"Required for removal: {DEMO_PROJECT_ID}")
    args = parser.parse_args()
    graph = get_thinkgraph()
    result = remove_demo(graph, confirm=args.confirm) if args.remove else seed_demo(graph)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
