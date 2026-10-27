// @vitest-environment jsdom

/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: Project Knowledge Graph
 * Relationship: This file verifies saved graph preferences remain authority-scoped, bounded, migration-safe, and presentation-only while material fields can change without mutating provider records.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_SOLARPUNK_COLORS } from './knowledgeGraphProjection';
import {
  presentationStorageKey,
  rendererStyle,
  safePresentationPreferences,
  solarpunkEdgeFields,
  withoutSolarpunkEdgeMaterial,
  withoutSolarpunkMaterial,
} from './knowledgeGraphPresentationPreferences';

afterEach(() => {
  window.localStorage.clear();
});

describe('knowledge graph presentation preferences', () => {
  it('loads only bounded values from the selected authority key', () => {
    window.localStorage.setItem(presentationStorageKey('joined'), JSON.stringify({
      schemaVersion: 6,
      layout: 'galaxy',
      style: 'solarpunk',
      physicsProfile: 'contrast',
      settings: {
        labels: false,
        size: 8,
        linkw: 1.5,
        gravity: 900,
        unknown: 42,
      },
      solarpunkColors: {
        think: '#123456',
        know: '#abcdef',
        thinkRelationship: '#654321',
        knowRelationship: '#fedcba',
      },
    }));

    expect(safePresentationPreferences('joined')).toEqual({
      schemaVersion: 6,
      layout: 'galaxy',
      style: 'solarpunk',
      physicsProfile: 'contrast',
      settings: { labels: false, size: 8, linkw: 1.5 },
      solarpunkColors: {
        think: '#123456',
        know: '#abcdef',
        thinkRelationship: '#654321',
        knowRelationship: '#fedcba',
      },
    });
    expect(safePresentationPreferences('thinkgraph')).toEqual({
      solarpunkColors: DEFAULT_SOLARPUNK_COLORS,
    });
  });

  it('migrates retired blue values and rejects malformed settings', () => {
    window.localStorage.setItem(presentationStorageKey('joined'), JSON.stringify({
      schemaVersion: 6,
      layout: 'invented',
      style: 'invented',
      physicsProfile: 'invented',
      settings: { size: 99, labels: 'yes' },
      solarpunkColors: {
        think: '#3979e8',
        know: 'orange',
        thinkRelationship: '#3979e8',
        knowRelationship: '#ffffff',
      },
    }));

    expect(safePresentationPreferences('joined')).toEqual({
      schemaVersion: 6,
      settings: {},
      solarpunkColors: {
        ...DEFAULT_SOLARPUNK_COLORS,
        knowRelationship: '#ffffff',
      },
    });
    expect(rendererStyle('solarpunk')).toBe('cyber');
  });

  it('adds and removes presentation material without mutating provider records', () => {
    const node = {
      id: 'entity-one', label: 'Entity One', properties: {},
      material_kind: 'solarpunk' as const,
      material_role: 'THINK_MATERIAL' as const,
      material_blue: '#123456', material_orange: '#abcdef',
      material_surface: '#000000', material_think_active: true,
      material_know_active: false, material_focus_active: true,
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
