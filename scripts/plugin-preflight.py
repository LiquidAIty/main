from __future__ import annotations

import asyncio
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


REPO_ROOT = Path(__file__).resolve().parents[1]
PYTHON_APP = REPO_ROOT / "apps" / "python-models" / "app"
CANONICAL_PYTHON = REPO_ROOT / "apps" / "python-models" / ".venv" / "Scripts" / "python.exe"
MCP_HOST = PYTHON_APP / "mcp_host.py"
REMOVED_WRAPPERS = {
    "coder.account",
    "coder.effective_tools",
    "coder.inspect",
    "coder.steer",
    "coder.stop",
}
DIRECT_CUSTOM_TOOLS = {
    "main.context",
    "web_search",
    "write_mag_one_instructions",
}

sys.path.insert(0, str(PYTHON_APP))
import mcp_host  # noqa: E402
import engraphis  # noqa: E402


def _http_json(url: str, *, timeout: float = 10.0) -> tuple[int, dict[str, Any], dict[str, str]]:
    request = Request(url, headers={"ngrok-skip-browser-warning": "true"})
    try:
        with urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
            return response.status, payload, {key.lower(): value for key, value in response.headers.items()}
    except HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            payload = {"body": body[:500]}
        return error.code, payload, {key.lower(): value for key, value in error.headers.items()}


def _http_status(url: str, *, timeout: float = 5.0) -> int:
    request = Request(url, headers={"ngrok-skip-browser-warning": "true"})
    try:
        with urlopen(request, timeout=timeout) as response:
            return response.status
    except HTTPError as error:
        return error.code


def _port_open(port: int) -> bool:
    with socket.socket() as client:
        client.settimeout(2.0)
        return client.connect_ex(("127.0.0.1", port)) == 0


def _runtime_owner() -> dict[str, Any] | None:
    command = r"""
$connection = Get-NetTCPConnection -State Listen -LocalPort 8765 -ErrorAction SilentlyContinue |
  Select-Object -First 1
if ($null -eq $connection) { exit 0 }
$process = Get-CimInstance Win32_Process -Filter "ProcessId = $($connection.OwningProcess)"
[pscustomobject]@{
  pid = $connection.OwningProcess
  commandLine = $process.CommandLine
  executablePath = $process.ExecutablePath
  createdAt = $process.CreationDate.ToUniversalTime().ToString('o')
} | ConvertTo-Json -Compress
"""
    completed = subprocess.run(
        ["powershell", "-NoProfile", "-Command", command],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        timeout=15,
        check=False,
    )
    if completed.returncode != 0 or not completed.stdout.strip():
        return None
    return json.loads(completed.stdout)


def _git_revision() -> str:
    completed = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        timeout=10,
        check=True,
    )
    return completed.stdout.strip()


def _source_digest() -> str:
    return hashlib.sha256(MCP_HOST.read_bytes()).hexdigest()


async def _catalog() -> dict[str, Any]:
    await mcp_host._initialize_native_engraphis()
    await mcp_host._initialize_native_graphiti()
    await mcp_host._native_cbm_tools()
    try:
        internal = await mcp_host.list_tools()
        published = mcp_host._bind_authenticated_catalog(internal)
        count, digest = mcp_host._catalog_identity(published)
        names = [tool.name for tool in published]
        matrix: list[dict[str, Any]] = []
        for tool in published:
            if tool.name.startswith("engraphis."):
                dispatchable = tool.name.removeprefix("engraphis.") in {
                    name.removeprefix("engraphis_") for name in mcp_host._NATIVE_ENGRAPHIS_NAMES
                }
            elif tool.name.startswith("cbm."):
                dispatchable = tool.name.removeprefix("cbm.") in mcp_host._NATIVE_CBM_NAMES
            elif tool.name.startswith("graphiti."):
                dispatchable = tool.name.removeprefix("graphiti.") in mcp_host._NATIVE_GRAPHITI_NAMES
            else:
                dispatchable = tool.name in mcp_host._ALLOWED_KEYS and (
                    tool.name in mcp_host._BRIDGE_PATHS
                    or tool.name in mcp_host._CONTROL_HANDLER_NAMES
                    or tool.name in DIRECT_CUSTOM_TOOLS
                )
            execution = dict((tool.meta or {}).get("liquidaityExecution") or {})
            matrix.append(
                {
                    "name": tool.name,
                    "risk": execution.get("risk"),
                    "compute": execution.get("compute"),
                    "oauth": tool.model_dump(exclude_none=True).get("securitySchemes")
                    == [{"type": "oauth2", "scopes": ["liquidaity.main"]}],
                    "dispatchable": dispatchable,
                }
            )
        return {
            "count": count,
            "hash": digest,
            "unique": len(names) == len(set(names)),
            "coderStatusPresent": "coder.status" in names,
            "removedWrappersPresent": sorted(REMOVED_WRAPPERS.intersection(names)),
            "allOAuthDeclared": all(item["oauth"] for item in matrix),
            "undispatchable": [item["name"] for item in matrix if not item["dispatchable"]],
            "auditMatrix": matrix,
        }
    finally:
        await mcp_host._close_native_graphiti()
        await asyncio.to_thread(mcp_host._close_native_cbm)


