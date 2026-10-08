"""T001 ToolRegistry: typed, loud-failing runtime tool resolution.

The Card and Run select both reads and effects. The registry resolves that set,
validates every selected name, and fails loudly for unknown, disabled,
duplicate, empty-name, or schema-missing tools. There is no fallback,
substitution, guessing, auto-selection, or tool invention.

The real tool callables (``tool_current_datetime``, ``tool_calculator``) live
here. Provider runtimes receive only the exact saved selection projected from
this registry.
"""

from __future__ import annotations

import asyncio
import ast
import json
import operator
import re
import inspect
import threading
from copy import deepcopy
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from typing import Any, Callable

from app.python_models.web_search import web_search
from app.python_models.orchestration_contracts import ToolSpec
from app.python_models.sec_filing_signals import (
    IssuerRef,
    SecFilingQuery,
    find_recent_sec_filing_signals,
)
from app.python_models.alpaca_market_data import (
    AlpacaInstrumentRef,
    get_historical_bars,
    get_market_snapshot,
    get_paper_account_readiness,
)
from app.python_models.worldsignals_client import (
    worldsignals_batch,
    worldsignals_capabilities,
    worldsignals_command,
    worldsignals_poll,
    worldsignals_stream_events,
)


_OPERATION_PUBLISHERS = frozenset({
    "internal-plugin",
    "external-mcp",
    "internal-runtime",
})


class ToolCatalogError(ValueError):
    """Secret-safe structural error in one authoritative live tool catalog."""


@dataclass(frozen=True)
class OperationDefinition:
    """One canonical operation independent of any publisher transport."""

    canonical_id: str
    description: str
    parameters_schema: dict[str, Any]
    handler: Callable[..., Any]
    available: bool
    publishers: frozenset[str]
    access: str
    namespace: str
    external_source_id: str = "main_mcp"
    output_schema: dict[str, Any] | None = None
    required_caller_runtime: tuple[str, str] | None = None
    title: str | None = None
    annotations: dict[str, Any] | None = None
    grant_eligible: bool = True
    server_injected_arguments: frozenset[str] = frozenset()
    dispatcher_context_arguments: frozenset[str] = frozenset()
    dispatcher_owner: str = ""

    def __post_init__(self) -> None:
        if not self.canonical_id.strip():
            raise RuntimeError("operation_id_empty")
        provider_external = (
            self.publishers == frozenset({"external-mcp"})
            and self.external_source_id != "main_mcp"
        )
        if not self.description.strip() and not provider_external:
            raise RuntimeError(f"operation_description_missing:{self.canonical_id}")
        if self.parameters_schema.get("type") != "object":
            raise RuntimeError(f"operation_parameters_invalid:{self.canonical_id}")
        if not callable(self.handler):
            raise RuntimeError(f"operation_handler_missing:{self.canonical_id}")
        if not self.publishers or not self.publishers.issubset(_OPERATION_PUBLISHERS):
            raise RuntimeError(f"operation_publishers_invalid:{self.canonical_id}")
        if self.access not in {"read", "write"}:
            raise RuntimeError(f"operation_access_invalid:{self.canonical_id}")
        if not self.namespace.strip():
            raise RuntimeError(f"operation_namespace_missing:{self.canonical_id}")
        if "external-mcp" in self.publishers and not self.external_source_id.strip():
            raise RuntimeError(f"operation_external_source_missing:{self.canonical_id}")
        if self.title is not None and not self.title.strip():
            raise RuntimeError(f"operation_title_invalid:{self.canonical_id}")
        if self.annotations is not None:
            for key in (
                "readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint",
            ):
                if key in self.annotations and not isinstance(self.annotations[key], bool):
                    raise RuntimeError(
                        f"operation_annotation_invalid:{self.canonical_id}:{key}"
                    )
        if not isinstance(self.grant_eligible, bool):
            raise RuntimeError(
                f"operation_grant_eligibility_invalid:{self.canonical_id}"
            )
        properties = self.parameters_schema.get("properties", {})
        if (
            not isinstance(self.server_injected_arguments, frozenset)
            or any(not isinstance(field, str) or not field for field in self.server_injected_arguments)
            or not self.server_injected_arguments <= set(properties)
        ):
            raise RuntimeError(
                f"operation_server_injected_arguments_invalid:{self.canonical_id}"
            )
        if (
            not isinstance(self.dispatcher_context_arguments, frozenset)
            or any(
                not isinstance(field, str) or not field
                for field in self.dispatcher_context_arguments
            )
            or not self.server_injected_arguments <= self.dispatcher_context_arguments
        ):
            raise RuntimeError(
                f"operation_dispatcher_context_arguments_invalid:{self.canonical_id}"
            )
        if not self.dispatcher_owner:
            owner = ".".join(filter(None, (
                getattr(self.handler, "__module__", ""),
                getattr(self.handler, "__qualname__", ""),
            )))
            if not owner:
                raise RuntimeError(f"operation_dispatcher_owner_missing:{self.canonical_id}")
            object.__setattr__(self, "dispatcher_owner", owner)


def project_server_injected_schema(
    canonical_schema: dict[str, Any],
    server_injected_arguments: frozenset[str] | set[str] | list[str] | tuple[str, ...],
) -> dict[str, Any]:
    """Remove only explicitly declared server-injected top-level arguments."""

    if not isinstance(canonical_schema, dict) or canonical_schema.get("type") != "object":
        raise ToolCatalogError("tool_catalog_canonical_schema_invalid")
    declared = tuple(server_injected_arguments)
    if (
        any(not isinstance(field, str) or not field for field in declared)
        or len(declared) != len(set(declared))
    ):
        raise ToolCatalogError("tool_catalog_server_injected_arguments_invalid")
    projected = deepcopy(canonical_schema)
    properties = projected.get("properties")
    canonical_properties = canonical_schema.get("properties")
    if not isinstance(properties, dict) or not isinstance(canonical_properties, dict):
        if declared:
            raise ToolCatalogError("tool_catalog_server_injected_argument_unknown")
        return projected
    unknown = sorted(set(declared) - set(canonical_properties))
    if unknown:
        raise ToolCatalogError(
            "tool_catalog_server_injected_argument_unknown:" + ",".join(unknown)
        )
    for field in declared:
        properties.pop(field, None)
    required = projected.get("required")
    if isinstance(required, list):
        projected["required"] = [field for field in required if field not in declared]
    return projected


