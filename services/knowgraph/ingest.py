"""KnowGraph ingestion pipeline using Neo4j GraphRAG KG Builder."""

from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from neo4j import Driver, GraphDatabase
from neo4j_graphrag.embeddings.openai import OpenAIEmbeddings
from neo4j_graphrag.experimental.components.text_splitters.base import TextSplitter
from neo4j_graphrag.experimental.components.types import (
    LexicalGraphConfig,
    TextChunk,
    TextChunks,
)
from neo4j_graphrag.experimental.pipeline.kg_builder import SimpleKGPipeline
from neo4j_graphrag.llm.openai_llm import OpenAILLM

from neo4j_index import ensure_vector_index
from schema import KNOWGRAPH_SCHEMA

load_dotenv()

DEFAULT_CHUNK_SIZE = 1400
DEFAULT_CHUNK_OVERLAP = 200
DEFAULT_CHUNK_APPROXIMATE = True


def _sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class ChunkSpan:
    start_char: int
    end_char: int
    text: str


def _adjust_chunk_start(text: str, approximate_start: int) -> int:
    start = approximate_start
    if start > 0 and not text[start].isspace() and not text[start - 1].isspace():
        while start > 0 and not text[start - 1].isspace():
            start -= 1
        if start == 0 and text and not text[0].isspace():
            start = approximate_start
    return start


def _adjust_chunk_end(text: str, start: int, approximate_end: int) -> int:
    end = approximate_end
    if end < len(text):
        while end > start and not text[end].isspace() and not text[end - 1].isspace():
            end -= 1
        if end == start:
            end = approximate_end
    return end


def _split_with_offsets(
    text: str,
    chunk_size: int,
    chunk_overlap: int,
    approximate: bool,
) -> list[ChunkSpan]:
    if chunk_size <= 0:
        raise ValueError("chunk_size must be > 0")
    if chunk_overlap >= chunk_size:
        raise ValueError("chunk_overlap must be < chunk_size")
    if not text:
        return []

    step = chunk_size - chunk_overlap
    chunks: list[ChunkSpan] = []
    approximate_start = 0
    skip_adjust_chunk_start = False
    text_length = len(text)
    end = 0

    while end < text_length:
        if approximate:
            start = (
                approximate_start
                if skip_adjust_chunk_start
                else _adjust_chunk_start(text, approximate_start)
            )
            approximate_end = min(start + chunk_size, text_length)
            end = _adjust_chunk_end(text, start, approximate_end)
            skip_adjust_chunk_start = end == approximate_end
        else:
            start = approximate_start
            end = min(start + chunk_size, text_length)

        chunk_text = text[start:end]
        chunks.append(ChunkSpan(start_char=start, end_char=end, text=chunk_text))
        approximate_start = start + step

    return chunks


class DeterministicFixedSizeSplitter(TextSplitter):
    """Splitter that assigns deterministic chunk ids from content and offsets."""

    def __init__(
        self,
        *,
        project_id: str,
        document_id: str,
        chunk_size: int = DEFAULT_CHUNK_SIZE,
        chunk_overlap: int = DEFAULT_CHUNK_OVERLAP,
        approximate: bool = DEFAULT_CHUNK_APPROXIMATE,
    ) -> None:
        self.project_id = project_id
        self.document_id = document_id
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.approximate = approximate

    async def run(self, text: str) -> TextChunks:
        spans = _split_with_offsets(
            text=text,
            chunk_size=self.chunk_size,
            chunk_overlap=self.chunk_overlap,
            approximate=self.approximate,
        )
        chunks: list[TextChunk] = []
        for index, span in enumerate(spans):
            text_hash = _sha256_hex(span.text)
            chunk_key = f"{self.document_id}:{span.start_char}:{span.end_char}:{text_hash}"
            chunk_id = _sha256_hex(chunk_key)
            metadata = {
                "chunk_id": chunk_id,
                "start_char": span.start_char,
                "end_char": span.end_char,
                "text_hash": text_hash,
                "project_id": self.project_id,
                "document_id": self.document_id,
            }
            chunks.append(
                TextChunk(
                    text=span.text,
                    index=index,
                    metadata=metadata,
                    uid=chunk_id,
                )
            )
        return TextChunks(chunks=chunks)


def _required_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required env var: {name}")
    return value


