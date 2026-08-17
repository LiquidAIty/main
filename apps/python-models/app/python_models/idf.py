"""Read-only access to legacy persisted Input Data File rows.

Current Card invocations are materialized transiently by ``card_domain`` and
are never written here. The legacy table remains readable for recovery and
historical inspection until a separately approved cleanup.
"""

from __future__ import annotations

import json
from contextlib import contextmanager
from typing import Any, Iterator

from app.python_models.idd import IddValidationError, validate_record
from app.python_models.postgres import connect_postgres


class InputDataFileError(ValueError):
    """Typed failure while reading a legacy IDF row."""


def _render_card_context(card_context: dict[str, Any]) -> str:
    lines = [
        f"id: {card_context['cardId']}",
        f"name: {card_context['title']}",
        f"runtime: {card_context['runtimeType']}",
    ]
    for key in ("runtimeBinding", "executionMode", "profile"):
        value = card_context.get(key)
        if isinstance(value, str) and value:
            lines.append(f"{key}: {value}")
    provider = card_context.get("provider")
    model = card_context.get("providerModelId") or card_context.get("modelKey")
    if provider or model:
        lines.append(f"model: {provider or 'saved-provider'}/{model or 'saved-model'}")
    for key in ("tools", "nativeTools", "skills", "toolsets", "mcpConnectionIds"):
        values = card_context.get(key)
        if isinstance(values, list) and values:
            lines.append(f"{key}: {', '.join(str(value) for value in values)}")
    return "\n".join(lines)


def _native_reference_island(native_references: list[dict[str, Any]]) -> str:
    return "[JSON]\n" + json.dumps(
        {"type": "native-references", "references": native_references},
        ensure_ascii=False,
        sort_keys=True,
        indent=2,
    ) + "\n[/JSON]"


def render_content_markdown(
    *,
    system_text: str,
    user_text: str,
    card_context: dict[str, Any],
    dynamic_context_markdown: str,
    native_references: list[dict[str, Any]],
    project_context_manifest: dict[str, Any] | None = None,
    job_context: dict[str, Any] | None = None,
) -> str:
    """Mechanically render one transient IDD-shaped invocation."""
    sections = ["# LiquidAIty Input Data File"]
    if system_text:
        sections.append(f"[SYSTEM]\n{system_text}\n[/SYSTEM]")
    sections.extend([
        "[CARD]\n" + _render_card_context(card_context) + "\n[/CARD]",
        "## Resolved Invocation Configuration",
        "[JSON]\n" + json.dumps(
            {"type": "resolved-card-invocation", "cardContext": card_context},
            ensure_ascii=False,
            sort_keys=True,
            indent=2,
        ) + "\n[/JSON]",
    ])
    if project_context_manifest is not None:
        sections.extend([
            "## Project Context Manifest",
            "[JSON]\n" + json.dumps(
                project_context_manifest,
                ensure_ascii=False,
                sort_keys=True,
                indent=2,
            ) + "\n[/JSON]",
        ])
    if dynamic_context_markdown:
        sections.extend(["## Dynamic AgentGraph Context", dynamic_context_markdown])
    if native_references:
        sections.extend(["## Native Imports", _native_reference_island(native_references)])
    if job_context is not None:
        sections.extend([
            "## Approved Coding Job Fields",
            "```json\n" + json.dumps(job_context, ensure_ascii=False, sort_keys=True, indent=2) + "\n```",
        ])
    sections.extend(["## Current Input", user_text])
    return "\n\n".join(sections)


def _required_text(value: Any, field: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise InputDataFileError(f"idf_{field}_invalid")
    return text


@contextmanager
def _connection_scope(connection: Any | None) -> Iterator[Any]:
    if connection is not None:
        yield connection
        return
    with connect_postgres(autocommit=False) as owned:
        yield owned


def _row_to_document(row: Any) -> dict[str, Any]:
    structured_context = dict(row[11] or {})
    card_context = structured_context.get("cardContext")
    if card_context is not None:
        try:
            card_context = validate_record("card-context", card_context)
        except IddValidationError as error:
            raise InputDataFileError(str(error)) from error
    created_at = row[15]
    approved_at = row[18]
    return {
        "idfId": str(row[0]),
        "projectId": str(row[1]),
        "deckId": str(row[2]),
        "conversationId": str(row[3]),
        "runId": str(row[4]),
        "originatingCardId": str(row[5]),
        "version": int(row[6]),
        "systemText": str(row[7]),
        "userText": str(row[8]),
        "cardContext": card_context,
        "dynamicContextMarkdown": str(row[9]),
        "nativeReferences": list(row[10] or []),
        "modelInputMarkdown": str(row[12]),
        "contentMarkdown": str(row[13]),
        "contentSha256": str(row[14]),
        "createdAt": created_at.isoformat().replace("+00:00", "Z")
        if hasattr(created_at, "isoformat") else str(created_at),
        "purpose": str(row[16]),
        "approvalStatus": str(row[17]),
        "approvedAt": approved_at.isoformat().replace("+00:00", "Z")
        if approved_at is not None and hasattr(approved_at, "isoformat")
        else (str(approved_at) if approved_at else None),
        "approvedSha256": str(row[19]) if row[19] else None,
        "supersedesIdfId": str(row[20]) if row[20] else None,
        "jobContext": dict(row[21]) if row[21] is not None else None,
    }


def read_input_data_file(
    *,
    project_id: str,
    idf_id: str,
    connection: Any | None = None,
) -> dict[str, Any]:
    """Read one legacy row without making it current execution authority."""
    project_id = _required_text(project_id, "project_id")
    idf_id = _required_text(idf_id, "idf_id")
    with _connection_scope(connection) as conn, conn.cursor() as cursor:
        cursor.execute(
            """
            SELECT idf_id, project_id, deck_id, conversation_id, run_id,
                   originating_card_id, version, system_text, user_text,
                   dynamic_context_markdown, native_references, structured_context,
                   model_input_markdown, content_markdown,
                   content_sha256, created_at, purpose, approval_status,
                   approved_at, approved_sha256, supersedes_idf_id, job_context
            FROM ag_catalog.input_data_files
            WHERE project_id=%s AND idf_id=%s
            """,
            (project_id, idf_id),
        )
        row = cursor.fetchone()
    if row is None:
        raise InputDataFileError(f"idf_not_found: {idf_id}")
    return _row_to_document(row)
