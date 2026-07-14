# @graph entity: KnowGraph Inspection Extraction Provider
# @graph role: dev-admin-standin-extraction
# @graph relates_to: KnowGraph Ingest
# @graph depends_on: neo4j_graphrag LLMInterface
"""Dev/admin-only stand-in for the KnowGraph entity/relationship extraction model.

This is the ONE paid model boundary in `ingest.py::_create_runtime_pipeline`
(`llm = OpenAILLM(...)`). When an outside coding agent inspects the running stack
it may stand in at that boundary WITHOUT spending model credits. Everything else
in the pipeline stays real: deterministic PDF split, local embeddings, entity
resolution/dedup, provenance merge, and the canonical Neo4j writer.

Hard rules (enforced by `inspection_mode_enabled` + honest failures):
  - Never selected automatically. Only when `KNOWGRAPH_INSPECTION_MODE` is an
    explicit truthy env value (unset in production => real provider).
  - Never a fallback. If inspection mode is ON but no valid plan is supplied,
    this raises — it does NOT silently fall back to the paid model.
  - Never bypasses the canonical writer. It only returns the same
    `LLMResponse(content=<json>)` the real extractor already expects.

Response contract (neo4j_graphrag 1.18.0, V1 prompt-based path): the extractor
calls `ainvoke(prompt)` and parses `LLMResponse.content` as JSON of the shape
`{"nodes": [{"id","label","properties"}], "relationships":
[{"type","start_node_id","end_node_id","properties"}]}` — validated against
`Neo4jGraph`. Node ids are chunk-local strings (the pipeline prefixes them).
"""

from __future__ import annotations

import json
import os
from typing import Any, Optional

from neo4j_graphrag.llm.base import LLMInterface
from neo4j_graphrag.llm.types import LLMResponse

INSPECTION_MODE_ENV = "KNOWGRAPH_INSPECTION_MODE"
INSPECTION_PLAN_ENV = "KNOWGRAPH_INSPECTION_EXTRACTION_PATH"
PROVIDER_MODEL_NAME = "inspection-extraction-provider"

# ERExtractionTemplate ends with "Input text:\n\n{text}". We match anchors against
# the chunk text only, not the schema/examples preamble.
_INPUT_TEXT_MARKER = "Input text:"


def inspection_mode_enabled() -> bool:
    """True only when the admin/dev inspection mode is explicitly enabled."""
    return os.getenv(INSPECTION_MODE_ENV, "").strip().lower() in ("1", "true", "yes", "on")


def _chunk_text_of(prompt: str) -> str:
    """Isolate the chunk text from the formatted extraction prompt."""
    idx = prompt.rfind(_INPUT_TEXT_MARKER)
    return prompt[idx + len(_INPUT_TEXT_MARKER):] if idx >= 0 else prompt


def validate_plan(plan: Any) -> list[dict[str, Any]]:
    """Validate an inspection extraction plan. Malformed plans fail honestly.

    A plan is a list of entries. Each entry emits a self-contained mini-graph
    when it matches a chunk:
      {
        "match": ["organizing principle", ...],   # substrings (case-insensitive); omit + "always": true to emit on every chunk
        "always": false,
        "nodes": [{"id","label","properties"}],    # properties MUST carry provenance "source"
        "relationships": [{"type","start_node_id","end_node_id","properties"}]
      }
    """
    if not isinstance(plan, list) or not plan:
        raise ValueError("inspection extraction plan must be a non-empty list of entries")
    for i, entry in enumerate(plan):
        if not isinstance(entry, dict):
            raise ValueError(f"plan entry {i} must be an object")
        nodes = entry.get("nodes")
        if not isinstance(nodes, list) or not nodes:
            raise ValueError(f"plan entry {i} must have a non-empty 'nodes' list")
        if not entry.get("always") and not entry.get("match"):
            raise ValueError(f"plan entry {i} must have 'match' anchors or 'always': true")
        for n in nodes:
            if not isinstance(n, dict) or "id" not in n or "label" not in n:
                raise ValueError(f"plan entry {i} has a node missing id/label")
            props = n.get("properties")
            if not isinstance(props, dict) or not str(props.get("source", "")).strip():
                # Provenance is required: every stand-in entity is traceable to its source.
                raise ValueError(f"plan entry {i} node {n.get('id')!r} missing provenance 'source' property")
        for r in entry.get("relationships", []) or []:
            if not all(k in r for k in ("type", "start_node_id", "end_node_id")):
                raise ValueError(f"plan entry {i} has a relationship missing type/start/end")
    return plan


class InspectionExtractionLLM(LLMInterface):
    """Returns pre-planned, source-grounded extraction for the chunk being seen.

    Per chunk: emit the union of mini-graphs whose anchors appear in the chunk
    text (plus any 'always' entries). Node ids are de-duplicated within the
    response; relationships are kept only when both endpoints are present.
    Repeated concepts across chunks are collapsed by the pipeline's entity
    resolution (same label + name), while each chunk that mentions a concept
    still yields real MENTIONS provenance.
    """

    def __init__(self, plan: list[dict[str, Any]], model_name: str = PROVIDER_MODEL_NAME) -> None:
        super().__init__(model_name=model_name)
        self.plan = validate_plan(plan)

    def _extract_json(self, prompt: str) -> str:
        text = _chunk_text_of(prompt).lower()
        nodes: list[dict[str, Any]] = []
        seen_ids: set[str] = set()
        rels: list[dict[str, Any]] = []
        for entry in self.plan:
            matched = entry.get("always") or any(
                str(m).lower() in text for m in (entry.get("match") or [])
            )
            if not matched:
                continue
            for n in entry["nodes"]:
                if n["id"] not in seen_ids:
                    nodes.append({"id": n["id"], "label": n["label"], "properties": dict(n.get("properties", {}))})
                    seen_ids.add(n["id"])
            rels.extend(entry.get("relationships", []) or [])
        present = {n["id"] for n in nodes}
        rels = [r for r in rels if r["start_node_id"] in present and r["end_node_id"] in present]
        return json.dumps({"nodes": nodes, "relationships": rels})

    def invoke(
        self,
        input: str,
        message_history: Optional[Any] = None,
        system_instruction: Optional[str] = None,
    ) -> LLMResponse:
        return LLMResponse(content=self._extract_json(input if isinstance(input, str) else str(input)))

    async def ainvoke(
        self,
        input: str,
        message_history: Optional[Any] = None,
        system_instruction: Optional[str] = None,
    ) -> LLMResponse:
        return LLMResponse(content=self._extract_json(input if isinstance(input, str) else str(input)))


def load_inspection_plan(path: Optional[str] = None) -> list[dict[str, Any]]:
    """Load + validate the plan JSON. Honest failure if missing/unreadable."""
    resolved = (path or os.getenv(INSPECTION_PLAN_ENV, "")).strip()
    if not resolved:
        raise RuntimeError(
            f"{INSPECTION_MODE_ENV} is enabled but {INSPECTION_PLAN_ENV} is not set — "
            "refusing to silently fall back to a paid extraction model."
        )
    with open(resolved, "r", encoding="utf-8") as fh:
        plan = json.load(fh)
    return validate_plan(plan)


def build_inspection_extraction_llm_from_env() -> InspectionExtractionLLM:
    """Construct the stand-in extraction provider from env. Raises on any gap."""
    return InspectionExtractionLLM(load_inspection_plan())
