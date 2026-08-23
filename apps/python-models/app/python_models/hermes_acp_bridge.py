"""LiquidAIty-owned ACP extensions for stock Hermes.

The stock Hermes ACP agent remains the runtime.  This adapter subclasses its
public agent surface only to expose native manager operations and native
Kanban persistence over ACP.  Each write delegates one flat operation to an
existing Hermes handler and then reads the native owner back; it does not
assemble profile files, prompt a model, decompose tasks, dispatch workers, or
synthesize results. Those lifecycle steps remain owned by Hermes.
"""

from __future__ import annotations

import asyncio
import logging
import re
import sys
from dataclasses import asdict
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[4]
HERMES_ROOT = REPO_ROOT / "Hermes"
if str(HERMES_ROOT) not in sys.path:
    sys.path.insert(0, str(HERMES_ROOT))

import acp  # noqa: E402
from acp_adapter.entry import _load_env, _setup_logging  # noqa: E402
from acp_adapter.server import HermesACPAgent  # noqa: E402


logger = logging.getLogger(__name__)


def _native_manager_call(method: str, params: dict[str, Any]) -> dict[str, Any]:
    """Invoke the installed Hermes manager handler without copying its logic."""
    from tui_gateway import server as gateway

    response = gateway.handle_request(
        {"jsonrpc": "2.0", "id": "liquidaity", "method": method, "params": params}
    )
    if not isinstance(response, dict):
        raise ValueError("hermes_native_manager_response_missing")
    error = response.get("error")
    if isinstance(error, dict):
        message = str(error.get("message") or "native manager request failed")
        raise ValueError(f"hermes_native_manager_error:{message}")
    result = response.get("result")
    if not isinstance(result, dict):
        raise ValueError("hermes_native_manager_response_invalid")
    return result


def _safe_mcp_server(value: Any) -> dict[str, Any]:
    """Return UI-safe MCP state and never transport configuration values."""
    server = value if isinstance(value, dict) else {}
    auth = str(server.get("auth") or "").strip() or None
    oauth_present = server.get("oauth_tokens_present")
    if auth == "oauth":
        credential_status = "configured" if oauth_present is True else "not_configured"
    elif auth:
        credential_status = "configured"
    else:
        credential_status = "not_required"
    tools = server.get("tools") if isinstance(server.get("tools"), dict) else {}
    include = tools.get("include") if isinstance(tools, dict) else None
    return {
        "name": str(server.get("name") or ""),
        "transport": str(server.get("transport") or "unknown"),
        "enabled": server.get("enabled") is not False,
        "auth": auth,
        "credentialStatus": credential_status,
        "toolFilter": [str(item) for item in include]
        if isinstance(include, list)
        else [],
    }


def _safe_visible_error(value: Any) -> str:
    text = str(value or "native MCP connection failed")
    text = re.sub(r"(?i)(authorization\s*[:=]\s*bearer\s+)[^\s,;]+", r"\1[REDACTED]", text)
    text = re.sub(r"(?i)(access_token|refresh_token|client_secret|api_key)=([^&\s]+)", r"\1=[REDACTED]", text)
    return text[:2000]


def _required_text(params: dict[str, Any], key: str) -> str:
    value = str(params.get(key) or "").strip()
    if not value:
        raise ValueError(f"hermes_kanban_{key}_required")
    return value


def _required_native_text(params: dict[str, Any], key: str) -> str:
    value = str(params.get(key) or "").strip()
    if not value:
        raise ValueError(f"hermes_native_{key}_required")
    return value


def _native_string_list(params: dict[str, Any], key: str) -> list[str]:
    value = params.get(key)
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise ValueError(f"hermes_native_{key}_must_be_string_list")
    return value


def _native_profile_scope_call(
    profile: str,
    method: str,
    params: dict[str, Any],
) -> dict[str, Any]:
    """Scope a native handler that does not itself accept ``profile``."""
    from hermes_cli.profiles import get_profile_dir
    from hermes_constants import reset_hermes_home_override, set_hermes_home_override

    profile_dir = get_profile_dir(profile)
    if not profile_dir or not profile_dir.is_dir():
        raise ValueError(f"hermes_native_profile_not_found:{profile}")
    token = set_hermes_home_override(str(profile_dir))
    try:
        return _native_manager_call(method, params)
    finally:
        reset_hermes_home_override(token)


