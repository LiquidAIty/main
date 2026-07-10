"""Hermes CoderReport review — pure Python, structure-grounded skepticism.

``review_coder_report`` is pure: no network, no MCP, no DB, no file writes,
no subprocess, no hidden fallbacks. It validates the report against the REAL
runtime CoderReport contract (protocol.CODER_REPORT_FIELDS), accounts proof
structurally, preserves-or-marks-unknown blocker types (never fake-classifies
free text), and builds the ThinkGraph write PLAN. Meaning stays with the
model on the Hermes card; this module checks structure and internal
consistency only.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional, Union

from . import graph_memory
from .protocol import (
    BlockerFinding,
    CODER_REPORT_FIELDS,
    HermesActivityEntry,
    HermesReview,
    HermesReviewInput,
    PatternCandidate,
    ProofQuality,
    RunRecord,
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _pattern_key(text: str) -> str:
    """Deterministic canonicalization of blocker text into a stable identity
    key (lowercased, alnum runs joined by underscores, bounded). An identity
    slug, not a semantic classification."""
    words: list[str] = []
    current: list[str] = []
    for ch in text.lower():
        if ch.isalnum():
            current.append(ch)
        elif current:
            words.append("".join(current))
            current = []
    if current:
        words.append("".join(current))
    return "_".join(words)[:60] or "unspecified"


def _normalize_input(value: Union[HermesReviewInput, dict[str, Any]]) -> HermesReviewInput:
    if isinstance(value, HermesReviewInput):
        return value
    return HermesReviewInput(
        coderReport=dict(value.get("coderReport") or {}),
        featureId=str(value.get("featureId") or ""),
        projectId=str(value["projectId"]) if value.get("projectId") else None,
        runId=str(value["runId"]) if value.get("runId") else None,
        thinkGraphContext=(
            dict(value["thinkGraphContext"])
            if isinstance(value.get("thinkGraphContext"), dict)
            else None
        ),
        codeGraphStatus=(
            dict(value["codeGraphStatus"])
            if isinstance(value.get("codeGraphStatus"), dict)
            else None
        ),
        knowGraphContext=(
            dict(value["knowGraphContext"])
            if isinstance(value.get("knowGraphContext"), dict)
            else None
        ),
    )


def _known_pattern_counts(think_graph_context: Optional[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Prior Pattern records keyed by patternId, from supplied ThinkGraph
    context. Absent/malformed context yields no priors — reported explicitly
    by the caller, never guessed here."""
    if not isinstance(think_graph_context, dict):
        return {}
    known: dict[str, dict[str, Any]] = {}
    for pattern in think_graph_context.get("patterns") or []:
        if isinstance(pattern, dict) and pattern.get("patternId"):
            known[str(pattern["patternId"])] = pattern
    return known