_GRAPHITI_READ_OPERATIONS = frozenset({
    "graphiti.get_entity_edge",
    "graphiti.get_episode_entities",
    "graphiti.get_episodes",
    "graphiti.get_status",
    "graphiti.search_memory_facts",
    "graphiti.search_nodes",
})
_GRAPHITI_WRITE_OPERATIONS = frozenset({
    "graphiti.add_memory",
    "graphiti.add_triplet",
    "graphiti.build_communities",
    "graphiti.clear_graph",
    "graphiti.delete_entity_edge",
    "graphiti.delete_episode",
    "graphiti.summarize_saga",
})


def graphiti_operation_policy(canonical_id: str) -> dict[str, Any] | None:
    """Explicit effects for Graphiti operations whose provider omits annotations."""

    if canonical_id not in _GRAPHITI_READ_OPERATIONS | _GRAPHITI_WRITE_OPERATIONS:
        return None
    read_only = canonical_id in _GRAPHITI_READ_OPERATIONS
    destructive = canonical_id in {
        "graphiti.clear_graph",
        "graphiti.delete_entity_edge",
        "graphiti.delete_episode",
    }
    return {
        "access": "read" if read_only else "write",
        "annotations": {
            "readOnlyHint": read_only,
            "destructiveHint": destructive,
            "idempotentHint": read_only or destructive,
            "openWorldHint": False,
        },
    }


async def _trading_context_required(**_arguments: Any) -> dict[str, Any]:
    """Trading writes require the authenticated Card/Run identity from MCP."""

    raise RuntimeError("trading_card_context_required")


def _worldsignals_package_context_required(
    command: str,
    reason: str,
    arguments: dict[str, Any] | None = None,
    domains: list[str] | None = None,
    sourceRefs: list[str] | None = None,
    maxAgeSeconds: int | None = None,
    limit: int = 25,
) -> dict[str, Any]:
    """Typed packages require trusted Card/Run identity from the MCP host.

    Keeping the public arguments in this callable preserves the accurate provider
    schema, while an unscoped invocation fails closed instead of accepting
    model-authored scope identifiers.
    """

    del command, reason, arguments, domains, sourceRefs, maxAgeSeconds, limit
    raise RuntimeError("worldsignals_package_card_context_required")


def required_tool_caller_runtime(name: str) -> dict[str, str] | None:
    """Return one explicit runtime requirement; never infer one from a name."""
    definition = operation_definition(name)
    if definition is None or definition.required_caller_runtime is None:
        return None
    kind, mode = definition.required_caller_runtime
    return {"kind": kind, "mode": mode}


def external_mcp_tool_ids() -> frozenset[str]:
    """Return operations whose canonical owner permits external MCP publication."""
    return frozenset(
        definition.canonical_id for definition in operation_definitions()
        if "external-mcp" in definition.publishers
    )


def tool_publication(name: str) -> str | None:
    definition = operation_definition(name)
    if definition is None:
        return None
    return "external-mcp" if "external-mcp" in definition.publishers else "private-runtime"


def hermes_plugin_operation_ids() -> frozenset[str]:
    return frozenset(
        definition.canonical_id for definition in operation_definitions()
        if "internal-plugin" in definition.publishers
    )


def tool_access(name: str) -> str | None:
    """Return explicit effect metadata; never infer it from prose or names."""
    definition = operation_definition(name)
    return definition.access if definition is not None else None


def readable_tool_ids() -> frozenset[str]:
    return frozenset(
        definition.canonical_id for definition in operation_definitions()
        if definition.access == "read"
    )


def writable_tool_ids() -> frozenset[str]:
    return frozenset(
        definition.canonical_id for definition in operation_definitions()
        if definition.access == "write"
    )


