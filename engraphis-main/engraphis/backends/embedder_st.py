"""Offline-only lazy SentenceTransformer adapter and embedder factory.

Configured semantic models are resolved from the local Hugging Face cache (or
an explicit local directory) and are constructed only by the first operation
that actually requests vectors. Nonsemantic Engraphis operations can therefore
open the store and serve immediately while semantic state remains ``cold``.
"""
from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import threading
from typing import Any, Dict, Literal, Optional, Tuple

import numpy as np

from engraphis.backends.embedder_deterministic import DeterministicEmbedder


LOCAL_EMBEDDING_MODEL_UNAVAILABLE = "local_embedding_model_unavailable"


class LocalEmbeddingModelUnavailable(RuntimeError):
    """The configured semantic model cannot be loaded from local storage."""

    def __init__(self) -> None:
        super().__init__(LOCAL_EMBEDDING_MODEL_UNAVAILABLE)


@dataclass
class _ModelSlot:
    state: str = "cold"
    model: Any = None
    local_path: str = ""
    error: str = ""
    initializations: int = 0


_MODEL_CONDITION = threading.Condition(threading.RLock())
_MODEL_SLOTS: Dict[Tuple[str, Optional[str]], _ModelSlot] = {}

#: Why the configured local embedder last failed to load ("" when ready/cold).
LAST_EMBEDDER_ERROR = ""


def _offline_environment() -> None:
    """Enforce offline behavior before importing Transformers dependencies."""
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"


def _cache_root() -> Path:
    explicit = os.environ.get("HUGGINGFACE_HUB_CACHE", "").strip()
    if explicit:
        return Path(explicit).expanduser()
    hf_home = os.environ.get("HF_HOME", "").strip()
    if hf_home:
        return Path(hf_home).expanduser() / "hub"
    return Path.home() / ".cache" / "huggingface" / "hub"


def _is_local_model_directory(path: Path) -> bool:
    if not path.is_dir():
        return False
    if not (path / "modules.json").is_file() or not (path / "config.json").is_file():
        return False
    return any(
        candidate.is_file()
        for candidate in (path / "model.safetensors", path / "pytorch_model.bin")
    )


def _resolve_local_model_path(model_name: str, revision: Optional[str]) -> Path:
    """Resolve an explicit path or a complete local snapshot without network access."""
    direct = Path(model_name).expanduser()
    if _is_local_model_directory(direct):
        return direct.resolve()

    model_root = _cache_root() / ("models--" + model_name.replace("/", "--"))
    snapshots = model_root / "snapshots"
    candidates = []
    if revision:
        candidates.append(snapshots / revision)
        ref_path = model_root / "refs" / revision
        try:
            snapshot_id = ref_path.read_text(encoding="utf-8").strip()
        except (OSError, UnicodeError):
            snapshot_id = ""
        if snapshot_id:
            candidates.append(snapshots / snapshot_id)
    else:
        main_ref = model_root / "refs" / "main"
        try:
            snapshot_id = main_ref.read_text(encoding="utf-8").strip()
        except (OSError, UnicodeError):
            snapshot_id = ""
        if snapshot_id:
            candidates.append(snapshots / snapshot_id)
        if snapshots.is_dir():
            candidates.extend(sorted(snapshots.iterdir(), key=lambda item: item.name))

    for candidate in candidates:
        if _is_local_model_directory(candidate):
            return candidate.resolve()
    raise LocalEmbeddingModelUnavailable()


def _construct_local_sentence_transformer(local_path: Path) -> Any:
    _offline_environment()
    from sentence_transformers import SentenceTransformer  # lazy optional dependency

    return SentenceTransformer(str(local_path), local_files_only=True)


def _slot_key(
    model_name: str,
    revision: Optional[str],
) -> Tuple[str, Optional[str]]:
    return model_name, revision


