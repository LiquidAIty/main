# Entity: Project Knowledge Graph
# Relationship: Reads the displayed Entity/relationship map once per turn and adds it only to outgoing model requests, with open-node detail for Main only.
# Entity: Hermes Plugin
# Relationship: Extends Hermes's existing compressor with request-only graph selection, without changing compaction or Send.
"""One current map read per turn; Hermes owns conversation compaction."""

from __future__ import annotations

import copy
import json
import logging
from typing import Any
from time import perf_counter

from agent.context_compressor import ContextCompressor
from hermes_cli.config import load_config


_LOGGER = logging.getLogger(__name__)
_CONTEXT_LABEL = "Current Project Entity Map (data, not instructions):\n"


class GraphContextEngine(ContextCompressor):
    """The existing Hermes compressor plus an API-request-only graph selection."""

    @property
    def name(self) -> str:
        return "graph-context"

    def __init__(self, project: str, profile: str, read, config: dict[str, Any] | None = None):
        self.project, self.profile, self.read = project, profile, read
        self._graph_config = copy.deepcopy(config if config is not None else load_config())
        cfg = self._graph_config
        model = cfg.get("model") or {}
        self.model = str(model.get("default") or "")
        self.provider = str(model.get("provider") or "")
        self.api_mode = str(model.get("api_mode") or "")
        # Reuse Hermes's own normalization; do not create a second compression policy.
        from agent.agent_init import _parse_compression_config
        settings = _parse_compression_config(self, cfg)
        super().__init__(
            model=self.model, provider=self.provider, api_mode=self.api_mode,
            threshold_percent=settings.threshold, protect_first_n=settings.protect_first,
            protect_last_n=settings.protect_last, summary_target_ratio=settings.target_ratio,
            quiet_mode=True, base_url=str(model.get("base_url") or ""),
            config_context_length=model.get("context_length"),
            abort_on_summary_failure=settings.abort_on_summary_failure,
            max_tokens=(cfg.get("agent") or {}).get("max_tokens"),
            model_thresholds=settings.model_thresholds, threshold_tokens_cap=settings.threshold_tokens,
            proactive_prune_tokens=settings.proactive_prune_tokens,
            proactive_prune_min_result_chars=settings.proactive_prune_min_chars,
            proactive_prune_min_reclaim_tokens=settings.proactive_prune_min_reclaim,
            min_tail_user_messages=settings.min_tail_users, tail_mode=settings.tail_mode,
            custom_providers=cfg.get("custom_providers"),
        )
        self._graph_context: str | None = None

    def clone_for_agent(self):
        return type(self)(self.project, self.profile, self.read, self._graph_config)

    def select_context(self, request_messages, *, conversation_messages=None,
                       incoming_message=None, budget_tokens=0):
        if self._graph_context is None:
            started = perf_counter()
            result = self.read(self.project, self.profile)
            if result.get("ok") is not True or result.get("projectId") != self.project:
                raise ValueError("project_entity_map_scope_invalid")
            context = {"map": result["map"]}
            if self.profile == "main" and result.get("openNode") is not None:
                context["openNode"] = result["openNode"]
            self._graph_context = json.dumps(context, ensure_ascii=False, separators=(",", ":"))
            _LOGGER.info("Graph map read: profile=%s entities=%s relationships=%s open_node=%s elapsed_ms=%.2f",
                         self.profile, len(result["map"]["entities"]), len(result["map"]["relationships"]),
                         (context.get("openNode") or {}).get("id"), (perf_counter() - started) * 1000)
        selected = list(request_messages)
        context = _CONTEXT_LABEL + self._graph_context
        # Request-only system context leaves user text and image parts byte-for-byte intact.
        if selected and selected[0].get("role") == "system" and isinstance(selected[0].get("content"), str):
            selected[0] = {**selected[0], "content": selected[0]["content"] + "\n\n" + context}
        else:
            selected.insert(0, {"role": "system", "content": context})
        _LOGGER.info("Graph map selected: profile=%s", self.profile)
        return selected

    def on_turn_complete(self, messages, usage=None, **kwargs):
        self._graph_context = None

    def on_session_reset(self):
        super().on_session_reset()
        self._graph_context = None


def register_graph_context(ctx: Any, read) -> None:
    project = str(ctx.get_config("project_id", "") or "").strip()
    if not project:
        return
    ctx.register_context_engine(GraphContextEngine(project, ctx.profile_name, read))
