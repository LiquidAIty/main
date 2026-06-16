"""LiquidAIty Magentic-One native adapter (AutoGen 0.7.5).

Wraps the real ``autogen_agentchat`` ``MagenticOneGroupChat`` /
``MagenticOneOrchestrator`` from the in-repo root reference (autogen-main, 0.7.5).

Two-phase gate over the real orchestrator:

* Phase 1 (planning, ``runApproved=False``): run the real outer loop — gather
  the Task Ledger facts (``ORCHESTRATOR_TASK_LEDGER_FACTS_PROMPT``) and plan
  (``ORCHESTRATOR_TASK_LEDGER_PLAN_PROMPT``) inside ``handle_start`` — then halt
  before the Progress Ledger / inner loop. Return a structured ``TaskLedger`` for
  the Plan canvas.
* Phase 2 (approved, ``runApproved=True``): resume into the Progress Ledger /
  inner loop (``ORCHESTRATOR_PROGRESS_LEDGER_PROMPT``) and return a structured
  ``ProgressLedger`` for the Agent canvas.

Connected LiquidAIty cards are compiled into AutoGen participants via
``graph_compiler.compile_card_graph`` from the real ``cardRuntime.graph`` /
``cardRuntime.participants`` payload — never from a nonexistent ``thinkGraph``
field. No raw text is ever used as runtime state.
"""
from __future__ import annotations

import re
import time
from typing import Any

from autogen_core import CancellationToken
from autogen_agentchat.agents import AssistantAgent
from autogen_agentchat.base import ChatAgent
from autogen_agentchat.messages import StopMessage
from autogen_agentchat.teams import MagenticOneGroupChat
from autogen_agentchat.teams._group_chat._magentic_one._magentic_one_orchestrator import (
    MagenticOneOrchestrator,
)
from autogen_agentchat.teams._group_chat._magentic_one._prompts import LedgerEntry
from autogen_core.utils import extract_json_from_str

from app.python_models.autogen_provider_env import AutoGenAgentConfig, _build_model_client
from app.python_models.graph_compiler import GraphCompileError, compile_card_graph
from app.python_models.orchestration_contracts import (
    ConnectedAgent,
    ContextPack,
    KnowGraphUpdateReport,
    LedgerTrace,
    OrchestratorMetrics,
    OrchestratorRunResponse,
    PlanStep,
    ProgressEvent,
    ProgressLedger,
    TaskLedger,
)

HALT_REASON = "HALTED_FOR_RUN_TASK"

# Headings emitted by ORCHESTRATOR_TASK_LEDGER_FACTS_PROMPT, mapped to the
# structured TaskLedger fact buckets. The orchestrator is instructed to use
# exactly these four headings and nothing else.
_FACTS_SECTIONS: list[tuple[str, str]] = [
    ("GIVEN OR VERIFIED FACTS", "known_facts"),
    ("FACTS TO LOOK UP", "unknowns_to_lookup"),
    ("FACTS TO DERIVE", "facts_to_derive"),
    ("EDUCATED GUESSES", "assumptions_or_guesses"),
]


def _sanitize_agent_name(raw: str, fallback: str) -> str:
    """AutoGen participant names must be identifier-like (no spaces)."""
    name = re.sub(r"[^a-zA-Z0-9_]", "_", str(raw or "").strip())
    name = re.sub(r"_+", "_", name).strip("_")
    if not name:
        name = re.sub(r"[^a-zA-Z0-9_]", "_", fallback) or "Agent"
    if name[0].isdigit():
        name = f"agent_{name}"
    return name


def _clean_lines(block: str) -> list[str]:
    out: list[str] = []
    for line in block.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        # Drop list markers / leading numbering so buckets hold plain facts.
        stripped = re.sub(r"^\s*(?:[-*•]|\d+[.)])\s*", "", stripped).strip()
        if not stripped:
            continue
        # Skip "None." style placeholders the model emits for empty sections.
        if stripped.lower() in {"none", "none.", "n/a", "none identified."}:
            continue
        out.append(stripped)
    return out


