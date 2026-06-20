# @graph entity: KnowGraph EmbeddingGemma Client
# @graph role: local-embedding-client
# @graph relates_to: KnowGraph Assertion Vectors
# @graph depends_on: Docker Model Runner
# @graph feeds_to: KnowGraph
"""Local EmbeddingGemma client for the KnowGraph Python rails.

Calls Docker Model Runner's local, OpenAI-compatible *embeddings* endpoint
(default ``http://localhost:12434/engines/v1/embeddings``) with the locally
installed ``ai/embeddinggemma`` model. This is the ONLY model call this module
makes:

* it posts to the ``/embeddings`` path only — it never touches a chat /
  completion endpoint, and
* the default endpoint is loopback (Docker Model Runner) — it never reaches a
  remote provider.

The embedding dimension is *observed* from the live response, never assumed:
``probe_dimension`` returns whatever the endpoint actually produces, and
``embed_texts`` validates that every vector matches the dimension the caller
expects (failing honestly on mismatch). Used by ``assertion_vectors.py`` to
embed ``SourceBackedAssertion.retrieval_summary`` text for KnowGraph GraphRAG.

Stdlib only (urllib) so unit tests can mock the transport without new deps.

    python services/knowgraph/embeddinggemma.py probe
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Sequence

# Loopback Docker Model Runner embeddings endpoint + model. Overridable by env
# for other local hosts, but the defaults keep the call local and on the
# embeddings path (never chat/completions).
DEFAULT_EMBEDDINGS_URL = "http://localhost:12434/engines/v1/embeddings"
DEFAULT_MODEL = "ai/embeddinggemma"
# Live-proven dimension for ai/embeddinggemma via DMR. Callers should still
# probe (probe_dimension) before relying on it — never hardcode a guess into a
# vector index.
PROVEN_DIM = 768
MAX_BATCH = 64


class EmbeddingGemmaError(RuntimeError):
    """Raised when the local embedding endpoint/model is unavailable or returns
    a malformed or wrong-dimension response. Fail honestly: never fabricate a
    vector and never silently fall back to a remote or chat model."""


@dataclass(frozen=True)
class EmbeddingGemmaConfig:
    url: str = DEFAULT_EMBEDDINGS_URL
    model: str = DEFAULT_MODEL
    timeout_s: float = 60.0

    @classmethod
    def from_env(cls) -> "EmbeddingGemmaConfig":
        return cls(
            url=(os.getenv("EMBEDDINGGEMMA_URL") or DEFAULT_EMBEDDINGS_URL).strip(),
            model=(os.getenv("EMBEDDINGGEMMA_MODEL") or DEFAULT_MODEL).strip(),
            timeout_s=float(os.getenv("EMBEDDINGGEMMA_TIMEOUT_S") or "60"),
        )


def _http_post_json(url: str, payload: dict, timeout_s: float) -> dict:
    """POST JSON, parse JSON response, using only the stdlib. Connection/HTTP
    failures are converted to an honest EmbeddingGemmaError."""
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout_s) as response:
            raw = response.read()
    except urllib.error.HTTPError as exc:  # endpoint reachable but errored
        body = ""
        try:
            body = exc.read().decode("utf-8", errors="replace")[:300]
        except Exception:
            pass
        raise EmbeddingGemmaError(
            f"local embedding endpoint returned HTTP {exc.code} from {url}: {body}"
        ) from exc
    except urllib.error.URLError as exc:  # refused / DNS / timeout
        raise EmbeddingGemmaError(
            f"local embedding endpoint unreachable at {url}: {exc.reason}"
        ) from exc
    try:
        return json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as exc:
        raise EmbeddingGemmaError(
            f"local embedding endpoint returned non-JSON from {url}"
        ) from exc


def _extract_vectors(body: object, expected_count: int) -> list[list[float]]:
    data = body.get("data") if isinstance(body, dict) else None
    if not isinstance(data, list) or len(data) != expected_count:
        raise EmbeddingGemmaError(
            f"embedding response had {0 if not isinstance(data, list) else len(data)} "
            f"vectors, expected {expected_count}"
        )
    # OpenAI-compatible payload exposes each vector under its input index.
    ordered = sorted(
        data,
        key=lambda item: item.get("index", 0) if isinstance(item, dict) else 0,
    )
    vectors: list[list[float]] = []
    for item in ordered:
        embedding = item.get("embedding") if isinstance(item, dict) else None
        if not isinstance(embedding, list) or not embedding:
            raise EmbeddingGemmaError("embedding response contained a missing/empty vector")
        try:
            vectors.append([float(component) for component in embedding])
        except (TypeError, ValueError) as exc:
            raise EmbeddingGemmaError("embedding response contained non-numeric values") from exc
    return vectors


def embed_texts(
    texts: Sequence[str],
    *,
    config: EmbeddingGemmaConfig | None = None,
    expected_dim: int | None = PROVEN_DIM,
) -> list[list[float]]:
    """Embed a bounded batch of non-empty strings with the local model.

    Validates that every returned vector has ``expected_dim`` (pass ``None`` to
    accept whatever the endpoint reports, e.g. when probing). Raises
    EmbeddingGemmaError on any endpoint/shape/dimension problem rather than
    returning a fabricated or partial result.
    """
    config = config or EmbeddingGemmaConfig.from_env()
    items = list(texts)
    if not items:
        return []
    if len(items) > MAX_BATCH:
        raise EmbeddingGemmaError(
            f"batch of {len(items)} exceeds MAX_BATCH={MAX_BATCH}; chunk before embedding"
        )
    if any(not isinstance(text, str) or not text.strip() for text in items):
        raise EmbeddingGemmaError("every text to embed must be a non-empty string")

    body = _http_post_json(
        config.url,
        {"model": config.model, "input": items},
        config.timeout_s,
    )
    vectors = _extract_vectors(body, len(items))
    dimensions = {len(vector) for vector in vectors}
    if len(dimensions) != 1:
        raise EmbeddingGemmaError(
            f"endpoint returned inconsistent vector dimensions: {sorted(dimensions)}"
        )
    observed = dimensions.pop()
    if expected_dim is not None and observed != expected_dim:
        raise EmbeddingGemmaError(
            f"expected {expected_dim}-dim vectors but {config.model} returned {observed}"
        )
    return vectors


def embed_text(
    text: str,
    *,
    config: EmbeddingGemmaConfig | None = None,
    expected_dim: int | None = PROVEN_DIM,
) -> list[float]:
    """Embed a single non-empty string. Convenience wrapper over embed_texts."""
    return embed_texts([text], config=config, expected_dim=expected_dim)[0]


def probe_dimension(
    *,
    config: EmbeddingGemmaConfig | None = None,
    sample: str = "dimension probe",
) -> int:
    """Hit the live endpoint once and return the dimension it actually produces.

    Never assumes PROVEN_DIM: the returned value is whatever the model emits,
    so a vector index can be created from an observed dimension.
    """
    vectors = embed_texts([sample], config=config, expected_dim=None)
    return len(vectors[0])


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Local EmbeddingGemma probe (KnowGraph Python rails)")
    parser.add_argument("command", choices=["probe"], help="probe the live embedding dimension")
    args = parser.parse_args(argv)

    config = EmbeddingGemmaConfig.from_env()
    if args.command == "probe":
        try:
            dim = probe_dimension(config=config)
        except EmbeddingGemmaError as exc:
            print(f"EMBEDDING_ENDPOINT_BLOCKED url={config.url} model={config.model} blocker={exc}")
            return 2
        print(f"EMBEDDING_ENDPOINT_LIVE url={config.url} model={config.model} dim={dim}")
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
