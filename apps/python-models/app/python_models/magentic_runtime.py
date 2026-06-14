"""LiquidAIty runtime adapters over the real Microsoft AutoGen v0.4.4 Magentic-One source.

Source line (locked): microsoft/autogen tag v0.4.4
- ``autogen_core``: SingleThreadedAgentRuntime, RoutedAgent message passing,
  FunctionTool, model clients via ``autogen_ext``.
- ``autogen_magentic_one``: the real Magentic-One Orchestrator
  (``LedgerOrchestrator`` with Task Ledger facts/plan and Progress Ledger
  JSON), ``BaseWorker`` protocol, BroadcastMessage / RequestReplyMessage /
  ResetMessage / DeactivateMessage flow.

Everything here is LiquidAIty adapter/glue mapping ReactFlow cards and edges
onto those primitives. There is no local fake agent runtime: every reply is a
real model-client call inside the real Magentic-One message flow, and every
failure propagates loudly.

Product concept -> v0.4.4 primitive map:
- Mag One bus            -> LedgerOrchestrator (Task Ledger + Progress Ledger)
- plain agent card       -> CardWorkerAgent(BaseWorker) with FunctionTool tools
- fan-out / Swarm card   -> FanOutWorkerAgent(BaseWorker), asyncio fan-out of
                            real model calls (card-level, never the bus)
- Society-of-Mind card   -> SocietyOfMindWorkerAgent(BaseWorker) running its
                            compiled child subgraph internally
- ReactFlow flow edges   -> GraphScheduler obligations constraining the
                            Orchestrator's next-speaker selection
- MissionSpec planning   -> the Orchestrator's own Task Ledger, generated
                            inside graph constraints
- UserProxyAgent         -> reserved, not wired
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Optional, Tuple

from autogen_core import (
    EVENT_LOGGER_NAME,
    AgentId,
    AgentProxy,
    CancellationToken,
    DefaultTopicId,
    MessageContext,
    SingleThreadedAgentRuntime,
    default_subscription,
)
from autogen_core.models import (
    AssistantMessage,
    ChatCompletionClient,
    FunctionExecutionResult,
    FunctionExecutionResultMessage,
    LLMMessage,
    SystemMessage,
    UserMessage,
)
from autogen_core.tools import FunctionTool

from autogen_magentic_one.agents.base_worker import BaseWorker
from autogen_magentic_one.agents.orchestrator import LedgerOrchestrator
from autogen_magentic_one.messages import BroadcastMessage, OrchestrationEvent, UserContent
from autogen_magentic_one.utils import message_content_to_str

from app.python_models.autogen_provider_env import (
    AutoGenAgentConfig,
    _assert_magentic_safe_model,
    _build_model_client,
)
from app.python_models.graph_compiler import (
    CompiledGraph,
    CompiledSubgraph,
    compile_card_graph,
)
from app.python_models.orchestration_contracts import ContextPack, GraphNodeInput
from app.python_models.tool_registry import (
    DEFAULT_TOOL_REGISTRY,
    reset_current_coder_dispatch_future,
    reset_current_coder_tool_context,
    set_current_coder_dispatch_future,
    set_current_coder_tool_context,
    tool_calculator,
    tool_current_datetime,
)


# ---------------------------------------------------------------------------
# Card tools: typed ToolRegistry resolution (T001). The card Tools tab is the
# only allowed source; unknown/disabled/unselected/schema-missing fail loudly.
# The real callables live in tool_registry.py and keep executing through real
# FunctionTool behavior.
# ---------------------------------------------------------------------------


def build_card_tools(tool_names: list[str]) -> list[FunctionTool]:
    """Resolve the card Tools tab selection through the typed ToolRegistry."""
    try:
        return DEFAULT_TOOL_REGISTRY.resolve_selected(tool_names)
    except RuntimeError as error:
        if "coder_console_task" in tool_names and "card_tool_unknown" in str(error):
            raise RuntimeError("MAGONE_CODER_CONSOLE_TOOL_NOT_REGISTERED") from error
        raise


# ---------------------------------------------------------------------------
# Shared LLM step: one real model-client exchange with a bounded tool loop.
# ---------------------------------------------------------------------------

_MAX_TOOL_ITERATIONS = 8


async def execute_llm_step(
    *,
    model_client: ChatCompletionClient,
    system_prompt: str,
    messages: list[LLMMessage],
    tools: list[FunctionTool],
    cancellation_token: Optional[CancellationToken],
    label: str,
) -> str:
    session: list[LLMMessage] = [SystemMessage(content=system_prompt)] + list(messages)
    tool_index = {tool.name: tool for tool in tools}
    for _ in range(_MAX_TOOL_ITERATIONS):
        response = await model_client.create(
            session, tools=tools, cancellation_token=cancellation_token
        )
        if isinstance(response.content, str):
            text = response.content.strip()
            if not text:
                raise RuntimeError(f"card_worker_empty_output: {label}")
            return response.content
        # Function call round: execute every requested tool for real.
        calls = response.content
        session.append(AssistantMessage(content=calls, source=label))
        results: list[FunctionExecutionResult] = []
        for call in calls:
            tool = tool_index.get(call.name)
            if tool is None:
                raise RuntimeError(f"card_tool_unknown: {call.name} (card={label})")
            arguments = json.loads(call.arguments or "{}")
            token = cancellation_token or CancellationToken()
            value = await tool.run_json(arguments, token)
            results.append(
                FunctionExecutionResult(content=tool.return_value_as_string(value), call_id=call.id)
            )
        session.append(FunctionExecutionResultMessage(content=results))
    raise RuntimeError(f"card_tool_loop_exceeded: {label}")


def _render_history(history: list[LLMMessage], limit: int = 8) -> str:
    lines: list[str] = []
    for message in history[-limit:]:
        source = getattr(message, "source", "system")
        lines.append(f"[{source}] {message_content_to_str(message.content)}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Worker adapters: thin LiquidAIty cards over the real Magentic-One BaseWorker.
# ---------------------------------------------------------------------------


@default_subscription
class CardWorkerAgent(BaseWorker):
    """A plain ReactFlow agent card on the Mag One bus: real model client,
    card instructions/role, and real FunctionTool execution."""

    def __init__(
        self,
        description: str,
        *,
        card_id: str,
        system_prompt: str,
        model_client: ChatCompletionClient,
        tools: list[FunctionTool],
    ) -> None:
        super().__init__(description)
        self._card_id = card_id
        self._system_prompt = system_prompt
        self._model_client = model_client
        self._tools = tools

    async def _generate_reply(self, cancellation_token: CancellationToken) -> Tuple[bool, UserContent]:
        reply = await execute_llm_step(
            model_client=self._model_client,
            system_prompt=self._system_prompt,
            messages=self._chat_history,
            tools=self._tools,
            cancellation_token=cancellation_token,
            label=self._card_id,
        )
        return False, reply


@dataclass
class SubgraphNodeRuntime:
    node: GraphNodeInput
    model_client: ChatCompletionClient
    tools: list[FunctionTool]
    system_prompt: str


class SubgraphRunner:
    """Executes a compiled child-agent subgraph: sequence levels in order,
    parallel groups concurrently, joins by aggregating predecessor outputs,
    loops bounded by their explicit exit rules. Every node step is a real
    model-client call."""

    def __init__(self, subgraph: CompiledSubgraph, node_runtimes: dict[str, SubgraphNodeRuntime]) -> None:
        self._subgraph = subgraph
        self._node_runtimes = node_runtimes

    async def run(self, task_text: str, cancellation_token: Optional[CancellationToken]) -> str:
        outputs: dict[str, str] = {}

        async def run_node(node_id: str) -> None:
            runtime = self._node_runtimes[node_id]
            predecessor_outputs = [
                f"[{self._node_runtimes[pred].node.title or pred}] {outputs[pred]}"
                for pred in self._subgraph.predecessors.get(node_id, [])
                if pred in outputs
            ]
            user_text = task_text
            if predecessor_outputs:
                user_text += "\n\nUpstream card outputs:\n" + "\n\n".join(predecessor_outputs)
            outputs[node_id] = await execute_llm_step(
                model_client=runtime.model_client,
                system_prompt=runtime.system_prompt,
                messages=[UserMessage(content=user_text, source="SocietyOfMindParent")],
                tools=runtime.tools,
                cancellation_token=cancellation_token,
                label=node_id,
            )

        scheduler = GraphScheduler(self._subgraph)
        if self._subgraph.flow_edges:
            while True:
                ready = scheduler.next_obligations()
                if not ready:
                    break
                await asyncio.gather(*(run_node(node_id) for node_id in ready))
                for node_id in ready:
                    scheduler.on_agent_spoken(node_id, outputs[node_id])
        else:
            await asyncio.gather(*(run_node(node_id) for node_id in self._subgraph.node_ids))

        terminal_ids = self._subgraph.terminal_node_ids or list(outputs.keys())
        final_parts = [outputs[node_id] for node_id in terminal_ids if node_id in outputs]
        final = "\n\n".join(part for part in final_parts if part.strip())
        if not final.strip():
            raise RuntimeError("som_subgraph_empty_output")
        return final


@default_subscription
class SocietyOfMindWorkerAgent(BaseWorker):
    """A participant card with a connected child-agent subgraph. The child
    subgraph runs internally; the parent is one outside-facing worker on the
    Mag One bus."""

    def __init__(
        self,
        description: str,
        *,
        card_id: str,
        runner: SubgraphRunner,
    ) -> None:
        super().__init__(description)
        self._card_id = card_id
        self._runner = runner

    async def _generate_reply(self, cancellation_token: CancellationToken) -> Tuple[bool, UserContent]:
        task_text = _render_history(self._chat_history)
        if not task_text.strip():
            raise RuntimeError(f"som_parent_missing_task: {self._card_id}")
        reply = await self._runner.run(task_text, cancellation_token)
        return False, reply


@default_subscription
class FanOutWorkerAgent(BaseWorker):
    """A fan-out-enabled card: many same-kind jobs executed concurrently with
    real model calls, aggregated into one outside-facing reply. Card-level
    only — never the Orchestrator."""

    def __init__(
        self,
        description: str,
        *,
        card_id: str,
        system_prompt: str,
        model_client: ChatCompletionClient,
        tools: list[FunctionTool],
        items: list[str],
    ) -> None:
        super().__init__(description)
        if not items:
            raise RuntimeError(f"fan_out_items_missing: {card_id}")
        self._card_id = card_id
        self._system_prompt = system_prompt
        self._model_client = model_client
        self._tools = tools
        self._items = items

    async def _generate_reply(self, cancellation_token: CancellationToken) -> Tuple[bool, UserContent]:
        task_text = _render_history(self._chat_history)

        async def run_item(index: int, item: str) -> str:
            user_text = (
                f"{task_text}\n\nYou are fan-out worker {index + 1} of {len(self._items)}."
                f"\nYour assigned job item: {item}"
            )
            return await execute_llm_step(
                model_client=self._model_client,
                system_prompt=self._system_prompt,
                messages=[UserMessage(content=user_text, source="FanOutDispatcher")],
                tools=self._tools,
                cancellation_token=cancellation_token,
                label=f"{self._card_id}#{index + 1}",
            )

        results = await asyncio.gather(
            *(run_item(index, item) for index, item in enumerate(self._items))
        )
        reply = "\n\n".join(
            f"[fan-out {index + 1}/{len(self._items)}: {item}]\n{result}"
            for index, (item, result) in enumerate(zip(self._items, results))
        )
        if not reply.strip():
            raise RuntimeError(f"fan_out_empty_output: {self._card_id}")
        return False, reply


# ---------------------------------------------------------------------------
# Graph scheduler: ReactFlow flow edges become next-speaker obligations.
# ---------------------------------------------------------------------------


class GraphScheduler:
    """Tracks edge-defined execution obligations over top-level participants.

    Entry nodes of every flow component are seeded up front; a node becomes
    ready once all its flow predecessors have spoken (join). Loop edges
    re-queue their cycle body until the explicit exit rule is met. The
    Orchestrator serves these obligations before consulting its Progress
    Ledger, so every ReactFlow edge-defined path executes."""

    def __init__(
        self,
        top_level: CompiledSubgraph,
        priority_node_ids: list[str] | None = None,
    ) -> None:
        self._successors = top_level.successors
        self._predecessors = top_level.predecessors
        self._loops = list(top_level.loops)
        self._spoken: set[str] = set()
        self._queued: set[str] = set()
        self._queue: list[str] = []
        self._loop_iterations: dict[int, int] = {}
        priority = [
            node_id
            for node_id in (priority_node_ids or [])
            if node_id in top_level.entry_node_ids
        ]
        for node_id in priority + [
            node_id for node_id in top_level.entry_node_ids if node_id not in priority
        ]:
            self._enqueue(node_id)

    def _enqueue(self, node_id: str) -> None:
        if node_id not in self._queued:
            self._queued.add(node_id)
            self._queue.append(node_id)

    def on_agent_spoken(self, node_id: str, text: str) -> None:
        self._spoken.add(node_id)
        self._queued.discard(node_id)
        continued_loop = False
        for index, loop in enumerate(self._loops):
            if loop.edge.source != node_id:
                continue
            iterations = self._loop_iterations.get(index, 1)
            if iterations >= loop.max_iterations:
                continue
            if loop.exit_on_text and loop.exit_on_text.lower() in text.lower():
                continue
            self._loop_iterations[index] = iterations + 1
            for cycle_node in loop.cycle_node_ids:
                self._spoken.discard(cycle_node)
            self._enqueue(loop.edge.target)
            continued_loop = True
        if continued_loop:
            return
        for target in self._successors.get(node_id, []):
            predecessors = self._predecessors.get(target, [])
            if all(pred in self._spoken for pred in predecessors):
                self._enqueue(target)

    def next_obligation(self) -> str | None:
        while self._queue:
            node_id = self._queue.pop(0)
            if node_id in self._queued:
                self._queued.discard(node_id)
                return node_id
        return None

    def next_obligations(self) -> list[str]:
        obligations: list[str] = []
        while True:
            obligation = self.next_obligation()
            if obligation is None:
                return obligations
            obligations.append(obligation)


# ---------------------------------------------------------------------------
# Orchestrator: the real Magentic-One LedgerOrchestrator, constrained by graph.
# ---------------------------------------------------------------------------


@default_subscription
class LiquidAItyGraphOrchestrator(LedgerOrchestrator):
    """The real v0.4.4 Magentic-One Orchestrator (Task Ledger facts/plan +
    Progress Ledger JSON) with LiquidAIty graph constraints: ReactFlow flow
    edges produce next-speaker obligations that are honored before the
    Progress Ledger picks dynamically. MissionSpec planning therefore happens
    inside graph constraints and never invents connections."""

    def __init__(
        self,
        *,
        scheduler: GraphScheduler,
        proxies_by_node_id: dict[str, AgentProxy],
        node_id_by_name: dict[str, str],
        **kwargs: Any,
    ) -> None:
        super().__init__(**kwargs)
        self._scheduler = scheduler
        self._proxies_by_node_id = proxies_by_node_id
        self._node_id_by_name = node_id_by_name
        self.final_answer_text: str | None = None
        self.graph_dispatches: list[str] = []

    async def _handle_broadcast(self, message: BroadcastMessage, ctx: MessageContext) -> None:
        source = getattr(message.content, "source", None)
        node_id = self._node_id_by_name.get(str(source or ""))
        if node_id is not None:
            self._scheduler.on_agent_spoken(node_id, message_content_to_str(message.content.content))
        await super()._handle_broadcast(message, ctx)

    async def _select_next_agent(
        self, message: LLMMessage, cancellation_token: Optional[CancellationToken] = None
    ) -> Optional[AgentProxy]:
        if self._task:
            obligation = self._scheduler.next_obligation()
            if obligation is not None:
                self.graph_dispatches.append(obligation)
                self.logger.info(
                    OrchestrationEvent(
                        f"{self.metadata['type']} (graph edge dispatch)",
                        f"ReactFlow flow edge obligation -> {obligation}",
                    )
                )
                return self._proxies_by_node_id[obligation]
        return await super()._select_next_agent(message, cancellation_token)

    async def _prepare_final_answer(self, cancellation_token: Optional[CancellationToken] = None) -> str:
        answer = await super()._prepare_final_answer(cancellation_token)
        self.final_answer_text = answer
        return answer


# ---------------------------------------------------------------------------
# Mission entrypoint.
# ---------------------------------------------------------------------------


class _TranscriptHandler(logging.Handler):
    def __init__(self) -> None:
        super().__init__()
        self.lines: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        event = record.msg
        if isinstance(event, OrchestrationEvent):
            self.lines.append(f"{event.source}: {event.message}")


@dataclass
class MagenticRunResult:
    final_text: str
    transcript: list[str]
    rounds_used: int
    graph_dispatches: list[str] = field(default_factory=list)
    stop_reason: str = "magentic_one_complete"


def _cancel_agent_processing(created_agents: list[Any]) -> None:
    for agent in created_agents:
        processing_task = getattr(agent, "_processing_task", None)
        if processing_task is not None:
            processing_task.cancel()


async def wait_for_runtime_or_coder_dispatch(
    runtime: SingleThreadedAgentRuntime,
    dispatch_future: asyncio.Future[dict[str, Any]],
    created_agents: list[Any],
    *,
    dispatch_timeout_seconds: float | None = None,
    timeout_result: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Stop Mag One rails once Code Console accepts or blocks a real dispatch."""
    idle_task = asyncio.create_task(runtime.stop_when_idle())
    done, _ = await asyncio.wait(
        {idle_task, dispatch_future},
        timeout=dispatch_timeout_seconds,
        return_when=asyncio.FIRST_COMPLETED,
    )
    if not done and timeout_result is not None:
        idle_task.cancel()
        await asyncio.gather(idle_task, return_exceptions=True)
        _cancel_agent_processing(created_agents)
        await runtime.stop()
        return timeout_result
    if dispatch_future in done:
        if not idle_task.done():
            idle_task.cancel()
            await asyncio.gather(idle_task, return_exceptions=True)
        _cancel_agent_processing(created_agents)
        await runtime.stop()
        return dispatch_future.result()
    await idle_task
    return None