def normalize_live_tool_catalog(descriptors: Any) -> list[dict[str, Any]]:
    """Normalize current provider descriptors without consulting IDD.

    Python registries and connected MCP providers supply complete contracts.
    Multiple transports may publish one canonical operation, but their stable
    metadata and schemas must agree exactly. This function groups those factual
    contracts; it does not invent operations, aliases, access, or availability.
    """

    if not isinstance(descriptors, list):
        raise ToolCatalogError("tool_catalog_invalid")
    references: dict[str, dict[str, Any]] = {}
    signatures: dict[str, str] = {}
    seen_contracts: set[tuple[str, str, str]] = set()
    required_annotations = {
        "readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint",
    }
    for raw in descriptors:
        if not isinstance(raw, dict):
            raise ToolCatalogError("tool_catalog_entry_invalid")
        canonical_id = str(raw.get("name") or "").strip()
        source_id = str(raw.get("sourceId") or "").strip()
        provider_tool_name = str(raw.get("providerToolName") or "").strip()
        namespace = str(raw.get("namespace") or "").strip()
        connection_kind = str(raw.get("connectionKind") or "").strip()
        publication = str(raw.get("publication") or "").strip()
        access = str(raw.get("access") or "").strip()
        title = str(raw.get("title") or canonical_id).strip()
        description = raw.get("description", "")
        input_schema = raw.get("inputSchema")
        canonical_input_schema = raw.get("canonicalInputSchema", input_schema)
        server_injected_raw = raw.get("serverInjectedArguments", [])
        dispatcher_context_raw = raw.get("dispatcherContextArguments", [])
        dispatcher_owner = str(raw.get("dispatcherOwner") or "").strip()
        authenticated_projection = raw.get("authenticatedProjection", False)
        output_schema = raw.get("outputSchema")
        annotations = raw.get("annotations")
        security_schemes = raw.get("securitySchemes")
        available = raw.get("available", raw.get("enabled", True)) is not False
        grant_eligible = raw.get("grantEligible", True)
        caller_kind = raw.get("requiredCallerRuntimeKind")
        caller_mode = raw.get("requiredCallerRuntimeMode")
        kind = raw.get("kind", "tool")
        expected_publication = {
            "private-runtime": "private-runtime",
            "external-mcp": "external-mcp",
        }.get(connection_kind)
        if (
            not canonical_id
            or not source_id
            or not provider_tool_name
            or not namespace
            or expected_publication is None
            or publication != expected_publication
            or access not in {"read", "write"}
            or not title
            or not isinstance(description, str)
            or not isinstance(input_schema, dict)
            or input_schema.get("type") != "object"
            or not isinstance(canonical_input_schema, dict)
            or canonical_input_schema.get("type") != "object"
            or not isinstance(server_injected_raw, list)
            or not isinstance(dispatcher_context_raw, list)
            or not dispatcher_owner
            or not isinstance(authenticated_projection, bool)
            or kind != "tool"
            or not isinstance(grant_eligible, bool)
        ):
            raise ToolCatalogError("tool_catalog_contract_invalid")
        if output_schema is not None and not isinstance(output_schema, dict):
            raise ToolCatalogError(f"tool_catalog_output_schema_invalid:{canonical_id}")
        if not isinstance(annotations, dict) or not required_annotations.issubset(annotations):
            raise ToolCatalogError(f"tool_catalog_annotations_invalid:{canonical_id}")
        if annotations.get("readOnlyHint") is not (access == "read"):
            raise ToolCatalogError(f"tool_catalog_access_mismatch:{canonical_id}")
        if any(
            not isinstance(field, str) or not field
            for field in server_injected_raw
        ) or len(server_injected_raw) != len(set(server_injected_raw)):
            raise ToolCatalogError(
                f"tool_catalog_server_injected_arguments_invalid:{canonical_id}"
            )
        server_injected_arguments = frozenset(server_injected_raw)
        if any(
            not isinstance(field, str) or not field
            for field in dispatcher_context_raw
        ) or len(dispatcher_context_raw) != len(set(dispatcher_context_raw)):
            raise ToolCatalogError(
                f"tool_catalog_dispatcher_context_arguments_invalid:{canonical_id}"
            )
        dispatcher_context_arguments = frozenset(dispatcher_context_raw)
        if not server_injected_arguments <= dispatcher_context_arguments:
            raise ToolCatalogError(
                f"tool_catalog_dispatcher_context_projection_invalid:{canonical_id}"
            )
        projected_input_schema = project_server_injected_schema(
            canonical_input_schema,
            server_injected_arguments,
        )
        expected_input_schema = (
            projected_input_schema
            if connection_kind == "external-mcp" and authenticated_projection
            else canonical_input_schema
        )
        if connection_kind == "private-runtime" and authenticated_projection:
            raise ToolCatalogError(
                f"tool_catalog_projection_transport_invalid:{canonical_id}"
            )
        if input_schema != expected_input_schema:
            raise ToolCatalogError(
                f"tool_catalog_schema_projection_mismatch:{canonical_id}"
            )
        if security_schemes is not None and (
            not isinstance(security_schemes, list)
            or not all(isinstance(item, dict) for item in security_schemes)
        ):
            raise ToolCatalogError(f"tool_catalog_security_invalid:{canonical_id}")
        if bool(caller_kind) != bool(caller_mode):
            raise ToolCatalogError(f"tool_catalog_caller_scope_invalid:{canonical_id}")
        if caller_kind is not None and (
            caller_kind != "hermes"
            or caller_mode not in {"main", "delegate", "magentic_one"}
        ):
            raise ToolCatalogError(f"tool_catalog_caller_scope_invalid:{canonical_id}")

        canonical_metadata = {
            "kind": "tool",
            "namespace": namespace,
            "displayName": title,
            "shortDescription": description,
            "access": access,
            "canonicalInputSchema": canonical_input_schema,
            "outputSchema": output_schema,
            "serverInjectedArguments": sorted(server_injected_arguments),
            "dispatcherContextArguments": sorted(dispatcher_context_arguments),
            "dispatcherOwner": dispatcher_owner,
            "annotations": annotations,
            "grantEligible": grant_eligible,
            "requiredCallerRuntimeKind": caller_kind,
            "requiredCallerRuntimeMode": caller_mode,
        }
        # Every contract carries the same complete canonical schema.  An
        # external contract may differ only by the deterministic removal of
        # its explicitly declared server-injected top-level arguments.
        signature = json.dumps(
            canonical_metadata, ensure_ascii=False, sort_keys=True,
            separators=(",", ":"),
        )
        if canonical_id in signatures and signatures[canonical_id] != signature:
            raise ToolCatalogError(f"tool_catalog_definition_mismatch:{canonical_id}")
        signatures[canonical_id] = signature
        contract_key = (canonical_id, source_id, provider_tool_name)
        if contract_key in seen_contracts:
            raise ToolCatalogError(f"tool_catalog_duplicate_contract:{canonical_id}")
        seen_contracts.add(contract_key)
        contract: dict[str, Any] = {
            "sourceId": source_id,
            "providerToolName": provider_tool_name,
            "connectionKind": connection_kind,
            "publication": publication,
            "available": available,
            "grantEligible": grant_eligible,
            "title": title,
            "description": description,
            "inputSchema": deepcopy(input_schema),
            "canonicalInputSchema": deepcopy(canonical_input_schema),
            "serverInjectedArguments": sorted(server_injected_arguments),
            "dispatcherContextArguments": sorted(dispatcher_context_arguments),
            "dispatcherOwner": dispatcher_owner,
            "authenticatedProjection": authenticated_projection,
            "annotations": deepcopy(annotations),
        }
        if output_schema is not None:
            contract["outputSchema"] = deepcopy(output_schema)
        if security_schemes is not None:
            contract["securitySchemes"] = deepcopy(security_schemes)
        reference = references.setdefault(canonical_id, {
            "canonicalId": canonical_id,
            "kind": "tool",
            "namespace": namespace,
            "sourceIds": [],
            "dispatcherOwner": dispatcher_owner,
            "displayName": title,
            "shortDescription": description,
            "availability": "disabled",
            "publication": "private-runtime",
            "access": access,
            "grantEligible": grant_eligible,
            "contracts": [],
            **(
                {
                    "requiredCallerRuntimeKind": caller_kind,
                    "requiredCallerRuntimeMode": caller_mode,
                }
                if caller_kind is not None else {}
            ),
        })
        if source_id not in reference["sourceIds"]:
            reference["sourceIds"].append(source_id)
        reference["contracts"].append(contract)
        if publication == "external-mcp":
            reference["publication"] = "external-mcp"
        if available:
            reference["availability"] = "available"
    return [deepcopy(references[key]) for key in sorted(references)]


