"""One process-owned adapter to the pinned native Constellation Engine.

FastAPI/Python rails owns one long-lived Node child and one SQLite file for each
validated LiquidAIty project. MCP and UI traffic both enter through these
functions, so no second writer or alternate graph implementation exists.
"""

from __future__ import annotations

import atexit
from collections import deque
import json
import os
from pathlib import Path
import queue
import re
import shutil
import socket
import subprocess
import threading
import time
from typing import Any
import uuid


_REPO_ROOT = Path(__file__).resolve().parents[4]
_BRIDGE = _REPO_ROOT / "apps" / "constellation-engine" / "bridge.cjs"
_DATABASE_ROOT = _REPO_ROOT / "db" / "constellation"
_PROJECT_ID = re.compile(r"^[A-Za-z0-9_-]+$")
_REQUEST_TIMEOUT_SECONDS = 30.0


class ConstellationError(RuntimeError):
    """Typed native-engine boundary failure."""


def _node_binary() -> str:
    configured = str(os.environ.get("CONSTELLATION_NODE_BINARY") or "").strip()
    if configured:
        return configured
    if os.name == "nt":
        local_app_data = str(os.environ.get("LOCALAPPDATA") or "").strip()
        if local_app_data:
            hermes_node = Path(local_app_data) / "hermes" / "node" / "node.exe"
            if hermes_node.is_file():
                return str(hermes_node)
    discovered = shutil.which("node")
    if not discovered:
        raise ConstellationError("constellation_node_binary_missing")
    return discovered


def _project_id(value: str) -> str:
    resolved = str(value or "").strip()
    if not resolved or not _PROJECT_ID.fullmatch(resolved):
        raise ConstellationError("constellation_project_id_invalid")
    return resolved


