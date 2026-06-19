"""Real AutoGen/Magentic-One adapter.

This module is a thin bridge from the app ContextPack into real
``MagenticOneGroupChat`` execution. It does not recreate Magentic-One prompts
or task-ledger internals in app code.
"""

from __future__ import annotations

import json
import re
from typing import Any

from autogen_agentchat.agents import AssistantAgent
from autogen_agentchat.teams import MagenticOneGroupChat
from autogen_core.models import SystemMessage, UserMessage

from app.python_models.autogen_provider_env import AutoGenAgentConfig, _build_model_client
from app.python_models.orchestration_contracts import (
    ContextPack,
    KnowGraphUpdateReport,
    LedgerTrace,
    OrchestratorMetrics,
    OrchestratorRunResponse,
    PlanFlowTaskObject,
    TaskLedgerArtifact,
)


class _CapturingMagenticOneGroupChat(MagenticOneGroupChat):
    """Real MagenticOneGroupChat that records its real MagenticOneOrchestrator
    instance so the genuine Task Ledger state (``_facts`` / ``_plan`` / full
    ledger, produced by the real outer-loop model calls in ``handle_start``) can
    be read after the run. It does NOT change orchestration behavior and does NOT
    recreate any Magentic-One prompt — it only keeps a handle to the real object.
    """

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.orchestrator_instance: Any | None = None

    def _create_group_chat_manager_factory(self, *args: Any, **kwargs: Any):
        base_factory = super()._create_group_chat_manager_factory(*args, **kwargs)

        def factory() -> Any:
            instance = base_factory()
            self.orchestrator_instance = instance
            return instance

        return factory


def _real_task_ledger_artifact(orchestrator: Any) -> TaskLedgerArtifact | None:
    """Build the Task Ledger artifact from the REAL orchestrator state only.

    Source: ``MagenticOneOrchestrator._facts`` / ``._plan`` (real facts/plan model
    call outputs) + ``_get_task_ledger_full_prompt`` (the real full ledger AutoGen
    assembles). Never derived from finalResponseText or chat messages. Returns None
    if the orchestrator did not produce a Task Ledger (no fabrication).
    """
    if orchestrator is None:
        return None
    facts = _as_text(getattr(orchestrator, "_facts", ""))
    plan = _as_text(getattr(orchestrator, "_plan", ""))
    if not facts and not plan:
        return None
    team_description = _as_text(getattr(orchestrator, "_team_description", ""))
    full = ""
    builder = getattr(orchestrator, "_get_task_ledger_full_prompt", None)
    if callable(builder):
        try:
            full = _as_text(
                builder(_as_text(getattr(orchestrator, "_task", "")), team_description, facts, plan)
            )
        except Exception:
            full = ""
    return TaskLedgerArtifact(
        factsResponse=facts,
        planResponse=plan,
        taskLedgerResponse=full,
        teamDescription=team_description,
        modelCallProof=[],
    )


def _available_agents_block(context: ContextPack) -> str:
    """Real available agents + capabilities, from the active card's participants.

    This is the team the model may route tasks to (suggestedAgents/suggestedTools).
    Honest 'none listed' when the card carries no participants — never invented.
    """
    card = context.cardRuntime
    parts = list(getattr(card, "participants", []) or []) if card else []
    if not parts:
        return "Available agents and capabilities: none listed."
    lines: list[str] = []
    for p in parts:
        title = _as_text(getattr(p, "title", "")) or _as_text(getattr(p, "cardId", ""))
        if not title:
            continue
        role = _as_text(getattr(p, "role", ""))
        tools = [_as_text(t) for t in (getattr(p, "tools", []) or []) if _as_text(t)]
        desc = title
        if role:
            desc += f" (role: {role})"
        if tools:
            desc += f" — tools: {', '.join(tools)}"
        lines.append(f"- {desc}")
    if not lines:
        return "Available agents and capabilities: none listed."
    return "Available agents and capabilities:\n" + "\n".join(lines)


