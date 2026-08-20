"""The one canonical transient Input Data File materializer.

An IDF is the exact model-call input assembled from a saved Card's stable
system prompt and granted tools plus the current dynamic input. It is created
in memory, inspected as the same fields the adapter consumes, and discarded.
This module does not persist, version, hash, approve, route, or authorize it.
"""

from __future__ import annotations

from typing import Annotated, Any

from pydantic import BaseModel, Field, StringConstraints


RequiredText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class Idf(BaseModel):
    """Exact transient fields supplied to one model/runtime call."""

    systemPrompt: str = ""
    message: RequiredText
    runtime: dict[str, Any]
    provider: dict[str, Any]
    runtimeOptions: dict[str, Any] = Field(default_factory=dict)
    enabledTools: list[str] = Field(default_factory=list)
    toolDefinitions: list[dict[str, Any]] = Field(default_factory=list)
    nativeTools: list[str] = Field(default_factory=list)
    skills: list[str] = Field(default_factory=list)
    toolsets: list[str] = Field(default_factory=list)
    mcpConnectionIds: list[str] = Field(default_factory=list)
    nativeReferences: list[dict[str, Any]] = Field(default_factory=list)
    images: list[dict[str, Any]] = Field(default_factory=list)


def materialize_idf(
    *,
    system_prompt: str,
    dynamic_input: str,
    runtime: dict[str, Any],
    provider: dict[str, Any],
    runtime_options: dict[str, Any] | None = None,
    enabled_tools: list[str],
    tool_definitions: list[dict[str, Any]],
    native_tools: list[str] | None = None,
    skills: list[str] | None = None,
    toolsets: list[str] | None = None,
    mcp_connection_ids: list[str] | None = None,
    context_markdown: str = "",
    output_requirements: str = "",
    native_references: list[dict[str, Any]] | None = None,
    images: list[dict[str, Any]] | None = None,
) -> Idf:
    """Combine stable Card fields with one dynamic input without extra state."""

    sections = [
        value.strip()
        for value in (context_markdown, dynamic_input)
        if isinstance(value, str) and value.strip()
    ]
    if output_requirements.strip():
        sections.append(f"Output requirements:\n{output_requirements.strip()}")
    return Idf(
        systemPrompt=system_prompt,
        message="\n\n".join(sections),
        runtime=dict(runtime),
        provider=dict(provider),
        runtimeOptions=dict(runtime_options or {}),
        enabledTools=list(enabled_tools),
        toolDefinitions=list(tool_definitions),
        nativeTools=list(native_tools or []),
        skills=list(skills or []),
        toolsets=list(toolsets or []),
        mcpConnectionIds=list(mcp_connection_ids or []),
        nativeReferences=list(native_references or []),
        images=list(images or []),
    )
