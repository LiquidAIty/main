from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.python_models.signal_contracts import (
    SignalAssessment,
    SignalGeoPoint,
    SignalQuery,
    build_signal_query,
    package_native_signal_result,
)


def test_native_result_is_unassessed_and_content_addressed() -> None:
    query = build_signal_query(
        project_id="project-1",
        deck_id="deck-1",
        requesting_card_id="card-signal-analyst",
        requesting_run_id="run-request-1",
        reason="Inspect the bounded source window.",
        source_system="worldsignals",
        command="get_layer_slice",
        arguments={"layer": "earthquakes", "limit": 5},
        domains=["geophysical"],
        limit=5,
    )
    package = package_native_signal_result(
        query=query,
        producer_card_id="card_worldsignals_agent",
        producer_run_id="run-1",
        result={"ok": True, "items": [{"id": "native-1", "magnitude": 4.2}]},
        retrieved_at="2026-09-03T10:00:00+00:00",
    )

    candidate = package.candidates[0]
    assert package.schemaVersion == "signal.package.v1"
    assert candidate.schemaVersion == "signal.candidate.v1"
    assert candidate.freshness == "unknown"
    assert candidate.domain == "geophysical"
    assert candidate.projectId == "project-1"
    assert candidate.rawObservation["items"][0]["id"] == "native-1"
    assert candidate.agentHypothesis is None
    assert candidate.source.nativeRef.startswith("worldsignals:get_layer_slice:sha256:")
    assert candidate.evidenceRefs[0].contentHash == candidate.source.contentHash


def test_native_identity_is_stable_across_mapping_order() -> None:
    first = build_signal_query(
        project_id="project-1",
        deck_id="deck-1",
        requesting_card_id="card-signal-analyst",
        requesting_run_id="run-request-1",
        reason="Inspect changes.",
        source_system="worldsignals",
        command="what_changed",
        arguments={"window": "1h", "limit": 10},
    )
    second = build_signal_query(
        project_id="project-1",
        deck_id="deck-1",
        requesting_card_id="card-signal-analyst",
        requesting_run_id="run-request-1",
        reason="Inspect changes.",
        source_system="worldsignals",
        command="what_changed",
        arguments={"limit": 10, "window": "1h"},
    )
    assert first.queryId == second.queryId

    one = package_native_signal_result(
        query=first,
        producer_card_id="card-a",
        producer_run_id="run-a",
        result={"ok": True, "count": 1},
        retrieved_at="2026-09-03T10:00:00+00:00",
    )
    two = package_native_signal_result(
        query=second,
        producer_card_id="card-a",
        producer_run_id="run-a",
        result={"count": 1, "ok": True},
        retrieved_at="2026-09-03T10:00:00+00:00",
    )
    assert one.packageId == two.packageId
    assert one.candidates[0].candidateId == two.candidates[0].candidateId


def test_contracts_reject_invalid_geometry_and_unknown_fields() -> None:
    with pytest.raises(ValidationError, match="signal_point_coordinates_invalid"):
        SignalGeoPoint(coordinates=(181, 20))

    with pytest.raises(ValidationError, match="extra_forbidden"):
        SignalQuery.model_validate({
            **build_signal_query(
                project_id="project-1",
                deck_id="deck-1",
                requesting_card_id="card-signal-analyst",
                requesting_run_id="run-request-1",
                reason="Inspect changes.",
                source_system="worldsignals",
                command="what_changed",
            ).model_dump(),
            "inventedAuthority": True,
        })


def test_assessment_is_a_separate_analyst_run_contract() -> None:
    assessment = SignalAssessment(
        assessmentId="assessment-1",
        projectId="project-1",
        deckId="deck-1",
        requestingCardId="card-worldview",
        requestingRunId="run-worldview-1",
        analystCardId="card-evidence-analyst",
        analysisRunId="run-analyst-1",
        packageId="signal-package:abc",
        candidateIds=["signal-candidate:def"],
        disposition="INCONCLUSIVE",
        method="Single-source evidence review.",
        observations=["The package contains one sourced observation."],
        inference="The observation deserves bounded follow-up.",
        evidenceRefs=[{
            "sourceNativeRef": "worldsignals:what_changed:sha256:" + "a" * 64,
            "contentHash": "sha256:" + "a" * 64,
        }],
        limitations=["One source result is not enough to confirm the claim."],
        confidence=0.35,
        assessedAt="2026-09-03T10:05:00+00:00",
        asOfAt="2026-09-03T10:00:00+00:00",
    )
    assert assessment.disposition == "INCONCLUSIVE"
    assert assessment.analystCardId != "card_worldsignals_agent"
