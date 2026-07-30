"""Database-owned registered queries and bounded Graph View materialization.

Prompts and tool calls may select only a saved binding identity plus typed
parameters. Raw SQL/Cypher is accepted only while an immutable operation version
is authored; prompts can pass only stable operation/version references.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
from dataclasses import dataclass
from datetime import date, datetime
from hashlib import sha256
from typing import Any
from uuid import UUID, uuid4

from autogen_core.tools import FunctionTool

from app.python_models.postgres import connect_postgres


_IDENTITY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$")
_PARAMETER_TYPES = {"string", "integer", "number", "boolean", "date", "datetime", "uuid"}
_SQL_WRITE_WORDS = {
    "alter", "analyze", "call", "comment", "copy", "create", "delete", "do", "drop",
    "execute", "grant", "insert", "lock", "merge", "refresh", "reindex", "reset",
    "revoke", "security", "set", "truncate", "update", "vacuum",
}
_CYPHER_WRITE_WORDS = {
    "call", "create", "delete", "detach", "drop", "foreach", "load", "merge",
    "remove", "set",
}
_MAX_PARAMETERS = 16
_MAX_PARAMETER_TEXT = 500
_MAX_RESULT_COLUMNS = 64
_MAX_RESULT_CELL_CHARS = 4000
_MAX_GRAPH_VIEW_RESULT_CHARS = 64_000
_MAX_SELECTED_GRAPH_VIEWS = 16
_MAX_SELECTED_GRAPH_VIEW_CONTEXT_CHARS = 64_000


@dataclass(frozen=True)
class RegisteredQueryVersion:
    project_id: str
    query_id: str
    version: int
    database_authority: str
    database_name: str
    title: str
    language: str
    statement: str
    parameter_schema: dict[str, dict[str, Any]]
    row_limit: int
    timeout_ms: int


@dataclass(frozen=True)
class QueryBinding:
    project_id: str
    card_id: str
    binding_id: str
    query_id: str
    query_version: int
    delivery_mode: str
    parameters: dict[str, Any]


@dataclass(frozen=True)
class QueryExecution:
    execution_id: str
    binding_id: str
    query_id: str
    query_version: int
    parameters: dict[str, Any]
    graph_view_id: str
    rows: list[dict[str, Any]]
    truncated: bool


@dataclass(frozen=True)
class HydratedAssignmentContext:
    instruction: str
    claim_token: str
    optional_bindings: tuple[QueryBinding, ...]
    model_context: str


def _required_identity(value: Any, field: str) -> str:
    text = str(value or "").strip()
    if not _IDENTITY.fullmatch(text):
        raise ValueError(f"registered_query_{field}_invalid")
    return text


def _required_text(value: Any, field: str, *, maximum: int = 4000) -> str:
    text = str(value or "").strip()
    if not text or len(text) > maximum:
        raise ValueError(f"registered_query_{field}_invalid")
    return text


def _json_object(value: Any, field: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"registered_query_{field}_must_be_object")
    return dict(value)


def _rows(cursor: Any) -> list[dict[str, Any]]:
    columns = [description.name if hasattr(description, "name") else description[0]
               for description in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


def _json_value(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool, list, dict)):
        return value
    if isinstance(value, (datetime, date, UUID)):
        return value.isoformat() if not isinstance(value, UUID) else str(value)
    try:
        parsed = json.loads(str(value))
        return parsed
    except (TypeError, ValueError):
        return str(value)


def _strip_literals_and_comments(statement: str) -> str:
    """Remove quoted/comment content before structural read-only checks."""
    output: list[str] = []
    index = 0
    state = "code"
    while index < len(statement):
        char = statement[index]
        following = statement[index + 1] if index + 1 < len(statement) else ""
        if state == "code":
            if char == "'":
                state = "single"
                output.append(" ")
            elif char == '"':
                state = "double"
                output.append(" ")
            elif char == "-" and following == "-":
                state = "line_comment"
                output.extend((" ", " "))
                index += 1
            elif char == "/" and following == "*":
                state = "block_comment"
                output.extend((" ", " "))
                index += 1
            else:
                output.append(char)
        elif state == "single":
            output.append(" ")
            if char == "'" and following == "'":
                output.append(" ")
                index += 1
            elif char == "'":
                state = "code"
        elif state == "double":
            output.append(" ")
            if char == '"' and following == '"':
                output.append(" ")
                index += 1
            elif char == '"':
                state = "code"
        elif state == "line_comment":
            output.append("\n" if char == "\n" else " ")
            if char == "\n":
                state = "code"
        else:
            output.append(" ")
            if char == "*" and following == "/":
                output.append(" ")
                index += 1
                state = "code"
        index += 1
    if state in {"single", "double", "block_comment"}:
        raise ValueError("registered_query_statement_unterminated_literal_or_comment")
    return "".join(output)


def validate_parameter_schema(schema: Any) -> dict[str, dict[str, Any]]:
    raw = _json_object(schema, "parameter_schema")
    if len(raw) > _MAX_PARAMETERS:
        raise ValueError("registered_query_parameter_schema_too_large")
    normalized: dict[str, dict[str, Any]] = {}
    for name, definition in raw.items():
        clean_name = _required_identity(name, "parameter_name")
        if clean_name.startswith("__liquidaity_"):
            raise ValueError("registered_query_parameter_name_reserved")
        spec = _json_object(definition, f"parameter_{clean_name}")
        unknown = set(spec) - {"type", "required", "default", "minimum", "maximum", "enum", "maxLength"}
        if unknown:
            raise ValueError(
                f"registered_query_parameter_schema_keys_unknown: {clean_name}:{','.join(sorted(unknown))}"
            )
        parameter_type = str(spec.get("type") or "").strip()
        if parameter_type not in _PARAMETER_TYPES:
            raise ValueError(f"registered_query_parameter_type_invalid: {clean_name}")
        normalized[clean_name] = {
            "type": parameter_type,
            "required": bool(spec.get("required", False)),
            **({"default": spec["default"]} if "default" in spec else {}),
            **({"minimum": spec["minimum"]} if "minimum" in spec else {}),
            **({"maximum": spec["maximum"]} if "maximum" in spec else {}),
            **({"enum": list(spec["enum"])} if isinstance(spec.get("enum"), list) else {}),
            **({"maxLength": int(spec["maxLength"])} if "maxLength" in spec else {}),
        }
    return normalized


def validate_parameters(
    schema: dict[str, dict[str, Any]],
    parameters: Any,
) -> dict[str, Any]:
    supplied = _json_object(parameters, "parameters")
    unknown = set(supplied) - set(schema)
    if unknown:
        raise ValueError(f"registered_query_parameters_unknown: {','.join(sorted(unknown))}")
    output: dict[str, Any] = {}
    for name, spec in schema.items():
        if name in supplied:
            value = supplied[name]
        elif "default" in spec:
            value = spec["default"]
        elif spec.get("required"):
            raise ValueError(f"registered_query_parameter_required: {name}")
        else:
            continue
        kind = spec["type"]
        if kind == "string":
            if not isinstance(value, str):
                raise ValueError(f"registered_query_parameter_type_mismatch: {name}")
            maximum = min(int(spec.get("maxLength", _MAX_PARAMETER_TEXT)), _MAX_PARAMETER_TEXT)
            if len(value) > maximum:
                raise ValueError(f"registered_query_parameter_too_long: {name}")
        elif kind == "integer":
            if isinstance(value, bool) or not isinstance(value, int):
                raise ValueError(f"registered_query_parameter_type_mismatch: {name}")
        elif kind == "number":
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise ValueError(f"registered_query_parameter_type_mismatch: {name}")
        elif kind == "boolean":
            if not isinstance(value, bool):
                raise ValueError(f"registered_query_parameter_type_mismatch: {name}")
        elif kind == "uuid":
            try:
                value = str(UUID(str(value)))
            except (TypeError, ValueError, AttributeError) as error:
                raise ValueError(f"registered_query_parameter_type_mismatch: {name}") from error
        elif kind in {"date", "datetime"}:
            if not isinstance(value, str):
                raise ValueError(f"registered_query_parameter_type_mismatch: {name}")
            try:
                date.fromisoformat(value) if kind == "date" else datetime.fromisoformat(
                    value.replace("Z", "+00:00")
                )
            except ValueError as error:
                raise ValueError(f"registered_query_parameter_type_mismatch: {name}") from error
        if "minimum" in spec and value < spec["minimum"]:
            raise ValueError(f"registered_query_parameter_below_minimum: {name}")
        if "maximum" in spec and value > spec["maximum"]:
            raise ValueError(f"registered_query_parameter_above_maximum: {name}")
        if "enum" in spec and value not in spec["enum"]:
            raise ValueError(f"registered_query_parameter_not_allowed: {name}")
        output[name] = value
    return output


def validate_read_only_statement(language: str, statement: Any) -> str:
    clean_language = str(language or "").strip().lower()
    text = _required_text(statement, "statement", maximum=100_000)
    if ";" in _strip_literals_and_comments(text) or "$$" in text:
        raise ValueError("registered_query_multiple_or_unsafe_statement_rejected")
    code = _strip_literals_and_comments(text)
    words = [word.lower() for word in re.findall(r"[A-Za-z_][A-Za-z0-9_]*", code)]
    if clean_language == "sql":
        if not words or words[0] not in {"select", "with"}:
            raise ValueError("registered_query_sql_must_be_select")
        blocked = sorted(set(words) & _SQL_WRITE_WORDS)
        if blocked:
            raise ValueError(f"registered_query_sql_write_rejected: {','.join(blocked)}")
    elif clean_language == "cypher":
        if not words or words[0] not in {"match", "optional", "unwind", "with", "return"}:
            raise ValueError("registered_query_cypher_must_be_read")
        blocked = sorted(set(words) & _CYPHER_WRITE_WORDS)
        if blocked:
            raise ValueError(f"registered_query_cypher_write_rejected: {','.join(blocked)}")
        if "limit" in words:
            raise ValueError("registered_query_cypher_limit_owned_by_registry")
        if not re.search(r"\bRETURN\b[\s\S]+\bAS\s+result\s*$", code, re.IGNORECASE):
            raise ValueError("registered_query_cypher_must_return_one_result_column")
    else:
        raise ValueError(f"registered_query_language_invalid: {clean_language}")
    return text


def resolve_registered_version(
    project_id: str,
    query_id: str,
    version: int,
    *,
    connection: Any | None = None,
) -> RegisteredQueryVersion:
    own = connection is None
    connection = connection or connect_postgres()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT q.project_id, q.query_id, v.version,
                       q.database_authority, q.database_name, q.title, v.language,
                       v.statement, v.parameter_schema, v.row_limit, v.timeout_ms
                FROM ag_catalog.registered_queries q
                JOIN ag_catalog.registered_query_versions v
                  ON v.project_id=q.project_id AND v.query_id=q.query_id
                WHERE q.project_id=%s AND q.query_id=%s AND v.version=%s
                """,
                (
                    _required_identity(project_id, "project_id"),
                    _required_identity(query_id, "query_id"),
                    int(version),
                ),
            )
            row = cursor.fetchone()
    finally:
        if own:
            connection.close()
    if row is None:
        raise LookupError(f"registered_query_not_found: {query_id}@v{version}")
    schema = row[8] if isinstance(row[8], dict) else json.loads(str(row[8]))
    language = str(row[6])
    statement = validate_read_only_statement(language, row[7])
    return RegisteredQueryVersion(
        project_id=row[0],
        query_id=row[1],
        version=row[2],
        database_authority=row[3],
        database_name=row[4],
        title=row[5],
        language=language,
        statement=statement,
        parameter_schema=validate_parameter_schema(schema),
        row_limit=row[9],
        timeout_ms=row[10],
    )


