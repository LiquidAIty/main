"""T001 ToolRegistry: typed, loud-failing card tool resolution.

The agent card Tools tab is the only allowed source of tool access. The
registry exposes only selected, enabled, schema-complete ToolSpecs and fails
loudly for unknown, disabled, unselected, empty-name, or schema-missing
tools. There is no fallback, substitution, guessing, auto-selection, or tool
invention.

The real tool callables (``tool_current_datetime``, ``tool_calculator``) live
here and keep executing through real AutoGen ``FunctionTool`` behavior;
``magentic_runtime.build_card_tools`` resolves through this registry.
"""

from __future__ import annotations

import asyncio
import ast
import json
import operator
import os
import re
from contextvars import ContextVar, Token
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from autogen_core.tools import FunctionTool

from app.python_models.orchestration_contracts import ContextPack, ToolSpec


# ---------------------------------------------------------------------------
# Real tool callables (moved verbatim from magentic_runtime.py).
# ---------------------------------------------------------------------------

_SAFE_BIN_OPS: dict[type[ast.AST], Callable[[Any, Any], Any]] = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}
_SAFE_UNARY_OPS: dict[type[ast.AST], Callable[[Any], Any]] = {
    ast.UAdd: operator.pos,
    ast.USub: operator.neg,
}


def _eval_arithmetic(node: ast.AST) -> float:
    if isinstance(node, ast.Expression):
        return _eval_arithmetic(node.body)
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return float(node.value)
    if isinstance(node, ast.BinOp) and type(node.op) in _SAFE_BIN_OPS:
        return _SAFE_BIN_OPS[type(node.op)](_eval_arithmetic(node.left), _eval_arithmetic(node.right))
    if isinstance(node, ast.UnaryOp) and type(node.op) in _SAFE_UNARY_OPS:
        return _SAFE_UNARY_OPS[type(node.op)](_eval_arithmetic(node.operand))
    raise ValueError(f"calculator_unsupported_expression: {ast.dump(node)}")


def tool_current_datetime() -> str:
    """Return the current UTC date and time in ISO-8601 format."""
    return datetime.now(timezone.utc).isoformat()


def tool_calculator(expression: str) -> str:
    """Evaluate a basic arithmetic expression (+ - * / // % ** and parentheses)."""
    parsed = ast.parse(expression, mode="eval")
    return str(_eval_arithmetic(parsed))


# ---------------------------------------------------------------------------
# Coder Console tool.
# ---------------------------------------------------------------------------

_CURRENT_CODER_CONTEXT: ContextVar[ContextPack | None] = ContextVar(
    "current_coder_console_context",
    default=None,
)
_CURRENT_CODER_DISPATCH: ContextVar[asyncio.Future[dict[str, Any]] | None] = ContextVar(
    "current_coder_console_dispatch",
    default=None,
)
_CODING_WORKFLOW_PATTERN = re.compile(
    r"\b(code|coding|coder|repo|repository|bug|fix|patch|edit|compile|test|runtime|"
    r"localcoder|openclaude|typescript|javascript|python|cbm|codegraph)\b",
    re.IGNORECASE,
)
_EXPLICIT_CODER_EXECUTION_PATTERN = re.compile(
    r"\b(execute|implement|apply|fix|patch|edit|change|run\s+(?:the\s+)?coder|"
    r"plan\s+and\s+execute|do\s+it|proceed|approved?|go\s+ahead)\b",
    re.IGNORECASE,
)
_DEFAULT_CODER_CONSOLE_BACKEND_URL = "http://127.0.0.1:4000"


def set_current_coder_tool_context(context: ContextPack) -> Token:
    """Bind the current Mag One canvas/context for real tool calls in this run."""
    return _CURRENT_CODER_CONTEXT.set(context)


def reset_current_coder_tool_context(token: Token) -> None:
    _CURRENT_CODER_CONTEXT.reset(token)


def set_current_coder_dispatch_future(
    dispatch_future: asyncio.Future[dict[str, Any]],
) -> Token:
    """Bind the dispatch result awaited by the current Mag One rails run."""
    return _CURRENT_CODER_DISPATCH.set(dispatch_future)


def reset_current_coder_dispatch_future(token: Token) -> None:
    _CURRENT_CODER_DISPATCH.reset(token)


