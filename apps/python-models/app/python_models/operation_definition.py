"""One authored definition for every callable product operation."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable


_OPERATION_PUBLISHERS = frozenset({
    "internal-plugin",
    "external-mcp",
    "internal-runtime",
})


@dataclass(frozen=True)
class OperationDefinition:
    """One canonical operation independent of any publication transport."""

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
        if (
            not isinstance(self.parameters_schema, dict)
            or self.parameters_schema.get("type") != "object"
        ):
            raise RuntimeError(f"operation_parameters_invalid:{self.canonical_id}")
        if self.external_source_id == "python_runtime" and (
            self.output_schema is None
            or not isinstance(self.output_schema, dict)
            or not str(self.output_schema.get("type") or "").strip()
        ):
            raise RuntimeError(f"operation_output_schema_invalid:{self.canonical_id}")
        if self.output_schema is not None and (
            not isinstance(self.output_schema, dict)
        ):
            raise RuntimeError(f"operation_output_schema_invalid:{self.canonical_id}")
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
            if not isinstance(self.annotations, dict):
                raise RuntimeError(
                    f"operation_annotations_invalid:{self.canonical_id}"
                )
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
            or any(
                not isinstance(field, str) or not field
                for field in self.server_injected_arguments
            )
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
                raise RuntimeError(
                    f"operation_dispatcher_owner_missing:{self.canonical_id}"
                )
            object.__setattr__(self, "dispatcher_owner", owner)


def allowed_operation_keys(definition: OperationDefinition) -> set[str]:
    """Derive dispatch keys from the authored schema and declared context."""

    properties = definition.parameters_schema.get("properties")
    if not isinstance(properties, dict):
        raise RuntimeError(
            f"operation_parameters_properties_invalid:{definition.canonical_id}"
        )
    return set(properties) | set(definition.dispatcher_context_arguments)
