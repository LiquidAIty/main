"""Provider-neutral, derived text-network analysis for canonical KnowGraph chunks.

This module is intentionally separate from semantic extraction.  It reads canonical
Document/Chunk records and writes only versioned analytical records.  Communities,
gateways, and gaps are derived observations, never source-backed facts.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import time
from collections import Counter, defaultdict
from datetime import UTC, datetime
from itertools import combinations
from typing import Any, Literal

import networkx as nx
from dotenv import load_dotenv
from neo4j import GraphDatabase
from pydantic import BaseModel, Field, model_validator

load_dotenv()

CONTRACT_VERSION = "knowgraph.analysis.v1"
ENGINE_VERSION = "local-cleanroom-1.0.1"
DEFAULT_STOPWORDS = frozenset(
    "a about above after again against all also am an and any are around as at back be because been before being below between both but by called can chapter chapters could did do does each example examples few figure figures first for from further get gets got had has have he her here him his how i if in into is it its just made make makes many may might more most much must new next no nor not number of off on once one only or other our out over own page pages part same see seen she should show shown since so some such take than that the their them then there these they this those three through to too two under until up use used uses using very via was way we well were what when where which while who why will with within without would you your".split()
)
TOKEN_RE = re.compile(r"[^\W_]+(?:['’][^\W_]+)?", re.UNICODE)


class SourceScope(BaseModel):
    project_id: str
    document_ids: list[str] = Field(default_factory=list)
    chunk_ids: list[str] = Field(default_factory=list)


class AnalysisStatement(BaseModel):
    statement_id: str
    text: str
    source_document_ref: str | None = None
    position: int = 0
    provenance_refs: list[str] = Field(default_factory=list)
    approved_concepts: list[str] = Field(default_factory=list)


class AnalysisOptions(BaseModel):
    window_size: int = Field(default=4, ge=2, le=20)
    distance_weighting: Literal["inverse", "flat"] = "inverse"
    minimum_topic_frequency: int = Field(default=2, ge=1)
    minimum_edge_weight: float = Field(default=0.5, gt=0)
    use_default_stopwords: bool = True
    stopwords: list[str] = Field(default_factory=list)
    phrases: list[str] = Field(default_factory=list)
    aliases: dict[str, str] = Field(default_factory=dict)
    reuse_canonical_concepts: bool = True
    lowercase: bool = True
    community_algorithm: Literal["louvain", "greedy_modularity"] = "louvain"
    centrality_algorithm: Literal["pagerank", "degree", "betweenness"] = "pagerank"
    community_seed: int = 0
    gateway_threshold: float = Field(default=0.05, ge=0, le=1)
    gap_min_path: int = Field(default=2, ge=2, le=6)
    gap_max_path: int = Field(default=3, ge=2, le=8)
    node_limit: int = Field(default=350, ge=2, le=5000)
    edge_limit: int = Field(default=1200, ge=1, le=20000)
    provenance_limit_per_topic: int = Field(default=24, ge=1, le=200)

    @model_validator(mode="after")
    def validate_gap_range(self) -> "AnalysisOptions":
        if self.gap_max_path < self.gap_min_path:
            raise ValueError("gap_max_path must be greater than or equal to gap_min_path")
        return self


class AnalysisRequest(BaseModel):
    schema_version: Literal["knowgraph.analysis.request.v1"] = "knowgraph.analysis.request.v1"
    request_id: str
    project_id: str
    conversation_id: str | None = None
    job_id: str | None = None
    source_scope: SourceScope
    statements: list[AnalysisStatement] = Field(default_factory=list)
    language: str = "en"
    options: AnalysisOptions = Field(default_factory=AnalysisOptions)
    requested_provider: Literal["local_cleanroom", "infranodus_mcp"] = "local_cleanroom"
    include_graph: bool = True
    persist: bool = True
    external_provider_permission: bool = False
    external_max_characters: int = Field(default=250_000, ge=1, le=2_000_000)
    provider_extensions: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_scope(self) -> "AnalysisRequest":
        if self.project_id != self.source_scope.project_id:
            raise ValueError("project_id must match source_scope.project_id")
        if self.requested_provider == "infranodus_mcp" and not self.external_provider_permission:
            raise ValueError("external_provider_permission is required for infranodus_mcp")
        return self


class ProviderCapabilities(BaseModel):
    provider: Literal["local_cleanroom", "infranodus_mcp"]
    available: bool
    operations: list[str]
    graph_output: bool
    persistent_graphs: bool
    ontology: bool
    external_text_transfer: bool
    limitations: list[str] = Field(default_factory=list)


class AnalysisNode(BaseModel):
    id: str
    label: str
    frequency: int
    community_id: str
    influence: float
    bridge_importance: float
    supporting_statement_ids: list[str]
    supporting_statement_count: int
    source_document_refs: list[str]


class AnalysisEdge(BaseModel):
    id: str
    source: str
    target: str
    weight: float
    occurrences: int


class AnalysisCommunity(BaseModel):
    id: str
    label: str
    node_ids: list[str]
    top_concepts: list[str]


class GapCandidate(BaseModel):
    id: str
    source: str
    target: str
    source_community: str
    target_community: str
    path: list[str]
    path_length: int
    score: float


class AnalysisResult(BaseModel):
    schema_version: Literal["knowgraph.analysis.v1"] = CONTRACT_VERSION
    analysis_id: str
    request_id: str
    provider: Literal["local_cleanroom", "infranodus_mcp"]
    provider_version: str | None = None
    algorithm_version: str
    configuration_hash: str
    source_scope: SourceScope
    source_statement_count: int
    source_character_count: int
    node_count: int
    edge_count: int
    modularity: float | None = None
    communities: list[AnalysisCommunity] = Field(default_factory=list)
    nodes: list[AnalysisNode] = Field(default_factory=list)
    edges: list[AnalysisEdge] = Field(default_factory=list)
    main_concepts: list[str] = Field(default_factory=list)
    conceptual_gateways: list[str] = Field(default_factory=list)
    influential_nodes: list[str] = Field(default_factory=list)
    content_gap_candidates: list[GapCandidate] = Field(default_factory=list)
    important_relations: list[str] = Field(default_factory=list)
    important_term_combinations: list[str] = Field(default_factory=list)
    provenance_refs: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    limitations: list[str] = Field(default_factory=list)
    provider_extensions: dict[str, Any] = Field(default_factory=dict)
    raw_provider_result_ref: str | None = None
    created_at: str
    runtime_ms: float
    estimated_cost: float | None = None
    reused: bool = False


class ProviderComparisonRequest(BaseModel):
    request: AnalysisRequest
    external_provider_permission: bool
    persist: bool = True


def _json_hash(value: Any) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _safe_topic_id(label: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", label.casefold()).strip("-")[:48] or "topic"
    return f"topic:{slug}:{hashlib.sha1(label.encode('utf-8')).hexdigest()[:8]}"


def _records(result: Any) -> list[Any]:
    if hasattr(result, "records"):
        return list(result.records)
    if isinstance(result, tuple) and result:
        return list(result[0])
    return []


def _driver_from_env():
    uri = os.environ.get("NEO4J_URI", "").strip()
    user = os.environ.get("NEO4J_USER", "").strip()
    password = os.environ.get("NEO4J_PASSWORD", "").strip()
    if not uri or not user or not password:
        raise RuntimeError("NEO4J_URI, NEO4J_USER, and NEO4J_PASSWORD are required")
    return GraphDatabase.driver(uri, auth=(user, password))


def load_canonical_statements(scope: SourceScope, driver: Any | None = None) -> list[AnalysisStatement]:
    owned_driver = driver is None
    driver = driver or _driver_from_env()
    database = os.environ.get("NEO4J_DATABASE", "").strip() or None
    try:
        result = driver.execute_query(
            """
            MATCH (doc:Document {project_id: $project_id})-[:HAS_CHUNK]-(chunk:Chunk)
            WHERE (size($document_ids) = 0 OR toString(doc.document_id) IN $document_ids)
              AND (size($chunk_ids) = 0 OR toString(chunk.chunk_id) IN $chunk_ids)
              AND chunk.text IS NOT NULL
            OPTIONAL MATCH (chunk)-[:MENTIONS]->(entity)
            WHERE NOT entity:Chunk AND NOT entity:Document
            WITH doc, chunk,
                 [name IN collect(DISTINCT coalesce(entity.name, entity.title))
                  WHERE name IS NOT NULL AND trim(toString(name)) <> ''] AS approved_concepts
            RETURN toString(chunk.chunk_id) AS statement_id,
                   toString(chunk.text) AS text,
                   toString(doc.document_id) AS document_id,
                   coalesce(chunk.chunk_index, 0) AS position,
                   approved_concepts
            ORDER BY document_id, position, statement_id
            """,
            project_id=scope.project_id,
            document_ids=scope.document_ids,
            chunk_ids=scope.chunk_ids,
            database_=database,
        )
        statements = []
        for record in _records(result):
            statement_id = str(record.get("statement_id") or "").strip()
            text = str(record.get("text") or "").strip()
            document_id = str(record.get("document_id") or "").strip()
            if statement_id and text:
                statements.append(
                    AnalysisStatement(
                        statement_id=statement_id,
                        text=text,
                        source_document_ref=f"know:document:{document_id}" if document_id else None,
                        position=int(record.get("position") or 0),
                        provenance_refs=[f"know:chunk:{statement_id}"],
                        approved_concepts=sorted(str(value) for value in (record.get("approved_concepts") or [])),
                    )
                )
        return statements
    finally:
        if owned_driver:
            driver.close()


def source_preview(scope: SourceScope, driver: Any | None = None) -> dict[str, Any]:
    statements = load_canonical_statements(scope, driver)
    documents = sorted({s.source_document_ref for s in statements if s.source_document_ref})
    return {
        "source_scope": scope.model_dump(),
        "statement_count": len(statements),
        "character_count": sum(len(s.text) for s in statements),
        "document_refs": documents,
        "first_statement_ids": [s.statement_id for s in statements[:10]],
    }


def context_projection(project_id: str, canonical_refs: list[str], limit: int = 120, driver: Any | None = None, *, conversation_id: str = "main", receiving_role: str = "main_chat") -> dict[str, Any]:
    """Bounded Neo4j read for a cross-authority Graph View; never a second store."""
    project_id = str(project_id or "").strip()
    if not project_id:
        raise ValueError("project_id_required")
    refs = sorted({str(ref).strip() for ref in canonical_refs if str(ref).strip()})[:80]
    limit = max(1, min(int(limit), 300))
    owned_driver = driver is None
    driver = driver or _driver_from_env()
    database = os.environ.get("NEO4J_DATABASE", "").strip() or None
    try:
        node_result = driver.execute_query(
            """
            // knowgraph_context_anchors
            MATCH (n)
            WHERE (toString(n.project_id) = $project_id OR size($refs) > 0)
              AND NOT (n:Skill OR n:SkillAttempt OR n:FailedAttempt OR n:Guardrail OR n:QueryPattern OR n:SkillSection)
            WITH n,
              CASE
                WHEN n:Document AND n.document_id IS NOT NULL THEN 'know:document:' + toString(n.document_id)
                WHEN n:Chunk AND n.chunk_id IS NOT NULL THEN 'know:chunk:' + toString(n.chunk_id)
                WHEN n.analysis_id IS NOT NULL THEN toString(n.analysis_id)
                WHEN n.topic_id IS NOT NULL THEN toString(n.topic_id)
                WHEN n.gap_id IS NOT NULL THEN toString(n.gap_id)
                WHEN n.community_id IS NOT NULL THEN toString(n.community_id)
                WHEN n.id IS NOT NULL THEN toString(n.id)
                ELSE elementId(n)
              END AS canonical_id
            WITH n, canonical_id
            WHERE size($refs) = 0 OR canonical_id IN $refs
            WITH n, canonical_id, CASE WHEN canonical_id IN $refs THEN 0 ELSE 1 END AS priority
            RETURN elementId(n) AS element_id, canonical_id, labels(n) AS labels,
                   coalesce(n.name, n.title, n.label, n.document_id, n.chunk_id, canonical_id) AS label,
                   {description: coalesce(n.description, substring(toString(n.text), 0, 520), ''),
                    status: n.status, provider: n.provider, run_id: n.run_id,
                    analysis_id: n.analysis_id, document_id: n.document_id, chunk_id: n.chunk_id,
                    source_url: n.source_url, project_id: n.project_id} AS properties,
                   priority
            ORDER BY priority, canonical_id
            LIMIT $limit
            """,
            project_id=project_id,
            refs=refs,
            limit=limit,
            database_=database,
        )
        node_records = list(_records(node_result))
        anchor_element_ids = [str(record.get("element_id") or "") for record in node_records if record.get("element_id")]
        omitted_neighbors = 0
        if refs and anchor_element_ids and len(node_records) < limit:
            remaining = limit - len(node_records)
            neighbor_result = driver.execute_query(
                """
                // knowgraph_context_neighbors
                MATCH (anchor)-[r]-(n)
                WHERE elementId(anchor) IN $anchor_element_ids
                  AND type(r) IN ['HAS_CHUNK', 'MENTIONS', 'DERIVED_FROM', 'VIEWS_ANALYSIS',
                                  'ASSERTS', 'SUPPORTED_BY', 'HAS_ENTITY', 'HAS_CONCEPT']
                  AND NOT (n:Skill OR n:SkillAttempt OR n:FailedAttempt OR n:Guardrail OR n:QueryPattern OR n:SkillSection)
                  AND (n.project_id IS NULL OR anchor.project_id IS NULL OR
                       toString(n.project_id) = toString(anchor.project_id) OR
                       toString(n.project_id) = $project_id)
                WITH DISTINCT n
                WITH n,
                  CASE
                    WHEN n:Document AND n.document_id IS NOT NULL THEN 'know:document:' + toString(n.document_id)
                    WHEN n:Chunk AND n.chunk_id IS NOT NULL THEN 'know:chunk:' + toString(n.chunk_id)
                    WHEN n.analysis_id IS NOT NULL THEN toString(n.analysis_id)
                    WHEN n.topic_id IS NOT NULL THEN toString(n.topic_id)
                    WHEN n.gap_id IS NOT NULL THEN toString(n.gap_id)
                    WHEN n.community_id IS NOT NULL THEN toString(n.community_id)
                    WHEN n.id IS NOT NULL THEN toString(n.id)
                    ELSE elementId(n)
                  END AS canonical_id
                RETURN elementId(n) AS element_id, canonical_id, labels(n) AS labels,
                       coalesce(n.name, n.title, n.label, n.document_id, n.chunk_id, canonical_id) AS label,
                       {description: coalesce(n.description, substring(toString(n.text), 0, 520), ''),
                        status: n.status, provider: n.provider, run_id: n.run_id,
                        analysis_id: n.analysis_id, document_id: n.document_id, chunk_id: n.chunk_id,
                        source_url: n.source_url, project_id: n.project_id} AS properties,
                       1 AS priority
                ORDER BY canonical_id
                LIMIT $neighbor_limit
                """,
                anchor_element_ids=anchor_element_ids,
                project_id=project_id,
                neighbor_limit=remaining + 1,
                database_=database,
            )
            neighbor_records = [record for record in _records(neighbor_result) if str(record.get("element_id") or "") not in set(anchor_element_ids)]
            if len(neighbor_records) > remaining:
                omitted_neighbors = len(neighbor_records) - remaining
                neighbor_records = neighbor_records[:remaining]
            node_records.extend(neighbor_records)
        nodes = []
        element_ids = []
        canonical_by_element = {}
        for record in node_records:
            element_id = str(record.get("element_id") or "")
            canonical_id = str(record.get("canonical_id") or element_id)
            labels = [str(value) for value in (record.get("labels") or [])]
            element_ids.append(element_id)
            canonical_by_element[element_id] = canonical_id
            nodes.append({
                "id": canonical_id,
                "label": str(record.get("label") or canonical_id),
                "type": labels[0] if labels else "NeoEntity",
                "properties": dict(record.get("properties") or {}),
                "provenance": {"neo4jElementId": element_id, "projectId": project_id},
            })
        relationship_result = driver.execute_query(
            """
            MATCH (a)-[r]->(b)
            WHERE elementId(a) IN $element_ids AND elementId(b) IN $element_ids
            RETURN elementId(r) AS id, elementId(a) AS source, elementId(b) AS target, type(r) AS type
            LIMIT $relationship_limit
            """,
            element_ids=element_ids,
            relationship_limit=limit * 3,
            database_=database,
        )
        relationships = [{
            "id": str(record.get("id") or ""),
            "source": canonical_by_element.get(str(record.get("source") or ""), ""),
            "target": canonical_by_element.get(str(record.get("target") or ""), ""),
            "type": str(record.get("type") or "RELATED_TO"),
        } for record in _records(relationship_result)]
        resolved = {node["id"] for node in nodes}
        missing = sorted(set(refs) - resolved)
        warnings = [{"authority": "knowgraph", "code": "referenced_record_not_found", "detail": ref} for ref in missing]
        if len(nodes) == limit:
            warnings.append({"authority": "knowgraph", "code": "authority_view_limit_reached", "detail": f"KnowGraph returned the configured limit of {limit} records."})
        if omitted_neighbors:
            warnings.append({"authority": "knowgraph", "code": "authority_view_truncated", "detail": f"At least {omitted_neighbors} direct evidence neighbor was omitted by limit {limit}."})
        identity = {"projectId": project_id, "refs": refs, "limit": limit, "nodes": sorted(resolved), "relationships": sorted((item["source"], item["type"], item["target"]) for item in relationships)}
        view_id = f"knowgraph:{hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()[:24]}"
        records = []
        for rank, node in enumerate(nodes, start=1):
            description = str((node.get("properties") or {}).get("description") or node["label"])
            summary = f"{node['label']}: {description}"[:480]
            provenance_refs = [str(value) for value in (node.get("provenance") or {}).values() if isinstance(value, str) and value][:12]
            records.append({"canonicalId": node["id"], "summary": summary, "selectionReason": "Selected by the KnowGraph bounded evidence/analysis view", "rank": rank, "provenanceRefs": provenance_refs, "estimatedCharacters": len(summary), "estimatedTokens": max(1, (len(summary) + 3) // 4)})
        view = {
            "schemaVersion": "graph-view.v1", "viewId": view_id, "authority": "knowgraph", "status": "candidate",
            "projectId": project_id, "conversationId": conversation_id, "producingRole": "knowgraph", "receivingRole": receiving_role,
            "rootCanonicalNodeIds": refs[:20], "includedCanonicalNodeIds": [record["canonicalId"] for record in records], "records": records,
            "includedRelationships": relationships, "query": "Canonical references and bounded evidence/analysis neighborhood", "filter": {"nodeTypes": [], "trustStates": ["source_backed", "derived_analysis"]},
            "hopDepth": 1 if refs and len(nodes) > len(anchor_element_ids) else 0, "provenanceRefs": sorted({ref for record in records for ref in record["provenanceRefs"]})[:40], "omittedNeighborCount": omitted_neighbors,
            "createdAt": "1970-01-01T00:00:00Z", "updatedAt": "1970-01-01T00:00:00Z",
        }
        return {
            "schemaVersion": "knowgraph.context.v1",
            "authority": "knowgraph-neo4j",
            "projectId": project_id,
            "nodes": nodes,
            "relationships": relationships,
            "view": view,
            "warnings": warnings,
            "missingCanonicalRefs": missing,
            "counts": {"nodes": len(nodes), "relationships": len(relationships)},
        }
    finally:
        if owned_driver:
            driver.close()


def _normalized_tokens(statement: AnalysisStatement, options: AnalysisOptions) -> list[str]:
    text = statement.text.casefold() if options.lowercase else statement.text
    aliases = {
        (key.casefold() if options.lowercase else key): (value.casefold() if options.lowercase else value)
        for key, value in options.aliases.items()
        if key.strip() and value.strip()
    }
    canonical_phrases = statement.approved_concepts if options.reuse_canonical_concepts else []
    phrases = sorted(
        {
            *(p.casefold() if options.lowercase else p for p in options.phrases),
            *(p.casefold() if options.lowercase else p for p in canonical_phrases),
            *aliases.keys(),
        },
        key=lambda value: (-len(value.split()), value),
    )
    replacements: dict[str, str] = {}
    for index, phrase in enumerate(phrases):
        marker = f"phrasezz{index}"
        canonical = aliases.get(phrase, phrase).strip()
        text = re.sub(rf"(?<!\w){re.escape(phrase)}(?!\w)", marker, text)
        replacements[marker] = canonical.replace(" ", "_")
    stopwords = {w.casefold() if options.lowercase else w for w in options.stopwords}
    if options.use_default_stopwords:
        stopwords.update(DEFAULT_STOPWORDS)
    tokens = []
    for match in TOKEN_RE.finditer(text):
        token = replacements.get(match.group(0), match.group(0)).strip("_'’")
        if token and token not in stopwords and not token.isnumeric():
            tokens.append(token)
    return tokens


def _community_sets(graph: nx.Graph, options: AnalysisOptions) -> list[set[str]]:
    if graph.number_of_nodes() == 0:
        return []
    if graph.number_of_edges() == 0:
        return [{str(node)} for node in sorted(graph.nodes)]
    if options.community_algorithm == "greedy_modularity":
        communities = nx.community.greedy_modularity_communities(graph, weight="weight")
    else:
        communities = nx.community.louvain_communities(
            graph,
            weight="weight",
            seed=options.community_seed,
        )
    return sorted((set(map(str, group)) for group in communities), key=lambda group: (-len(group), sorted(group)))


def _centralities(graph: nx.Graph, options: AnalysisOptions) -> tuple[dict[str, float], dict[str, float]]:
    if graph.number_of_nodes() == 0:
        return {}, {}
    if graph.number_of_edges() == 0:
        zeroes = {str(node): 0.0 for node in graph.nodes}
        return zeroes, zeroes
    betweenness = nx.betweenness_centrality(graph, weight="distance", normalized=True)
    if options.centrality_algorithm == "betweenness":
        influence = betweenness
    elif options.centrality_algorithm == "degree":
        influence = nx.degree_centrality(graph)
    else:
        influence = nx.pagerank(graph, weight="weight")
    return ({str(k): float(v) for k, v in influence.items()}, {str(k): float(v) for k, v in betweenness.items()})


def analyze_local(request: AnalysisRequest, statements: list[AnalysisStatement]) -> AnalysisResult:
    started = time.perf_counter()
    if not statements:
        raise ValueError("source scope contains no canonical statements")
    options = request.options
    frequency: Counter[str] = Counter()
    statement_refs: dict[str, set[str]] = defaultdict(set)
    document_refs: dict[str, set[str]] = defaultdict(set)
    edge_weight: Counter[tuple[str, str]] = Counter()
    edge_occurrences: Counter[tuple[str, str]] = Counter()
    bigrams: Counter[tuple[str, str]] = Counter()
    ordered_tokens: list[list[str]] = []
    for statement in statements:
        tokens = _normalized_tokens(statement, options)
        ordered_tokens.append(tokens)
        frequency.update(tokens)
        for token in set(tokens):
            statement_refs[token].add(statement.statement_id)
            if statement.source_document_ref:
                document_refs[token].add(statement.source_document_ref)
        for left, right in zip(tokens, tokens[1:]):
            if left != right:
                bigrams[(left, right)] += 1

    eligible = {token for token, count in frequency.items() if count >= options.minimum_topic_frequency}
    for tokens in ordered_tokens:
        for left_index, left in enumerate(tokens):
            if left not in eligible:
                continue
            stop = min(len(tokens), left_index + options.window_size)
            for right_index in range(left_index + 1, stop):
                right = tokens[right_index]
                if right not in eligible or right == left:
                    continue
                pair = tuple(sorted((left, right)))
                distance = right_index - left_index
                edge_weight[pair] += 1.0 / distance if options.distance_weighting == "inverse" else 1.0
                edge_occurrences[pair] += 1

    kept_edges = [
        (pair, float(weight))
        for pair, weight in edge_weight.items()
        if weight >= options.minimum_edge_weight
    ]
    connected = {token for pair, _ in kept_edges for token in pair}
    ranked_eligible = sorted(eligible, key=lambda token: (-frequency[token], token))
    selected_tokens = set(sorted(connected, key=lambda token: (-frequency[token], token))[: options.node_limit])
    if len(selected_tokens) < options.node_limit:
        selected_tokens.update(ranked_eligible[: options.node_limit - len(selected_tokens)])
    kept_edges = sorted(
        [(pair, weight) for pair, weight in kept_edges if pair[0] in selected_tokens and pair[1] in selected_tokens],
        key=lambda item: (-item[1], item[0]),
    )[: options.edge_limit]

    graph = nx.Graph()
    for token in sorted(selected_tokens):
        graph.add_node(token, frequency=frequency[token])
    for (left, right), weight in kept_edges:
        graph.add_edge(left, right, weight=weight, distance=1.0 / weight, occurrences=edge_occurrences[(left, right)])

    communities = _community_sets(graph, options)
    community_by_token: dict[str, str] = {}
    community_models: list[AnalysisCommunity] = []
    for index, members in enumerate(communities, start=1):
        community_id = f"community:{index}"
        ranked = sorted(members, key=lambda token: (-frequency[token], token))
        for token in members:
            community_by_token[token] = community_id
        community_models.append(
            AnalysisCommunity(
                id=community_id,
                label=" · ".join(ranked[:3]),
                node_ids=[_safe_topic_id(token) for token in ranked],
                top_concepts=ranked[:8],
            )
        )
    influence, betweenness = _centralities(graph, options)
    cross_ratio: dict[str, float] = {}
    for token in graph.nodes:
        weighted_total = sum(float(graph[token][neighbor]["weight"]) for neighbor in graph.neighbors(token))
        weighted_cross = sum(
            float(graph[token][neighbor]["weight"])
            for neighbor in graph.neighbors(token)
            if community_by_token.get(str(neighbor)) != community_by_token.get(str(token))
        )
        cross_ratio[str(token)] = weighted_cross / weighted_total if weighted_total else 0.0
    bridge = {
        str(token): min(1.0, float(betweenness.get(str(token), 0.0)) + cross_ratio.get(str(token), 0.0) * 0.5)
        for token in graph.nodes
    }
    ranked_influence = sorted(graph.nodes, key=lambda token: (-influence.get(str(token), 0.0), -frequency[str(token)], str(token)))
    ranked_bridge = sorted(graph.nodes, key=lambda token: (-bridge.get(str(token), 0.0), -influence.get(str(token), 0.0), str(token)))

    nodes = []
    for token in ranked_influence:
        refs = sorted(statement_refs[str(token)])
        nodes.append(
            AnalysisNode(
                id=_safe_topic_id(str(token)),
                label=str(token).replace("_", " "),
                frequency=frequency[str(token)],
                community_id=community_by_token.get(str(token), "community:unassigned"),
                influence=round(influence.get(str(token), 0.0), 10),
                bridge_importance=round(bridge.get(str(token), 0.0), 10),
                supporting_statement_ids=refs[: options.provenance_limit_per_topic],
                supporting_statement_count=len(refs),
                source_document_refs=sorted(document_refs[str(token)]),
            )
        )
    edges = [
        AnalysisEdge(
            id=f"edge:{hashlib.sha1(f'{left}|{right}'.encode()).hexdigest()[:12]}",
            source=_safe_topic_id(left),
            target=_safe_topic_id(right),
            weight=round(weight, 8),
            occurrences=edge_occurrences[(left, right)],
        )
        for (left, right), weight in kept_edges
    ]

    gaps: list[GapCandidate] = []
    for left, right in combinations(sorted(graph.nodes), 2):
        left = str(left)
        right = str(right)
        if community_by_token.get(left) == community_by_token.get(right) or graph.has_edge(left, right):
            continue
        try:
            path = [str(node) for node in nx.shortest_path(graph, left, right, weight=None)]
        except nx.NetworkXNoPath:
            continue
        distance = len(path) - 1
        if not options.gap_min_path <= distance <= options.gap_max_path:
            continue
        score = math.sqrt(max(influence.get(left, 0.0), 0) * max(influence.get(right, 0.0), 0)) / distance
        gaps.append(
            GapCandidate(
                id=f"gap:{hashlib.sha1(f'{left}|{right}'.encode()).hexdigest()[:12]}",
                source=_safe_topic_id(left),
                target=_safe_topic_id(right),
                source_community=community_by_token[left],
                target_community=community_by_token[right],
                path=[_safe_topic_id(token) for token in path],
                path_length=distance,
                score=round(score, 10),
            )
        )
    gaps.sort(key=lambda gap: (-gap.score, gap.source, gap.target))
    gaps = gaps[:25]

    modularity = None
    if graph.number_of_edges() and communities:
        modularity = round(float(nx.community.modularity(graph, communities, weight="weight")), 10)
    content_fingerprint = [
        {
            "id": s.statement_id,
            "text": s.text,
            "document": s.source_document_ref,
            "position": s.position,
            "approved_concepts": s.approved_concepts,
        }
        for s in statements
    ]
    configuration_hash = _json_hash(
        {
            "engine": ENGINE_VERSION,
            "language": request.language,
            "scope": request.source_scope.model_dump(),
            "content": content_fingerprint,
            "options": options.model_dump(),
        }
    )
    provenance = sorted({ref for statement in statements for ref in statement.provenance_refs})
    return AnalysisResult(
        analysis_id=f"analysis:{configuration_hash[:24]}",
        request_id=request.request_id,
        provider="local_cleanroom",
        provider_version=nx.__version__,
        algorithm_version=ENGINE_VERSION,
        configuration_hash=configuration_hash,
        source_scope=request.source_scope,
        source_statement_count=len(statements),
        source_character_count=sum(len(s.text) for s in statements),
        node_count=graph.number_of_nodes(),
        edge_count=graph.number_of_edges(),
        modularity=modularity,
        communities=community_models,
        nodes=nodes if request.include_graph else [],
        edges=edges if request.include_graph else [],
        main_concepts=[str(token).replace("_", " ") for token in ranked_influence[:12]],
        conceptual_gateways=[
            str(token).replace("_", " ")
            for token in ranked_bridge
            if bridge.get(str(token), 0.0) >= options.gateway_threshold
        ][:12],
        influential_nodes=[str(token).replace("_", " ") for token in ranked_influence[:12]],
        content_gap_candidates=gaps,
        important_relations=[f"{left} ↔ {right}" for (left, right), _ in kept_edges[:20]],
        important_term_combinations=[
            f"{left.replace('_', ' ')} {right.replace('_', ' ')}"
            for (left, right), _ in sorted(bigrams.items(), key=lambda item: (-item[1], item[0]))[:20]
        ],
        provenance_refs=provenance,
        limitations=[
            "Communities, influence, gateways, and gaps are derived structural observations, not sourced facts.",
            "Token normalization does not perform semantic entity resolution beyond explicitly supplied phrases and aliases.",
        ],
        provider_extensions={
            "local_cleanroom": {
                "networkx_version": nx.__version__,
                "community_algorithm": options.community_algorithm,
                "centrality_algorithm": options.centrality_algorithm,
            }
        },
        created_at=datetime.now(UTC).isoformat(),
        runtime_ms=round((time.perf_counter() - started) * 1000, 3),
    )


def local_capabilities() -> ProviderCapabilities:
    return ProviderCapabilities(
        provider="local_cleanroom",
        available=True,
        operations=["analyze_text", "analyze_canonical_scope", "get_analysis", "create_analysis_view"],
        graph_output=True,
        persistent_graphs=True,
        ontology=False,
        external_text_transfer=False,
        limitations=["English-oriented default stopwords; phrases and aliases are caller-configurable."],
    )


async def infranodus_capabilities() -> ProviderCapabilities:
    command_json = os.environ.get("INFRANODUS_MCP_COMMAND_JSON", "").strip()
    if not command_json:
        return ProviderCapabilities(
            provider="infranodus_mcp",
            available=False,
            operations=[],
            graph_output=False,
            persistent_graphs=False,
            ontology=False,
            external_text_transfer=True,
            limitations=["INFRANODUS_MCP_COMMAND_JSON is not configured."],
        )
    tools = await _external_list_tools(command_json)
    names = sorted(tool.name for tool in tools)
    return ProviderCapabilities(
        provider="infranodus_mcp",
        available=True,
        operations=names,
        graph_output=any(name in names for name in ("analyze_text", "generate_knowledge_graph")),
        persistent_graphs="create_knowledge_graph" in names,
        ontology="generate_ontology_graph" in names,
        external_text_transfer=True,
        limitations=["Provider topology and metrics may differ from the local clean-room engine."],
    )


async def _external_list_tools(command_json: str):
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client

    command = json.loads(command_json)
    if not isinstance(command, list) or not command or not all(isinstance(part, str) and part for part in command):
        raise RuntimeError("INFRANODUS_MCP_COMMAND_JSON must be a non-empty JSON string array")
    params = StdioServerParameters(command=command[0], args=command[1:])
    async with stdio_client(params) as streams:
        async with ClientSession(*streams) as session:
            await session.initialize()
            return (await session.list_tools()).tools


def _external_payload(result: Any) -> Any:
    blocks = getattr(result, "content", []) or []
    texts = [str(getattr(block, "text", "")) for block in blocks if getattr(block, "text", None)]
    if not texts:
        raise RuntimeError("InfraNodus MCP returned no textual result")
    joined = "\n".join(texts)
    try:
        return json.loads(joined)
    except json.JSONDecodeError:
        return {"summary": joined}


def _first_list(payload: dict[str, Any], *keys: str) -> list[Any]:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, list):
            return value
    return []


def normalize_infranodus_result(
    request: AnalysisRequest,
    statements: list[AnalysisStatement],
    payload: Any,
    runtime_ms: float,
) -> AnalysisResult:
    if not isinstance(payload, dict):
        raise RuntimeError("InfraNodus MCP result is not an object")
    graph = payload.get("graph") or payload.get("knowledgeGraph") or {}
    if not isinstance(graph, dict):
        graph = {}
    raw_nodes = _first_list(graph, "nodes") or _first_list(payload, "nodes", "graphNodes")
    raw_edges = _first_list(graph, "edges", "links") or _first_list(payload, "edges", "links", "graphEdges")
    clusters = _first_list(payload, "topicalClusters", "clusters", "communities")
    concepts = _first_list(payload, "mainConcepts", "main_concepts", "concepts")
    gateways = _first_list(payload, "conceptualGateways", "gateways")
    gaps = _first_list(payload, "contentGaps", "gaps")
    if not any((raw_nodes, raw_edges, clusters, concepts, gateways, gaps)):
        raise RuntimeError("InfraNodus MCP result did not contain a supported analysis structure")
    configuration_hash = _json_hash(
        {
            "provider": "infranodus_mcp",
            "scope": request.source_scope.model_dump(),
            "statements": [{"id": s.statement_id, "text": s.text} for s in statements],
            "options": request.options.model_dump(),
        }
    )
    node_models: list[AnalysisNode] = []
    id_map: dict[str, str] = {}
    for index, raw in enumerate(raw_nodes):
        item = raw if isinstance(raw, dict) else {"label": str(raw)}
        provider_id = str(item.get("id") or item.get("name") or item.get("label") or index)
        label = str(item.get("label") or item.get("name") or provider_id)
        node_id = _safe_topic_id(label)
        id_map[provider_id] = node_id
        node_models.append(
            AnalysisNode(
                id=node_id,
                label=label,
                frequency=int(item.get("frequency") or item.get("count") or 1),
                community_id=f"community:{item.get('community') or item.get('cluster') or 'provider'}",
                influence=float(item.get("influence") or item.get("centrality") or item.get("size") or 0),
                bridge_importance=float(item.get("bridge") or item.get("betweenness") or 0),
                supporting_statement_ids=[],
                supporting_statement_count=0,
                source_document_refs=[],
            )
        )
    edge_models: list[AnalysisEdge] = []
    for index, raw in enumerate(raw_edges):
        if not isinstance(raw, dict):
            continue
        source_raw = str(raw.get("source") or raw.get("from") or "")
        target_raw = str(raw.get("target") or raw.get("to") or "")
        if not source_raw or not target_raw:
            continue
        source = id_map.get(source_raw, _safe_topic_id(source_raw))
        target = id_map.get(target_raw, _safe_topic_id(target_raw))
        edge_models.append(
            AnalysisEdge(
                id=str(raw.get("id") or f"provider-edge:{index}"),
                source=source,
                target=target,
                weight=float(raw.get("weight") or raw.get("value") or 1),
                occurrences=int(raw.get("occurrences") or raw.get("count") or 1),
            )
        )
    statistics = payload.get("statistics") if isinstance(payload.get("statistics"), dict) else {}
    raw_digest = _json_hash(payload)
    return AnalysisResult(
        analysis_id=f"analysis:infranodus:{configuration_hash[:18]}",
        request_id=request.request_id,
        provider="infranodus_mcp",
        provider_version=str(payload.get("version") or "") or None,
        algorithm_version="external-provider",
        configuration_hash=configuration_hash,
        source_scope=request.source_scope,
        source_statement_count=len(statements),
        source_character_count=sum(len(s.text) for s in statements),
        node_count=int(statistics.get("nodes") or len(node_models)),
        edge_count=int(statistics.get("edges") or len(edge_models)),
        modularity=float(statistics["modularity"]) if statistics.get("modularity") is not None else None,
        nodes=node_models if request.include_graph else [],
        edges=edge_models if request.include_graph else [],
        main_concepts=[str(value.get("name") if isinstance(value, dict) else value) for value in concepts[:20]],
        conceptual_gateways=[str(value.get("name") if isinstance(value, dict) else value) for value in gateways[:20]],
        influential_nodes=[str(value.get("name") if isinstance(value, dict) else value) for value in _first_list(payload, "influentialNodes", "topNodes")[:20]],
        important_relations=[str(value) for value in _first_list(payload, "topRelations", "relations")[:20]],
        important_term_combinations=[str(value) for value in _first_list(payload, "topBigrams", "bigrams")[:20]],
        provenance_refs=sorted({ref for s in statements for ref in s.provenance_refs}),
        warnings=[str(value) for value in _first_list(payload, "warnings")],
        limitations=["External provider metrics are normalized without asserting equivalence to local topology."],
        provider_extensions={
            "infranodus_mcp": {
                "cluster_count": len(clusters),
                "content_gap_count": len(gaps),
                "provider_graph_name": payload.get("graphName") or payload.get("name"),
                "provider_graph_url": payload.get("graphUrl") or payload.get("url"),
            }
        },
        raw_provider_result_ref=f"sha256:{raw_digest}",
        created_at=datetime.now(UTC).isoformat(),
        runtime_ms=round(runtime_ms, 3),
    )


async def analyze_infranodus(request: AnalysisRequest, statements: list[AnalysisStatement]) -> AnalysisResult:
    if not request.external_provider_permission:
        raise PermissionError("external_provider_permission is required")
    text = "\n\n".join(statement.text for statement in statements)
    if len(text) > request.external_max_characters:
        raise ValueError(
            f"external source scope has {len(text)} characters; maximum is {request.external_max_characters}"
        )
    command_json = os.environ.get("INFRANODUS_MCP_COMMAND_JSON", "").strip()
    if not command_json:
        raise RuntimeError("INFRANODUS_MCP_COMMAND_JSON is not configured")
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client

    command = json.loads(command_json)
    if not isinstance(command, list) or not command or not all(isinstance(part, str) and part for part in command):
        raise RuntimeError("INFRANODUS_MCP_COMMAND_JSON must be a non-empty JSON string array")
    params = StdioServerParameters(command=command[0], args=command[1:])
    started = time.perf_counter()
    async with stdio_client(params) as streams:
        async with ClientSession(*streams) as session:
            await session.initialize()
            tools = (await session.list_tools()).tools
            tool = next((candidate for candidate in tools if candidate.name == "analyze_text"), None)
            if tool is None:
                raise RuntimeError("InfraNodus MCP does not expose analyze_text")
            properties = (tool.inputSchema or {}).get("properties") or {}
            arguments: dict[str, Any] = {"text": text}
            if "includeGraph" in properties:
                arguments["includeGraph"] = request.include_graph
            if "includeStatements" in properties:
                arguments["includeStatements"] = False
            result = await session.call_tool(tool.name, arguments)
    if getattr(result, "isError", False):
        raise RuntimeError("InfraNodus MCP returned an error result")
    return normalize_infranodus_result(
        request,
        statements,
        _external_payload(result),
        (time.perf_counter() - started) * 1000,
    )


def _persist_result(result: AnalysisResult, statements: list[AnalysisStatement], driver: Any | None = None) -> None:
    owned_driver = driver is None
    driver = driver or _driver_from_env()
    database = os.environ.get("NEO4J_DATABASE", "").strip() or None
    try:
        driver.execute_query(
            """
            MERGE (run:KnowGraphAnalysisRun {analysis_id: $analysis_id})
            ON CREATE SET run.created_at = datetime($created_at)
            SET run:DerivedAnalysis,
                run.project_id = $project_id,
                run.provider = $provider,
                run.provider_version = $provider_version,
                run.algorithm_version = $algorithm_version,
                run.configuration_hash = $configuration_hash,
                run.source_scope_json = $source_scope_json,
                run.result_json = $result_json,
                run.epistemic_level = 'derived_analysis',
                run.updated_at = datetime()
            WITH run
            UNWIND $statement_ids AS statement_id
            MATCH (chunk:Chunk {project_id: $project_id, chunk_id: statement_id})
            MERGE (run)-[:DERIVED_FROM]->(chunk)
            """,
            analysis_id=result.analysis_id,
            created_at=result.created_at,
            project_id=result.source_scope.project_id,
            provider=result.provider,
            provider_version=result.provider_version,
            algorithm_version=result.algorithm_version,
            configuration_hash=result.configuration_hash,
            source_scope_json=json.dumps(result.source_scope.model_dump(), sort_keys=True),
            result_json=result.model_dump_json(),
            statement_ids=[statement.statement_id for statement in statements],
            database_=database,
        )
    finally:
        if owned_driver:
            driver.close()


def get_analysis(analysis_id: str, driver: Any | None = None) -> AnalysisResult | None:
    owned_driver = driver is None
    driver = driver or _driver_from_env()
    database = os.environ.get("NEO4J_DATABASE", "").strip() or None
    try:
        result = driver.execute_query(
            "MATCH (run:KnowGraphAnalysisRun {analysis_id: $analysis_id}) RETURN run.result_json AS result_json",
            analysis_id=analysis_id,
            database_=database,
        )
        records = _records(result)
        if not records:
            return None
        return AnalysisResult.model_validate_json(str(records[0].get("result_json")))
    finally:
        if owned_driver:
            driver.close()


def get_latest_analysis(project_id: str, provider: str, driver: Any | None = None) -> AnalysisResult | None:
    owned_driver = driver is None
    driver = driver or _driver_from_env()
    database = os.environ.get("NEO4J_DATABASE", "").strip() or None
    try:
        result = driver.execute_query(
            """
            MATCH (run:KnowGraphAnalysisRun {project_id: $project_id, provider: $provider})
            RETURN run.result_json AS result_json
            ORDER BY run.updated_at DESC, run.created_at DESC
            LIMIT 1
            """,
            project_id=project_id,
            provider=provider,
            database_=database,
        )
        records = _records(result)
        if not records:
            return None
        return AnalysisResult.model_validate_json(str(records[0].get("result_json")))
    finally:
        if owned_driver:
            driver.close()


def find_reusable_analysis(configuration_hash: str, provider: str, driver: Any | None = None) -> AnalysisResult | None:
    owned_driver = driver is None
    driver = driver or _driver_from_env()
    database = os.environ.get("NEO4J_DATABASE", "").strip() or None
    try:
        result = driver.execute_query(
            """
            MATCH (run:KnowGraphAnalysisRun {configuration_hash: $configuration_hash, provider: $provider})
            RETURN run.result_json AS result_json LIMIT 1
            """,
            configuration_hash=configuration_hash,
            provider=provider,
            database_=database,
        )
        records = _records(result)
        if not records:
            return None
        reused = AnalysisResult.model_validate_json(str(records[0].get("result_json")))
        return reused.model_copy(update={"reused": True})
    finally:
        if owned_driver:
            driver.close()


async def analyze(request: AnalysisRequest, driver: Any | None = None) -> AnalysisResult:
    statements = request.statements or load_canonical_statements(request.source_scope, driver)
    if request.requested_provider == "local_cleanroom":
        computed = analyze_local(request, statements)
    else:
        computed = await analyze_infranodus(request, statements)
    if request.persist:
        reusable = find_reusable_analysis(computed.configuration_hash, computed.provider, driver)
        if reusable is not None:
            return reusable
        _persist_result(computed, statements, driver)
    return computed


def analysis_evidence(analysis_id: str, topic_id: str, driver: Any | None = None) -> dict[str, Any]:
    result = get_analysis(analysis_id, driver)
    if result is None:
        raise LookupError("analysis not found")
    topic = next((node for node in result.nodes if node.id == topic_id), None)
    if topic is None:
        raise LookupError("analysis topic not found")
    owned_driver = driver is None
    driver = driver or _driver_from_env()
    database = os.environ.get("NEO4J_DATABASE", "").strip() or None
    try:
        query = driver.execute_query(
            """
            UNWIND $chunk_ids AS chunk_id
            MATCH (chunk:Chunk {project_id: $project_id, chunk_id: chunk_id})-[:HAS_CHUNK]-(doc:Document)
            RETURN DISTINCT toString(chunk.chunk_id) AS chunk_id, chunk.text AS text,
                   toString(doc.document_id) AS document_id, doc.source_name AS source_name,
                   chunk.pages AS pages, chunk.section AS section
            ORDER BY chunk_id
            """,
            chunk_ids=topic.supporting_statement_ids,
            project_id=result.source_scope.project_id,
            database_=database,
        )
        evidence = [dict(record) for record in _records(query)]
        return {"analysis_id": analysis_id, "topic": topic.model_dump(), "evidence": evidence}
    finally:
        if owned_driver:
            driver.close()


def create_analysis_view(
    *,
    analysis_id: str,
    project_id: str,
    producing_invocation: str,
    parent_view_id: str | None = None,
    driver: Any | None = None,
) -> dict[str, Any]:
    result = get_analysis(analysis_id, driver)
    if result is None or result.source_scope.project_id != project_id:
        raise LookupError("analysis not found in project scope")
    view_id = f"knowgraph-view:{hashlib.sha256(f'{analysis_id}|{producing_invocation}'.encode()).hexdigest()[:20]}"
    canonical_refs = sorted(set(result.provenance_refs))
    derived_refs = [node.id for node in result.nodes]
    view = {
        "schemaVersion": "knowgraph.graph-view.v1",
        "viewId": view_id,
        "authority": "knowgraph",
        "epistemicLevel": "derived_analysis",
        "provider": result.provider,
        "analysisRun": analysis_id,
        "sourceScope": result.source_scope.model_dump(),
        "includedCanonicalReferences": canonical_refs,
        "includedDerivedReferences": derived_refs,
        "parentViewId": parent_view_id,
        "producingInvocation": producing_invocation,
        "lifecycleState": "candidate",
        "createdAt": datetime.now(UTC).isoformat(),
    }
    owned_driver = driver is None
    driver = driver or _driver_from_env()
    database = os.environ.get("NEO4J_DATABASE", "").strip() or None
    try:
        driver.execute_query(
            """
            MATCH (run:KnowGraphAnalysisRun {analysis_id: $analysis_id, project_id: $project_id})
            MERGE (view:KnowGraphGraphView {view_id: $view_id})
            SET view.project_id = $project_id,
                view.authority = 'knowgraph',
                view.epistemic_level = 'derived_analysis',
                view.provider = $provider,
                view.view_json = $view_json,
                view.lifecycle_state = 'candidate',
                view.producing_invocation = $producing_invocation,
                view.updated_at = datetime()
            MERGE (view)-[:VIEWS_ANALYSIS]->(run)
            """,
            analysis_id=analysis_id,
            project_id=project_id,
            view_id=view_id,
            provider=result.provider,
            view_json=json.dumps(view, sort_keys=True),
            producing_invocation=producing_invocation,
            database_=database,
        )
        return view
    finally:
        if owned_driver:
            driver.close()


def get_latest_comparison(project_id: str, driver: Any | None = None) -> dict[str, Any] | None:
    owned_driver = driver is None
    driver = driver or _driver_from_env()
    database = os.environ.get("NEO4J_DATABASE", "").strip() or None
    try:
        result = driver.execute_query(
            """
            MATCH (comparison:KnowGraphProviderComparison {project_id: $project_id})
            RETURN comparison.comparison_json AS comparison_json
            ORDER BY comparison.updated_at DESC
            LIMIT 1
            """,
            project_id=project_id,
            database_=database,
        )
        records = _records(result)
        if not records:
            return None
        return json.loads(str(records[0].get("comparison_json")))
    finally:
        if owned_driver:
            driver.close()


async def compare_providers(payload: ProviderComparisonRequest, driver: Any | None = None) -> dict[str, Any]:
    base = payload.request
    statements = base.statements or load_canonical_statements(base.source_scope, driver)
    local_request = base.model_copy(
        update={"requested_provider": "local_cleanroom", "persist": payload.persist, "statements": statements}
    )
    external_request = base.model_copy(
        update={
            "requested_provider": "infranodus_mcp",
            "external_provider_permission": payload.external_provider_permission,
            "persist": payload.persist,
            "statements": statements,
        }
    )
    local = await analyze(local_request, driver)
    external = await analyze(external_request, driver)
    local_topics = {value.casefold() for value in local.main_concepts}
    external_topics = {value.casefold() for value in external.main_concepts}
    union = local_topics | external_topics
    comparison_id = f"comparison:{_json_hash({'local': local.analysis_id, 'external': external.analysis_id})[:20]}"
    comparison = {
        "schema_version": "knowgraph.provider-comparison.v1",
        "comparison_id": comparison_id,
        "source_scope": base.source_scope.model_dump(),
        "source_statement_ids": [statement.statement_id for statement in statements],
        "local_analysis_id": local.analysis_id,
        "external_analysis_id": external.analysis_id,
        "topic_overlap": round(len(local_topics & external_topics) / len(union), 6) if union else None,
        "local_gateways": local.conceptual_gateways,
        "external_gateways": external.conceptual_gateways,
        "local_gap_count": len(local.content_gap_candidates),
        "external_gap_count": len(external.content_gap_candidates),
        "provenance_coverage": {
            "local": len(local.provenance_refs),
            "external": len(external.provenance_refs),
        },
        "runtime_ms": {"local": local.runtime_ms, "external": external.runtime_ms},
        "estimated_cost": {"local": local.estimated_cost, "external": external.estimated_cost},
        "human_usefulness": None,
        "limitations": [
            "Topic overlap is descriptive only and does not score either provider as correct.",
            "Human usefulness requires an explicit reviewer judgment.",
        ],
        "created_at": datetime.now(UTC).isoformat(),
    }
    if payload.persist:
        owned_driver = driver is None
        driver = driver or _driver_from_env()
        database = os.environ.get("NEO4J_DATABASE", "").strip() or None
        try:
            driver.execute_query(
                """
                MATCH (local:KnowGraphAnalysisRun {analysis_id: $local_id})
                MATCH (external:KnowGraphAnalysisRun {analysis_id: $external_id})
                MERGE (comparison:KnowGraphProviderComparison {comparison_id: $comparison_id})
                SET comparison.project_id = $project_id,
                    comparison.epistemic_level = 'derived_evaluation',
                    comparison.comparison_json = $comparison_json,
                    comparison.updated_at = datetime()
                MERGE (comparison)-[:COMPARES]->(local)
                MERGE (comparison)-[:COMPARES]->(external)
                """,
                local_id=local.analysis_id,
                external_id=external.analysis_id,
                comparison_id=comparison_id,
                project_id=base.project_id,
                comparison_json=json.dumps(comparison, sort_keys=True),
                database_=database,
            )
        finally:
            if owned_driver:
                driver.close()
    return {"comparison": comparison, "local": local.model_dump(), "infranodus": external.model_dump()}