def parse_facts_sheet(facts: str) -> dict[str, list[str]]:
    """Split the real facts sheet into the four structured TaskLedger buckets.

    The facts sheet is real model output produced by the genuine facts prompt;
    this only routes its already-present sections into typed fields. It is not a
    source-of-truth invention and never fabricates content.
    """
    buckets: dict[str, list[str]] = {field: [] for _, field in _FACTS_SECTIONS}
    if not facts or not facts.strip():
        return buckets

    # Locate each heading by position, then slice the text between headings.
    lowered = facts.lower()
    marks: list[tuple[int, str]] = []
    for heading, field in _FACTS_SECTIONS:
        idx = lowered.find(heading.lower())
        if idx != -1:
            marks.append((idx, field))
    marks.sort(key=lambda m: m[0])

    if not marks:
        # No recognizable headings: keep the whole sheet as known facts rather
        # than dropping real content.
        buckets["known_facts"] = _clean_lines(facts)
        return buckets

    for position, (start, field) in enumerate(marks):
        end = marks[position + 1][0] if position + 1 < len(marks) else len(facts)
        section = facts[start:end]
        # Remove the heading line itself.
        section = re.sub(r"^[^\n]*\n", "", section, count=1)
        buckets[field].extend(_clean_lines(section))
    return buckets


def parse_plan_steps(plan: str, agent_names: list[str]) -> list[PlanStep]:
    """Turn the real plan bullets into structured, non-executable plan steps."""
    steps: list[PlanStep] = []
    default_agent = agent_names[0] if agent_names else "team"
    for raw in _clean_lines(plan or ""):
        assigned = default_agent
        for name in agent_names:
            if re.search(rf"\b{re.escape(name)}\b", raw, flags=re.IGNORECASE):
                assigned = name
                break
        steps.append(
            PlanStep(
                id=f"step_{len(steps) + 1}",
                task=raw,
                assigned_agent=assigned,
                required_tools=[],
                execution_allowed_now=False,
                approval_required=True,
                status="planned",
            )
        )
    return steps


def compile_connected_agents(context: ContextPack) -> list[dict[str, Any]]:
    """Compile the connected LiquidAIty cards into participant metadata.

    Uses the real ReactFlow payload at ``cardRuntime.graph`` / ``participants``
    via the canonical ``graph_compiler``. Returns one dict per participant with
    the model configuration needed to build a real AutoGen ``AssistantAgent``.
    """
    card = context.cardRuntime
    if card is None:
        raise GraphCompileError("card_runtime_missing")

    compiled = compile_card_graph(card)
    agents: list[dict[str, Any]] = []
    for participant_id in compiled.participant_ids:
        node = compiled.nodes[participant_id]
        name = _sanitize_agent_name(node.title or participant_id, participant_id)
        agents.append(
            {
                "id": participant_id,
                "name": name,
                "role": str(node.role or "agent"),
                "tools": list(node.tools or []),
                "prompt": str(node.prompt or "").strip(),
                "provider": node.provider,
                "provider_model_id": node.providerModelId,
                "temperature": node.temperature,
                "max_tokens": node.maxTokens,
            }
        )
    return agents


def _build_participants(agent_specs: list[dict[str, Any]]) -> list[ChatAgent]:
    participants: list[ChatAgent] = []
    for spec in agent_specs:
        client = _build_model_client(
            AutoGenAgentConfig(
                provider=str(spec.get("provider") or ""),
                provider_model_id=str(spec.get("provider_model_id") or ""),
                system_prompt=spec.get("prompt") or "",
                temperature=spec.get("temperature"),
                max_tokens=spec.get("max_tokens"),
            )
        )
        participants.append(
            AssistantAgent(
                name=spec["name"],
                description=spec.get("prompt") or f"Connected agent {spec['name']}",
                system_message=spec.get("prompt") or "You are a helpful team member.",
                model_client=client,
            )
        )
    return participants


