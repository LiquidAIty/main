"""Unit tests for the read-only KnowGraph skill retrieval MVP.

No live Neo4j is required: a fake driver emulates the fixed retrieval Cypher
over an in-memory fixture graph and records every executed query so the
read-only guarantee can be proven.
"""

from __future__ import annotations

import json
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import skill_ingest
from skill_ingest import (
    NO_MATCHING_SKILL_RULE,
    SkillIngestError,
    _run_read,
    build_fable_prompt,
    build_skill_packet,
    get_skill,
    match_skills,
    tokenize_prompt,
)

CBM_SKILL = {
    "id": "codebasedmemory",
    "status": "active",
    "type": "Skill",
    "source_path": "skills/codebasedmemory.md",
    "import_kind": "skill_markdown",
    "requires": ["fresh_cbm_index"],
}

INGEST_SKILL = {
    "id": "knowgraph-skill-ingestion",
    "status": "learning",
    "type": "Skill",
    "source_path": "skills/knowgraph-skill-ingestion-skill.md",
    "import_kind": "skill_markdown",
    "requires": ["fresh_cbm_index", "neo4j_knowgraph"],
}

ONE_HOP = {
    "codebasedmemory": [
        ("HAS_QUERY", "QueryPattern", {"id": "skill_match_for_task", "text": "search skills using user prompt and active CoderPacket"}),
        ("HAS_SECTION", "SkillSection", {
            "id": "codebasedmemory.section.vector-summary", "heading": "Vector Summary",
            "order": 0, "text": "Use fresh Code-Based Memory to navigate the repo graph before work.",
        }),
        ("HAS_SECTION", "SkillSection", {
            "id": "codebasedmemory.section.core-rule", "heading": "Core Rule",
            "order": 2, "text": "Fresh CBM index every time. No stale cache logic.",
        }),
    ],
    "knowgraph-skill-ingestion": [
        ("HAS_GUARDRAIL", "Guardrail", {"id": "knowgraph-skill-ingestion.no-llm-extraction", "text": ""}),
        ("HAS_GUARDRAIL", "Guardrail", {"id": "knowgraph-skill-ingestion.no-fake-neo4j-success", "text": ""}),
        ("HAS_DECISION", "Decision", {
            "id": "knowgraph-skill-ingestion.use-deterministic-host-python-importer",
            "because": "graphable Markdown already declares exact entities",
            "use_instead": "services/knowgraph/skill_ingest.py with direct Neo4j upserts",
            "rejected": ["existing GraphRAG extraction path"],
        }),
        ("HAS_QUERY", "QueryPattern", {"id": "knowgraph-skill-ingestion.list-skills", "text": "MATCH (s:Skill) RETURN s ORDER BY s.id"}),
        ("HAS_ATTEMPT", "SkillAttempt", {
            "id": "knowgraph-skill-ingestion.prepare-001", "status": "active",
            "result_status": "succeeded", "cbm_after_nodes": 5289, "cbm_after_edges": 9506,
        }),
        ("HAS_SECTION", "SkillSection", {
            "id": "knowgraph-skill-ingestion.section.guardrails", "heading": "Guardrails",
            "order": 1, "text": "Neo4j ingestion guardrails: never send skill Markdown through LLM extraction.",
        }),
        ("RELATED_TO", "Skill", {"id": "codebasedmemory"}),
    ],
}

ATTEMPT_EVIDENCE = {
    "knowgraph-skill-ingestion": [
        ("knowgraph-skill-ingestion.prepare-001", "PROVED", "ProofClaim",
         {"id": "p1", "text": "24 unit tests passed"}),
        ("knowgraph-skill-ingestion.prepare-001", "VALIDATED_BY", "Validation",
         {"id": "v1", "text": "python -m unittest discover"}),
        ("knowgraph-skill-ingestion.prepare-001", "TOUCHED_CODE", "CodeGraphReference",
         {"id": "services/knowgraph/skill_ingest.py", "ref": "services/knowgraph/skill_ingest.py"}),
    ],
    "codebasedmemory": [],
}