def bindings_from_operation_references(
    *,
    project_id: str,
    card_id: str,
    references: list[dict[str, Any]],
) -> list[QueryBinding]:
    """Hydrate exact instruction-approved handles for this assignment."""
    bindings: list[QueryBinding] = []
    for index, reference in enumerate(references):
        query_id = _required_identity(reference.get("operationId"), "query_id")
        version = int(reference.get("version") or 0)
        operation = resolve_registered_version(project_id, query_id, version)
        parameters = validate_parameters(
            operation.parameter_schema,
            reference.get("parameters") or {},
        )
        execution_role = str(reference.get("executionRole") or "").strip()
        if execution_role not in {"required_context", "optional_tool"}:
            raise ValueError("registered_operation_execution_role_invalid")
        bindings.append(
            QueryBinding(
                project_id=project_id,
                card_id=card_id,
                binding_id=_required_identity(
                    reference.get("referenceId") or f"operation-ref:{index + 1}",
                    "binding_id",
                ),
                query_id=query_id,
                query_version=version,
                delivery_mode=(
                    "required" if execution_role == "required_context" else "optional"
                ),
                parameters=parameters,
            )
        )
    return bindings


def _execute_read_only(
    query: RegisteredQueryVersion,
    parameters: dict[str, Any],
) -> tuple[list[dict[str, Any]], bool]:
    configured_database = os.environ.get("POSTGRES_DB", "liquidaity")
    if query.database_name != configured_database:
        raise ValueError(
            f"registered_query_database_scope_mismatch: {query.database_name}!={configured_database}"
        )
    bounded = validate_parameters(query.parameter_schema, parameters)
    with connect_postgres(autocommit=False) as connection:
        with connection.cursor() as cursor:
            cursor.execute("SET TRANSACTION READ ONLY")
            cursor.execute(f"SET LOCAL statement_timeout = '{query.timeout_ms}ms'")
            if query.language == "sql":
                if query.database_authority != "postgresql":
                    raise ValueError("registered_query_authority_language_mismatch")
                wrapped = (
                    f"SELECT * FROM ({query.statement}) AS registered_query_result "
                    "LIMIT %(__liquidaity_row_limit)s"
                )
                cursor.execute(
                    wrapped,
                    {**bounded, "__liquidaity_row_limit": query.row_limit + 1},
                )
            else:
                if query.database_authority != "agentgraph_age":
                    raise ValueError("registered_query_authority_language_mismatch")
                cursor.execute("LOAD 'age'")
                cursor.execute('SET LOCAL search_path = ag_catalog, "$user", public')
                cursor.execute(
                    "SELECT * FROM cypher('agentgraph', $$ "
                    + query.statement
                    + f" LIMIT {query.row_limit + 1} $$, %s::agtype) AS (result agtype)",
                    (json.dumps(bounded, ensure_ascii=False, separators=(",", ":")),),
                )
            rows = _rows(cursor)
    truncated = len(rows) > query.row_limit
    bounded_rows: list[dict[str, Any]] = []
    total_chars = 0
    for row in rows[: query.row_limit]:
        if len(row) > _MAX_RESULT_COLUMNS:
            raise ValueError("registered_query_result_column_limit_exceeded")
        normalized = {str(key): _json_value(value) for key, value in row.items()}
        for key, value in normalized.items():
            if isinstance(value, str) and len(value) > _MAX_RESULT_CELL_CHARS:
                raise ValueError(f"registered_query_result_cell_too_large: {key}")
        encoded = json.dumps(
            normalized,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        if total_chars + len(encoded) > _MAX_GRAPH_VIEW_RESULT_CHARS:
            truncated = True
            break
        total_chars += len(encoded)
        bounded_rows.append(normalized)
    return bounded_rows, truncated


def _graph_view(
    *,
    execution_id: str,
    query: RegisteredQueryVersion,
    binding: QueryBinding,
    parameters: dict[str, Any],
    rows: list[dict[str, Any]],
    truncated: bool,
    correlation_id: str,
    conversation_id: str,
) -> dict[str, Any]:
    """Build AgentGraph view metadata; query rows remain in the live result only."""
    view_id = (
        f"graphview:query:{sha256((execution_id + query.query_id).encode()).hexdigest()[:24]}"
    )
    return {
        "viewId": view_id,
        "displayLabel": query.title,
        "authority": "agentgraph",
        "projectId": query.project_id,
        "conversationId": conversation_id,
        "status": "attached",
        "producingRole": binding.card_id,
        "receivingRole": binding.card_id,
        "correlationId": correlation_id,
        "note": "Bounded registered-query result; raw statement remains in the database registry.",
        "references": [
            {
                "referenceId": f"registered-query:{query.project_id}:{query.query_id}:v{query.version}",
                "referenceType": "registered_query",
                "required": True,
            },
            {
                "referenceId": f"query-execution:{execution_id}",
                "referenceType": "query_execution",
                "required": True,
            },
        ],
    }


def execute_binding(
    binding: QueryBinding,
    *,
    correlation_id: str,
    assignment_id: str,
    conversation_id: str,
    parameter_overrides: dict[str, Any] | None = None,
) -> QueryExecution:
    query = resolve_registered_version(
        binding.project_id,
        binding.query_id,
        binding.query_version,
    )
    parameters = validate_parameters(
        query.parameter_schema,
        {**binding.parameters, **(parameter_overrides or {})},
    )
    execution_id = f"queryexec:{uuid4().hex}"
    with connect_postgres() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT 1
            FROM ag_catalog.agent_assignments assignment
            WHERE assignment.assignment_id=%s
              AND assignment.project_id=%s
              AND assignment.correlation_id=%s
              AND assignment.receiver_card_id=%s
              AND assignment.state='running'
              AND EXISTS (
                SELECT 1
                FROM ag_catalog.agent_assignment_operation_references reference
                WHERE reference.assignment_id=assignment.assignment_id
                  AND reference.reference_id=%s
                  AND reference.operation_id=%s
                  AND reference.operation_version=%s
                  AND reference.parameters=%s::jsonb
              )
            """,
            (
                assignment_id,
                binding.project_id,
                correlation_id,
                binding.card_id,
                binding.binding_id,
                binding.query_id,
                binding.query_version,
                json.dumps(binding.parameters, ensure_ascii=False),
            ),
        )
        if cursor.fetchone() is None:
            raise PermissionError("registered_operation_assignment_not_active")
        cursor.execute(
            """
            INSERT INTO ag_catalog.registered_query_executions
              (execution_id, project_id, correlation_id, assignment_id, binding_id,
               query_id, query_version, parameters, status)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s::jsonb,'running')
            """,
            (
                execution_id,
                binding.project_id,
                correlation_id,
                assignment_id,
                binding.binding_id,
                query.query_id,
                query.version,
                json.dumps(parameters, ensure_ascii=False),
            ),
        )
    try:
        rows, truncated = _execute_read_only(query, parameters)
        view = _graph_view(
            execution_id=execution_id,
            query=query,
            binding=binding,
            parameters=parameters,
            rows=rows,
            truncated=truncated,
            correlation_id=correlation_id,
            conversation_id=conversation_id,
        )
        view_id = str(view["viewId"])
        with connect_postgres() as connection, connection.cursor() as cursor:
            from app.python_models import agentgraph as ag

            ag.create_graph_view(
                project_id=query.project_id,
                conversation_id=conversation_id,
                correlation_id=correlation_id,
                display_label=str(view["displayLabel"]),
                references=list(view["references"]),
                producing_role=binding.card_id,
                receiving_role=binding.card_id,
                status="attached",
                note=str(view["note"]),
                view_id=view_id,
                connection=connection,
            )
            cursor.execute(
                """
                UPDATE ag_catalog.registered_query_executions
                SET graph_view_id=%s, status='completed', result_count=%s,
                    truncated=%s, completed_at=now()
                WHERE execution_id=%s
                """,
                (view_id, len(rows), truncated, execution_id),
            )
            cursor.execute(
                """
                INSERT INTO ag_catalog.agent_context_references
                  (assignment_id, reference_id, reference_type, required)
                VALUES (%s,%s,'graph_view',%s)
                ON CONFLICT DO NOTHING
                """,
                (assignment_id, view_id, binding.delivery_mode == "required"),
            )
            ag.register_operation_execution_lineage(
                project_id=query.project_id,
                assignment_id=assignment_id,
                execution_id=execution_id,
                operation_id=query.query_id,
                operation_version=query.version,
                graph_view_id=view_id,
                connection=connection,
            )
        return QueryExecution(
            execution_id=execution_id,
            binding_id=binding.binding_id,
            query_id=query.query_id,
            query_version=query.version,
            parameters=parameters,
            graph_view_id=view_id,
            rows=rows,
            truncated=truncated,
        )
    except Exception as error:
        with connect_postgres() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE ag_catalog.registered_query_executions
                SET status='failed', error_code=%s, completed_at=now()
                WHERE execution_id=%s
                """,
                (str(error)[:500], execution_id),
            )
        raise


