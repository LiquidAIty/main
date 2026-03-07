"""Neo4j index helpers for KnowGraph."""

from __future__ import annotations

import math
from typing import Optional

from neo4j import Driver


VECTOR_INDEX_NAME = "chunk_embedding_idx"


def _as_int(value: object) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            return None
        return int(value)
    to_native = getattr(value, "to_native", None)
    if callable(to_native):
        try:
            native = to_native()
            if isinstance(native, int):
                return native
            if isinstance(native, float) and math.isfinite(native):
                return int(native)
        except Exception:
            return None
    try:
        return int(value)  # type: ignore[arg-type]
    except Exception:
        return None


def _vector_index_cypher(dimensions: int) -> str:
    return f"""
CREATE VECTOR INDEX {VECTOR_INDEX_NAME} IF NOT EXISTS
FOR (c:Chunk) ON (c.embedding)
OPTIONS {{
  indexConfig: {{
    `vector.dimensions`: {dimensions},
    `vector.similarity_function`: 'cosine'
  }}
}}
"""


def _extract_dimensions(options: object) -> int | None:
    if not isinstance(options, dict):
        return None
    index_config = options.get("indexConfig")
    if not isinstance(index_config, dict):
        return None
    raw = index_config.get("vector.dimensions")
    return _as_int(raw)


def _result_records(result: object) -> list:
    records = getattr(result, "records", None)
    if isinstance(records, list):
        return records
    if isinstance(result, tuple) and result:
        first = result[0]
        if isinstance(first, list):
            return first
    return []


def ensure_vector_index(
    driver: Driver,
    database: Optional[str] = None,
    dimensions: int = 3072,
) -> None:
    """Create the chunk embedding vector index if it does not already exist."""
    safe_dimensions = max(1, int(dimensions))

    existing = driver.execute_query(
        """
        SHOW VECTOR INDEXES
        YIELD name, options
        WHERE name = $name
        RETURN options
        """,
        name=VECTOR_INDEX_NAME,
        database_=database,
    )
    records = _result_records(existing)
    if records:
        current_options = records[0].get("options")
        current_dimensions = _extract_dimensions(current_options)
        if current_dimensions is not None and current_dimensions != safe_dimensions:
            driver.execute_query(
                f"DROP INDEX {VECTOR_INDEX_NAME} IF EXISTS",
                database_=database,
            )

    driver.execute_query(_vector_index_cypher(safe_dimensions), database_=database)
