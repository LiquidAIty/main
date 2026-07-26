"""Database-owned registered queries and bounded Graph View materialization.

Prompts and tool calls may select only a saved binding identity plus typed
parameters. Raw SQL/Cypher is accepted only when an immutable query version is
authored, and execution is allowed only after a separate promotion record.
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


@dataclass(frozen=True)
class RegisteredQueryVersion:
    project_id: str
    query_id: str
    version: int
    database_authority: str
    database_name: str
    owner_id: str
    title: str
    description: str
    language: str
    statement: str
    parameter_schema: dict[str, dict[str, Any]]
    row_limit: int
    timeout_ms: int
    authored_by: str
    audit_note: str
    promoted_by: str


@dataclass(frozen=True)
class QueryBinding:
    project_id: str
    deck_id: str
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


def _audit(
    cursor: Any,
    *,
    project_id: str,
    query_id: str,
    version: int | None,
    action: str,
    actor_id: str,
    detail: dict[str, Any],
) -> None:
    cursor.execute(
        """
        INSERT INTO ag_catalog.registered_query_audit
          (audit_id, project_id, query_id, version, action, actor_id, detail)
        VALUES (%s,%s,%s,%s,%s,%s,%s::jsonb)
        """,
        (
            f"queryaudit:{uuid4().hex}",
            project_id,
            query_id,
            version,
            action,
            actor_id,
            json.dumps(detail, ensure_ascii=False),
        ),
    )


def create_query(
    *,
    project_id: str,
    query_id: str,
    database_authority: str,
    database_name: str,
    owner_id: str,
    title: str,
    description: str = "",
    connection: Any | None = None,
) -> None:
    project_id = _required_identity(project_id, "project_id")
    query_id = _required_identity(query_id, "query_id")
    owner_id = _required_identity(owner_id, "owner_id")
    authority = str(database_authority or "").strip()
    if authority not in {"postgresql", "agentgraph_age"}:
        raise ValueError("registered_query_database_authority_invalid")
    database_name = _required_identity(database_name, "database_name")
    own = connection is None
    connection = connection or connect_postgres(autocommit=False)
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO ag_catalog.registered_queries
                  (project_id, query_id, database_authority, database_name, owner_id, title, description)
                VALUES (%s,%s,%s,%s,%s,%s,%s)
                """,
                (
                    project_id,
                    query_id,
                    authority,
                    database_name,
                    owner_id,
                    _required_text(title, "title", maximum=500),
                    str(description or "")[:4000],
                ),
            )
            _audit(
                cursor,
                project_id=project_id,
                query_id=query_id,
                version=None,
                action="created",
                actor_id=owner_id,
                detail={"databaseAuthority": authority, "databaseName": database_name},
            )
        if own:
            connection.commit()
    except Exception:
        if own:
            connection.rollback()
        raise
    finally:
        if own:
            connection.close()


def create_version(
    *,
    project_id: str,
    query_id: str,
    version: int,
    language: str,
    statement: str,
    parameter_schema: dict[str, Any],
    row_limit: int,
    timeout_ms: int,
    authored_by: str,
    audit_note: str,
    connection: Any | None = None,
) -> None:
    project_id = _required_identity(project_id, "project_id")
    query_id = _required_identity(query_id, "query_id")
    authored_by = _required_identity(authored_by, "authored_by")
    if not isinstance(version, int) or version < 1:
        raise ValueError("registered_query_version_invalid")
    language = str(language or "").strip().lower()
    statement = validate_read_only_statement(language, statement)
    schema = validate_parameter_schema(parameter_schema)
    if not isinstance(row_limit, int) or not 1 <= row_limit <= 1000:
        raise ValueError("registered_query_row_limit_invalid")
    if not isinstance(timeout_ms, int) or not 100 <= timeout_ms <= 30000:
        raise ValueError("registered_query_timeout_invalid")
    note = _required_text(audit_note, "audit_note", maximum=4000)
    own = connection is None
    connection = connection or connect_postgres(autocommit=False)
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO ag_catalog.registered_query_versions
                  (project_id, query_id, version, language, statement, parameter_schema,
                   row_limit, timeout_ms, authored_by, audit_note)
                VALUES (%s,%s,%s,%s,%s,%s::jsonb,%s,%s,%s,%s)
                """,
                (
                    project_id,
                    query_id,
                    version,
                    language,
                    statement,
                    json.dumps(schema, ensure_ascii=False),
                    row_limit,
                    timeout_ms,
                    authored_by,
                    note,
                ),
            )
            _audit(
                cursor,
                project_id=project_id,
                query_id=query_id,
                version=version,
                action="version_created",
                actor_id=authored_by,
                detail={"language": language, "rowLimit": row_limit, "timeoutMs": timeout_ms},
            )
        if own:
            connection.commit()
    except Exception:
        if own:
            connection.rollback()
        raise
    finally:
        if own:
            connection.close()


def promote_version(
    *,
    project_id: str,
    query_id: str,
    version: int,
    promoted_by: str,
    audit_note: str,
    connection: Any | None = None,
) -> None:
    project_id = _required_identity(project_id, "project_id")
    query_id = _required_identity(query_id, "query_id")
    promoted_by = _required_identity(promoted_by, "promoted_by")
    note = _required_text(audit_note, "promotion_audit_note", maximum=4000)
    own = connection is None
    connection = connection or connect_postgres(autocommit=False)
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT language, statement, parameter_schema
                FROM ag_catalog.registered_query_versions
                WHERE project_id=%s AND query_id=%s AND version=%s
                """,
                (project_id, query_id, version),
            )
            row = cursor.fetchone()
            if row is None:
                raise LookupError(f"registered_query_version_not_found: {query_id}@v{version}")
            validate_read_only_statement(str(row[0]), str(row[1]))
            validate_parameter_schema(row[2])
            cursor.execute(
                """
                INSERT INTO ag_catalog.registered_query_promotions
                  (project_id, query_id, version, promoted_by, audit_note)
                VALUES (%s,%s,%s,%s,%s)
                """,
                (project_id, query_id, version, promoted_by, note),
            )
            _audit(
                cursor,
                project_id=project_id,
                query_id=query_id,
                version=version,
                action="promoted",
                actor_id=promoted_by,
                detail={"auditNote": note},
            )
        if own:
            connection.commit()
    except Exception:
        if own:
            connection.rollback()
        raise
    finally:
        if own:
            connection.close()