def normalize_live_tool_catalog_with_failures(
    descriptors: Any,
) -> tuple[list[dict[str, Any]], dict[str, str]]:
    """Validate each canonical tool boundary independently.

    A malformed or conflicting tool is excluded with its exact structural
    reason while unrelated valid tools remain available. Release/catalog gates
    continue to use :func:`normalize_live_tool_catalog` and fail on any defect.
    """

    if not isinstance(descriptors, list):
        raise ToolCatalogError("tool_catalog_invalid")
    groups: dict[str, list[Any]] = {}
    for index, raw in enumerate(descriptors):
        canonical_id = (
            str(raw.get("name") or "").strip()
            if isinstance(raw, dict) else ""
        )
        key = canonical_id or f"catalog-entry-{index}"
        groups.setdefault(key, []).append(raw)
    references: list[dict[str, Any]] = []
    failures: dict[str, str] = {}
    for canonical_id in sorted(groups):
        try:
            references.extend(normalize_live_tool_catalog(groups[canonical_id]))
        except ToolCatalogError as error:
            failures[canonical_id] = str(error)
    return references, failures

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


async def web_search_tool(query: str, max_results: int = 5) -> dict[str, Any]:
    """Return the existing Tavily JSON result as its truthful structured object."""

    payload = json.loads(await web_search(query=query, max_results=max_results))
    if not isinstance(payload, dict):
        raise RuntimeError("web_search_result_invalid")
    return payload



# ---------------------------------------------------------------------------
# SEC filing WorldSignals tool (explicit issuer, read-only, no graph write).
# ---------------------------------------------------------------------------


async def find_recent_sec_filing_signals_tool(
    form_types: list[str],
    from_date: str,
    to_date: str,
    issuer_ticker: str | None = None,
    issuer_cik: str | None = None,
    issuer_company_name: str | None = None,
    limit: int = 10,
) -> dict[str, Any]:
    """Mag One tool: find recent SEC filings for an EXPLICIT issuer/form/window.

    Read-only WorldSignals lane. Returns typed filing-signal envelopes (provider
    status, issuer identity, form type, filing timestamp, the canonical SEC.gov filing
    URL, and a replay identity). Registering the tool never runs it; it performs no
    graph write, no research execution, and no trade. An explicit issuer is required —
    it never auto-runs from ticker wording. Returns provider_unconfigured when the SEC
    provider is not configured.
    """
    query = SecFilingQuery(
        issuer=IssuerRef(
            ticker=(str(issuer_ticker).strip() or None) if issuer_ticker else None,
            cik=(str(issuer_cik).strip() or None) if issuer_cik else None,
            companyName=(
                (str(issuer_company_name).strip() or None) if issuer_company_name else None
            ),
        ),
        formTypes=[str(f).strip() for f in (form_types or []) if str(f).strip()],
        fromDate=str(from_date or "").strip(),
        toDate=str(to_date or "").strip(),
        limit=limit if isinstance(limit, int) else 10,
    )
    # Blocking urllib call (only when configured) runs off the event loop.
    result = await asyncio.to_thread(find_recent_sec_filing_signals, query)
    return result.to_dict()


# ---------------------------------------------------------------------------
# Alpaca read-only market-data + paper-account-readiness tools (no execution).
# ---------------------------------------------------------------------------


async def get_market_snapshot_tool(symbol: str, feed: str = "iex") -> dict[str, Any]:
    """Mag One tool: latest Alpaca snapshot for an EXPLICIT symbol (read-only, paper feed).

    Returns provider/feed identity, observed timestamp, freshness, and status. No order,
    no position/account mutation, no live endpoint. Honest provider_unconfigured without
    paper credentials.
    """
    instrument = AlpacaInstrumentRef(symbol=str(symbol or "").strip())
    result = await asyncio.to_thread(lambda: get_market_snapshot(instrument, feed=feed))
    return result.to_dict()


async def get_historical_bars_tool(
    symbol: str,
    timeframe: str,
    start: str | None = None,
    end: str | None = None,
    limit: int = 100,
    feed: str = "iex",
) -> dict[str, Any]:
    """Mag One tool: bounded Alpaca historical bars for an EXPLICIT symbol + timeframe.

    Read-only. No order/position/account mutation, no live endpoint, no streaming. Honest
    provider_unconfigured without paper credentials.
    """
    instrument = AlpacaInstrumentRef(symbol=str(symbol or "").strip())
    result = await asyncio.to_thread(
        lambda: get_historical_bars(
            instrument, str(timeframe or "").strip(), start=start, end=end,
            limit=limit if isinstance(limit, int) else 100, feed=feed,
        )
    )
    return result.to_dict()


async def get_paper_account_readiness_tool() -> dict[str, Any]:
    """Mag One tool: confirm Alpaca PAPER account availability/status only.

    No positions, no orders, no balances, no mutation. Honest provider_unconfigured
    without paper credentials.
    """
    result = await asyncio.to_thread(get_paper_account_readiness)
    return result.to_dict()


# ---------------------------------------------------------------------------
# ToolRegistry.
# ---------------------------------------------------------------------------

