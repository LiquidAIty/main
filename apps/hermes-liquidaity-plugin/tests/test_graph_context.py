# Entity: Project Knowledge Graph
# Relationship: Proves request-only graph selection preserves literal/image history and never hands map data to compaction.
# Entity: Hermes Plugin
# Relationship: Exercises the actual installed Hermes request-only selection and compaction contracts in Hermes's managed Python runtime.
"""Run with Hermes's Python runtime; no provider calls or product data writes."""

import copy
import importlib.util
import json
import logging
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from agent.context_compressor import ContextCompressor
from agent.conversation_loop import _apply_context_engine_selection
from agent.conversation_compression import _commit_compaction
from agent.session_persistence import _db_flush_row
from hermes_state import SessionDB

spec = importlib.util.spec_from_file_location("graph_context_under_test", Path(__file__).parents[1] / "graph_context.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class GraphContextTests(unittest.TestCase):
    def setUp(self):
        self.value = {"ok": True, "projectId": "project-one",
            "map": {"schemaVersion": "project-entity-map", "entities": [{"id": "subject", "name": "Subject"}],
                    "relationships": []}, "openNode": {"id": "subject", "records": [{"id": "record", "summary": "Selected detail"}]}}
        self.calls = []
        self.ctx = SimpleNamespace(profile_name="main", get_config=lambda name, default: "project-one" if name == "project_id" else default)
        self.config = {"model": {"default": "gpt-5.6-sol", "provider": "openai-codex", "context_length": 272000},
                       "compression": {"threshold": 0.5}, "agent": {}}
        self.engine = module.GraphContextEngine("project-one", "main", self.read, self.config)
        self.engine.update_model("gpt-5.6-sol", 272000, provider="openai-codex")

    def read(self, project, profile):
        self.calls.append((project, profile))
        return copy.deepcopy(self.value)

    def test_one_read_per_turn_request_only_including_images(self):
        for content in ("Literal words", [{"type": "text", "text": "Literal words"},
                         {"type": "image_url", "image_url": {"url": "data:image/png;base64,AA=="}}]):
            self.engine.on_turn_complete([])
            self.calls.clear()
            history = [{"role": "user", "content": copy.deepcopy(content)}]
            original = copy.deepcopy(history)
            request = [{"role": "system", "content": "Existing instructions"}, {"role": "user", "content": copy.deepcopy(content)}]
            agent = SimpleNamespace(context_compressor=self.engine, session_id="isolated")
            first = _apply_context_engine_selection(agent, request, history, history[0], logger=logging.getLogger("test"))
            self.value["map"]["entities"][0]["name"] = "Later click"
            second = _apply_context_engine_selection(agent, request, history, history[0], logger=logging.getLogger("test"))
            self.assertEqual(first, second)
            self.assertEqual(history, original)
            self.assertEqual(request[0]["content"], "Existing instructions")
            self.assertEqual(first[1]["content"], content)
            self.assertEqual(json.dumps(first).count("Current Project Entity Map"), 1)
            from agent.transports.codex import ResponsesApiTransport
            wire = ResponsesApiTransport().build_kwargs("gpt-5.6-sol", first,
                provider="openai-codex", base_url="https://chatgpt.com/backend-api/codex", is_codex_backend=True)
            self.assertEqual(wire["instructions"].count("Current Project Entity Map"), 1)
            self.assertNotIn("Current Project Entity Map", json.dumps(wire["input"]))
            self.assertIn("Literal words", json.dumps(wire["input"]))
            self.assertEqual(len(self.calls), 1)
            self.assertNotIn("Current Project Entity Map", json.dumps(history))
            self.value["map"]["entities"][0]["name"] = "Subject"

    def test_threshold_compaction_and_reopen_do_not_receive_or_store_map(self):
        history = [{"role": "user", "content": "Literal words"}]
        selected = self.engine.select_context(copy.deepcopy(history), conversation_messages=history, incoming_message=history[0])
        self.assertIn("Selected detail", json.dumps(selected))
        with tempfile.TemporaryDirectory(prefix="graph-context-proof-") as directory:
            path = Path(directory) / "state.db"
            db = SessionDB(db_path=path)
            db.create_session(session_id="isolated", source="test")
            agent = SimpleNamespace(session_id="isolated", _session_db=db, _persist_user_message_idx=0,
                _persist_user_message_override=None, _active_session_turn_lease_holder=None,
                context_compressor=self.engine, commit_memory_session=lambda _: None)
            db.append_messages_batch("isolated", [_db_flush_row(agent, history[0], True)])
            # The host compacts canonical messages, not select_context's request copy.
            compressed = copy.deepcopy(history)
            with patch("agent.conversation_compression._salvage_or_refuse_grown_transcript", return_value=(compressed, None)), \
                 patch("agent.conversation_compression._held_watermark", return_value=None), \
                 patch("agent.conversation_compression_archive.coverage_for_commit", return_value=(None, None)):
                result = _commit_compaction(agent, history, compressed, in_place=True,
                    lease=SimpleNamespace(watermark=None, holder=None), new_system_prompt="Existing instructions",
                    system_message="Existing instructions", compressed_user_turn_outcome="already_present",
                    messages_before_compression=copy.deepcopy(history), made_progress=True, attempt=SimpleNamespace(snapshot={}))
            self.assertTrue(result.session_commit_succeeded)
            self.assertNotIn("Selected detail", json.dumps(result.compressed))
            db.close()
            reopened = SessionDB(db_path=path, read_only=True)
            rows = reopened.get_messages("isolated")
            self.assertTrue(all(row["content"] == "Literal words" for row in rows))
            self.assertTrue(all(not row.get("api_content") for row in rows))
            reopened.close()

    def test_same_hermes_compactor_and_threshold_policy(self):
        from agent.agent_init import _build_context_engine, _parse_compression_config
        agent = SimpleNamespace(model="gpt-5.6-sol", provider="openai-codex", api_mode="", base_url="",
                                api_key="", max_tokens=None, quiet_mode=True, session_id="isolated")
        settings = _parse_compression_config(agent, self.config)
        _build_context_engine(agent, self.config, settings, None, 272000, None)
        baseline = agent.context_compressor
        for field in ("threshold_tokens", "threshold_percent", "protect_first_n", "protect_last_n",
                      "summary_target_ratio", "threshold_tokens_cap", "tail_mode", "_micro_compact_enabled"):
            self.assertEqual(getattr(self.engine, field), getattr(baseline, field), field)
        self.assertIs(type(self.engine).compress, ContextCompressor.compress)
        self.assertIs(type(self.engine).should_compress, ContextCompressor.should_compress)

    def test_next_turn_reads_new_view_and_closed_node_has_no_details(self):
        incoming = {"role": "user", "content": "First"}
        self.engine.select_context([{"role": "user", "content": "First"}], incoming_message=incoming)
        self.engine.on_turn_complete([])
        self.value["openNode"] = None
        self.value["map"]["entities"] = []
        second = self.engine.select_context([{"role": "user", "content": "Next"}], incoming_message=incoming)
        self.assertNotIn("Selected detail", json.dumps(second))
        self.assertNotIn('"openNode"', second[0]["content"])
        self.assertEqual(len(self.calls), 2)

    def test_all_four_cards_read_map_but_only_main_receives_open_node(self):
        for profile in ("main", "builder", "thinkgraph", "knowgraph"):
            engine = module.GraphContextEngine("project-one", profile, self.read, self.config)
            result = engine.select_context([{"role": "user", "content": "Question"}])
            self.assertIn('"name":"Subject"', result[0]["content"])
            self.assertEqual("Selected detail" in result[0]["content"], profile == "main")
        self.assertEqual([profile for _, profile in self.calls], ["main", "builder", "thinkgraph", "knowgraph"])


if __name__ == "__main__":
    unittest.main()
