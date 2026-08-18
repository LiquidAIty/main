"""Real AutoGen/Magentic-One adapter.

This module is a thin bridge from the canonical IDF runtime request into real
``MagenticOneGroupChat`` execution. It does not recreate Magentic-One prompts
or task-ledger internals in app code.

It also hosts ``run_configured_card``: the smallest single-card runtime
primitive. It reuses the exact same participant construction
(outer ``AssistantAgent`` cards use their saved prompt/model/tools; typed runtime
bindings use their one native adapter) to run ONE configured canvas card —
no team, no orchestrator, no Task Ledger, no fallback.
"""

from __future__ import annotations

import asyncio
import re
from collections.abc import Sequence
from typing import Any

from autogen_agentchat.agents import AssistantAgent, BaseChatAgent
from autogen_agentchat.base import Response
from autogen_agentchat.messages import BaseChatMessage, TextMessage
from autogen_core import CancellationToken
from autogen_agentchat.teams import MagenticOneGroupChat

from app.python_models.autogen_provider_env import AutoGenAgentConfig, _build_model_client
from app.python_models.internal_mcp import call_saved_card_via_mcp
from app.python_models.tool_registry import (
    DEFAULT_TOOL_REGISTRY,
    build_local_coder_tool,
)
from app.python_models.orchestration_contracts import (
    RuntimeRequest,
    OrchestratorRunResponse,
    require_idf_card_runtime,
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


def connected_agent_names(context: RuntimeRequest) -> list[str]:
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


class McpSavedCardAgent(BaseChatAgent):
    """AutoGen-facing shell for one real saved Card and its native runtime.

    The shell has no model, prompt, tools, memory, or persistent identity of
    its own. Magentic-One talks to this ChatAgent interface; the implementation
    calls the official MCP saved-card doorway, which resolves the target Card
    again from the deck and executes exactly its card-owned runtime adapter.
    """

    def __init__(
        self,
        *,
        name: str,
        description: str,
        context: RuntimeRequest,
        card_id: str,
        outer_run_id: str,
    ) -> None:
        super().__init__(name=name, description=description)
        self._context = context
        self._card_id = card_id
        self._outer_run_id = outer_run_id
        self._invocation = 0

    @property
    def produced_message_types(self) -> tuple[type[BaseChatMessage], ...]:
        return (TextMessage,)

    async def on_reset(self, cancellation_token: CancellationToken) -> None:
        self._invocation = 0

    async def on_messages(
        self,
        messages: Sequence[BaseChatMessage],
        cancellation_token: CancellationToken,
    ) -> Response:
        if cancellation_token.is_cancelled():
            raise asyncio.CancelledError
        transported = []
        for message in messages:
            content = _as_text(getattr(message, "content", ""))
            if not content and hasattr(message, "to_text"):
                content = _as_text(message.to_text())
            if content:
                source = _as_text(getattr(message, "source", "")) or "unknown"
                transported.append(f"[{source}]\n{content}")
        input_text = "\n\n".join(transported).strip()
        if not input_text:
            raise RuntimeError(
                f"saved_hermes_card_messages_required: cardId={self._card_id}"
            )

        self._invocation += 1
        call = asyncio.create_task(
            call_saved_card_via_mcp(
                project_id=self._context.session.projectId,
                deck_id=_as_text(
                    (self._context.cardRuntime.runtimeOptions or {}).get("deckId")
                ),
                conversation_id=self._context.idf.conversationId,
                parent_run_id=self._outer_run_id,
                caller_card_id=self._context.cardRuntime.cardId,
                caller_runtime_binding=(
                    _as_text(self._context.cardRuntime.runtimeBinding) or "magentic_one"
                ),
                target_card_id=self._card_id,
                input_text=input_text,
            )
        )
        cancellation_token.link_future(call)
        response = await call
        if not isinstance(response, dict):
            raise RuntimeError(
                f"saved_card_mcp_run_failed: cardId={self._card_id} "
                "status=invalid_response"
            )
        result = response.get("result")
        status = _as_text(result.get("status")) if isinstance(result, dict) else ""
        output = _as_text(result.get("output")) if isinstance(result, dict) else ""
        child_run_id = _as_text(result.get("correlationId")) if isinstance(result, dict) else ""
        if not response.get("ok") or status != "completed" or not output or not child_run_id:
            # Backend/native error text is intentionally not copied into the
            # Mag One transcript. It may contain provider or process detail.
            raise RuntimeError(
                f"saved_card_mcp_run_failed: cardId={self._card_id} "
                f"status={status or 'unknown'}"
            )
        return Response(
            chat_message=TextMessage(
                source=self.name,
                content=output,
                metadata={
                    "cardId": self._card_id,
                    "childRunId": child_run_id,
                    "originatingRunId": self._outer_run_id,
                    "idfId": self._context.idf.idfId,
                },
            )
        )


# Historical public symbol retained for callers/tests while production now uses
# the runtime-neutral MCP Card shell above.
SavedHermesCardAgent = McpSavedCardAgent


def _build_participants(
    context: RuntimeRequest,
    model_client: Any,
    *,
    extra_tools: list[Any] | None = None,
    saved_hermes_cards: bool = False,
    outer_run_id: str = "",
) -> list[BaseChatAgent]:
    card = context.cardRuntime
    if card is None:
        return []
    participants: list[BaseChatAgent] = []
    used_names: set[str] = set()
    configured_participants = card.participants or []
    if not saved_hermes_cards and isinstance(model_client, (list, tuple)) and len(model_client) != len(
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

        if saved_hermes_cards:
            if not outer_run_id:
                raise RuntimeError("magentic_outer_run_id_required")
            participants.append(
                McpSavedCardAgent(
                    name=name,
                    description=description,
                    context=context,
                    card_id=card_id,
                    outer_run_id=outer_run_id,
                )
            )
            continue

        selected_tools = [
            _as_text(tool)
            for tool in (getattr(participant, "tools", []) or [])
            if _as_text(tool)
        ]
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
        tools = DEFAULT_TOOL_REGISTRY.resolve_selected(selected_tools) if selected_tools else []
        if "run_local_coder" in selected_tools:
            tools = [
                build_local_coder_tool(
                    _as_text(getattr(participant, "provider", "")),
                    _as_text(getattr(participant, "providerModelId", "")),
                    _as_text(getattr(participant, "reasoningEffort", "")) or None,
                    [
                        _as_text(tool)
                        for tool in (getattr(participant, "innerMcpTools", []) or [])
                        if _as_text(tool)
                    ],
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


def _validate_single_card_context(context: RuntimeRequest) -> str | None:
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
    if not _as_text(context.idf.userText):
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


async def run_configured_card(context: RuntimeRequest) -> OrchestratorRunResponse:
    """Run one configured saved card using the exact canonical IDF fields."""
    require_idf_card_runtime(context)
    guard = _validate_single_card_context(context)
    run_id = _as_text(context.session.runId) or context.session.turnId
    if guard:
        return OrchestratorRunResponse(
            ok=False,
            session=context.session,
            runId=run_id,
            idfId=context.idf.idfId,
            finalResponseText="",
            error=guard,
        )

    single = context.cardRuntime.participants[0]
    client = None
    try:
        client = _build_model_client(
            AutoGenAgentConfig(
                provider=single.provider,
                provider_model_id=single.providerModelId,
                temperature=single.temperature,
                max_tokens=single.maxTokens,
                reasoning_effort=single.reasoningEffort,
            )
        )
        participants = _build_participants(context, client)
        agent = participants[0]
        # IDD validated this field once. The adapter passes the exact stored
        # current input; it does not rebuild an assignment-shaped prompt.
        result = await agent.run(task=context.idf.modelInputMarkdown)
        final_text = _final_text_from_result(result)
        if not final_text:
            return OrchestratorRunResponse(
                ok=False,
                session=context.session,
                runId=run_id,
                idfId=context.idf.idfId,
                finalResponseText="",
                error="single_card_empty_response",
            )
        return OrchestratorRunResponse(
            ok=True,
            session=context.session,
            runId=run_id,
            idfId=context.idf.idfId,
            finalResponseText=final_text,
        )
    except Exception:
        return OrchestratorRunResponse(
            ok=False,
            session=context.session,
            runId=run_id,
            idfId=context.idf.idfId,
            finalResponseText="",
            error="single_card_run_failed",
        )
    finally:
        if client is not None:
            close = getattr(client, "close", None)
            if callable(close):
                try:
                    await close()
                except Exception:
                    pass


def _read_max_turns(context: RuntimeRequest) -> int | None:
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
    """Derive completion from the native result text without another authority."""
    if not _as_text(final_response_text):
        return False, "no_model_output"
    return True, None


async def run_native_magentic_mission(
    context: RuntimeRequest,
) -> OrchestratorRunResponse:
    """Run native Magentic-One with the exact canonical IDF and saved roster."""
    if context.cardRuntime is None:
        raise RuntimeError("card_runtime_missing")
    run_id = _as_text(context.session.runId) or context.session.turnId
    task = context.idf.modelInputMarkdown

    client = None
    participant_clients: list[Any] = []
    try:
        runtime_options = context.cardRuntime.runtimeOptions or {}
        client = _build_model_client(
            AutoGenAgentConfig(
                provider=context.session.modelProvider,
                provider_model_id=context.session.providerModelId,
                temperature=runtime_options.get("temperature"),
                max_tokens=runtime_options.get("maxTokens"),
                reasoning_effort=runtime_options.get("reasoningEffort"),
            )
        )
        participants = _build_participants(
            context,
            [],
            saved_hermes_cards=True,
            outer_run_id=run_id,
        )
        team_options: dict[str, Any] = {
            "participants": participants,
            "model_client": client,
        }
        max_turns = _read_max_turns(context)
        if max_turns is not None:
            team_options["max_turns"] = max_turns
        team = MagenticOneGroupChat(**team_options)

        autogen_messages: list[dict[str, str]] = []
        autogen_events: list[dict[str, str]] = []
        stop_reason: str | None = None
        final_response_text = ""

        async for emitted in team.run_stream(task=task):
            if hasattr(emitted, "messages") and isinstance(
                getattr(emitted, "messages", None), list
            ):
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
            payload = {
                "source": _as_text(getattr(emitted, "source", "")) or "unknown",
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
                "run_id": run_id,
                "idf_id": context.idf.idfId,
                "messages": len(autogen_messages),
                "events": len(autogen_events),
                "message_types": sorted({m["type"] for m in autogen_messages}),
                "sources": sorted({m["source"] for m in autogen_messages}),
                "stop_reason": stop_reason,
            },
        )

        ok, completion_error = _magentic_completion_status(final_response_text)
        return OrchestratorRunResponse(
            ok=ok,
            session=context.session,
            runId=run_id,
            idfId=context.idf.idfId,
            stopReason=stop_reason,
            finalResponseText=final_response_text,
            autogenMessages=autogen_messages,
            autogenEvents=autogen_events,
            error=completion_error,
        )
    except Exception:
        return OrchestratorRunResponse(
            ok=False,
            session=context.session,
            runId=run_id,
            idfId=context.idf.idfId,
            finalResponseText="",
            error="magentic_run_failed",
        )
    finally:
        for owned_client in [*participant_clients, client]:
            if owned_client is None:
                continue
            close = getattr(owned_client, "close", None)
            if callable(close):
                try:
                    await close()
                except Exception:
                    pass
