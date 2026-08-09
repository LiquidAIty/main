"""Bounded, transient observations for the live ThinkGraph presentation layer.

This module is deliberately stateless.  It recognizes visible lexical material
and proximity only; it does not establish semantic or durable graph truth.
"""

from __future__ import annotations

from collections import Counter
from hashlib import sha256
import re
from typing import Any


_SOURCES = {"user", "assistant", "reasoning", "tool"}
_RELATION_BY_SOURCE = {
    "user": "user-near",
    "assistant": "answer-near",
    "reasoning": "reasoning-near",
    "tool": "observed-near",
}
_ALLOWED_RELATIONS = set(_RELATION_BY_SOURCE.values()) | {"mentioned-with"}
_TOKEN_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_+.#/-]*")
_CLAUSE_RE = re.compile(r"[.!?;,\n:]+")
_STOP_WORDS = {
    "a", "about", "add", "after", "again", "all", "also", "am", "an",
    "and", "another", "any", "are", "as", "at", "be", "because", "been",
    "before", "being", "but", "by", "can", "could", "did", "do", "does",
    "doing", "don", "done", "each", "for", "from", "get", "go", "had",
    "has", "have", "having", "he", "her", "here", "hers", "him", "his",
    "how", "i", "if", "in", "into", "is", "it", "its", "just", "let",
    "like", "may", "me", "might", "more", "most", "my", "no", "not", "of",
    "on", "once", "only", "or", "other", "our", "out", "over", "please",
    "same", "she", "should", "so", "some", "such", "than", "that", "the",
    "their", "them", "then", "there", "these", "they", "this", "those",
    "through", "to", "too", "under", "up", "us", "use", "very", "was",
    "we", "were", "what", "when", "where", "which", "while", "who", "why",
    "will", "with", "would", "you", "your",
}
_MAX_STREAMS = 8
_MAX_TEXT_PER_STREAM = 6_000
_MAX_TOTAL_TEXT = 16_000
_MAX_NODES = 32
_MAX_EDGES = 64


def _stable_id(*parts: str) -> str:
    digest = sha256("\x1f".join(parts).encode("utf-8")).hexdigest()[:20]
    return f"tg-live:{digest}"


def _normalized_token(value: str) -> str:
    return value.strip("-_/.").casefold()


def _is_content_token(value: str) -> bool:
    normalized = _normalized_token(value)
    return (
        len(normalized) >= 3
        and normalized not in _STOP_WORDS
        and not normalized.isdigit()
    )


def _phrase_candidates(text: str) -> list[dict[str, Any]]:
    """Return ranked lexical phrases without asserting what they mean."""
    candidates: dict[str, dict[str, Any]] = {}
    occurrence = 0
    for clause in _CLAUSE_RE.split(text):
        tokens = [match.group(0) for match in _TOKEN_RE.finditer(clause)]
        for index, token in enumerate(tokens):
            if not _is_content_token(token):
                continue
            windows: list[list[str]] = [[token]]
            for size in (2, 3):
                window = tokens[index:index + size]
                if len(window) == size and all(_is_content_token(item) for item in window):
                    windows.append(window)
            for window in windows:
                label = " ".join(window)
                normalized = " ".join(_normalized_token(item) for item in window)
                if not normalized:
                    continue
                entry = candidates.setdefault(
                    normalized,
                    {
                        "normalized": normalized,
                        "label": label,
                        "count": 0,
                        "first": occurrence,
                        "token_count": len(window),
                        "explicit": any(
                            any(marker in item for marker in ("_", "/", ".", "+"))
                            or (len(item) > 1 and item.isupper())
                            for item in window
                        ),
                    },
                )
                entry["count"] += 1
            occurrence += 1

    for entry in candidates.values():
        entry["score"] = (
            (entry["count"] * 4)
            + (3 if entry["token_count"] == 2 else 2 if entry["token_count"] == 3 else 0)
            + (2 if entry["explicit"] else 0)
            + (1 if len(entry["normalized"]) >= 8 else 0)
        )
    return sorted(
        candidates.values(),
        key=lambda item: (-item["score"], item["first"], item["normalized"]),
    )


