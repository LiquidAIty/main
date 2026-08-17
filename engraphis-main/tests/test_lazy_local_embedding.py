from concurrent.futures import ThreadPoolExecutor
import inspect
import sys
import threading
import types

import numpy as np
import pytest

import engraphis.backends.embedder_st as embedder_st


class _FakeModel:
    def get_embedding_dimension(self):
        return 384

    def encode(self, texts, **kwargs):
        return np.ones((len(texts), 384), dtype=np.float32)


@pytest.fixture(autouse=True)
def _isolated_embedding_runtime():
    embedder_st._reset_embedding_runtime_for_tests()
    yield
    embedder_st._reset_embedding_runtime_for_tests()


def _local_model(tmp_path):
    model = tmp_path / "model"
    model.mkdir()
    (model / "modules.json").write_text("{}", encoding="utf-8")
    (model / "config.json").write_text("{}", encoding="utf-8")
    (model / "model.safetensors").write_bytes(b"local-test-model")
    return model


def test_configured_embedder_stays_cold_until_first_semantic_call_and_reuses(
        monkeypatch, tmp_path):
    model_path = _local_model(tmp_path)
    constructions = []

    def construct(local_path):
        constructions.append(local_path)
        return _FakeModel()

    monkeypatch.setattr(embedder_st, "_construct_local_sentence_transformer", construct)
    embedder = embedder_st.get_embedder(str(model_path), 384)

    assert embedder_st.embedding_runtime_status(str(model_path), 384)["state"] == "cold"
    assert constructions == []
    assert embedder.embed(["first"]).shape == (1, 384)
    assert embedder.embed(["later"]).shape == (1, 384)
    assert constructions == [model_path.resolve()]
    status = embedder_st.embedding_runtime_status(str(model_path), 384)
    assert status["state"] == "ready"
    assert status["initializations"] == 1
    assert status["localPath"] == str(model_path.resolve())


def test_concurrent_first_semantic_calls_construct_one_process_model(
        monkeypatch, tmp_path):
    model_path = _local_model(tmp_path)
    constructions = []
    entered = threading.Event()
    release = threading.Event()

    def construct(local_path):
        constructions.append(local_path)
        entered.set()
        assert release.wait(timeout=1)
        return _FakeModel()

    monkeypatch.setattr(embedder_st, "_construct_local_sentence_transformer", construct)
    embedder = embedder_st.get_embedder(str(model_path), 384)

    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = [pool.submit(embedder.embed, [str(index)]) for index in range(8)]
        assert entered.wait(timeout=1)
        assert embedder_st.embedding_runtime_status(str(model_path), 384)[
            "state"
        ] == "loading"
        release.set()
        vectors = [future.result(timeout=1) for future in futures]

    assert all(vector.shape == (1, 384) for vector in vectors)
    assert constructions == [model_path.resolve()]
    assert embedder_st.embedding_runtime_status(str(model_path), 384)[
        "initializations"
    ] == 1


def test_sentence_transformer_constructor_is_local_only_and_never_uses_hub(
        monkeypatch, tmp_path):
    model_path = _local_model(tmp_path)
    constructor_calls = []
    hub_calls = []

    def sentence_transformer(path, **kwargs):
        constructor_calls.append((path, kwargs))
        return _FakeModel()

    monkeypatch.setitem(
        sys.modules,
        "sentence_transformers",
        types.SimpleNamespace(SentenceTransformer=sentence_transformer),
    )
    import huggingface_hub
    monkeypatch.setattr(
        huggingface_hub,
        "snapshot_download",
        lambda *args, **kwargs: hub_calls.append((args, kwargs)),
    )

    embedder = embedder_st.get_embedder(str(model_path), 384)
    embedder.embed(["offline"])

    assert constructor_calls == [
        (str(model_path.resolve()), {"local_files_only": True})
    ]
    assert hub_calls == []
    assert "snapshot_download" not in inspect.getsource(embedder_st)
    assert embedder_st.os.environ["HF_HUB_OFFLINE"] == "1"
    assert embedder_st.os.environ["TRANSFORMERS_OFFLINE"] == "1"


def test_missing_local_model_fails_only_the_semantic_operation(monkeypatch, tmp_path):
    monkeypatch.setenv("HUGGINGFACE_HUB_CACHE", str(tmp_path))
    embedder = embedder_st.get_embedder("missing/model", 384)

    assert embedder.dim == 384
    assert embedder_st.embedding_runtime_status("missing/model", 384)["state"] == "cold"
    with pytest.raises(
        embedder_st.LocalEmbeddingModelUnavailable,
        match="local_embedding_model_unavailable",
    ):
        embedder.embed(["requires vectors"])
    status = embedder_st.embedding_runtime_status("missing/model", 384)
    assert status["state"] == "unavailable"
    assert status["error"] == "local_embedding_model_unavailable"
    assert status["initializations"] == 1
    assert not isinstance(embedder, embedder_st.DeterministicEmbedder)


def test_exact_id_graph_fts_and_stats_are_available_while_semantics_are_cold(
        monkeypatch, tmp_path):
    from engraphis.core.interfaces import Edge, MemoryRecord, Node, Scope
    from engraphis.service import MemoryService

    model_path = _local_model(tmp_path)
    monkeypatch.setattr(
        embedder_st,
        "_construct_local_sentence_transformer",
        lambda *args, **kwargs: pytest.fail("nonsemantic operation initialized embedder"),
    )
    service = MemoryService.create(
        ":memory:",
        embed_model=str(model_path),
        embed_dim=384,
        vector_backend="numpy",
        extractor="none",
        graph_extractor="none",
    )
    workspace_id = service.store.get_or_create_workspace("cold-workspace")
    memory_id = service.store.add_memory(MemoryRecord(
        id="",
        content="Cold exact record for lexical inspection.",
        workspace_id=workspace_id,
        scope=Scope.WORKSPACE,
    ))
    source = service.store.upsert_entity(Node(
        id="",
        name="Cold source",
        workspace_id=workspace_id,
    ))
    target = service.store.upsert_entity(Node(
        id="",
        name="Cold target",
        workspace_id=workspace_id,
    ))
    service.store.upsert_edge(Edge(
        id="",
        src=source,
        dst=target,
        relation="points_to",
        workspace_id=workspace_id,
    ))

    assert service.inspect(memory_id, workspace="cold-workspace")["memory"]["id"] == memory_id
    assert service.store.fts_search("lexical")[0][0] == memory_id
    assert len(service.store.neighbors([source])) == 1
    assert service.stats(workspace="cold-workspace")["memories"] == 1
    assert embedder_st.embedding_runtime_status(str(model_path), 384)["state"] == "cold"
    service.store.close()
