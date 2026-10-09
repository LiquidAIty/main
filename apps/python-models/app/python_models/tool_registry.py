"""Canonical operation lookup and live provider registration."""

from __future__ import annotations

import threading
from typing import Iterable

from app.python_models.operation_definition import OperationDefinition


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

_CODE_OWNED_OPERATION_DEFINITIONS: tuple[OperationDefinition, ...] | None = None
_CODE_OWNED_OPERATION_DEFINITIONS_LOCK = threading.Lock()
_DISCOVERED_EXTERNAL_OPERATIONS: dict[str, tuple[OperationDefinition, ...]] = {}
_DISCOVERED_EXTERNAL_OPERATIONS_LOCK = threading.RLock()


def graphiti_operation_policy(canonical_id: str) -> dict[str, object] | None:
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


def python_operation_definitions() -> list[OperationDefinition]:
    """Assemble Python-owned definitions in their canonical family order."""

    from app.python_models.general_tool_operations import (
        general_tool_operation_definitions,
    )
    from app.python_models.market_sec_tool_operations import (
        market_sec_tool_operation_definitions,
    )
    from app.python_models.trading_tool_operations import (
        trading_tool_operation_definitions,
    )
    from app.python_models.worldsignals_tool_operations import (
        worldsignals_tool_operation_definitions,
    )

    return [
        *worldsignals_tool_operation_definitions(),
        *general_tool_operation_definitions(),
        *market_sec_tool_operation_definitions(),
        *trading_tool_operation_definitions(),
    ]


def code_owned_operation_definitions() -> tuple[OperationDefinition, ...]:
    """Assemble the three code-owned definition families exactly once."""

    global _CODE_OWNED_OPERATION_DEFINITIONS
    if _CODE_OWNED_OPERATION_DEFINITIONS is not None:
        return _CODE_OWNED_OPERATION_DEFINITIONS
    with _CODE_OWNED_OPERATION_DEFINITIONS_LOCK:
        if _CODE_OWNED_OPERATION_DEFINITIONS is not None:
            return _CODE_OWNED_OPERATION_DEFINITIONS
        from app.application_operation_catalog import (
            application_operation_definitions,
        )
        from app.python_models import engraphis_operations
        contributed = [
            *python_operation_definitions(),
            *application_operation_definitions(),
            *engraphis_operations.operation_definitions(),
        ]
        by_id: dict[str, OperationDefinition] = {}
        for definition in contributed:
            if definition.canonical_id in by_id:
                raise RuntimeError(
                    f"operation_definition_duplicate:{definition.canonical_id}"
                )
            by_id[definition.canonical_id] = definition
        _CODE_OWNED_OPERATION_DEFINITIONS = tuple(
            by_id[key] for key in sorted(by_id)
        )
        return _CODE_OWNED_OPERATION_DEFINITIONS


def replace_discovered_external_operations(
    source_id: str,
    definitions: Iterable[OperationDefinition],
) -> None:
    """Atomically replace one provider owner's live catalog contribution."""

    canonical_source = str(source_id or "").strip()
    if not canonical_source or canonical_source == "main_mcp":
        raise RuntimeError("external_operation_source_invalid")
    by_id: dict[str, OperationDefinition] = {}
    for definition in tuple(definitions):
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

    code_owned_ids = {
        definition.canonical_id for definition in code_owned_operation_definitions()
    }
    with _DISCOVERED_EXTERNAL_OPERATIONS_LOCK:
        other_ids = {
            definition.canonical_id
            for owner, owner_definitions in _DISCOVERED_EXTERNAL_OPERATIONS.items()
            if owner != canonical_source
            for definition in owner_definitions
        }
        collisions = sorted((code_owned_ids | other_ids) & set(by_id))
        if collisions:
            raise RuntimeError(
                "external_operation_identity_collision:" + ",".join(collisions)
            )
        _DISCOVERED_EXTERNAL_OPERATIONS[canonical_source] = tuple(
            by_id[key] for key in sorted(by_id)
        )


def operation_definitions() -> tuple[OperationDefinition, ...]:
    """Return code-owned operations plus current provider MCP discoveries."""

    with _DISCOVERED_EXTERNAL_OPERATIONS_LOCK:
        discovered = tuple(
            definition
            for source_id in sorted(_DISCOVERED_EXTERNAL_OPERATIONS)
            for definition in _DISCOVERED_EXTERNAL_OPERATIONS[source_id]
        )
    return tuple(sorted(
        (*code_owned_operation_definitions(), *discovered),
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


def required_tool_caller_runtime(name: str) -> dict[str, str] | None:
    """Return one explicit runtime requirement; never infer one from a name."""

    definition = operation_definition(name)
    if definition is None or definition.required_caller_runtime is None:
        return None
    kind, mode = definition.required_caller_runtime
    return {"kind": kind, "mode": mode}


def tool_access(name: str) -> str | None:
    """Return explicit effect metadata; never infer it from prose or names."""

    definition = operation_definition(name)
    return definition.access if definition is not None else None


def card_tool_selection_is_eligible(name: str) -> bool:
    """Return whether one exact live definition may be saved as a Card grant."""

    definition = operation_definition(name)
    return bool(
        definition is not None
        and definition.available
        and definition.grant_eligible
        and bool(
            definition.publishers
            & {"internal-plugin", "internal-runtime", "external-mcp"}
        )
    )
