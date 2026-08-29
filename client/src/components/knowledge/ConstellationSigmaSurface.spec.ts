import { MultiDirectedGraph } from 'graphology';
import { describe, expect, it } from 'vitest';

import type { GraphProjectionV1 } from './NativeAuthorityGraphSurface';
import { synchronizeProjectionGraph } from './constellationSigmaGraph';

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
