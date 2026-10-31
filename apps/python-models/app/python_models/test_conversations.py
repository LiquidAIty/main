"""Real disposable Engraphis storage checks; no product conversations or agent runs."""
# Graph + less = more: less code that does the same work as more code is more useful.
# Entity names the feature; Relationship explains why this file belongs and what it contributes.
# Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
# Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
# Entity: Main Chat
# Relationship: Verifies exact message storage, transactions, deduplication, isolation and persistent readback.
# Entity: ThinkGraph
# Relationship: Verifies explicit stored-pair reads reach the existing preparation contract without graph writes or agent delivery.

from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from engraphis.service import MemoryService

from app.python_models import conversations
from app.python_models import engraphis, engraphis_operations, personal_context
from app.python_models import thinkgraph_completed_pair_settlement as settlement
from app.python_models import thinkgraph_completed_pair_preparation as preparation


@pytest.fixture
def archive(tmp_path, monkeypatch):
    path = tmp_path / "engraphis.sqlite"
    service = MemoryService.create(str(path))
    for module in (conversations, engraphis, engraphis_operations, personal_context, preparation, settlement):
        monkeypatch.setattr(module, "get_service", lambda _project: service)
    for module in (engraphis, engraphis_operations, personal_context):
        monkeypatch.setattr(module, "project_principal", lambda _project: {"id": "owner-one"})
    yield service, path
    service.close()


def call(action, project="project-one", conversation="chat-one", **arguments):
    return conversations.conversation_operation(project, action, {"conversationId": conversation, **arguments})


def user(text="  Exact question α.\n", **extra):
    return {"role": "user", "content": text, "speaker": {"kind": "user", "label": "You"},
            "providerContinuationRef": "session-one", **extra}


def reply(**extra):
    return {"role": "assistant", "content": "Exact answer.", "providerMessageId": "hermes:main:row:5",
            "speaker": {"kind": "card", "label": "Main", "cardId": "main", "profile": "main"},
            "providerContinuationRef": "session-one", "linkedEvidenceIds": ["source-one"], **extra}


def test_full_conversation_exact_readback_reopen_and_no_memories(archive, monkeypatch):
    service, path = archive
    question = call("append", messages=[user(messageId=f"msg_{uuid4()}")])[0]
    answer = call("reply", message=reply())["message"]
    followup = call("append", messages=[user("Next question.")])[0]
    assert question["content"] == "  Exact question α.\n"
    assert answer["visibleActivities"][0]["profile"] == "main"
    assert answer["linkedEvidenceIds"] == ["source-one"]
    expected = [question, answer, followup]
    assert call("read") == expected
    assert [item["seq"] for item in expected] == [1, 2, 3]
    assert service.store.conn.execute("SELECT COUNT(*) FROM memories").fetchone()[0] == 0
    assert service.store.conn.execute("SELECT COUNT(*) FROM entities").fetchone()[0] == 0
    service.close()
    reopened = MemoryService.create(str(path))
    monkeypatch.setattr(conversations, "get_service", lambda _project: reopened)
    try:
        assert call("read") == expected
    finally:
        reopened.close()


def test_concurrent_duplicate_replies_and_scope_isolation(archive):
    call("append", messages=[user()])
    with ThreadPoolExecutor(max_workers=4) as executor:
        receipts = list(executor.map(lambda _: call("reply", message=reply()), range(8)))
    assert sum(item["inserted"] for item in receipts) == 1
    assert len(call("read")) == 2
    assert call("read", project="project-two") == []
    assert call("read", conversation="chat-two") == []
    assert call("reply", project="project-two", message=reply())["inserted"] is True


def test_failed_batch_rolls_back_sequence_and_content(archive):
    call("append", messages=[user()])
    with pytest.raises(ValueError, match="message_id_invalid"):
        call("append", messages=[user("Must roll back."), user(messageId="invalid")])
    assert len(call("read")) == 1
    assert call("append", messages=[user("Next valid message.")])[0]["seq"] == 2


def test_duplicate_message_identity_is_rejected_across_conversations(archive):
    identifier = f"msg_{uuid4()}"
    call("append", messages=[user(messageId=identifier)])
    with pytest.raises(ValueError, match="message_id_duplicate"):
        call("append", conversation="chat-two", messages=[user(messageId=identifier)])
    assert call("read", conversation="chat-two") == []


def test_exact_status_settlement_preserves_other_fields(archive):
    saved = call("append", messages=[user(status="pending", providerMessageId="submission-one")])[0]
    with pytest.raises(ValueError, match="settlement_mismatch"):
        call("settle", messageId=saved["messageId"], providerMessageId="wrong", status="complete")
    completed = call("settle", messageId=saved["messageId"], providerMessageId="submission-one", status="complete")
    assert completed == {**saved, "status": "complete", "completedAt": completed["completedAt"]}
    assert completed["completedAt"]
    assert call("read") == [completed]


