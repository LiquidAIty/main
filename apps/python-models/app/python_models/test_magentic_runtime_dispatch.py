from __future__ import annotations

import asyncio

from app.python_models.graph_compiler import CompiledSubgraph
from app.python_models.magentic_runtime import (
    GraphScheduler,
    _compose_task_text,
    wait_for_runtime_or_coder_dispatch,
)
from app.python_models.orchestration_contracts import ContextPack


class _LongRunningRuntime:
    def __init__(self) -> None:
        self.stopped = False

    async def stop_when_idle(self) -> None:
        await asyncio.sleep(60)

    async def stop(self) -> None:
        self.stopped = True


def test_coder_dispatch_stops_rails_before_long_running_completion() -> None:
    async def run() -> None:
        runtime = _LongRunningRuntime()
        dispatch = asyncio.get_running_loop().create_future()
        dispatch.set_result(
            {
                "status": "started",
                "message": "Mag One started a coder task. Watch Code Console.",
            }
        )

        result = await asyncio.wait_for(
            wait_for_runtime_or_coder_dispatch(runtime, dispatch, []), timeout=0.2
        )

        assert result is dispatch.result()
        assert result["status"] == "started"
        assert runtime.stopped is True

    asyncio.run(run())


def test_scheduler_prioritizes_coder_dispatch_without_inventing_graph_nodes() -> None:
    subgraph = CompiledSubgraph(
        node_ids=["plan", "codegraph", "coder"],
        entry_node_ids=["plan", "codegraph", "coder"],
        terminal_node_ids=["plan", "codegraph", "coder"],
        flow_edges=[],
        successors={"plan": [], "codegraph": [], "coder": []},
        predecessors={"plan": [], "codegraph": [], "coder": []},
        loops=[],
    )

    scheduler = GraphScheduler(subgraph, priority_node_ids=["coder", "not-on-graph"])

    assert scheduler.next_obligations() == ["coder", "plan", "codegraph"]


def test_compose_task_text_never_overridden_by_typescript_coding_packet() -> None:
    """The bypass is gone: even if a legacy codingWorkflowPacket is present, the
    real user request + canvas context drive the task. TypeScript no longer
    hands Magentic-One a precomposed coder compactSpec to execute."""
    context = ContextPack.model_validate(
        {
            "session": {
                "sessionId": "s1",
                "projectId": "p1",
                "turnId": "t1",
                "route": "deck_runtime",
                "orchestrator": "magentic_one",
                "modelProvider": "openai",
                "modelKey": "gpt-5-mini",
                "providerModelId": "gpt-5-mini",
                "startedAt": "2026-01-01T00:00:00Z",
            },
            "userText": "can you do a code audit",
            "systemPrompt": "real canvas system prompt",
            "codingWorkflowPacket": {
                "intent": "coding",
                "projectId": "p1",
                "targetRoot": "C:\\Projects\\main",
                "compactSpec": "COMPACT MAG ONE CODING WORKFLOW\nTool: coder_console_task",
            },
        }
    )
    task = _compose_task_text(context)
    # The genuine request and canvas prompt are used; the TS compactSpec is not.
    assert "can you do a code audit" in task
    assert "real canvas system prompt" in task
    assert "COMPACT MAG ONE CODING WORKFLOW" not in task
    assert "MAGONE_CODING_DISPATCH_TIMEOUT_BEFORE_TOOL_CALL" not in task


def test_wait_for_runtime_has_no_typescript_timeout_path() -> None:
    """wait_for_runtime_or_coder_dispatch no longer accepts a TS-driven timeout
    or a fake blocker result. It only waits for the real run or a genuine
    dispatch."""
    import inspect

    params = inspect.signature(wait_for_runtime_or_coder_dispatch).parameters
    assert "dispatch_timeout_seconds" not in params
    assert "timeout_result" not in params