def build_query_context(
    executions: list[QueryExecution],
    optional_bindings: list[QueryBinding],
) -> str:
    if not executions and not optional_bindings:
        return ""
    lines = ["REGISTERED DATABASE CONTEXT:"]
    if executions:
        for execution in executions:
            lines.append(
                f"- required {execution.binding_id}: {execution.query_id}@v{execution.query_version} "
                f"materialized as {execution.graph_view_id} ({len(execution.rows)} rows"
                f"{', truncated' if execution.truncated else ''})"
            )
            for row in execution.rows:
                lines.append(
                    "  - " + json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
                )
    if optional_bindings:
        lines.append("OPTIONAL REGISTERED OPERATIONS (call by binding_id only):")
        for binding in optional_bindings:
            lines.append(
                f"- {binding.binding_id}: {binding.query_id}@v{binding.query_version}"
            )
    return "\n".join(lines)


def _resolve_selected_graph_views(
    *,
    project_id: str,
    conversation_id: str,
    receiver_card_id: str,
    receiver_role: str,
    graph_view_ids: list[str] | tuple[str, ...],
) -> list[dict[str, Any]]:
    identities = [str(value or "").strip() for value in graph_view_ids]
    if (
        len(identities) > _MAX_SELECTED_GRAPH_VIEWS
        or any(not _IDENTITY.fullmatch(value) for value in identities)
        or len(identities) != len(set(identities))
    ):
        raise ValueError("agentgraph_selected_graph_view_ids_invalid")
    if not identities:
        return []
    from app.python_models import agentgraph as ag

    available = ag.list_graph_views(
        project_id=project_id,
        conversation_id=conversation_id,
        limit=50,
    ).get("views") or []
    allowed_receivers = {
        value
        for value in (receiver_card_id, receiver_role)
        if value
    }
    resolved: list[dict[str, Any]] = []
    for view_id in identities:
        matches = [
            view
            for view in available
            if str(view.get("viewId") or "") == view_id
        ]
        if len(matches) != 1:
            raise LookupError(
                f"agentgraph_graph_view_not_found_in_runtime_context: {view_id}"
            )
        view = matches[0]
        receiving_role = str(view.get("receivingRole") or "").strip()
        if receiving_role and receiving_role not in allowed_receivers:
            raise PermissionError(
                f"agentgraph_graph_view_receiver_mismatch: {view_id}"
            )
        resolved.append(view)
    return resolved


