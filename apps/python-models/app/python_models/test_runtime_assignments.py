"""Focused runtime-assignment coverage.

Proves the database-backed assignment model's gates: promoted-only skill
assignment with proof refs, runtime-binding compatibility, project scoping,
bounded data bindings with structural query-injection rejection, and profile
record validation, plus the canonical outer-run assignment/result boundary.
"""

from uuid import uuid4

import pytest

from app.python_models import runtime_assignments as ra
from app.python_models.postgres import connect_postgres


def _skill(**overrides) -> ra.RuntimeSkill:
    base = dict(
        skill_id="thinkgraph.compact_patch_discipline",
        version=1,
        status="promoted",
        applies_to_binding="thinkgraph_agent",
        guidance="patch only durable meaning",
        proof_refs=["proof-run-1"],
    )
    base.update(overrides)
    return ra.RuntimeSkill(**base)


class TestSkillValidation:
    def test_promoted_skill_requires_proof_reference(self):
        assert ra.validate_skill(_skill(proof_refs=[])) == "skill_promotion_requires_proof_ref"
        assert ra.validate_skill(_skill(proof_refs=["  "])) == "skill_promotion_requires_proof_ref"
        assert ra.validate_skill(_skill()) is None

    def test_candidate_skill_needs_no_proof_but_cannot_be_assigned(self):
        candidate = _skill(status="candidate", proof_refs=[])
        assert ra.validate_skill(candidate) is None
        err = ra.validate_skill_assignment(
            candidate, card_runtime_binding="thinkgraph_agent", project_id="p"
        )
        assert err is not None and "skill_not_promoted" in err

    def test_retired_skill_assignment_fails_honestly(self):
        err = ra.validate_skill_assignment(
            _skill(status="retired"), card_runtime_binding="thinkgraph_agent", project_id="p"
        )
        assert err is not None and "skill_not_promoted" in err

    def test_binding_incompatibility_fails_honestly(self):
        err = ra.validate_skill_assignment(
            _skill(), card_runtime_binding="research_agent", project_id="p"
        )
        assert err is not None and "skill_binding_incompatible" in err

    def test_cross_project_scope_fails_honestly(self):
        err = ra.validate_skill_assignment(
            _skill(project_scope="other-project"),
            card_runtime_binding="thinkgraph_agent",
            project_id="this-project",
        )
        assert err is not None and "skill_project_scope_mismatch" in err

    def test_unknown_skill_fails_honestly(self):
        assert ra.validate_skill_assignment(
            None, card_runtime_binding="thinkgraph_agent", project_id="p"
        ) == "skill_not_found"

    def test_invalid_status_rejected(self):
        assert "skill_status_invalid" in ra.validate_skill(_skill(status="shiny"))


class TestDataBindingValidation:
    def test_allowed_bounded_ref_passes(self):
        assert ra.validate_data_binding_ref("thinkgraph_project_slice", {"limit": 300}) is None
        assert ra.validate_data_binding_ref(
            "knowgraph_evidence_collection", {"anchors": ["rdw", "rklb"], "maxResults": 12}
        ) is None

    def test_unknown_type_rejected(self):
        assert "data_binding_type_unknown" in ra.validate_data_binding_ref("shell_access", {"x": 1})

    def test_raw_query_injection_rejected(self):
        for key in ("sql", "cypher", "query", "raw_query", "statement", "command"):
            err = ra.validate_data_binding_ref("cbm_query_scope", {key: "MATCH (n) DETACH DELETE n"})
            assert err is not None and "query_injection_rejected" in err, key

    def test_non_object_and_oversized_refs_rejected(self):
        assert ra.validate_data_binding_ref("cbm_query_scope", "raw") == "data_binding_ref_must_be_object"
        assert ra.validate_data_binding_ref("cbm_query_scope", {}) == "data_binding_ref_must_be_object"
        assert "too_long" in ra.validate_data_binding_ref(
            "cbm_query_scope", {"path": "x" * 501}
        )
        assert "list_too_long" in ra.validate_data_binding_ref(
            "cbm_query_scope", {"items": ["a"] * 65}
        )
        assert "value_type_rejected" in ra.validate_data_binding_ref(
            "cbm_query_scope", {"nested": {"deep": True}}
        )


