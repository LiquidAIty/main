"""PDF source authority and Graphiti episode ingestion for KnowGraph."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import NAMESPACE_URL, uuid5

import graphiti_runtime
import jev_fact_settlement
from graphiti_identity import graphiti_project_group_id

GRAPHITI_EPISODE_NAMESPACE = "liquidaity:knowgraph:episode"
_SHA256 = re.compile(r"^[0-9a-f]{64}$")


@dataclass(frozen=True)
class PdfSourceSection:
    title: str
    page_start: int
    page_end: int
    text: str


def _normalize_optional_json_value(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return None
        try:
            return json.loads(stripped)
        except (TypeError, ValueError):
            return stripped
    return value


def _serialize_metadata_json(value: Any) -> str | None:
    normalized = _normalize_optional_json_value(value)
    if normalized is None:
        return None
    try:
        return json.dumps(normalized, sort_keys=True)
    except (TypeError, ValueError):
        return str(normalized)


def _sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _episode_identity(project_id: str, document_id: str, text: str) -> tuple[str, str]:
    fingerprint = _sha256_hex(text)
    identity = f"{GRAPHITI_EPISODE_NAMESPACE}:{project_id}:{document_id}:{fingerprint}"
    return str(uuid5(NAMESPACE_URL, identity)), fingerprint


async def _find_existing_episode_id(
    graphiti: Any,
    *,
    candidate_episode_id: str,
    project_id: str,
    document_id: str,
    content_fingerprint: str,
) -> str | None:
    result = await graphiti.driver.execute_query(
        """
        MATCH (episode:Episodic)
        WHERE episode.uuid = $candidate_episode_id
           OR (
                episode.group_id = $group_id
                AND episode.project_id = $project_id
                AND episode.document_id = $document_id
                AND episode.content_fingerprint = $content_fingerprint
           )
        RETURN episode.uuid AS uuid
        LIMIT 1
        """,
        candidate_episode_id=candidate_episode_id,
        group_id=graphiti_project_group_id(project_id),
        project_id=project_id,
        document_id=document_id,
        content_fingerprint=content_fingerprint,
        routing_="r",
    )
    records = graphiti_runtime.graphiti_records(result)
    if not records:
        return None
    existing_id = str(records[0].get("uuid") or "").strip()
    return existing_id or None


async def _record_episode_authority(
    graphiti: Any,
    *,
    episode_id: str,
    project_id: str,
    document_id: str,
    source_name: str,
    source_reference: str,
    source_content_sha256: str,
    metadata_json: str | None,
    content_fingerprint: str,
    provider: str,
    model_id: str,
) -> None:
    await graphiti.driver.execute_query(
        """
        MATCH (episode:Episodic {uuid: $episode_id})
        SET episode.project_id = $project_id,
            episode.document_id = $document_id,
            episode.source_name = $source_name,
            episode.source_path = $source_reference,
            episode.source_reference = $source_reference,
            episode.source_type = 'pdf_upload',
            episode.source_content_sha256 = $source_content_sha256,
            episode.metadata_json = $metadata_json,
            episode.content_fingerprint = $content_fingerprint,
            episode.extraction_provider = $provider,
            episode.extraction_model = $model_id,
            episode.graphiti_version = $graphiti_version
        """,
        episode_id=episode_id,
        project_id=project_id,
        document_id=document_id,
        source_name=source_name,
        source_reference=source_reference,
        source_content_sha256=source_content_sha256,
        metadata_json=metadata_json,
        content_fingerprint=content_fingerprint,
        provider=provider,
        model_id=model_id,
        graphiti_version=graphiti_runtime.graphiti_core_version(),
    )


def _empty_jev_classification(status: str, reason: str) -> dict[str, Any]:
    return {
        "status": status,
        "touched_fact_count": 0,
        "classified_fact_count": 0,
        "reused_fact_count": 0,
        "attempted_fact_uuids": [],
        "succeeded_fact_uuids": [],
        "failed_fact_uuids": [],
        "skipped_fact_uuids": [],
        "unfinished_fact_uuids": [],
        "still_unsettled_fact_uuids": [],
        **(
            {"reason": reason}
            if status == "not_checked"
            else {"failure_reason": reason}
        ),
    }


async def _ingest_pdf_episode(
    *,
    project_id: str,
    document_id: str,
    text: str,
    source_name: str,
    source_reference: str,
    source_content_sha256: str,
    metadata: dict[str, Any],
    reference_time: datetime,
) -> dict[str, Any]:
    from graphiti_core.nodes import EpisodeType

    candidate_episode_id, content_fingerprint = _episode_identity(
        project_id, document_id, text
    )
    runtime, graphiti, _database = graphiti_runtime.create_graphiti_runtime()
    try:
        existing_episode_id = await _find_existing_episode_id(
            graphiti,
            candidate_episode_id=candidate_episode_id,
            project_id=project_id,
            document_id=document_id,
            content_fingerprint=content_fingerprint,
        )
        if existing_episode_id:
            return {
                "status": "already_ingested",
                "ingest_id": candidate_episode_id,
                "episode_id": existing_episode_id,
                "project_id": project_id,
                "document_id": document_id,
                "provider": runtime.provider,
                "model": runtime.model_id,
                "source_name": source_name,
                "source_reference": source_reference,
                "source_content_sha256": source_content_sha256,
                "content_fingerprint": content_fingerprint,
                "idempotent": True,
                "graphiti_version": graphiti_runtime.graphiti_core_version(),
                "relationship_vocabulary_guidance": {
                    "status": "not_checked",
                    "reason": "episode_already_ingested",
                },
                "jev_classification": _empty_jev_classification(
                    "not_checked", "episode_already_ingested"
                ),
            }

        relationship_vocabulary: dict[str, Any] | None = None
        try:
            relationship_vocabulary = await (
                jev_fact_settlement.read_project_relationship_vocabulary(project_id)
            )
            extraction_guidance = jev_fact_settlement.relationship_vocabulary_guidance(
                None, relationship_vocabulary
            )
            vocabulary_guidance = {
                "status": "available",
                "version": relationship_vocabulary.get("version"),
                "hash": relationship_vocabulary.get("hash"),
                "count": relationship_vocabulary.get("count"),
            }
        except Exception as error:
            extraction_guidance = None
            vocabulary_guidance = {
                "status": "unavailable",
                "failure_reason": str(error).strip() or type(error).__name__,
            }

        result = await graphiti.add_episode(
            name=source_name,
            episode_body=text,
            source_description=source_reference,
            reference_time=reference_time,
            source=EpisodeType.text,
            group_id=graphiti_project_group_id(project_id),
            update_communities=False,
            custom_extraction_instructions=extraction_guidance,
        )
        episode_id = str(result.episode.uuid)
        await _record_episode_authority(
            graphiti,
            episode_id=episode_id,
            project_id=project_id,
            document_id=document_id,
            source_name=source_name,
            source_reference=source_reference,
            source_content_sha256=source_content_sha256,
            metadata_json=_serialize_metadata_json(metadata),
            content_fingerprint=content_fingerprint,
            provider=runtime.provider,
            model_id=runtime.model_id,
        )
        try:
            if relationship_vocabulary is None:
                relationship_vocabulary = await (
                    jev_fact_settlement.read_project_relationship_vocabulary(project_id)
                )
            jev_classification = await jev_fact_settlement.classify_episode_facts_with_jev(
                graphiti,
                project_id=project_id,
                edges=list(result.edges),
                nodes=list(result.nodes),
                episode_id=episode_id,
                source_name=source_name,
                source_reference=source_reference,
                text=text,
                reference_time=reference_time,
                relationship_vocabulary=relationship_vocabulary,
            )
        except Exception as error:
            unsettled = [
                str(jev_fact_settlement.graphiti_value(edge, "uuid") or "")
                for edge in result.edges
                if str(jev_fact_settlement.graphiti_value(edge, "uuid") or "")
            ]
            jev_classification = {
                **_empty_jev_classification(
                    "unavailable", str(error).strip() or type(error).__name__
                ),
                "touched_fact_count": len(result.edges),
                "unfinished_fact_uuids": unsettled,
                "still_unsettled_fact_uuids": unsettled,
            }
        return {
            "status": "ingested",
            "ingest_id": candidate_episode_id,
            "episode_id": episode_id,
            "project_id": project_id,
            "document_id": document_id,
            "provider": runtime.provider,
            "model": runtime.model_id,
            "source_name": source_name,
            "source_reference": source_reference,
            "source_content_sha256": source_content_sha256,
            "content_fingerprint": content_fingerprint,
            "idempotent": False,
            "graphiti_version": graphiti_runtime.graphiti_core_version(),
            "entity_count": len(result.nodes),
            "fact_count": len(result.edges),
            "relationship_vocabulary_guidance": vocabulary_guidance,
            "jev_classification": jev_classification,
        }
    finally:
        await graphiti.driver.close()


def _pdf_source_sections(
    reader: Any,
    source_name: str,
    *,
    single_episode_max_chars: int = 180_000,
) -> list[PdfSourceSection]:
    page_texts = [(page.extract_text() or "").strip() for page in reader.pages]
    complete_text = "\n\n".join(text for text in page_texts if text).strip()
    if not complete_text:
        return []
    if len(complete_text) <= single_episode_max_chars:
        return [PdfSourceSection(
            title="Complete document", page_start=1, page_end=len(page_texts), text=complete_text,
        )]

    starts: dict[int, list[str]] = {}
    for item in getattr(reader, "outline", []) or []:
        if isinstance(item, list):
            continue
        title = " ".join(str(getattr(item, "title", item) or "").split())
        if not title:
            continue
        try:
            page_index = int(reader.get_destination_page_number(item))
        except Exception:
            continue
        if 0 <= page_index < len(page_texts):
            starts.setdefault(page_index, []).append(title)
    if len(starts) < 2:
        raise ValueError(
            f"Large PDF has no usable authored outline: {source_name}. "
            "Refusing an arbitrary fixed-size split."
        )
    if 0 not in starts:
        starts[0] = ["Front matter"]

    ordered_starts = sorted(starts)
    sections: list[PdfSourceSection] = []
    for index, page_index in enumerate(ordered_starts):
        next_page_index = ordered_starts[index + 1] if index + 1 < len(ordered_starts) else len(page_texts)
        section_text = "\n\n".join(
            text for text in page_texts[page_index:next_page_index] if text
        ).strip()
        if section_text:
            sections.append(PdfSourceSection(
                title=" / ".join(starts[page_index]),
                page_start=page_index + 1,
                page_end=next_page_index,
                text=section_text,
            ))
    return sections


_JEV_ID_FIELDS = (
    "attempted_fact_uuids", "succeeded_fact_uuids", "failed_fact_uuids",
    "skipped_fact_uuids", "unfinished_fact_uuids", "still_unsettled_fact_uuids",
)


def _unique_strings(values: list[Any]) -> list[str]:
    return list(dict.fromkeys(str(value).strip() for value in values if str(value).strip()))


def _aggregate_jev_classifications(results: list[dict[str, Any]]) -> dict[str, Any]:
    classifications = [
        result.get("jev_classification")
        if isinstance(result.get("jev_classification"), dict)
        else _empty_jev_classification("unavailable", "jev_classification_missing")
        for result in results
    ]
    statuses = [str(value.get("status") or "unavailable") for value in classifications]
    settled_sections = [
        status for status in statuses if status in {"success", "current", "partial"}
    ]
    if statuses and all(status == "not_checked" for status in statuses):
        status = "not_checked"
    elif any(item in {"partial", "unavailable", "not_checked"} for item in statuses):
        status = "partial" if settled_sections else "unavailable"
    elif "success" in statuses:
        status = "success"
    else:
        status = "current"
    aggregated: dict[str, Any] = {
        "status": status,
        "section_count": len(classifications),
        "touched_fact_count": sum(int(value.get("touched_fact_count") or 0) for value in classifications),
        "classified_fact_count": sum(int(value.get("classified_fact_count") or 0) for value in classifications),
        "reused_fact_count": sum(int(value.get("reused_fact_count") or 0) for value in classifications),
    }
    for field in _JEV_ID_FIELDS:
        aggregated[field] = _unique_strings([
            item for value in classifications
            for item in (value.get(field) if isinstance(value.get(field), list) else [])
        ])
    failure_reasons: dict[str, str] = {}
    section_failures: list[dict[str, Any]] = []
    section_reasons: list[dict[str, Any]] = []
    for index, value in enumerate(classifications):
        raw_reasons = value.get("failure_reasons")
        if isinstance(raw_reasons, dict):
            failure_reasons.update({
                str(key): str(reason) for key, reason in raw_reasons.items()
                if str(key) and str(reason)
            })
        failure_reason = str(value.get("failure_reason") or "").strip()
        if failure_reason:
            section_failures.append({"section_index": index, "reason": failure_reason})
        reason = str(value.get("reason") or "").strip()
        if reason:
            section_reasons.append({
                "section_index": index,
                "status": str(value.get("status") or ""),
                "reason": reason,
            })
    if failure_reasons:
        aggregated["failure_reasons"] = failure_reasons
    if section_failures:
        aggregated["section_failures"] = section_failures
    if section_reasons:
        aggregated["section_reasons"] = section_reasons
    return aggregated


async def ingest_pdf(
    file_path: str,
    project_id: str,
    document_id: str,
    *,
    source_name: str,
    source_reference: str,
    source_content_sha256: str,
) -> dict[str, Any]:
    """Extract one immutable PDF artifact into source-authored Graphiti episodes."""

    canonical_project_id = str(project_id or "").strip()
    canonical_document_id = str(document_id or "").strip()
    canonical_source_name = str(source_name or "").strip()
    if not canonical_project_id:
        raise ValueError("project_id is required")
    if not canonical_document_id:
        raise ValueError("document_id is required")
    if not canonical_source_name:
        raise ValueError("source_name is required")
    if not _SHA256.fullmatch(source_content_sha256):
        raise ValueError("source_content_sha256_invalid")
    if not source_reference.startswith(
        f"knowgraph-upload://sha256/{source_content_sha256}/"
    ):
        raise ValueError("source_reference_invalid")

    source = Path(file_path)
    if not source.is_file():
        raise FileNotFoundError(f"File not found: {file_path}")
    try:
        from pypdf import PdfReader
    except ImportError as error:
        raise RuntimeError("pypdf is required for KnowGraph PDF ingestion") from error
    reader = PdfReader(str(source))
    sections = _pdf_source_sections(reader, canonical_source_name)
    if not sections:
        raise ValueError(f"PDF contains no extractable text: {canonical_source_name}")
    reference_time = datetime.fromtimestamp(source.stat().st_mtime, tz=timezone.utc)
    results: list[dict[str, Any]] = []
    for index, section in enumerate(sections):
        episode_body = (
            f"SOURCE DOCUMENT: {canonical_source_name}\n"
            f"SOURCE SECTION: {section.title}\n"
            f"PDF PAGES: {section.page_start}-{section.page_end}\n\n{section.text}"
        )
        results.append(await _ingest_pdf_episode(
            project_id=canonical_project_id,
            document_id=canonical_document_id,
            text=episode_body,
            source_name=f"{canonical_source_name} :: {section.title}",
            source_reference=source_reference,
            source_content_sha256=source_content_sha256,
            metadata={
                "source_reference": source_reference,
                "source_content_sha256": source_content_sha256,
                "source_name": canonical_source_name,
                "section_title": section.title,
                "page_start": section.page_start,
                "page_end": section.page_end,
                "section_index": index,
                "section_count": len(sections),
            },
            reference_time=reference_time,
        ))

    document_text = "\n\n".join(section.text for section in sections)
    document_ingest_id, document_fingerprint = _episode_identity(
        canonical_project_id, canonical_document_id, document_text
    )
    first = results[0]
    newly_ingested = [result for result in results if not result.get("idempotent")]
    return {
        "status": "ingested" if newly_ingested else "already_ingested",
        "ingest_id": document_ingest_id,
        "episode_id": first["episode_id"],
        "episode_ids": [result["episode_id"] for result in results],
        "project_id": canonical_project_id,
        "document_id": canonical_document_id,
        "provider": first["provider"],
        "model": first["model"],
        "source_name": canonical_source_name,
        "source_reference": source_reference,
        "source_content_sha256": source_content_sha256,
        "content_fingerprint": document_fingerprint,
        "idempotent": not newly_ingested,
        "graphiti_version": graphiti_runtime.graphiti_core_version(),
        "section_count": len(results),
        "entity_count": sum(int(result.get("entity_count") or 0) for result in results),
        "fact_count": sum(int(result.get("fact_count") or 0) for result in results),
        "jev_classification": _aggregate_jev_classifications(results),
        "sections": [
            {
                "title": section.title,
                "page_start": section.page_start,
                "page_end": section.page_end,
                "episode_id": result["episode_id"],
                "status": result["status"],
                "relationship_vocabulary_guidance": result["relationship_vocabulary_guidance"],
                "jev_classification": result["jev_classification"],
            }
            for section, result in zip(sections, results, strict=True)
        ],
    }
