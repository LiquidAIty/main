# @graph entity: Local Gemma Chunker
# @graph role: local-indexing-chunk-worker
# @graph relates_to: Research Memory Delta
# @graph depends_on: Docker Model Runner
# @graph feeds_to: Research Memory Delta
"""Local Gemma chunker for the research-memory index (Python rails).

Local Gemma (Docker Model Runner ``ai/gemma3-qat``) is an INDEXING WORKER ONLY:
it splits already-retained text into retrieval-sized chunks. It must never
research the web, decide what is worth retaining, generate the user-facing
answer, make OWL claims, resolve entities, or inspect project history — the
caller passes it only the explicitly retained material.

The chunker is faithful by construction: returned chunks must be derived from
the input (whitespace-normalized substring check), so Gemma cannot inject
fabricated content into the index. If the local model is unavailable or returns
unfaithful output, it fails honestly — there is NO cloud fallback.

Stdlib only (urllib) so unit tests can inject a fake transport.

    python services/knowgraph/gemma_chunker.py probe
"""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Callable

DEFAULT_GEMMA_CHAT_URL = "http://localhost:12434/engines/v1/chat/completions"
DEFAULT_GEMMA_MODEL = "ai/gemma3-qat:latest"
MAX_CHUNK_CHARS = 1200

_CHUNK_SYSTEM_PROMPT = (
    "You are a local text-chunking worker. You ONLY split text into retrieval-sized "
    "chunks. Do not research, do not summarize, do not add or invent any words, do not "
    "answer questions, do not make claims. Return a JSON array of strings where each "
    "string is a VERBATIM contiguous segment of the input text, in order, together "
    "covering the meaningful content. Return only the JSON array."
)


class GemmaChunkerError(RuntimeError):
    """Local Gemma chunker unavailable or returned unusable/unfaithful output.
    Never fall back to a cloud model — fail honestly."""


@dataclass(frozen=True)
class GemmaChunkerConfig:
    url: str = DEFAULT_GEMMA_CHAT_URL
    model: str = DEFAULT_GEMMA_MODEL
    timeout_s: float = 120.0
    max_chunk_chars: int = MAX_CHUNK_CHARS

    @classmethod
    def from_env(cls) -> "GemmaChunkerConfig":
        return cls(
            url=(os.getenv("GEMMA_CHUNKER_URL") or DEFAULT_GEMMA_CHAT_URL).strip(),
            model=(os.getenv("GEMMA_CHUNKER_MODEL") or DEFAULT_GEMMA_MODEL).strip(),
            timeout_s=float(os.getenv("GEMMA_CHUNKER_TIMEOUT_S") or "120"),
        )


def _http_post_json(url: str, payload: dict, timeout_s: float) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            raw = resp.read()
    except urllib.error.URLError as exc:
        raise GemmaChunkerError(f"local Gemma chunker unreachable at {url}: {getattr(exc, 'reason', exc)}") from exc
    try:
        return json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as exc:
        raise GemmaChunkerError(f"local Gemma chunker returned non-JSON from {url}") from exc


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip().lower()


def _extract_json_array(content: str) -> list[str]:
    content = str(content or "").strip()
    # tolerate ```json fences / surrounding prose: take the first [...] block
    match = re.search(r"\[.*\]", content, re.DOTALL)
    if not match:
        raise GemmaChunkerError("local Gemma chunker did not return a JSON array")
    try:
        parsed = json.loads(match.group(0))
    except ValueError as exc:
        raise GemmaChunkerError("local Gemma chunker returned malformed JSON array") from exc
    if not isinstance(parsed, list):
        raise GemmaChunkerError("local Gemma chunker output was not a list")
    return [str(p) for p in parsed if str(p).strip()]


def chunk_text(
    text: str,
    *,
    config: GemmaChunkerConfig | None = None,
    transport: Callable[[str, dict, float], dict] | None = None,
) -> list[str]:
    """Chunk one retained text unit with the local Gemma model.

    Faithful by construction: every returned chunk must be a whitespace-normalized
    substring of the input. Raises GemmaChunkerError on any unavailability or
    unfaithful output (no cloud fallback).
    """
    cleaned = str(text or "").strip()
    if not cleaned:
        return []
    config = config or GemmaChunkerConfig.from_env()
    transport = transport or _http_post_json

    body = transport(
        config.url,
        {
            "model": config.model,
            "temperature": 0,
            "messages": [
                {"role": "system", "content": _CHUNK_SYSTEM_PROMPT},
                {"role": "user", "content": cleaned},
            ],
        },
        config.timeout_s,
    )
    try:
        content = body["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise GemmaChunkerError("local Gemma chunker response missing message content") from exc

    chunks = _extract_json_array(content)
    if not chunks:
        raise GemmaChunkerError("local Gemma chunker produced no chunks")

    normalized_input = _norm(cleaned)
    faithful: list[str] = []
    for chunk in chunks:
        piece = chunk.strip()[: config.max_chunk_chars]
        if not piece:
            continue
        if _norm(piece) not in normalized_input:
            # Gemma added/altered content — refuse rather than index fabricated text.
            raise GemmaChunkerError("local Gemma chunker returned content not present in the input")
        faithful.append(piece)
    if not faithful:
        raise GemmaChunkerError("local Gemma chunker produced no faithful chunks")
    return faithful


def probe(*, config: GemmaChunkerConfig | None = None) -> list[str]:
    sample = ("Redwire Corporation trades on the NYSE under the ticker symbol RDW. "
              "SpaceX is a private company; its current valuation is reported in secondary markets.")
    return chunk_text(sample, config=config)


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Local Gemma chunker probe")
    parser.add_argument("command", choices=["probe"])
    parser.parse_args(argv)
    config = GemmaChunkerConfig.from_env()
    try:
        chunks = probe(config=config)
    except GemmaChunkerError as exc:
        print(f"LOCAL_GEMMA_CHUNKER_NOT_CONFIGURED url={config.url} model={config.model} blocker={exc}")
        return 2
    print(f"LOCAL_GEMMA_CHUNKER_LIVE url={config.url} model={config.model} chunks={len(chunks)}")
    for c in chunks:
        print(f"  - {c[:100]}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
