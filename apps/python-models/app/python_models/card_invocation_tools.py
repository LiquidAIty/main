"""Live catalog, grant, Project WorldView, and Script tool selection."""

from __future__ import annotations

from typing import Any

from app.python_models.card_script import (
    CardScriptValidationError,
    script_presentation,
)
from app.python_models.postgres import connect_postgres
from app.python_models.project_worldview import (
    ProjectWorldviewError,
    resolve_project_worldview,
)
from app.python_models.saved_card_contract import CardDomainError, string_list
from app.python_models.tool_catalog import materialize_live_tool_catalog_with_failures


_OPTIONAL_TOOL_CATALOG_FAMILIES = frozenset({"cbm", "graphiti"})


def resolve_effective_card_tools(
    payload: dict[str, Any], *, loaded: dict[str, Any],
    options: dict[str, Any], runtime: dict[str, Any], ceiling: list[str],
    call_config: dict[str, Any], runtime_options: dict[str, Any],
) -> tuple[
    dict[str, Any],
    list[str],
    list[dict[str, Any]],
    list[dict[str, Any]],
    dict[str, Any],
]:
    catalog_state = str(
        payload.get("discoveredToolCatalogState") or "available"
    ).strip()
    if catalog_state not in {"available", "unavailable"}:
        raise CardDomainError("discovered_tool_catalog_state_invalid")
    unavailable_catalog_families = set(string_list(
        payload.get("unavailableToolCatalogFamilies"),
        "unavailable_tool_catalog_families",
    ))
    if not unavailable_catalog_families <= _OPTIONAL_TOOL_CATALOG_FAMILIES:
        raise CardDomainError("unavailable_tool_catalog_family_invalid")
    discovered_tools = payload.get("discoveredTools") or []
    if not isinstance(discovered_tools, list):
        raise CardDomainError("discovered_tools_invalid")
    if catalog_state == "unavailable" and discovered_tools:
        raise CardDomainError("discovered_tool_catalog_state_invalid")
    raw_discovered_failures = payload.get("discoveredToolFailures") or {}
    if (
        not isinstance(raw_discovered_failures, dict)
        or any(
            not isinstance(name, str) or not name.strip()
            or not isinstance(reason, str) or not reason.strip()
            for name, reason in raw_discovered_failures.items()
        )
    ):
        raise CardDomainError("discovered_tool_failures_invalid")
    catalog, normalized_failures = materialize_live_tool_catalog_with_failures(
        discovered_tools
    )
    tool_catalog_failures = {
        **{str(name): str(reason) for name, reason in raw_discovered_failures.items()},
        **normalized_failures,
    }
    catalog_failure = next(iter(tool_catalog_failures.values()), None)
    by_id = {item["canonicalId"]: item for item in catalog}
    catalog_ceiling = list(ceiling)
    unknown_tools = [name for name in catalog_ceiling if name not in by_id]
    unexpected_unknown_tools = [
        name for name in unknown_tools
        if (
            catalog_state == "available"
            and name not in tool_catalog_failures
            and (
                "." not in name
                or name.split(".", 1)[0] not in unavailable_catalog_families
            )
        )
    ]
    if unexpected_unknown_tools:
        raise CardDomainError(
            f"configured_tool_unknown:{unexpected_unknown_tools[0]}"
        )
    ineligible_tools = [
        name for name in catalog_ceiling
        if name in by_id and by_id[name].get("grantEligible") is not True
    ]
    if ineligible_tools:
        raise CardDomainError(
            f"configured_tool_not_grant_eligible:{ineligible_tools[0]}"
        )
    selected_mcp_connections = set(call_config["mcpConnectionIds"])
    connection_granted_tools = [
        item["canonicalId"] for item in catalog
        if (
            "external-mcp" in item.get("publications", [])
            and str(item.get("provider") or "") in selected_mcp_connections
        )
    ]
    # An individual saved tool is its own grant. A saved MCP connection is the
    # optional broader form: it grants the catalog currently published by that
    # connection. Neither form depends on the other.
    catalog_ceiling = list(dict.fromkeys([*catalog_ceiling, *connection_granted_tools]))

    def unavailable_reason(name: str) -> str | None:
        if name in tool_catalog_failures:
            return tool_catalog_failures[name]
        definition = by_id.get(name)
        if definition is None:
            family = name.split(".", 1)[0] if "." in name else ""
            return (
                "catalog_unavailable"
                if (
                    catalog_state == "unavailable"
                    or family in unavailable_catalog_families
                )
                else "capability_unavailable"
            )
        if definition.get("available") is not True:
            return (
                "catalog_unavailable"
                if catalog_state == "unavailable"
                else "capability_unavailable"
            )
        if runtime.get("kind") != "hermes":
            return None
        if set(definition.get("publications") or []) & {
            "card-runtime", "external-mcp",
        }:
            return None
        return "hermes_capability_owner_unsupported"

    unavailable_tool_reasons = {
        name: reason for name in catalog_ceiling
        if (reason := unavailable_reason(name)) is not None
    }
    unavailable_tools = list(unavailable_tool_reasons)
    effective_tools = [
        name for name in catalog_ceiling
        if unavailable_reason(name) is None
    ]
    # The normalized live catalog is the execution-availability and
    # saved-grant owner. Builder IDD data is not read on this path.
    try:
        project_worldview = resolve_project_worldview(
            loaded["projectId"],
            list(effective_tools),
            connector=connect_postgres,
        )
    except ProjectWorldviewError as error:
        raise CardDomainError(str(error)) from error
    project_enabled_tools = set(project_worldview["enabledCapabilities"])
    selected_tools = [
        name for name in effective_tools if name in project_enabled_tools
    ]
    call_config["enabledTools"] = selected_tools
    call_config["unavailableTools"] = unavailable_tools
    call_config["unavailableToolReasons"] = unavailable_tool_reasons
    call_config["toolCatalogFailure"] = catalog_failure
    call_config["toolCatalogFailures"] = tool_catalog_failures
    call_config["projectWorldview"] = project_worldview
    # `tools` remains the saved Card's deliberately selected presentation.
    presented_tools = [
        name for name in catalog_ceiling
        if name in selected_tools and name in by_id
    ]
    ordinary_tool_contracts = [by_id[name] for name in presented_tools]
    try:
        script_plan = script_presentation(
            options.get("script"),
            selected_tools=selected_tools,
            default_agent_tools=presented_tools,
        )
    except CardScriptValidationError as error:
        raise CardDomainError(str(error)) from error
    if options.get("script") is not None:
        runtime_options["script"] = script_plan["script"]
    call_config["scriptPresentation"] = {
        "mode": script_plan["mode"],
    }
    call_config["presentedTools"] = script_plan["presentedTools"]
    tool_definitions = [by_id[name] for name in call_config["presentedTools"]]
    return (
        call_config,
        presented_tools,
        ordinary_tool_contracts,
        tool_definitions,
        project_worldview,
    )