def _think_graph_summary(context: ContextPack) -> str:
    tg = context.thinkGraph
    ents = [_as_text(e) for e in (getattr(tg, "priorityEntities", []) or []) if _as_text(e)]
    rels = [_as_text(r) for r in (getattr(tg, "priorityRelationships", []) or []) if _as_text(r)]
    if not ents and not rels:
        return "not available"
    out: list[str] = []
    if ents:
        out.append(f"priority entities: {', '.join(ents[:12])}")
    if rels:
        out.append(f"priority relationships: {', '.join(rels[:12])}")
    return "; ".join(out)


def _know_graph_summary(context: ContextPack) -> str:
    kg = context.knowGraph
    gaps = getattr(kg, "gaps", []) or []
    facts = getattr(kg, "graphFacts", []) or []
    docs = int(getattr(kg, "researchDocumentCount", 0) or 0)
    if not gaps and not facts and not docs:
        return "not available"
    return f"gaps: {len(gaps)}, facts: {len(facts)}, research docs: {docs}"


def _code_graph_summary(context: ContextPack) -> str:
    wctx = context.workspaceObjectContext
    if not wctx:
        return "not available"
    repo = _as_text(getattr(wctx, "repoPath", ""))
    src = _as_text(getattr(wctx, "graphSource", ""))
    bits = [b for b in (f"repo: {repo}" if repo else "", f"graph source: {src}" if src else "") if b]
    return "; ".join(bits) if bits else "not available"


async def _planflow_task_objects(
    client: Any, context: ContextPack, artifact: TaskLedgerArtifact
) -> list[PlanFlowTaskObject]:
    """Model-produced PlanFlow task objects via the Mag One card output contract.

    Makes ONE explicit real model call AFTER the Magentic-One run, grounded in the
    REAL Task Ledger (task + team + facts + plan). The MODEL emits the structured
    JSON task objects; this code never parses the plan prose, finalResponseText, or
    autogenMessages into tasks. Fails closed to [] when there is no card contract or
    the model returned no valid JSON (no fabrication — no task nodes then render).
    """
    card = context.cardRuntime
    contract = _as_text(getattr(card, "taskLedgerOutputContract", "")) if card else ""
    if not contract:
        return []
    card_prompt_chain = _as_text(getattr(card, "prompt", "")) or _as_text(context.systemPrompt)
    ledger_context = (
        f"User task:\n{_as_text(context.userText)}\n\n"
        f"Active card prompt-chain:\n{card_prompt_chain or 'not available'}\n\n"
        f"{_available_agents_block(context)}\n\n"
        f"Team:\n{artifact.teamDescription}\n\n"
        f"ThinkGraph context: {_think_graph_summary(context)}\n"
        f"KnowGraph context: {_know_graph_summary(context)}\n"
        f"CodeGraph context: {_code_graph_summary(context)}\n\n"
        f"Facts:\n{artifact.factsResponse}\n\n"
        f"Plan:\n{artifact.planResponse}\n\n"
        f"Task Ledger:\n{artifact.taskLedgerResponse}"
    ).strip()
    try:
        result = await client.create(
            [
                SystemMessage(content=contract),
                UserMessage(content=ledger_context, source="user"),
            ],
            json_output=True,
        )
    except Exception as err:
        print("[magentic] planflow task contract call failed:", repr(err))
        return []

    raw_content = getattr(result, "content", None)
    text = _as_text(raw_content) if isinstance(raw_content, str) else ""
    if not text:
        return []
    try:
        data = json.loads(text)
    except Exception:
        # The model did not return a parseable JSON object. Fail closed — never
        # regex-extract or salvage prose into tasks.
        return []
    raw_list = data.get("planFlowTaskObjects") if isinstance(data, dict) else None
    if not isinstance(raw_list, list):
        return []
    tasks: list[PlanFlowTaskObject] = []
    for item in raw_list:
        if not isinstance(item, dict):
            continue
        try:
            tasks.append(PlanFlowTaskObject(**item))
        except Exception:
            # Drop a single malformed object rather than fabricate fields.
            continue
    return tasks


def _as_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, list):
        parts: list[str] = []
        for item in value:
            text = _as_text(item)
            if text:
                parts.append(text)
        return "\n".join(parts).strip()
    return str(value).strip()


