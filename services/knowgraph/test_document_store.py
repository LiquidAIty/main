"""Deterministic document contracts; real Neo4j/provider proof is separate."""
# Entity: Document Retrieval
# Relationship: Exercises exact passage identity/offsets, immutable duplicate handling, failed-embedding publication, scoped retrieval and source integrity without fabricating live-model evidence.

import asyncio
import copy
import hashlib
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

import document_store as store
import graphiti_runtime
import ingest


class Result:
    def __init__(self, row=None, created=0):
        self.row = row
        self.created = created

    async def single(self):
        return self.row

    async def consume(self):
        return SimpleNamespace(counters=SimpleNamespace(nodes_created=self.created))


class Driver:
    def __init__(self):
        self.documents = {}
        self.queries = []
        self.transactions = 0
        self.fail_passages = False
        self.closed = False
        self.read_rows = []

    async def execute_query(self, query, **params):
        self.queries.append((query, params))
        if query.startswith("SHOW VECTOR"):
            rows = [{"state": "ONLINE"}]
        elif "RETURN properties(d) AS document" in query:
            document = self.documents.get(params["uuid"])
            rows = [{"document": document}] if document and document["project_id"] == params["project"] else []
        elif "AS passage" in query:
            rows = self.read_rows
        else:
            rows = []
        return rows, None, None

    @asynccontextmanager
    async def transaction(self):
        self.transactions += 1
        pending = copy.deepcopy(self.documents)

        async def run(query, **params):
            self.queries.append((query, params))
            if query.startswith("MERGE"):
                new = params["uuid"] not in pending
                pending.setdefault(params["uuid"], params["properties"])
                return Result({"document": pending[params["uuid"]]}, int(new))
            if "UNWIND $passages" in query and self.fail_passages:
                raise RuntimeError("transaction failed")
            return Result()

        yield SimpleNamespace(run=run)
        self.documents = pending

    async def close(self):
        self.closed = True


@pytest.fixture
def runtime(monkeypatch):
    driver = Driver()
    config = SimpleNamespace(provider="test", embedding_model="test-model-v1", embedding_dimensions=3,
                             embedding_client_kwargs={"base_url": "https://embedding.test"})
    embedder = SimpleNamespace(
        create_batch=AsyncMock(side_effect=lambda texts: [[0.1, 0.2, 0.3] for _ in texts]),
        create=AsyncMock(return_value=[0.1, 0.2, 0.3]), client=SimpleNamespace(close=AsyncMock()))
    monkeypatch.setattr(graphiti_runtime, "create_graphiti_driver", lambda: (driver, "neo4j"))
    monkeypatch.setattr(graphiti_runtime, "create_graphiti_embedder", lambda: (config, embedder))
    monkeypatch.setattr(graphiti_runtime, "create_graphiti_runtime",
                        lambda: pytest.fail("Document import must not create an extraction LLM/Jev runtime"))
    monkeypatch.setattr(store, "_INGEST_LOCK", asyncio.Lock())
    return driver, config, embedder


def arguments(text="Original source evidence.\n\nAnother original paragraph."):
    return dict(project_id="project-a", document_id="filing", pages=[text], source_name="Filing",
                source_reference="https://example.test/filing",
                source_checksum=hashlib.sha256(text.encode()).hexdigest())


def test_unicode_offsets_and_page_overlap_never_rewrite_source():
    text = "  αΩ 🌙\n\n" + "Funded award differs from contract ceiling.\n" * 60 + "\n tail  "
    spans = store.passage_spans(text, size=240, overlap=30)
    assert len(spans) > 1
    assert spans[0][0] == 0 and spans[-1][1] == len(text)
    for (start, end), following in zip(spans, spans[1:]):
        assert 0 < end - start <= 240
        assert following[0] <= end and following[0] > start
    assert text[spans[0][0]:spans[0][1]].startswith("  αΩ 🌙")


