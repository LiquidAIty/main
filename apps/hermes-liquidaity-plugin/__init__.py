# Entity: Hermes Plugin
# Relationship: Registers LiquidAIty's declared tools and lifecycle hooks through the public Hermes plugin context.
# Entity: TaskGraphs
# Relationship: Registers the one categorized Team/Magnetic admission tool while Hermes retains the task ledger, dispatch, workers, and completion.
# Entity: Project Knowledge Graph
# Relationship: Reads the provider-owned Project Entity map into Main, Builder, ThinkGraph, and KnowGraph before inference without accepting graph meaning from the UI.
# Entity: ThinkGraph
# Relationship: Observes each successful completed Main turn and asks the Hermes plugin host to schedule independent completed-pair extraction and Engraphis settlement.
"""Official Hermes binding for UI context, Card Python, taskgraphs, and ThinkGraph."""

from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
import sqlite3
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
_PROJECT_ENTITY_MAP_PROFILES = frozenset({
    "main", "builder", "thinkgraph", "knowgraph",
})


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


def _project_entity_map_context(ctx: Any) -> str:
    project_id = _project_id(ctx)
    origin = _loopback_origin(
        ctx.get_config("python_rails_url", _DEFAULT_PYTHON_RAILS_URL)
    )
    result = _post_json(
        origin,
        "/project/entity-map/read",
        {"projectId": project_id},
        timeout=30,
    )
    context = str(result.get("context") or "")
    if (
        result.get("ok") is not True
        or result.get("projectId") != project_id
        or not context.strip()
    ):
        raise RuntimeError("liquidaity_project_entity_map_unavailable")
    return context


def _completed_pair_row_ids(session_id: str) -> tuple[int, int]:
    """Capture the exact terminal pair synchronously at the Hermes turn boundary."""

    from hermes_constants import get_hermes_home

    database = (Path(get_hermes_home()) / "state.db").resolve()
    if not database.is_file():
        raise RuntimeError("liquidaity_main_state_unavailable")
    connection = sqlite3.connect(f"file:{database.as_posix()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        rows = connection.execute(
            "SELECT id,role,content,tool_calls,display_kind FROM messages "
            "WHERE session_id=? AND active=1 AND role IN ('user','assistant') "
            "AND COALESCE(display_kind,'')='' ORDER BY id DESC LIMIT 128",
            (session_id,),
        ).fetchall()
    finally:
        connection.close()
    assistant = next((
        row for row in rows
        if row["role"] == "assistant"
        and row["tool_calls"] in (None, "", "[]")
        and str(row["content"] or "").strip()
    ), None)
    user = next((
        row for row in rows
        if assistant is not None
        and row["role"] == "user"
        and row["id"] < assistant["id"]
        and str(row["content"] or "").strip()
    ), None)
    if user is None or assistant is None:
        raise RuntimeError("liquidaity_main_completed_pair_unavailable")
    return int(user["id"]), int(assistant["id"])


def _process_completed_turn(
    ctx: Any,
    session_id: str,
    *,
    profile_name: str | None = None,
    origin: str | None = None,
    user_row_id: int,
    assistant_row_id: int,
) -> None:
    project_id = _project_id(ctx)
    profile_name = profile_name or ctx.profile_name
    origin = origin or _loopback_origin(
        ctx.get_config("python_rails_url", _DEFAULT_PYTHON_RAILS_URL)
    )
    settled = _post_json(
        origin,
        "/thinkgraph/completed-pair/process",
        {
            "projectId": project_id,
            "profile": profile_name,
            "sessionId": session_id,
            "userRowId": user_row_id,
            "assistantRowId": assistant_row_id,
        },
        timeout=1_830,
    )
    if settled.get("ok") is not True:
        raise RuntimeError("liquidaity_thinkgraph_settle_failed")


def _run_completed_turn(
    ctx: Any,
    session_id: str,
    profile_name: str,
    origin: str,
    user_row_id: int,
    assistant_row_id: int,
) -> None:
    try:
        _process_completed_turn(
            ctx,
            session_id,
            profile_name=profile_name,
            origin=origin,
            user_row_id=user_row_id,
            assistant_row_id=assistant_row_id,
        )
    except Exception as error:  # Observer work never changes the completed Main reply.
        _LOGGER.error("LiquidAIty automatic ThinkGraph intake failed: %s", error)


def register(ctx: Any) -> None:
    card_script = normalize_card_script(ctx.get_config("card_script", {}))
    ctx.register_tool(
        name=CARD_SCRIPT_TOOL_NAME,
        toolset="liquidaity",
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
        toolset="liquidaity",
        schema=taskgraph_schema(),
        handler=build_taskgraph_handler(ctx),
        check_fn=lambda: taskgraph_available(ctx),
        description=(
            "Category: coordination/taskgraph. Start this saved Team or Magnetic "
            "Card's Hermes-native taskgraph."
        ),
        emoji="🕸️",
    )
    def project_entity_map_context(**_: Any) -> dict[str, str] | None:
        if ctx.profile_name not in _PROJECT_ENTITY_MAP_PROFILES:
            return None
        return {"context": _project_entity_map_context(ctx)}

    ctx.register_hook("pre_llm_call", project_entity_map_context)

    def on_main_turn_complete(*, session_id: str = "", completed: bool = False,
                              failed: bool = False, interrupted: bool = False,
                              **_: Any) -> None:
        if (
            ctx.profile_name != "main"
            or not str(session_id or "").strip()
            or completed is not True or failed or interrupted
        ):
            return
        profile_name = ctx.profile_name
        try:
            user_row_id, assistant_row_id = _completed_pair_row_ids(
                str(session_id).strip()
            )
        except Exception as error:
            _LOGGER.error(
                "LiquidAIty could not capture the completed Main pair: %s", error
            )
            return
        origin = _loopback_origin(
            ctx.get_config("python_rails_url", _DEFAULT_PYTHON_RAILS_URL)
        )
        try:
            # The Hermes plugin host owns this background task. Main only produced
            # the completed source turn; it cannot invoke, steer, or settle intake.
            ctx.spawn_task(
                asyncio.to_thread(
                    _run_completed_turn,
                    ctx,
                    str(session_id).strip(),
                    profile_name,
                    origin,
                    user_row_id,
                    assistant_row_id,
                ),
                name=f"liquidaity-thinkgraph:{session_id}",
            )
        except RuntimeError as error:
            _LOGGER.error(
                "LiquidAIty ThinkGraph observer requires a running Hermes plugin loop: %s",
                error,
            )

    # Hermes fires this per-turn hook after its transcript persistence step.
    # Do not capture rows from a streaming/composer completion callback.
    ctx.register_hook("on_session_end", on_main_turn_complete)