def resolve_promoted_version(
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
                SELECT q.project_id, q.query_id, v.version, q.database_authority,
                       q.database_name, q.owner_id, q.title, q.description,
                       v.language, v.statement, v.parameter_schema, v.row_limit,
                       v.timeout_ms, v.authored_by, v.audit_note, p.promoted_by
                FROM ag_catalog.registered_queries q
                JOIN ag_catalog.registered_query_versions v
                  ON v.project_id=q.project_id AND v.query_id=q.query_id
                JOIN ag_catalog.registered_query_promotions p
                  ON p.project_id=v.project_id AND p.query_id=v.query_id AND p.version=v.version
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
        raise LookupError(f"registered_query_not_promoted: {query_id}@v{version}")
    schema = row[10] if isinstance(row[10], dict) else json.loads(str(row[10]))
    return RegisteredQueryVersion(
        project_id=row[0],
        query_id=row[1],
        version=row[2],
        database_authority=row[3],
        database_name=row[4],
        owner_id=row[5],
        title=row[6],
        description=row[7],
        language=row[8],
        statement=validate_read_only_statement(row[8], row[9]),
        parameter_schema=validate_parameter_schema(schema),
        row_limit=row[11],
        timeout_ms=row[12],
        authored_by=row[13],
        audit_note=row[14],
        promoted_by=row[15],
    )


def assign_query_binding(
    *,
    project_id: str,
    deck_id: str,
    card_id: str,
    binding_id: str,
    query_id: str,
    query_version: int,
    delivery_mode: str,
    parameters: dict[str, Any],
    assigned_by: str,
    connection: Any | None = None,
) -> None:
    delivery_mode = str(delivery_mode or "").strip()
    if delivery_mode not in {"required", "optional"}:
        raise ValueError("registered_query_delivery_mode_invalid")
    own = connection is None
    connection = connection or connect_postgres(autocommit=False)
    try:
        query = resolve_promoted_version(
            project_id,
            query_id,
            query_version,
            connection=connection,
        )
        bounded = validate_parameters(query.parameter_schema, parameters)
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO ag_catalog.card_registered_query_bindings
                  (project_id, deck_id, card_id, binding_id, query_id, query_version,
                   delivery_mode, parameters, assigned_by)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s)
                ON CONFLICT (project_id, deck_id, card_id, binding_id) DO UPDATE SET
                  query_id=EXCLUDED.query_id,
                  query_version=EXCLUDED.query_version,
                  delivery_mode=EXCLUDED.delivery_mode,
                  parameters=EXCLUDED.parameters,
                  assigned_by=EXCLUDED.assigned_by,
                  created_at=now()
                """,
                (
                    _required_identity(project_id, "project_id"),
                    _required_identity(deck_id, "deck_id"),
                    _required_identity(card_id, "card_id"),
                    _required_identity(binding_id, "binding_id"),
                    query.query_id,
                    query.version,
                    delivery_mode,
                    json.dumps(bounded, ensure_ascii=False),
                    _required_identity(assigned_by, "assigned_by"),
                ),
            )
        if own:
            connection.commit()
    except Exception:
        if own:
            connection.rollback()
        raise
    finally:
        if own:
            connection.close()


def assigned_query_bindings(
    *,
    project_id: str,
    deck_id: str,
    card_id: str,
    connection: Any | None = None,
) -> list[QueryBinding]:
    own = connection is None
    connection = connection or connect_postgres()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT project_id, deck_id, card_id, binding_id, query_id,
                       query_version, delivery_mode, parameters
                FROM ag_catalog.card_registered_query_bindings
                WHERE project_id=%s AND deck_id=%s AND card_id=%s
                ORDER BY delivery_mode, binding_id
                """,
                (project_id, deck_id, card_id),
            )
            rows = cursor.fetchall()
    finally:
        if own:
            connection.close()
    return [
        QueryBinding(
            project_id=row[0],
            deck_id=row[1],
            card_id=row[2],
            binding_id=row[3],
            query_id=row[4],
            query_version=row[5],
            delivery_mode=row[6],
            parameters=row[7] if isinstance(row[7], dict) else json.loads(str(row[7])),
        )
        for row in rows
    ]


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
    view_id = (
        f"graphview:query:{sha256((execution_id + query.query_id).encode()).hexdigest()[:24]}"
    )
    records = []
    for index, row in enumerate(rows):
        encoded = json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        records.append(
            {
                "canonicalId": f"queryrow:{execution_id}:{index + 1}",
                "label": query.title,
                "kind": "RegisteredQueryRow",
                "summary": encoded[:1500],
                "properties": row,
            }
        )
    return {
        "viewId": view_id,
        "displayLabel": query.title,
        "authority": query.database_authority,
        "projectId": query.project_id,
        "conversationId": conversation_id,
        "status": "attached",
        "producingRole": binding.card_id,
        "receivingRole": binding.card_id,
        "runId": correlation_id,
        "invocationId": execution_id,
        "rootCanonicalNodeIds": [record["canonicalId"] for record in records[:1]],
        "includedCanonicalNodeIds": [record["canonicalId"] for record in records],
        "includedRelationships": [],
        "records": records,
        "filter": {
            "queryId": query.query_id,
            "queryVersion": query.version,
            "parameters": parameters,
        },
        "hopDepth": 0,
        "query": f"{query.query_id}@v{query.version}",
        "note": "Bounded registered-query result; raw statement remains in the database registry.",
        "provenanceRefs": [
            f"registered-query:{query.project_id}:{query.query_id}:v{query.version}",
            f"query-execution:{execution_id}",
        ],
        "omittedNeighborCount": 1 if truncated else 0,
        "runtime": {
            "queryExecutionId": execution_id,
            "bindingId": binding.binding_id,
            "rowLimit": query.row_limit,
            "truncated": truncated,
        },
    }


