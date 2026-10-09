"""The one frozen MCP catalog lifecycle and readiness state machine."""

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import os
import re
import sys
import threading
import traceback
from typing import Any

from mcp.types import Tool

from app import (
    mcp_auth,
    mcp_cbm_provider,
    mcp_graphiti_provider,
    mcp_observability,
    mcp_provider_operations,
)
from app.python_models.operation_definition import allowed_operation_keys
from app.python_models.tool_catalog import (
    code_owned_tool_projection,
    project_server_injected_schema,
)
from app.python_models.tool_registry import operation_definition, tool_access


_HOST_SOURCE_PATH = os.path.join(os.path.dirname(__file__), "mcp_host.py")


_CATALOG_DIAGNOSTIC_LOCK = threading.Lock()
_LATEST_CATALOG_DIAGNOSTIC: dict[str, Any] | None = None
_CATALOG_STATE = "initializing"
_CATALOG_FAILURE: str | None = None
_CATALOG_FAILURE_CODE: str | None = None
_CATALOG_FAILURE_SUMMARY: str | None = None
_CATALOG_COMPLETED_FAMILIES: tuple[str, ...] = ()
_CATALOG_UNAVAILABLE_FAMILIES: tuple[str, ...] = ()
_CATALOG_INITIALIZING_FAMILY: str | None = "liquidaity"
_CATALOG_TOOLS: tuple[Tool, ...] | None = None
_CATALOG_INITIALIZATION_TASK: asyncio.Task[None] | None = None


def _catalog_diagnostics() -> dict[str, Any]:
    """Return bounded process/catalog readiness without exposing membership."""
    with _CATALOG_DIAGNOSTIC_LOCK:
        identity = dict(_LATEST_CATALOG_DIAGNOSTIC or {})
        state = _CATALOG_STATE
        failure = _CATALOG_FAILURE
        failure_code = _CATALOG_FAILURE_CODE
        failure_summary = _CATALOG_FAILURE_SUMMARY
        completed_families = list(_CATALOG_COMPLETED_FAMILIES)
        unavailable_families = list(_CATALOG_UNAVAILABLE_FAMILIES)
        initializing_family = _CATALOG_INITIALIZING_FAMILY
    try:
        with open(_HOST_SOURCE_PATH, "rb") as source_file:
            current_source_sha256 = hashlib.sha256(source_file.read()).hexdigest()
    except OSError:
        current_source_sha256 = None
    catalog_ready = bool(
        state == "ready"
        and identity
        and "liquidaity" in completed_families
    )
    return {
        "state": state,
        "catalogState": state,
        "catalogReady": catalog_ready,
        **({"catalogFailure": failure} if failure else {}),
        **({"failureCode": failure_code} if failure_code else {}),
        **({"failureSummary": failure_summary} if failure_summary else {}),
        "completedCatalogFamilies": completed_families,
        "unavailableCatalogFamilies": unavailable_families,
        "initializingCatalogFamily": initializing_family,
        **(identity if state == "ready" else {}),
        "processId": mcp_observability.STARTUP_PROCESS_ID,
        "startupId": mcp_observability.STARTUP_ID,
        "sourceRevision": mcp_observability.STARTUP_SOURCE_REVISION,
        "sourceSha256": mcp_observability.STARTUP_SOURCE_SHA256,
        "currentSourceSha256": current_source_sha256,
        "sourceCurrent": (
            current_source_sha256 == mcp_observability.STARTUP_SOURCE_SHA256
            if current_source_sha256 and mcp_observability.STARTUP_SOURCE_SHA256
            else None
        ),
        "graphitiVersions": mcp_graphiti_provider._graphiti_runtime_versions(),
    }


