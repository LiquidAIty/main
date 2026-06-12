"""Unit tests for the deterministic skills/*.md -> Neo4j importer.

No live Neo4j is required: upsert behavior is proven against a fake driver
that simulates MERGE semantics and write counters.
"""

from __future__ import annotations

import os
import re
import unittest
from pathlib import Path
from types import SimpleNamespace

import skill_ingest
from skill_ingest import (
    ParsedSkill,
    SkillParseError,
    build_semantic_documents,
    build_upsert_statements,
    parse_skill_markdown,
    _execute_statements,
)

REPO_ROOT = Path(__file__).resolve().parents[2]

MINIMAL_SKILL = """# Skill: Example

Deterministic example skill used by the unit tests.

@skill id=example-skill
@type Skill
@status active
@requires fresh_cbm_index

## Guardrails

Never fake Neo4j success.

@guardrail id=example-skill.no-fakes

## Active Attempt

@attempt id=example-skill.attempt-001
@status active
@source_prompt "do the example thing"
@requires_fresh_cbm true
@validated_by python -m unittest
@touches_code services/knowgraph/skill_ingest.py

## Reasoning Receipt

@decision id=example-skill.use-x
@because x is deterministic
@rejected llm extraction
@use_instead direct upserts
@proved_by existing neo4j driver usage
@guardrail do not reinterpret deterministic metadata

@query id=example-skill.list "MATCH (s:Skill) RETURN s.id"
@query bare_named_query "MATCH (n) RETURN count(n)"
"""


def parse_minimal() -> ParsedSkill:
    return parse_skill_markdown(MINIMAL_SKILL, "skills/example-skill.md")


class _FakeCounters(SimpleNamespace):
    pass


class FakeNeo4jDriver:
    """Simulates MERGE semantics so idempotency can be proven without Neo4j."""

    NODE_RE = re.compile(r"^MERGE \(n:(\w+) \{id: \$id\}\)")
    EDGE_RE = re.compile(r"MERGE \(a\)-\[:(\w+)\]->\(b\)")

    def __init__(self) -> None:
        self.nodes: set[tuple[str, str]] = set()
        self.edges: set[tuple[str, str, str]] = set()
        self.calls: list[tuple[str, dict]] = []

    def execute_query(self, cypher, parameters_=None, database_=None):
        params = parameters_ or {}
        self.calls.append((cypher, params))
        nodes_created = relationships_created = properties_set = 0
        node_match = self.NODE_RE.match(cypher)
        edge_match = self.EDGE_RE.search(cypher)
        if node_match:
            key = (node_match.group(1), params["id"])
            if key not in self.nodes:
                self.nodes.add(key)
                nodes_created = 1
            properties_set = len(params.get("props", {}))
        elif edge_match:
            key = (edge_match.group(1), params["from_id"], params["to_id"])
            from_label = re.search(r"MATCH \(a:(\w+)", cypher).group(1)
            to_label = re.search(r"MATCH \(b:(\w+)", cypher).group(1)
            # MERGE creates the edge only when both endpoints exist (MATCH).
            if (from_label, params["from_id"]) in self.nodes and (
                to_label,
                params["to_id"],
            ) in self.nodes:
                if key not in self.edges:
                    self.edges.add(key)
                    relationships_created = 1
        return SimpleNamespace(
            summary=SimpleNamespace(
                counters=_FakeCounters(
                    nodes_created=nodes_created,
                    relationships_created=relationships_created,
                    properties_set=properties_set,
                )
            ),
            records=[],
        )

    def close(self) -> None:
        pass


class FailingNeo4jDriver:
    def execute_query(self, cypher, parameters_=None, database_=None):
        raise RuntimeError("Neo.ClientError.Security.Unauthorized")

    def close(self) -> None:
        pass