def _sanitize_agent_name(title: str, used: set[str]) -> str:
    base = re.sub(r"[^A-Za-z0-9_]+", "_", str(title or "Agent")).strip("_") or "Agent"
    name = base
    suffix = 1
    while name in used:
        suffix += 1
        name = f"{base}_{suffix}"
    used.add(name)
    return name


def _compose_task_text(context: ContextPack) -> str:
    coding_packet = context.codingWorkflowPacket or {}
    if str(coding_packet.get("intent") or "").strip().lower() == "coding":
        compact_spec = str(coding_packet.get("compactSpec") or "").strip()
        if compact_spec:
            return compact_spec
    parts: list[str] = []
    system_prompt = str(context.systemPrompt or "").strip()
    if system_prompt:
        parts.append(system_prompt)
    prior = str(context.priorAssistantText or "").strip()
    if prior:
        parts.append(f"Prior assistant context:\n{prior}")
    user_text = str(context.userText or "").strip()
    if user_text:
        parts.append(f"Task:\n{user_text}")
    workspace = context.workspaceObjectContext
    if workspace is not None:
        target_root = str(workspace.repoPath or workspace.workspaceRoot or "").strip()
        if target_root:
            parts.append(
                f"Execution context:\nProject ID: {context.session.projectId}\nTarget root: {target_root}"
            )
    task = "\n\n".join(parts)
    if not task.strip():
        raise RuntimeError("autogen_runtime_empty_task")
    return task


