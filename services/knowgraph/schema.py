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
    "aChunk", "MENdIONS", "Function"),
    ("Chunk", "MENTIONS", "Class"),
    ("Tditional_patterns": False,
}
t"),
    ("CodeFile", "IMPORTS", "CodeFile"),
    ("CodeFile", "DEFINES", "Funcion"),
    ("CodeFile", "DEFINES", "Class"),
    ("Function", "CALLS", "Function