def _publish_coder_dispatch(result: dict[str, Any]) -> dict[str, Any]:
    dispatch_future = _CURRENT_CODER_DISPATCH.get()
    if dispatch_future is not None and not dispatch_future.done():
        dispatch_future.set_result(result)
    return result


def _compact_text(value: str, limit: int = 2400) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if len(text) <= limit:
        return text
    return f"{text[: limit - 3]}..."


def _participant_role(participant: Any) -> str:
    identity = " ".join(
        str(value or "").strip().lower()
        for value in (
            getattr(participant, "cardId", ""),
            getattr(participant, "title", ""),
            getattr(participant, "runtimeType", ""),
            getattr(participant, "runtimeBinding", ""),
            getattr(participant, "role", ""),
        )
    )
    if "local_coder" in identity or "local coder" in identity:
        return "local_coder"
    if "codegraph" in identity:
        return "codegraph"
    if "plan_agent" in identity or "plan agent" in identity:
        return "plan"
    if "thinkgraph" in identity:
        return "thinkgraph"
    return "other"


def build_compact_coder_prompt(
    *,
    target_root: str,
    goal: str,
    prompt: str = "",
    edit_mode: str = "read_only",
) -> str:
    """Build the bounded SPEC-style task sent to the existing console route."""
    task_detail = _compact_text(prompt) or _compact_text(goal)
    return "\n".join(
        [
            "COMPACT CODER TASK",
            f"Target root: {target_root}",
            f"User goal: {_compact_text(goal)}",
            (
                "Current state summary: Mag One classified this as coding; the current canvas "
                "has bus-connected Local Coder and CodeGraph participants."
            ),
            "Constraints:",
            "- Stay within the target root.",
            "- Do not edit vendored localcoder/.",
            "- Do not use gRPC.",
            "- Do not do naming or rebrand work.",
            f"- Edit mode: {edit_mode}.",
            "Read first:",
            "- AGENTS.md",
            "- PLAN.md",
            "Task:",
            task_detail,
            "Expected proof: direct reads and a concise repo-inspection result; report exact blockers.",
            (
                "Expected result format: status, files inspected, findings, proof, blockers, "
                "and next recommended task."
            ),
        ]
    )


def _blocked_coder_result(target_root: str, blocker: str) -> dict[str, Any]:
    return _publish_coder_dispatch({
        "status": "blocked",
        "session_id": None,
        "target_root": target_root,
        "provider": None,
        "model": None,
        "transport": None,
        "watch_surface": "Code Console",
        "message": f"Mag One could not start the coder task. Blocker: {blocker}",
        "delivery_status": "blocked",
        "blocker": blocker,
    })