class ToolRegistry:
    """Resolves only explicitly selected provider tool specifications."""

    def __init__(self) -> None:
        self._specs: dict[str, ToolSpec] = {}
        self._adapters: dict[str, Callable[..., Any]] = {}
        self._publishers: dict[str, frozenset[str]] = {}
        self._external_sources: dict[str, str] = {}

    def register(
        self,
        spec: ToolSpec,
        adapter: Callable[..., Any],
        *,
        publishers: frozenset[str] = frozenset({"internal-plugin"}),
        external_source_id: str = "main_mcp",
    ) -> None:
        if not isinstance(spec, ToolSpec):
            raise RuntimeError(f"card_tool_spec_invalid: {type(spec).__name__}")
        if spec.name in self._specs:
            raise RuntimeError(f"card_tool_already_registered: {spec.name}")
        if not callable(adapter):
            raise RuntimeError(f"card_tool_adapter_missing: {spec.name}")
        if not publishers or not publishers.issubset(_OPERATION_PUBLISHERS):
            raise RuntimeError(f"card_tool_publishers_invalid: {spec.name}")
        self._specs[spec.name] = spec
        self._adapters[spec.name] = adapter
        self._publishers[spec.name] = publishers
        self._external_sources[spec.name] = external_source_id

    def known_names(self) -> list[str]:
        return sorted(self._specs)

    def spec(self, name: str) -> ToolSpec | None:
        return self._specs.get(str(name or "").strip())

    def operation_definitions(self) -> list[OperationDefinition]:
        definitions: list[OperationDefinition] = []
        for name in self.known_names():
            spec = self._specs[name]
            definitions.append(OperationDefinition(
                canonical_id=spec.name,
                description=spec.description,
                parameters_schema=deepcopy(spec.inputSchema),
                handler=self._adapters[name],
                available=spec.enabled,
                publishers=self._publishers[name],
                access=spec.access,
                namespace="python",
                external_source_id=self._external_sources[name],
                output_schema=deepcopy(spec.outputSchema),
                title=spec.title or spec.name,
                annotations=deepcopy(spec.annotations),
            ))
        return definitions

    def resolve_one(self, name: str) -> ToolSpec:
        canonical_name = str(name or "").strip()
        if not canonical_name:
            raise RuntimeError("card_tool_name_empty")
        spec = self._specs.get(canonical_name)
        if spec is None:
            raise RuntimeError(
                f"card_tool_unknown: {canonical_name} (known: {','.join(self.known_names())})"
            )
        if not spec.enabled:
            raise RuntimeError(f"card_tool_disabled: {canonical_name}")
        # ToolSpec validation already guarantees complete schemas; re-check so a
        # mutated spec can never resolve silently.
        if not spec.inputSchema or not spec.outputSchema:
            raise RuntimeError(f"card_tool_schema_missing: {canonical_name}")
        return spec

    def resolve_selected(self, selected_names: list[str]) -> list[ToolSpec]:
        """Resolve exactly the selected set; public/provider reads grant nothing."""
        selected: list[str] = []
        seen_selected: set[str] = set()
        for name in selected_names or []:
            canonical = str(name or "").strip()
            if canonical in seen_selected:
                raise RuntimeError(f"card_tool_runtime_name_collision: {canonical}")
            self.resolve_one(canonical)
            seen_selected.add(canonical)
            selected.append(canonical)
        resolved: list[ToolSpec] = []
        runtime_names: set[str] = set()
        for name in selected:
            tool = self.resolve_one(name)
            if tool.name in runtime_names:
                raise RuntimeError(f"card_tool_runtime_name_collision: {tool.name}")
            runtime_names.add(tool.name)
            resolved.append(tool)
        return resolved

    async def invoke(self, name: str, arguments: dict[str, Any]) -> Any:
        """Invoke one registered private-runtime adapter with its exact arguments."""

        canonical_name = str(name or "").strip()
        self.resolve_one(canonical_name)
        value = self._adapters[canonical_name](**dict(arguments or {}))
        return await value if inspect.isawaitable(value) else value