class ConstellationProcess:
    """Serialized protocol client for one native Constellation engine."""

    def __init__(self, project_id: str, *, database_path: Path | None = None):
        self.project_id = _project_id(project_id)
        self.database_path = (
            database_path or _DATABASE_ROOT / f"{self.project_id}.sqlite"
        ).resolve()
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        if not _BRIDGE.is_file():
            raise ConstellationError("constellation_bridge_missing")
        # The authoritative bridge owns its pinned Mimir child. Reserve one
        # loopback port up front so the engine and daemon share the exact same
        # endpoint; Mimir itself is started lazily by an explicit semantic or
        # background-control operation.
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as reservation:
            reservation.bind(("127.0.0.1", 0))
            self.mimir_port = int(reservation.getsockname()[1])
        child_env = os.environ.copy()
        child_env.update(
            {
                "MIMIR_PORT": str(self.mimir_port),
                "MIMIR_PORT_RANGE": "1",
                "MIMIR_HOST": "127.0.0.1",
                "CONSTELLATION_DB": str(self.database_path),
                "MIMIR_RUNTIME_FILE": str(
                    self.database_path.parent
                    / f".{self.database_path.stem}.mimir-runtime.json"
                ),
                "INSTALL_ID": str(uuid.uuid4()),
            }
        )
        creation_flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        self._process = subprocess.Popen(
            [
                _node_binary(),
                str(_BRIDGE),
                str(self.database_path),
            ],
            cwd=str(_REPO_ROOT),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            creationflags=creation_flags,
            env=child_env,
        )
        self._responses: queue.Queue[dict[str, Any]] = queue.Queue()
        self._stderr: deque[str] = deque(maxlen=16)
        self._lock = threading.Lock()
        self._next_id = 0
        threading.Thread(
            target=self._read_stdout,
            name=f"constellation-{self.project_id}-stdout",
            daemon=True,
        ).start()
        threading.Thread(
            target=self._read_stderr,
            name=f"constellation-{self.project_id}-stderr",
            daemon=True,
        ).start()
        try:
            self.request("stats", {}, timeout_seconds=_REQUEST_TIMEOUT_SECONDS)
        except Exception:
            self.close()
            raise

    def _read_stdout(self) -> None:
        stream = self._process.stdout
        if stream is None:
            self._responses.put({"__eof__": True})
            return
        try:
            for line in stream:
                text = line.strip()
                if not text:
                    continue
                try:
                    message = json.loads(text)
                except json.JSONDecodeError:
                    self._responses.put(
                        {"__protocol_error__": "constellation_invalid_json_response"}
                    )
                    continue
                if isinstance(message, dict):
                    self._responses.put(message)
        finally:
            self._responses.put({"__eof__": True})

    def _read_stderr(self) -> None:
        stream = self._process.stderr
        if stream is None:
            return
        for line in stream:
            text = line.strip()
            if text:
                self._stderr.append(text[:500])

    def _write(self, payload: dict[str, Any]) -> None:
        stream = self._process.stdin
        if stream is None or self._process.poll() is not None:
            raise ConstellationError("constellation_process_not_running")
        stream.write(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n"
        )
        stream.flush()

    def request(
        self,
        operation: str,
        arguments: dict[str, Any],
        *,
        timeout_seconds: float = _REQUEST_TIMEOUT_SECONDS,
    ) -> dict[str, Any]:
        with self._lock:
            self._next_id += 1
            request_id = self._next_id
            self._write(
                {
                    "id": request_id,
                    "operation": str(operation),
                    "arguments": dict(arguments or {}),
                }
            )
            deadline = time.monotonic() + timeout_seconds
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise ConstellationError(
                        f"constellation_timeout:{operation}"
                    )
                try:
                    message = self._responses.get(timeout=remaining)
                except queue.Empty as error:
                    raise ConstellationError(
                        f"constellation_timeout:{operation}"
                    ) from error
                if message.get("__eof__"):
                    detail = " | ".join(self._stderr)
                    raise ConstellationError(
                        f"constellation_process_exited:{self._process.poll()}:{detail}"
                    )
                if message.get("__protocol_error__"):
                    raise ConstellationError(str(message["__protocol_error__"]))
                if message.get("id") != request_id:
                    continue
                if message.get("ok") is not True:
                    raise ConstellationError(
                        str(message.get("error") or "constellation_request_failed")
                    )
                result = message.get("result")
                if not isinstance(result, dict):
                    raise ConstellationError("constellation_result_invalid")
                return result

    def close(self) -> None:
        if self._process.poll() is not None:
            return
        self._process.terminate()
        try:
            self._process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self._process.kill()
            self._process.wait(timeout=5)


_CLIENTS: dict[str, ConstellationProcess] = {}
_CLIENTS_LOCK = threading.Lock()


def get_constellation(project_id: str) -> ConstellationProcess:
    resolved = _project_id(project_id)
    with _CLIENTS_LOCK:
        client = _CLIENTS.get(resolved)
        if client is None or client._process.poll() is not None:
            if client is not None:
                client.close()
            client = ConstellationProcess(resolved)
            _CLIENTS[resolved] = client
        return client


def close_constellation() -> None:
    with _CLIENTS_LOCK:
        clients = list(_CLIENTS.values())
        _CLIENTS.clear()
    for client in clients:
        client.close()


atexit.register(close_constellation)


def _decoded_tags(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item) for item in value]
    if isinstance(value, str):
        try:
            decoded = json.loads(value)
        except json.JSONDecodeError:
            return []
        if isinstance(decoded, list):
            return [str(item) for item in decoded]
    return []