def review_run_result(
    run_input: dict[str, Any],
    now: Optional[str] = None,
) -> HermesReview:
    """Postflight review of ONE Mag One / team run result (pure, structural).

    Input mirrors the REAL RunMagOneResult seam (liquidAItyAgentFlow.ts):
    ``{runId, status: completed|partial|failed, failure?, finalTextPresent?,
    participants?: [cardId...], projectId?, conversationId?}``. Verdicts are
    deterministic over the supplied structure; nothing is inferred from prose.
    The returned graphMemoryWritePlan persists only through the card-scoped
    apply_thinkgraph_patch authority, elsewhere.
    """
    data = run_input if isinstance(run_input, dict) else {}
    timestamp = now or _now_iso()
    run_id = str(data.get("runId") or "").strip()

    activity: list[HermesActivityEntry] = []
    entry_count = 0

    def add_activity(entry_type: str, summary: str, detail: Optional[str] = None) -> None:
        nonlocal entry_count
        entry_count += 1
        activity.append(
            HermesActivityEntry(
                id=f"hermes:{run_id or 'unknown_run'}:{entry_count}",
                timestamp=timestamp,
                type=entry_type,
                summary=summary,
                detail=detail,
                runId=run_id or None,
            )
        )

    if not run_id:
        add_activity("review_complete", "Verdict: empty — run result carries no runId")
        return HermesReview(
            verdict="empty",
            missingEvidence=["run result has no runId — nothing attributable to review"],
            recommendation="No reviewable run identity was supplied; nothing recorded.",
            graphMemoryWritePlan=graph_memory.build_write_plan(
                verdict="empty", run_record=None, blockers=[], patterns=[]
            ),
            sourceCitations=["runResult"],
            activityEvents=activity,
        )

    add_activity("review_started", f"Reviewing run result for {run_id}")

    status = str(data.get("status") or "").strip()
    failure = str(data.get("failure") or "").strip()
    final_text_present = bool(data.get("finalTextPresent"))
    participants = [str(p) for p in (data.get("participants") or []) if str(p).strip()]
    # Supplied run-memory structure (bounded): the user objective the run
    # served and the run's actual final text. Never inferred from prose here.
    objective = " ".join(str(data.get("objective") or "").split())
    final_text = " ".join(str(data.get("finalText") or "").split())

    blocker_findings: list[BlockerFinding] = []
    if failure:
        blocker_findings.append(
            BlockerFinding(
                blockerId=f"{run_id}:blocker:0",
                type="run_failure",
                summary=failure,
                runId=run_id,
                timestamp=timestamp,
                classifiedPattern=_pattern_key(failure),
                sourceCitations=["runResult.failure"],
            )
        )

    if status == "failed" or blocker_findings:
        verdict = "blocked"
    elif status == "partial":
        verdict = "incomplete"
    elif status == "completed" and not final_text_present:
        verdict = "suspicious"
    elif status == "completed":
        verdict = "honest"
    else:
        verdict = "incomplete"

    run_status = {"completed": "completed", "partial": "partial", "failed": "failed"}.get(
        status, "failed"
    )
    citations = ["runResult.status"]
    if failure:
        citations.append("runResult.failure")
    if participants:
        citations.append("runResult.participants")
    if objective:
        citations.append("runResult.objective")
    run_record = RunRecord(
        runId=run_id,
        featureId="",
        status=run_status,
        proofScore=0.0,
        totalRequirements=0,
        timestamp=timestamp,
        filesChanged=[],
        blockerSummary=blocker_findings[0].summary if blocker_findings else None,
        sourceCitations=citations,
        objective=objective or None,
        # The accepted decision is remembered only for an honest completed run
        # with real visible text — never for blocked/partial/suspicious runs.
        decisionSummary=final_text if verdict == "honest" and final_text else None,
    )

    pattern_candidates: list[PatternCandidate] = []
    for finding in blocker_findings:
        key = finding.classifiedPattern or "unspecified"
        pattern_candidates.append(
            PatternCandidate(
                patternId=key,
                name=key,
                occurrenceCount=1,
                firstSeen=timestamp,
                lastSeen=timestamp,
                samples=[finding.summary],
            )
        )
        add_activity("pattern_detected", f"Pattern {key}: 1st occurrence", detail=finding.summary)

    write_plan = graph_memory.build_write_plan(
        verdict=verdict,
        run_record=run_record,
        blockers=blocker_findings,
        patterns=pattern_candidates,
    )

    if verdict == "blocked":
        recommendation = (
            f"Run blocked: {run_record.blockerSummary or 'see failure'}. "
            "Record the blocker before retrying the same run."
        )
    elif verdict == "suspicious":
        recommendation = (
            "Run reports completed but returned no visible final text — "
            "do not trust the run as delivered; re-run or inspect the transcript."
        )
    elif verdict == "incomplete":
        recommendation = "Run is partial/unclassified — narrow the next Run Packet to the unfinished work."
    else:
        recommendation = "Run completed with a real visible result. Safe to record and proceed."

    add_activity(
        "review_complete",
        f"Run {run_id}: verdict={verdict}"
        + (f", participants=[{','.join(participants)}]" if participants else ""),
    )
    if write_plan.status == "ready":
        planned = 1 + len(write_plan.blockers) + len(write_plan.patterns)
        add_activity(
            "thinkgraph_write_planned",
            f"ThinkGraph write plan ready: {planned} node(s), {len(write_plan.edges)} edge(s)",
        )
    if verdict == "blocked":
        add_activity("blocked", f"Blocker recorded for run {run_id}")

    return HermesReview(
        verdict=verdict,
        proofQuality=ProofQuality(),
        missingEvidence=[],
        blockers=blocker_findings,
        patternCandidates=pattern_candidates,
        recommendation=recommendation,
        graphMemoryWritePlan=write_plan,
        sourceCitations=citations,
        activityEvents=activity,
    )


