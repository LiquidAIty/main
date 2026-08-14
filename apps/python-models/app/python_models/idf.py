"""PostgreSQL persistence and transport for one assembled Input Data File.

This module does not define the Input Data Dictionary. It accepts already
selected context fields, performs only mechanical shape checks, renders the
stored document, and persists the exact value supplied to runtime adapters.
"""

from __future__ import annotations

import json
from contextlib import contextmanager
from datetime import datetime, timezone
from hashlib import sha256
from typing import Any, Iterator
from uuid import uuid4

from app.python_models.postgres import connect_postgres


class InputDataFileError(ValueError):
    """Typed structural failure at the IDF transport/storage boundary."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _required_text(value: Any, field: str) -> str:
    if not isinstance(value, str):
        raise InputDataFileError(f"idf_{field}_invalid")
    text = value.strip()
    if not text:
        raise InputDataFileError(f"idf_{field}_invalid")
    return text


def _required_id(value: Any, field: str) -> str:
    return _required_text(value, field)


def _text(value: Any, field: str, *, required: bool) -> str:
    if not isinstance(value, str):
        raise InputDataFileError(f"idf_{field}_invalid")
    if required and not value.strip():
        raise InputDataFileError(f"idf_{field}_invalid")
    return value


def _references(value: Any) -> list[dict[str, Any]]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise InputDataFileError("idf_native_references_invalid")
    normalized: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for item in value:
        if not isinstance(item, dict) or set(item) - {"authority", "nativeId", "required"}:
            raise InputDataFileError("idf_native_reference_invalid")
        authority = _required_id(item.get("authority"), "reference_authority")
        native_id = _required_text(item.get("nativeId"), "reference_native_id")
        key = (authority, native_id)
        if key in seen:
            raise InputDataFileError("idf_native_reference_duplicate")
        seen.add(key)
        normalized.append(
            {"authority": authority, "nativeId": native_id, "required": item.get("required") is True}
        )
    return normalized


def render_content_markdown(
    *,
    system_text: str,
    user_text: str,
    dynamic_context_markdown: str,
    native_references: list[dict[str, Any]],
) -> str:
    """Mechanically render the stored human-readable view of the exact fields."""
    sections = ["# LiquidAIty Input Data File"]
    if system_text:
        sections.extend(["## System Context", system_text])
    if dynamic_context_markdown:
        sections.extend(["## Dynamic AgentGraph Context", dynamic_context_markdown])
    if native_references:
        reference_lines = [
            f"- {item['authority']}:{item['nativeId']}"
            + (" [required]" if item["required"] else "")
            for item in native_references
        ]
        sections.extend(["## Native References", "\n".join(reference_lines)])
    sections.extend(["## Current Input", user_text])
    return "\n\n".join(sections)


def render_model_input_markdown(
    *,
    user_text: str,
    dynamic_context_markdown: str,
    native_references: list[dict[str, Any]],
) -> str:
    """Render the exact user-channel payload without interpreting its meaning."""
    if not dynamic_context_markdown and not native_references:
        return user_text
    sections: list[str] = []
    if dynamic_context_markdown:
        sections.extend(["## Dynamic AgentGraph Context", dynamic_context_markdown])
    if native_references:
        reference_lines = [
            f"- {item['authority']}:{item['nativeId']}"
            + (" [required]" if item["required"] else "")
            for item in native_references
        ]
        sections.extend(["## Native References", "\n".join(reference_lines)])
    sections.extend(["## Current Input", user_text])
    return "\n\n".join(sections)


def assemble_input_data_file(
    *,
    project_id: str,
    deck_id: str,
    conversation_id: str,
    run_id: str,
    originating_card_id: str,
    system_text: str,
    user_text: str,
    dynamic_context_markdown: str = "",
    native_references: Any = None,
    idf_id: str | None = None,
    created_at: str | None = None,
) -> dict[str, Any]:
    """Mechanically assemble one immutable IDF version from supplied fields."""
    project_id = _required_text(project_id, "project_id")
    deck_id = _required_text(deck_id, "deck_id")
    conversation_id = _required_text(conversation_id, "conversation_id")
    run_id = _required_id(run_id, "run_id")
    originating_card_id = _required_id(originating_card_id, "originating_card_id")
    system_text = _text(system_text, "system_text", required=False)
    user_text = _text(user_text, "user_text", required=True)
    dynamic_context_markdown = _text(
        dynamic_context_markdown,
        "dynamic_context_markdown",
        required=False,
    )
    references = _references(native_references)
    model_input_markdown = render_model_input_markdown(
        user_text=user_text,
        dynamic_context_markdown=dynamic_context_markdown,
        native_references=references,
    )
    content_markdown = render_content_markdown(
        system_text=system_text,
        user_text=user_text,
        dynamic_context_markdown=dynamic_context_markdown,
        native_references=references,
    )
    return {
        "idfId": _required_id(idf_id, "idf_id") if idf_id else f"idf:{uuid4().hex[:24]}",
        "projectId": project_id,
        "deckId": deck_id,
        "conversationId": conversation_id,
        "runId": run_id,
        "originatingCardId": originating_card_id,
        "version": 1,
        "systemText": system_text,
        "userText": user_text,
        "dynamicContextMarkdown": dynamic_context_markdown,
        "nativeReferences": references,
        "modelInputMarkdown": model_input_markdown,
        "contentMarkdown": content_markdown,
        "contentSha256": sha256(content_markdown.encode("utf-8")).hexdigest(),
        "createdAt": created_at or _now(),
    }


@contextmanager
def _connection_scope(connection: Any | None) -> Iterator[Any]:
    if connection is not None:
        yield connection
        return
    with connect_postgres(autocommit=False) as owned:
        yield owned


def _row_to_document(row: Any) -> dict[str, Any]:
    return {
        "idfId": str(row[0]), "projectId": str(row[1]), "deckId": str(row[2]),
        "conversationId": str(row[3]), "runId": str(row[4]),
        "originatingCardId": str(row[5]), "version": int(row[6]),
        "systemText": str(row[7]), "userText": str(row[8]),
        "dynamicContextMarkdown": str(row[9]),
        "nativeReferences": list(row[10] or []), "modelInputMarkdown": str(row[11]),
        "contentMarkdown": str(row[12]), "contentSha256": str(row[13]),
        "createdAt": row[14].isoformat().replace("+00:00", "Z")
        if hasattr(row[14], "isoformat") else str(row[14]),
    }


def create_input_data_file(*, connection: Any | None = None, **values: Any) -> dict[str, Any]:
    """Persist and return the exact immutable IDF consumed by a runtime."""
    document = assemble_input_data_file(**values)
    with _connection_scope(connection) as conn, conn.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO ag_catalog.input_data_files
              (idf_id, project_id, deck_id, conversation_id, run_id,
               originating_card_id, version, system_text, user_text,
               dynamic_context_markdown, native_references, model_input_markdown, content_markdown,
               content_sha256, created_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s,%s,%s,%s)
            ON CONFLICT (project_id, run_id, version) DO NOTHING
            """,
            (
                document["idfId"], document["projectId"], document["deckId"],
                document["conversationId"], document["runId"],
                document["originatingCardId"], document["version"],
                document["systemText"], document["userText"],
                document["dynamicContextMarkdown"],
                json.dumps(document["nativeReferences"], ensure_ascii=False),
                document["modelInputMarkdown"],
                document["contentMarkdown"], document["contentSha256"],
                document["createdAt"],
            ),
        )
        if cursor.rowcount == 0:
            cursor.execute(
                """
                SELECT idf_id, project_id, deck_id, conversation_id, run_id,
                       originating_card_id, version, system_text, user_text,
                       dynamic_context_markdown, native_references, model_input_markdown,
                       content_markdown, content_sha256, created_at
                FROM ag_catalog.input_data_files
                WHERE project_id=%s AND run_id=%s AND version=%s
                """,
                (document["projectId"], document["runId"], document["version"]),
            )
            existing_row = cursor.fetchone()
            if existing_row is None:
                raise InputDataFileError("idf_run_identity_conflict")
            existing = _row_to_document(existing_row)
            identity_fields = (
                "deckId", "conversationId", "originatingCardId", "version",
                "contentSha256",
            )
            if any(existing[field] != document[field] for field in identity_fields):
                raise InputDataFileError("idf_run_identity_conflict")
            document = existing
    return {"ok": True, "idf": document}


def read_input_data_file(*, project_id: str, idf_id: str, connection: Any | None = None) -> dict[str, Any]:
    project_id = _required_text(project_id, "project_id")
    idf_id = _required_id(idf_id, "idf_id")
    with _connection_scope(connection) as conn, conn.cursor() as cursor:
        cursor.execute(
            """
            SELECT idf_id, project_id, deck_id, conversation_id, run_id,
                   originating_card_id, version, system_text, user_text,
                   dynamic_context_markdown, native_references, model_input_markdown, content_markdown,
                   content_sha256, created_at
            FROM ag_catalog.input_data_files
            WHERE project_id=%s AND idf_id=%s
            """,
            (project_id, idf_id),
        )
        row = cursor.fetchone()
    if row is None:
        raise InputDataFileError(f"idf_not_found: {idf_id}")
    return _row_to_document(row)