def _projection(project_id: str, native: dict[str, Any]) -> dict[str, Any]:
    nodes: list[dict[str, Any]] = []
    for raw in native.get("nodes") or []:
        if not isinstance(raw, dict) or not str(raw.get("id") or "").strip():
            continue
        native_id = str(raw["id"])
        content = str(raw.get("content") or native_id)
        nodes.append(
            {
                "id": native_id,
                "canonicalId": native_id,
                "label": content[:240] or native_id,
                "title": content[:240] or native_id,
                "type": "ConstellationMemory",
                "authority": "constellation-engine",
                "projectId": project_id,
                "mentionCount": 1,
                "properties": {
                    "level": raw.get("level"),
                    "distance": raw.get("distance"),
                    "tags": _decoded_tags(raw.get("tags")),
                    "semanticState": native.get("semanticState"),
                    "deterministicTopologyReady": native.get(
                        "deterministicTopologyReady"
                    ) is True,
                },
                "provenance": {
                    "engine": native.get("engine"),
                    "engineVersion": native.get("engineVersion"),
                    "engineRevision": native.get("engineRevision"),
                },
            }
        )
    edges: list[dict[str, Any]] = []
    for index, raw in enumerate(native.get("edges") or []):
        if not isinstance(raw, dict):
            continue
        source = str(raw.get("from") or "").strip()
        target = str(raw.get("to") or "").strip()
        if not source or not target:
            continue
        predicate = str(raw.get("type") or "associative")
        edges.append(
            {
                "id": f"{source}:{predicate}:{target}:{index}",
                "source": source,
                "target": target,
                "predicate": predicate,
                "mentionCount": 1,
                "properties": {"strength": raw.get("strength")},
                "provenance": {
                    "engine": native.get("engine"),
                    "engineRevision": native.get("engineRevision"),
                },
            }
        )
    counts = native.get("counts") if isinstance(native.get("counts"), dict) else {}
    return {
        "schemaVersion": "thinkgraph.constellation.v1",
        "authority": "constellation-engine",
        "projectId": project_id,
        "revision": str(native.get("engineRevision") or ""),
        "embedding": {
            "state": native.get("semanticState"),
            "reason": native.get("semanticReason"),
        },
        "runtime": {
            "engine": native.get("engine"),
            "version": native.get("engineVersion"),
            "revision": native.get("engineRevision"),
            "deterministicTopologyReady": native.get(
                "deterministicTopologyReady"
            ) is True,
            "consolidationState": native.get("consolidationState"),
        },
        "counts": {
            "nodes": int(counts.get("active") or counts.get("total") or 0),
            "edges": int(counts.get("edges") or 0),
        },
        "nodes": nodes,
        "edges": edges,
    }


def constellation_context(project_id: str, arguments: dict[str, Any]) -> dict[str, Any]:
    return get_constellation(project_id).request("context", arguments)


def constellation_inspect(project_id: str, arguments: dict[str, Any]) -> dict[str, Any]:
    return get_constellation(project_id).request("inspect", arguments)


def constellation_capabilities(project_id: str, arguments: dict[str, Any]) -> dict[str, Any]:
    return get_constellation(project_id).request("capabilities", arguments)


def constellation_stats(project_id: str, arguments: dict[str, Any]) -> dict[str, Any]:
    return get_constellation(project_id).request("stats", arguments)


def constellation_semantic_status(project_id: str, arguments: dict[str, Any]) -> dict[str, Any]:
    return get_constellation(project_id).request("semantic_status", arguments)


def constellation_semantic_start(project_id: str, arguments: dict[str, Any]) -> dict[str, Any]:
    return get_constellation(project_id).request(
        "semantic_start", arguments, timeout_seconds=190.0
    )


def constellation_semantic_stop(project_id: str, arguments: dict[str, Any]) -> dict[str, Any]:
    return get_constellation(project_id).request("semantic_stop", arguments)


def constellation_semantic_context(project_id: str, arguments: dict[str, Any]) -> dict[str, Any]:
    return get_constellation(project_id).request(
        "semantic_context", arguments, timeout_seconds=190.0
    )


def constellation_inspect_edge(project_id: str, arguments: dict[str, Any]) -> dict[str, Any]:
    return get_constellation(project_id).request("inspect_edge", arguments)