SKILLS = {"codebasedmemory": CBM_SKILL, "knowgraph-skill-ingestion": INGEST_SKILL}
RELATED_PAIRS = [("knowgraph-skill-ingestion", "codebasedmemory")]


def _result(rows):
    return SimpleNamespace(records=rows, summary=None)


class FakeReadDriver:
    """Emulates the fixed retrieval Cypher over the fixture graph."""

    def __init__(self) -> None:
        self.executed: list[str] = []

    def close(self) -> None:
        pass

    def execute_query(self, cypher, parameters_=None, database_=None):
        params = parameters_ or {}
        self.executed.append(cypher)
        if "'skill_id_exact'" in cypher:
            sid = params["skill_id"]
            if sid in SKILLS:
                return _result([{"skill_id": sid, "kind": "skill_id_exact", "evidence": sid}])
            return _result([])
        if "UNION ALL" in cypher:
            return _result(self._prompt_rows(params["tokens"]))
        if "'related_skill'" in cypher:
            rows = []
            for left, right in RELATED_PAIRS:
                for matched, other in ((left, right), (right, left)):
                    if matched in params["skill_ids"] and other not in params["skill_ids"]:
                        rows.append({"skill_id": other, "kind": "related_skill", "evidence": matched})
            return _result(rows)
        if "properties(s) AS props" in cypher:
            sid = params["skill_id"]
            return _result([{"props": SKILLS[sid]}] if sid in SKILLS else [])
        if "owner_id" in cypher:
            rows = [
                {"owner_id": owner, "rel": rel, "label": label, "id": p.get("id"), "props": p}
                for owner, rel, label, p in ATTEMPT_EVIDENCE.get(params["skill_id"], [])
            ]
            return _result(rows)
        if "-[r]->" in cypher:
            rows = [
                {"rel": rel, "label": label, "id": p.get("id"), "props": p}
                for rel, label, p in sorted(
                    ONE_HOP.get(params["skill_id"], []),
                    key=lambda item: (item[0], item[1], item[2].get("id") or ""),
                )
            ]
            return _result(rows)
        raise AssertionError(f"unrouted retrieval cypher: {cypher[:80]}")

    @staticmethod
    def _match(tokens, *fields) -> bool:
        blob = " ".join(field or "" for field in fields).lower()
        return any(token in blob for token in tokens)

    def _prompt_rows(self, tokens):
        rows = []
        for sid in sorted(SKILLS):
            props = SKILLS[sid]
            if self._match(tokens, props["id"], props["source_path"]):
                rows.append({"skill_id": sid, "kind": "skill_field", "evidence": sid})
            for rel, _label, p in ONE_HOP[sid]:
                if rel == "HAS_GUARDRAIL" and self._match(tokens, p["id"], p.get("text")):
                    rows.append({"skill_id": sid, "kind": "guardrail_text", "evidence": p["id"]})
                elif rel == "HAS_DECISION" and self._match(
                    tokens, p["id"], p.get("because"), p.get("use_instead")
                ):
                    rows.append({"skill_id": sid, "kind": "decision_text", "evidence": p["id"]})
                elif rel == "HAS_QUERY" and self._match(tokens, p["id"], p.get("text")):
                    rows.append({"skill_id": sid, "kind": "query_text", "evidence": p["id"]})
                elif rel == "HAS_SECTION":
                    if self._match(tokens, p.get("heading")):
                        rows.append({"skill_id": sid, "kind": "section_heading", "evidence": p["id"]})
                    if self._match(tokens, p.get("text")):
                        rows.append({"skill_id": sid, "kind": "section_text", "evidence": p["id"]})
        return rows


class FailingDriver:
    def execute_query(self, cypher, parameters_=None, database_=None):
        raise RuntimeError("Neo.ClientError.Security.Unauthorized")

    def close(self) -> None:
        pass


class TokenizeTests(unittest.TestCase):
    def test_tokenize_drops_stopwords_and_short_tokens(self):
        tokens = tokenize_prompt("Use the Neo4j skill ingestion guardrails for a fix")
        self.assertEqual(tokens, ["fix", "guardrails", "ingestion", "neo4j"])