def _attach_selected_graph_view_references(
    *,
    project_id: str,
    assignment_id: str,
    receiver_card_id: str,
    views: list[dict[str, Any]],
) -> None:
    if not views:
        return
    from app.python_models import agentgraph as ag

    references: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()

    def add(reference_id: str, reference_type: str, required: bool) -> None:
        identity = (reference_type, reference_id)
        if not reference_id or identity in seen:
            return
        seen.add(identity)
        references.append(
            {
                "referenceId": reference_id,
                "referenceType": reference_type,
                "required": required,
            }
        )

    for view in views:
        add(str(view.get("viewId") or ""), "graph_view", True)
    ag.add_assignment_references(
        project_id=project_id,
        assignment_id=assignment_id,
        receiver_card_id=receiver_card_id,
        references=references,
    )


def _render_selected_graph_views(views: list[dict[str, Any]]) -> str:
    if not views:
        return ""
    lines = ["[SELECTED_GRAPH_VIEWS]"]
    for view in views:
        lines.append(
            f"- {view.get('viewId')} ({view.get('displayLabel') or 'AgentGraph view'})"
        )
        for reference in view.get("references") or []:
            lines.append(
                "  - "
                f"{reference.get('referenceType')} -> {reference.get('referenceId')}"
                + (" [required]" if reference.get("required") else "")
            )
    text = "\n".join(lines)
    if len(text) > _MAX_SELECTED_GRAPH_VIEW_CONTEXT_CHARS:
        raise ValueError("agentgraph_selected_graph_view_context_too_large")
    return text