def constellation_check_duplicate(project_id: str, arguments: dict[str, Any]) -> dict[str, Any]:
    return get_constellation(project_id).request("check_duplicate", arguments)


def constellation_edge_types(project_id: str, arguments: dict[str, Any]) -> dict[str, Any]:
    return get_constellation(project_id).request("edge_types", arguments)


def constellation_collide(project_id: str, arguments: dict[str, Any]) -> dict[str, Any]:
    return get_constellation(project_id).request("collide", arguments)


def constellation_remember(project_id: str, arguments: dict[str, Any]) -> dict[str, Any]:
    return get_constellation(project_id).request(
        "remember",
        {
            **dict(arguments or {}),
            "projectTag": f"liquidaity-project:{_project_id(project_id)}",
        },
    )


def constellation_remember_semantic(project_id: str, arguments: dict[str, Any]) -> dict[str, Any]:
    return get_constellation(project_id).request(
        "remember_semantic",
        {
            **dict(arguments or {}),
            "projectTag": f"liquidaity-project:{_project_id(project_id)}",
        },
        timeout_seconds=190.0,
    )


def constellation_reembed_start(project_id: str, arguments: dict[str, Any]) -> dict[str, Any]:
    return get_constellation(project_id).request(
        "reembed_start", arguments, timeout_seconds=190.0
    )


def constellation_reembed_status(project_id: str, arguments: dict[str, Any]) -> dict[str, Any]:
    return get_constellation(project_id).request("reembed_status", arguments)


def constellation_reembed_cancel(project_id: str, arguments: dict[str, Any]) -> dict[str, Any]:
    return get_constellation(project_id).request("reembed_cancel", arguments)


def constellation_identity_preview(project_id: str, arguments: dict[str, Any]) -> dict[str, Any]:
    return get_constellation(project_id).request("identity_preview", arguments)


def constellation_identity_apply(project_id: str, arguments: dict[str, Any]) -> dict[str, Any]:
    return get_constellation(project_id).request(
        "identity_apply", arguments, timeout_seconds=190.0
    )


def constellation_autonomy_status(project_id: str, arguments: dict[str, Any]) -> dict[str, Any]:
    return get_constellation(project_id).request("autonomy_status", arguments)


def constellation_autonomy_start(project_id: str, arguments: dict[str, Any]) -> dict[str, Any]:
    return get_constellation(project_id).request("autonomy_start", arguments)


def constellation_autonomy_pause(project_id: str, arguments: dict[str, Any]) -> dict[str, Any]:
    return get_constellation(project_id).request("autonomy_pause", arguments)


def constellation_autonomy_resume(project_id: str, arguments: dict[str, Any]) -> dict[str, Any]:
    return get_constellation(project_id).request("autonomy_resume", arguments)


def constellation_autonomy_stop(project_id: str, arguments: dict[str, Any]) -> dict[str, Any]:
    return get_constellation(project_id).request("autonomy_stop", arguments)


def constellation_notification_status(project_id: str, arguments: dict[str, Any]) -> dict[str, Any]:
    return get_constellation(project_id).request("notification_status", arguments)


def constellation_notify(project_id: str, arguments: dict[str, Any]) -> dict[str, Any]:
    return get_constellation(project_id).request("notify", arguments)


def constellation_edge_review(project_id: str, arguments: dict[str, Any]) -> dict[str, Any]:
    return get_constellation(project_id).request("edge_review", arguments)


def constellation_update_memory(project_id: str, arguments: dict[str, Any]) -> dict[str, Any]:
    return get_constellation(project_id).request("update_memory", arguments)


def constellation_link(project_id: str, arguments: dict[str, Any]) -> dict[str, Any]:
    return get_constellation(project_id).request("link", arguments)


def constellation_adjust_edge(project_id: str, arguments: dict[str, Any]) -> dict[str, Any]:
    return get_constellation(project_id).request("adjust_edge", arguments)