def test_no_old_conversation_import_or_seeding(archive):
    with pytest.raises(ValueError, match="operation_invalid"):
        call("import", messages=[user("Old test conversation.")])
    with pytest.raises(ValueError, match="history_import_disabled"):
        call("append", messages=[user()], seedMessages=[user("Old test conversation.")])
    assert call("read") == []


def test_explicit_pair_is_not_inferred_from_latest_messages(archive):
    question = call("append", messages=[user("First question.")])[0]
    answer = call("reply", message=reply())["message"]
    call("append", messages=[user("Later unrelated question.")])
    pair = conversations.read_pair("project-one", "chat-one", [question["messageId"]], answer["messageId"])
    assert pair["userMessage"] == "First question."
    assert pair["mainResponse"] == answer["content"]
    with pytest.raises(ValueError, match="source_mismatch"):
        conversations.read_pair("project-two", "chat-one", [question["messageId"]], answer["messageId"])
    with pytest.raises(ValueError, match="source_mismatch"):
        conversations.read_pair("project-one", "chat-one", [answer["messageId"]], question["messageId"])


def test_pair_rejects_wrong_session_and_reordered_sources(archive):
    first, second = call("append", messages=[user("First"), user("Second")])
    other = call("append", messages=[user("Other session", providerContinuationRef="other")])[0]
    answer = call("reply", message=reply())["message"]
    with pytest.raises(ValueError, match="order_invalid"):
        conversations.read_pair("project-one", "chat-one", [second["messageId"], first["messageId"]], answer["messageId"])
    with pytest.raises(ValueError, match="source_mismatch"):
        conversations.read_pair("project-one", "chat-one", [other["messageId"]], answer["messageId"])


def test_stored_pair_reuses_preparation_without_tool_or_graph_write(archive, monkeypatch):
    from app.python_models import engraphis_operations as operations
    from app.python_models import thinkgraph_completed_pair_preparation as preparation
    service, _ = archive
    monkeypatch.setattr(preparation, "get_service", lambda _project: service)
    from app.python_models import project_entity_map
    monkeypatch.setattr(project_entity_map, "build_project_entity_map", lambda project: {
        "projectId": project, "complete": True, "entities": [], "relationships": [],
        "counts": {}, "sha256": "test-map", "readDurationMs": 0,
    })
    question = call("append", messages=[user()])[0]
    answer = call("reply", message=reply())["message"]
    prepared = operations.private_operation("project-one", "prepare_conversation_pair", {
        "conversationId": "chat-one", "userMessageIds": [question["messageId"]],
        "assistantMessageId": answer["messageId"],
    })
    assert prepared["source"]["mainResponse"] == answer["content"]
    assert prepared["preparation"]["structuredExtractionRequired"] is True
    assert prepared["preparation"]["revisionChanged"] is False
    assert "facts" in prepared["preparation"]["enrichmentSchema"]["properties"]
    assert service.store.conn.execute("SELECT COUNT(*) FROM memories").fetchone()[0] == 0
    chunks = conversations.source_chunks("project-one", prepared["source"]["sourceReferences"])
    assert len(chunks) == 2
    import json
    sent = json.loads(prepared["preparation"]["enrichmentPrompt"].split("\nTEXT:\n", 1)[1])
    assert [item["id"] for item in sent] == [chunk["id"] for chunk in chunks]
    assert [item["role"] for item in sent] == ["user", "assistant"]
    assert "USER:\n" not in prepared["preparation"]["enrichmentPrompt"]
    assert service.store.conn.execute("SELECT COUNT(*) FROM entities").fetchone()[0] == 0


def test_source_index_is_repeatable_and_preserves_canonical_messages(archive):
    service, _ = archive
    question = call("append", messages=[user()])[0]
    answer = call("reply", message=reply())["message"]
    source = conversations.read_pair("project-one", "chat-one", [question["messageId"]], answer["messageId"])
    reference = preparation.pair_reference(source)
    conversations.register_source_pair("project-one", reference, source["sourceReferences"][0])
    before = call("read")
    first = conversations.index_source_exchanges("project-one", "chat-one")
    second = conversations.index_source_exchanges("project-one", "chat-one")
    assert first["indexed"] == 2
    assert second["indexed"] == 0 and second["existing"] == 2
    assert call("read") == before
    assert len(service.store.list_entities()) == 0
    memory_id = service.store.conn.execute("SELECT id FROM memories WHERE claim_kind='conversation_source'").fetchone()[0]
    loaded = conversations.read_source_exchanges("project-one", memory_id, include_exchange=True)
    assert loaded["sources"][0]["messages"] == before
    with pytest.raises(ValueError, match="source_memory_not_in_project"):
        conversations.read_source_exchanges("project-two", memory_id)