def build_default_tool_registry() -> ToolRegistry:
    """The canonical runtime registry."""
    registry = ToolRegistry()
    for spec, adapter in [
        (
            ToolSpec(
                name="worldsignals.capabilities",
                title="WorldSignals capabilities",
                annotations={
                    "readOnlyHint": True, "destructiveHint": False,
                    "idempotentHint": True, "openWorldHint": True,
                },
                description=(
                    "Read a bounded live WorldSignals capability/command view. Filter by domain, "
                    "exact command, keyword, or read/write operation class; an exact command match "
                    "returns that command's current parameter schema."
                ),
                enabled=True,
                access="read",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "domain": {"type": "string"},
                        "command": {"type": "string"},
                        "keyword": {"type": "string"},
                        "operation_class": {"type": "string", "enum": ["read", "write"]},
                        "limit": {"type": "integer", "minimum": 1, "maximum": 50, "default": 25},
                    },
                    "required": [],
                    "additionalProperties": False,
                },
                outputSchema={"type": "object"},
            ),
            worldsignals_capabilities,
        ),
        (ToolSpec(name="worldsignals.command", title="Run a WorldSignals command", annotations={"readOnlyHint": False, "destructiveHint": True, "idempotentHint": False, "openWorldHint": True}, description="Run one real command from the WorldSignals command manifest.", enabled=True, access="write", inputSchema={"type": "object", "properties": {"command": {"type": "string"}, "arguments": {"type": "object"}}, "required": ["command"], "additionalProperties": False}, outputSchema={"type": "object"}), worldsignals_command),
        (
            ToolSpec(
                name="worldsignals.batch",
                title="Run WorldSignals commands",
                annotations={
                    "readOnlyHint": False, "destructiveHint": True,
                    "idempotentHint": False, "openWorldHint": True,
                },
                description="Run up to twenty real WorldSignals commands through its batch channel.",
                enabled=True,
                access="write",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "commands": {
                            "type": "array",
                            "maxItems": 20,
                            "items": {
                                "type": "object",
                                "properties": {
                                    "cmd": {"type": "string", "minLength": 1},
                                    "args": {"type": "object"},
                                },
                                "required": ["cmd"],
                                "additionalProperties": False,
                            },
                        }
                    },
                    "required": ["commands"],
                    "additionalProperties": False,
                },
                outputSchema={"type": "object"},
            ),
            worldsignals_batch,
        ),
        (ToolSpec(name="worldsignals.poll", title="Poll WorldSignals results", annotations={"readOnlyHint": False, "destructiveHint": True, "idempotentHint": False, "openWorldHint": True}, description="Destructively read and consume completed command results and pending WorldSignals tasks.", enabled=True, access="write", inputSchema={"type": "object", "properties": {}, "required": [], "additionalProperties": False}, outputSchema={"type": "object"}), worldsignals_poll),
        (ToolSpec(name="worldsignals.stream_events", title="Stream WorldSignals events", annotations={"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": True}, description="Read a bounded set of real-time events from the WorldSignals SSE channel.", enabled=True, access="read", inputSchema={"type": "object", "properties": {"max_events": {"type": "integer", "minimum": 1, "maximum": 20, "default": 1}, "timeout_seconds": {"type": "integer", "minimum": 1, "maximum": 30, "default": 15}}, "required": [], "additionalProperties": False}, outputSchema={"type": "object"}), worldsignals_stream_events),
        (
            ToolSpec(
                name="worldsignals.package",
                title="Collect a WorldSignals evidence package",
                annotations={
                    "readOnlyHint": True, "destructiveHint": False,
                    "idempotentHint": True, "openWorldHint": True,
                },
                description=(
                    "Run one live WorldSignals command only when its manifest classifies it "
                    "as read-only, then return one provenance-bound signal.package.v1 envelope. "
                    "Project, deck, Card, and Run scope are injected by the authenticated runtime; "
                    "the caller cannot supply or widen them."
                ),
                enabled=True,
                access="read",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "command": {"type": "string", "minLength": 1},
                        "reason": {"type": "string", "minLength": 1, "maxLength": 4000},
                        "arguments": {"type": "object"},
                        "domains": {
                            "type": "array", "maxItems": 16,
                            "items": {"type": "string", "minLength": 1},
                        },
                        "sourceRefs": {
                            "type": "array", "maxItems": 32,
                            "items": {"type": "string", "minLength": 1},
                        },
                        "maxAgeSeconds": {"type": ["integer", "null"], "minimum": 1, "maximum": 2592000},
                        "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 25},
                    },
                    "required": ["command", "reason"],
                    "additionalProperties": False,
                },
                outputSchema={
                    "type": "object",
                    "properties": {
                        "schemaVersion": {"const": "signal.package.v1"},
                        "packageId": {"type": "string"},
                        "query": {"type": "object"},
                        "candidates": {"type": "array", "maxItems": 100},
                    },
                    "required": ["schemaVersion", "packageId", "query", "candidates"],
                },
            ),
            _worldsignals_package_context_required,
        ),
    ]:
        registry.register(spec, adapter)
    registry.register(
        ToolSpec(
            name="current_datetime",
            title="Current date and time",
            annotations={
                "readOnlyHint": True, "destructiveHint": False,
                "idempotentHint": True, "openWorldHint": False,
            },
            description="Return the current UTC date and time in ISO-8601 format.",
            enabled=True,
            access="read",
            inputSchema={"type": "object", "properties": {}, "required": []},
            outputSchema={"type": "string", "description": "ISO-8601 UTC datetime"},
        ),
        tool_current_datetime,
    )
    registry.register(
        ToolSpec(
            name="calculator",
            title="Calculator",
            annotations={
                "readOnlyHint": True, "destructiveHint": False,
                "idempotentHint": True, "openWorldHint": False,
            },
            description="Evaluate a basic arithmetic expression and return the numeric result.",
            enabled=True,
            access="read",
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
            name="web_search",
            title="Search the web",
            annotations={
                "readOnlyHint": True, "destructiveHint": False,
                "idempotentHint": True, "openWorldHint": True,
            },
            description=(
                "Real web search via Tavily. Returns real result pages (url, title, domain, "
                "content excerpt, published date) for the agent to read and select. Read-only "
                "and never fabricates results; pair with graphiti.add_memory to persist selected "
                "real sources with provenance. Does not run automatically — the agent decides "
                "when a task needs external web sources."
            ),
            enabled=True,
            access="read",
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "max_results": {"type": "integer", "default": 5},
                },
                "required": ["query"],
            },
            outputSchema={
                "type": "object",
                "description": "Web-search result with per-result source metadata.",
                "properties": {
                    "ok": {"type": "boolean"},
                    "query": {"type": "string"},
                    "result_count": {"type": "integer"},
                    "results": {"type": "array"},
                    "error": {"type": "string"},
                },
            },
        ),
        web_search_tool,
        publishers=frozenset({"internal-plugin", "external-mcp"}),
    )
    registry.register(
        ToolSpec(
            name="find_recent_sec_filing_signals",
            title="Find recent SEC filing signals",
            annotations={
                "readOnlyHint": True, "destructiveHint": False,
                "idempotentHint": True, "openWorldHint": True,
            },
            description=(
                "Find recent SEC filings for an EXPLICITLY supplied issuer, form types, and "
                "bounded time window via the SEC filing provider. Read-only WorldSignals lane: "
                "returns typed filing-signal envelopes with provider status, issuer identity, "
                "form type, filing timestamp, the canonical SEC.gov filing URL, and a replay "
                "identity. Use it only when the selected task explicitly asks for an issuer's "
                "recent filings. Do not call it merely because a ticker is mentioned. It performs "
                "no graph write, no research execution, and no trade. Returns provider_unconfigured "
                "when the SEC provider is not configured; never fabricates filings."
            ),
            enabled=True,
            access="read",
            inputSchema={
                "type": "object",
                "properties": {
                    "form_types": {"type": "array", "items": {"type": "string"}},
                    "from_date": {"type": "string"},
                    "to_date": {"type": "string"},
                    "issuer_ticker": {"type": ["string", "null"]},
                    "issuer_cik": {"type": ["string", "null"]},
                    "issuer_company_name": {"type": ["string", "null"]},
                    "limit": {"type": "integer", "default": 10},
                },
                "required": ["form_types", "from_date", "to_date"],
            },
            outputSchema={
                "type": "object",
                "properties": {
                    "status": {
                        "type": "string",
                        "enum": [
                            "available",
                            "provider_unconfigured",
                            "provider_error",
                            "invalid_response",
                        ],
                    },
                    "provider": {"type": "string"},
                    "fetchedAt": {"type": "string"},
                    "replay": {"type": "object"},
                    "envelopes": {"type": "array"},
                    "error": {"type": ["string", "null"]},
                },
            },
        ),
        find_recent_sec_filing_signals_tool,
    )
    registry.register(
        ToolSpec(
            name="get_market_snapshot",
            title="Get a market snapshot",
            annotations={
                "readOnlyHint": True, "destructiveHint": False,
                "idempotentHint": True, "openWorldHint": True,
            },
            description=(
                "Read-only Alpaca latest market snapshot for an EXPLICITLY supplied symbol "
                "(paper data feed). Returns provider/feed identity, latest trade/quote, observed "
                "timestamp, freshness, and status. Use only when the selected task explicitly "
                "needs a symbol's latest market data. It places no order, mutates no position or "
                "account, and never calls a live trading endpoint. Returns provider_unconfigured "
                "when paper credentials are not configured; never fabricates a snapshot."
            ),
            enabled=True,
            access="read",
            inputSchema={
                "type": "object",
                "properties": {
                    "symbol": {"type": "string"},
                    "feed": {"type": "string", "default": "iex"},
                },
                "required": ["symbol"],
            },
            outputSchema={
                "type": "object",
                "properties": {
                    "provider": {"type": "string"},
                    "feed": {"type": ["string", "null"]},
                    "symbol": {"type": "string"},
                    "status": {"type": "string"},
                    "observedAt": {"type": ["string", "null"]},
                    "latestTradePrice": {"type": ["number", "null"]},
                    "freshness": {"type": ["string", "null"]},
                },
            },
        ),
        get_market_snapshot_tool,
    )
    registry.register(
        ToolSpec(
            name="get_historical_bars",
            title="Get historical market bars",
            annotations={
                "readOnlyHint": True, "destructiveHint": False,
                "idempotentHint": True, "openWorldHint": True,
            },
            description=(
                "Read-only Alpaca bounded historical bars for an EXPLICITLY supplied symbol and "
                "timeframe (paper data feed). Returns provider/feed identity, the bars, and "
                "status. Use only when the selected task explicitly needs historical bars. It "
                "places no order, mutates nothing, does no streaming, and never calls a live "
                "endpoint. Returns provider_unconfigured when paper credentials are not configured."
            ),
            enabled=True,
            access="read",
            inputSchema={
                "type": "object",
                "properties": {
                    "symbol": {"type": "string"},
                    "timeframe": {"type": "string"},
                    "start": {"type": ["string", "null"]},
                    "end": {"type": ["string", "null"]},
                    "limit": {"type": "integer", "default": 100},
                    "feed": {"type": "string", "default": "iex"},
                },
                "required": ["symbol", "timeframe"],
            },
            outputSchema={
                "type": "object",
                "properties": {
                    "provider": {"type": "string"},
                    "feed": {"type": ["string", "null"]},
                    "symbol": {"type": "string"},
                    "timeframe": {"type": "string"},
                    "status": {"type": "string"},
                    "bars": {"type": "array"},
                },
            },
        ),
        get_historical_bars_tool,
    )
    registry.register(
        ToolSpec(
            name="get_paper_account_readiness",
            title="Check paper account readiness",
            annotations={
                "readOnlyHint": True, "destructiveHint": False,
                "idempotentHint": True, "openWorldHint": True,
            },
            description=(
                "Confirm Alpaca PAPER account availability and status only. Read-only: it returns "
                "no positions, no orders, no balances, and mutates nothing. Use only to verify the "
                "paper account is reachable. Returns provider_unconfigured when paper credentials "
                "are not configured; never fabricates account state."
            ),
            enabled=True,
            access="read",
            inputSchema={"type": "object", "properties": {}, "required": []},
            outputSchema={
                "type": "object",
                "properties": {
                    "provider": {"type": "string"},
                    "status": {"type": "string"},
                    "mode": {"type": "string"},
                    "accountStatus": {"type": ["string", "null"]},
                },
            },
        ),
        get_paper_account_readiness_tool,
    )
    registry.register(
        ToolSpec(
            name="trading.get_state",
            title="Read paper trading state",
            annotations={
                "readOnlyHint": True, "destructiveHint": False,
                "idempotentHint": True, "openWorldHint": False,
            },
            description=(
                "Read this authenticated Trading Card's durable paper Trade Jobs, typed "
                "decisions, evidence, execution-block state, and recorded portfolio outcomes."
            ),
            enabled=True,
            access="read",
            inputSchema={"type": "object", "properties": {}, "required": []},
            outputSchema={"type": "object"},
        ),
        _trading_context_required,
    )
    registry.register(
        ToolSpec(
            name="trading.accept_assignment",
            title="Accept a paper trade assignment",
            annotations={
                "readOnlyHint": False, "destructiveHint": False,
                "idempotentHint": True, "openWorldHint": False,
            },
            description=(
                "Validate and persist one complete structured paper trade assignment as a "
                "Trade Job. Missing execution terms fail closed. This never submits an order."
            ),
            enabled=True,
            access="write",
            inputSchema={
                "type": "object",
                "properties": {
                    "plan": {"type": "object"},
                    "idempotencyKey": {"type": "string", "minLength": 1, "maxLength": 160},
                },
                "required": ["plan", "idempotencyKey"],
                "additionalProperties": False,
            },
            outputSchema={"type": "object"},
        ),
        _trading_context_required,
    )
    registry.register(
        ToolSpec(
            name="trading.record_decision",
            title="Record a paper trading decision",
            annotations={
                "readOnlyHint": False, "destructiveHint": False,
                "idempotentHint": True, "openWorldHint": False,
            },
            description=(
                "Journal one WAIT, ENTER, HOLD, REDUCE, EXIT, PAUSE, or FAIL_SAFE outcome "
                "against a durable Trade Job with evidence. A decision is not an order and "
                "executionRequested is always false."
            ),
            enabled=True,
            access="write",
            inputSchema={
                "type": "object",
                "properties": {
                    "jobId": {"type": "string", "format": "uuid"},
                    "action": {"type": "string", "enum": [
                        "WAIT", "ENTER", "HOLD", "REDUCE", "EXIT", "PAUSE", "FAIL_SAFE",
                    ]},
                    "rationale": {"type": "string", "minLength": 1, "maxLength": 8_000},
                    "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                    "evidence": {"type": "array", "maxItems": 64, "items": {"type": "object"}},
                    "missingTerms": {
                        "type": "array", "maxItems": 32,
                        "items": {"type": "string", "minLength": 1},
                    },
                    "idempotencyKey": {"type": "string", "minLength": 1, "maxLength": 160},
                },
                "required": [
                    "jobId", "action", "rationale", "confidence", "evidence",
                    "missingTerms", "idempotencyKey",
                ],
                "additionalProperties": False,
            },
            outputSchema={"type": "object"},
        ),
        _trading_context_required,
    )
    return registry