def _bounded_int(value: Any, *, default: int, low: int, high: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return max(low, min(high, parsed))


def project_live_thinkgraph(payload: dict[str, Any]) -> dict[str, Any]:
    """Project a bounded current-turn payload into observational graph records."""
    project_id = str(payload.get("projectId") or "").strip()
    conversation_id = str(payload.get("conversationId") or "").strip()
    run_id = str(payload.get("runId") or "").strip()
    observed_at = str(payload.get("observedAt") or "").strip()
    state = "settled" if payload.get("state") == "settled" else "active"
    max_nodes = _bounded_int(payload.get("maxNodes"), default=24, low=1, high=_MAX_NODES)
    max_edges = _bounded_int(payload.get("maxEdges"), default=40, low=0, high=_MAX_EDGES)
    if not project_id:
        raise ValueError("projectId required")
    if not conversation_id:
        raise ValueError("conversationId required")
    if not run_id:
        raise ValueError("runId required")
    if not observed_at:
        raise ValueError("observedAt required")

    raw_streams = payload.get("streams")
    if not isinstance(raw_streams, list):
        raise ValueError("streams must be a list")

    streams: list[dict[str, str]] = []
    total_text = 0
    for raw in raw_streams[:_MAX_STREAMS]:
        if not isinstance(raw, dict):
            continue
        source = str(raw.get("source") or "").strip().casefold()
        source_id = str(raw.get("sourceId") or "").strip()
        text = str(raw.get("text") or "")[:_MAX_TEXT_PER_STREAM]
        if source not in _SOURCES or not source_id or not text.strip():
            continue
        remaining = _MAX_TOTAL_TEXT - total_text
        if remaining <= 0:
            break
        text = text[:remaining]
        total_text += len(text)
        streams.append({"source": source, "sourceId": source_id, "text": text})

    per_stream_limit = max(1, min(10, max_nodes // max(1, len(streams))))
    selected: list[dict[str, Any]] = []
    for stream_index, stream in enumerate(streams):
        phrases = _phrase_candidates(stream["text"])[:per_stream_limit]
        for phrase in phrases:
            selected.append({**phrase, **stream, "stream_index": stream_index})

    selected.sort(
        key=lambda item: (-item["score"], item["stream_index"], item["first"], item["normalized"]),
    )
    selected = selected[:max_nodes]

    nodes: list[dict[str, Any]] = []
    node_by_stream_phrase: dict[tuple[int, str], dict[str, Any]] = {}
    phrase_groups: dict[str, list[dict[str, Any]]] = {}
    for item in selected:
        node_id = _stable_id(
            run_id,
            item["source"],
            item["sourceId"],
            item["normalized"],
        )
        node = {
            "id": node_id,
            "canonicalId": node_id,
            "label": item["label"],
            "type": "live_observation",
            "authority": "thinkgraph",
            "projectId": project_id,
            "conversationId": conversation_id,
            "runId": run_id,
            "currentState": state,
            "mentionCount": item["count"],
            "lastMentionedAt": observed_at,
            "properties": {
                "source": item["source"],
                "sourceId": item["sourceId"],
                "conversationId": conversation_id,
                "runId": run_id,
                "observedAt": observed_at,
                "state": state,
                "persisted": False,
                "transient": True,
                "occurrences": item["count"],
            },
            "provenance": {
                "source": item["source"],
                "sourceId": item["sourceId"],
                "observational": True,
            },
        }
        nodes.append(node)
        node_by_stream_phrase[(item["stream_index"], item["normalized"])] = node
        phrase_groups.setdefault(item["normalized"], []).append(node)

    edges: list[dict[str, Any]] = []
    edge_keys: set[tuple[str, str, str]] = set()

    def append_edge(source_id: str, target_id: str, relation: str) -> None:
        if source_id == target_id or len(edges) >= max_edges or relation not in _ALLOWED_RELATIONS:
            return
        ordered = (source_id, target_id) if source_id < target_id else (target_id, source_id)
        key = (ordered[0], ordered[1], relation)
        if key in edge_keys:
            return
        edge_keys.add(key)
        edge_id = _stable_id(run_id, relation, ordered[0], ordered[1])
        edges.append({
            "id": edge_id,
            "source": source_id,
            "target": target_id,
            "predicate": relation,
            "mentionCount": 1,
            "lastMentionedAt": observed_at,
            "properties": {
                "relation": relation,
                "observational": True,
                "persisted": False,
                "observedAt": observed_at,
                "state": state,
            },
            "provenance": {"observational": True},
        })

    for stream_index, stream in enumerate(streams):
        ordered_phrases = sorted(
            (
                item for item in selected
                if item["stream_index"] == stream_index
            ),
            key=lambda item: (item["first"], -item["token_count"], item["normalized"]),
        )
        ordered_nodes = [
            node_by_stream_phrase[(stream_index, item["normalized"])]
            for item in ordered_phrases
        ]
        for left, right in zip(ordered_nodes, ordered_nodes[1:]):
            append_edge(left["id"], right["id"], _RELATION_BY_SOURCE[stream["source"]])

    for same_phrase_nodes in phrase_groups.values():
        if len(same_phrase_nodes) < 2:
            continue
        for left, right in zip(same_phrase_nodes, same_phrase_nodes[1:]):
            append_edge(left["id"], right["id"], "mentioned-with")

    return {
        "schemaVersion": "thinkgraph.live.projection.v1",
        "authority": "thinkgraph",
        "projectId": project_id,
        "revision": run_id,
        "counts": {"nodes": len(nodes), "edges": len(edges)},
        "nodes": nodes,
        "edges": edges,
    }