class GetSkillTests(unittest.TestCase):
    def test_get_skill_by_id(self):
        view = get_skill(FakeReadDriver(), None, "codebasedmemory")
        self.assertEqual(view["skill_id"], "codebasedmemory")
        self.assertEqual(view["status"], "active")
        self.assertEqual(view["query_patterns"][0]["id"], "skill_match_for_task")
        headings = [section["heading"] for section in view["sections"]]
        self.assertEqual(headings, ["Vector Summary", "Core Rule"])  # sorted by order

    def test_get_skill_includes_attempt_evidence(self):
        view = get_skill(FakeReadDriver(), None, "knowgraph-skill-ingestion")
        attempt = view["attempts"][0]
        self.assertEqual(attempt["result_status"], "succeeded")
        self.assertIn("24 unit tests passed", attempt["proof_claims"])
        self.assertIn("python -m unittest discover", attempt["validations"])
        self.assertIn("services/knowgraph/skill_ingest.py", attempt["touched_code"])

    def test_get_missing_skill_returns_none(self):
        self.assertIsNone(get_skill(FakeReadDriver(), None, "missing-skill"))


class MatchTests(unittest.TestCase):
    def test_match_by_skill_id(self):
        matches = match_skills(FakeReadDriver(), None, skill_id="codebasedmemory")
        self.assertEqual(matches[0]["skill_id"], "codebasedmemory")
        self.assertEqual(matches[0]["match_reasons"][0]["kind"], "skill_id_exact")
        self.assertGreaterEqual(matches[0]["score"], 100)

    def test_match_by_prompt_over_sections_and_guardrails(self):
        matches = match_skills(
            FakeReadDriver(), None, prompt="Neo4j skill ingestion guardrails", limit=5
        )
        self.assertEqual(matches[0]["skill_id"], "knowgraph-skill-ingestion")
        kinds = {reason["kind"] for reason in matches[0]["match_reasons"]}
        self.assertIn("guardrail_text", kinds)
        self.assertIn("section_heading", kinds)

    def test_match_expands_related_skills(self):
        matches = match_skills(
            FakeReadDriver(), None, prompt="ingestion guardrails", limit=5
        )
        by_id = {match["skill_id"]: match for match in matches}
        self.assertIn("codebasedmemory", by_id)
        kinds = {reason["kind"] for reason in by_id["codebasedmemory"]["match_reasons"]}
        self.assertIn("related_skill", kinds)
        # related-only match ranks below the direct match
        self.assertEqual(matches[0]["skill_id"], "knowgraph-skill-ingestion")

    def test_match_requires_a_selector(self):
        with self.assertRaisesRegex(SkillIngestError, "match requires"):
            match_skills(FakeReadDriver(), None)

    def test_match_is_deterministic(self):
        first = match_skills(FakeReadDriver(), None, prompt="neo4j ingestion guardrails")
        second = match_skills(FakeReadDriver(), None, prompt="neo4j ingestion guardrails")
        self.assertEqual(first, second)


class PacketTests(unittest.TestCase):
    def test_packet_contains_guardrails_decisions_sections_queries(self):
        packet = build_skill_packet(
            FakeReadDriver(), None, prompt="Neo4j skill ingestion guardrails", limit=3
        )
        top = packet["skills"][0]
        self.assertEqual(top["skill_id"], "knowgraph-skill-ingestion")
        self.assertTrue(top["guardrails"])
        self.assertTrue(top["decisions"])
        self.assertTrue(top["query_patterns"])
        self.assertTrue(top["sections"])
        self.assertTrue(top["attempts"][0]["proof_claims"])

    def test_packet_json_is_deterministic(self):
        kwargs = {"prompt": "Neo4j skill ingestion guardrails", "limit": 3}
        first = build_skill_packet(FakeReadDriver(), None, **kwargs)
        second = build_skill_packet(FakeReadDriver(), None, **kwargs)
        self.assertEqual(
            json.dumps(first, sort_keys=True), json.dumps(second, sort_keys=True)
        )

    def test_packet_is_compact_for_prompt_handoff(self):
        packet = build_skill_packet(
            FakeReadDriver(), None, prompt="Neo4j skill ingestion guardrails", limit=3
        )
        self.assertLess(len(json.dumps(packet)), 8000)

    def test_packet_sections_are_matched_or_summary_only(self):
        packet = build_skill_packet(
            FakeReadDriver(), None, prompt="Neo4j skill ingestion guardrails", limit=3
        )
        for skill in packet["skills"]:
            self.assertLessEqual(len(skill["sections"]), 4)