def _participant_system_prompt(node: GraphNodeInput, prompt_fallback: str) -> str:
    parts: list[str] = []
    prompt = str(node.prompt or prompt_fallback or "").strip()
    if prompt:
        parts.append(prompt)
    role = str(node.role or "").strip()
    if role:
        parts.append(f"Your role: {role}")
    if not parts:
        parts.append(f"You are the agent card '{node.title or node.cardId}'. Complete the instruction you are given.")
    if str(node.role or "").strip().lower() == "local_coder":
        parts.append(
            "For coding work, call your selected coder_console_task exactly once. "
            "Pass the current project id, explicit target root, user goal, a compact task prompt, "
            "and edit_mode=read_only unless an approved future workflow explicitly permits edits. "
            "Do not perform the coding task yourself and do not ask the user to type in the terminal. "
            "Return the tool's status, session id, target root, provider/model, watch surface, and blocker."
        )
    parts.append("Be concise and complete the requested step directly.")
    return "\n\n".join(parts)


def _build_node_client(node: GraphNodeInput, system_prompt: str) -> ChatCompletionClient:
    config = AutoGenAgentConfig(
        provider=str(node.provider or ""),
        provider_model_id=str(node.providerModelId or ""),
        system_prompt=system_prompt,
        temperature=node.temperature,
        max_tokens=node.maxTokens,
    )
    return _build_model_client(config)