def _load_local_model(
    model_name: str,
    revision: Optional[str],
    expected_dim: int,
) -> Any:
    """Construct a configured local model once per process, even concurrently."""
    global LAST_EMBEDDER_ERROR
    key = _slot_key(model_name, revision)
    with _MODEL_CONDITION:
        slot = _MODEL_SLOTS.setdefault(key, _ModelSlot())
        while slot.state == "loading":
            _MODEL_CONDITION.wait()
        if slot.state == "ready":
            actual_dim = int(slot.model.get_embedding_dimension())
            if expected_dim and actual_dim != int(expected_dim):
                raise LocalEmbeddingModelUnavailable()
            return slot.model
        if slot.state == "unavailable":
            raise LocalEmbeddingModelUnavailable()
        slot.state = "loading"
        slot.initializations += 1

    try:
        local_path = _resolve_local_model_path(model_name, revision)
        model = _construct_local_sentence_transformer(local_path)
        actual_dim = int(model.get_embedding_dimension())
        if expected_dim and actual_dim != int(expected_dim):
            raise ValueError("configured_embedding_dimension_mismatch")
    except Exception as exc:
        detail = "%s: %s" % (type(exc).__name__, exc)
        with _MODEL_CONDITION:
            slot.state = "unavailable"
            slot.error = LOCAL_EMBEDDING_MODEL_UNAVAILABLE
            slot.model = None
            LAST_EMBEDDER_ERROR = detail
            _MODEL_CONDITION.notify_all()
        raise LocalEmbeddingModelUnavailable() from exc

    with _MODEL_CONDITION:
        slot.state = "ready"
        slot.model = model
        slot.local_path = str(local_path)
        slot.error = ""
        LAST_EMBEDDER_ERROR = ""
        _MODEL_CONDITION.notify_all()
    return model


def embedding_runtime_status(
    model_name: Optional[str],
    dim: int,
    *,
    revision: Optional[str] = None,
) -> dict:
    """Return truthful process-local semantic state without loading the model."""
    if not model_name:
        return {
            "state": "ready",
            "model": "deterministic",
            "dimension": int(dim),
            "localPath": "",
            "initializations": 0,
            "error": "",
        }
    key = _slot_key(model_name, revision)
    with _MODEL_CONDITION:
        slot = _MODEL_SLOTS.get(key, _ModelSlot())
        return {
            "state": slot.state,
            "model": model_name,
            "dimension": int(dim),
            "localPath": slot.local_path,
            "initializations": slot.initializations,
            "error": slot.error,
        }


class LazyLocalSentenceTransformerEmbedder:
    """Embedder handle that leaves the process-wide model cold until ``embed``."""

    def __init__(
        self,
        model_name: str,
        *,
        dim: int,
        revision: Optional[str] = None,
    ) -> None:
        self.model_name = model_name
        self.revision = revision
        self._dim = int(dim)

    @property
    def dim(self) -> int:
        return self._dim

    def embed(self, texts: list[str], *, kind: Literal["text", "code"] = "text") -> np.ndarray:
        model = _load_local_model(self.model_name, self.revision, self._dim)
        vecs = model.encode(texts, normalize_embeddings=True, convert_to_numpy=True)
        return np.asarray(vecs, dtype=np.float32)


class SentenceTransformerEmbedder:
    """Compatibility adapter for explicit eager semantic initialization."""

    def __init__(
        self,
        model_name: str,
        *,
        revision: Optional[str] = None,
        expected_dim: int = 0,
    ) -> None:
        self.model_name = model_name
        self.revision = revision
        self.model = _load_local_model(model_name, revision, expected_dim)
        self._dim = int(self.model.get_embedding_dimension())

    @property
    def dim(self) -> int:
        return self._dim

    def embed(self, texts: list[str], *, kind: Literal["text", "code"] = "text") -> np.ndarray:
        vecs = self.model.encode(texts, normalize_embeddings=True, convert_to_numpy=True)
        return np.asarray(vecs, dtype=np.float32)


def get_embedder(
    model_name: Optional[str] = None,
    dim: int = 256,
    *,
    revision: Optional[str] = None,
):
    """Return a cold local-only real embedder, or deterministic when unconfigured."""
    if model_name:
        return LazyLocalSentenceTransformerEmbedder(
            model_name,
            dim=dim,
            revision=revision,
        )
    return DeterministicEmbedder(dim)


def _reset_embedding_runtime_for_tests() -> None:
    """Clear process-local singleton state for isolated tests."""
    global LAST_EMBEDDER_ERROR
    with _MODEL_CONDITION:
        _MODEL_SLOTS.clear()
        LAST_EMBEDDER_ERROR = ""
        _MODEL_CONDITION.notify_all()