class ReadOnlyTests(unittest.TestCase):
    def test_retrieval_runs_no_write_queries(self):
        driver = FakeReadDriver()
        get_skill(driver, None, "codebasedmemory")
        match_skills(driver, None, prompt="neo4j ingestion guardrails")
        build_skill_packet(driver, None, skill_id="codebasedmemory")
        self.assertTrue(driver.executed)
        for cypher in driver.executed:
            self.assertIsNone(skill_ingest._WRITE_CLAUSE_RE.search(cypher), cypher)

    def test_run_read_refuses_write_cypher(self):
        with self.assertRaisesRegex(SkillIngestError, "non-read-only"):
            _run_read(FakeReadDriver(), None, "MERGE (n:Skill {id: $id})", {"id": "x"})

    def test_neo4j_errors_propagate(self):
        with self.assertRaisesRegex(RuntimeError, "Unauthorized"):
            match_skills(FailingDriver(), None, skill_id="codebasedmemory")


class HandoffTests(unittest.TestCase):
    TASK = "Neo4j skill ingestion guardrails"

    def _packet(self):
        return build_skill_packet(FakeReadDriver(), None, prompt=self.TASK, limit=3)

    def test_prompt_contains_required_sections_in_order(self):
        rendered = build_fable_prompt(self.TASK, self._packet())
        positions = [
            rendered.index("## Active Prompt (Spec And Task)"),
            rendered.index("## Skill Memory Packet"),
            rendered.index("## Required Behavior"),
        ]
        self.assertEqual(positions, sorted(positions))
        self.assertIn(self.TASK, rendered)

    def test_prompt_embeds_packet_json_and_generating_command(self):
        packet = self._packet()
        rendered = build_fable_prompt(self.TASK, packet)
        self.assertIn("services/knowgraph/skill_ingest.py packet --prompt", rendered)
        self.assertIn(json.dumps(packet, indent=2, sort_keys=True), rendered)
        self.assertEqual(rendered.count("## Active Prompt (Spec And Task)"), 1)

    def test_prompt_obligates_guardrails_writeback_and_reingest(self):
        rendered = build_fable_prompt(self.TASK, self._packet())
        self.assertIn("guardrail in the packet as a hard constraint", rendered)
        self.assertIn("packet query patterns", rendered)
        self.assertIn("@attempt_result", rendered)
        self.assertIn("ingest --repo-root .", rendered)
        self.assertIn("never fake success", rendered)

    def test_prompt_is_deterministic(self):
        first = build_fable_prompt(self.TASK, self._packet())
        second = build_fable_prompt(self.TASK, self._packet())
        self.assertEqual(first, second)

    def test_empty_packet_triggers_new_skill_rule(self):
        empty = {"packet_version": 1, "query": {"prompt": "zzz", "limit": 3}, "skills": []}
        rendered = build_fable_prompt("zzz", empty)
        self.assertIn(NO_MATCHING_SKILL_RULE, rendered)
        self.assertNotIn("```json", rendered)


