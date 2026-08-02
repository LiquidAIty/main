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
import os
import re
import time
from typing import Any, Sequence
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from autogen_agentchat.agents import AssistantAgent, BaseChatAgent
from autogen_agentchat.base import Response
from autogen_agentchat.messages import BaseChatMessage, TextMessage
from autogen_agentchat.teams import MagenticOneGroupChat
from autogen_core import CancellationToken

from app.python_models import agentgraph as ag
from app.python_models.autogen_provider_env import AutoGenAgentConfig, _build_model_client
from app.python_models.tool_registry import (
    ACTIVE_AGENT_ASSIGNMENT_CONTEXT,
    DEFAULT_TOOL_REGISTRY,
    build_local_coder_tool,
)
from app.python_models.orchestration_contracts import (
    ContextPack,
    OrchestratorRunResponse,
)


def _post_codex_backend(path: str, payload: dict[str, Any], timeout: int) -> dict[str, Any]:
    base = os.environ.get("LIQUIDAITY_BACKEND_URL", "http://127.0.0.1:4000").rstrip("/")
    request = Request(
        f"{base}{path}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=timeout) as response:  # noqa: S310 -- loopback backend owner
            value = json.loads(response.read().decode("utf-8"))
    except HTTPError as err:
        body = err.read().decode("utf-8")
        try:
            value = json.loads(body)
        except json.JSONDecodeError:
            value = {"ok": False, "error": f"codex_backend_http_{err.code}"}
    except URLError as err:
        value = {"ok": False, "error": f"codex_backend_unreachable:{err.reason}"}
    if not isinstance(value, dict):
        raise RuntimeError("codex_backend_response_invalid")
    return value


class _CodexAppServerAgent(BaseChatAgent):
    """One ordinary Mag One worker backed by the saved Codex app-server card."""

    def __init__(self, name: str, description: str, *, project_id: str, deck_id: str, card_id: str) -> None:
        super().__init__(name, description)
        self._project_id = project_id
        self._deck_id = deck_id
        self._card_id = card_id

    @property
    def produced_message_types(self) -> Sequence[type[BaseChatMessage]]:
        return (TextMessage,)

    async def on_messages(
        self,
        messages: Sequence[BaseChatMessage],
        cancellation_token: CancellationToken,
    ) -> Response:
        assignment = next(
            (_as_text(getattr(message, "content", "")) for message in reversed(messages) if _as_text(getattr(message, "content", ""))),
            "",
        )
        if not assignment:
            raise RuntimeError("codex_app_server_assignment_required")
        started = await asyncio.to_thread(
            _post_codex_backend,
            f"/api/coder/codex-app-server/cards/{self._card_id}/start",
            {"projectId": self._project_id, "assignment": assignment},
            15,
        )
        if started.get("ok") is not True:
            raise RuntimeError(str(started.get("error") or "codex_app_server_start_failed"))
        turn_id = _as_text((started.get("started") or {}).get("turnId"))
        if not turn_id:
            raise RuntimeError("codex_app_server_turn_id_missing")
        completed = await asyncio.to_thread(
            _post_codex_backend,
            f"/api/coder/codex-app-server/cards/{self._card_id}/await",
            {"projectId": self._project_id, "turnId": turn_id},
            125,
        )
        receipt = completed.get("receipt") or {}
        if completed.get("ok") is not True:
            raise RuntimeError(str(completed.get("error") or receipt.get("failure") or "codex_app_server_turn_failed"))
        result = receipt.get("result") or {}
        text = _as_text(result.get("finalText"))
        if not text:
            raise RuntimeError("codex_app_server_result_text_missing")
        return Response(chat_message=TextMessage(content=text, source=self.name))

    async def on_reset(self, cancellation_token: CancellationToken) -> None:
        return None


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


def _build_participants(
    context: ContextPack,
    model_client: Any,
    *,
    extra_tools: list[Any] | None = None,
) -> list[AssistantAgent]:
    card = context.cardRuntime
    if card is None:
        return []
    participants: list[AssistantAgent] = []
    used_names: set[str] = set()
    configured_participants = card.participants or []
    if isinstance(model_client, (list, tuple)) and len(model_client) != len(
        configured_participants
    ):
        raise RuntimeError(
            "card_runtime_participant_model_count_mismatch: "
            f"participants={len(configured_participants)} clients={len(model_client)}"
        )
    for i, participant in enumerate(configured_participants):
        card_id = _as_text(getattr(participant, "cardId", ""))
        title = _as_text(getattr(participant, "title", "")) or card_id
        name = _safe_agent_name(title or f"Agent {i + 1}", i, used_names)
        description = (
            _as_text(getattr(participant, "runtimeBinding", ""))
            or _as_text(getattr(participant, "runtimeType", ""))
            or "assistant"
        )
        system_prompt = _as_text(getattr(participant, "prompt", ""))

        runtime_type = _as_text(getattr(participant, "runtimeType", ""))
        if runtime_type == "codex_app_server":
            if list(getattr(participant, "tools", []) or []):
                raise RuntimeError(f"openai_coder_assigned_tools_forbidden:{card_id}")
            runtime_options = getattr(card, "runtimeOptions", None) or {}
            participants.append(
                _CodexAppServerAgent(
                    name,
                    description,
                    project_id=context.session.projectId,
                    deck_id=_as_text(runtime_options.get("deckId")),
                    card_id=card_id,
                )
            )
            continue

        kwargs: dict[str, Any] = {
            "name": name,
            "description": description,
            "model_client": model_client[i]
            if isinstance(model_client, (list, tuple))
            else model_client,
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
        if extra_tools:
            tools = [*tools, *extra_tools]
        if tools:
            kwargs["tools"] = tools

        participants.append(AssistantAgent(**kwargs))

    if participants:
        return participants

    raise RuntimeError("card_runtime_participants_required")


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


def _tool_evidence_from_result(result: Any) -> list[dict[str, str]]:
    """Keep compact tool-call identity/status evidence, never args or outputs."""
    evidence: list[dict[str, str]] = []
    names_by_call_id: dict[str, str] = {}
    for message in getattr(result, "messages", []) or []:
        event = type(message).__name__
        content = getattr(message, "content", None)
        items = content if isinstance(content, list) else []
        for item in items:
            call_id = str(
                getattr(item, "id", None)
                or getattr(item, "call_id", None)
                or ""
            ).strip()
            tool_name = str(getattr(item, "name", None) or "").strip()
            if call_id and tool_name:
                names_by_call_id[call_id] = tool_name
            if not call_id and not tool_name:
                continue
            is_error = getattr(item, "is_error", None)
            record = {
                "event": event,
                **({"callId": call_id} if call_id else {}),
                **(
                    {"toolName": tool_name or names_by_call_id.get(call_id, "")}
                    if tool_name or names_by_call_id.get(call_id)
                    else {}
                ),
                **(
                    {"status": "failed" if is_error else "completed"}
                    if isinstance(is_error, bool)
                    else {}
                ),
            }
            evidence.append(record)
    return evidence


async def run_configured_card(context: ContextPack) -> OrchestratorRunResponse:
    """Run ONE configured canvas card as a single AssistantAgent.

    Reuses ``_build_participants`` unchanged (same prompt resolution, same model
    client, same tool registry with loud unknown/disabled failures). Guard or
    runtime failures return an honest error — never a fallback model, another
    card, or a plain completion. No Task Ledger is read or produced.

    The saved card supplies its existing AutoGen identity and runtime configuration.
    AgentGraph supplies the durable assignment, bounded context references, and
    direct context references for this execution.
    """
    assignment_id: str | None = None
    instruction_id: str | None = None
    result_id: str | None = None
    claim_token: str | None = None
    hydrated_assignment: dict[str, Any] | None = None

    guard = _validate_single_card_context(context)
    if guard:
        return OrchestratorRunResponse(
            ok=False,
            session=context.session,
            assignmentId=assignment_id,
            finalResponseText="",
            error=guard,
        )

    async def _fail(error: str, summary: str) -> OrchestratorRunResponse:
        nonlocal result_id
        durable_error = ""
        if assignment_id is not None and claim_token is not None:
            try:
                completed = await asyncio.to_thread(
                    ag.finish_assignment,
                    project_id=context.session.projectId,
                    assignment_id=assignment_id,
                    claim_token=claim_token,
                    status="failed",
                    error_code=summary,
                    error_detail=error,
                )
                result_id = str(completed.get("resultId") or "") or None
            except Exception as persistence_error:
                durable_error = f"; outer_assignment_persist_failed: {persistence_error}"
        return OrchestratorRunResponse(
            ok=False,
            session=context.session,
            **_assignment_fields(),
            finalResponseText="",
            error=error + durable_error,
        )

    runtime_options = getattr(context.cardRuntime, "runtimeOptions", None) or {}
    single = context.cardRuntime.participants[0]
    deck_id = _as_text(runtime_options.get("deckId") if isinstance(runtime_options, dict) else "")
    def _assignment_fields() -> dict:
        return {
            "assignmentId": assignment_id,
            "instructionId": instruction_id,
            "resultId": result_id,
        }

    selected_tools = [_as_text(t) for t in (single.tools or []) if _as_text(t)]
    request = context.agentAssignment
    if request is not None and request.receiverCardId != single.cardId:
        return await _fail(
            "agentgraph_assignment_receiver_mismatch",
            "agentgraph_assignment_receiver_mismatch",
        )
    instruction_body = _as_text(context.userText)
    sender_card_id = request.senderCardId if request is not None else single.cardId
    try:
        if request is None:
            instruction = await asyncio.to_thread(
                ag.create_instruction,
                project_id=context.session.projectId,
                deck_id=deck_id,
                conversation_id=_as_text(context.conversationId) or "main",
                body=instruction_body,
                prepared_by_card_id=sender_card_id,
            )
            instruction_id = instruction["instructionId"]
        else:
            instruction_id = request.instructionId
        assignment = await asyncio.to_thread(
            ag.create_assignment,
            project_id=context.session.projectId,
            deck_id=deck_id,
            conversation_id=_as_text(context.conversationId) or "main",
            correlation_id=context.session.turnId,
            sender_card_id=sender_card_id,
            receiver_card_id=single.cardId,
            instruction_id=instruction_id,
            parent_correlation_id=_as_text(context.session.runId) or None,
        )
        assignment_id = assignment["assignmentId"]
        hydrated_assignment = await asyncio.to_thread(
            ag.read_assignment,
            project_id=context.session.projectId,
            assignment_id=assignment_id,
            receiving_card_id=single.cardId,
        )
        claimed = await asyncio.to_thread(
            ag.claim_assignment,
            project_id=context.session.projectId,
            assignment_id=assignment_id,
            receiver_card_id=single.cardId,
        )
        claim_token = claimed["claimToken"]
        instruction_body = str(hydrated_assignment["instruction"])
        await asyncio.to_thread(
            ag.record_assignment_runtime_context,
            project_id=context.session.projectId,
            assignment_id=assignment_id,
            runtime="assistant_agent",
            provider=context.session.modelProvider,
            model_key=context.session.modelKey,
            provider_model_id=context.session.providerModelId,
        )
    except Exception as err:
        durable_error = ""
        if assignment_id is not None:
            try:
                cancelled = await asyncio.to_thread(
                    ag.cancel_assignment,
                    project_id=context.session.projectId,
                    assignment_id=assignment_id,
                    requested_by_card_id=sender_card_id,
                    reason=f"agentgraph_assignment_begin_failed: {err}",
                )
                result_id = str(cancelled.get("resultId") or "") or None
            except Exception as persistence_error:
                durable_error = (
                    f"; outer_assignment_cancel_failed: {persistence_error}"
                )
        return OrchestratorRunResponse(
            ok=False,
            session=context.session,
            **_assignment_fields(),
            finalResponseText="",
            error=f"agentgraph_assignment_begin_failed: {err}{durable_error}",
        )

    client = None

    assignment_context_token = ACTIVE_AGENT_ASSIGNMENT_CONTEXT.set(
        {
            "projectId": context.session.projectId,
            "assignmentId": assignment_id,
            "receiverCardId": single.cardId,
        }
    )

    started = time.monotonic()

    try:
        client = _build_model_client(
            AutoGenAgentConfig(
                provider=single.provider,
                provider_model_id=single.providerModelId,
                temperature=single.temperature,
                max_tokens=single.maxTokens,
            )
        )
        participants = _build_participants(context, client)
        # The guard guarantees exactly one real configured participant, so the
        # default-"Assist" branch of _build_participants is unreachable here.
        agent = participants[0]
        # An inter-agent handoff owns the exact target instruction. userText is
        # still required by the transport guard, but is not duplicated into the
        # model task when a durable handoff is present. Standalone calls without
        # AgentGraph continue to use their ordinary userText unchanged.
        reference_lines = [
            f"- {reference['referenceType']}:{reference['referenceId']}"
            + (" [required]" if reference.get("required") else "")
            for reference in hydrated_assignment.get("contextReferences") or []
        ]
        task = "\n\n".join(
            part
            for part in [
                "[AGENTGRAPH_ASSIGNMENT]",
                f"assignmentId: {assignment_id}",
                f"instructionId: {instruction_id}",
                "Exact instruction:",
                instruction_body,
                "\n".join(["[AGENTGRAPH_CONTEXT_REFERENCES]", *reference_lines])
                if reference_lines else "",
            ]
            if part
        )
        result = await agent.run(task=task)

        final_text = _final_text_from_result(result)

        elapsed_ms = int((time.monotonic() - started) * 1000)
        single = context.cardRuntime.participants[0]
        tools_attached = [_as_text(t) for t in (single.tools or []) if _as_text(t)]
        run_info = (
            f"single_card cardId={single.cardId} runtime=assistant_agent "
            f"tools={','.join(tools_attached) or 'none'} elapsedMs={elapsed_ms} "
            f"turnId={context.session.turnId}"
        )

        if not final_text:
            return await _fail(
                "single_card_empty_response",
                "empty_response",
            )

        completed = await asyncio.to_thread(
            ag.finish_assignment,
            project_id=context.session.projectId,
            assignment_id=assignment_id,
            claim_token=claim_token,
            status="completed",
            output=final_text,
            tool_evidence=_tool_evidence_from_result(result),
        )
        result_id = str(completed.get("resultId") or "") or None
        assignment_fields = _assignment_fields()

        return OrchestratorRunResponse(
            ok=True,
            session=context.session,
            finalResponseText=final_text,
            **assignment_fields,
        )
    except Exception as err:  # honest runtime failure — no retry, no fallback
        return await _fail(
            f"single_card_run_failed: {err}",
            "run_failed",
        )
    finally:
        ACTIVE_AGENT_ASSIGNMENT_CONTEXT.reset(assignment_context_token)
        if client is not None:
            close = getattr(client, "close", None)
            if callable(close):
                try:
                    await close()
                except Exception:
                    pass


def _read_max_turns(context: ContextPack) -> int | None:
    runtime_options = getattr(context.cardRuntime, "runtimeOptions", None) or {}
    if not isinstance(runtime_options, dict) or "maxTurns" not in runtime_options:
        return None
    raw = runtime_options["maxTurns"]
    try:
        value = int(raw)
    except (TypeError, ValueError) as error:
        raise RuntimeError(f"card_max_turns_invalid:{raw}") from error
    if value < 1:
        raise RuntimeError(f"card_max_turns_invalid:{raw}")
    return value


def _magentic_completion_status(
    final_response_text: str,
) -> tuple[bool, str | None]:
    """Derive completion from the result persisted through AgentGraph."""
    if not _as_text(final_response_text):
        return False, "no_model_output"
    return True, None


async def run_native_magentic_mission(context: ContextPack) -> OrchestratorRunResponse:
    if context.cardRuntime is None:
        raise RuntimeError("card_runtime_missing")

    request = context.agentAssignment
    if request is None:
        return OrchestratorRunResponse(
            ok=False,
            session=context.session,
            assignmentId=assignment["assignmentId"] if "assignment" in locals() else None,
            finalResponseText="",
            error="agentgraph_assignment_required",
        )
    runtime_options = getattr(context.cardRuntime, "runtimeOptions", None) or {}
    deck_id = _as_text(runtime_options.get("deckId"))
    assignment_id: str | None = None
    claim_token: str | None = None
    result_id: str | None = None
    try:
        assignment = await asyncio.to_thread(
            ag.create_assignment,
            project_id=context.session.projectId,
            deck_id=deck_id,
            conversation_id=_as_text(context.conversationId) or "main",
            correlation_id=context.session.turnId,
            sender_card_id=request.senderCardId,
            receiver_card_id=request.receiverCardId,
            instruction_id=request.instructionId,
            parent_correlation_id=_as_text(context.session.runId) or None,
        )
        assignment_id = assignment["assignmentId"]
        hydrated_assignment = await asyncio.to_thread(
            ag.read_assignment,
            project_id=context.session.projectId,
            assignment_id=assignment_id,
            receiving_card_id=request.receiverCardId,
        )
        claimed = await asyncio.to_thread(
            ag.claim_assignment,
            project_id=context.session.projectId,
            assignment_id=assignment_id,
            receiver_card_id=request.receiverCardId,
        )
        claim_token = claimed["claimToken"]
        await asyncio.to_thread(
            ag.record_assignment_runtime_context,
            project_id=context.session.projectId,
            assignment_id=assignment_id,
            runtime="magentic_one",
            provider=context.session.modelProvider,
            model_key=context.session.modelKey,
            provider_model_id=context.session.providerModelId,
        )
    except Exception as err:
        durable_error = ""
        if assignment_id is not None:
            try:
                cancelled = await asyncio.to_thread(
                    ag.cancel_assignment,
                    project_id=context.session.projectId,
                    assignment_id=assignment_id,
                    requested_by_card_id=request.senderCardId,
                    reason=f"agentgraph_assignment_begin_failed: {err}",
                )
                result_id = str(cancelled.get("resultId") or "") or None
            except Exception as persistence_error:
                durable_error = f"; outer_assignment_cancel_failed: {persistence_error}"
        return OrchestratorRunResponse(
            ok=False,
            session=context.session,
            assignmentId=assignment_id,
            resultId=result_id,
            finalResponseText="",
            error=f"agentgraph_assignment_begin_failed: {err}{durable_error}",
        )
    reference_lines = [
        f"- {reference['referenceType']}:{reference['referenceId']}"
        + (" [required]" if reference.get("required") else "")
        for reference in hydrated_assignment.get("contextReferences") or []
    ]
    task = "\n\n".join(
        part
        for part in [
            "[AGENTGRAPH_ASSIGNMENT]",
            f"assignmentId: {assignment_id}",
            f"instructionId: {request.instructionId}",
            "Exact instruction:",
            str(hydrated_assignment["instruction"]),
            "\n".join(["[AGENTGRAPH_CONTEXT_REFERENCES]", *reference_lines])
            if reference_lines else "",
        ]
        if part
    )

    client = None
    participant_clients: list[Any] = []
    assignment_context_token = ACTIVE_AGENT_ASSIGNMENT_CONTEXT.set(
        {
            "projectId": context.session.projectId,
            "assignmentId": assignment["assignmentId"],
            "receiverCardId": request.receiverCardId,
        }
    )

    try:
        runtime_options = context.cardRuntime.runtimeOptions or {}
        client = _build_model_client(
            AutoGenAgentConfig(
                provider=context.session.modelProvider,
                provider_model_id=context.session.providerModelId,
                temperature=runtime_options.get("temperature"),
                max_tokens=runtime_options.get("maxTokens"),
            )
        )
        participant_clients = [
            None
            if participant.runtimeType == "codex_app_server"
            else _build_model_client(
                AutoGenAgentConfig(
                    provider=participant.provider,
                    provider_model_id=participant.providerModelId,
                    temperature=participant.temperature,
                    max_tokens=participant.maxTokens,
                )
            )
            for participant in context.cardRuntime.participants
        ]
        participants = _build_participants(context, participant_clients)
        team_options: dict[str, Any] = {
            "participants": participants,
            "model_client": client,
        }
        max_turns = _read_max_turns(context)
        if max_turns is not None:
            team_options["max_turns"] = max_turns
        team = MagenticOneGroupChat(
            **team_options,
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

        print(
            "[magentic] run_stream meta:",
            {
                "messages": len(autogen_messages),
                "events": len(autogen_events),
                "message_types": sorted({m["type"] for m in autogen_messages}),
                "sources": sorted({m["source"] for m in autogen_messages}),
                "stop_reason": stop_reason,
            },
        )

        ok, completion_error = _magentic_completion_status(final_response_text)
        completed = await asyncio.to_thread(
            ag.finish_assignment,
            project_id=context.session.projectId,
            assignment_id=assignment_id,
            claim_token=claim_token,
            status="completed" if ok else "failed",
            output=final_response_text or None,
            error_code=completion_error,
            error_detail=completion_error,
        )
        result_id = str(completed.get("resultId") or "") or None
        return OrchestratorRunResponse(
            ok=ok,
            session=context.session,
            assignmentId=assignment_id,
            instructionId=request.instructionId,
            resultId=result_id,
            stopReason=stop_reason,
            finalResponseText=final_response_text,
            autogenMessages=autogen_messages,
            autogenEvents=autogen_events,
            error=completion_error,
        )
    except Exception as err:
        durable_error = ""
        if assignment_id is not None and claim_token is not None:
            try:
                failed = await asyncio.to_thread(
                    ag.finish_assignment,
                    project_id=context.session.projectId,
                    assignment_id=assignment_id,
                    claim_token=claim_token,
                    status="failed",
                    error_code="magentic_run_failed",
                    error_detail=str(err),
                )
                result_id = str(failed.get("resultId") or "") or None
            except Exception as persistence_error:
                durable_error = f"; outer_assignment_persist_failed: {persistence_error}"
        return OrchestratorRunResponse(
            ok=False,
            session=context.session,
            assignmentId=assignment_id,
            instructionId=request.instructionId,
            resultId=result_id,
            finalResponseText="",
            error=f"magentic_run_failed: {err}{durable_error}",
        )
    finally:
        ACTIVE_AGENT_ASSIGNMENT_CONTEXT.reset(assignment_context_token)
        for owned_client in [*participant_clients, client]:
            close = getattr(owned_client, "close", None)
            if callable(close):
                try:
                    await close()
                except Exception:
                    pass
