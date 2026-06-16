"""LiquidAIty Magentic-One Task Ledger adapter (AutoGen 0.7.5) — real call only.

Scope: the real AutoGen Task Ledger startup only. It builds the real
``MagenticOneGroupChat`` / ``MagenticOneOrchestrator`` from the connected
LiquidAIty cards and runs the real outer-loop Task Ledger inside
``handle_start``:

    handle_start
      -> assemble task from the user message
      -> build the team description
      -> model_client.create(ORCHESTRATOR_TASK_LEDGER_FACTS_PROMPT)  [real]
      -> store facts
      -> model_client.create(ORCHESTRATOR_TASK_LEDGER_PLAN_PROMPT)   [real]
      -> store plan
      -> build the full Task Ledger (ORCHESTRATOR_TASK_LEDGER_FULL_PROMPT)
      -> STOP (halt before _orchestrate_step / Progress Ledger)

It preserves the real model outputs verbatim as a ``TaskLedgerArtifact`` with
``ModelCallProof``. It authors no summaries, parses nothing into invented
schemas, and never starts the Progress Ledger. The Progress Ledger is referenced
identify-only.
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

from app.python_models.autogen_provider_env import AutoGenAgentConfig, _build_model_client
from app.python_models.graph_compiler import GraphCompileError, compile_card_graph
from app.python_models.orchestration_contracts import (
    AutoGenMessage,
    ContextPack,
    KnowGraphUpdateReport,
    LedgerTrace,
    ModelCallProof,
    OrchestratorMetrics,
    OrchestratorRunResponse,
    ProgressLedgerReference,
    TaskLedgerArtifact,
)

# Internal control signal that halts the real orchestrator right after the Task
# Ledger, before _orchestrate_step / the Progress Ledger. Never shown to the user.
TASK_LEDGER_STOP = "__liquidaity_task_ledger_complete__"


def _sanitize_agent_name(raw: str, fallback: str) -> str:
    name = re.sub(r"[^a-zA-Z0-9_]", "_", str(raw or "").strip())
    name = re.sub(r"_+", "_", name).strip("_")
    if not name:
        name = re.sub(r"[^a-zA-Z0-9_]", "_", fallback) or "Agent"
    if name[0].isdigit():
        name = f"agent_{name}"
    return name


def compile_connected_agents(context: ContextPack) -> list[dict[str, Any]]:
    """Compile connected LiquidAIty cards into real AutoGen participant metadata
    from the real ``cardRuntime.graph`` payload via the canonical compiler."""
    card = context.cardRuntime
    if card is None:
        raise GraphCompileError("card_runtime_missing")

    compiled = compile_card_graph(card)
    agents: list[dict[str, Any]] = []
    for participant_id in compiled.participant_ids:
        node = compiled.nodes[participant_id]
        agents.append(
            {
                "id": participant_id,
                "name": _sanitize_agent_name(node.title or participant_id, participant_id),
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


def _message_to_event(msg: Any) -> AutoGenMessage | None:
    source = str(getattr(msg, "source", "") or "")
    content = ""
    to_text = getattr(msg, "to_text", None)
    if callable(to_text):
        try:
            content = to_text()
        except Exception:
            content = ""
    content = content or str(getattr(msg, "content", "") or "")
    if not content or content == TASK_LEDGER_STOP:
        return None
    return AutoGenMessage(source=source, type=type(msg).__name__, content=content)


class LiquidAItyTaskLedgerOrchestrator(MagenticOneOrchestrator):
    """Real Magentic-One orchestrator that stops after the Task Ledger.

    ``handle_start`` (inherited, unmodified) performs the real facts + plan model
    calls and assembles the full Task Ledger. This override halts the very first
    ``_orchestrate_step`` so the Progress Ledger / inner loop never starts.
    """

    async def _orchestrate_step(self, cancellation_token: CancellationToken) -> None:
        # _n_rounds is still 0 the first time this is reached (handle_start ->
        # _reenter_outer_loop -> _orchestrate_step), i.e. after the Task Ledger is
        # built and before any Progress Ledger work.
        await self._signal_termination(StopMessage(content=TASK_LEDGER_STOP, source=self._name))


class LiquidAItyTaskLedgerGroupChat(MagenticOneGroupChat):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.orchestrator_instance: LiquidAItyTaskLedgerOrchestrator | None = None

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
        def factory() -> LiquidAItyTaskLedgerOrchestrator:
            self.orchestrator_instance = LiquidAItyTaskLedgerOrchestrator(
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
            )
            return self.orchestrator_instance

        return factory


def _wrap_with_proof(client: Any, provider: str, model: str, proofs: list[ModelCallProof]) -> None:
    """Wrap model_client.create to capture real model-call proof (no fake IDs)."""
    original_create = client.create
    client_class = type(client).__name__
    labels = ["facts", "plan"]

    async def proving_create(*a: Any, **kw: Any) -> Any:
        started = time.time()
        res = await original_create(*a, **kw)
        finished = time.time()
        usage_obj = getattr(res, "usage", None)
        usage: dict[str, Any] | None = None
        if usage_obj is not None:
            if hasattr(usage_obj, "model_dump"):
                usage = usage_obj.model_dump()
            elif isinstance(usage_obj, dict):
                usage = usage_obj
            else:
                usage = {
                    "prompt_tokens": getattr(usage_obj, "prompt_tokens", None),
                    "completion_tokens": getattr(usage_obj, "completion_tokens", None),
                }
        index = len(proofs)
        proofs.append(
            ModelCallProof(
                label=labels[index] if index < len(labels) else f"extra_{index}",
                provider=provider,
                model=model,
                clientClass=client_class,
                startedAt=started,
                finishedAt=finished,
                latencyMs=int((finished - started) * 1000),
                responseType=type(res).__name__,
                excerpt=str(getattr(res, "content", "") or "")[:300],
                responseId=getattr(res, "id", None),
                usage=usage,
            )
        )
        return res

    client.create = proving_create  # type: ignore[method-assign]


def _progress_ledger_reference() -> ProgressLedgerReference:
    # Identify-only. The Progress Ledger is NOT started, wired, rendered, or
    # implemented in this scope. See ORCHESTRATOR_PROGRESS_LEDGER_PROMPT in
    # _prompts.py and _orchestrate_step / _reenter_outer_loop in
    # _magentic_one_orchestrator.py.
    return ProgressLedgerReference()


async def run_native_magentic_mission(context: ContextPack) -> OrchestratorRunResponse:
    if context.cardRuntime is None:
        raise RuntimeError("card_runtime_missing")

    provider = context.session.modelProvider
    model = context.session.providerModelId

    # 1. Compile connected cards into real participants (needed for the real
    #    team description the Task Ledger plan prompt uses).
    agent_specs = compile_connected_agents(context)

    # 2. Real orchestrator client, wrapped to capture model-call proof.
    proofs: list[ModelCallProof] = []
    orchestrator_client = _build_model_client(
        AutoGenAgentConfig(provider=provider, provider_model_id=model)
    )
    _wrap_with_proof(orchestrator_client, provider, model, proofs)

    participants = _build_participants(agent_specs)
    team = LiquidAItyTaskLedgerGroupChat(
        participants=participants,
        model_client=orchestrator_client,
        max_turns=1,
        max_stalls=1,
    )

    # 3. The task is the real user message only (no app-authored framing).
    task = (context.userText or "").strip()
    if not task:
        return OrchestratorRunResponse(
            ok=False,
            session=context.session,
            finalResponseText="",
            error="empty_user_message",
            progressLedgerReference=_progress_ledger_reference(),
            plan=context.plan,
            thinkGraph=context.thinkGraph,
            knowGraph=KnowGraphUpdateReport(sourceAgent="magentic_one_runtime", summary="no_run"),
        )

    # 4. Run the real Task Ledger startup (halts before the Progress Ledger).
    events: list[AutoGenMessage] = []
    async for msg in team.run_stream(task=task):
        event = _message_to_event(msg)
        if event is not None:
            events.append(event)

    orch = team.orchestrator_instance
    if orch is None:
        raise RuntimeError("orchestrator_instance_not_created")

    # 5. Preserve the real Task Ledger output verbatim. taskLedgerResponse is the
    #    full Task Ledger AutoGen assembles via ORCHESTRATOR_TASK_LEDGER_FULL_PROMPT.
    facts = orch._facts or ""
    plan = orch._plan or ""
    has_ledger = bool(facts and plan)
    task_ledger_full = (
        orch._get_task_ledger_full_prompt(orch._task, orch._team_description, facts, plan)
        if has_ledger
        else ""
    )
    artifact = (
        TaskLedgerArtifact(
            factsResponse=facts,
            planResponse=plan,
            taskLedgerResponse=task_ledger_full,
            teamDescription=orch._team_description or "",
            modelCallProof=proofs,
        )
        if has_ledger
        else None
    )

    trace = LedgerTrace(
        source="python_magone",
        referenceFiles=["_magentic_one_orchestrator.py", "_prompts.py"],
        referenceClasses=["MagenticOneGroupChat", "MagenticOneOrchestrator"],
        referenceMethods=["handle_start", "_get_task_ledger_facts_prompt", "_get_task_ledger_plan_prompt"],
        promptConstants=[
            "ORCHESTRATOR_TASK_LEDGER_FACTS_PROMPT",
            "ORCHESTRATOR_TASK_LEDGER_PLAN_PROMPT",
            "ORCHESTRATOR_TASK_LEDGER_FULL_PROMPT",
        ],
        canvasTeamCompiled=True,
        taskLedgerFactsPromptUsed=has_ledger,
        taskLedgerPlanPromptUsed=has_ledger,
        taskLedgerFullPromptUsed=has_ledger,
        taskLedgerProduced=has_ledger,
        noExecutionBeforeRunTask=True,
    )

    return OrchestratorRunResponse(
        ok=has_ledger,
        session=context.session,
        ledgerTrace=trace,
        stopReason="task_ledger_complete",
        finalResponseText=task_ledger_full,
        autogenMessages=events,
        autogenEvents=events,
        taskLedgerArtifact=artifact,
        progressLedgerReference=_progress_ledger_reference(),
        error=None if has_ledger else "no_task_ledger_output",
        plan=context.plan,
        thinkGraph=context.thinkGraph,
        knowGraph=KnowGraphUpdateReport(
            sourceAgent="magentic_one_runtime",
            summary="no_knowgraph_updates_from_runtime",
        ),
        transcript=[],
        metrics=OrchestratorMetrics(
            turnsUsed=0,
            reportBackCount=len(proofs),
        ),
    )