def test_version_and_passage_ids_are_stable_but_project_and_content_specific():
    a = store._identity("p", "d", "checksum")
    assert a == store._identity("p", "d", "checksum")
    assert a != store._identity("other", "d", "checksum")
    assert a != store._identity("p", "d", "changed")
    assert store._identity(a, 1, 0, 100) != store._identity(a, 2, 0, 100)


def test_document_publishes_only_after_valid_bounded_embeddings_and_reuses_exact_version(runtime):
    driver, config, embedder = runtime
    value = asyncio.run(store.ingest_pages(**arguments()))
    assert value["status"] == "indexed" and value["passage_count"] == 1
    assert value["document"]["embedding_model_version"] == config.embedding_model
    assert value["document"]["embedding_revision_known"] is False
    assert value["document"].get("publication_date") is None
    assert driver.transactions == 1
    assert embedder.create_batch.await_count == 1
    statements = "\n".join(query for query, _ in driver.queries)
    assert "CREATE VECTOR INDEX" in statements and "HAS_PASSAGE" in statements
    assert ":Entity" not in statements and ":Know" not in statements and ":Episodic" not in statements
    duplicate = asyncio.run(store.ingest_pages(**arguments()))
    assert duplicate["idempotent"] is True
    assert duplicate["document"]["uuid"] == value["document"]["uuid"]
    assert driver.transactions == 1 and embedder.create_batch.await_count == 1


@pytest.mark.parametrize("vectors", [[], [[0.1]], [[float("nan"), 1, 2]], [[0, 0, 0]], [[True, 1, 2]]])
def test_invalid_embeddings_never_publish_partial_source(runtime, vectors):
    driver, _config, embedder = runtime
    embedder.create_batch.side_effect = None
    embedder.create_batch.return_value = vectors
    with pytest.raises(ValueError, match="document_embedding"):
        asyncio.run(store.ingest_pages(**arguments()))
    assert not driver.documents and driver.transactions == 0
    assert driver.closed
    embedder.client.close.assert_awaited_once()


def test_failed_publication_does_not_leave_searchable_document(runtime):
    driver, _, _ = runtime
    driver.fail_passages = True
    with pytest.raises(RuntimeError, match="transaction failed"):
        asyncio.run(store.ingest_pages(**arguments()))
    assert not driver.documents
    driver.fail_passages = False
    retried = asyncio.run(store.ingest_pages(**arguments()))
    assert retried["status"] == "indexed" and len(driver.documents) == 1


def test_changed_embedding_space_does_not_silently_rewrite_existing_document(runtime):
    driver, config, _ = runtime
    asyncio.run(store.ingest_pages(**arguments()))
    before = copy.deepcopy(driver.documents)
    config.embedding_model = "another-model"
    with pytest.raises(ValueError, match="embedding_space_changed"):
        asyncio.run(store.ingest_pages(**arguments()))
    assert driver.documents == before


def test_search_scopes_vector_results_and_does_not_expose_embedding_values(runtime):
    driver, config, _ = runtime
    document = {"project_id": "project-a", "source_execution_json": "null"}
    driver.read_rows = [{"passage": {"uuid": "passage", "text": "Exact quote", "embedding": [1, 2, 3]},
                         "document": document, "score": 0.8}]
    result = asyncio.run(store.search_passages(project_id="project-a", query="contract funding", document_ids=["filing"]))
    assert result["matches"][0]["chunk_id"] == "passage"
    assert "embedding" not in result["matches"][0]
    query, params = driver.queries[-1]
    assert "db.index.vector.queryNodes" in query and "node.project_id=$project" in query
    assert "node.embedding_space=$space" in query and "node.document_id IN $documents" in query
    assert params["project"] == "project-a" and params["documents"] == ["filing"]
    assert params["space"] == store._embedding_space(config)[0]
    assert result["exhaustive"] is False