DEFAULT_TOOL_REGISTRY = build_default_tool_registry()

_OPERATION_DEFINITIONS: tuple[OperationDefinition, ...] | None = None
_OPERATION_DEFINITIONS_LOCK = threading.Lock()
_DISCOVERED_EXTERNAL_OPERATIONS: dict[str, tuple[OperationDefinition, ...]] = {}
_DISCOVERED_EXTERNAL_OPERATIONS_LOCK = threading.RLock()


def _static_operation_definitions() -> tuple[OperationDefinition, ...]:
    """Assemble code-owned operations once; provider MCP catalogs stay external."""

    global _OPERATION_DEFINITIONS
    if _OPERATION_DEFINITIONS is not None:
        return _OPERATION_DEFINITIONS
    with _OPERATION_DEFINITIONS_LOCK:
        if _OPERATION_DEFINITIONS is not None:
            return _OPERATION_DEFINITIONS
        from app import mcp_host
        from app.python_models import engraphis

        contributed = [
            *DEFAULT_TOOL_REGISTRY.operation_definitions(),
            *mcp_host.application_operation_definitions(),
            *engraphis.operation_definitions(),
        ]
        contributed = [
            replace(
                definition,
                dispatcher_context_arguments=mcp_host.dispatcher_context_arguments_for(
                    definition.canonical_id
                ),
            )
            if (
                not definition.dispatcher_context_arguments
                and mcp_host.dispatcher_context_arguments_for(definition.canonical_id)
            ) else definition
            for definition in contributed
        ]
        by_id: dict[str, OperationDefinition] = {}
        for definition in contributed:
            if definition.canonical_id in by_id:
                raise RuntimeError(
                    f"operation_definition_duplicate:{definition.canonical_id}"
                )
            by_id[definition.canonical_id] = definition
        _OPERATION_DEFINITIONS = tuple(by_id[key] for key in sorted(by_id))
        return _OPERATION_DEFINITIONS