def _safe_learning(value: dict[str, Any]) -> dict[str, Any]:
    buckets = []
    for raw_bucket in value.get("buckets", []):
        if not isinstance(raw_bucket, dict):
            continue
        nodes = []
        for raw_node in raw_bucket.get("nodes", []):
            if not isinstance(raw_node, dict):
                continue
            node_id = str(raw_node.get("id") or "").strip()
            if not node_id:
                continue
            nodes.append(
                {
                    "id": node_id,
                    "label": str(raw_node.get("label") or ""),
                    "fullLabel": str(raw_node.get("fullLabel") or ""),
                    "meta": str(raw_node.get("meta") or ""),
                    "body": "",
                }
            )
        buckets.append(
            {
                "label": str(raw_bucket.get("label") or ""),
                "date": str(raw_bucket.get("date") or ""),
                "nodes": nodes,
            }
        )
    return {
        "count": int(value.get("count") or 0),
        "summary": str(value.get("summary") or ""),
        "buckets": buckets,
    }


def _read_native_profile(name: str) -> dict[str, Any]:
    profile = _native_manager_call("profiles.describe", {"name": name})
    mcp_result = _native_manager_call("mcp.servers.list", {"profile": name})
    learning = _native_profile_scope_call(
        name,
        "learning.frames",
        {"cols": 60, "rows": 18, "frames": 2},
    )
    enabled_by_name = {
        str(server.get("name") or ""): server.get("enabled") is not False
        for server in profile.get("mcp_servers", [])
        if isinstance(server, dict)
    }
    servers = []
    for raw in mcp_result.get("servers", []):
        safe = _safe_mcp_server(raw)
        if safe["name"] in enabled_by_name:
            safe["enabled"] = enabled_by_name[safe["name"]]
        servers.append(safe)
    return {
        "profile": {
            "name": str(profile.get("name") or name),
            "description": str(profile.get("description") or ""),
            "soul": str(profile.get("soul") or ""),
            "model": profile.get("model")
            if isinstance(profile.get("model"), dict)
            else {"provider": "", "default": ""},
            "skills": profile.get("skills")
            if isinstance(profile.get("skills"), list)
            else [],
            "toolsets": profile.get("toolsets")
            if isinstance(profile.get("toolsets"), list)
            else [],
            "toolsetsPinned": profile.get("toolsets_pinned") is True,
            "mcpServers": servers,
            "learning": _safe_learning(learning),
        }
    }


def _require_native_applied(value: dict[str, Any], section: str) -> None:
    applied = value.get("applied")
    if value.get("ok") is not True or not isinstance(applied, dict) or applied.get(section) is not True:
        raise ValueError(f"hermes_native_apply_failed:{section}")


def _skills(value: Any) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError("hermes_kanban_skills_must_be_list")
    result: list[str] = []
    for raw in value:
        name = str(raw or "").strip()
        if name and name not in result:
            result.append(name)
    return result


def _exact_roots(conn: Any, *, title: str, body: str, created_by: str) -> list[Any]:
    from hermes_cli import kanban_db as kb

    matches = [
        task
        for task in kb.list_tasks(conn, include_archived=False)
        if task.title == title
        and (task.body or "") == body
        and (task.created_by or "") == created_by
    ]
    return sorted(matches, key=lambda task: (task.created_at, task.id))


def _task_snapshot(task_id: str) -> dict[str, Any]:
    from hermes_cli import kanban_db as kb

    with kb.connect_closing() as conn:
        task = kb.get_task(conn, task_id)
        if task is None:
            raise ValueError("hermes_kanban_task_not_found")
        comments = kb.list_comments(conn, task_id)
        events = kb.list_events(conn, task_id)
        runs = kb.list_runs(conn, task_id)
        return {
            "task": asdict(task),
            "latest_summary": kb.latest_summary(conn, task_id),
            "parents": kb.parent_ids(conn, task_id),
            "children": kb.child_ids(conn, task_id),
            "comments": [asdict(comment) for comment in comments],
            "events": [asdict(event) for event in events],
            "runs": [asdict(run) for run in runs],
        }