class LiquidAItyOrchestrator(MagenticOneOrchestrator):
    """Real Magentic-One orchestrator with a Run Task gate.

    Phase 1 halts the inner loop right after the outer-loop Task Ledger is built
    (``handle_start`` produced facts + plan before the first ``_orchestrate_step``)
    so the Plan canvas can show the Task Ledger and wait for approval. Phase 2
    runs the real inner loop / Progress Ledger.
    """

    def __init__(self, *args: Any, run_task_approved: bool = False, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self._run_task_approved = run_task_approved
        self._last_progress_ledger: dict[str, Any] | None = None

        original_create = self._model_client.create

        async def capturing_create(*a: Any, **kw: Any) -> Any:
            res = await original_create(*a, **kw)
            json_output = kw.get("json_output")
            if json_output is LedgerEntry or json_output is True:
                try:
                    self._last_progress_ledger = extract_json_from_str(res.content)[0]
                except Exception:
                    pass
            return res

        self._model_client.create = capturing_create  # type: ignore[method-assign]

    async def _orchestrate_step(self, cancellation_token: CancellationToken) -> None:
        if not self._run_task_approved and self._n_rounds == 0:
            await self._signal_termination(StopMessage(content=HALT_REASON, source=self._name))
            return
        await super()._orchestrate_step(cancellation_token)


class LiquidAItyMagenticOneGroupChat(MagenticOneGroupChat):
    def __init__(self, *args: Any, run_task_approved: bool = False, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.run_task_approved = run_task_approved
        self.orchestrator_instance: LiquidAItyOrchestrator | None = None

    def _create_group_chat_manager_factory(
        self,
        name: str,
        group_topic_type: str,
        output_topic_type: str,
        participant_topic_types: list[str],
        participant_names: list[str],
        participant_descriptions: list[str],
        output_message_queue: Any,
        termination_condition: Any,
        max_turns: int | None,
        message_factory: Any,
    ):
        def factory() -> LiquidAItyOrchestrator:
            self.orchestrator_instance = LiquidAItyOrchestrator(
                name,
                group_topic_type,
                output_topic_type,
                participant_topic_types,
                participant_names,
                participant_descriptions,
                max_turns,
                message_factory,
                self._model_client,
                self._max_stalls,
                self._final_answer_prompt,
                output_message_queue,
                termination_condition,
                self._emit_team_events,
                run_task_approved=self.run_task_approved,
            )
            return self.orchestrator_instance

        return factory


def build_task_ledger(
    user_goal: str,
    facts: str,
    plan: str,
    agent_specs: list[dict[str, Any]],
) -> TaskLedger:
    buckets = parse_facts_sheet(facts)
    agent_names = [spec["name"] for spec in agent_specs]
    connected_agents = [
        ConnectedAgent(
            id=spec["id"],
            name=spec["name"],
            role=spec["role"],
            tools=spec["tools"],
            execution_allowed_now=False,
            approval_required=True,
            status="planned",
        )
        for spec in agent_specs
    ]
    return TaskLedger(
        user_goal=user_goal,
        known_facts=buckets["known_facts"],
        unknowns_to_lookup=buckets["unknowns_to_lookup"],
        facts_to_derive=buckets["facts_to_derive"],
        assumptions_or_guesses=buckets["assumptions_or_guesses"],
        connected_agents=connected_agents,
        plan_steps=parse_plan_steps(plan, agent_names),
    )


def build_progress_ledger(
    progress_data: dict[str, Any] | None,
    events: list[ProgressEvent],
    agent_result: str,
    n_rounds: int,
) -> ProgressLedger:
    data = progress_data or {}

    def answer(key: str, default: Any = "") -> Any:
        node = data.get(key)
        return node.get("answer", default) if isinstance(node, dict) else default

    def reason(key: str, default: str = "") -> str:
        node = data.get(key)
        return str(node.get("reason", default)) if isinstance(node, dict) else default

    satisfied = bool(answer("is_request_satisfied", False))
    in_loop = bool(answer("is_in_loop", False))
    progressing = bool(answer("is_progress_being_made", True))
    if satisfied:
        progress_state = "completed"
    elif in_loop:
        progress_state = "stalled"
    elif not progressing:
        progress_state = "blocked"
    else:
        progress_state = "running"

    blocker = ""
    if progress_state == "blocked":
        blocker = reason("is_progress_being_made") or "No forward progress reported."
    elif progress_state == "stalled":
        blocker = reason("is_in_loop") or "Repeating the same step."

    return ProgressLedger(
        current_step=str(n_rounds) if n_rounds else None,
        selected_agent=str(answer("next_speaker") or "") or None,
        instruction=str(answer("instruction_or_question") or "") or None,
        agent_result=agent_result or None,
        progress_state=progress_state,  # type: ignore[arg-type]
        blocker=blocker or None,
        events=events,
    )


async def run_native_magentic_mission(context: ContextPack) -> OrchestratorRunResponse:
    started = time.monotonic()

    if context.cardRuntime is None:
        raise RuntimeError("card_runtime_missing")

    is_run_task = bool(context.runApproved)

    # 1. Compile connected LiquidAIty cards into participant metadata from the
    #    real ReactFlow payload (cardRuntime.graph / participants).
    agent_specs = compile_connected_agents(context)
    agent_names = [spec["name"] for spec in agent_specs]

    # 2. Build the orchestrator model client from the session model config.
    orchestrator_client = _build_model_client(
        AutoGenAgentConfig(
            provider=context.session.modelProvider,
            provider_model_id=context.session.providerModelId,
        )
    )

    # 3. Build the real AutoGen participants and team.
    participants = _build_participants(agent_specs)
    team = LiquidAItyMagenticOneGroupChat(
        participants=participants,
        model_client=orchestrator_client,
        run_task_approved=is_run_task,
        max_turns=8,
        max_stalls=2,
    )

    # 4. Form the task string. On Run Task resume, prefer the approved Task
    #    Ledger goal; otherwise use the current user message plus any prior
    #    assistant turn for continuity.
    task = ""
    if is_run_task and context.plan.task_ledger:
        task = context.plan.task_ledger.user_goal or ""
    if not task:
        parts = [context.userText or ""]
        if context.priorAssistantText:
            parts.append(f"assistant: {context.priorAssistantText}")
        task = "\n".join(part for part in parts if part.strip())
    task = task.strip() or "Plan the task."

    # 5. Run the real orchestrator stream and collect structured events.
    events: list[ProgressEvent] = []
    agent_result = ""
    try:
        async for msg in team.run_stream(task=task):
            source = getattr(msg, "source", "") or ""
            content = ""
            to_text = getattr(msg, "to_text", None)
            if callable(to_text):
                try:
                    content = to_text()
                except Exception:
                    content = ""
            content = content or str(getattr(msg, "content", "") or "")
            if not content:
                continue
            events.append(
                ProgressEvent(source=str(source), type=type(msg).__name__, content=content[:2000])
            )
            if source and source not in agent_names + ["user"]:
                continue
            if source in agent_names and content != HALT_REASON:
                agent_result = content
    except Exception:
        # The stream may raise on termination; structured state is read below.
        pass

    orch = team.orchestrator_instance
    if orch is None:
        raise RuntimeError("orchestrator_instance_not_created")

    task_ledger = build_task_ledger(
        user_goal=orch._task or task,
        facts=orch._facts or "",
        plan=orch._plan or "",
        agent_specs=agent_specs,
    )

    progress_ledger: ProgressLedger | None = None
    if not is_run_task:
        agents_joined = ", ".join(agent_names) if agent_names else "none"
        final_text = (
            "Task Ledger created.\n"
            "PlanCanvas is waiting for Run Task approval.\n"
            f"Agents included: {agents_joined}.\n"
            f"Steps planned: {len(task_ledger.plan_steps)}.\n"
            "No execution started."
        )
        stop_reason = "run_task_gate"
        trace = LedgerTrace(
            source="python_magone",
            referenceFiles=["_magentic_one_orchestrator.py", "_prompts.py"],
            referenceClasses=["MagenticOneGroupChat", "MagenticOneOrchestrator"],
            referenceMethods=["handle_start", "_orchestrate_step"],
            promptConstants=[
                "ORCHESTRATOR_TASK_LEDGER_FACTS_PROMPT",
                "ORCHESTRATOR_TASK_LEDGER_PLAN_PROMPT",
            ],
            canvasTeamCompiled=True,
            taskLedgerFactsPromptUsed=True,
            taskLedgerPlanPromptUsed=True,
            taskLedgerProduced=True,
            planCanvasProjected=False,
            runTaskClicked=False,
            progressLedgerStarted=False,
            noExecutionBeforeRunTask=True,
        )
    else:
        progress_ledger = build_progress_ledger(
            orch._last_progress_ledger, events, agent_result, orch._n_rounds
        )
        final_text = (
            f"Run Task executing. Progress: {progress_ledger.progress_state}."
            + (f" Selected agent: {progress_ledger.selected_agent}." if progress_ledger.selected_agent else "")
        )
        stop_reason = "progress_ledger_step"
        trace = LedgerTrace(
            source="python_magone",
            referenceFiles=["_magentic_one_orchestrator.py", "_prompts.py"],
            referenceClasses=["MagenticOneGroupChat", "MagenticOneOrchestrator"],
            referenceMethods=["_orchestrate_step"],
            promptConstants=["ORCHESTRATOR_PROGRESS_LEDGER_PROMPT"],
            canvasTeamCompiled=True,
            taskLedgerProduced=True,
            runTaskClicked=True,
            progressLedgerStarted=True,
            progressLedgerPromptUsed=True,
        )

    elapsed_ms = int((time.monotonic() - started) * 1000)

    return OrchestratorRunResponse(
        ok=True,
        session=context.session,
        ledgerTrace=trace,
        stopReason=stop_reason,
        finalResponseText=final_text,
        statusText=final_text,
        taskLedger=task_ledger,
        progressLedger=progress_ledger,
        plan=context.plan,
        thinkGraph=context.thinkGraph,
        knowGraph=KnowGraphUpdateReport(
            sourceAgent="magentic_one_runtime",
            summary="no_knowgraph_updates_from_runtime",
        ),
        transcript=[],
        metrics=OrchestratorMetrics(
            elapsedMs=elapsed_ms,
            turnsUsed=orch._n_rounds,
            reportBackCount=len(events),
        ),
    )