def constellation_adjust_edge_pair(project_id: str, arguments: dict[str, Any]) -> dict[str, Any]:
    return get_constellation(project_id).request("adjust_edge_pair", arguments)


def constellation_classify_edge(project_id: str, arguments: dict[str, Any]) -> dict[str, Any]:
    return get_constellation(project_id).request("classify_edge", arguments)


def constellation_classify_edge_pair(project_id: str, arguments: dict[str, Any]) -> dict[str, Any]:
    return get_constellation(project_id).request("classify_edge_pair", arguments)


def constellation_inject_message(project_id: str, arguments: dict[str, Any]) -> dict[str, Any]:
    return get_constellation(project_id).request(
        "inject_message", arguments, timeout_seconds=190.0
    )


def constellation_forget(project_id: str, arguments: dict[str, Any]) -> dict[str, Any]:
    return get_constellation(project_id).request("forget", arguments)


def constellation_maintain(project_id: str, arguments: dict[str, Any]) -> dict[str, Any]:
    return get_constellation(project_id).request("maintain", arguments)


def constellation_projection(project_id: str) -> dict[str, Any]:
    resolved = _project_id(project_id)
    native = get_constellation(resolved).request(
        "projection",
        {"focus": f"liquidaity-project:{resolved}"},
    )
    return _projection(resolved, native)


def constellation_neighborhood(project_id: str, native_id: str) -> dict[str, Any]:
    resolved = _project_id(project_id)
    native = constellation_inspect(
        resolved,
        {"nativeId": str(native_id or "").strip(), "maxDepth": 1, "budget": 12000},
    )
    return _projection(resolved, native)


_OPERATION_HANDLERS = {
    "adjust_edge": constellation_adjust_edge,
    "adjust_edge_pair": constellation_adjust_edge_pair,
    "autonomy_pause": constellation_autonomy_pause,
    "autonomy_resume": constellation_autonomy_resume,
    "autonomy_start": constellation_autonomy_start,
    "autonomy_status": constellation_autonomy_status,
    "autonomy_stop": constellation_autonomy_stop,
    "capabilities": constellation_capabilities,
    "check_duplicate": constellation_check_duplicate,
    "classify_edge": constellation_classify_edge,
    "classify_edge_pair": constellation_classify_edge_pair,
    "collide": constellation_collide,
    "context": constellation_context,
    "edge_types": constellation_edge_types,
    "edge_review": constellation_edge_review,
    "forget": constellation_forget,
    "identity_apply": constellation_identity_apply,
    "identity_preview": constellation_identity_preview,
    "inject_message": constellation_inject_message,
    "inspect": constellation_inspect,
    "inspect_edge": constellation_inspect_edge,
    "link": constellation_link,
    "maintain": constellation_maintain,
    "notification_status": constellation_notification_status,
    "notify": constellation_notify,
    "reembed_cancel": constellation_reembed_cancel,
    "reembed_start": constellation_reembed_start,
    "reembed_status": constellation_reembed_status,
    "remember": constellation_remember,
    "remember_semantic": constellation_remember_semantic,
    "semantic_context": constellation_semantic_context,
    "semantic_start": constellation_semantic_start,
    "semantic_status": constellation_semantic_status,
    "semantic_stop": constellation_semantic_stop,
    "stats": constellation_stats,
    "update_memory": constellation_update_memory,
}


def invoke_constellation_operation(
    project_id: str,
    operation: str,
    arguments: dict[str, Any],
) -> dict[str, Any]:
    """Dispatch one allowlisted operation inside the Python-rails owner."""

    resolved_operation = str(operation or "").strip()
    handler = _OPERATION_HANDLERS.get(resolved_operation)
    if handler is None:
        raise ConstellationError(
            f"constellation_operation_unsupported:{resolved_operation}"
        )
    if not isinstance(arguments, dict):
        raise ConstellationError("constellation_arguments_invalid")
    return handler(_project_id(project_id), dict(arguments))
