"""Project-owned external-capability availability for one Card Run.

This module performs only an exact structural intersection.  It does not infer
meaning, select tools, call Jev, or grant authority.  Missing rows deliberately
preserve existing behavior by leaving a capability enabled; explicit Project
OFF rows remove it before the existing one-batch Jev choice.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from typing import Any

from psycopg.rows import dict_row

from app.python_models.postgres import connect_postgres


_CAPABILITY_ID = re.compile(r"^[a-z0-9][a-z0-9._:-]{0,127}$")
_MAX_MAIN_REASON_LENGTH = 1000


class ProjectWorldviewError(ValueError):
    """Invalid Project WorldView state or capability identity."""


def _capability_ids(values: list[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        capability_id = str(value or "").strip()
        if not _CAPABILITY_ID.fullmatch(capability_id):
            raise ProjectWorldviewError(
                f"project_worldview_capability_id_invalid:{capability_id or 'missing'}"
            )
        if capability_id not in seen:
            seen.add(capability_id)
            result.append(capability_id)
    return result


def _main_reason(value: str) -> str:
    reason = str(value or "").strip()
    if not reason:
        raise ProjectWorldviewError("project_worldview_main_reason_required")
    if len(reason) > _MAX_MAIN_REASON_LENGTH:
        raise ProjectWorldviewError("project_worldview_main_reason_too_long")
    return reason


def _capability(row: dict[str, Any]) -> dict[str, Any]:
    capability_id = str(row.get("capability_id") or "")
    if not _CAPABILITY_ID.fullmatch(capability_id):
        raise ProjectWorldviewError("project_worldview_state_invalid")
    user_enabled = row.get("user_enabled")
    main_enabled = row.get("main_enabled")
    if user_enabled is not None and not isinstance(user_enabled, bool):
        raise ProjectWorldviewError("project_worldview_state_invalid")
    if main_enabled is not None and not isinstance(main_enabled, bool):
        raise ProjectWorldviewError("project_worldview_state_invalid")
    if user_enabled is None and main_enabled is None:
        raise ProjectWorldviewError("project_worldview_state_invalid")
    last_origin = row.get("last_origin")
    if last_origin not in {"user", "main", "worldview_card"}:
        raise ProjectWorldviewError("project_worldview_origin_invalid")
    effective = user_enabled if user_enabled is not None else main_enabled
    return {
        "capabilityId": capability_id,
        "enabled": effective,
        "controlledBy": "user" if user_enabled is not None else "main",
        "lastOrigin": last_origin,
        "mainReason": (
            str(row.get("main_reason"))[:_MAX_MAIN_REASON_LENGTH]
            if row.get("main_reason") is not None else None
        ),
        "updatedAt": (
            row["updated_at"].isoformat()
            if hasattr(row.get("updated_at"), "isoformat")
            else (str(row.get("updated_at")) if row.get("updated_at") else None)
        ),
    }


def set_main_project_worldview_capability(
    project_id: str,
    capability_id: str,
    enabled: bool,
    reason: str,
    *,
    connector: Callable[..., Any] = connect_postgres,
) -> dict[str, Any]:
    """Save Main's Project capability choice without replacing user authority."""

    canonical_project_id = str(project_id or "").strip()
    if not canonical_project_id:
        raise ProjectWorldviewError("project_id_required")
    canonical_capability_id = _capability_ids([capability_id])[0]
    if not isinstance(enabled, bool):
        raise ProjectWorldviewError("project_worldview_enabled_invalid")
    canonical_reason = _main_reason(reason)

    with connector() as connection, connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            """
            INSERT INTO ag_catalog.project_worldview_capabilities
              (project_id, capability_id, main_enabled, main_reason, user_enabled, last_origin, updated_at)
            VALUES (%s, %s, %s, %s, NULL, 'main', NOW())
            ON CONFLICT (project_id, capability_id) DO UPDATE SET
              main_enabled=EXCLUDED.main_enabled,
              main_reason=EXCLUDED.main_reason,
              last_origin='main',
              updated_at=NOW()
            RETURNING capability_id, main_enabled, main_reason, user_enabled, last_origin, updated_at
            """,
            (
                canonical_project_id,
                canonical_capability_id,
                enabled,
                canonical_reason,
            ),
        )
        row = cursor.fetchone()
    if not isinstance(row, dict):
        raise ProjectWorldviewError("project_worldview_write_failed")
    capability = _capability(row)
    if capability["capabilityId"] != canonical_capability_id:
        raise ProjectWorldviewError("project_worldview_state_invalid")
    return {
        "schemaVersion": "project-worldview.v1",
        "projectId": canonical_project_id,
        "capability": capability,
    }


def resolve_project_worldview(
    project_id: str,
    candidate_capability_ids: list[str],
    *,
    connector: Callable[..., Any] = connect_postgres,
) -> dict[str, Any]:
    """Intersect exact candidate IDs with durable Project availability.

    An explicit user value takes precedence over Main's saved suggestion.
    Absence is compatibility-preserving ON, so existing Projects retain their
    current Card/tool behavior until the user or Main shapes their WorldView.
    """

    canonical_project_id = str(project_id or "").strip()
    if not canonical_project_id:
        raise ProjectWorldviewError("project_id_required")
    candidates = _capability_ids(candidate_capability_ids)
    if not candidates:
        return {
            "schemaVersion": "project-worldview.v1",
            "projectId": canonical_project_id,
            "defaultEnabled": True,
            "candidateCapabilities": [],
            "enabledCapabilities": [],
            "excludedCapabilities": [],
            "overrides": [],
        }

    with connector() as connection, connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            """
            SELECT capability_id, main_enabled, main_reason, user_enabled, last_origin, updated_at
            FROM ag_catalog.project_worldview_capabilities
            WHERE project_id=%s AND capability_id=ANY(%s::text[])
            ORDER BY capability_id
            """,
            (canonical_project_id, candidates),
        )
        rows = cursor.fetchall()

    by_id: dict[str, dict[str, Any]] = {}
    overrides: list[dict[str, Any]] = []
    for row in rows:
        normalized = _capability(row)
        capability_id = normalized["capabilityId"]
        if capability_id not in candidates or capability_id in by_id:
            raise ProjectWorldviewError("project_worldview_state_invalid")
        by_id[capability_id] = normalized
        overrides.append(normalized)

    enabled = [
        capability_id for capability_id in candidates
        if by_id.get(capability_id, {}).get("enabled", True) is True
    ]
    excluded = [
        capability_id for capability_id in candidates
        if by_id.get(capability_id, {}).get("enabled", True) is False
    ]
    return {
        "schemaVersion": "project-worldview.v1",
        "projectId": canonical_project_id,
        "defaultEnabled": True,
        "candidateCapabilities": candidates,
        "enabledCapabilities": enabled,
        "excludedCapabilities": excluded,
        "overrides": overrides,
    }