def connected_agent_names(context: ContextPack) -> list[str]:
    card = context.cardRuntime
    if card is None:
        return []
    names: list[str] = []
    for participant in card.participants or []:
        title = _as_text(getattr(participant, "title", ""))
        if title:
            names.append(title)
    return names


def _private_prompt_by_card_id(context: ContextPack) -> dict[str, str]:
    card = context.cardRuntime
    if card is None:
        return {}
    out: dict[str, str] = {}
    for participant in card.privateParticipants or []:
        card_id = _as_text(getattr(participant, "cardId", ""))
        prompt = _as_text(getattr(participant, "prompt", ""))
        if card_id and prompt:
            out[card_id] = prompt
    return out


def _safe_agent_name(raw: str, index: int, used: set[str]) -> str:
    """AutoGen requires AssistantAgent ``name`` to be a valid Python identifier.

    Turns a display title like "ThinkGraph Agent" into "ThinkGraph_Agent" and
    guarantees uniqueness. The original title is preserved separately for display.
    """
    name = re.sub(r"[^0-9A-Za-z_]", "_", raw or "")
    name = re.sub(r"_+", "_", name).strip("_")
    if not name:
        name = f"Agent_{index + 1}"
    if not (name[0].isalpha() or name[0] == "_"):
        name = f"Agent_{name}"
    base = name
    suffix = 2
    while name in used:
        name = f"{base}_{suffix}"
        suffix += 1
    used.add(name)
    return name


def _build_participants(context: ContextPack, model_client: Any) -> list[AssistantAgent]:
    card = context.cardRuntime
    if card is None:
        return []
    private_prompts = _private_prompt_by_card_id(context)
    participants: list[AssistantAgent] = []
    used_names: set[str] = set()
    for i, participant in enumerate(card.participants or []):
        card_id = _as_text(getattr(participant, "cardId", ""))
        title = _as_text(getattr(participant, "title", "")) or card_id
        name = _safe_agent_name(title or f"Agent {i + 1}", i, used_names)
        role = _as_text(getattr(participant, "role", "")) or _as_text(
            getattr(participant, "runtimeBinding", "")
        )
        description = role or _as_text(getattr(participant, "runtimeType", "")) or "assistant"
        system_prompt = _as_text(getattr(participant, "prompt", "")) or private_prompts.get(card_id, "")

        kwargs: dict[str, Any] = {
            "name": name,
            "description": description,
            "model_client": model_client,
        }
        if system_prompt:
            kwargs["system_message"] = system_prompt
        participants.append(AssistantAgent(**kwargs))

    if participants:
        return participants

    return [AssistantAgent(name="Assist", model_client=model_client)]


def _read_max_turns(context: ContextPack) -> int:
    runtime_options = getattr(context.cardRuntime, "runtimeOptions", None) or {}
    raw = runtime_options.get("maxTurns", 12) if isinstance(runtime_options, dict) else 12
    try:
        value = int(raw)
    except Exception:
        value = 12
    return max(1, min(value, 64))