def _catalog_identity(tools: list[Tool]) -> tuple[int, str]:
    descriptors = sorted(
        (
            tool.model_dump(by_alias=True, exclude_none=True)
            for tool in tools
        ),
        key=lambda descriptor: str(descriptor.get("name") or ""),
    )
    digest = hashlib.sha256(
        json.dumps(
            descriptors,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()
    return len(descriptors), digest


def _catalog_failure_details(error: Exception) -> tuple[str, str]:
    """Return a stable failure code and an HTTP-safe bounded summary."""
    detail = mcp_observability.sanitize_failure_detail(error)
    if "CBM daemon could not start within 30000 ms" in str(error):
        code = "cbm_daemon_start_timeout"
    else:
        match = re.match(r"^([a-z][a-z0-9_]+)(?::|$)", detail)
        if match is not None:
            code = match.group(1)
        else:
            with _CATALOG_DIAGNOSTIC_LOCK:
                family = _CATALOG_INITIALIZING_FAMILY
            code = (
                f"{family}_catalog_initialization_failed"
                if family
                else "catalog_initialization_failed"
            )
    return code, f"{error.__class__.__name__}: {detail or 'no detail'}"


def _set_catalog_initializing_family(family: str) -> None:
    global _CATALOG_INITIALIZING_FAMILY
    with _CATALOG_DIAGNOSTIC_LOCK:
        _CATALOG_INITIALIZING_FAMILY = family
    mcp_observability.trace(
        "catalog_family_initializing", catalog_family=family, completed=False,
    )


def _complete_catalog_family(family: str) -> None:
    global _CATALOG_COMPLETED_FAMILIES, _CATALOG_INITIALIZING_FAMILY
    global _CATALOG_UNAVAILABLE_FAMILIES
    with _CATALOG_DIAGNOSTIC_LOCK:
        if family not in _CATALOG_COMPLETED_FAMILIES:
            _CATALOG_COMPLETED_FAMILIES = (*_CATALOG_COMPLETED_FAMILIES, family)
        _CATALOG_UNAVAILABLE_FAMILIES = tuple(
            value for value in _CATALOG_UNAVAILABLE_FAMILIES if value != family
        )
        _CATALOG_INITIALIZING_FAMILY = None
    mcp_observability.trace(
        "catalog_family_ready", catalog_family=family, completed=True,
    )


def _mark_catalog_family_unavailable(
    family: str,
    *,
    failure_code: str,
    failure_summary: str,
) -> None:
    """Record one provider family as unavailable for readiness diagnostics."""

    global _CATALOG_UNAVAILABLE_FAMILIES, _CATALOG_INITIALIZING_FAMILY
    with _CATALOG_DIAGNOSTIC_LOCK:
        if family not in _CATALOG_UNAVAILABLE_FAMILIES:
            _CATALOG_UNAVAILABLE_FAMILIES = (
                *_CATALOG_UNAVAILABLE_FAMILIES,
                family,
            )
        _CATALOG_INITIALIZING_FAMILY = None
    mcp_observability.trace(
        "catalog_family_unavailable",
        catalog_family=family,
        failure_code=failure_code,
        failure_summary=failure_summary,
        completed=True,
    )


def _published_mcp_tool_names() -> frozenset[str]:
    """Read the exact frozen external publication surface without rebuilding it."""

    with _CATALOG_DIAGNOSTIC_LOCK:
        if _CATALOG_STATE != "ready" or _CATALOG_TOOLS is None:
            return frozenset()
        return frozenset(tool.name for tool in _CATALOG_TOOLS)


def _bind_authenticated_catalog(tools: list[Tool]) -> list[Tool]:
    """Attach OAuth metadata without projecting or filtering the canonical registry."""
    result: list[Tool] = []
    for tool in tools:
        payload = tool.model_dump(by_alias=True, exclude_none=True)
        meta = dict(payload.get("_meta") or {})
        security_schemes = [
            {"type": "oauth2", "scopes": [mcp_auth.AUTH0_REQUIRED_SCOPE]}
        ]
        source = dict(meta.get("liquidaitySource") or {})
        canonical_schema = source.get("canonicalInputSchema")
        declared = source.get("serverInjectedArguments")
        if not isinstance(canonical_schema, dict) or not isinstance(declared, list):
            raise RuntimeError(f"mcp_tool_projection_metadata_missing:{tool.name}")
        projected_schema = project_server_injected_schema(
            canonical_schema,
            frozenset(declared),
        )
        if tool.input_schema not in (canonical_schema, projected_schema):
            raise RuntimeError(f"mcp_tool_pre_projection_schema_mismatch:{tool.name}")
        payload["inputSchema"] = projected_schema
        source["authenticatedProjection"] = True
        meta["liquidaitySource"] = source
        meta["securitySchemes"] = security_schemes
        payload["_meta"] = meta
        result.append(Tool.model_validate(payload))
    return result



async def _materialize_complete_catalog() -> list[Tool]:
    global _LATEST_CATALOG_DIAGNOSTIC

    external_descriptors = [
        descriptor
        for descriptor in await asyncio.to_thread(code_owned_tool_projection)
        if "external-mcp" in descriptor["publications"]
    ]
    tools = [
        mcp_provider_operations._bind_repo_tool_source(Tool(
            name=descriptor["canonicalId"],
            title=descriptor.get("displayName"),
            description=descriptor["description"],
            inputSchema=copy.deepcopy(descriptor["inputSchema"]),
            outputSchema=copy.deepcopy(descriptor.get("outputSchema")),
            annotations=copy.deepcopy(descriptor.get("annotations")),
        ),
            source_id=descriptor["provider"],
            provider_tool_name=descriptor["providerToolName"],
        )
        for descriptor in external_descriptors
    ]
    for tool in tools:
        tool.input_schema.setdefault("additionalProperties", False)
        public_keys = set(tool.input_schema.get("properties", {}))
        definition = operation_definition(tool.name)
        if definition is None:
            raise RuntimeError(f"mcp_tool_definition_missing:{tool.name}")
        dispatch_keys = allowed_operation_keys(definition)
        if not public_keys <= dispatch_keys:
            missing = sorted(public_keys - dispatch_keys)
            raise RuntimeError(
                f"mcp_tool_dispatch_keys_missing:{tool.name}:{','.join(missing)}"
            )
    _complete_catalog_family("liquidaity")
    tools = [
        mcp_provider_operations._bind_operation_access(tool) for tool in tools
    ]
    provider_tools = await _materialize_requested_provider_catalog(
        tuple(mcp_provider_operations._PROVIDER_PREFIXES)
    )
    existing_names = {tool.name for tool in tools}
    tools.extend(
        tool for tool in provider_tools if tool.name not in existing_names
    )
    names = [tool.name for tool in tools]
    if len(names) != len(set(names)):
        duplicates = sorted({name for name in names if names.count(name) > 1})
        raise RuntimeError("federated_duplicate_tool_name:" + ",".join(duplicates))
    context = mcp_auth._authenticated_main_context()
    # OAuth security metadata belongs to the canonical catalog even when this
    # request has not resolved application-level Main project authorization.
    catalog = (
        _bind_authenticated_catalog(tools)
        if mcp_auth.OAUTH_ENFORCED or context is not None
        else tools
    )
    catalog_count, catalog_hash = _catalog_identity(catalog)
    with _CATALOG_DIAGNOSTIC_LOCK:
        _LATEST_CATALOG_DIAGNOSTIC = {
            "toolCount": catalog_count,
            "uniqueToolCount": len({tool.name for tool in catalog}),
            "catalogHash": catalog_hash,
        }
    mcp_observability.trace(
        "catalog",
        mcp_method="tools/list",
        catalog_count=catalog_count,
        catalog_hash=catalog_hash,
        source_revision=mcp_observability.STARTUP_SOURCE_REVISION,
        source_sha256=mcp_observability.STARTUP_SOURCE_SHA256,
        response_status=200,
        completed=True,
        **mcp_auth._oauth_trace_fields(),
    )
    return catalog


def _requested_provider_catalog_families() -> tuple[str, ...]:
    """Resolve external families only from an authorized live MCP request."""
    principal = mcp_auth._internal_mcp_principal()
    if principal is None:
        # A public authenticated MCP client explicitly listing this product's
        # tools is allowed to discover the complete external surface. Process
        # startup itself has no request token and never reaches this branch.
        return ("cbm", "graphiti") if mcp_auth.access_token_available() else ()
    kind = str(principal.get("kind") or "")
    if kind == "catalog-reader":
        # The catalog reader can inspect every loaded provider contract but
        # cannot execute any tool. Card-specific principals remain narrowed to
        # their saved grants below.
        return tuple(mcp_provider_operations._PROVIDER_PREFIXES)
    if kind not in {"materializer-read", "card-runtime"}:
        return ()
    tool_names = mcp_auth._validated_principal_tool_names(
        principal.get(
            "presentedTools" if kind == "card-runtime" else "grantedTools"
        )
    ) or frozenset()
    return tuple(
        family
        for family, prefix in mcp_provider_operations._PROVIDER_PREFIXES.items()
        if any(name.startswith(prefix) for name in tool_names)
    )


async def _materialize_requested_provider_catalog(
    families: tuple[str, ...],
) -> list[Tool]:
    """Late-bind only the provider families selected by the authorized request."""
    tools: list[Tool] = []
    for provider in families:
        _set_catalog_initializing_family(provider)
        try:
            provider_tools = (
                await mcp_cbm_provider._cbm_tools()
                if provider == "cbm"
                else await mcp_graphiti_provider._graphiti_tools()
            )
        except Exception as error:
            failure_code, failure_summary = _catalog_failure_details(error)
            _mark_catalog_family_unavailable(
                provider,
                failure_code=failure_code,
                failure_summary=failure_summary,
            )
            continue
        graphiti_unavailable = (
            mcp_graphiti_provider.graphiti_unavailability()
            if provider == "graphiti" and not provider_tools
            else None
        )
        if graphiti_unavailable:
            _mark_catalog_family_unavailable(
                provider,
                failure_code=str(
                    graphiti_unavailable.get("failureCode")
                    or "optional_capability_unavailable"
                ),
                failure_summary=str(
                    graphiti_unavailable.get("detail")
                    or "Graphiti catalog is unavailable."
                ),
            )
            continue
        _complete_catalog_family(provider)
        namespaced = mcp_provider_operations._namespace_provider_tools(
            provider, provider_tools,
        )
        if provider == "cbm":
            mcp_provider_operations._register_cbm_catalog(namespaced)
        elif provider == "graphiti":
            mcp_provider_operations._register_graphiti_catalog(namespaced)
        tools.extend(namespaced)

    tools = [
        mcp_provider_operations._bind_operation_access(tool) for tool in tools
    ]
    return (
        _bind_authenticated_catalog(tools)
        if mcp_auth.OAUTH_ENFORCED
        or mcp_auth._authenticated_main_context() is not None
        else tools
    )


async def _initialize_catalog_once() -> None:
    """Freeze the one canonical MCP catalog for all clients."""
    global _CATALOG_COMPLETED_FAMILIES, _CATALOG_UNAVAILABLE_FAMILIES
    global _CATALOG_FAILURE, _CATALOG_FAILURE_CODE
    global _CATALOG_FAILURE_SUMMARY, _CATALOG_INITIALIZING_FAMILY, _CATALOG_STATE
    global _CATALOG_TOOLS
    global _LATEST_CATALOG_DIAGNOSTIC
    with _CATALOG_DIAGNOSTIC_LOCK:
        _CATALOG_STATE = "initializing"
        _CATALOG_FAILURE = None
        _CATALOG_FAILURE_CODE = None
        _CATALOG_FAILURE_SUMMARY = None
        _CATALOG_COMPLETED_FAMILIES = ()
        _CATALOG_UNAVAILABLE_FAMILIES = ()
        _CATALOG_INITIALIZING_FAMILY = "liquidaity"
        _CATALOG_TOOLS = None
        _LATEST_CATALOG_DIAGNOSTIC = None
    try:
        tools = tuple(await _materialize_complete_catalog())
        canonical_names = [tool.name for tool in tools]
        if not tools or len(set(canonical_names)) != len(canonical_names):
            raise RuntimeError(
                "canonical_catalog_invalid: "
                f"actual={len(tools)} "
                f"unique={len(set(canonical_names))}"
            )
        catalog_count, catalog_hash = _catalog_identity(list(tools))
    except asyncio.CancelledError:
        with _CATALOG_DIAGNOSTIC_LOCK:
            if _CATALOG_STATE == "initializing":
                _CATALOG_STATE = "failed"
                _CATALOG_FAILURE = "CancelledError: catalog initialization cancelled"
                _CATALOG_FAILURE_CODE = "catalog_initialization_cancelled"
                _CATALOG_FAILURE_SUMMARY = _CATALOG_FAILURE
                _CATALOG_TOOLS = None
                _LATEST_CATALOG_DIAGNOSTIC = None
        raise
    except Exception as error:
        failure_code, failure = _catalog_failure_details(error)
        with mcp_observability.TRACE_LOCK:
            print(
                "[main-mcp] catalog initialization failed; full local traceback follows",
                file=sys.stderr,
                flush=True,
            )
            traceback.print_exception(
                error.__class__, error, error.__traceback__, file=sys.stderr
            )
        with _CATALOG_DIAGNOSTIC_LOCK:
            _CATALOG_STATE = "failed"
            _CATALOG_FAILURE = failure
            _CATALOG_FAILURE_CODE = failure_code
            _CATALOG_FAILURE_SUMMARY = failure
            _CATALOG_TOOLS = None
            _LATEST_CATALOG_DIAGNOSTIC = None
        mcp_observability.trace(
            "catalog_initialization_failed",
            exception_class=error.__class__.__name__,
            failure_code=failure_code,
            result_category=failure_code,
            completed=True,
        )
        return
    with _CATALOG_DIAGNOSTIC_LOCK:
        _CATALOG_TOOLS = tools
        _LATEST_CATALOG_DIAGNOSTIC = {
            "toolCount": catalog_count,
            "uniqueToolCount": len(set(canonical_names)),
            "catalogHash": catalog_hash,
        }
        _CATALOG_FAILURE = None
        _CATALOG_FAILURE_CODE = None
        _CATALOG_FAILURE_SUMMARY = None
        _CATALOG_INITIALIZING_FAMILY = None
        _CATALOG_STATE = "ready"


def _observe_catalog_initialization(task: asyncio.Task[None]) -> None:
    """Fail closed if the one initializer ends without publishing a terminal state."""
    global _CATALOG_FAILURE, _CATALOG_FAILURE_CODE, _CATALOG_FAILURE_SUMMARY
    global _CATALOG_STATE, _CATALOG_TOOLS, _LATEST_CATALOG_DIAGNOSTIC
    with _CATALOG_DIAGNOSTIC_LOCK:
        if _CATALOG_STATE != "initializing":
            return
    if task.cancelled():
        failure_code = "catalog_initialization_cancelled"
        failure = "CancelledError: catalog initialization cancelled"
        error: BaseException | None = None
    else:
        error = task.exception()
        if error is None:
            failure_code = "catalog_initializer_ended_without_state"
            failure = "RuntimeError: catalog initializer ended without a terminal state"
        elif isinstance(error, Exception):
            failure_code, failure = _catalog_failure_details(error)
        else:
            failure_code = "catalog_initializer_crashed"
            failure = (
                f"{error.__class__.__name__}: "
                f"{mcp_observability.sanitize_failure_detail(error)}"
            )
    with _CATALOG_DIAGNOSTIC_LOCK:
        if _CATALOG_STATE != "initializing":
            return
        _CATALOG_STATE = "failed"
        _CATALOG_FAILURE = failure
        _CATALOG_FAILURE_CODE = failure_code
        _CATALOG_FAILURE_SUMMARY = failure
        _CATALOG_TOOLS = None
        _LATEST_CATALOG_DIAGNOSTIC = None
    if error is not None:
        with mcp_observability.TRACE_LOCK:
            print(
                "[main-mcp] catalog initializer crashed; full local traceback follows",
                file=sys.stderr,
                flush=True,
            )
            traceback.print_exception(
                error.__class__, error, error.__traceback__, file=sys.stderr
            )
    mcp_observability.trace(
        "catalog_initializer_terminated",
        exception_class=error.__class__.__name__ if error is not None else None,
        failure_code=failure_code,
        result_category=failure_code,
        completed=True,
    )


def _start_catalog_initialization() -> asyncio.Task[None]:
    """Return the one process-wide canonical catalog initialization task."""
    global _CATALOG_INITIALIZATION_TASK
    task = _CATALOG_INITIALIZATION_TASK
    if task is None:
        task = asyncio.create_task(
            _initialize_catalog_once(),
            name="liquidaity-mcp-catalog-initialization",
        )
        task.add_done_callback(_observe_catalog_initialization)
        _CATALOG_INITIALIZATION_TASK = task
    return task


def _catalog_or_error() -> list[Tool]:
    with _CATALOG_DIAGNOSTIC_LOCK:
        state = _CATALOG_STATE
        failure = _CATALOG_FAILURE
        tools = _CATALOG_TOOLS
        completed_families = set(_CATALOG_COMPLETED_FAMILIES)
    if state == "initializing":
        raise RuntimeError("mcp_catalog_initializing")
    if state == "failed":
        raise RuntimeError(
            f"mcp_catalog_initialization_failed: {failure or 'unknown'}"
        )
    if state != "ready" or tools is None:
        raise RuntimeError("mcp_catalog_readiness_invalid")
    if "liquidaity" not in completed_families:
        raise RuntimeError("mcp_catalog_incomplete:liquidaity")
    return list(tools)


async def list_tools() -> list[Tool]:
    """Return one frozen catalog, narrowed only for internal scoped callers."""
    with _CATALOG_DIAGNOSTIC_LOCK:
        initializing = _CATALOG_STATE == "initializing"
    if initializing:
        # HTTP binds before its providers finish initializing so health
        # can report truthful progress. A tools/list client, however, must not
        # observe an incomplete catalog or turn a transient startup state into
        # missing saved grants. Shield the one process-wide initializer from a
        # client cancellation, then return only its frozen terminal catalog.
        await asyncio.shield(_start_catalog_initialization())
    tools = _catalog_or_error()
    families = set(_requested_provider_catalog_families())
    tools = [
        tool for tool in tools
        if not any(
            tool.name.startswith(prefix) and family not in families
            for family, prefix in mcp_provider_operations._PROVIDER_PREFIXES.items()
        )
    ]
    principal = mcp_auth._internal_mcp_principal()
    kind = str((principal or {}).get("kind") or "")
    if kind == "materializer-read":
        granted = mcp_auth._validated_principal_tool_names(
            principal.get("grantedTools")
        )
        tools = [
            tool for tool in tools
            if granted is not None
            and tool.name in granted
            and tool_access(tool.name) == "read"
        ]
    elif kind == "card-runtime":
        granted = mcp_auth._validated_principal_tool_names(
            principal.get("grantedTools")
        )
        presented = mcp_auth._validated_principal_tool_names(
            principal.get("presentedTools")
        )
        tools = [
            tool for tool in tools
            if granted is not None
            and presented is not None
            and tool.name in granted
            and tool.name in presented
        ]
    names = [tool.name for tool in tools]
    if len(names) != len(set(names)):
        raise RuntimeError("federated_duplicate_tool_name:" + ",".join(sorted({
            name for name in names if names.count(name) > 1
        })))
    return tools


def _listed_tool_input_schema(name: str) -> dict[str, Any] | None:
    """Return the frozen model-visible schema used by SDK header validation."""
    tools = _CATALOG_TOOLS or ()
    match = next((tool for tool in tools if tool.name == name), None)
    return copy.deepcopy(match.input_schema) if match is not None else None
