import { describe, expect, it } from 'vitest';

import type { GraphProjectionV1 } from './NativeAuthorityGraphSurface';
import {
  applyJevGraphPhysics,
  JEV_GRAPH_PHYSICS_PROFILES,
  mapJevGraphPhysics,
} from './jevGraphPhysics';

function projection(): GraphProjectionV1 {
  const nodes = ['a', 'b', 'c', 'old'].map(id => ({ id, label: id, properties: {} }));
  const edges = [
    {
      id: 'ab', source: 'a', target: 'b', predicate: 'PROVIDES',
      relationship_strength: 0.01,
      properties: {
        relationship_strength: 0.01,
        jev: {
          winner: 'PROVIDES',
          distribution: { PROVIDES: 0.8, ASSOCIATED_WITH: 0.2 },
          vocabulary_version: 'jev.semantic-relationships.v1',
        },
      },
    },
    {
      id: 'cb', source: 'c', target: 'b', predicate: 'SUPPORTS',
      properties: {
        jev: {
          status: 'success',
          winner: 'SUPPORTS',
          distribution: { SUPPORTS: 0.6, ASSOCIATED_WITH: 0.4 },
          vocabulary_version: 'jev.semantic-relationships.v1',
        },
      },
    },
    {
      id: 'ordinary', source: 'a', target: 'c', predicate: 'NATIVE_RELATION',
      relationship_strength: 0.42, label_confidence: 0.43, strength: 0.44,
      spring_strength: 0.045, rest_length: 31, visual_width: 1.7,
      properties: { relationship_strength: 0.42, native_field: 'preserved' },
    },
    {
      id: 'malformed', source: 'c', target: 'a', predicate: 'SUPPORTS',
      relationship_strength: 0.52, label_confidence: 0.53, strength: 0.54,
      spring_strength: 0.055, rest_length: 29, visual_width: 1.9,
      properties: {
        native_field: 'preserved',
        jev: {
          status: 'success', winner: 'SUPPORTS',
          distribution: { SUPPORTS: '0.7', ASSOCIATED_WITH: 0.3 },
        },
      },
    },
    {
      id: 'old-b', source: 'old', target: 'b', predicate: 'COMPETES_WITH',
      relationship_strength: 0.99, label_confidence: 0.98, strength: 0.97,
      spring_strength: 0.2, rest_length: 12, visual_width: 3.4,
      properties: {
        temporalStatus: 'superseded',
        jev: {
          status: 'success',
          winner: 'COMPETES_WITH',
          distribution: { COMPETES_WITH: 0.99, ASSOCIATED_WITH: 0.01 },
          vocabulary_version: 'jev.semantic-relationships.v1',
        },
      },
    },
  ];
  return {
    schemaVersion: 'test.v1', projectId: 'project-1', nodes, edges,
    scene: {
      nodes: nodes.map(node => ({ ...node })),
      edges: edges.map(edge => ({
        ...edge,
        relation: edge.predicate,
        ...('jev' in edge.properties ? { jev: edge.properties.jev } : {}),
      })),
      meta: { layout_seed: 7 },
    },
  };
}

describe('Jev graph physics transfer profiles', () => {
  it.each(JEV_GRAPH_PHYSICS_PROFILES)(
    '%s keeps weak edges visible and maps higher probability monotonically',
    profile => {
      const weak = mapJevGraphPhysics(profile, 0.2, 0.2);
      const strong = mapJevGraphPhysics(profile, 0.9, 1.4);
      expect(weak.edgeWidth).toBeGreaterThan(0);
      expect(strong.edgeWidth).toBeGreaterThan(weak.edgeWidth);
      expect(strong.springStrength).toBeGreaterThan(weak.springStrength);
      expect(strong.preferredDistance).toBeLessThan(weak.preferredDistance);
      expect(strong.nodeRadius).toBeGreaterThan(weak.nodeRadius);
    },
  );

  it('uses P(winner) only for valid live Jev edges and preserves every other edge byte-for-byte', () => {
    const source = projection();
    const snapshot = structuredClone(source);
    const untouchedProjectionEdges = source.edges.slice(2);
    const untouchedSceneEdges = source.scene!.edges.slice(2);
    const result = applyJevGraphPhysics(source, 'balanced');

    expect(source).toEqual(snapshot);
    expect(result.edges[0]).toMatchObject({
      relationship_strength: 0.8,
      label_confidence: 0.8,
      strength: 0.8,
      visual_width: 2.25,
      spring_strength: 0.171,
      rest_length: 16.4,
    });
    expect(result.nodes.find(node => node.id === 'a')?.semantic_mass).toBeCloseTo(0.8);
    expect(result.nodes.find(node => node.id === 'b')?.semantic_mass).toBeCloseTo(1.4);
    expect(result.nodes.find(node => node.id === 'c')?.semantic_mass).toBeCloseTo(0.6);
    expect(result.nodes.find(node => node.id === 'old')?.semantic_mass).toBe(0);
    expect(result.edges.slice(2)).toEqual(snapshot.edges.slice(2));
    expect(result.edges.slice(2)).toEqual(untouchedProjectionEdges);
    result.edges.slice(2).forEach((edge, index) => {
      expect(edge).toBe(untouchedProjectionEdges[index]);
    });
    expect(result.scene?.nodes.find(node => node.id === 'b')?.semantic_mass).toBeCloseTo(1.4);
    expect(result.scene?.edges.slice(2)).toEqual(snapshot.scene?.edges.slice(2));
    result.scene?.edges.slice(2).forEach((edge, index) => {
      expect(edge).toBe(untouchedSceneEdges[index]);
    });
    expect(result.scene?.meta).toEqual({ layout_seed: 7 });
  });

  it('changes only transient transfer fields when the profile changes', () => {
    const source = projection();
    const balanced = applyJevGraphPhysics(source, 'balanced');
    const open = applyJevGraphPhysics(source, 'open');

    expect(open.edges[0].visual_width).not.toBe(balanced.edges[0].visual_width);
    expect(open.edges[0].spring_strength).not.toBe(balanced.edges[0].spring_strength);
    expect(open.edges[0].rest_length).not.toBe(balanced.edges[0].rest_length);
    expect(open.nodes[1].visual_radius).not.toBe(balanced.nodes[1].visual_radius);
    expect(open.nodes.map(node => [node.id, node.label])).toEqual(
      balanced.nodes.map(node => [node.id, node.label]),
    );
    expect(open.edges.map(edge => [
      edge.id, edge.source, edge.target, edge.predicate, edge.properties?.jev,
    ])).toEqual(balanced.edges.map(edge => [
      edge.id, edge.source, edge.target, edge.predicate, edge.properties?.jev,
    ]));
    expect(source.edges[0].relationship_strength).toBe(0.01);
  });
});
