"""Focused runtime-assignment coverage (pure validation — no DB, no network).

Proves the database-backed assignment model's gates: promoted-only skill
assignment with proof refs, runtime-binding compatibility, project scoping,
bounded data bindings with structural query-injection rejection, and profile
record validation. DB round-trips are covered by the live seed CLI.
"""

from app.python_models import runtime_assignments as ra
from app.python_models import thinkgraph_profile as tg


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
    def test_canonical_thinkgraph_profile_record_is_valid(self):
        assert ra.validate_profile(tg.PROFILE_V1) is None
        assert tg.PROFILE_V1.runtime_binding == "thinkgraph_agent"
        assert sorted(tg.PROFILE_V1.allowed_tools) == sorted(
            ["read_thinkgraph_scope", "apply_thinkgraph_patch"]
        )

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
            profile_id="p", version=1, runtime_binding="x", execution_mode="assistant_agent",
            enabled=True, terminal_contract="",
        )
        assert ra.validate_profile(broken3) == "profile_terminal_contract_required"
