"""Deterministic delivery contracts; these tests never invoke a model or graph."""
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


def test_saved_runs_order_and_original_pair_without_runtime_overrides():
    boundary = RunBoundary()
    result = asyncio.run(boundary.deliver())
    assert result["state"] == "completed"
    assert [c["cardId"] for c in boundary.calls] == boundary.profiles
    for call in boundary.calls:
        assert call["originatingAgentId"] == "main"
        assert call["originatingRunId"] == "main-turn"
        assert not {"model", "provider", "prompt", "tools", "builderOperation"} & call.keys()
        mission = json.loads(call["input"])
        assert mission["completedPair"]["user"] == "Original user message"
        assert mission["selectedReferences"] == [{"authority": "ThinkGraph", "nativeId": "native:1"}]
    research = json.loads(boundary.calls[-1]["input"])
    assert [x["stage"] for x in research["referenceHints"]] == ["thinkgraph"]
    assert "do not write a final report" in research["purpose"]
    assert all(call["cardId"] != "liquidaity-agent-builder" for call in boundary.calls)


def test_duplicate_completion_reuses_durable_stage_results():
    boundary = RunBoundary()
    async def run():
        first = await boundary.deliver()
        second = await boundary.deliver()
        assert first == second
    asyncio.run(run())
    assert len(boundary.calls) == 2


def test_concurrent_completion_delivery_does_not_duplicate_children():
    boundary = RunBoundary()
    async def run():
        first, second = await asyncio.gather(boundary.deliver(), boundary.deliver())
        assert first == second
    asyncio.run(run())
    assert len(boundary.calls) == 2


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


def test_failed_second_stage_halts_graph_maintenance():
    boundary = RunBoundary()
    invoke = boundary.invoke
    async def fail_knowgraph(args):
        if args["cardId"] == "liquidaity-hermes-steward":
            return {"ok": False, "result": {"state": "failed"}}
        return await invoke(args)
    boundary.invoke = fail_knowgraph
    result = asyncio.run(boundary.deliver())
    assert result["state"] == "halted" and result["stage"] == "knowgraph"
    assert len(boundary.calls) == 1


def test_slow_research_does_not_block_next_pairs_reasoning(monkeypatch):
    import app.python_models.cognition as cognition

    async def run():
        # Independent event loop, while retaining the production lock scope.
        monkeypatch.setattr(cognition, "_stage_locks", {
            stage: asyncio.Lock() for stage in cognition._STAGES
        })
        first, second = RunBoundary(), RunBoundary()
        second.context["runId"] = second.parent["runId"] = "second-turn"
        research_started = asyncio.Event()
        release_research = asyncio.Event()
        second_reasoned = asyncio.Event()
        active = {stage: 0 for stage in first.profiles}
        maximum = active.copy()

        def instrument(boundary):
            invoke = boundary.invoke

            async def observed(args):
                stage = args["cardId"]
                active[stage] += 1
                maximum[stage] = max(maximum[stage], active[stage])
                try:
                    if boundary is first and stage == first.profiles[1]:
                        research_started.set()
                        await release_research.wait()
                    result = await invoke(args)
                    if boundary is second and stage == first.profiles[0]:
                        second_reasoned.set()
                    return result
                finally:
                    active[stage] -= 1

            boundary.invoke = observed

        instrument(first)
        instrument(second)
        first_task = asyncio.create_task(first.deliver())
        await asyncio.wait_for(research_started.wait(), 2)
        second_task = asyncio.create_task(second.deliver())
        try:
            await asyncio.wait_for(second_reasoned.wait(), 2)
            assert [c["cardId"] for c in second.calls] == ["thinkgraph"]
        finally:
            release_research.set()
            results = await asyncio.gather(first_task, second_task)
        assert all(result["state"] == "completed" for result in results)
        assert maximum == {stage: 1 for stage in first.profiles}
        assert [c["cardId"] for c in second.calls] == second.profiles
        assert json.loads(second.calls[1]["input"])["referenceHints"][0]["runId"] == "cognition:second-turn:thinkgraph"

    asyncio.run(run())