def review_coder_report(
    review_input: Union[HermesReviewInput, dict[str, Any]],
    now: Optional[str] = None,
) -> HermesReview:
    """Review one CoderReport and return a HermesReview with a graph write
    plan. ``now`` exists for deterministic tests only."""
    data = _normalize_input(review_input)
    timestamp = now or _now_iso()
    report = data.coderReport if isinstance(data.coderReport, dict) else {}
    run_id = data.runId or str(report.get("coderPacketId") or "").strip() or "unknown_run"

    activity: list[HermesActivityEntry] = []
    entry_count = 0

    def add_activity(entry_type: str, summary: str, detail: Optional[str] = None) -> None:
        nonlocal entry_count
        entry_count += 1
        activity.append(
            HermesActivityEntry(
                id=f"hermes:{run_id}:{entry_count}",
                timestamp=timestamp,
                type=entry_type,
                summary=summary,
                detail=detail,
                runId=run_id,
                featureId=data.featureId or None,
            )
        )

    add_activity("review_started", f"Reviewing CoderReport for run {run_id}")

    # Supplied-context honesty: absent context is named, never fabricated.
    if data.thinkGraphContext is None:
        add_activity("context_query", "ThinkGraph context: not supplied")
    elif not any(data.thinkGraphContext.get(k) for k in ("runs", "blockers", "patterns")):
        add_activity("context_query", "ThinkGraph context: empty (no prior run memory)")
    else:
        prior_runs = len(data.thinkGraphContext.get("runs") or [])
        add_activity("context_query", f"ThinkGraph context: {prior_runs} prior run(s) supplied")
    if data.knowGraphContext is None:
        add_activity("context_query", "KnowGraph context: not supplied")

    # ---- empty --------------------------------------------------------------
    if not report or not any(str(v).strip() for v in report.values() if v is not None):
        add_activity("review_complete", "Verdict: empty — no reviewable content")
        return HermesReview(
            verdict="empty",
            proofQuality=ProofQuality(),
            missingEvidence=["coderReport has no reviewable content"],
            recommendation=(
                "The CoderReport is empty — there is nothing to verify. "
                "Re-run the coder with a bounded packet before trusting any claim."
            ),
            graphMemoryWritePlan=graph_memory.build_write_plan(
                verdict="empty", run_record=None, blockers=[], patterns=[]
            ),
            sourceCitations=["coderReport"],
            activityEvents=activity,
        )

    # ---- structural accounting ----------------------------------------------
    missing_fields = [f for f in CODER_REPORT_FIELDS if f not in report]
    status = str(report.get("status") or "").strip()
    spec_items = [i for i in (report.get("specComparison") or []) if isinstance(i, dict)]
    satisfied = [i for i in spec_items if str(i.get("status")) == "satisfied"]
    unresolved = [str(i.get("requirement") or "") for i in spec_items if str(i.get("status")) != "satisfied"]
    proof_results = [p for p in (report.get("proofResults") or []) if isinstance(p, dict)]
    passed_proofs = [p for p in proof_results if str(p.get("status")) == "passed"]
    failed_proofs = [p for p in proof_results if str(p.get("status")) == "failed"]
    failed_commands = [str(c) for c in (report.get("failedCommands") or [])]
    files_changed = [str(f) for f in (report.get("filesChanged") or [])]
    raw_blockers = report.get("blockers") or []

    citations = ["coderReport.status", "coderReport.specComparison", "coderReport.proofResults"]
    if raw_blockers:
        citations.append("coderReport.blockers")
    if failed_commands:
        citations.append("coderReport.failedCommands")
    if files_changed:
        citations.append("coderReport.filesChanged")

    missing_evidence: list[str] = []
    if missing_fields:
        missing_evidence.append(
            "missing required CoderReport fields: " + ", ".join(missing_fields)
        )
    if status == "succeeded" and not proof_results:
        missing_evidence.append("status is 'succeeded' but proofResults is empty")
    if status == "succeeded" and failed_proofs:
        missing_evidence.append(
            f"status is 'succeeded' but {len(failed_proofs)} proof command(s) failed"
        )
    if status == "succeeded" and failed_commands:
        missing_evidence.append("status is 'succeeded' but failedCommands is non-empty")
    if files_changed and not report.get("proofCommands"):
        missing_evidence.append("filesChanged listed but no proofCommands were run")
    if satisfied and not passed_proofs:
        missing_evidence.append(
            f"{len(satisfied)} requirement(s) claimed satisfied without a passing proof result"
        )

    # CBM freshness is supplied context: stale index lowers code-claim confidence.
    cbm_status: Optional[str] = None
    if isinstance(data.codeGraphStatus, dict) and data.codeGraphStatus:
        freshness = str(data.codeGraphStatus.get("freshness") or data.codeGraphStatus.get("status") or "")
        cbm_status = freshness or None
        citations.append("codeGraphStatus")
        if freshness.lower() == "stale":
            missing_evidence.append(
                "codeGraphStatus is stale — code-structure claims are lower confidence until CBM is refreshed"
            )

    proven = len(satisfied) if passed_proofs else 0
    unproven = list(unresolved) + (
        [str(i.get("requirement") or "") for i in satisfied] if not passed_proofs else []
    )
    proof_quality = ProofQuality(
        requirementsClaimed=len(spec_items),
        requirementsProven=proven,
        unprovenRequirements=[r for r in unproven if r],
        missingEvidence=list(missing_evidence),
        proofCommandsPresent=bool(report.get("proofCommands")),
        proofResultsPresent=bool(proof_results),
    )

    # ---- blockers: preserve explicit types, never fake-classify free text ----
    blocker_findings: list[BlockerFinding] = []
    for index, raw in enumerate(raw_blockers):
        if isinstance(raw, dict):
            summary = str(raw.get("summary") or raw.get("text") or "").strip()
            explicit_type = str(raw.get("type") or "").strip()
        else:
            summary = str(raw).strip()
            explicit_type = ""
        if not summary:
            continue
        blocker_findings.append(
            BlockerFinding(
                blockerId=f"{run_id}:blocker:{index}",
                type=explicit_type or "unknown",
                summary=summary,
                runId=run_id,
                timestamp=timestamp,
                classifiedPattern=_pattern_key(summary),
                sourceCitations=["coderReport.blockers"],
            )
        )

    # ---- pattern candidates: occurrence compounds over supplied prior memory --
    known_patterns = _known_pattern_counts(data.thinkGraphContext)
    candidates: dict[str, PatternCandidate] = {}
    for finding in blocker_findings:
        key = finding.classifiedPattern or "unspecified"
        if key in candidates:
            candidates[key].samples.append(finding.summary)
            continue
        prior = known_patterns.get(key)
        prior_count = int(prior.get("occurrenceCount") or 0) if prior else 0
        candidates[key] = PatternCandidate(
            patternId=key,
            name=key,
            occurrenceCount=prior_count + 1,
            firstSeen=str(prior.get("firstSeen")) if prior and prior.get("firstSeen") else timestamp,
            lastSeen=timestamp,
            samples=[finding.summary],
        )
    pattern_candidates = list(candidates.values())
    for candidate in pattern_candidates:
        occurrence = (
            f"{candidate.occurrenceCount} occurrence(s)"
            if candidate.occurrenceCount > 1
            else "1st occurrence"
        )
        add_activity(
            "pattern_detected",
            f"Pattern {candidate.patternId}: {occurrence}",
            detail=candidate.samples[0] if candidate.samples else None,
        )

    # ---- verdict (deterministic precedence, documented) ----------------------
    if status == "blocked" or blocker_findings:
        verdict = "blocked"
    elif missing_fields:
        verdict = "incomplete"
    elif status == "succeeded" and (not passed_proofs or failed_proofs or failed_commands or unresolved):
        verdict = "suspicious"
    elif status == "partial" or unresolved:
        verdict = "incomplete"
    else:
        verdict = "honest"

    # ---- run record + write plan ---------------------------------------------
    run_status = {"succeeded": "completed", "partial": "partial", "failed": "failed", "blocked": "blocked"}.get(
        status, "failed"
    )
    run_record = RunRecord(
        runId=run_id,
        featureId=data.featureId,
        status=run_status,
        proofScore=round(proven / len(spec_items), 3) if spec_items else 0.0,
        totalRequirements=len(spec_items),
        timestamp=timestamp,
        filesChanged=files_changed,
        blockerSummary=blocker_findings[0].summary if blocker_findings else None,
        cbmStatus=cbm_status,
        sourceCitations=list(citations),
    )
    write_plan = graph_memory.build_write_plan(
        verdict=verdict,
        run_record=run_record,
        blockers=blocker_findings,
        patterns=pattern_candidates,
    )

    # ---- recommendation --------------------------------------------------------
    recurring = [c for c in pattern_candidates if c.occurrenceCount > 1]
    if verdict == "blocked":
        recurrence_note = (
            f" Pattern {recurring[0].patternId} has now occurred {recurring[0].occurrenceCount} times — "
            "read the prior ThinkGraph runs before retrying."
            if recurring
            else " Classify the blocker and record it before the next attempt."
        )
        recommendation = f"Run blocked: {run_record.blockerSummary or 'see blockers'}.{recurrence_note}"
    elif verdict == "suspicious":
        recommendation = (
            "Do not trust this report as-is: "
            + "; ".join(missing_evidence[:3])
            + ". Require re-run proof before accepting the claimed work."
        )
    elif verdict == "incomplete":
        recommendation = (
            "Report is incomplete — "
            + (
                "missing fields: " + ", ".join(missing_fields)
                if missing_fields
                else f"{len(unresolved)} requirement(s) unresolved"
            )
            + ". Narrow the next packet to the unresolved work."
        )
    else:
        recommendation = (
            f"Report is honest: {proven}/{len(spec_items)} requirements proven. "
            "Safe to record and proceed to the next task."
        )
    if cbm_status and cbm_status.lower() == "stale":
        recommendation += " (CBM index is stale: code-structure claims are lower confidence.)"

    add_activity(
        "review_complete",
        f"Run {run_id}: verdict={verdict} — {proven}/{len(spec_items)} proven"
        + (f", blocker: {blocker_findings[0].classifiedPattern}" if blocker_findings else ""),
    )
    if write_plan.status == "ready":
        planned = 1 + len(write_plan.blockers) + len(write_plan.patterns)
        add_activity(
            "thinkgraph_write_planned",
            f"ThinkGraph write plan ready: {planned} node(s), {len(write_plan.edges)} edge(s)",
        )
    if verdict == "blocked":
        add_activity("blocked", f"Blocker recorded for run {run_id}")

    return HermesReview(
        verdict=verdict,
        proofQuality=proof_quality,
        missingEvidence=missing_evidence,
        blockers=blocker_findings,
        patternCandidates=pattern_candidates,
        recommendation=recommendation,
        graphMemoryWritePlan=write_plan,
        sourceCitations=citations,
        activityEvents=activity,
    )
