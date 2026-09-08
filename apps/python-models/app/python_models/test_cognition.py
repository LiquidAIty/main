"""Conversation delivery boundaries; these tests never invoke a model or graph."""
import asyncio
import copy
import json

import pytest

from app.python_models.cognition import deliver_completed_pair


class RunBoundary:
    def __init__(self):
        self.context = dict(projectId="project", deckId="deck", runId="main-turn", conversationId="chat")
        self.parent = {**self.context, "cardId": "main", "state": "completed", "runtimeMode": "main", "runtimeKind": "hermes",
                       "result": "Answer already delivered", "finishedAt": "2026-09-07T09:00:00Z"}
        self.runs = {}
        self.calls = []
        self.profiles = ["thinkgraph", "liquidaity-hermes-steward"]
        self.cards = [{"id": profile, "runtime": dict(kind="hermes", mode="delegate", profile=profile)}
                      for profile in self.profiles]

    def read(self, selector):
        return {"run": self.parent if selector.get("runId") else self.runs.get(selector["correlationId"])}

    def inputs(self, selector):
        assert selector["runId"] == self.parent["runId"]
        return {"available": True, "idf": {"dynamicContext": {"task": "Original user message"},
                "actualGraphData": {"selectedNativeReferences": [{"authority": "ThinkGraph", "nativeId": "native:1"}]}}}

    def deck(self, project, deck):
        assert (project, deck) == ("project", "deck")
        return {"deck": {"nodes": self.cards}}

    async def invoke(self, args):
        self.calls.append(copy.deepcopy(args))
        result = dict(runId=args["correlationId"], cardId=args["cardId"], state="completed", result="native:1")
        self.runs[result["runId"]] = result
        return {"ok": True, "result": {**result, "output": result["result"]}}

    async def deliver(self):
        return await deliver_completed_pair(self.context, read=self.read, read_input=self.inputs,
                                            read_deck=self.deck, invoke=self.invoke)


def test_completed_conversation_never_invokes_research_or_requires_its_card():
    boundary = RunBoundary()
    boundary.cards = [boundary.cards[0]]
    result = asyncio.run(boundary.deliver())
    assert result == {"state": "completed", "runId": "cognition:main-turn:thinkgraph", "cardId": "thinkgraph"}
    assert [call["cardId"] for call in boundary.calls] == ["thinkgraph"]


def test_only_thinkgraph_receives_original_pair_without_runtime_overrides():
    boundary = RunBoundary()
    result = asyncio.run(boundary.deliver())
    assert result["state"] == "completed"
    assert [c["cardId"] for c in boundary.calls] == ["thinkgraph"]
    for call in boundary.calls:
        assert call["originatingAgentId"] == "main"
        assert call["originatingRunId"] == "main-turn"
        assert not {"model", "provider", "prompt", "tools", "builderOperation"} & call.keys()
        mission = json.loads(call["input"])
        assert mission["completedPair"]["user"] == "Original user message"
        assert mission["completedPair"]["assistant"] == "Answer already delivered"
        assert "referenceHints" not in mission
        assert mission["selectedReferences"] == [{"authority": "ThinkGraph", "nativeId": "native:1"}]


def test_duplicate_completion_reuses_durable_stage_results():
    boundary = RunBoundary()
    async def run():
        first = await boundary.deliver()
        second = await boundary.deliver()
        assert first == second
    asyncio.run(run())
    assert len(boundary.calls) == 1


def test_concurrent_completion_delivery_does_not_duplicate_children():
    boundary = RunBoundary()
    async def run():
        first, second = await asyncio.gather(boundary.deliver(), boundary.deliver())
        assert first == second
    asyncio.run(run())
    assert len(boundary.calls) == 1


def test_non_hermes_run_does_not_start_cognition():
    boundary = RunBoundary()
    boundary.parent["runtimeKind"] = "autogen"
    assert asyncio.run(boundary.deliver())["state"] == "ignored"
    assert boundary.calls == []


@pytest.mark.parametrize("state", ["running", "pending", "cancelled", "failed", "blocked"])
def test_existing_noncompleted_child_is_never_restarted(state):
    boundary = RunBoundary()
    boundary.runs["cognition:main-turn:thinkgraph"] = {
        "runId": "cognition:main-turn:thinkgraph", "cardId": "thinkgraph", "state": state,
    }
    result = asyncio.run(boundary.deliver())
    assert result["state"] == "halted" and result["childState"] == state
    assert boundary.calls == []


@pytest.mark.parametrize("state", ["running", "cancelled", "failed"])
def test_no_cascade_for_unfinished_or_failed_main(state):
    boundary = RunBoundary()
    boundary.parent["state"] = state
    assert asyncio.run(boundary.deliver())["state"] == "ignored"
    assert boundary.calls == []


def test_duplicate_profile_and_parent_scope_fail_before_execution():
    boundary = RunBoundary()
    boundary.cards.append(copy.deepcopy(boundary.cards[0]))
    with pytest.raises(ValueError, match="profile_binding_required"):
        asyncio.run(boundary.deliver())
    boundary.parent["projectId"] = "another-project"
    with pytest.raises(ValueError, match="parent_identity_mismatch"):
        asyncio.run(boundary.deliver())
    assert boundary.calls == []


def test_failed_thinkgraph_halts_without_research():
    boundary = RunBoundary()
    async def fail(args):
        boundary.calls.append(copy.deepcopy(args))
        return {"ok": False, "result": {"state": "failed"}}
    boundary.invoke = fail
    result = asyncio.run(boundary.deliver())
    assert result["state"] == "halted" and result["stage"] == "thinkgraph"
    assert [call["cardId"] for call in boundary.calls] == ["thinkgraph"]


def test_existing_research_run_is_neither_read_nor_replayed():
    boundary = RunBoundary()
    boundary.runs["cognition:main-turn:knowgraph"] = {
        "runId": "cognition:main-turn:knowgraph", "cardId": "liquidaity-hermes-steward", "state": "failed",
    }
    read = boundary.read
    def only_authorized_delivery(selector):
        assert selector.get("correlationId") != "cognition:main-turn:knowgraph"
        return read(selector)
    boundary.read = only_authorized_delivery
    assert asyncio.run(boundary.deliver())["state"] == "completed"
    assert [call["cardId"] for call in boundary.calls] == ["thinkgraph"]


def test_distinct_pairs_serialize_thinkgraph_without_research(monkeypatch):
    import app.python_models.cognition as cognition

    async def run():
        monkeypatch.setattr(cognition, "_delivery_lock", asyncio.Lock())
        first, second = RunBoundary(), RunBoundary()
        second.context["runId"] = second.parent["runId"] = "second-turn"
        active = maximum = 0

        def observe(boundary):
            invoke = boundary.invoke
            async def observed(args):
                nonlocal active, maximum
                active += 1
                maximum = max(maximum, active)
                try:
                    # Allow a concurrent invocation to enter if serialization is lost.
                    await asyncio.sleep(0.02)
                    return await invoke(args)
                finally:
                    active -= 1
            boundary.invoke = observed

        observe(first)
        observe(second)
        results = await asyncio.gather(first.deliver(), second.deliver())
        assert all(result["state"] == "completed" for result in results)
        assert maximum == 1
        assert [call["cardId"] for call in first.calls + second.calls] == ["thinkgraph", "thinkgraph"]
        assert second.calls[0]["correlationId"] == "cognition:second-turn:thinkgraph"

    asyncio.run(run())