async def main() -> int:
    checks: dict[str, Any] = {}
    failures: list[str] = []

    revision = _git_revision()
    owner = _runtime_owner()
    command_line = str((owner or {}).get("commandLine") or "")
    source_loaded = bool(
        owner
        and str(MCP_HOST).lower() in command_line.lower()
        and Path(MCP_HOST).stat().st_mtime <= _iso_timestamp((owner or {})["createdAt"])
    )
    checks["runtime"] = {
        "gitRevision": revision,
        "sourceSha256": _source_digest(),
        "canonicalPython": str(CANONICAL_PYTHON),
        "mcpHost": str(MCP_HOST),
        "owner": owner,
        "currentSourceLoaded": source_loaded,
        "engraphisFile": str(Path(engraphis.__file__).resolve()),
    }
    if not source_loaded:
        failures.append("python_mcp_not_running_current_source")

    health_urls = {
        "frontend": "http://127.0.0.1:5173/",
        "backend": "http://127.0.0.1:4000/api/health/",
        "autogen": "http://127.0.0.1:8003/health",
        "knowgraph": "http://127.0.0.1:8001/health",
    }
    checks["health"] = {name: _http_status(url) for name, url in health_urls.items()}
    checks["health"]["openClaudeGrpc"] = "listening" if _port_open(50051) else "unavailable"
    checks["health"]["pythonMcp"] = "listening" if _port_open(8765) else "unavailable"
    if any(status != 200 for name, status in checks["health"].items() if name not in {"openClaudeGrpc", "pythonMcp"}):
        failures.append("required_http_service_unhealthy")
    if checks["health"]["openClaudeGrpc"] != "listening":
        failures.append("openclaude_grpc_unavailable")
    if checks["health"]["pythonMcp"] != "listening":
        failures.append("python_mcp_unavailable")

    resource = mcp_host.PUBLIC_MCP_RESOURCE_URL.rstrip("/")
    parsed = urlsplit(resource)
    metadata_url = f"{parsed.scheme}://{parsed.netloc}/.well-known/oauth-protected-resource{parsed.path}"
    metadata_status, metadata, _ = _http_json(metadata_url)
    checks["oauth"] = {
        "resource": resource,
        "metadataUrl": metadata_url,
        "metadataStatus": metadata_status,
        "metadata": metadata,
        "registrationMethod": "predefined_client",
        "callback": "allowlist the exact https://chatgpt.com/connector/oauth/{callback_id} shown by the plugin builder",
    }
    if metadata_status != 200 or metadata.get("resource") != resource:
        failures.append("protected_resource_metadata_invalid")
    issuer = str((metadata.get("authorization_servers") or [""])[0]).rstrip("/") + "/"
    discovery_status, discovery, _ = _http_json(issuer + ".well-known/openid-configuration")
    checks["oauth"]["issuer"] = issuer
    checks["oauth"]["discoveryStatus"] = discovery_status
    checks["oauth"]["pkceS256"] = "S256" in (discovery.get("code_challenge_methods_supported") or [])
    checks["oauth"]["tokenEndpointAuthMethods"] = discovery.get("token_endpoint_auth_methods_supported") or []
    if discovery_status != 200 or discovery.get("issuer") != issuer or not checks["oauth"]["pkceS256"]:
        failures.append("authorization_server_discovery_invalid")

    request = Request(
        resource,
        method="POST",
        data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}}).encode("utf-8"),
        headers={"Content-Type": "application/json", "ngrok-skip-browser-warning": "true"},
    )
    try:
        with urlopen(request, timeout=10) as response:
            anonymous_status = response.status
            challenge = response.headers.get("WWW-Authenticate", "")
    except HTTPError as error:
        anonymous_status = error.code
        challenge = error.headers.get("WWW-Authenticate", "")
    checks["oauth"]["anonymousMcpStatus"] = anonymous_status
    checks["oauth"]["challenge"] = challenge
    if anonymous_status != 401 or f'resource_metadata="{metadata_url}"' not in challenge:
        failures.append("anonymous_mcp_challenge_invalid")

    catalog = await _catalog()
    checks["catalog"] = catalog
    if not catalog["unique"] or not catalog["coderStatusPresent"]:
        failures.append("catalog_identity_invalid")
    if catalog["removedWrappersPresent"] or catalog["undispatchable"] or not catalog["allOAuthDeclared"]:
        failures.append("catalog_dispatch_or_security_invalid")

    access_token = os.environ.get("LIQUIDAITY_PREFLIGHT_ACCESS_TOKEN", "").strip()
    checks["authenticatedMcp"] = "not_run_no_configured_test_token"
    if access_token:
        checks["authenticatedMcp"] = "external_safe_read_still_required"

    verdict = (
        "NOT_READY_FOR_PLUGIN_REFRESH"
        if failures
        else "PARTIAL — SOURCE READY FOR PLUGIN REFRESH"
    )
    print(json.dumps({"verdict": verdict, "failures": failures, "checks": checks}, indent=2))
    return 1 if failures else 0


def _iso_timestamp(value: str) -> float:
    from datetime import datetime

    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


if __name__ == "__main__":
    try:
        raise SystemExit(asyncio.run(main()))
    except (OSError, URLError, subprocess.SubprocessError, ValueError, KeyError) as error:
        print(
            json.dumps(
                {
                    "verdict": "NOT_READY_FOR_PLUGIN_REFRESH",
                    "failures": [f"preflight_error:{error.__class__.__name__}:{error}"],
                },
                indent=2,
            )
        )
        raise SystemExit(1)