def _merge_ingested_graph(
    driver: Driver,
    *,
    database: str | None,
    project_id: str,
    document_id: str,
    file_path: str,
) -> None:
    merge_cypher = """
    MERGE (doc:Document {project_id: $project_id, document_id: $document_id})
    ON CREATE SET doc.created_at = datetime()
    SET doc.path = $file_path,
        doc.source_name = $source_name,
        doc.ingested_at = datetime(),
        doc.project_id = $project_id,
        doc.document_id = $document_id
    WITH doc
    MATCH (raw_doc:Document {project_id: $project_id, document_id: $document_id})
    MATCH (raw_chunk:Chunk)-[:HAS_CHUNK]->(raw_doc)
    WITH doc, raw_chunk, coalesce(raw_chunk.chunk_id, raw_chunk.id) AS chunk_key
    WHERE chunk_key IS NOT NULL
    MERGE (chunk:Chunk {project_id: $project_id, document_id: $document_id, chunk_id: chunk_key})
    SET chunk.text = coalesce(raw_chunk.text, chunk.text),
        chunk.chunk_index = coalesce(raw_chunk.chunk_index, raw_chunk.index, chunk.chunk_index),
        chunk.start_char = coalesce(raw_chunk.start_char, chunk.start_char),
        chunk.end_char = coalesce(raw_chunk.end_char, chunk.end_char),
        chunk.text_hash = coalesce(raw_chunk.text_hash, chunk.text_hash),
        chunk.embedding = coalesce(raw_chunk.embedding, chunk.embedding),
        chunk.project_id = $project_id,
        chunk.document_id = $document_id
    MERGE (doc)-[:HAS_CHUNK]->(chunk)
    """
    driver.execute_query(
        merge_cypher,
        project_id=project_id,
        document_id=document_id,
        file_path=file_path,
        source_name=Path(file_path).name,
        database_=database,
    )

    provenance_cypher = """
    MATCH (raw_doc:Document {project_id: $project_id, document_id: $document_id})
    MATCH (raw_chunk:Chunk)-[:HAS_CHUNK]->(raw_doc)
    WITH raw_chunk, coalesce(raw_chunk.chunk_id, raw_chunk.id) AS chunk_key
    WHERE chunk_key IS NOT NULL
    MATCH (chunk:Chunk {project_id: $project_id, document_id: $document_id, chunk_id: chunk_key})
    MATCH (entity)-[:MENTIONS]->(raw_chunk)
    WHERE NOT entity:Chunk AND NOT entity:Document
    SET entity.project_id = $project_id,
        entity.document_id = $document_id
    MERGE (chunk)-[m:MENTIONS]->(entity)
    SET m.project_id = $project_id,
        m.document_id = $document_id,
        m.chunk_id = chunk.chunk_id
    """
    driver.execute_query(
        provenance_cypher,
        project_id=project_id,
        document_id=document_id,
        database_=database,
    )

    relationship_provenance_cypher = """
    MATCH (chunk:Chunk {project_id: $project_id, document_id: $document_id})-[:MENTIONS]->(entity)
    MATCH (entity)-[rel]->(target)
    WHERE type(rel) <> 'MENTIONS'
      AND NOT target:Chunk
      AND NOT target:Document
    SET rel.project_id = $project_id,
        rel.document_id = $document_id
    """
    driver.execute_query(
        relationship_provenance_cypher,
        project_id=project_id,
        document_id=document_id,
        database_=database,
    )


async def ingest_pdf(file_path: str, project_id: str, document_id: str) -> dict[str, Any]:
    """Run GraphRAG KG Builder ingestion for a PDF file."""
    source = Path(file_path)
    if not source.exists():
        raise FileNotFoundError(f"File not found: {file_path}")

    _required_env("OPENAI_API_KEY")
    uri = _required_env("NEO4J_URI")
    user = _required_env("NEO4J_USER")
    password = _required_env("NEO4J_PASSWORD")
    neo4j_database = os.getenv("NEO4J_DATABASE") or None

    llm_model = os.getenv("KNOWGRAPH_LLM_MODEL", "gpt-4o-mini")
    llm = OpenAILLM(
        model_name=llm_model,
        # KG Builder extraction uses structured response_format under the hood.
        model_params={"temperature": 0},
    )
    embedder = OpenAIEmbeddings(model="text-embedding-3-large")
    splitter = DeterministicFixedSizeSplitter(
        project_id=project_id,
        document_id=document_id,
        chunk_size=DEFAULT_CHUNK_SIZE,
        chunk_overlap=DEFAULT_CHUNK_OVERLAP,
        approximate=DEFAULT_CHUNK_APPROXIMATE,
    )
    lexical_graph_config = LexicalGraphConfig(
        document_node_label="Document",
        chunk_node_label="Chunk",
        chunk_to_document_relationship_type="HAS_CHUNK",
        next_chunk_relationship_type="RELATED_TO",
        node_to_chunk_relationship_type="MENTIONS",
        chunk_id_property="chunk_id",
        chunk_index_property="chunk_index",
        chunk_text_property="text",
        chunk_embedding_property="embedding",
    )

    driver = GraphDatabase.driver(uri, auth=(user, password))
    try:
        driver.verify_connectivity()
        ensure_vector_index(driver, neo4j_database)

        pipeline = SimpleKGPipeline(
            llm=llm,
            driver=driver,
            embedder=embedder,
            schema=KNOWGRAPH_SCHEMA,
            from_pdf=True,
            text_splitter=splitter,
            on_error="RAISE",
            perform_entity_resolution=True,
            lexical_graph_config=lexical_graph_config,
            neo4j_database=neo4j_database,
        )

        result = await pipeline.run_async(
            file_path=str(source),
            document_metadata={
                "project_id": project_id,
                "document_id": document_id,
                "source_path": str(source.resolve()),
                "source_name": source.name,
            },
        )

        _merge_ingested_graph(
            driver,
            database=neo4j_database,
            project_id=project_id,
            document_id=document_id,
            file_path=str(source.resolve()),
        )
        ensure_vector_index(driver, neo4j_database)

        return {
            "run_id": result.run_id,
            "project_id": project_id,
            "document_id": document_id,
        }
    finally:
        driver.close()