class TestProfileValidation:
    def test_incomplete_profile_rejected(self):
        broken = ra.RuntimeProfile(
            profile_id="", version=1, runtime_binding="x", execution_mode="assistant_agent",
            enabled=True, terminal_contract="t",
        )
        assert ra.validate_profile(broken) == "profile_id_required"
        broken2 = ra.RuntimeProfile(
            profile_id="p", version=0, runtime_binding="x", execution_mode="assistant_agent",
            enabled=True, terminal_contract="t",
        )
        assert ra.validate_profile(broken2) == "profile_version_invalid"
        broken3 = ra.RuntimeProfile(
            profile_id="p", version=1, runtime_binding="x", execution_mode="",
            enabled=True, terminal_contract="t",
        )
        assert ra.validate_profile(broken3) == "profile_execution_mode_required"

    def test_terminal_contract_is_optional_not_required(self):
        # A profile assigning NO terminal contract is a valid, complete record —
        # the executor runs it once with no output grammar and no repair loop.
        no_contract = ra.RuntimeProfile(
            profile_id="p", version=1, runtime_binding="x", execution_mode="assistant_agent",
            enabled=True, terminal_contract="",
        )
        assert ra.validate_profile(no_contract) is None


def test_outer_assignment_reuses_canonical_run_and_persists_lineage_result_and_artifact():
    project_id = f"assignment-test-{uuid4().hex}"
    parent_correlation = f"parent-{uuid4().hex}"
    child_correlation = f"child-{uuid4().hex}"
    connection = connect_postgres(autocommit=False)
    try:
        parent_id = ra.begin_agent_assignment(
            project_id=project_id,
            correlation_id=parent_correlation,
            deck_id="deck_builder",
            card_id="card_main_chat",
            conversation_id="main",
            conn=connection,
        )
        child_id = ra.begin_agent_assignment(
            project_id=project_id,
            correlation_id=child_correlation,
            deck_id="deck_builder",
            card_id="card_research_agent",
            conversation_id="main",
            sender_card_id="card_main_chat",
            agent_context_id="agentctx:test-context",
            parent_correlation_id=parent_correlation,
            conn=connection,
        )
        result_id = ra.finish_agent_assignment(
            project_id=project_id,
            correlation_id=child_correlation,
            status="completed",
            output="bounded result",
            artifacts=[
                {
                    "artifactId": "artifact:test",
                    "artifactType": "return_file",
                    "locator": "returns/test/result.json",
                }
            ],
            conn=connection,
        )
        assert ra.finish_agent_assignment(
            project_id=project_id,
            correlation_id=child_correlation,
            status="completed",
            output="bounded result",
            artifacts=[
                {
                    "artifactId": "artifact:test",
                    "artifactType": "return_file",
                    "locator": "returns/test/result.json",
                }
            ],
            conn=connection,
        ) == result_id
        assert ra.begin_agent_assignment(
            project_id=project_id,
            correlation_id=child_correlation,
            deck_id="deck_builder",
            card_id="card_research_agent",
            conversation_id="main",
            conn=connection,
        ) == child_id
        with pytest.raises(RuntimeError, match="agent_assignment_already_terminal"):
            ra.finish_agent_assignment(
                project_id=project_id,
                correlation_id=child_correlation,
                status="failed",
                error_code="late_failure",
                error_detail="duplicate terminal event",
                conn=connection,
            )
        retry_correlation = f"retry-{uuid4().hex}"
        retry_id = ra.begin_agent_assignment(
            project_id=project_id,
            correlation_id=retry_correlation,
            deck_id="deck_builder",
            card_id="card_research_agent",
            conversation_id="main",
            retry_of_correlation_id=child_correlation,
            conn=connection,
        )
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT run.state, assignment.parent_assignment_id, assignment.state,
                       result.result_id, result.output, reference.reference_id,
                       artifact.locator
                FROM ag_catalog.card_run_traces run
                JOIN ag_catalog.agent_assignments assignment
                  ON assignment.project_id=run.project_id
                 AND assignment.correlation_id=run.correlation_id
                JOIN ag_catalog.agent_results result
                  ON result.assignment_id=assignment.assignment_id
                JOIN ag_catalog.agent_context_references reference
                  ON reference.assignment_id=assignment.assignment_id
                JOIN ag_catalog.agent_artifact_references artifact
                  ON artifact.assignment_id=assignment.assignment_id
                WHERE run.project_id=%s AND run.correlation_id=%s
                """,
                (project_id, child_correlation),
            )
            row = cursor.fetchone()
            cursor.execute(
                """
                SELECT retry_of_assignment_id
                FROM ag_catalog.agent_assignments
                WHERE assignment_id=%s
                """,
                (retry_id,),
            )
            retry_of = cursor.fetchone()[0]
        assert row == (
            "completed",
            parent_id,
            "completed",
            result_id,
            "bounded result",
            "agentctx:test-context",
            "returns/test/result.json",
        )
        assert child_id == f"assignment:{child_correlation}"
        assert retry_of == child_id
    finally:
        connection.rollback()
        connection.close()