def replace_discovered_external_operations(
    source_id: str,
    definitions: list[OperationDefinition] | tuple[OperationDefinition, ...],
) -> None:
    """Atomically replace one provider owner's live catalog contribution.

    The provider MCP server supplies exact identities, schemas, descriptions and
    effect annotations. LiquidAIty validates that metadata but never copies a
    version-specific operation list into source.
    """

    canonical_source = str(source_id or "").strip()
    if not canonical_source or canonical_source == "main_mcp":
        raise RuntimeError("external_operation_source_invalid")
    candidates = tuple(definitions)
    by_id: dict[str, OperationDefinition] = {}
    for definition in candidates:
        if not isinstance(definition, OperationDefinition):
            raise RuntimeError("external_operation_definition_invalid")
        if definition.external_source_id != canonical_source:
            raise RuntimeError(
                f"external_operation_source_mismatch:{definition.canonical_id}"
            )
        if definition.publishers != frozenset({"external-mcp"}):
            raise RuntimeError(
                f"external_operation_publication_invalid:{definition.canonical_id}"
            )
        if not definition.available:
            raise RuntimeError(
                f"external_operation_availability_invalid:{definition.canonical_id}"
            )
        if definition.canonical_id in by_id:
            raise RuntimeError(
                f"external_operation_duplicate:{definition.canonical_id}"
            )
        by_id[definition.canonical_id] = definition

    static_ids = {
        definition.canonical_id for definition in _static_operation_definitions()
    }
    with _DISCOVERED_EXTERNAL_OPERATIONS_LOCK:
        other_ids = {
            definition.canonical_id
            for owner, owner_definitions in _DISCOVERED_EXTERNAL_OPERATIONS.items()
            if owner != canonical_source
            for definition in owner_definitions
        }
        collisions = sorted((static_ids | other_ids) & set(by_id))
        if collisions:
            raise RuntimeError(
                "external_operation_identity_collision:" + ",".join(collisions)
            )
        _DISCOVERED_EXTERNAL_OPERATIONS[canonical_source] = tuple(
            by_id[key] for key in sorted(by_id)
        )


def operation_definitions() -> tuple[OperationDefinition, ...]:
    """Return code-owned operations plus current provider MCP discoveries."""

    static_definitions = _static_operation_definitions()
    with _DISCOVERED_EXTERNAL_OPERATIONS_LOCK:
        discovered = tuple(
            definition
            for source_id in sorted(_DISCOVERED_EXTERNAL_OPERATIONS)
            for definition in _DISCOVERED_EXTERNAL_OPERATIONS[source_id]
        )
    return tuple(sorted(
        (*static_definitions, *discovered),
        key=lambda definition: definition.canonical_id,
    ))


def operation_definition(name: str) -> OperationDefinition | None:
    canonical_name = str(name or "").strip()
    return next(
        (
            definition
            for definition in operation_definitions()
            if definition.canonical_id == canonical_name
        ),
        None,
    )


def _publisher_manifest(
    publisher: str,
    *,
    registry: ToolRegistry | None = None,
) -> list[dict[str, Any]]:
    definitions = (
        registry.operation_definitions()
        if registry is not None
        else operation_definitions()
    )
    manifest: list[dict[str, Any]] = []
    for definition in definitions:
        if publisher not in definition.publishers or not definition.available:
            continue
        if publisher == "external-mcp" and definition.external_source_id != "main_mcp":
            continue
        source_id = "python_runtime" if publisher == "internal-plugin" else "main_mcp"
        annotations = deepcopy(definition.annotations or {})
        required_hints = {
            "readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint",
        }
        if not required_hints.issubset(annotations):
            missing = ",".join(sorted(required_hints - set(annotations)))
            raise RuntimeError(
                f"operation_annotations_missing:{definition.canonical_id}:{missing}"
            )
        canonical_input_schema = deepcopy(definition.parameters_schema)
        canonical_input_schema.setdefault("additionalProperties", False)
        connection_kind = (
            "private-runtime" if publisher == "internal-plugin" else "external-mcp"
        )
        input_schema = deepcopy(canonical_input_schema)
        manifest.append({
            "name": definition.canonical_id,
            "title": definition.title or definition.canonical_id,
            "providerToolName": definition.canonical_id,
            "kind": "tool",
            "sourceId": source_id,
            "namespace": definition.namespace,
            "connectionKind": connection_kind,
            "publication": connection_kind,
            "description": definition.description,
            "enabled": definition.available,
            "available": definition.available,
            "grantEligible": definition.grant_eligible,
            "access": definition.access,
            "annotations": annotations,
            "inputSchema": input_schema,
            "canonicalInputSchema": canonical_input_schema,
            "serverInjectedArguments": sorted(definition.server_injected_arguments),
            "dispatcherContextArguments": sorted(definition.dispatcher_context_arguments),
            "dispatcherOwner": definition.dispatcher_owner,
            "authenticatedProjection": False,
            **(
                {
                    "requiredCallerRuntimeKind": definition.required_caller_runtime[0],
                    "requiredCallerRuntimeMode": definition.required_caller_runtime[1],
                }
                if definition.required_caller_runtime is not None else {}
            ),
            **(
                {"outputSchema": deepcopy(definition.output_schema)}
                if definition.output_schema is not None
                else {}
            ),
        })
    return manifest


def tool_manifest(registry: ToolRegistry | None = None) -> list[dict[str, Any]]:
    """Derived view for the Hermes plugin publisher."""

    return _publisher_manifest("internal-plugin", registry=registry)


def external_mcp_manifest() -> list[dict[str, Any]]:
    """Derived view containing only operations permitted on LiquidAIty MCP."""

    return _publisher_manifest("external-mcp")
