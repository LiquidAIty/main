"""Real AutoGen/Magentic-One adapter.

This module is a thin bridge from the app ContextPack into real
``MagenticOneGroupChat`` execution. It does not recreate Magentic-One prompts
or task-ledger internals in app code.

It also hosts ``run_configured_card``: the smallest single-card runtime
primitive. It reuses the exact same participant construction
(``_build_participants``: same prompt/model/tool resolution, same no-fallback
tool registry) to run ONE configured canvas card as a lone AssistantAgent —
no team, no orchestrator, no Task Ledger, no fallback.
"""

from __future__ import annotations

import asyncio
import json
import re
import time
from typing import Any

from autogen_agentchat.agents import AssistantAgent
from autogen_agentchat.teams import MagenticOneGroupChat

from app.python_models import job_folder as jf
from app.python_models import runtime_profile_executor as rpe
from app.python_models.dev_spans import build_participant_span, emit_participant_span
from app.python_models.autogen_provider_env import AutoGenAgentConfig, _build_model_client
from app.python_models.tool_registry import (
    DEFAULT_TOOL_REGISTRY,
    JOB_RETURN_ROOT,
    THINKGRAPH_PATCH_EVENTS,
    THINKGRAPH_RUN_AUTHORITY,
    build_local_coder_tool,
    build_return_writer_tool,
)
from app.python_models.orchestration_contracts import (
    ContextPack,
    KnowGraphUpdateReport,
    LedgerTrace,
    OrchestratorMetrics,
    OrchestratorRunResponse,
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

    Turns a display title like "Search Agent" into "Search_Agent" and
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


def _participant_identity_by_agent_name(context: ContextPack) -> dict[str, dict[str, str]]:
    """AutoGen agent name → {cardId, provider, model} for dev spans.

    Replays the exact _build_participants naming order/sanitizer so the map
    matches the real team; the orchestrator itself is mapped under
    'MagenticOneOrchestrator' to the Mag One card + session model.
    """
    card = context.cardRuntime
    identities: dict[str, dict[str, str]] = {
        "MagenticOneOrchestrator": {
            "cardId": _as_text(getattr(card, "cardId", "")) if card else "",
            "provider": _as_text(context.session.modelProvider),
            "model": _as_text(context.session.providerModelId),
        }
    }
    if card is None:
        return identities
    used_names: set[str] = set()
    for i, participant in enumerate(card.participants or []):
        card_id = _as_text(getattr(participant, "cardId", ""))
        title = _as_text(getattr(participant, "title", "")) or card_id
        name = _safe_agent_name(title or f"Agent {i + 1}", i, used_names)
        identities[name] = {
            "cardId": card_id,
            "provider": _as_text(getattr(participant, "provider", "")),
            "model": _as_text(getattr(participant, "providerModelId", "")),
        }
    return identities


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
        description = (
            _as_text(getattr(participant, "runtimeBinding", ""))
            or _as_text(getattr(participant, "runtimeType", ""))
            or "assistant"
        )
        system_prompt = _as_text(getattr(participant, "prompt", "")) or private_prompts.get(card_id, "")

        kwargs: dict[str, Any] = {
            "name": name,
            "description": description,
            "model_client": model_client,
        }
        if system_prompt:
            kwargs["system_message"] = system_prompt

        # Attach exactly the card-selected tools as real AutoGen FunctionTools via
        # the existing ToolRegistry. Resolving does NOT call the tool — Mag One
        # decides whether to invoke it. Empty selection -> no tools (unchanged
        # behavior). Unknown/disabled IDs fail loudly through resolve_selected
        # rather than being silently dropped.
        selected_tools = [_as_text(tool) for tool in (getattr(participant, "tools", []) or []) if _as_text(tool)]
        tools = DEFAULT_TOOL_REGISTRY.resolve_selected(selected_tools) if selected_tools else []
        if "run_local_coder" in selected_tools:
            tools = [
                build_local_coder_tool(
                    _as_text(getattr(participant, "provider", "")),
                    _as_text(getattr(participant, "providerModelId", "")),
                )
                if getattr(tool, "name", "") == "run_local_coder"
                else tool
                for tool in tools
            ]
        # Any run with an assigned result folder (a Coder handoff OR a standalone
        # single-agent run) additionally gets a return writer scoped to THIS agent's
        # own returns/<run-id>/<card-id>/ subdir (card id from trusted participant
        # context — no agent-name branch, no shared folder).
        if context.jobHandoff is not None or context.resultFolder is not None:
            tools = [*tools, build_return_writer_tool(card_id or name)]
        if tools:
            kwargs["tools"] = tools
            # Single-card runs need a real tool loop (e.g. read a scope, then write)
            # inside one turn; default max_tool_iterations=1 would end the turn at
            # the first tool summary. Mag One team behavior is unchanged.
            if context.session.orchestrator == "assistant_agent":
                kwargs["max_tool_iterations"] = 5

        participants.append(AssistantAgent(**kwargs))

    if participants:
        return participants

    return [AssistantAgent(name="Assist", model_client=model_client)]


def _validate_single_card_context(context: ContextPack) -> str | None:
    """Structural guard for the single-card runtime. Returns an honest error code or None.

    Pure (no model/client construction) so it is directly unit-testable. It never
    decides meaning — only shape: exactly one configured participant, the
    single-card runtime type, and a non-empty task.
    """
    card = context.cardRuntime
    if card is None:
        return "card_runtime_missing"
    if card.runtimeType != "assistant_agent":
        return f"single_card_runtime_invalid: runtimeType={card.runtimeType}"
    if context.session.orchestrator != "assistant_agent":
        return f"single_card_orchestrator_invalid: orchestrator={context.session.orchestrator}"
    count = len(card.participants or [])
    if count != 1:
        return f"single_card_participant_count_invalid: {count}"
    if not _as_text(context.userText):
        return "empty_user_message"
    return None


def _final_text_from_result(result: Any) -> str:
    for msg in reversed(getattr(result, "messages", []) or []):
        content = _as_text(getattr(msg, "content", ""))
        if not content and hasattr(msg, "to_text"):
            content = _as_text(msg.to_text())
        if content:
            return content
    return ""


async def run_configured_card(context: ContextPack) -> OrchestratorRunResponse:
    """Run ONE configured canvas card as a single AssistantAgent.

    Reuses ``_build_participants`` unchanged (same prompt resolution, same model
    client, same tool registry with loud unknown/disabled failures). Guard or
    runtime failures return an honest error — never a fallback model, another
    card, or a plain completion. No Task Ledger is read or produced.

    A card whose persisted runtime binding has an assigned database profile
    additionally executes that profile's declared pre-hooks, receives its compact
    assigned skill/data packet, and must satisfy the profile's declared terminal
    contract — with the profile's single bounded repair inside the same run. The
    profile and hook chain come from saved assignment only; Python hosts the
    execution and owns no card-specific policy here.
    """
    guard = _validate_single_card_context(context)
    if guard:
        return OrchestratorRunResponse(
            ok=False,
            session=context.session,
            finalResponseText="",
            error=guard,
            plan=context.plan,
            thinkGraph=context.thinkGraph,
            knowGraph=KnowGraphUpdateReport(sourceAgent="single_card", summary="no_run"),
        )

    def _fail(error: str, summary: str) -> OrchestratorRunResponse:
        return OrchestratorRunResponse(
            ok=False,
            session=context.session,
            finalResponseText="",
            error=error,
            plan=context.plan,
            thinkGraph=context.thinkGraph,
            knowGraph=KnowGraphUpdateReport(sourceAgent="single_card", summary=summary),
        )

    # Standalone single-agent run: assign returns/<run-id>/ (the run's own identity),
    # WITHOUT changing its task or turning it into a Mag One run. A bad/invalid
    # result folder fails honestly rather than silently writing somewhere else.
    result_folder: jf.JobFolder | None = None
    if context.resultFolder is not None:
        try:
            result_folder = jf.resolve_job_folder(
                context.resultFolder.workspaceRoot, context.resultFolder.runId
            )
            jf.ensure_returns_dir(result_folder)
        except (ValueError, OSError) as err:
            return _fail(f"result_folder_unresolved: {err}", "result_folder_unresolved")

    def _returns_fields() -> dict:
        if result_folder is None:
            return {}
        files = jf.list_return_files(result_folder)
        return {
            "returnsDir": f"{result_folder.returns_rel}/",
            "returnedFiles": files,
            "returnStatus": "return_files_created" if files else "no_return_files_created",
        }

    runtime_scope = getattr(context.cardRuntime, "runtimeScope", None)
    runtime_options = getattr(context.cardRuntime, "runtimeOptions", None) or {}
    single = context.cardRuntime.participants[0]
    selected_tools = [_as_text(t) for t in (single.tools or []) if _as_text(t)]

    # Deterministic assigned-profile resolution from the card's PERSISTED runtime
    # binding (never model judgment, never runtime-scope sniffing). No assigned
    # profile → plain single-card run (the card's declared state, not a fallback);
    # ambiguity, unknown hooks/contracts, or hook failure → honest error, no run.
    plan: rpe.ProfiledRunPlan | None = None
    try:
        plan = await asyncio.to_thread(
            lambda: rpe.prepare(
                runtime_binding=getattr(single, "runtimeBinding", None),
                project_id=context.session.projectId,
                deck_id=_as_text(
                    (runtime_options.get("deckId") if isinstance(runtime_options, dict) else "")
                    or (runtime_scope.get("deckId") if isinstance(runtime_scope, dict) else "")
                ),
                card_id=single.cardId,
                correlation_id=context.session.turnId,
                selected_tools=selected_tools,
                runtime_scope=runtime_scope if isinstance(runtime_scope, dict) else None,
            )
        )
    except Exception as err:
        return _fail(f"runtime_profile_prehook_failed: {err}", "profile_prehook_failed")

    client = _build_model_client(
        AutoGenAgentConfig(
            provider=context.session.modelProvider,
            provider_model_id=context.session.providerModelId,
        )
    )

    # Trusted run authority for scoped card tools (e.g. ThinkGraph): server-authored
    # runtimeScope only — the model never supplies authority. Set for the duration of
    # this run and always reset, so no authority leaks across runs. The patch-event
    # recorder is armed for profiled runs so an assigned terminal contract can read
    # what the authorized tools actually did.
    authority_token = None
    patch_events_token = None
    # Arm the run-scoped return writer for this single-card run's assigned folder.
    return_root_token = JOB_RETURN_ROOT.set(result_folder) if result_folder is not None else None
    if isinstance(runtime_scope, dict) and runtime_scope.get("kind") == "thinkgraph_card_run":
        authority_token = THINKGRAPH_RUN_AUTHORITY.set(
            {str(k): str(v) for k, v in runtime_scope.items()}
        )
    if plan is not None:
        patch_events_token = THINKGRAPH_PATCH_EVENTS.set([])

    started = time.monotonic()
    try:
        participants = _build_participants(context, client)
        # The guard guarantees exactly one real configured participant, so the
        # default-"Assist" branch of _build_participants is unreachable here.
        agent = participants[0]
        task = _as_text(context.userText)
        if plan is not None:
            task = f"{task}\n\n{plan.packet}"
        result = await agent.run(task=task)

        final_text = _final_text_from_result(result)

        if plan is not None and plan.profile.terminal_contract:
            contract = rpe.terminal_contract_for(plan)
            verdict = contract.evaluate(final_text)
            repair_used = False
            if verdict.outcome == "invalid" and contract.repair_instruction:
                # Exactly ONE bounded repair inside the same authorized run (declared
                # by the assigned contract): same agent, same model, same tools, same
                # scope, same prompt policy.
                repair_used = True
                repair_result = await agent.run(task=contract.repair_instruction)
                final_text = _final_text_from_result(repair_result)
                verdict = contract.evaluate(final_text)

            detail = json.dumps(
                {
                    "reason": verdict.reason,
                    "repairUsed": repair_used,
                    "storedRefs": verdict.stored_refs,
                }
            )
            try:
                await asyncio.to_thread(
                    lambda: rpe.finalize(plan, outcome=verdict.record, detail=detail)
                )
            except Exception as err:
                return _fail(f"runtime_post_hook_failed: {err}", "post_hook_failed")

            if verdict.outcome == "invalid":
                return _fail(contract.invalid_error, "invalid_terminal_result")
            if verdict.record == "patched" and not final_text:
                final_text = json.dumps({"outcome": "patch", "storedRefs": verdict.stored_refs})
        elif plan is not None:
            # No terminal contract assigned: there is no output grammar to satisfy
            # and no repair loop. The model ran once; whatever authorized tool
            # calls it actually made during this run (if any) are the honest
            # trace — not a pass/fail decision gate.
            tool_events = THINKGRAPH_PATCH_EVENTS.get() or []
            detail = json.dumps({"toolCalls": tool_events})
            try:
                await asyncio.to_thread(
                    lambda: rpe.finalize(plan, outcome="completed", detail=detail)
                )
            except Exception as err:
                return _fail(f"runtime_post_hook_failed: {err}", "post_hook_failed")

        elapsed_ms = int((time.monotonic() - started) * 1000)
        single = context.cardRuntime.participants[0]
        tools_attached = [_as_text(t) for t in (single.tools or []) if _as_text(t)]
        # Mechanical, never inferred from model text: how many times the run's
        # authorized tools actually recorded a call (0 when the model never
        # called one). Only meaningful for profiled runs; omitted otherwise.
        tool_call_suffix = (
            f" toolCallCount={len(THINKGRAPH_PATCH_EVENTS.get() or [])}" if plan is not None else ""
        )
        run_info = (
            f"single_card cardId={single.cardId} runtime=assistant_agent "
            f"tools={','.join(tools_attached) or 'none'} elapsedMs={elapsed_ms} "
            f"turnId={context.session.turnId}{tool_call_suffix}"
        )

        if not final_text:
            return OrchestratorRunResponse(
                ok=False,
                session=context.session,
                finalResponseText="",
                error="single_card_empty_response",
                plan=context.plan,
                thinkGraph=context.thinkGraph,
                knowGraph=KnowGraphUpdateReport(sourceAgent="single_card", summary="empty_response"),
                transcript=[run_info],
                **_returns_fields(),
            )

        return OrchestratorRunResponse(
            ok=True,
            session=context.session,
            finalResponseText=final_text,
            plan=context.plan,
            thinkGraph=context.thinkGraph,
            knowGraph=KnowGraphUpdateReport(sourceAgent="single_card", summary="single_card_run"),
            transcript=[run_info],
            **_returns_fields(),
        )
    except Exception as err:  # honest runtime failure — no retry, no fallback
        return OrchestratorRunResponse(
            ok=False,
            session=context.session,
            finalResponseText="",
            error=f"single_card_run_failed: {err}",
            plan=context.plan,
            thinkGraph=context.thinkGraph,
            knowGraph=KnowGraphUpdateReport(sourceAgent="single_card", summary="run_failed"),
        )
    finally:
        if return_root_token is not None:
            JOB_RETURN_ROOT.reset(return_root_token)
        if authority_token is not None:
            THINKGRAPH_RUN_AUTHORITY.reset(authority_token)
        if patch_events_token is not None:
            THINKGRAPH_PATCH_EVENTS.reset(patch_events_token)


def _read_magentic_handoff_task(context: ContextPack) -> tuple[jf.JobFolder | None, str | None]:
    """Mag One's sole task-entrypoint reader: exact handoff/prompt.md bytes."""
    if context.jobHandoff is None:
        return None, None
    folder = jf.resolve_job_folder(context.jobHandoff.workspaceRoot, context.jobHandoff.jobId)
    task = jf.read_handoff_prompt(folder)
    jf.ensure_returns_dir(folder)
    return folder, task


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

    # Coder job-folder handoff: the run's task is the EXACT bytes of the Magnetic
    # One variable context packet at handoff/<jobId>/prompt.md (never chat text, a
    # wrapper, or userText), and returns/<jobId>/ is its assigned return surface.
    # The workspace root is the server-forced trusted root carried in the contract,
    # re-validated here.
    folder: jf.JobFolder | None = None
    if context.jobHandoff is not None:
        try:
            folder, task = _read_magentic_handoff_task(context)
        except (ValueError, FileNotFoundError, OSError) as err:
            return OrchestratorRunResponse(
                ok=False,
                session=context.session,
                finalResponseText="",
                error=f"job_handoff_unresolved: {err}",
                plan=context.plan,
                thinkGraph=context.thinkGraph,
                knowGraph=KnowGraphUpdateReport(sourceAgent="magentic_one", summary="no_run"),
            )
    else:
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

    # Arm the run-scoped return writer for a handoff run: participants' write_return_file
    # tool resolves against THIS folder's returns/<job-id>/ only. Always reset below so
    # no return authority leaks across runs.
    return_root_token = JOB_RETURN_ROOT.set(folder) if folder is not None else None

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

        # Dev participant spans (fire-and-forget; disabled in production and by
        # LIQUIDAITY_DEV_SPANS=0). One span per streamed participant message,
        # tied to the backend run trace via session.runId when supplied.
        span_identities = _participant_identity_by_agent_name(context)
        span_correlation = _as_text(getattr(context.session, "runId", "")) or _as_text(
            context.session.sessionId
        )
        span_last_monotonic = time.monotonic()
        span_turn_index = 0

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
                if source != "user":
                    now_monotonic = time.monotonic()
                    identity = span_identities.get(source, {})
                    emit_participant_span(
                        build_participant_span(
                            correlation_id=span_correlation,
                            project_id=_as_text(context.session.projectId),
                            source=source,
                            card_id=identity.get("cardId") or None,
                            provider=identity.get("provider") or None,
                            model=identity.get("model") or None,
                            output=content,
                            duration_ms=int((now_monotonic - span_last_monotonic) * 1000),
                            turn_index=span_turn_index,
                            message_type=payload["type"],
                        )
                    )
                    span_last_monotonic = now_monotonic
                    span_turn_index += 1

        if not final_response_text and autogen_messages:
            final_response_text = _as_text(autogen_messages[-1].get("content"))

        # Real Task Ledger artifact, read from the captured orchestrator's actual
        # state — NOT from finalResponseText / chat text. None if the orchestrator
        # produced no Task Ledger (no fabrication for PlanFlow).
        task_ledger_artifact = _real_task_ledger_artifact(getattr(team, "orchestrator_instance", None))

        # Safe metadata only (no full prompt / no raw ledger text) — proves the run
        # is real AutoGen and whether a Task Ledger artifact was captured. No post-run
        # PlanFlow projection: Mag One's native Task Ledger is the task breakdown.
        print(
            "[magentic] run_stream meta:",
            {
                "messages": len(autogen_messages),
                "events": len(autogen_events),
                "message_types": sorted({m["type"] for m in autogen_messages}),
                "sources": sorted({m["source"] for m in autogen_messages}),
                "stop_reason": stop_reason,
                "has_task_ledger_artifact": task_ledger_artifact is not None,
            },
        )

        # Job-folder handoff: report the assigned returns dir and the files the run
        # actually wrote there. Empty is honest ("no_return_files_created") — the
        # normal final text is preserved as text and no result file is fabricated.
        returns_rel: str | None = None
        returned_files: list[str] = []
        return_status: str | None = None
        if folder is not None:
            returned_files = jf.list_return_files(folder)
            returns_rel = f"{folder.returns_rel}/"
            return_status = (
                "return_files_created" if returned_files else "no_return_files_created"
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
            ),
            stopReason=stop_reason,
            finalResponseText=final_response_text,
            autogenMessages=autogen_messages,
            autogenEvents=autogen_events,
            taskLedgerArtifact=task_ledger_artifact,
            progressLedgerReference=None,
            returnsDir=returns_rel,
            returnedFiles=returned_files,
            returnStatus=return_status,
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
        if return_root_token is not None:
            JOB_RETURN_ROOT.reset(return_root_token)
        close = getattr(client, "close", None)
        if callable(close):
            try:
                await close()
            except Exception:
                pass