async def run_native_magentic_mission(context: ContextPack) -> OrchestratorRunResponse:
    if context.cardRuntime is None:
        raise RuntimeError("card_runtime_missing")

    task = _as_text(context.userText)
    if not task:
        return OrchestratorRunResponse(
            ok=False,
            session=context.session,
            finalResponseText="",
            error="empty_user_message",
            plan=context.plan,
            thinkGraph=context.thinkGraph,
            knowGraph=KnowGraphUpdateReport(sourceAgent="magentic_one", summary="no_run"),
        )

    client = _build_model_client(
        AutoGenAgentConfig(
            provider=context.session.modelProvider,
            provider_model_id=context.session.providerModelId,
        )
    )

    try:
        participants = _build_participants(context, client)
        team = _CapturingMagenticOneGroupChat(
            participants=participants,
            model_client=client,
            max_turns=_read_max_turns(context),
        )

        autogen_messages: list[dict[str, str]] = []
        autogen_events: list[dict[str, str]] = []
        stop_reason: str | None = None
        final_response_text = ""

        async for emitted in team.run_stream(task=task):
            # TaskResult terminal item
            if hasattr(emitted, "messages") and isinstance(getattr(emitted, "messages", None), list):
                stop_reason = _as_text(getattr(emitted, "stop_reason", None)) or None
                for msg in reversed(getattr(emitted, "messages", []) or []):
                    content = _as_text(getattr(msg, "content", ""))
                    if not content and hasattr(msg, "to_text"):
                        content = _as_text(msg.to_text())
                    if content:
                        final_response_text = content
                        break
                continue

            content = _as_text(getattr(emitted, "content", ""))
            if not content and hasattr(emitted, "to_text"):
                content = _as_text(emitted.to_text())
            if not content:
                continue

            source = _as_text(getattr(emitted, "source", "")) or "unknown"
            payload = {
                "source": source,
                "type": emitted.__class__.__name__,
                "content": content,
            }
            if payload["type"].endswith("Event"):
                autogen_events.append(payload)
            else:
                autogen_messages.append(payload)

        if not final_response_text and autogen_messages:
            final_response_text = _as_text(autogen_messages[-1].get("content"))

        # Real Task Ledger artifact, read from the captured orchestrator's actual
        # state — NOT from finalResponseText / chat text. None if the orchestrator
        # produced no Task Ledger (no fabrication for PlanFlow).
        task_ledger_artifact = _real_task_ledger_artifact(getattr(team, "orchestrator_instance", None))

        # Mag One card prompt-chain step 4: ask the model (one explicit real call)
        # for PlanFlow-ready structured task objects, grounded in the real Task
        # Ledger above. Model-produced — never parsed from prose. Empty if the card
        # carries no output contract or the model returned no valid JSON.
        if task_ledger_artifact is not None:
            task_ledger_artifact.planFlowTaskObjects = await _planflow_task_objects(
                client, context, task_ledger_artifact
            )

        # Safe metadata only (no full prompt / no raw ledger text) — proves the run
        # is real AutoGen and whether a Task Ledger artifact was captured.
        print(
            "[magentic] run_stream meta:",
            {
                "messages": len(autogen_messages),
                "events": len(autogen_events),
                "message_types": sorted({m["type"] for m in autogen_messages}),
                "sources": sorted({m["source"] for m in autogen_messages}),
                "stop_reason": stop_reason,
                "has_task_ledger_artifact": task_ledger_artifact is not None,
                "planflow_task_objects": (
                    len(task_ledger_artifact.planFlowTaskObjects)
                    if task_ledger_artifact is not None
                    else 0
                ),
            },
        )

        ok = bool(final_response_text)
        return OrchestratorRunResponse(
            ok=ok,
            session=context.session,
            ledgerTrace=LedgerTrace(
                source="python_magone",
                referenceFiles=[
                    "autogen-main/python/packages/autogen-agentchat/src/autogen_agentchat/teams/_group_chat/_magentic_one/_magentic_one_group_chat.py",
                    "autogen-main/python/packages/autogen-agentchat/src/autogen_agentchat/teams/_group_chat/_magentic_one/_magentic_one_orchestrator.py",
                ],
                referenceClasses=["MagenticOneGroupChat", "MagenticOneOrchestrator"],
                referenceMethods=["handle_start", "_reenter_outer_loop", "_orchestrate_step", "run_stream"],
                canvasTeamCompiled=len(participants) > 0,
                runTaskClicked=bool(context.runApproved),
            ),
            stopReason=stop_reason,
            finalResponseText=final_response_text,
            autogenMessages=autogen_messages,
            autogenEvents=autogen_events,
            taskLedgerArtifact=task_ledger_artifact,
            progressLedgerReference=None,
            error=None if ok else "no_model_output",
            plan=context.plan,
            thinkGraph=context.thinkGraph,
            knowGraph=KnowGraphUpdateReport(
                sourceAgent="magentic_one",
                summary="run_complete" if ok else "run_empty",
            ),
            transcript=[],
            metrics=OrchestratorMetrics(
                turnsUsed=len(autogen_messages),
                reportBackCount=len(autogen_messages),
            ),
        )
    finally:
        close = getattr(client, "close", None)
        if callable(close):
            try:
                await close()
            except Exception:
                pass