class LiquidAItyHermesACPAgent(HermesACPAgent):
    """Stock Hermes ACP agent plus contained native-Kanban transport calls."""

    async def ext_method(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        if method == "profile/read":
            if not isinstance(params, dict):
                raise ValueError("hermes_profile_read_params_must_be_object")
            unknown = sorted(set(params) - {"name"})
            if unknown:
                raise ValueError(f"hermes_profile_read_unknown_field:{unknown[0]}")
            return _read_native_profile(_required_native_text(params, "name"))

        if method == "learning/detail":
            if not isinstance(params, dict):
                raise ValueError("hermes_native_learning_detail_params_must_be_object")
            unknown = sorted(set(params) - {"profile", "nodeId"})
            if unknown:
                raise ValueError(f"hermes_native_learning_detail_unknown_field:{unknown[0]}")
            profile = _required_native_text(params, "profile")
            node_id = _required_native_text(params, "nodeId")
            detail = _native_profile_scope_call(
                profile,
                "learning.detail",
                {"id": node_id},
            )
            if detail.get("ok") is not True:
                raise ValueError(
                    f"hermes_native_learning_detail_failed:{detail.get('message') or node_id}"
                )
            return detail

        if method == "native/apply":
            if not isinstance(params, dict):
                raise ValueError("hermes_native_apply_params_must_be_object")
            operation = _required_native_text(params, "operation")
            profile = _required_native_text(params, "profile")
            if operation in {"profile.description.set", "profile.soul.set"}:
                unknown = sorted(set(params) - {"profile", "operation", "value"})
                if unknown:
                    raise ValueError(f"hermes_native_apply_unknown_field:{unknown[0]}")
                if not isinstance(params.get("value"), str):
                    raise ValueError("hermes_native_value_must_be_string")
                section = "description" if operation == "profile.description.set" else "soul"
                applied = _native_manager_call(
                    "profiles.configure",
                    {"name": profile, section: params["value"]},
                )
                _require_native_applied(applied, section)
            elif operation == "profile.model.set":
                unknown = sorted(set(params) - {"profile", "operation", "provider", "model"})
                if unknown:
                    raise ValueError(f"hermes_native_apply_unknown_field:{unknown[0]}")
                applied = _native_manager_call(
                    "profiles.configure",
                    {
                        "name": profile,
                        "provider": _required_native_text(params, "provider"),
                        "model": _required_native_text(params, "model"),
                    },
                )
                _require_native_applied(applied, "model")
            elif operation in {
                "skills.disabled.replace",
                "toolsets.enabled.replace",
                "mcp.enabled.replace",
            }:
                unknown = sorted(set(params) - {"profile", "operation", "values"})
                if unknown:
                    raise ValueError(f"hermes_native_apply_unknown_field:{unknown[0]}")
                native_field, section = {
                    "skills.disabled.replace": ("disabled_skills", "skills"),
                    "toolsets.enabled.replace": ("enabled_toolsets", "toolsets"),
                    "mcp.enabled.replace": ("enabled_mcp_servers", "mcp_servers"),
                }[operation]
                applied = _native_manager_call(
                    "profiles.configure",
                    {
                        "name": profile,
                        native_field: _native_string_list(params, "values"),
                    },
                )
                _require_native_applied(applied, section)
            elif operation == "learning.edit":
                unknown = sorted(set(params) - {"profile", "operation", "nodeId", "content"})
                if unknown:
                    raise ValueError(f"hermes_native_apply_unknown_field:{unknown[0]}")
                if not isinstance(params.get("content"), str):
                    raise ValueError("hermes_native_learning_content_must_be_string")
                edited = _native_profile_scope_call(
                    profile,
                    "learning.edit",
                    {
                        "id": _required_native_text(params, "nodeId"),
                        "content": params["content"],
                    },
                )
                if edited.get("ok") is not True:
                    raise ValueError(
                        f"hermes_native_learning_edit_failed:{edited.get('message') or 'unknown'}"
                    )
            else:
                raise ValueError("hermes_native_operation_unsupported")
            return _read_native_profile(profile)

        if method == "mcp/test":
            if not isinstance(params, dict):
                raise ValueError("hermes_mcp_test_params_must_be_object")
            unknown = sorted(set(params) - {"profile", "name"})
            if unknown:
                raise ValueError(f"hermes_mcp_test_unknown_field:{unknown[0]}")
            profile = _required_text(params, "profile")
            name = _required_text(params, "name")
            result = _native_manager_call(
                "mcp.servers.test", {"profile": profile, "name": name}
            )
            tools = result.get("tools") if isinstance(result.get("tools"), list) else []
            return {
                "ok": result.get("ok") is True,
                "tools": [
                    {
                        "name": str(tool.get("name") or ""),
                        "description": str(tool.get("description") or "")[:2000],
                    }
                    for tool in tools
                    if isinstance(tool, dict) and str(tool.get("name") or "").strip()
                ],
                "prompts": int(result.get("prompts") or 0),
                "resources": int(result.get("resources") or 0),
                "credentialStatus": "not_configured"
                if result.get("oauth_needed") is True
                and result.get("oauth_tokens_present") is not True
                else "configured",
                "error": None
                if result.get("ok") is True
                else _safe_visible_error(result.get("error")),
            }

        if method == "kanban/find":
            if not isinstance(params, dict):
                raise ValueError("hermes_kanban_find_params_must_be_object")
            unknown = sorted(set(params) - {"title", "body", "createdBy"})
            if unknown:
                raise ValueError(f"hermes_kanban_find_unknown_field:{unknown[0]}")
            title = _required_text(params, "title")
            body = _required_text(params, "body")
            created_by = _required_text(params, "createdBy")
            from hermes_cli import kanban_db as kb

            with kb.connect_closing() as conn:
                matches = _exact_roots(
                    conn, title=title, body=body, created_by=created_by
                )
            return {
                "id": matches[0].id if matches else None,
                "duplicateIds": [task.id for task in matches[1:]],
            }

        if method == "kanban/create":
            if not isinstance(params, dict):
                raise ValueError("hermes_kanban_create_params_must_be_object")
            allowed = {
                "title",
                "body",
                "assignee",
                "createdBy",
                "idempotencyKey",
                "model",
                "provider",
                "skills",
            }
            unknown = sorted(set(params) - allowed)
            if unknown:
                raise ValueError(f"hermes_kanban_create_unknown_field:{unknown[0]}")
            title = _required_text(params, "title")
            body = _required_text(params, "body")
            assignee = _required_text(params, "assignee")
            created_by = _required_text(params, "createdBy")
            idempotency_key = _required_text(params, "idempotencyKey")
            model = str(params.get("model") or "").strip() or None
            provider = str(params.get("provider") or "").strip() or None
            if provider and not model:
                raise ValueError("hermes_kanban_provider_requires_model")
            from hermes_cli import kanban_db as kb

            with kb.connect_closing() as conn:
                matches = _exact_roots(
                    conn, title=title, body=body, created_by=created_by
                )
                if matches:
                    task_id = matches[0].id
                    rejoined = True
                    duplicate_ids = [task.id for task in matches[1:]]
                else:
                    task_id = kb.create_task(
                        conn,
                        title=title,
                        body=body,
                        assignee=assignee,
                        created_by=created_by,
                        triage=True,
                        idempotency_key=idempotency_key,
                        model_override=model,
                        provider_override=provider,
                        skills=_skills(params.get("skills")),
                    )
                    rejoined = False
                    duplicate_ids = []
            snapshot = _task_snapshot(task_id)
            return {
                "id": task_id,
                "rejoined": rejoined,
                "duplicateIds": duplicate_ids,
                "task": snapshot["task"],
            }

        if method == "kanban/show":
            if not isinstance(params, dict):
                raise ValueError("hermes_kanban_show_params_must_be_object")
            unknown = sorted(set(params) - {"taskId"})
            if unknown:
                raise ValueError(f"hermes_kanban_show_unknown_field:{unknown[0]}")
            return _task_snapshot(_required_text(params, "taskId"))

        return await super().ext_method(method, params)


def main() -> None:
    _setup_logging()
    _load_env()
    logger.info("Starting LiquidAIty ACP bridge over stock Hermes")
    try:
        asyncio.run(
            acp.run_agent(LiquidAItyHermesACPAgent(), use_unstable_protocol=True)
        )
    except KeyboardInterrupt:
        logger.info("Shutting down LiquidAIty ACP bridge")


if __name__ == "__main__":
    main()
