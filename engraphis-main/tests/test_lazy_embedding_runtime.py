import threading
import time

import pytest

from engraphis.backends.embedder_deterministic import DeterministicEmbedder
from engraphis.core import engine as engine_module
from engraphis.core.engine import MemoryEngine
from engraphis.service import MemoryService, ValidationError


def _instrument_embedding_runtime(monkeypatch, *, fail_first=False):
    calls = []
    original_vector_factory = engine_module.get_vector_index

    def get_embedder(model_name, dim):
        calls.append(("embedder", model_name, dim))
        if fail_first and sum(call[0] == "embedder" for call in calls) == 1:
            raise RuntimeError("simulated model initialization failure")
        return DeterministicEmbedder(dim)

    def get_vector_index(store, *, dim, prefer):
        calls.append(("vector", dim, prefer))
        return original_vector_factory(store, dim=dim, prefer="numpy")

    monkeypatch.setattr(engine_module, "get_embedder", get_embedder)
    monkeypatch.setattr(engine_module, "get_vector_index", get_vector_index)
    return calls


def test_stats_and_empty_remember_do_not_initialize_embeddings(monkeypatch):
    calls = _instrument_embedding_runtime(monkeypatch)
    service = MemoryService.create(
        ":memory:",
        embed_model="configured-sentence-transformer",
        embed_dim=64,
        vector_backend="numpy",
    )

    assert service.engine.embedding_initialized is False
    assert service.stats()["embedding_loaded"] is False
    with pytest.raises(ValidationError):
        service.remember("   ", workspace="admin")
    assert service.engine.embedding_initialized is False
    assert calls == []


def test_missing_scope_statistics_and_code_reads_do_not_initialize_embeddings(
    monkeypatch,
):
    calls = _instrument_embedding_runtime(monkeypatch)
    service = MemoryService.create(
        ":memory:",
        embed_model="configured-sentence-transformer",
        embed_dim=64,
        vector_backend="numpy",
    )

    missing = service.stats(workspace="missing")
    assert missing == {
        "workspace": "missing",
        "memories": 0,
        "note": "workspace not found",
    }
    code_reads = (
        lambda: service.search_code(
            "MemoryEngine", workspace="missing", repo="main"
        ),
        lambda: service.code_path(
            "source", "target", workspace="missing", repo="main"
        ),
        lambda: service.code_impact(
            ["engraphis/service.py"], workspace="missing", repo="main"
        ),
        lambda: service.export_code_graph(workspace="missing", repo="main"),
    )
    for operation in code_reads:
        with pytest.raises(ValidationError, match="no workspace named 'missing' yet"):
            operation()

    workspace_id = service.store.get_or_create_workspace("ADMIN")
    assert workspace_id
    for operation in (
        lambda: service.search_code(
            "MemoryEngine", workspace="ADMIN", repo="missing"
        ),
        lambda: service.code_path(
            "source", "target", workspace="ADMIN", repo="missing"
        ),
        lambda: service.code_impact(
            ["engraphis/service.py"], workspace="ADMIN", repo="missing"
        ),
        lambda: service.export_code_graph(workspace="ADMIN", repo="missing"),
    ):
        with pytest.raises(
            ValidationError,
            match="no repo named 'missing' in workspace 'ADMIN' yet",
        ):
            operation()

    assert service.engine.embedding_initialized is False
    assert calls == []


def test_first_semantic_operation_initializes_once(monkeypatch):
    calls = _instrument_embedding_runtime(monkeypatch)
    engine = MemoryEngine.create(
        ":memory:",
        embed_model="configured-sentence-transformer",
        embed_dim=64,
        vector_backend="numpy",
        auto_evolve=False,
    )
    workspace_id = engine.store.get_or_create_workspace("admin")

    first = engine.remember("Curated context beats maximal context.", workspace_id=workspace_id)
    second = engine.remember("Relationships carry short interpretations.", workspace_id=workspace_id)

    assert first
    assert second
    assert engine.embedding_initialized is True
    assert [call[0] for call in calls] == ["embedder", "vector"]


def test_failed_model_initialization_does_not_poison_storage_or_retry(monkeypatch):
    calls = _instrument_embedding_runtime(monkeypatch, fail_first=True)
    service = MemoryService.create(
        ":memory:",
        embed_model="configured-sentence-transformer",
        embed_dim=64,
        vector_backend="numpy",
    )

    with pytest.raises(RuntimeError, match="simulated model initialization failure"):
        service.remember("First semantic attempt.", workspace="admin")

    assert service.engine.embedding_initialized is False
    assert service.stats(workspace="admin")["embedding_loaded"] is False

    stored = service.remember("Second semantic attempt.", workspace="admin")
    assert stored["stored"] is True
    assert service.engine.embedding_initialized is True
    assert [call[0] for call in calls] == ["embedder", "embedder", "vector"]


def test_expired_hung_initialization_does_not_hold_the_lock_or_poison_retry(
    monkeypatch,
):
    _instrument_embedding_runtime(monkeypatch)
    engine = MemoryEngine.create(
        ":memory:",
        embed_model="configured-sentence-transformer",
        embed_dim=64,
        vector_backend="numpy",
        auto_evolve=False,
    )
    engine._embedding_runtime_lease_seconds = 0.02
    original_factory = engine._embedding_runtime_factory
    entered = threading.Event()
    release = threading.Event()
    attempts = 0

    def leased_factory():
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            entered.set()
            release.wait(timeout=2)
        return original_factory()

    engine._embedding_runtime_factory = leased_factory
    first_errors = []

    def first_call():
        try:
            engine.embedder
        except Exception as error:  # pragma: no cover - asserted below
            first_errors.append(error)

    hung_worker = threading.Thread(target=first_call, daemon=True)
    hung_worker.start()
    assert entered.wait(timeout=1)
    time.sleep(0.03)

    workspace_id = engine.store.get_or_create_workspace("ADMIN")
    stored = engine.remember(
        "A later semantic call succeeds after the initialization lease expires.",
        workspace_id=workspace_id,
    )
    assert stored
    assert engine.embedding_initialized is True

    release.set()
    hung_worker.join(timeout=1)
    assert hung_worker.is_alive() is False
    assert first_errors == []
    assert attempts == 2
