"""Compile the strict ReactFlow graph payload into an executable structure.

ReactFlow is the product graph and the source of truth. Nodes/cards define
agents, tools, instructions, and explicit model configuration. Edges define
sequence, branch, join, loop-with-exit-rule, parallel, and mixed execution.

This compiler produces the v0.4.4-compatible executable graph representation
used by the Magentic-One runtime in ``magentic_runtime.py``. It never invents
connections, never applies model defaults, and fails loudly on every invalid
or missing configuration.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.python_models.orchestration_contracts import (
    CardRuntimeConfig,
    GraphEdgeInput,
    GraphNodeInput,
)


class GraphCompileError(RuntimeError):
    pass


@dataclass
class CompiledLoop:
    """A ReactFlow loop: a flow back-edge with an explicit exit rule."""

    edge: GraphEdgeInput
    cycle_node_ids: list[str]
    max_iterations: int
    exit_on_text: str | None


@dataclass
class CompiledSubgraph:
    """Flow structure over one set of nodes (top level or one SoM child graph)."""

    node_ids: list[str]
    flow_edges: list[GraphEdgeInput] = field(default_factory=list)
    successors: dict[str, list[str]] = field(default_factory=dict)
    predecessors: dict[str, list[str]] = field(default_factory=dict)
    levels: list[list[str]] = field(default_factory=list)
    loops: list[CompiledLoop] = field(default_factory=list)
    entry_node_ids: list[str] = field(default_factory=list)
    terminal_node_ids: list[str] = field(default_factory=list)


@dataclass
class CompiledGraph:
    orchestrator_id: str
    nodes: dict[str, GraphNodeInput]
    participant_ids: list[str]
    top_level: CompiledSubgraph
    som_subgraphs: dict[str, CompiledSubgraph]
    fan_out_ids: list[str]

    def classify_edges(self) -> dict[str, object]:
        """Structure report used by contract tests: sequence/branch/join/loop/parallel."""
        succ = self.top_level.successors
        pred = self.top_level.predecessors
        return {
            "sequence": [
                (source, targets[0])
                for source, targets in succ.items()
                if len(targets) == 1 and len(pred.get(targets[0], [])) == 1
            ],
            "branch": {source: list(targets) for source, targets in succ.items() if len(targets) > 1},
            "join": {target: list(sources) for target, sources in pred.items() if len(sources) > 1},
            "loop": [loop.edge for loop in self.top_level.loops]
            + [loop.edge for sub in self.som_subgraphs.values() for loop in sub.loops],
            "parallel_groups": [level for level in self.top_level.levels if len(level) > 1],
        }


def _read_loop_rule(edge: GraphEdgeInput) -> tuple[int, str | None] | None:
    if edge.loop is not None:
        return edge.loop.maxIterations, edge.loop.exitOnText
    raw = edge.data.get("loop") if isinstance(edge.data, dict) else None
    if isinstance(raw, dict):
        max_iterations = raw.get("maxIterations")
        if not isinstance(max_iterations, int) or max_iterations < 1:
            raise GraphCompileError(
                f"graph_loop_invalid_exit_rule: edge={edge.id or edge.source + '->' + edge.target}"
            )
        exit_on_text = raw.get("exitOnText")
        return max_iterations, str(exit_on_text) if exit_on_text else None
    return None


def _require_model_config(node: GraphNodeInput) -> None:
    provider = str(node.provider or "").strip()
    provider_model_id = str(node.providerModelId or "").strip()
    if not provider or not provider_model_id:
        raise GraphCompileError(
            f"card_model_config_missing: cardId={node.cardId} runtimeType={node.runtimeType}"
        )
    if provider.lower() == "default" or provider_model_id.lower() == "default":
        raise GraphCompileError(
            f"card_model_config_default_forbidden: cardId={node.cardId}"
        )


def _compile_flow_structure(
    node_ids: list[str],
    flow_edges: list[GraphEdgeInput],
    scope_label: str,
) -> CompiledSubgraph:
    """Compile flow edges over one node scope, preserving sequence, branch,
    join, parallel, and loop-with-exit-rule semantics."""
    id_set = set(node_ids)
    successors: dict[str, list[str]] = {node_id: [] for node_id in node_ids}
    predecessors: dict[str, list[str]] = {node_id: [] for node_id in node_ids}
    loops: list[CompiledLoop] = []
    dag_edges: list[GraphEdgeInput] = []

    loop_edges: list[GraphEdgeInput] = []
    for edge in flow_edges:
        if edge.source not in id_set or edge.target not in id_set:
            raise GraphCompileError(
                f"graph_edge_unknown_node: scope={scope_label} edge={edge.id or edge.source + '->' + edge.target}"
            )
        if _read_loop_rule(edge) is not None:
            loop_edges.append(edge)
        else:
            dag_edges.append(edge)
            successors[edge.source].append(edge.target)
            predecessors[edge.target].append(edge.source)

    # Kahn layering: nodes in the same level have no dependency between them
    # and execute as a parallel group. A leftover cycle means a ReactFlow loop
    # without an explicit exit rule, which is a hard error.
    indegree = {node_id: len(predecessors[node_id]) for node_id in node_ids}
    levels: list[list[str]] = []
    ready = sorted([node_id for node_id in node_ids if indegree[node_id] == 0])
    placed = 0
    while ready:
        levels.append(list(ready))
        next_ready: list[str] = []
        for node_id in ready:
            placed += 1
            for target in successors[node_id]:
                indegree[target] -= 1
                if indegree[target] == 0:
                    next_ready.append(target)
        ready = sorted(set(next_ready))
    if placed != len(node_ids):
        unresolved = sorted(node_id for node_id in node_ids if indegree[node_id] > 0)
        raise GraphCompileError(
            f"graph_loop_missing_exit_rule: scope={scope_label} nodes={','.join(unresolved)}"
        )

    # Loop edges (explicit exit rule) re-enter earlier nodes. The cycle body is
    # every DAG node on a path target..source, inclusive.
    reachable_cache: dict[str, set[str]] = {}

    def _reachable_from(start: str) -> set[str]:
        if start in reachable_cache:
            return reachable_cache[start]
        seen: set[str] = set()
        stack = [start]
        while stack:
            current = stack.pop()
            for nxt in successors[current]:
                if nxt not in seen:
                    seen.add(nxt)
                    stack.append(nxt)
        reachable_cache[start] = seen
        return seen

    topo_order = [node_id for level in levels for node_id in level]
    topo_index = {node_id: index for index, node_id in enumerate(topo_order)}
    for edge in loop_edges:
        max_iterations, exit_on_text = _read_loop_rule(edge) or (1, None)
        body_start, body_end = edge.target, edge.source
        if body_start == body_end:
            cycle_nodes = [body_start]
        else:
            if body_end not in _reachable_from(body_start):
                raise GraphCompileError(
                    f"graph_loop_unreachable_cycle: scope={scope_label} edge={edge.id or edge.source + '->' + edge.target}"
                )
            on_path = {
                node_id
                for node_id in _reachable_from(body_start) | {body_start}
                if node_id == body_end or body_end in _reachable_from(node_id)
            }
            cycle_nodes = sorted(on_path, key=lambda node_id: topo_index[node_id])
        loops.append(
            CompiledLoop(
                edge=edge,
                cycle_node_ids=cycle_nodes,
                max_iterations=max_iterations,
                exit_on_text=exit_on_text,
            )
        )

    flow_touched = {edge.source for edge in dag_edges} | {edge.target for edge in dag_edges}
    entry_node_ids = sorted(
        node_id for node_id in flow_touched if len(predecessors[node_id]) == 0
    )
    terminal_node_ids = sorted(
        node_id for node_id in flow_touched if len(successors[node_id]) == 0
    )
    return CompiledSubgraph(
        node_ids=list(node_ids),
        flow_edges=list(flow_edges),
        successors=successors,
        predecessors=predecessors,
        levels=levels,
        loops=loops,
        entry_node_ids=entry_node_ids,
        terminal_node_ids=terminal_node_ids,
    )


def compile_card_graph(card: CardRuntimeConfig) -> CompiledGraph:
    if card.runtimeType != "magentic_one":
        raise GraphCompileError(f"graph_orchestrator_card_required: got {card.runtimeType}")
    if card.graph is None or not card.graph.nodes:
        raise GraphCompileError("graph_payload_missing: cardRuntime.graph with nodes is required")
    if not card.participants:
        raise GraphCompileError("graph_participants_missing")

    nodes: dict[str, GraphNodeInput] = {}
    for node in card.graph.nodes:
        if node.cardId in nodes:
            raise GraphCompileError(f"graph_duplicate_node: cardId={node.cardId}")
        nodes[node.cardId] = node

    orchestrator_id = card.cardId
    if orchestrator_id not in nodes:
        raise GraphCompileError(f"graph_orchestrator_node_missing: cardId={orchestrator_id}")

    for edge in card.graph.edges:
        if edge.source not in nodes or edge.target not in nodes:
            raise GraphCompileError(
                f"graph_edge_unknown_node: edge={edge.id or edge.source + '->' + edge.target}"
            )

    magentic_option_peers: set[str] = set()
    for edge in card.graph.edges:
        if edge.edgeType != "magentic_option":
            continue
        if edge.source == orchestrator_id and edge.target != orchestrator_id:
            magentic_option_peers.add(edge.target)
        elif edge.target == orchestrator_id and edge.source != orchestrator_id:
            magentic_option_peers.add(edge.source)

    participant_ids: list[str] = []
    for participant in card.participants:
        node = nodes.get(participant.cardId)
        if node is None:
            raise GraphCompileError(f"graph_participant_node_missing: cardId={participant.cardId}")
        if participant.cardId not in magentic_option_peers:
            raise GraphCompileError(
                f"graph_participant_missing_magentic_option_edge: cardId={participant.cardId}"
            )
        if node.parentGraphId:
            raise GraphCompileError(
                f"graph_participant_inside_subgraph_forbidden: cardId={participant.cardId}"
            )
        _require_model_config(node)
        participant_ids.append(participant.cardId)

    # Child-agent subgraphs: nodes that declare parentGraphId. A participant
    # card with connected children is a Society-of-Mind parent.
    children_by_parent: dict[str, list[str]] = {}
    for node in card.graph.nodes:
        parent_id = str(node.parentGraphId or "").strip()
        if not parent_id:
            continue
        if parent_id not in nodes:
            raise GraphCompileError(
                f"graph_child_parent_missing: cardId={node.cardId} parentGraphId={parent_id}"
            )
        children_by_parent.setdefault(parent_id, []).append(node.cardId)

    som_subgraphs: dict[str, CompiledSubgraph] = {}
    for parent_id, child_ids in children_by_parent.items():
        if parent_id not in participant_ids:
            raise GraphCompileError(
                f"graph_child_subgraph_parent_not_participant: parent={parent_id}"
            )
        for child_id in child_ids:
            _require_model_config(nodes[child_id])
        child_set = set(child_ids)
        child_edges = [
            edge
            for edge in card.graph.edges
            if edge.edgeType == "flow" and edge.source in child_set and edge.target in child_set
        ]
        subgraph = _compile_flow_structure(sorted(child_ids), child_edges, scope_label=f"som:{parent_id}")
        som_subgraphs[parent_id] = subgraph

    for participant in card.participants:
        node = nodes[participant.cardId]
        has_children = participant.cardId in som_subgraphs
        flagged = bool(participant.isSocietyOfMind or node.isSocietyOfMind)
        if flagged and not has_children:
            raise GraphCompileError(
                f"graph_som_child_subgraph_missing: cardId={participant.cardId}"
            )

    fan_out_ids: list[str] = []
    for participant in card.participants:
        node = nodes[participant.cardId]
        fan_out = participant.fanOut or node.fanOut
        if fan_out is not None and fan_out.enabled:
            if participant.cardId in som_subgraphs:
                raise GraphCompileError(
                    f"graph_fan_out_and_som_conflict: cardId={participant.cardId}"
                )
            fan_out_ids.append(participant.cardId)

    top_level_set = set(participant_ids)
    top_level_flow_edges = [
        edge
        for edge in card.graph.edges
        if edge.edgeType == "flow" and edge.source in top_level_set and edge.target in top_level_set
    ]
    top_level = _compile_flow_structure(
        sorted(top_level_set), top_level_flow_edges, scope_label="top_level"
    )

    return CompiledGraph(
        orchestrator_id=orchestrator_id,
        nodes=nodes,
        participant_ids=participant_ids,
        top_level=top_level,
        som_subgraphs=som_subgraphs,
        fan_out_ids=fan_out_ids,
    )
