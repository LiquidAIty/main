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


@pytest.fixture
def archive(tmp_path, monkeypatch):
    path = tmp_path / "engraphis.sqlite"
    service = MemoryService.create(str(path))
    monkeypatch.setattr(conversations, "get_service", lambda: service)
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
    monkeypatch.setattr(conversations, "get_service", lambda: reopened)
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
    monkeypatch.setattr(preparation, "get_service", lambda: service)
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