async def run_magentic_mission(context: ContextPack) -> MagenticRunResult:
    card = context.cardRuntime
    if card is None:
        raise RuntimeError("card_runtime_missing")

    compiled: CompiledGraph = compile_card_graph(card)
    session = context.session

    orchestrator_config = AutoGenAgentConfig(
        provider=session.modelProvider,
        provider_model_id=session.providerModelId,
    )
    _assert_magentic_safe_model(orchestrator_config)
    orchestrator_client = _build_model_client(orchestrator_config)

    runtime_options = card.runtimeOptions or {}
    try:
        max_rounds = int(runtime_options.get("maxRounds") or runtime_options.get("maxTurns") or 0)
    except (TypeError, ValueError):
        max_rounds = 0
    if max_rounds <= 0:
        max_rounds = max(12, 2 * len(compiled.participant_ids) + 6)
    try:
        max_time_seconds = float(runtime_options.get("maxTimeSeconds") or 0)
    except (TypeError, ValueError):
        max_time_seconds = 0
    if max_time_seconds <= 0:
        max_time_seconds = 300.0

    runtime = SingleThreadedAgentRuntime()
    used_names: set[str] = set()
    used_names.add("MagenticOneOrchestrator")
    proxies_by_node_id: dict[str, AgentProxy] = {}
    node_id_by_name: dict[str, str] = {}
    created_agents: list[Any] = []
    participant_proxies: list[AgentProxy] = []

    participants_by_id = {participant.cardId: participant for participant in card.participants}

    for participant_id in compiled.participant_ids:
        participant = participants_by_id[participant_id]
        node = compiled.nodes[participant_id]
        name = _sanitize_agent_name(node.title or participant.title or participant_id, used_names)
        system_prompt = _participant_system_prompt(node, participant.prompt)
        tool_names = list(node.tools or participant.tools or [])
        description = (
            f"Agent card '{node.title or participant_id}'. "
            + (str(node.role or "").strip() or "Executes its card instructions.")
        )

        if participant_id in compiled.som_subgraphs:
            subgraph = compiled.som_subgraphs[participant_id]
            node_runtimes: dict[str, SubgraphNodeRuntime] = {}
            for child_id in subgraph.node_ids:
                child_node = compiled.nodes[child_id]
                child_prompt = _participant_system_prompt(child_node, "")
                node_runtimes[child_id] = SubgraphNodeRuntime(
                    node=child_node,
                    model_client=_build_node_client(child_node, child_prompt),
                    tools=build_card_tools(list(child_node.tools or [])),
                    system_prompt=child_prompt,
                )
            runner = SubgraphRunner(subgraph, node_runtimes)

            def som_factory(
                _description: str = description,
                _card_id: str = participant_id,
                _runner: SubgraphRunner = runner,
            ) -> SocietyOfMindWorkerAgent:
                agent = SocietyOfMindWorkerAgent(_description, card_id=_card_id, runner=_runner)
                created_agents.append(agent)
                return agent

            await SocietyOfMindWorkerAgent.register(runtime, name, som_factory)
        elif participant_id in compiled.fan_out_ids:
            fan_out = participant.fanOut or node.fanOut
            assert fan_out is not None  # compile_card_graph guarantees this
            items = [str(item).strip() for item in (fan_out.items or []) if str(item).strip()]
            if not items:
                items = [f"job {index + 1} of {fan_out.count}" for index in range(fan_out.count)]
            model_client = _build_node_client(node, system_prompt)
            tools = build_card_tools(tool_names)

            def fan_out_factory(
                _description: str = description,
                _card_id: str = participant_id,
                _system_prompt: str = system_prompt,
                _model_client: ChatCompletionClient = model_client,
                _tools: list[FunctionTool] = tools,
                _items: list[str] = items,
            ) -> FanOutWorkerAgent:
                agent = FanOutWorkerAgent(
                    _description,
                    card_id=_card_id,
                    system_prompt=_system_prompt,
                    model_client=_model_client,
                    tools=_tools,
                    items=_items,
                )
                created_agents.append(agent)
                return agent

            await FanOutWorkerAgent.register(runtime, name, fan_out_factory)
        else:
            model_client = _build_node_client(node, system_prompt)
            tools = build_card_tools(tool_names)

            def card_factory(
                _description: str = description,
                _card_id: str = participant_id,
                _system_prompt: str = system_prompt,
                _model_client: ChatCompletionClient = model_client,
                _tools: list[FunctionTool] = tools,
            ) -> CardWorkerAgent:
                agent = CardWorkerAgent(
                    _description,
                    card_id=_card_id,
                    system_prompt=_system_prompt,
                    model_client=_model_client,
                    tools=_tools,
                )
                created_agents.append(agent)
                return agent

            await CardWorkerAgent.register(runtime, name, card_factory)

        proxy = AgentProxy(AgentId(name, "default"), runtime)
        proxies_by_node_id[participant_id] = proxy
        node_id_by_name[name] = participant_id
        participant_proxies.append(proxy)

    coder_dispatch_priority = [
        participant_id
        for participant_id in compiled.participant_ids
        if str(
            compiled.nodes[participant_id].role
            or participants_by_id[participant_id].role
            or ""
        ).strip().lower()
        == "local_coder"
        and "coder_console_task"
        in list(compiled.nodes[participant_id].tools or participants_by_id[participant_id].tools or [])
    ]
    scheduler = GraphScheduler(
        compiled.top_level,
        priority_node_ids=coder_dispatch_priority,
    )
    orchestrator_holder: dict[str, LiquidAItyGraphOrchestrator] = {}

    def orchestrator_factory() -> LiquidAItyGraphOrchestrator:
        orchestrator = LiquidAItyGraphOrchestrator(
            scheduler=scheduler,
            proxies_by_node_id=proxies_by_node_id,
            node_id_by_name=node_id_by_name,
            agents=participant_proxies,
            model_client=orchestrator_client,
            max_rounds=max_rounds,
            max_time=max_time_seconds,
            return_final_answer=True,
        )
        orchestrator_holder["orchestrator"] = orchestrator
        created_agents.append(orchestrator)
        return orchestrator

    await LiquidAItyGraphOrchestrator.register(runtime, "MagenticOneOrchestrator", orchestrator_factory)

    transcript_handler = _TranscriptHandler()
    event_logger = logging.getLogger(EVENT_LOGGER_NAME)
    previous_level = event_logger.level
    event_logger.setLevel(logging.INFO)
    event_logger.addHandler(transcript_handler)

    started = time.monotonic()
    dispatch_future = asyncio.get_running_loop().create_future()
    tool_context_token = set_current_coder_tool_context(context)
    dispatch_token = set_current_coder_dispatch_future(dispatch_future)
    dispatch_result: dict[str, Any] | None = None
    try:
        runtime.start()
        task_text = _compose_task_text(context)
        await runtime.publish_message(
            BroadcastMessage(content=UserMessage(content=task_text, source="User")),
            topic_id=DefaultTopicId(),
        )
        dispatch_result = await wait_for_runtime_or_coder_dispatch(
            runtime,
            dispatch_future,
            created_agents,
            dispatch_timeout_seconds=45.0 if context.codingWorkflowPacket else None,
            timeout_result=(
                {
                    "status": "blocked",
                    "message": (
                        "MAGONE_CODING_DISPATCH_TIMEOUT_BEFORE_TOOL_CALL: "
                        f"intent=coding selected_agent={str((context.codingWorkflowPacket or {}).get('selectedPrimaryAgent') or 'unavailable')} "
                        f"tool=coder_console_task available={bool(coder_dispatch_priority)} elapsed_seconds=45 "
                        "next=inspect Mag One Local Coder tool selection"
                    ),
                    "blocker": "MAGONE_CODING_DISPATCH_TIMEOUT_BEFORE_TOOL_CALL",
                }
                if context.codingWorkflowPacket
                else None
            ),
        )
    finally:
        reset_current_coder_dispatch_future(dispatch_token)
        reset_current_coder_tool_context(tool_context_token)
        event_logger.removeHandler(transcript_handler)
        event_logger.setLevel(previous_level)
        _cancel_agent_processing(created_agents)

    orchestrator = orchestrator_holder.get("orchestrator")
    if dispatch_result is not None:
        return MagenticRunResult(
            final_text=str(dispatch_result["message"]),
            transcript=transcript_handler.lines[-60:],
            rounds_used=orchestrator._num_rounds if orchestrator is not None else 0,
            graph_dispatches=list(orchestrator.graph_dispatches) if orchestrator is not None else [],
            stop_reason=f"coder_console_{dispatch_result['status']}",
        )
    if orchestrator is None:
        raise RuntimeError("magentic_orchestrator_not_instantiated")

    final_text = str(orchestrator.final_answer_text or "").strip()
    if not final_text:
        raise RuntimeError(
            "autogen_runtime_empty_final_output: the Magentic-One Orchestrator did not produce a final answer "
            f"(rounds_used={orchestrator._num_rounds}, max_rounds={max_rounds}, "
            f"elapsed_s={time.monotonic() - started:.1f})"
        )

    return MagenticRunResult(
        final_text=final_text,
        transcript=transcript_handler.lines[-60:],
        rounds_used=orchestrator._num_rounds,
        graph_dispatches=list(orchestrator.graph_dispatches),
    )
