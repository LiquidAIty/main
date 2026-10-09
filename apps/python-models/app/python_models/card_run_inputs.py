"""Canonical IDF retention and input-artifact persistence for Card Runs."""

from __future__ import annotations

from typing import Any

from psycopg.rows import dict_row

from app.python_models import agentgraph_run_observations, card_run_settlement
from app.python_models.idf import load_idf, runtime_projection, write_idf
from app.python_models.idf_contract import InputMaterializationError
from app.python_models.idf_projection import idf_public
from app.python_models.postgres import connect_postgres
from app.python_models.saved_card_contract import CardDomainError, sha256_text


def _record_run_input_artifact(run_id: str, input_file: dict[str, Any]) -> None:
    rows = [(
        f"input:{sha256_text(run_id)[:24]}:idf",
        "input-data-file",
        input_file["idfPath"],
        "application/vnd.liquidaity.idf+json",
        input_file["idfSha256"],
        input_file["idfBytes"],
    )]
    with connect_postgres() as connection, connection.cursor() as cursor:
        for artifact_id, kind, locator, media_type, content_hash, size_bytes in rows:
            cursor.execute(
                """
                INSERT INTO ag_catalog.run_artifacts (
                  artifact_id, producing_run_id, artifact_kind, locator,
                  media_type, content_sha256, provenance_ref, size_bytes
                ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                (
                    artifact_id, run_id, kind, locator, media_type,
                    content_hash, "canonical-runtime-input", size_bytes,
                ),
            )
    for artifact_id, kind, locator, *_ in rows:
        agentgraph_run_observations.observe_artifact(
            run_id, artifact_id, kind, locator
        )


def _input_file_descriptor_for_run(run_id: str) -> dict[str, Any] | None:
    with connect_postgres(autocommit=False) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute("SET TRANSACTION READ ONLY")
            cursor.execute(
                """
                SELECT artifact_kind, locator, content_sha256, size_bytes
                FROM ag_catalog.run_artifacts
                WHERE producing_run_id=%s
                  AND artifact_kind='input-data-file'
                ORDER BY artifact_kind
                """,
                (run_id,),
            )
            rows = {str(row["artifact_kind"]): dict(row) for row in cursor.fetchall()}
    idf = rows.get("input-data-file")
    if idf is None:
        return None
    return {
        "workspace": str(idf["locator"]).rsplit("\\", 1)[0].rsplit("/", 1)[0],
        "idfPath": str(idf["locator"]),
        "idfSha256": str(idf.get("content_sha256") or ""),
        "idfBytes": int(idf.get("size_bytes") or 0),
    }


def _retain_run_idf(
    prepared: dict[str, Any],
    *,
    run_id: str,
    created: bool,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    try:
        if created:
            materialized = prepared.pop("_materializedIdf", None)
            if materialized is None:
                raise InputMaterializationError("input_materialization_unavailable")
            input_file = write_idf(
                materialized,
                project_id=prepared["projectId"],
                deck_id=prepared["deckId"],
                run_id=run_id,
            )
            _record_run_input_artifact(run_id, input_file)
        else:
            prepared.pop("_materializedIdf", None)
            input_file = _input_file_descriptor_for_run(run_id)
            if input_file is None:
                raise InputMaterializationError("input_file_unavailable")
        # The model/runtime request is projected only from the retained bytes.
        loaded = load_idf(
            input_file,
            project_id=prepared["projectId"],
            deck_id=prepared["deckId"],
            run_id=run_id,
            card_id=prepared["cardIdentity"]["cardId"],
        )
        public = idf_public(loaded)
        return public, input_file, runtime_projection(loaded)
    except InputMaterializationError as error:
        raise CardDomainError(str(error)) from error


def retain_required_run_idf(
    prepared: dict[str, Any],
    *,
    run_id: str,
    created: bool,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    """Fail a newly created Run closed when its canonical inputs cannot persist."""

    try:
        return _retain_run_idf(
            prepared,
            run_id=run_id,
            created=created,
        )
    except Exception as error:
        message = str(error) if isinstance(error, CardDomainError) else "input_files_retention_failed"
        if created:
            try:
                card_run_settlement.finish_run({
                    "runId": run_id,
                    "state": "failed",
                    "errorCode": "input_files_materialization_failed",
                    "errorSummary": message,
                })
            except Exception:
                pass
        if isinstance(error, CardDomainError):
            raise
        raise CardDomainError(message) from error
