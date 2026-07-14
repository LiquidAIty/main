"""Tests for the dev/admin-only KnowGraph inspection extraction seam (stdlib only).

Run: services/knowgraph/.venv/Scripts/python.exe -m unittest test_inspection_extraction_provider -v

Proves: production cannot activate it; missing plan fails honestly (no silent
fallback to the paid model); output satisfies the real Neo4jGraph contract;
malformed plans and missing provenance fail validation; the shipped plan is
valid and schema-aligned.
"""

from __future__ import annotations

import asyncio
import json
import os
import unittest

from neo4j_graphrag.experimental.components.types import Neo4jGraph

import inspection_extraction_provider as prov
from schema import NODE_TYPES

PLAN_PATH = os.path.join(os.path.dirname(__file__), "inspection_plans", "organizing_principle_discovery.json")

VALID_PLAN = [
    {
        "match": ["organizing principle"],
        "nodes": [
            {"id": "op", "label": "Concept", "properties": {"name": "Organizing Principle", "source": "book"}},
            {"id": "kg", "label": "Concept", "properties": {"name": "Knowledge Graph", "source": "book"}},
        ],
        "relationships": [
            {"type": "RELATED_TO", "start_node_id": "op", "end_node_id": "kg", "properties": {}},
        ],
    }
]


def _prompt_with_text(text: str) -> str:
    # Mimic ERExtractionTemplate's tail so the provider isolates the chunk text.
    return f"You are a top-tier algorithm...\nUse only ...\nInput text:\n\n{text}"


class InspectionExtractionTests(unittest.TestCase):
    def setUp(self) -> None:
        self._saved = {k: os.environ.get(k) for k in (prov.INSPECTION_MODE_ENV, prov.INSPECTION_PLAN_ENV)}

    def tearDown(self) -> None:
        for k, v in self._saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def test_inspection_mode_disabled_by_default(self) -> None:
        os.environ.pop(prov.INSPECTION_MODE_ENV, None)
        self.assertFalse(prov.inspection_mode_enabled())
        for falsy in ("", "false", "0", "no", "off"):
            os.environ[prov.INSPECTION_MODE_ENV] = falsy
            self.assertFalse(prov.inspection_mode_enabled())
        for truthy in ("1", "true", "yes", "on", "TRUE"):
            os.environ[prov.INSPECTION_MODE_ENV] = truthy
            self.assertTrue(prov.inspection_mode_enabled())

    def test_missing_plan_fails_honestly_no_fallback(self) -> None:
        os.environ[prov.INSPECTION_MODE_ENV] = "1"
        os.environ.pop(prov.INSPECTION_PLAN_ENV, None)
        with self.assertRaises(RuntimeError):
            prov.build_inspection_extraction_llm_from_env()

    def test_validate_plan_rejects_malformed(self) -> None:
        with self.assertRaises(ValueError):
            prov.validate_plan([])
        with self.assertRaises(ValueError):
            prov.validate_plan([{"match": ["x"]}])  # no nodes
        with self.assertRaises(ValueError):
            prov.validate_plan([{"nodes": [{"id": "a", "label": "Concept", "properties": {"name": "A", "source": "s"}}]}])  # no match/always
        with self.assertRaises(ValueError):  # missing provenance 'source'
            prov.validate_plan([{"match": ["x"], "nodes": [{"id": "a", "label": "Concept", "properties": {"name": "A"}}]}])

    def test_extraction_matches_anchor_and_validates(self) -> None:
        llm = prov.InspectionExtractionLLM(VALID_PLAN)
        resp = llm.invoke(_prompt_with_text("This chapter introduces the organizing principle of a graph."))
        graph = Neo4jGraph.model_validate(json.loads(resp.content))
        names = {n.properties["name"] for n in graph.nodes}
        self.assertEqual(names, {"Organizing Principle", "Knowledge Graph"})
        self.assertEqual(len(graph.relationships), 1)
        self.assertEqual(graph.relationships[0].type, "RELATED_TO")

    def test_no_anchor_returns_empty_but_valid(self) -> None:
        llm = prov.InspectionExtractionLLM(VALID_PLAN)
        resp = llm.invoke(_prompt_with_text("Totally unrelated sentence about the weather."))
        graph = Neo4jGraph.model_validate(json.loads(resp.content))
        self.assertEqual(graph.nodes, [])
        self.assertEqual(graph.relationships, [])

    def test_dangling_relationship_is_dropped(self) -> None:
        plan = [{
            "match": ["x"],
            "nodes": [{"id": "a", "label": "Concept", "properties": {"name": "A", "source": "s"}}],
            "relationships": [{"type": "RELATED_TO", "start_node_id": "a", "end_node_id": "missing", "properties": {}}],
        }]
        llm = prov.InspectionExtractionLLM(plan)
        graph = Neo4jGraph.model_validate(json.loads(llm.invoke(_prompt_with_text("x")).content))
        self.assertEqual(len(graph.nodes), 1)
        self.assertEqual(graph.relationships, [])

    def test_ainvoke_matches_invoke(self) -> None:
        llm = prov.InspectionExtractionLLM(VALID_PLAN)
        p = _prompt_with_text("the organizing principle matters")
        self.assertEqual(json.loads(llm.invoke(p).content), json.loads(asyncio.run(llm.ainvoke(p)).content))

    def test_shipped_plan_is_valid_and_schema_aligned(self) -> None:
        plan = prov.load_inspection_plan(PLAN_PATH)
        allowed = {nt["label"] for nt in NODE_TYPES}
        for entry in plan:
            for node in entry["nodes"]:
                self.assertIn(node["label"], allowed, f"{node['label']} not in KNOWGRAPH_SCHEMA")
                self.assertTrue(str(node["properties"].get("source", "")).strip(), "node missing provenance")


if __name__ == "__main__":
    unittest.main()