class ParserTests(unittest.TestCase):
    def test_parses_skill_id_and_props(self):
        parsed = parse_minimal()
        self.assertEqual(parsed.skill_id, "example-skill")
        self.assertEqual(parsed.skill.props["status"], "active")
        self.assertEqual(parsed.skill.props["type"], "Skill")
        self.assertIn("fresh_cbm_index", parsed.skill.requires)

    def test_parses_attempt(self):
        parsed = parse_minimal()
        attempt = parsed.attempts["example-skill.attempt-001"]
        self.assertEqual(attempt.props["status"], "active")
        self.assertEqual(attempt.props["source_prompt"], "do the example thing")
        self.assertTrue(attempt.props["requires_fresh_cbm"])
        self.assertIn("python -m unittest", attempt.validations)
        self.assertIn("services/knowgraph/skill_ingest.py", attempt.code_refs)

    def test_parses_guardrails(self):
        parsed = parse_minimal()
        self.assertIn("example-skill.no-fakes", parsed.guardrails)
        decision = parsed.decisions["example-skill.use-x"]
        self.assertEqual(len(decision.guardrail_ids), 1)
        derived = decision.guardrail_ids[0]
        self.assertTrue(derived.startswith("example-skill.use-x.guardrail."))
        self.assertEqual(
            parsed.guardrails[derived]["text"], "do not reinterpret deterministic metadata"
        )

    def test_parses_decision_receipt(self):
        parsed = parse_minimal()
        decision = parsed.decisions["example-skill.use-x"]
        self.assertEqual(decision.props["because"], "x is deterministic")
        self.assertEqual(decision.props["use_instead"], "direct upserts")
        self.assertEqual(decision.props["proved_by"], "existing neo4j driver usage")
        self.assertEqual(decision.rejected, ["llm extraction"])

    def test_parses_query_lines_both_forms(self):
        parsed = parse_minimal()
        self.assertEqual(parsed.queries["example-skill.list"]["text"], "MATCH (s:Skill) RETURN s.id")
        self.assertEqual(parsed.queries["bare_named_query"]["text"], "MATCH (n) RETURN count(n)")

    def test_missing_skill_id_fails(self):
        with self.assertRaisesRegex(SkillParseError, "missing required @skill"):
            parse_skill_markdown("# No skill here\n\nprose only\n", "skills/broken.md")

    def test_record_opener_without_id_fails(self):
        bad = "@skill id=x\n@attempt status=active\n"
        with self.assertRaisesRegex(SkillParseError, "@attempt requires id="):
            parse_skill_markdown(bad, "skills/broken.md")

    def test_unknown_graphable_line_fails(self):
        bad = "@skill id=x\n@totally_bogus value\n"
        with self.assertRaisesRegex(SkillParseError, "unsupported graphable line @totally_bogus"):
            parse_skill_markdown(bad, "skills/broken.md")

    def test_guardrail_without_id_outside_decision_fails(self):
        bad = "@skill id=x\n@guardrail free text without id\n"
        with self.assertRaisesRegex(SkillParseError, "@guardrail needs id="):
            parse_skill_markdown(bad, "skills/broken.md")

    def test_known_foreign_graph_lines_warn_not_fail(self):
        text = "@skill id=x\n@node skill:x type=Skill\n@edge a RELATED_TO b\n"
        parsed = parse_skill_markdown(text, "skills/x.md")
        self.assertEqual(len(parsed.warnings), 2)
        self.assertIn("@node", parsed.warnings[0])

    def test_placeholder_attempt_result_skipped_with_warning(self):
        text = (
            "@skill id=x\n@attempt id=x.a1\n@status active\n\n"
            "@attempt_result id=x.a1\n@status succeeded|failed|blocked\n"
            "@cbm_after nodes=<count> edges=<count>\n"
        )
        parsed = parse_skill_markdown(text, "skills/x.md")
        attempt = parsed.attempts["x.a1"]
        self.assertNotIn("result_status", attempt.props)
        self.assertTrue(any("placeholder" in w for w in parsed.warnings))

    def test_filled_attempt_result_merges_into_attempt(self):
        text = (
            "@skill id=x\n@attempt id=x.a1\n@status active\n\n"
            "@attempt_result id=x.a1\n@status succeeded\n@cbm_after nodes=10 edges=20\n"
            "@proved_by unit tests passed\n"
        )
        parsed = parse_skill_markdown(text, "skills/x.md")
        attempt = parsed.attempts["x.a1"]
        self.assertEqual(attempt.props["result_status"], "succeeded")
        self.assertEqual(attempt.props["cbm_after_nodes"], 10)
        self.assertEqual(attempt.props["cbm_after_edges"], 20)
        self.assertIn("unit tests passed", attempt.proofs)

    def test_attempt_result_without_matching_attempt_fails(self):
        bad = "@skill id=x\n@attempt_result id=x.missing\n@status succeeded\n"
        with self.assertRaisesRegex(SkillParseError, "no matching @attempt"):
            parse_skill_markdown(bad, "skills/broken.md")

    def test_code_fences_are_not_parsed_as_graphable_lines(self):
        text = "@skill id=x\n\n## Proof\n\n```powershell\n@bogus inside fence\n```\n"
        parsed = parse_skill_markdown(text, "skills/x.md")  # must not raise
        self.assertEqual(parsed.skill_id, "x")

    def test_real_repo_skill_files_parse(self):
        skills_dir = REPO_ROOT / "skills"
        files = sorted(skills_dir.glob("*.md"))
        self.assertTrue(files, f"no skill files under {skills_dir}")
        for path in files:
            parsed = parse_skill_markdown(
                path.read_text(encoding="utf-8"), path.relative_to(REPO_ROOT).as_posix()
            )
            self.assertTrue(parsed.skill_id)

    def test_codebasedmemory_fixture_parses_with_expected_records(self):
        path = REPO_ROOT / "skills" / "codebasedmemory.md"
        parsed = parse_skill_markdown(path.read_text(encoding="utf-8"), "skills/codebasedmemory.md")
        self.assertEqual(parsed.skill_id, "codebasedmemory")
        self.assertEqual(parsed.skill.props["status"], "active")
        self.assertIn("codebasedmemory.current-code", parsed.queries)
        self.assertIn("codebasedmemory.skill-match", parsed.queries)
        self.assertFalse(parsed.warnings)


