"""AgentGraph, Canvas, and saved Card operation definitions."""
# Entity: Tool Catalog
# Relationship: This file publishes the explicit grantable operation definitions, schemas, access modes, annotations, and injected scope for Card and topology capabilities.
#
# Entity: AgentGraph
# Relationship: This file defines the bounded Project-scoped AgentGraph inspection operation without exposing prompts or model input.
#
# Entity: Saved Cards
# Relationship: This file defines explicit operations for inspecting, creating, and revision-checking configuration changes to saved Cards without running them.
#
# Entity: Card Topology
# Relationship: This file defines the single-connection update operation for persisted orange or blue topology without executing agents.

from __future__ import annotations

# Entity: CodeGraph
# Relationship: Publishes the Builder-only operation for the same Project category selection used by the graph configuration UI.

from app.application_operation_handlers import (
    agentgraph_inspect,
    canvas_inspect_operation,
    codegraph_configure,
    canvas_upsert_wire_operation,
    card_create_operation,
    card_update_configuration_operation,
)
from app.python_models.operation_definition import OperationDefinition
from app.saved_canvas_tools import saved_canvas_operation_schema
from app.saved_card_operation_schema import saved_card_operation_schema


def agentgraph_operation_definitions(
    external: frozenset[str],
) -> list[OperationDefinition]:
    return [
        OperationDefinition(
            canonical_id="agentgraph.inspect",
            title="Inspect AgentGraph",
            description=(
                "Read a bounded, authenticated Project-scoped view of current PostgreSQL/AGE "
                "Card relationships plus exact run, lineage, and artifact observations. "
                "runId selects one exact Run; otherwise the authenticated conversation is "
                "selected. cardId filters its direct Runs. projectWide reads across the "
                "authenticated Project, before limits. No prompt or model input is returned."
            ),
            parameters_schema={
                "type": "object",
                "properties": {
                    "runId": {"type": "string"},
                    "cardId": {"type": "string"},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 50, "default": 20},
                    "projectWide": {"type": "boolean", "default": False},
                },
                "required": [],
            },
            handler=agentgraph_inspect,
            available=True,
            publishers=external,
            access="read",
            namespace="main",
            grant_eligible=True,
            annotations={
                "readOnlyHint": True,
                "destructiveHint": False,
                "idempotentHint": True,
                "openWorldHint": False,
            },
            dispatcher_context_arguments=frozenset({
                "projectId", "deckId", "conversationId",
            }),
        ),
    ]


def canvas_card_operation_definitions(
    external: frozenset[str],
) -> list[OperationDefinition]:
    return [
        OperationDefinition(
            canonical_id='codegraph.configure',
            title='Configure visible Code categories',
            description=('Read available category IDs and the current selection in this Project’s open graph view. '
                         'Pass enable to add only those IDs or disable to remove only those IDs. '
                         'When Code is on, enabling a category puts its code into the shared view for Main and the user. '
                         'Omit changes to read the user’s current selection and selected file references. '
                         'Code off means no selection changes; never override the user’s master switch. Reading source never changes selection. '
                         'Does not edit source, graph records, Cards, or any other layer. '
                         'No matching active view means no change.'),
            parameters_schema={'type': 'object', 'properties': {
                'projectId': {'type': 'string', 'minLength': 1},
                'enable': {'type': 'array', 'items': {'type': 'string'}},
                'disable': {'type': 'array', 'items': {'type': 'string'}},
            }, 'additionalProperties': False},
            handler=codegraph_configure, available=True, publishers=external,
            access='write', namespace='main', grant_eligible=True,
            grant_profiles=frozenset({'builder'}),
            server_injected_arguments=frozenset({'projectId'}),
            dispatcher_context_arguments=frozenset({'projectId'}),
            annotations={'readOnlyHint': False, 'destructiveHint': False,
                         'idempotentHint': True, 'openWorldHint': False},
        ),
        OperationDefinition(
            canonical_id="canvas.inspect",
            title="Inspect the saved Canvas",
            description=(
                "Read the saved deck; optionally inspect one exact Card with its editable "
                "configuration, revisions and current IDD/catalog choices."
            ),
            parameters_schema=saved_canvas_operation_schema("canvas.inspect"),
            handler=canvas_inspect_operation,
            available=True,
            publishers=external,
            access="read",
            namespace="main",
            grant_eligible=True,
            annotations={
                "readOnlyHint": True,
                "destructiveHint": False,
                "idempotentHint": True,
                "openWorldHint": False,
            },
            server_injected_arguments=frozenset({"projectId", "deckId"}),
            dispatcher_context_arguments=frozenset({"projectId", "deckId"}),
        ),
        OperationDefinition(
            canonical_id="card.create",
            title="Create a saved Card",
            description=(
                "Create one saved Card with explicit configuration and expected deck revision. "
                "Honor its requested Card profile. Does not run the Card or create wires."
            ),
            parameters_schema=saved_card_operation_schema("card.create"),
            handler=card_create_operation,
            available=True,
            publishers=external,
            access="write",
            namespace="main",
            grant_eligible=True,
            annotations={
                "readOnlyHint": False,
                "destructiveHint": False,
                "idempotentHint": False,
                "openWorldHint": False,
            },
            server_injected_arguments=frozenset({"projectId", "deckId"}),
            dispatcher_context_arguments=frozenset({
                "projectId", "deckId", "_callerCardId",
            }),
        ),
        OperationDefinition(
            canonical_id="card.update_configuration",
            title="Update saved Card configuration",
            description=(
                "Update one exact saved Card using current deck and Card revision IDs. "
                "Preserve unspecified fields. Does not run the Card."
            ),
            parameters_schema=saved_card_operation_schema("card.update_configuration"),
            handler=card_update_configuration_operation,
            available=True,
            publishers=external,
            access="write",
            namespace="main",
            grant_eligible=True,
            annotations={
                "readOnlyHint": False,
                "destructiveHint": True,
                "idempotentHint": True,
                "openWorldHint": False,
            },
            server_injected_arguments=frozenset({"projectId", "deckId"}),
            dispatcher_context_arguments=frozenset({
                "projectId", "deckId", "_callerCardId",
            }),
        ),
        OperationDefinition(
            canonical_id="canvas.upsert_wire",
            title="Change a saved Canvas wire",
            description=(
                "Create/update/remove ONE saved canvas wire. Supported wire types only: "
                "'flow' and 'magentic_option'. Blue means worker availability to Magnetic and "
                "endpoint order has no runtime meaning. A wire is persisted visible "
                "configuration — it never runs agents."
            ),
            parameters_schema=saved_canvas_operation_schema("canvas.upsert_wire"),
            handler=canvas_upsert_wire_operation,
            available=True,
            publishers=external,
            access="write",
            namespace="main",
            grant_eligible=True,
            annotations={
                "readOnlyHint": False,
                "destructiveHint": True,
                "idempotentHint": True,
                "openWorldHint": False,
            },
            server_injected_arguments=frozenset({"projectId", "deckId"}),
            dispatcher_context_arguments=frozenset({
                "projectId", "deckId", "_callerCardId",
            }),
        ),
    ]
