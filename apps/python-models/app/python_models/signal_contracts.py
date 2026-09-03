"""Typed, provider-neutral contracts for sourced signal handoffs.

These models carry bounded observations between saved Card Runs. They do not
classify meaning, choose a recipient, authorize a graph write, or imply that a
source result has been assessed. Card/Run identity is supplied by the trusted
runtime caller, never inferred from a model-authored query.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Annotated, Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)


BoundedId = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
BoundedText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4_000)]
IsoTimestamp = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]


class SignalContract(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class SignalGeoPoint(SignalContract):
    type: Literal["Point"] = "Point"
    coordinates: tuple[float, float]

    @field_validator("coordinates")
    @classmethod
    def validate_coordinates(cls, value: tuple[float, float]) -> tuple[float, float]:
        longitude, latitude = value
        if not -180 <= longitude <= 180 or not -90 <= latitude <= 90:
            raise ValueError("signal_point_coordinates_invalid")
        return value


class SignalSourceReference(SignalContract):
    system: BoundedId
    nativeRef: BoundedId
    retrievalMethod: BoundedId
    contentHash: Annotated[str, StringConstraints(pattern=r"^sha256:[0-9a-f]{64}$")]
    licenseRef: BoundedText | None = None
    attribution: BoundedText | None = None


class SignalEvidenceReference(SignalContract):
    sourceNativeRef: BoundedId
    contentHash: Annotated[str, StringConstraints(pattern=r"^sha256:[0-9a-f]{64}$")]
    artifactId: BoundedId | None = None


class SignalQuery(SignalContract):
    schemaVersion: Literal["signal.query.v1"] = "signal.query.v1"
    queryId: BoundedId
    projectId: BoundedId
    deckId: BoundedId
    requestingCardId: BoundedId
    requestingRunId: BoundedId
    reason: BoundedText
    sourceSystem: BoundedId
    command: BoundedId
    arguments: dict[str, Any] = Field(default_factory=dict)
    domains: list[BoundedId] = Field(default_factory=list, max_length=16)
    entityRefs: list[BoundedId] = Field(default_factory=list, max_length=64)
    assetRefs: list[BoundedId] = Field(default_factory=list, max_length=64)
    sourceRefs: list[BoundedId] = Field(default_factory=list, max_length=32)
    geography: SignalGeoPoint | None = None
    fromTime: IsoTimestamp | None = None
    toTime: IsoTimestamp | None = None
    maxAgeSeconds: int | None = Field(default=None, ge=1, le=2_592_000)
    minimumConfidence: float | None = Field(default=None, ge=0, le=1)
    limit: int = Field(default=25, ge=1, le=100)


class SignalCandidate(SignalContract):
    schemaVersion: Literal["signal.candidate.v1"] = "signal.candidate.v1"
    candidateId: BoundedId
    projectId: BoundedId
    deckId: BoundedId
    producerCardId: BoundedId
    producerRunId: BoundedId
    source: SignalSourceReference
    observedAt: IsoTimestamp | None = None
    asOfAt: IsoTimestamp | None = None
    retrievedAt: IsoTimestamp
    expiresAt: IsoTimestamp | None = None
    freshness: Literal["fresh", "stale", "unknown", "retracted"] = "unknown"
    stalenessState: Literal["current", "expired", "unknown", "retracted"] = "unknown"
    domain: BoundedId = "unclassified"
    location: SignalGeoPoint | None = None
    entityRefs: list[BoundedId] = Field(default_factory=list, max_length=64)
    assetRefs: list[BoundedId] = Field(default_factory=list, max_length=64)
    topics: list[BoundedId] = Field(default_factory=list, max_length=32)
    baseline: dict[str, Any] | None = None
    delta: dict[str, Any] | None = None
    anomaly: dict[str, Any] | None = None
    possibleRelevance: BoundedText | None = None
    horizon: BoundedText | None = None
    confidence: float | None = Field(default=None, ge=0, le=1)
    lifecycleStatus: Literal["observed", "watching", "resolved", "retracted"] = "observed"
    evidenceRefs: list[SignalEvidenceReference] = Field(min_length=1, max_length=64)
    rawObservation: dict[str, Any]
    agentHypothesis: BoundedText | None = None


class SignalPackage(SignalContract):
    schemaVersion: Literal["signal.package.v1"] = "signal.package.v1"
    packageId: BoundedId
    projectId: BoundedId
    deckId: BoundedId
    producerCardId: BoundedId
    producerRunId: BoundedId
    generatedAt: IsoTimestamp
    query: SignalQuery
    candidates: list[SignalCandidate] = Field(max_length=100)
    truncated: bool = False
    cursor: BoundedId | None = None
    sourceClocks: dict[str, IsoTimestamp | None] = Field(default_factory=dict)
    errors: list[BoundedText] = Field(default_factory=list, max_length=32)

    @model_validator(mode="after")
    def validate_scope(self) -> "SignalPackage":
        if self.query.projectId != self.projectId or self.query.deckId != self.deckId:
            raise ValueError("signal_package_query_scope_mismatch")
        if self.truncated is False and self.cursor is not None:
            raise ValueError("signal_package_cursor_without_truncation")
        for candidate in self.candidates:
            if (
                candidate.projectId != self.projectId
                or candidate.deckId != self.deckId
                or candidate.producerCardId != self.producerCardId
                or candidate.producerRunId != self.producerRunId
            ):
                raise ValueError("signal_package_candidate_scope_mismatch")
        return self


class SignalAssessment(SignalContract):
    schemaVersion: Literal["signal.assessment.v1"] = "signal.assessment.v1"
    assessmentId: BoundedId
    projectId: BoundedId
    deckId: BoundedId
    requestingCardId: BoundedId
    requestingRunId: BoundedId
    analystCardId: BoundedId
    analysisRunId: BoundedId
    packageId: BoundedId
    candidateIds: list[BoundedId] = Field(min_length=1, max_length=100)
    disposition: Literal["SUPPORTED", "WEAK", "REJECTED", "INCONCLUSIVE"]
    method: BoundedText
    observations: list[BoundedText] = Field(min_length=1, max_length=64)
    inference: BoundedText
    evidenceRefs: list[SignalEvidenceReference] = Field(min_length=1, max_length=64)
    limitations: list[BoundedText] = Field(default_factory=list, max_length=32)
    confidence: float = Field(ge=0, le=1)
    assessedAt: IsoTimestamp
    asOfAt: IsoTimestamp
    expiresAt: IsoTimestamp | None = None
    freshness: Literal["fresh", "stale", "unknown"] = "unknown"


def _canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _sha256(value: Any) -> str:
    return hashlib.sha256(_canonical_json(value).encode("utf-8")).hexdigest()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_signal_query(
    *,
    project_id: str,
    deck_id: str,
    requesting_card_id: str,
    requesting_run_id: str,
    reason: str,
    source_system: str,
    command: str,
    arguments: dict[str, Any] | None = None,
    domains: list[str] | None = None,
    entity_refs: list[str] | None = None,
    asset_refs: list[str] | None = None,
    source_refs: list[str] | None = None,
    geography: SignalGeoPoint | None = None,
    from_time: str | None = None,
    to_time: str | None = None,
    max_age_seconds: int | None = None,
    minimum_confidence: float | None = None,
    limit: int = 25,
) -> SignalQuery:
    """Build a stable query identity from bounded source-native parameters."""

    identity = {
        "projectId": str(project_id or "").strip(),
        "deckId": str(deck_id or "").strip(),
        "requestingCardId": str(requesting_card_id or "").strip(),
        "requestingRunId": str(requesting_run_id or "").strip(),
        "reason": str(reason or "").strip(),
        "sourceSystem": str(source_system or "").strip(),
        "command": str(command or "").strip(),
        "arguments": dict(arguments or {}),
        "domains": list(domains or []),
        "entityRefs": list(entity_refs or []),
        "assetRefs": list(asset_refs or []),
        "sourceRefs": list(source_refs or []),
        "geography": geography.model_dump() if geography is not None else None,
        "fromTime": from_time,
        "toTime": to_time,
        "maxAgeSeconds": max_age_seconds,
        "minimumConfidence": minimum_confidence,
        "limit": limit,
    }
    return SignalQuery(queryId=f"signal-query:{_sha256(identity)[:24]}", **identity)


def package_native_signal_result(
    *,
    query: SignalQuery,
    producer_card_id: str,
    producer_run_id: str,
    result: dict[str, Any],
    retrieved_at: str | None = None,
    observed_at: str | None = None,
    location: SignalGeoPoint | None = None,
    license_ref: str | None = None,
    attribution: str | None = None,
) -> SignalPackage:
    """Wrap one exact native read as an unassessed, provenance-bound candidate.

    The wrapper deliberately keeps freshness ``unknown`` and domain
    ``unclassified`` unless those fields came from the explicit bounded query.
    It never interprets response prose or guesses source timestamps/geometry.
    """

    collected_at = retrieved_at or utc_now()
    payload = dict(result)
    payload_hash = _sha256(payload)
    native_ref = f"{query.sourceSystem}:{query.command}:sha256:{payload_hash}"
    evidence = SignalEvidenceReference(
        sourceNativeRef=native_ref,
        contentHash=f"sha256:{payload_hash}",
    )
    candidate_identity = {
        "queryId": query.queryId,
        "sourceNativeRef": native_ref,
        "contentHash": evidence.contentHash,
    }
    candidate = SignalCandidate(
        candidateId=f"signal-candidate:{_sha256(candidate_identity)[:24]}",
        projectId=query.projectId,
        deckId=query.deckId,
        producerCardId=producer_card_id,
        producerRunId=producer_run_id,
        source=SignalSourceReference(
            system=query.sourceSystem,
            nativeRef=native_ref,
            retrievalMethod=query.command,
            contentHash=evidence.contentHash,
            licenseRef=license_ref,
            attribution=attribution,
        ),
        retrievedAt=collected_at,
        observedAt=observed_at,
        asOfAt=observed_at,
        freshness="unknown",
        stalenessState="unknown",
        domain=query.domains[0] if len(query.domains) == 1 else "unclassified",
        location=location,
        entityRefs=query.entityRefs,
        assetRefs=query.assetRefs,
        evidenceRefs=[evidence],
        rawObservation=payload,
        agentHypothesis=None,
    )
    package_identity = {
        "producerCardId": producer_card_id,
        "producerRunId": producer_run_id,
        "queryId": query.queryId,
        "candidateIds": [candidate.candidateId],
    }
    return SignalPackage(
        packageId=f"signal-package:{_sha256(package_identity)[:24]}",
        projectId=query.projectId,
        deckId=query.deckId,
        producerCardId=producer_card_id,
        producerRunId=producer_run_id,
        generatedAt=collected_at,
        query=query,
        candidates=[candidate],
        sourceClocks={query.sourceSystem: observed_at},
    )
