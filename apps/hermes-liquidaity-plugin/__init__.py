# Entity: Hermes Plugin
# Relationship: Registers LiquidAIty's declared tools and lifecycle hooks through the public Hermes plugin context.
# Entity: TaskGraphs
# Relationship: Registers the one categorized Team/Magnetic admission tool while Hermes retains the task ledger, dispatch, workers, and completion.
# Entity: ThinkGraph
# Relationship: Passes Main's post_llm_call message pair to independent saved-Card extraction and Engraphis settlement without reading Main's state database.
# Entity: Project Knowledge Graph
# Relationship: Registers request-only selection of the displayed graph without altering prompt submission or conversation history.
"""Official Hermes binding for Card Python, taskgraphs, and ThinkGraph."""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

try:
    from .card_script_runtime import (
        CARD_SCRIPT_TOOL_NAME,
        build_handler as build_card_script_handler,
        card_python_schema,
        hermes_python_runtime_available,
        normalize_card_script,
    )
    from .taskgraph_runtime import (
        TASKGRAPH_TOOL_NAME,
        build_handler as build_taskgraph_handler,
        taskgraph_available,
        taskgraph_schema,
    )
except ImportError:  # Directory-plugin validators may import __init__.py directly.
    from card_script_runtime import (  # type: ignore[no-redef]
        CARD_SCRIPT_TOOL_NAME,
        build_handler as build_card_script_handler,
        card_python_schema,
        hermes_python_runtime_available,
        normalize_card_script,
    )
    from taskgraph_runtime import (  # type: ignore[no-redef]
        TASKGRAPH_TOOL_NAME,
        build_handler as build_taskgraph_handler,
        taskgraph_available,
        taskgraph_schema,
    )

_LOGGER = logging.getLogger(__name__)
_DEFAULT_PYTHON_RAILS_URL = "http://127.0.0.1:8003"


def _loopback_origin(value: Any) -> str:
    origin = str(value or _DEFAULT_PYTHON_RAILS_URL).strip().rstrip("/")
    parsed = urlsplit(origin)
    if (
        parsed.scheme != "http"
        or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or parsed.path not in {"", "/"}
    ):
        raise ValueError("liquidaity_python_rails_url_must_be_loopback_http_origin")
    return origin


def _post_json(origin: str, path: str, payload: dict[str, Any], *, timeout: float) -> dict[str, Any]:
    request = Request(
        origin + path,
        data=json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=timeout) as response:  # noqa: S310 - loopback origin is validated above
        result = json.loads(response.read().decode("utf-8"))
    if not isinstance(result, dict):
        raise RuntimeError("liquidaity_python_rails_response_invalid")
    return result


def _project_id(ctx: Any) -> str:
    project_id = str(ctx.get_config("project_id", "") or "").strip()
    if not project_id:
        raise RuntimeError("project_context_unavailable")
    return project_id


def _run_completed_turn(ctx: Any, payload: dict[str, Any]) -> None:
    """Run after the hook has returned; no Main transcript/database lookup."""
    try:
        origin = _loopback_origin(
            ctx.get_config("python_rails_url", _DEFAULT_PYTHON_RAILS_URL)
        )
        settled = _post_json(
            origin, "/thinkgraph/completed-pair/process", payload, timeout=1_830,
        )
        if settled.get("ok") is not True:
            raise RuntimeError("liquidaity_thinkgraph_settle_failed")
        _LOGGER.info("ThinkGraph completed Main turn %s: %s",
                     payload["turnId"], settled.get("thinkMemoryIds", []))
    except Exception:
        _LOGGER.exception("Automatic ThinkGraph failed for Main turn %s", payload["turnId"])


def _register_graph_context(ctx: Any) -> None:
    try:
        from .graph_context import register_graph_context
    except ImportError:
        from graph_context import register_graph_context

    def read(project: str, profile: str) -> dict[str, Any]:
        origin = _loopback_origin(ctx.get_config("python_rails_url", _DEFAULT_PYTHON_RAILS_URL))
        return _post_json(origin, "/project/entity-map/read",
                          {"projectId": project, "profile": profile}, timeout=1)

    register_graph_context(ctx, read)


def register(ctx: Any) -> None:
    _register_graph_context(ctx)
    card_script = normalize_card_script(ctx.get_config("card_script", {}))
    ctx.register_tool(
        name=CARD_SCRIPT_TOOL_NAME,
        toolset="card-tools",
        schema=card_python_schema(card_script),
        handler=build_card_script_handler(ctx),
        check_fn=lambda: normalize_card_script(
            ctx.get_config("card_script", {})
        ) is not None and hermes_python_runtime_available(),
        description="Run this Card's saved Python tool recipe in Hermes.",
        emoji="🐍",
    )
    ctx.register_tool(
        name=TASKGRAPH_TOOL_NAME,
        toolset="card-tools",
        schema=taskgraph_schema(),
        handler=build_taskgraph_handler(ctx),
        check_fn=lambda: taskgraph_available(ctx),
        description=(
            "Category: coordination/taskgraph. Start this saved Team or Magnetic "
            "Card's Hermes-native taskgraph."
        ),
        emoji="🕸️",
    )
    def on_main_response(*, session_id: str = "", turn_id: str = "",
                         user_message: Any = "", assistant_response: str = "",
                         **_: Any) -> None:
        if ctx.profile_name != "main":
            return
        # Hermes supplies the clean original prompt and finalized response.
        # Never select a pair from conversation_history or a database.
        from agent.message_content import flatten_message_text
        user_text = flatten_message_text(user_message)
        if (not session_id or not turn_id or not user_text.strip()
                or not isinstance(assistant_response, str) or not assistant_response.strip()):
            return
        payload = {
            "projectId": _project_id(ctx),
            "profile": ctx.profile_name,
            "sessionId": session_id,
            "turnId": turn_id,
            "userMessage": user_text,
            "assistantResponse": assistant_response,
            "completedAt": datetime.now(timezone.utc).isoformat(
                timespec="milliseconds").replace("+00:00", "Z"),
        }
        work = asyncio.to_thread(_run_completed_turn, ctx, payload)
        try:
            ctx.spawn_task(work, name=f"liquidaity-thinkgraph:{turn_id}")
        except RuntimeError:
            work.close()
            _LOGGER.exception("ThinkGraph could not schedule Main turn %s", turn_id)

    ctx.register_hook("post_llm_call", on_main_response)