def test_private_context_requires_user_quote_and_stays_out_of_entities(archive):
    service, _ = archive
    question = call("append", messages=[user("I like space stocks. For this Project, avoid short-dated calls.")])[0]
    answer = call("reply", message=reply())["message"]
    source = conversations.read_pair("project-one", "chat-one", [question["messageId"]], answer["messageId"])
    pair = preparation.pair_reference(source)
    entries = [{"subject": "space stocks", "kind": "interest", "scope": "personal",
                "content": "Interested in space stocks", "quote": "I like space stocks."},
               {"subject": "option duration", "kind": "instruction", "scope": "project",
                "content": "Avoid short-dated calls for this Project", "quote": "For this Project, avoid short-dated calls."}]
    ids = personal_context.save_personal_context(service, source, pair, entries)
    assert personal_context.save_personal_context(service, source, pair, entries) == ids
    assert len(service.store.list_entities()) == 0
    records = personal_context.read_personal_context("project-one")["records"]
    assert len(records) == 2
    assert [r["scope"] for r in personal_context.read_personal_context("project-two")["records"]] == ["personal"]
    assert conversations.read_source_exchanges("project-one", ids[0], include_exchange=True)["sources"][0]["messages"][0]["content"] == question["content"]
    with pytest.raises(ValueError, match="exact_user_statement"):
        personal_context.save_personal_context(service, source, "different-pair", [{**entries[0], "quote": "Exact answer."}])
    personal_context.correct_personal_context("project-one", ids[0], "Interested in space infrastructure, not all space stocks")
    current = personal_context.read_personal_context("project-one")["records"]
    corrected = next(record for record in current if record["scope"] == "personal")
    assert corrected["content"] == "Interested in space infrastructure, not all space stocks"
    assert ids[0] in corrected["supersedes"]
    assert len(service.store.list_entities()) == 0


@pytest.mark.parametrize("index_failure", [False, True])
def test_mixed_pair_settles_think_and_private_context_atomically_without_duplicate_nodes(archive, monkeypatch, index_failure):
    service, _ = archive
    question = call("append", messages=[user("I like space stocks. What funding is committed?")])[0]
    answer = call("reply", message=reply())["message"]
    source = conversations.read_pair("project-one", "chat-one", [question["messageId"]], answer["messageId"])
    chunks = conversations.source_chunks("project-one", source["sourceReferences"], prepare=True)
    user_chunk = chunks[0]["id"]
    payload = {**source, "pairReference": preparation.pair_reference(source), "cardRun": {
        "runId": "test-native-result", "cardId": "card_thinkgraph", "revisionId": "test-revision",
        "profile": "thinkgraph", "hermesSessionId": "session-one", "resolvedProvider": "test",
        "resolvedModel": "mechanics-only",
    }, "structuredOutput": {"facts": [{"content": "Funding is unresolved.", "title": "Funding",
        "entity": "Space stocks", "entities": ["Space stocks"], "relations": [],
        "think": {"summary": "Funding is unresolved.", "sourceChunkIds": [user_chunk], "research": {
            "question": "What funding is committed?", "why": "It affects the funding uncertainty.", "sourceChunkIds": [user_chunk]}}}],
        "personalContext": [{"subject": "space stocks", "kind": "interest", "scope": "personal",
            "content": "Interested in space stocks", "quote": "I like space stocks.", "sourceChunkIds": [user_chunk]}]}}
    if index_failure:
        from .thinkgraph_relationship_vocabulary import ThinkGraphIntakeError
        with monkeypatch.context() as patch:
            def unavailable(*args):
                raise RuntimeError("embedding unavailable")
            patch.setattr(conversations, "index_source_chunks", unavailable)
            with pytest.raises(ThinkGraphIntakeError, match="thinkgraph_source_index_failed"):
                settlement.settle_completed_pair(payload)
        assert service.store.conn.execute("SELECT COUNT(*) FROM memories").fetchone()[0] == 0
        assert len(service.store.list_entities()) == 0
        assert conversations.source_chunks("project-one", source["sourceReferences"]) == chunks
        assert call("read") == [question, answer]
    first = settlement.settle_completed_pair(payload)
    assert len(first["thinkMemoryIds"]) == len(first["personalContextIds"]) == 1
    assert len(service.store.list_entities()) == 1
    memory = service.store.get_memory(first["thinkMemoryIds"][0])
    assert memory.metadata["structured_extraction"]["think"]["research"]["question"] == "What funding is committed?"
    assert memory.metadata["thinkgraph_origin"]["source_chunks"] == [{"id": user_chunk, "sha256": chunks[0]["sha256"]}]
    assert first["sourceIndex"]["indexed"] == 2
    excerpts = conversations.read_source_exchanges("project-one", memory.id)["sources"][0]
    assert "messages" not in excerpts
    assert [item["id"] for item in excerpts["chunks"]] == [user_chunk]
    assert excerpts["chunks"][0]["content"] == chunks[0]["content"]
    before = service.store.conn.execute("SELECT COUNT(*) FROM memories").fetchone()[0]
    assert settlement.settle_completed_pair(payload)["intakeOperation"] == "noop"
    assert service.store.conn.execute("SELECT COUNT(*) FROM memories").fetchone()[0] == before


