"""Conservative graph schema for KnowGraph ingestion."""

from __future__ import annotations

NODE_TYPES: list[dict[str, object]] = [
    {
        "label": "Document",
        "description": "An ingested source document.",
        "properties": [{"name": "document_id", "type": "STRING"}],
        "additional_properties": True,
    },
    {
        "label": "Chunk",
        "description": "A text chunk from a document.",
        "properties": [{"name": "chunk_id", "type": "STRING"}],
        "additional_properties": True,
    },
    {
        "label": "Concept",
        "description": "A domain concept or idea.",
        "properties": [{"name": "name", "type": "STRING"}],
        "additional_properties": True,
    },
    {
        "label": "Person",
        "description": "A named individual.",
        "properties": [{"name": "name", "type": "STRING"}],
        "additional_properties": True,
    },
    {
        "label": "Organization",
        "description": "A company, institution, or group.",
        "properties": [{"name": "name", "type": "STRING"}],
        "additional_properties": True,
    },
    {
        "label": "Technology",
        "description": "A technical method, component, or system.",
        "properties": [{"name": "name", "type": "STRING"}],
        "additional_properties": True,
    },
    {
        "label": "Material",
        "description": "A substance or material.",
        "properties": [{"name": "name", "type": "STRING"}],
        "additional_properties": True,
    },
    {
        "label": "Process",
        "description": "An operation, workflow, or process.",
        "properties": [{"name": "name", "type": "STRING"}],
        "additional_properties": True,
    },
]

RELATIONSHIP_TYPES: list[dict[str, object]] = [
    {"label": "HAS_CHUNK", "description": "Document to chunk containment."},
    {"label": "MENTIONS", "description": "Chunk-to-entity provenance mention."},
    {"label": "RELATED_TO", "description": "General semantic association."},
    {"label": "USES", "description": "Dependency or usage relationship."},
    {"label": "PART_OF", "description": "Part-whole relationship."},
    {"label": "EVIDENCE_FOR", "description": "Evidence supports a claim/concept."},
    {"label": "IMPORTS", "description": "Code file imports another."},
    {"label": "DEFINES", "description": "File defines function/class."},
    {"label": "CALLS", "description": "Function calls another function."},
    # General source-grounded semantic relationship types (just-enough semantics).
    # Used by the existing-chunk enrichment writer for genuine extraction; every type a
    # genuine relationship uses is validated against THIS allowlist before it is written
    # (via apoc.merge.relationship). General, not source-specific — avoids ontology bloat.
    {"label": "DESCRIBES", "description": "A describes or characterizes B."},
    {"label": "RECOMMENDS", "description": "Source recommends B."},
    {"label": "WARNS_AGAINST", "description": "Source warns against B."},
    {"label": "ENABLES", "description": "A enables B."},
    {"label": "REQUIRES", "description": "A requires B."},
    {"label": "SUPPORTS", "description": "A supports B."},
    {"label": "DEPENDS_ON", "description": "A depends on B."},
    {"label": "REPRESENTS", "description": "A represents/maps B."},
    {"label": "OWNED_BY", "description": "A is owned or stewarded by B."},
    {"label": "SOURCED_FROM", "description": "A is sourced from B."},
    {"label": "CONSUMES", "description": "A consumes B."},
    {"label": "APPLIES_TO", "description": "A applies to B."},
    {"label": "DERIVED_FROM", "description": "A is derived from B."},
    {"label": "TRACKS", "description": "A tracks or records B."},
    {"label": "DISCUSSED_IN", "description": "A is discussed in B."},
]

PATTERNS: list[tuple[str, str, str]] = [
    ("Document", "HAS_CHUNK", "Chunk"),
    ("Chunk", "MENTIONS", "Concept"),
    ("Chunk", "MENTIONS", "Person"),
    ("Chunk", "MENTIONS", "Organization"),
    ("Chunk", "MENTIONS", "Technology"),
    ("Chunk", "MENTIONS", "Material"),
    ("Chunk", "MENTIONS", "Process"),
    ("Technology", "USES", "Material"),
    ("Process", "USES", "Technology"),
    ("Process", "PART_OF", "Process"),
    ("Concept", "RELATED_TO", "Concept"),
    ("Person", "RELATED_TO", "Organization"),
    ("Organization", "EVIDENCE_FOR", "Concept"),
    ("Person", "EVIDENCE_FOR", "Concept"),
]

KNOWGRAPH_SCHEMA: dict[str, object] = {
    "node_types": NODE_TYPES,
    "relationship_types": RELATIONSHIP_TYPES,
    "patterns": PATTERNS,
    "additional_node_types": False,
    "additional_relationship_types": False,
    "additional_patterns": False,
}