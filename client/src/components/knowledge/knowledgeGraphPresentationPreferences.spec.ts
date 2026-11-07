// @vitest-environment jsdom

/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: Project Knowledge Graph
 * Relationship: This file verifies authority-scoped saved presentation and material fields without mutating provider records.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_SOLARPUNK_COLORS } from './knowledgeGraphProjection';
import {
  presentationStorageKey,
  safePresentationPreferences,
  solarpunkEdgeFields,
  withoutSolarpunkEdgeMaterial,
  withoutSolarpunkMaterial,
} from './knowledgeGraphPresentationPreferences';

afterEach(() => window.localStorage.clear());

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

  it('reads only valid layout, Jev profile, and force settings from the requested authority', () => {
    window.localStorage.setItem(presentationStorageKey('thinkgraph'), JSON.stringify({
      schemaVersion: 6,
      layout: 'radial',
      style: 'classic',
      physicsProfile: 'open',
      settings: {
        repel: 80, link: 44, gravity: 20, linkw: 0.6,
        size: 3, labels: false, unknown: 12,
      },
    }));
    window.localStorage.setItem(presentationStorageKey('knowgraph'), JSON.stringify({
      schemaVersion: 6, layout: 'galaxy', physicsProfile: 'contrast',
    }));

    expect(safePresentationPreferences('thinkgraph')).toEqual({
      schemaVersion: 6,
      layout: 'radial',
      style: 'classic',
      physicsProfile: 'open',
      settings: { repel: 80, link: 44, gravity: 20, linkw: 0.6, size: 3, labels: false },
    });
    expect(safePresentationPreferences('joined')).toEqual({});
    expect(safePresentationPreferences('knowgraph')).toEqual({
      schemaVersion: 6,
      layout: 'galaxy',
      physicsProfile: 'contrast',
    });
  });

});