def test_native_chunks_preserve_coverage_occurrences_and_are_not_rechunked(archive, monkeypatch):
    from engraphis.backends.extractor import ChunkingExtractor
    service, _ = archive
    sentences = [f"Item {index} retains its original causal condition and uncertainty in this source." for index in range(120)]
    text = "# Funding\n\n" + " ".join(sentences) + "\n\n```python\nprint('original code')\n```\n"
    first, second = call("append", messages=[user(text), user(text)])
    answer = call("reply", message=reply())["message"]
    source = conversations.read_pair("project-one", "chat-one", [first["messageId"], second["messageId"]], answer["messageId"])
    before = call("read")
    chunks = conversations.source_chunks("project-one", source["sourceReferences"], prepare=True)
    first_chunks = [chunk for chunk in chunks if chunk["messageId"] == first["messageId"]]
    assert len(first_chunks) > 2
    assert all(any(sentence in chunk["content"] for chunk in first_chunks) for sentence in sentences)
    assert any(sum(sentence in chunk["content"] for chunk in first_chunks) > 1 for sentence in sentences)
    assert any(chunk["heading"] == "Funding" for chunk in first_chunks)
    assert any("```python\nprint('original code')\n```" in chunk["content"] for chunk in first_chunks)
    assert all(chunk["metadata"]["chunking"]["target_tokens"] == 256 for chunk in chunks)
    assert call("read") == before
    assert service.store.conn.execute("SELECT COUNT(*) FROM memories").fetchone()[0] == 0
    monkeypatch.setattr(ChunkingExtractor, "extract", lambda *args, **kwargs: pytest.fail("second chunking pass"))
    assert conversations.source_chunks("project-one", source["sourceReferences"], prepare=True) == chunks
    indexed = conversations.index_source_chunks("project-one", chunks)
    assert indexed["indexed"] == len(chunks)
    assert conversations.index_source_chunks("project-one", chunks)["existing"] == len(chunks)
    assert len({chunk["id"] for chunk in chunks}) == len(chunks)
    assert call("read") == before


def test_source_citations_reject_foreign_missing_duplicate_and_assistant_preferences():
    from app.python_models.thinkgraph_completed_pair_extraction import validate_source_chunks
    from app.python_models.thinkgraph_relationship_vocabulary import ThinkGraphIntakeError
    chunks = [{"id": "user:0", "role": "user", "content": "An explicit preference."},
              {"id": "main:0", "role": "assistant", "content": "Assistant inference."}]
    for ids in ([], ["foreign:0"], ["user:0", "user:0"]):
        with pytest.raises(ThinkGraphIntakeError, match="source_chunk_reference_invalid"):
            validate_source_chunks({"facts": [{"think": {"sourceChunkIds": ids}}]}, chunks)
    with pytest.raises(ThinkGraphIntakeError, match="source_chunk_reference_invalid"):
        validate_source_chunks({"facts": [], "personalContext": [{"sourceChunkIds": ["main:0"], "quote": "Assistant inference."}]}, chunks)
    with pytest.raises(ThinkGraphIntakeError, match="source_chunk_reference_invalid"):
        validate_source_chunks({"facts": [{"think": {"sourceChunkIds": ["user:0"],
            "research": {"sourceChunkIds": ["main:0"]}}}]}, chunks)


def test_research_question_is_not_an_execution_request():
    from app.python_models.thinkgraph_completed_pair_extraction import ThinkGraphStructuredOutput
    result = ThinkGraphStructuredOutput.model_validate({"facts": [{
        "content": "The funding uncertainty matters.", "title": "Funding", "entity": "Company",
        "entities": ["Company"], "relations": [], "think": {"summary": "The funding uncertainty matters.",
        "research": {"question": "What funding is committed?", "why": "It changes the dilution concern."}},
    }], "personalContext": []})
    assert result.facts[0].think.research.question == "What funding is committed?"
