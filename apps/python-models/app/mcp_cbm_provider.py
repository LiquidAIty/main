"""The one process-owned official Codebase Memory MCP client."""

from __future__ import annotations

import sys
from typing import Any

from mcp import Client, StdioServerParameters
from mcp.types import CallToolResult, Implementation, Tool


_CBM_CLIENT: Client | None = None
_CBM_TOOLS: tuple[Tool, ...] | None = None
_CBM_STARTUP_FAILURE: str | None = None


async def _open_cbm_client(
    command: str,
    args: list[str],
    cwd: str,
    *,
    implementation_version: str,
    request_timeout_seconds: float,
) -> tuple[Client, tuple[Tool, ...]]:
    """Open the one CBM frontend through the official SDK v2 client."""
    client = Client(
        StdioServerParameters(command=command, args=args, cwd=cwd),
        mode="auto",
        client_info=Implementation(
            name="main-cbm",
            version=implementation_version,
        ),
        read_timeout_seconds=request_timeout_seconds,
    )
    try:
        await client.__aenter__()
        tools: list[Tool] = []
        cursor: str | None = None
        seen_cursors: set[str] = set()
        while True:
            page = await client.list_tools(cursor=cursor, cache_mode="refresh")
            tools.extend(Tool.model_validate(tool) for tool in page.tools)
            cursor = page.next_cursor
            if not cursor:
                break
            if cursor in seen_cursors:
                raise RuntimeError("cbm_tools_cursor_cycle")
            seen_cursors.add(cursor)
        names = [tool.name for tool in tools]
        if len(names) != len(set(names)):
            raise RuntimeError("cbm_duplicate_tool_name")
        return client, tuple(tools)
    except Exception:
        await client.__aexit__(*sys.exc_info())
        raise


async def start_cbm_client(
    command: str,
    args: list[str],
    cwd: str,
    *,
    implementation_version: str,
    request_timeout_seconds: float,
) -> None:
    """Enter the SDK client once from the owning server-lifespan task."""
    global _CBM_CLIENT, _CBM_STARTUP_FAILURE, _CBM_TOOLS
    if _CBM_CLIENT is not None and _CBM_TOOLS is not None:
        return
    try:
        client, tools = await _open_cbm_client(
            command,
            args,
            cwd,
            implementation_version=implementation_version,
            request_timeout_seconds=request_timeout_seconds,
        )
    except Exception as error:
        _CBM_STARTUP_FAILURE = f"{error.__class__.__name__}: {error}"
        raise
    _CBM_CLIENT = client
    _CBM_TOOLS = tools
    _CBM_STARTUP_FAILURE = None


async def cbm_tools() -> list[Tool]:
    if _CBM_CLIENT is None or _CBM_TOOLS is None:
        detail = _CBM_STARTUP_FAILURE or "CBM SDK client is not connected."
        raise RuntimeError(f"cbm_unavailable:{detail}")
    return list(_CBM_TOOLS)


async def call_cbm_tool(
    name: str,
    arguments: dict[str, Any],
    *,
    request_timeout_seconds: float,
) -> CallToolResult:
    """Call one provider tool without owning host routing or argument policy."""
    client = _CBM_CLIENT
    if client is None:
        raise RuntimeError("cbm_client_unavailable")
    return await client.call_tool(
        name,
        dict(arguments),
        read_timeout_seconds=request_timeout_seconds,
    )


async def close_cbm() -> None:
    global _CBM_CLIENT, _CBM_STARTUP_FAILURE, _CBM_TOOLS
    client = _CBM_CLIENT
    _CBM_CLIENT = None
    _CBM_TOOLS = None
    _CBM_STARTUP_FAILURE = None
    if client is not None:
        await client.__aexit__(None, None, None)
