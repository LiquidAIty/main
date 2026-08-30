"""Real AutoGen/Magentic-One adapter.

This module is a thin bridge from a server-resolved Card runtime request into
real ``MagenticOneGroupChat`` execution. It does not recreate Magentic-One prompts
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
from app.python_models.codex_app_server_model_client import CodexAppServerError
from app.python_models.internal_mcp import call_saved_card_via_mcp
from app.python_models.idf import model_task
from app.python_models.tool_registry import DEFAULT_TOOL_REGISTRY
from app.python_models.orchestration_contracts import (
    RuntimeRequest,
    OrchestratorRunResponse,
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


def _model_task(context: RuntimeRequest) -> str:
    """Mechanically project the graph-first task from the validated IDF."""
    return model_task(context.idf)


def connected_agent_names(context: RuntimeRequest) -> list[str]:
    names: list[str] = []
    for participant in context.participants or []:
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
                f"saved_card_messages_required: cardId={self._card_id}"
            )

        self._invocation += 1
        data_anchors = []
        for index, reference in enumerate(
            self._context.idf.actualGraphData.selectedNativeReferences
        ):
            scope = reference.get("selectionScope")
            scope = scope if isinstance(scope, dict) else {}
            data_anchors.append({
                "authority": _as_text(reference.get("authority")),
                "nativeId": _as_text(reference.get("nativeId")),
                "reason": _as_text(reference.get("reason"))
                or "Forward the sender's selected graph data",
                "priority": -index,
                "boundedExpansion": int(scope.get("boundedExpansion") or 0),
                "resultLimit": int(scope.get("resultLimit") or 24),
                "required": True,
            })
        call = asyncio.create_task(
            call_saved_card_via_mcp(
                project_id=self._context.session.projectId,
                deck_id=self._context.session.deckId,
                conversation_id=_as_text(self._context.session.conversationId) or "active",
                parent_run_id=self._outer_run_id,
                caller_card_id=self._context.session.cardId,
                caller_runtime_kind=_as_text(
                    self._context.idf.stableSavedCardContext.runtime.get("kind")
                ),
                caller_runtime_mode=_as_text(
                    self._context.idf.stableSavedCardContext.runtime.get("mode")
                ),
                target_card_id=self._card_id,
                input_text=input_text,
                data_anchors=data_anchors,
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
                },
            )
        )


def _build_participants(
    context: RuntimeRequest,
    *,
    outer_run_id: str = "",
) -> list[BaseChatAgent]:
    participants: list[BaseChatAgent] = []
    used_names: set[str] = set()
    configured_participants = context.participants or []
    for i, participant in enumerate(configured_participants):
        card_id = _as_text(getattr(participant, "cardId", ""))
        title = _as_text(getattr(participant, "title", "")) or card_id
        name = _safe_agent_name(title or f"Agent {i + 1}", i, used_names)
        description = f"{participant.runtime.kind}/{participant.runtime.mode}"
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

    if participants:
        return participants

    raise RuntimeError("card_runtime_participants_required")


def _validate_single_card_context(context: RuntimeRequest) -> str | None:
    """Structural guard for the single-card runtime. Returns an honest error code or None.

    Pure (no model/client construction) so it is directly unit-testable. It never
    decides meaning — only shape: exactly one configured participant, the
    single-card runtime type, and a non-empty task.
    """
    runtime = context.idf.stableSavedCardContext.runtime
    if runtime.get("kind") != "autogen" or runtime.get("mode") != "assistant":
        return (
            "single_card_runtime_invalid: runtime="
            f"{runtime.get('kind')}/{runtime.get('mode')}"
        )
    if context.session.orchestrator != "assistant_agent":
        return f"single_card_orchestrator_invalid: orchestrator={context.session.orchestrator}"
    if not _as_text(context.idf.dynamicContext.task):
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
    """Run one configured saved Card with its transient model input."""
    guard = _validate_single_card_context(context)
    run_id = _as_text(context.session.runId) or context.session.turnId
    if guard:
        return OrchestratorRunResponse(
            ok=False,
            session=context.session,
            runId=run_id,
            finalResponseText="",
            error=guard,
        )

    client = None
    try:
        provider = context.idf.stableSavedCardContext.provider
        options = context.idf.stableSavedCardContext.runtimeOptions
        client = _build_model_client(
            AutoGenAgentConfig(
                provider=_as_text(provider.get("provider")),
                provider_model_id=_as_text(provider.get("providerModelId")),
                access_mode=_as_text(provider.get("accessMode")),
                temperature=options.get("temperature"),
                max_tokens=options.get("maxTokens"),
                reasoning_effort=options.get("reasoningEffort"),
            ),
            runtime_mode="assistant",
        )
        # The exact reloaded IDF carries both the saved authorization ceiling
        # and the smaller model-visible surface. Internal Python composition
        # never needs JSON schemas; the model receives only presented tools.
        selected_tools = list(context.idf.selectedToolsAndGrants.presentedTools)
        tools = DEFAULT_TOOL_REGISTRY.resolve_selected(selected_tools)
        agent = AssistantAgent(
            name="Configured_Card",
            model_client=client,
            system_message=_as_text(
                context.idf.stableSavedCardContext.instructions
            ),
            **({"tools": tools} if tools else {}),
        )
        result = await agent.run(task=_model_task(context))
        final_text = _final_text_from_result(result)
        if not final_text:
            return OrchestratorRunResponse(
                ok=False,
                session=context.session,
                runId=run_id,
                finalResponseText="",
                error="single_card_empty_response",
            )
        return OrchestratorRunResponse(
            ok=True,
            session=context.session,
            runId=run_id,
            finalResponseText=final_text,
        )
    except Exception:
        return OrchestratorRunResponse(
            ok=False,
            session=context.session,
            runId=run_id,
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
    runtime_options = context.idf.stableSavedCardContext.runtimeOptions
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
    """Run native Magentic-One with the saved roster and transient task text."""
    runtime = context.idf.stableSavedCardContext.runtime
    if runtime.get("kind") != "autogen" or runtime.get("mode") != "magentic_one":
        raise RuntimeError("orchestrator_card_required")
    run_id = _as_text(context.session.runId) or context.session.turnId
    task = _model_task(context)

    client = None
    participant_clients: list[Any] = []
    try:
        runtime_options = context.idf.stableSavedCardContext.runtimeOptions
        provider = context.idf.stableSavedCardContext.provider
        client = _build_model_client(
            AutoGenAgentConfig(
                provider=_as_text(provider.get("provider")),
                provider_model_id=_as_text(provider.get("providerModelId")),
                access_mode=_as_text(provider.get("accessMode")),
                temperature=runtime_options.get("temperature"),
                max_tokens=runtime_options.get("maxTokens"),
                reasoning_effort=runtime_options.get("reasoningEffort"),
            ),
            runtime_mode="magentic_one",
        )
        participants = _build_participants(
            context,
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
            stopReason=stop_reason,
            finalResponseText=final_response_text,
            autogenMessages=autogen_messages,
            autogenEvents=autogen_events,
            error=completion_error,
        )
    except Exception as error:
        # Keep provider/process detail out of the public response while leaving
        # one secret-safe exception class in the attached service evidence. The
        # app-server client's own error strings are stable failure codes, so
        # those may be included without exposing raw provider/process detail.
        diagnostic = {
            "run_id": run_id,
            "exception_class": error.__class__.__name__,
        }
        if isinstance(error, CodexAppServerError):
            diagnostic["failure_code"] = str(error)
        print(
            "[magentic] run_stream failed:",
            diagnostic,
        )
        return OrchestratorRunResponse(
            ok=False,
            session=context.session,
            runId=run_id,
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