class CodeEvidenceTests(unittest.TestCase):
    EVIDENCE = {
        "packet_version": 1,
        "source": "codegraph_cbm",
        "query": {"prompt": "task", "skill_packet_used": True},
        "cbm": {"method": "full", "status": "ready", "nodes": 10, "edges": 20},
        "files": ["services/knowgraph/skill_ingest.py"],
        "symbols": ["skill_ingest.build_fable_prompt"],
        "routes": [],
        "tests": ["services/knowgraph/test_skill_retrieve.py"],
        "snippets": [{"ref": "services/knowgraph/skill_ingest.py:1", "text": "# header"}],
        "call_paths": [],
        "queries_used": [{"tool": "search_graph", "query": "fable prompt"}],
        "warnings": [],
        "proof_commands": ["py -3.12 -m unittest discover -s services/knowgraph"],
    }

    def _packet(self):
        return build_skill_packet(FakeReadDriver(), None, prompt="ingestion guardrails", limit=2)

    def test_code_evidence_section_placed_after_skill_packet(self):
        rendered = build_fable_prompt("task", self._packet(), code_evidence=self.EVIDENCE)
        order = [
            rendered.index("## Active Prompt (Spec And Task)"),
            rendered.index("## Skill Memory Packet"),
            rendered.index("## Code Evidence Packet"),
            rendered.index("## Required Behavior"),
        ]
        self.assertEqual(order, sorted(order))
        self.assertIn(json.dumps(self.EVIDENCE, indent=2, sort_keys=True), rendered)

    def test_missing_code_evidence_renders_explicit_placeholder(self):
        rendered = build_fable_prompt("task", self._packet())
        self.assertIn("## Code Evidence Packet", rendered)
        self.assertIn("Not provided", rendered)
        self.assertIn("fresh Codebase-Memory tools", rendered)

    def test_load_code_evidence_validates_loudly(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            good = Path(tmp) / "good.json"
            good.write_text(json.dumps(self.EVIDENCE), encoding="utf-8")
            loaded = skill_ingest.load_code_evidence(good)
            self.assertEqual(loaded["source"], "codegraph_cbm")

            missing = Path(tmp) / "missing.json"
            with self.assertRaisesRegex(SkillIngestError, "not found"):
                skill_ingest.load_code_evidence(missing)

            bad_json = Path(tmp) / "bad.json"
            bad_json.write_text("{not json", encoding="utf-8")
            with self.assertRaisesRegex(SkillIngestError, "not valid JSON"):
                skill_ingest.load_code_evidence(bad_json)

            wrong_source = Path(tmp) / "wrong.json"
            wrong_source.write_text(
                json.dumps({"packet_version": 1, "source": "made_up"}), encoding="utf-8"
            )
            with self.assertRaisesRegex(SkillIngestError, "source must be"):
                skill_ingest.load_code_evidence(wrong_source)

            no_version = Path(tmp) / "nover.json"
            no_version.write_text(
                json.dumps({"source": "codegraph_cbm"}), encoding="utf-8"
            )
            with self.assertRaisesRegex(SkillIngestError, "packet_version"):
                skill_ingest.load_code_evidence(no_version)


class CliTests(unittest.TestCase):
    def _patched(self, driver):
        return (
            mock.patch.object(
                skill_ingest,
                "load_neo4j_config",
                return_value={
                    "uri": "bolt://test", "user": "neo4j", "password": "x",
                    "database": None, "config_source": "test",
                },
            ),
            mock.patch.object(skill_ingest, "_connect", return_value=driver),
        )

    def test_cli_get_and_match_and_packet_succeed(self):
        config_patch, connect_patch = self._patched(FakeReadDriver())
        with config_patch, connect_patch:
            self.assertEqual(skill_ingest.main(["get", "--skill-id", "codebasedmemory"]), 0)
            self.assertEqual(skill_ingest.main(["match", "--skill-id", "codebasedmemory"]), 0)
            self.assertEqual(
                skill_ingest.main(["packet", "--prompt", "neo4j ingestion guardrails", "--json"]),
                0,
            )
            self.assertEqual(
                skill_ingest.main(["handoff", "--prompt", "neo4j ingestion guardrails"]),
                0,
            )
            # empty packet still renders a valid handoff prompt (new-skill rule)
            self.assertEqual(
                skill_ingest.main(["handoff", "--prompt", "zzzqqqxxx"]),
                0,
            )

    def test_cli_get_missing_skill_returns_nonzero(self):
        config_patch, connect_patch = self._patched(FakeReadDriver())
        with config_patch, connect_patch:
            self.assertEqual(skill_ingest.main(["get", "--skill-id", "nope"]), 1)

    def test_cli_returns_2_on_neo4j_failure(self):
        config_patch, connect_patch = self._patched(FailingDriver())
        with config_patch, connect_patch:
            self.assertEqual(skill_ingest.main(["get", "--skill-id", "codebasedmemory"]), 2)


if __name__ == "__main__":
    unittest.main()