class UpsertPlanTests(unittest.TestCase):
    def test_statements_are_deterministic_and_ids_stable(self):
        first = build_upsert_statements(parse_minimal())
        second = build_upsert_statements(parse_minimal())
        self.assertEqual(first, second)

    def test_all_nodes_merge_on_stable_id(self):
        nodes, edges = build_upsert_statements(parse_minimal())
        for cypher, params in nodes:
            self.assertIn("MERGE (n:", cypher)
            self.assertTrue(params["id"])
            self.assertEqual(params["props"]["source"], "repo")
            self.assertEqual(params["props"]["import_kind"], "skill_markdown")
            self.assertEqual(params["props"]["skill_id"], "example-skill")
            self.assertEqual(params["props"]["source_path"], "skills/example-skill.md")
        for cypher, _params in edges:
            self.assertIn("MERGE (a)-[:", cypher)

    def test_expected_relationships_present(self):
        _nodes, edges = build_upsert_statements(parse_minimal())
        rels = {re.search(r"MERGE \(a\)-\[:(\w+)\]", cypher).group(1) for cypher, _ in edges}
        self.assertLessEqual(
            {
                "HAS_ATTEMPT",
                "HAS_GUARDRAIL",
                "HAS_DECISION",
                "HAS_QUERY",
                "VALIDATED_BY",
                "TOUCHED_CODE",
                "CREATED_GUARDRAIL",
                "HAS_SECTION",
            },
            rels,
        )

    def test_repeated_upsert_is_idempotent_on_fake_driver(self):
        nodes, edges = build_upsert_statements(parse_minimal())
        statements = nodes + edges
        driver = FakeNeo4jDriver()
        first = _execute_statements(driver, None, statements)
        self.assertGreater(first["nodes_created"], 0)
        self.assertGreater(first["relationships_created"], 0)
        second = _execute_statements(driver, None, statements)
        self.assertEqual(second["nodes_created"], 0)
        self.assertEqual(second["relationships_created"], 0)

    def test_neo4j_errors_propagate(self):
        nodes, edges = build_upsert_statements(parse_minimal())
        with self.assertRaisesRegex(RuntimeError, "Unauthorized"):
            _execute_statements(FailingNeo4jDriver(), None, nodes + edges)

    def test_cli_returns_nonzero_on_neo4j_failure(self):
        # No NEO4J_* config is reachable from a bare temp root -> loud failure.
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "skills").mkdir()
            (root / "skills" / "x.md").write_text("@skill id=x\n", encoding="utf-8")
            saved = {
                key: os.environ.pop(key)
                for key in ("NEO4J_URI", "NEO4J_USER", "NEO4J_PASSWORD")
                if key in os.environ
            }
            try:
                rc = skill_ingest.main(["ingest", "--repo-root", str(root)])
            finally:
                os.environ.update(saved)
            self.assertNotEqual(rc, 0)

    def test_cli_returns_nonzero_on_parse_failure(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "skills").mkdir()
            (root / "skills" / "bad.md").write_text("@bogus no skill\n", encoding="utf-8")
            rc = skill_ingest.main(["ingest", "--repo-root", str(root), "--dry-run"])
            self.assertEqual(rc, 1)


class SemanticLaneTests(unittest.TestCase):
    def test_build_semantic_documents_shapes_for_existing_graphrag_lane(self):
        documents = build_semantic_documents(parse_minimal())
        self.assertTrue(documents)
        for doc in documents:
            self.assertEqual(doc["source_type"], "skill_prose")
            self.assertTrue(doc["document_id"].startswith("skill:example-skill.section."))
            self.assertEqual(doc["metadata"]["skill_id"], "example-skill")
            self.assertTrue(doc["text"].strip())


if __name__ == "__main__":
    unittest.main()