def execute_binding(
    binding: QueryBinding,
    *,
    correlation_id: str,
    assignment_id: str,
    conversation_id: str,
    parameter_overrides: dict[str, Any] | None = None,
) -> QueryExecution:
    query = resolve_promoted_version(
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
        from app.python_models.thinkgraph_engraphis import get_thinkgraph

        get_thinkgraph().persist_graph_view(view)
        view_id = str(view["viewId"])
        with connect_postgres() as connection, connection.cursor() as cursor:
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
            _audit(
                cursor,
                project_id=query.project_id,
                query_id=query.query_id,
                version=query.version,
                action="executed",
                actor_id=binding.card_id,
                detail={
                    "executionId": execution_id,
                    "graphViewId": view_id,
                    "correlationId": correlation_id,
                    "resultCount": len(rows),
                    "truncated": truncated,
                },
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
            _audit(
                cursor,
                project_id=query.project_id,
                query_id=query.query_id,
                version=query.version,
                action="rejected",
                actor_id=binding.card_id,
                detail={"executionId": execution_id, "error": str(error)[:1000]},
            )
        raise


def build_query_context(
    executions: list[QueryExecution],
    optional_bindings: list[QueryBinding],
) -> str:
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
    else:
        lines.append("- required: none")
    if optional_bindings:
        lines.append("OPTIONAL REGISTERED QUERIES (call by binding_id only):")
        for binding in optional_bindings:
            lines.append(
                f"- {binding.binding_id}: {binding.query_id}@v{binding.query_version}"
            )
    else:
        lines.append("OPTIONAL REGISTERED QUERIES: none")
    return "\n".join(lines)


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
            "Execute one promoted, read-only query already assigned to this card. "
            "Pass only its binding_id and typed parameters; raw SQL/Cypher is never accepted."
        ),
    )
