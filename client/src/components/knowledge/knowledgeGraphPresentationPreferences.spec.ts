// @vitest-environment jsdom

/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: Project Knowledge Graph
 * Relationship: This file verifies presentation material fields can change without mutating provider records.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_SOLARPUNK_COLORS } from './knowledgeGraphProjection';
import {
  solarpunkEdgeFields,
  withoutSolarpunkEdgeMaterial,
  withoutSolarpunkMaterial,
} from './knowledgeGraphPresentationPreferences';

describe('knowledge graph presentation preferences', () => {
  it('adds and removes presentation material without mutating provider records', () => {
    const node = {
      id: 'entity-one', label: 'Entity One', properties: {},
      material_kind: 'solarpunk' as const,
      material_role: 'THINK_MATERIAL' as const,
      material_blue: '#123456', material_orange: '#abcdef',
      material_surface: '#000000', material_think_active: true,
      material_know_active: false,
    };
    const edge = {
      id: 'edge-one', source: 'entity-one', target: 'entity-two',
      predicate: 'SUPPORTS', properties: {},
      ...solarpunkEdgeFields('thinkgraph', DEFAULT_SOLARPUNK_COLORS),
    };

    const cleanNode = withoutSolarpunkMaterial(node);
    const cleanEdge = withoutSolarpunkEdgeMaterial(edge);

    expect(cleanNode).toEqual({ id: 'entity-one', label: 'Entity One', properties: {} });
    expect(cleanEdge).toEqual({
      id: 'edge-one', source: 'entity-one', target: 'entity-two',
      predicate: 'SUPPORTS', properties: {},
    });
    expect(node.material_kind).toBe('solarpunk');
    expect(edge.material_kind).toBe('solarpunk');
  });
});
