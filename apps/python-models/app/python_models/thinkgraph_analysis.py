"""Bounded, disposable network analysis over explicit native relationships.

Recovers the July clean-room's NetworkX community/bridge approach. No text
extraction, graph writes, inferred facts, or model calls occur here.
"""
from __future__ import annotations

from functools import lru_cache
import json
import time
import networkx as nx


@lru_cache(maxsize=16)
def analyze_graph(revision: str, encoded: str) -> dict:
    started = time.perf_counter()
    data = json.loads(encoded)
    graph = nx.Graph()
    graph.add_nodes_from(data["nodes"])
    for edge in data["edges"]:
        a, b, weight = edge
        if a == b or a not in graph or b not in graph:
            continue
        weight = max(0.01, min(1.0, float(weight)))
        old = graph.get_edge_data(a, b, {}).get("weight", 0)
        graph.add_edge(a, b, weight=old + weight, distance=1 / (old + weight))
    if graph.number_of_edges():
        groups = nx.community.louvain_communities(graph, weight="weight", seed=0)
        centrality = nx.pagerank(graph, weight="weight")
        bridge = nx.betweenness_centrality(graph, k=min(64, len(graph)), weight="distance", seed=0)
    else:
        groups = [{node} for node in graph]
        centrality = {node: 0.0 for node in graph}
        bridge = centrality.copy()
    communities = []
    membership = {}
    for index, members in enumerate(sorted(groups, key=lambda group: sorted(group))):
        cid = f"{revision[:12]}:{index}"
        ordered = sorted(members, key=lambda node: (-centrality[node], node))
        membership.update({node: cid for node in members})
        communities.append({"id": cid, "memberCount": len(members), "members": sorted(members),
                            "centralNodes": ordered[:5],
                            "gateways": sorted((n for n in members if bridge[n] > 0), key=lambda n: (-bridge[n], n))[:5]})
    connections = {}
    for a, b, attrs in graph.edges(data=True):
        pair = tuple(sorted([membership[a], membership[b]]))
        if pair[0] != pair[1]:
            connections[pair] = connections.get(pair, 0) + attrs["weight"]
    # At most twelve missing links at two hops across community boundaries.
    # These are structural candidates, never asserted edges or research tasks.
    candidates = []
    for a in sorted(graph, key=lambda n: (-bridge[n], n))[:32]:
        for b, distance in nx.single_source_shortest_path_length(graph, a, cutoff=2).items():
            if distance == 2 and a < b and membership[a] != membership[b]:
                candidates.append({"source": a, "target": b, "edgeClass": "derived",
                                   "derivedType": "gap_candidate", "distance": distance,
                                   "reason": "Different communities share a two-hop path without a direct relationship."})
                if len(candidates) >= 12:
                    break
        if len(candidates) >= 12:
            break
    return {"revision": revision, "algorithm": "louvain", "communities": communities,
            "connections": [{"source": pair[0], "target": pair[1], "strength": weight} for pair, weight in sorted(connections.items())],
            "components": [sorted(c) for c in nx.connected_components(graph)],
            "nodes": {n: {"communityId": membership[n], "centrality": centrality[n], "gatewayScore": bridge[n]} for n in graph},
            "gaps": candidates, "durationMs": (time.perf_counter() - started) * 1000,
            "scope": "returned neighborhood"}
