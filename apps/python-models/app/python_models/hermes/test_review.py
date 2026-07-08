"""Hermes review tests: honest/suspicious/blocked/incomplete/empty verdicts,
context honesty, CBM staleness, blocker-type preservation, serialization
round-trip, and the offline compounding demo (pattern recurrence across two
reviews over supplied ThinkGraph memory)."""

import json

from app.python_models.hermes import (
    CODER_REPORT_FIELDS,
    HermesReview,
    HermesReviewInput,
    review_coder_report,
)

NOW = "2026-07-08T00:00:00+00:00"


def full_report(**overrides):
    """A structurally complete CoderReport matching coderContracts.ts."""
    report = {
        "coderPacketId": "packet_hermes_test_001",
        "status": "succeeded",
        "summary": "Implemented the bounded task and proved it.",
        "specComparison": [
            {"requirement": "add function", "status": "satisfied", "evidence": "tsc green"},
            {"requirement": "add test", "status": "satisfied", "evidence": "pytest passed"},
        ],
        "filesChanged": ["src/example.ts"],
        "proofCommands": ["npx tsc --noEmit", "pytest -q"],
        "proofResults": [
            {"command": "npx tsc --noEmit", "status": "passed", "output": "clean"},
            {"command": "pytest -q", "status": "passed", "output": "2 passed"},
        ],
        "failedCommands": [],
        "blockers": [],
        "assumptions": [],
        "outOfScopeFindings": [],
        "nextRecommendedTask": "wire the next seam",
        "rawOutput": "...",
    }
    report.update(overrides)
    return report


def review(report, **input_overrides):
    return review_coder_report(
        HermesReviewInput(
            coderReport=report,
            featureId="test.feature.hermes-review",
            runId="test_run_hermes_review_001",
            **input_overrides,
        ),
        now=NOW,
    )


class TestVerdicts:
    def test_honest_report(self):
        result = review(full_report())
        assert result.verdict == "honest"
        assert result.proofQuality.requirementsClaimed == 2
        assert result.proofQuality.requirementsProven == 2
        assert result.proofQuality.unprovenRequirements == []
        assert result.graphMemoryWritePlan.status == "ready"
        assert result.graphMemoryWritePlan.runRecord["proofScore"] == 1.0
        assert "coderReport.proofResults" in result.sourceCitations

    def test_succeeded_claims_without_proof_is_suspicious(self):
        result = review(full_report(proofResults=[]))
        assert result.verdict == "suspicious"
        assert any("proofResults is empty" in note for note in result.missingEvidence)
        assert result.proofQuality.requirementsProven == 0
        # every satisfied claim is unproven without a passing proof result
        assert len(result.proofQuality.unprovenRequirements) == 2

    def test_succeeded_with_failed_proof_is_suspicious(self):
        result = review(
            full_report(
                proofResults=[
                    {"command": "pytest -q", "status": "failed", "output": "1 failed"},
                ]
            )
        )
        assert result.verdict == "suspicious"
        assert any("proof command(s) failed" in note for note in result.missingEvidence)

    def test_missing_required_fields_is_incomplete(self):
        broken = full_report()
        del broken["proofResults"]
        del broken["rawOutput"]
        result = review(broken)
        assert result.verdict in ("incomplete", "suspicious")
        assert any("missing required CoderReport fields" in note for note in result.missingEvidence)
        assert any("proofResults" in note for note in result.missingEvidence)

    def test_blocked_report_preserves_explicit_type_and_marks_free_text_unknown(self):
        result = review(
            full_report(
                status="blocked",
                blockers=[
                    {"type": "empty_graph_projection_failure", "summary": "graph readback returned 0 nodes"},
                    "backend port 4000 refused connection",
                ],
            )
        )
        assert result.verdict == "blocked"
        assert result.blockers[0].type == "empty_graph_projection_failure"
        assert result.blockers[1].type == "unknown"  # free text never fake-classified
        assert result.blockers[1].classifiedPattern  # but it gets a stable identity key
        assert result.graphMemoryWritePlan.status == "ready"
        assert len(result.graphMemoryWritePlan.blockers) == 2

    def test_empty_report(self):
        result = review({})
        assert result.verdict == "empty"
        assert result.graphMemoryWritePlan.status == "no_useful_finding"
        assert result.graphMemoryWritePlan.runRecord is None


class TestContextHonesty:
    def test_absent_thinkgraph_and_knowgraph_context_is_explicit(self):
        result = review(full_report())
        notes = [e.summary for e in result.activityEvents if e.type == "context_query"]
        assert "ThinkGraph context: not supplied" in notes
        assert "KnowGraph context: not supplied" in notes

    def test_empty_thinkgraph_context_is_explicit(self):
        result = review(full_report(), thinkGraphContext={"runs": [], "blockers": [], "patterns": []})
        notes = [e.summary for e in result.activityEvents if e.type == "context_query"]
        assert any("empty (no prior run memory)" in n for n in notes)

    def test_stale_cbm_lowers_confidence(self):
        result = review(
            full_report(),
            codeGraphStatus={"project": "C-Projects-main", "status": "ready", "freshness": "stale"},
        )
        assert any("stale" in note for note in result.missingEvidence)
        assert "lower confidence" in result.recommendation
        assert "codeGraphStatus" in result.sourceCitations
        assert result.graphMemoryWritePlan.runRecord["cbmStatus"] == "stale"


class TestCompounding:
    """The offline compounding demo: run 1 finds a new pattern; run 2, given
    the ThinkGraph memory run 1 would have written, reports a recurrence."""

    def test_pattern_occurrence_compounds_over_prior_memory(self):
        blocked = full_report(
            status="blocked",
            blockers=["graph readback returned 0 nodes"],
        )

        first = review(blocked)
        assert first.patternCandidates[0].occurrenceCount == 1
        pattern_id = first.patternCandidates[0].patternId

        second = review(
            blocked,
            thinkGraphContext={
                "runs": [first.graphMemoryWritePlan.runRecord],
                "blockers": first.graphMemoryWritePlan.blockers,
                "patterns": first.graphMemoryWritePlan.patterns,
            },
        )
        assert second.patternCandidates[0].patternId == pattern_id
        assert second.patternCandidates[0].occurrenceCount == 2
        assert "2 times" in second.recommendation
        assert any(
            e.type == "pattern_detected" and "2 occurrence(s)" in e.summary
            for e in second.activityEvents
        )


class TestSerialization:
    def test_round_trip(self):
        result = review(
            full_report(status="blocked", blockers=["graph readback returned 0 nodes"])
        )
        rehydrated = HermesReview.from_dict(json.loads(json.dumps(result.to_dict())))
        assert rehydrated.to_dict() == result.to_dict()

    def test_contract_matches_the_13_field_runtime_schema(self):
        assert len(CODER_REPORT_FIELDS) == 13
        assert set(full_report()) == set(CODER_REPORT_FIELDS)