def hydrate_assignment_context(
    *,
    project_id: str,
    assignment_id: str,
    receiver_card_id: str,
    graph_view_ids: list[str] | tuple[str, ...] | None = None,
    runtime_type: str = "",
    runtime_provider: str = "",
    runtime_model_key: str = "",
    runtime_provider_model_id: str = "",
) -> HydratedAssignmentContext:
    """Claim and hydrate one AgentGraph assignment before any model is built.

    The request carries identities only. Python hydrates the exact instruction,
    receiving saved card, grants, registered-operation versions, parameters,
    and AgentGraph view references without copying their canonical payloads.
    """
    from app import control_plane
    from app.python_models import agentgraph as ag

    assignment = ag.read_assignment(
        project_id=project_id,
        assignment_id=assignment_id,
        receiving_card_id=receiver_card_id,
    )
    deck, _revision = control_plane._load_deck(project_id, assignment["deckId"])
    card = control_plane._find_card(deck, receiver_card_id)
    if str(card.get("kind") or "") != "agent" or card.get("enabled") is False:
        raise PermissionError(
            f"registered_operation_receiver_card_invalid: {receiver_card_id}"
        )
    saved_card_reference = control_plane.resolve_saved_card_reference(
        project_id,
        assignment["deckId"],
        receiver_card_id,
        deck=deck,
    )
    selected_ids = (
        list(graph_view_ids)
        if graph_view_ids is not None
        else [
            str(reference.get("referenceId") or "")
            for reference in assignment.get("contextReferences") or []
            if reference.get("referenceType") == "graph_view"
        ]
    )
    selected_views = _resolve_selected_graph_views(
        project_id=project_id,
        conversation_id=assignment["conversationId"],
        receiver_card_id=receiver_card_id,
        receiver_role=str(saved_card_reference.get("role") or "").strip(),
        graph_view_ids=selected_ids,
    )
    if graph_view_ids is not None:
        _attach_selected_graph_view_references(
            project_id=project_id,
            assignment_id=assignment_id,
            receiver_card_id=receiver_card_id,
            views=selected_views,
        )
        assignment = ag.read_assignment(
            project_id=project_id,
            assignment_id=assignment_id,
            receiving_card_id=receiver_card_id,
        )

    bindings = bindings_from_operation_references(
        project_id=project_id,
        card_id=receiver_card_id,
        references=assignment["operationReferences"],
    )
    binding_ids = [binding.binding_id for binding in bindings]
    if len(binding_ids) != len(set(binding_ids)):
        raise ValueError("registered_operation_binding_identity_conflict")
    claimed = ag.claim_assignment(
        project_id=project_id,
        assignment_id=assignment_id,
        receiver_card_id=receiver_card_id,
    )
    if all(
        (
            runtime_type,
            runtime_provider,
            runtime_model_key,
            runtime_provider_model_id,
        )
    ):
        ag.record_assignment_runtime_context(
            project_id=project_id,
            assignment_id=assignment_id,
            runtime=runtime_type,
            provider=runtime_provider,
            model_key=runtime_model_key,
            provider_model_id=runtime_provider_model_id,
        )
    required_reads = [
        binding
        for binding in bindings
        if binding.delivery_mode == "required"
    ]
    optional_operations = [
        binding
        for binding in bindings
        if binding.delivery_mode == "optional"
    ]
    try:
        executions = [
            execute_binding(
                binding,
                correlation_id=assignment["correlationId"],
                assignment_id=assignment_id,
                conversation_id=assignment["conversationId"],
            )
            for binding in required_reads
        ]
    except Exception as error:
        try:
            ag.finish_assignment(
                project_id=project_id,
                assignment_id=assignment_id,
                claim_token=claimed["claimToken"],
                status="failed",
                error_code="registered_operation_materialization_failed",
                error_detail=str(error),
            )
        except Exception as persistence_error:
            raise RuntimeError(
                "registered_operation_materialization_failed: "
                f"{error}; assignment_failure_persist_failed: {persistence_error}"
            ) from error
        raise RuntimeError(
            f"registered_operation_materialization_failed: {error}"
        ) from error
    operation_context = build_query_context(executions, optional_operations)
    parent_continuity = assignment.get("parentContinuity")
    continuity_context = (
        "\n".join(
            [
                "[PARENT_AGENTGRAPH_CONTINUITY]",
                f"assignmentId: {parent_continuity.get('assignmentId')}",
                f"instructionId: {parent_continuity.get('instructionId')}",
                f"resultId: {parent_continuity.get('resultId')}",
                f"resultStatus: {parent_continuity.get('resultStatus')}",
                f"resultSummary: {str(parent_continuity.get('resultSummary') or '')[:2000]}",
            ]
        )
        if isinstance(parent_continuity, dict)
        else ""
    )
    context_references = assignment.get("contextReferences") or []
    reference_context = (
        "\n".join(
            [
                "[AGENTGRAPH_CONTEXT_REFERENCES]",
                *[
                    f"- {reference['referenceType']}:{reference['referenceId']}"
                    + (" [required]" if reference.get("required") else "")
                    for reference in context_references
                ],
            ]
        )
        if context_references
        else ""
    )
    model_context = "\n\n".join(
        part
        for part in [
            "[AGENTGRAPH_ASSIGNMENT]",
            f"assignmentId: {assignment_id}",
            f"instructionId: {claimed['instructionId']}",
            f"correlationId: {claimed['correlationId']}",
            "Exact instruction:",
            claimed["instruction"],
            reference_context,
            _render_selected_graph_views(selected_views),
            continuity_context,
            operation_context,
        ]
        if part
    )
    return HydratedAssignmentContext(
        instruction=claimed["instruction"],
        claim_token=claimed["claimToken"],
        optional_bindings=tuple(optional_operations),
        model_context=model_context,
    )


def build_bound_query_tool(
    bindings: list[QueryBinding],
    *,
    correlation_id: str,
    assignment_id: str,
    conversation_id: str,
) -> FunctionTool:
    allowed = {binding.binding_id: binding for binding in bindings if binding.delivery_mode == "optional"}

    async def execute_registered_query(
        binding_id: str,
        parameters: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Execute one optional query already assigned to this saved card."""
        binding = allowed.get(str(binding_id or "").strip())
        if binding is None:
            raise ValueError(f"registered_query_binding_not_assigned: {binding_id}")
        execution = await asyncio.to_thread(
            execute_binding,
            binding,
            correlation_id=correlation_id,
            assignment_id=assignment_id,
            conversation_id=conversation_id,
            parameter_overrides=parameters or {},
        )
        return {
            "queryId": execution.query_id,
            "queryVersion": execution.query_version,
            "graphViewId": execution.graph_view_id,
            "rows": execution.rows,
            "truncated": execution.truncated,
        }

    return FunctionTool(
        execute_registered_query,
        name="execute_registered_query",
        description=(
            "Execute one immutable, read-only registered operation already assigned to this card. "
            "Pass only its binding_id and typed parameters; raw SQL/Cypher is never accepted."
        ),
    )
