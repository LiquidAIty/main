from __future__ import annotations

import asyncio

from app.python_models.graph_compiler import CompiledSubgraph
from app.python_models.magentic_runtime import GraphScheduler, wait_for_runtime_or_coder_dispatch


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
