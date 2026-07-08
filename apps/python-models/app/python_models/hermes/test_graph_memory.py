"""Graph-memory plan tests: RunRecord always present when reviewable,
Blocker/Pattern only when warranted, edge shapes, deterministic IDs, the
real apply_thinkgraph_patch payload contract, and structural proof that this
package never talks to a database or network directly."""

import inspect

from app.python_models import hermes
from app.python_models.hermes import (
    HermesReviewInput,
    THINKGRAPH_EDGE_TYPES,
    THINKGRAPH_NODE_TYPES,
    blocked_write_plan,
    review_coder_report,
    to_thinkgraph_patch,
)
from app.python_models.hermes.test_review import NOW, full_report


def plan_for(report, **input_overrides):
    return review_coder_report(
        HermesReviewInput(
            coderReport=report,
            featureId="test.feature.hermes-review",
            runId="test_run_hermes_review_001",
            **input_overrides,
        ),
        now=NOW,
    ).graphMemoryWritePlan


class TestWritePlan:
    def test_run_record_always_present_for_reviewable_report(self):
        plan = plan_for(full_report())
        assert plan.status == "ready"
        assert plan.runRecord["nodeId"] == "run:test_run_hermes_review_001"
        assert plan.runRecord["featureId"] == "test.feature.hermes-review"
        assert plan.runRecord["reviewedBy"] == "hermes_steward"

    def test_honest_report_plans_no_blockers_or_patterns(self):
        plan = plan_for(full_report())
        assert plan.blockers == []
        assert plan.patterns == []
        assert plan.edges == [
            {
                "type": "HAS_RUN",
                "from": "feature:test.feature.hermes-review",
                "to": "run:test_run_hermes_review_001",
            }
        ]

    def test_blocked_report_plans_blocker_pattern_and_typed_edges(self):
        plan = plan_for(
            full_report(status="blocked", blockers=["graph readback returned 0 nodes"])
        )
        assert len(plan.blockers) == 1
        assert len(plan.patterns) == 1
        edge_types = [e["type"] for e in plan.edges]
        assert edge_types == ["HAS_RUN", "ENCOUNTERED", "INSTANCE_OF"]
        for edge in plan.edges:
            assert edge["type"] in THINKGRAPH_EDGE_TYPES
            assert edge["from"] and edge["to"]
        assert plan.edges[1] == {
            "type": "ENCOUNTERED",
            "from": "run:test_run_hermes_review_001",
            "to": "blocker:test_run_hermes_review_001:0",
        }

    def test_blocked_write_plan_is_honest(self):
        plan = blocked_write_plan("thinkgraph authority not granted to this run")
        assert plan.status == "write_path_blocked"
        assert plan.runRecord is None
        assert "authority" in plan.reason


class TestThinkGraphPatchShape:
    """to_thinkgraph_patch must emit the exact ThinkGraphPatch contract from
    thinkGraphStore.ts: resources {id,label,kind,properties(flat scalars,
    compact single-line strings)}, typed edges as statements
    {id,subject,predicateTerm,object}."""

    def test_patch_matches_the_real_contract(self):
        plan = plan_for(
            full_report(status="blocked", blockers=["graph readback returned 0 nodes"])
        )
        patch = to_thinkgraph_patch(plan)
        assert set(patch) == {"resources", "statements"}
        assert len(patch["resources"]) == 3  # RunRecord + Blocker + Pattern
        kinds = {r["kind"] for r in patch["resources"]}
        assert kinds == set(THINKGRAPH_NODE_TYPES)
        for resource in patch["resources"]:
            assert resource["id"].strip() and resource["label"].strip()
            for key, value in resource["properties"].items():
                assert isinstance(value, (str, int, float, bool)), (key, value)
                if isinstance(value, str):
                    assert "\n" not in value and len(value) <= 160, key
        for statement in patch["statements"]:
            assert statement["subject"] and statement["object"]
            assert statement["predicateTerm"] in THINKGRAPH_EDGE_TYPES
            assert statement["id"] == (
                f"{statement['subject']}|{statement['predicateTerm']}|{statement['object']}"
            )

    def test_non_ready_plan_yields_an_empty_patch(self):
        patch = to_thinkgraph_patch(blocked_write_plan("no authority"))
        assert patch == {"resources": [], "statements": []}


class TestBoundaries:
    """Structural proof: the hermes package holds no DB/network/subprocess
    client — no direct ThinkGraph/KnowGraph/CodeGraph writes are possible."""

    def test_no_db_or_network_or_subprocess_imports(self):
        forbidden = ("psycopg", "neo4j", "urllib", "urlopen", "requests", "httpx",
                     "subprocess", "socket")
        for module in (hermes, hermes.protocol, hermes.review, hermes.graph_memory):
            source = inspect.getsource(module)
            for name in forbidden:
                assert f"import {name}" not in source, (module.__name__, name)
                assert f"from {name}" not in source, (module.__name__, name)
