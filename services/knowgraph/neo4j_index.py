"""Neo4j index helpers for KnowGraph."""

from __future__ import annotations

from typing import Optional

from neo4j import Driver


VECTOR_INDEX_CYPHER = """
CREATE VECTOR INDEX chunk_embedding_idx IF NOT EXISTS
FOR (c:Chunk) ON (c.embedding)
OPTIONS {
  indexConfig: {
    `vector.dimensions`: 3072,
    `vector.similarity_function`: 'cosine'
  }
}
"""


def ensure_vector_index(driver: Driver, database: Optional[str] = None) -> None:
    """Create the chunk embedding vector index if it does not already exist."""
    driver.execute_query(VECTOR_INDEX_CYPHER, database_=database)