def test_exact_read_checks_source_offsets_and_project_scope(runtime):
    driver, _, _ = runtime
    driver.read_rows = [{"passage": {"uuid": "passage", "text": "quote", "start": 7, "end": 12},
        "document": {"source_execution_json": "null"}, "page_text": "before quote after"}]
    result = asyncio.run(store.get_passage(project_id="project-a", passage_id="passage", context_chars=2))
    assert result["text"] == "quote" and result["context"] == {"text": "e quote a", "start": 5, "end": 14}
    assert driver.queries[-1][1]["project"] == "project-a"
    driver.read_rows = []
    with pytest.raises(LookupError):
        asyncio.run(store.get_passage(project_id="other-project", passage_id="passage"))
    driver.read_rows = [{"passage": {"uuid": "passage", "text": "altered", "start": 7, "end": 12},
        "document": {}, "page_text": "before quote after"}]
    with pytest.raises(RuntimeError, match="integrity"):
        asyncio.run(store.get_passage(project_id="project-a", passage_id="passage"))


def test_pdf_verifies_actual_bytes_before_extraction(tmp_path):
    source = tmp_path / "input.pdf"
    source.write_bytes(b"not the claimed bytes")
    with pytest.raises(ValueError, match="checksum_mismatch"):
        asyncio.run(ingest.ingest_pdf(str(source), "p", "d", source_name="input.pdf",
            source_reference="knowgraph-upload://sha256/" + "a" * 64 + "/input.pdf", source_content_sha256="a" * 64))


def test_extractable_pdf_does_not_need_an_outline_and_keeps_each_page_exact(monkeypatch):
    import pypdf
    texts = ["  First page\n", "", "\n" + "Long paragraph " * 20_000]
    monkeypatch.setattr(pypdf, "PdfReader", lambda _path: SimpleNamespace(
        pages=[SimpleNamespace(extract_text=lambda text=text: text) for text in texts]))
    assert ingest._extract_pages("unit-fixture.pdf") == texts


def test_blank_pdf_returns_ocr_needed_without_model_calls(runtime):
    driver, _, embedder = runtime
    with pytest.raises(ValueError, match="ocr_required"):
        asyncio.run(store.ingest_pages(**{**arguments(), "pages": ["", "  "]}))
    assert driver.transactions == 0
    embedder.create_batch.assert_not_awaited()


def test_concurrent_import_is_bounded_and_exact_retry_does_not_duplicate(runtime):
    driver, _, embedder = runtime

    async def exercise():
        started, release = asyncio.Event(), asyncio.Event()

        async def embed(texts):
            started.set()
            await release.wait()
            return [[0.1, 0.2, 0.3] for _ in texts]

        embedder.create_batch.side_effect = embed
        first = asyncio.create_task(store.ingest_pages(**arguments()))
        await started.wait()
        with pytest.raises(ValueError, match="ingest_busy"):
            await store.ingest_pages(**arguments())
        release.set()
        result = await first
        duplicate = await store.ingest_pages(**arguments())
        assert duplicate["document"]["uuid"] == result["document"]["uuid"]
        assert duplicate["idempotent"] is True

    asyncio.run(exercise())
    assert driver.transactions == 1 and len(driver.documents) == 1


def test_text_import_keeps_exact_whitespace(runtime):
    driver, _, _ = runtime
    text = "  Original evidence\n\nWith whitespace.  "
    result = asyncio.run(store.ingest_text(project_id="project-a", document_id="text", source_name="Source",
        source_url="https://example.test/source", text=text))
    assert result["document"]["document_checksum"] == hashlib.sha256(text.encode()).hexdigest()
    saved_pages = next(params["pages"] for query, params in driver.queries if "UNWIND $pages" in query)
    assert saved_pages[0]["text"] == text


def test_cancelled_embedding_stops_batches_releases_lock_and_publishes_nothing(runtime):
    driver, _, embedder = runtime
    async def exercise():
        async def slow_batch(_texts):
            await asyncio.sleep(10)
        embedder.create_batch.side_effect = slow_batch
        with pytest.raises(TimeoutError):
            await asyncio.wait_for(store.ingest_pages(**arguments("source " * 10000)), timeout=.02)
        assert not store._INGEST_LOCK.locked()
    asyncio.run(exercise())
    assert embedder.create_batch.await_count == 1
    assert driver.transactions == 0 and not driver.documents and driver.closed
    embedder.client.close.assert_awaited_once()
