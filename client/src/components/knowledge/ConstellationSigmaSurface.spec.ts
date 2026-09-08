import { MultiDirectedGraph } from 'graphology';
import { describe, expect, it } from 'vitest';

import type { GraphProjectionV1 } from './NativeAuthorityGraphSurface';
import { synchronizeProjectionGraph } from './constellationSigmaGraph';
import forceAtlas2 from 'graphology-layout-forceatlas2';

function projection(
  nodes: GraphProjectionV1['nodes'],
  edges: GraphProjectionV1['edges'],
): GraphProjectionV1 {
  return {
    schemaVersion: 'thinkgraph.constellation.v1',
    authority: 'constellation-engine',
    projectId: 'project-one',
    revision: 'constellation-test-revision',
    nodes,
    edges,
  };
}

describe('Constellation Sigma Graphology synchronization', () => {
  it('gives a small populated graph a two-dimensional layout instead of trapping forces on one line', () => {
    const graph = new MultiDirectedGraph();
    const nodes = Array.from({ length: 12 }, (_, i) => ({ id: String(i), label: String(i), mentionCount: 1 }));
    const edges = nodes.slice(1).map((node, i) => ({ id: `edge-${i}`, source: String(Math.floor(i / 3)), target: node.id, predicate: 'contains', mentionCount: 1 }));
    synchronizeProjectionGraph(graph, projection(nodes, edges));
    forceAtlas2.assign(graph, { iterations: 100, settings: { gravity: 1, scalingRatio: 10 } });
    const xs = graph.nodes().map(id => graph.getNodeAttribute(id, 'x'));
    const ys = graph.nodes().map(id => graph.getNodeAttribute(id, 'y'));
    expect(xs.every(Number.isFinite) && ys.every(Number.isFinite)).toBe(true);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(1);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(1);
  });
  it('uses native edges in ForceAtlas2 and distinguishes derived edges without rewriting them', () => {
    const linked = new MultiDirectedGraph();
    const disconnected = new MultiDirectedGraph();
    const nodes = ['a', 'b', 'c', 'd'].map(id => ({ id, label: id, mentionCount: 1, properties: { communityId: id < 'c' ? 'one' : 'two' } }));
    const edges = [{ id: '1', source: 'a', target: 'b', predicate: 'supports', mentionCount: 1, properties: { edgeClass: 'explicit', strength: 0.8 } }, { id: '2', source: 'c', target: 'd', predicate: 'coactivation', mentionCount: 1, properties: { edgeClass: 'derived', strength: 0.4 } }];
    synchronizeProjectionGraph(linked, projection(nodes, edges));
    synchronizeProjectionGraph(disconnected, projection(nodes, []));
    forceAtlas2.assign(linked, { iterations: 100, settings: { gravity: 1, scalingRatio: 10 } });
    forceAtlas2.assign(disconnected, { iterations: 100, settings: { gravity: 1, scalingRatio: 10 } });
    expect(linked.getNodeAttribute('a', 'x')).not.toBe(disconnected.getNodeAttribute('a', 'x'));
    expect(linked.getEdgeAttribute('1', 'color')).not.toBe(linked.getEdgeAttribute('2', 'color'));
    expect(linked.getNodeAttribute('a', 'color')).toBe(linked.getNodeAttribute('b', 'color'));
    expect(linked.getNodeAttribute('a', 'color')).not.toBe(linked.getNodeAttribute('d', 'color'));
    expect(linked.edges()).toEqual(['1', '2']);
    expect(edges[1].properties.edgeClass).toBe('derived');
  });
  it('updates one disposable graph by native ID while preserving surviving view positions', () => {
    const graph = new MultiDirectedGraph();
    const first = projection(
      [
        { id: 'native-a', canonicalId: 'native-a', label: 'A', mentionCount: 1, properties: { level: 'L2' }, provenance: { engine: 'constellation-engine' } },
        { id: 'native-b', canonicalId: 'native-b', label: 'B', mentionCount: 1, properties: { level: 'L1' } },
      ],
      [
        { id: 'native-edge-1', source: 'native-a', target: 'native-b', predicate: 'associative', mentionCount: 1 },
        { id: 'native-edge-2', source: 'native-a', target: 'native-b', predicate: 'supports', mentionCount: 1 },
      ],
    );

    expect(synchronizeProjectionGraph(graph, first)).toEqual({
      renderedNodes: 2,
      renderedEdges: 2,
      filteredEdges: 0,
      becamePopulated: true,
    });
    expect(graph.edges()).toEqual(expect.arrayContaining(['native-edge-1', 'native-edge-2']));
    expect(graph.getNodeAttribute('native-a', 'nativeId')).toBe('native-a');
    expect(graph.getNodeAttribute('native-a', 'provenance')).toEqual({ engine: 'constellation-engine' });
    graph.setNodeAttribute('native-a', 'x', 42);
    graph.setNodeAttribute('native-a', 'y', -17);

    const refreshed = projection(
      [
        { id: 'native-a', canonicalId: 'native-a', label: 'A updated', mentionCount: 2, properties: { level: 'L2' } },
        { id: 'native-c', canonicalId: 'native-c', label: 'C', mentionCount: 1, properties: { level: 'L0' } },
      ],
      [{ id: 'native-edge-3', source: 'native-a', target: 'native-c', predicate: 'associative', mentionCount: 1 }],
    );

    expect(synchronizeProjectionGraph(graph, refreshed)).toEqual({
      renderedNodes: 2,
      renderedEdges: 1,
      filteredEdges: 0,
      becamePopulated: false,
    });
    expect(graph.hasNode('native-b')).toBe(false);
    expect(graph.hasNode('native-c')).toBe(true);
    expect(graph.edges()).toEqual(['native-edge-3']);
    expect(graph.getNodeAttribute('native-a', 'x')).toBe(42);
    expect(graph.getNodeAttribute('native-a', 'y')).toBe(-17);
    expect(graph.getNodeAttribute('native-a', 'label')).toBe('A updated');
  });

  it('renders an honest empty graph and reports edges whose native endpoints are outside the bounded projection', () => {
    const graph = new MultiDirectedGraph();
    synchronizeProjectionGraph(
      graph,
      projection(
        [{ id: 'native-a', label: 'A', mentionCount: 1 }],
        [{ id: 'outside-edge', source: 'native-a', target: 'not-projected', predicate: 'associative', mentionCount: 1 }],
      ),
    );
    expect(graph.order).toBe(1);
    expect(graph.size).toBe(0);
    expect(synchronizeProjectionGraph(graph, projection([], []))).toEqual({
      renderedNodes: 0,
      renderedEdges: 0,
      filteredEdges: 0,
      becamePopulated: false,
    });
  });

  it('fails honestly on duplicate transport identities instead of fabricating replacements', () => {
    const graph = new MultiDirectedGraph();
    expect(() => synchronizeProjectionGraph(
      graph,
      projection(
        [
          { id: 'native-a', label: 'A', mentionCount: 1 },
          { id: 'native-a', label: 'Duplicate A', mentionCount: 1 },
        ],
        [],
      ),
    )).toThrow('duplicate_projection_node_id:native-a');
  });
});