def _post_console_task(payload: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    base_url = str(
        os.getenv("CODER_CONSOLE_BACKEND_URL", _DEFAULT_CODER_CONSOLE_BACKEND_URL)
    ).strip().rstrip("/")
    if not base_url:
        raise RuntimeError("coder_console_backend_url_missing")
    request = Request(
        f"{base_url}/api/coder/openclaude/console/task",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=45) as response:
            raw = response.read().decode("utf-8")
            return int(response.status), json.loads(raw or "{}")
    except HTTPError as error:
        raw = error.read().decode("utf-8")
        try:
            body = json.loads(raw or "{}")
        except json.JSONDecodeError:
            body = {"error": raw or str(error)}
        return int(error.code), body
    except URLError as error:
        raise RuntimeError(f"coder_console_backend_unavailable: {error.reason}") from error


async def coder_console_task(
    project_id: str,
    target_root: str,
    goal: str,
    prompt: str = "",
    edit_mode: str = "read_only",
    session_id: str | None = None,
) -> dict[str, Any]:
    """Send one canvas-gated, compact coding task to the owned Code Console route."""
    normalized_root = str(Path(str(target_root or "")).resolve()) if target_root else ""
    context = _CURRENT_CODER_CONTEXT.get()
    if context is None or context.cardRuntime is None:
        return _blocked_coder_result(
            normalized_root,
            "MAGONE_CODER_CONSOLE_BLOCKED_PARTICIPANT_GATE: current_canvas_context_missing",
        )
    if str(project_id or "").strip() != context.session.projectId:
        return _blocked_coder_result(normalized_root, "coder_console_project_id_mismatch")
    if not _CODING_WORKFLOW_PATTERN.search(context.userText or ""):
        return _blocked_coder_result(normalized_root, "coder_console_not_allowed_for_ordinary_chat")
    if not _EXPLICIT_CODER_EXECUTION_PATTERN.search(context.userText or ""):
        return _blocked_coder_result(
            normalized_root,
            "coder_console_explicit_user_approval_required",
        )
    if str(edit_mode or "read_only").strip().lower() != "read_only":
        return _blocked_coder_result(
            normalized_root,
            "console_edit_mode_not_supported_in_this_spec",
        )
    if not normalized_root or not Path(normalized_root).is_dir():
        return _blocked_coder_result(normalized_root, "coder_console_target_root_missing")

    roles = {_participant_role(participant) for participant in context.cardRuntime.participants}
    missing = [
        label
        for role, label in (("codegraph", "CodeGraph Agent"), ("local_coder", "Local Coder"))
        if role not in roles
    ]
    if missing:
        return _blocked_coder_result(
            normalized_root,
            f"MAGONE_CODER_CONSOLE_BLOCKED_PARTICIPANT_GATE: missing={','.join(missing)}",
        )

    graph = context.cardRuntime.graph
    if graph is None:
        return _blocked_coder_result(
            normalized_root,
            "MAGONE_CODER_CONSOLE_BLOCKED_PARTICIPANT_GATE: runtime_graph_missing",
        )
    participants = {
        participant.cardId: participant for participant in context.cardRuntime.participants
    }
    cards = []
    for node in graph.nodes:
        participant = participants.get(node.cardId)
        cards.append(
            {
                "id": node.cardId,
                "title": node.title,
                "kind": node.kind,
                "runtimeType": node.runtimeType,
                "runtimeBinding": getattr(participant, "runtimeBinding", None),
                "runtimeOptions": {"role": node.role or getattr(participant, "role", None)},
            }
        )
    task_prompt = build_compact_coder_prompt(
        target_root=normalized_root,
        goal=goal,
        prompt=prompt,
        edit_mode="read_only",
    )
    payload = {
        "projectId": context.session.projectId,
        "repoPath": normalized_root,
        "task": task_prompt,
        "userGoal": _compact_text(goal),
        "generatedSpec": task_prompt,
        "explicitApproval": True,
        "cards": cards,
        "edges": [edge.model_dump() for edge in graph.edges],
        "editMode": "read_only",
        "sessionId": session_id,
    }
    try:
        _, response = await asyncio.to_thread(_post_console_task, payload)
    except RuntimeError as error:
        return _blocked_coder_result(normalized_root, str(error))

    session = response.get("session") if isinstance(response.get("session"), dict) else {}
    routed = bool(response.get("routed"))
    blocker = None if routed else str(response.get("blocked") or response.get("error") or "coder_console_tool_call_blocked")
    result_session_id = str(session.get("id") or "") or None
    coding_run_id = str((response.get("codingRun") or {}).get("id") or "") or None
    result_status_url = (
        f"/api/coder/openclaude/console/runs/{coding_run_id}"
        if coding_run_id
        else None
    )
    provider = str(session.get("provider") or "") or None
    model = str(session.get("model") or "") or None
    transport = str(session.get("transportMode") or "") or None
    if routed:
        message = (
            f"Mag One started a coder task in Code Console session {result_session_id}. "
            f"Target: {normalized_root}. Provider: {provider or 'unknown'}. "
            f"Model: {model or 'unknown'}. Coding run: {coding_run_id or 'unavailable'}. "
            f"Result status: {result_status_url or 'unavailable'}. "
            "Watch the terminal in Code Console."
        )
    else:
        message = f"Mag One could not start the coder task. Blocker: {blocker}"
    return _publish_coder_dispatch({
        "status": "started" if routed else "blocked",
        "session_id": result_session_id,
        "target_root": str(session.get("targetRoot") or normalized_root),
        "provider": provider,
        "model": model,
        "transport": transport,
        "watch_surface": "Code Console",
        "message": message,
        "delivery_status": "accepted" if routed else "blocked",
        "blocker": blocker,
        "coding_run_id": coding_run_id,
        "result_status_url": result_status_url,
    })


# ---------------------------------------------------------------------------
# ToolRegistry.
# ---------------------------------------------------------------------------


class ToolRegistry:
    """Resolves selected card tools to real FunctionTools, loudly or not at all."""

    def __init__(self) -> None:
        self._specs: dict[str, ToolSpec] = {}
        self._adapters: dict[str, Callable[..., Any]] = {}

    def register(self, spec: ToolSpec, adapter: Callable[..., Any]) -> None:
        if not isinstance(spec, ToolSpec):
            raise RuntimeError(f"card_tool_spec_invalid: {type(spec).__name__}")
        if spec.name in self._specs:
            raise RuntimeError(f"card_tool_already_registered: {spec.name}")
        if not callable(adapter):
            raise RuntimeError(f"card_tool_adapter_missing: {spec.name}")
        self._specs[spec.name] = spec
        self._adapters[spec.name] = adapter

    def known_names(self) -> list[str]:
        return sorted(self._specs)

    def resolve_one(self, name: str) -> FunctionTool:
        cleaned = str(name or "").strip()
        if not cleaned:
            raise RuntimeError("card_tool_name_empty")
        spec = self._specs.get(cleaned)
        if spec is None:
            raise RuntimeError(
                f"card_tool_unknown: {cleaned} (known: {','.join(self.known_names())})"
            )
        if not spec.enabled:
            raise RuntimeError(f"card_tool_disabled: {cleaned}")
        # ToolSpec validation already guarantees complete schemas; re-check so a
        # mutated spec can never resolve silently.
        if not spec.inputSchema or not spec.outputSchema:
            raise RuntimeError(f"card_tool_schema_missing: {cleaned}")
        return FunctionTool(self._adapters[cleaned], description=spec.description, name=spec.name)

    def resolve_selected(self, selected_names: list[str]) -> list[FunctionTool]:
        """Resolve exactly the card Tools tab selection.

        Registered but unselected tools are never returned; any invalid
        selection aborts the whole resolution rather than degrading silently.
        """
        return [self.resolve_one(name) for name in (selected_names or [])]


def build_default_tool_registry() -> ToolRegistry:
    """The canonical runtime registry."""
    registry = ToolRegistry()
    registry.register(
        ToolSpec(
            name="current_datetime",
            description="Return the current UTC date and time in ISO-8601 format.",
            enabled=True,
            inputSchema={"type": "object", "properties": {}, "required": []},
            outputSchema={"type": "string", "description": "ISO-8601 UTC datetime"},
        ),
        tool_current_datetime,
    )
    registry.register(
        ToolSpec(
            name="calculator",
            description="Evaluate a basic arithmetic expression and return the numeric result.",
            enabled=True,
            inputSchema={
                "type": "object",
                "properties": {"expression": {"type": "string"}},
                "required": ["expression"],
            },
            outputSchema={"type": "string", "description": "numeric result as a string"},
        ),
        tool_calculator,
    )
    registry.register(
        ToolSpec(
            name="coder_console_task",
            description="Send one bounded coding task to the owned Code Console backend.",
            enabled=True,
            inputSchema={
                "type": "object",
                "properties": {
                    "project_id": {"type": "string"},
                    "target_root": {"type": "string"},
                    "goal": {"type": "string"},
                    "prompt": {"type": "string"},
                    "edit_mode": {"type": "string", "default": "read_only"},
                    "session_id": {"type": ["string", "null"]},
                },
                "required": ["project_id", "target_root", "goal"],
            },
            outputSchema={
                "type": "object",
                "properties": {
                    "status": {
                        "type": "string",
                        "enum": ["started", "queued", "running", "completed", "failed", "blocked"],
                    },
                    "session_id": {"type": ["string", "null"]},
                    "target_root": {"type": "string"},
                    "provider": {"type": ["string", "null"]},
                    "model": {"type": ["string", "null"]},
                    "transport": {"type": ["string", "null"]},
                    "watch_surface": {"type": "string"},
                    "message": {"type": "string"},
                    "delivery_status": {
                        "type": "string",
                        "enum": ["accepted", "queued", "blocked"],
                    },
                    "blocker": {"type": ["string", "null"]},
                    "coding_run_id": {"type": ["string", "null"]},
                    "result_status_url": {"type": ["string", "null"]},
                },
            },
        ),
        coder_console_task,
    )
    return registry


DEFAULT_TOOL_REGISTRY = build_default_tool_registry()
