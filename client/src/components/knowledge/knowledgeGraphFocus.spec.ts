/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: Jev Decisions
 * Relationship: This file verifies bounded Jev Focus responses select only declared provider candidates and reject stale or malformed distributions.
 * Entity: Project Knowledge Graph
 * Relationship: This file verifies manual, expanded, and release focus views reuse only existing real graph nodes and edges without mutating the source projection.
 */

import { describe, expect, it } from 'vitest';

import {
  composeExpandedFocusPresentation,
  composeFocusReleasePresentation,
  composeManualFocusPresentation,
  parseJevFocusDecision,
  type ManualFocusEntry,
} from './knowledgeGraphFocus';
import type { GraphProjectionV1 } from './knowledgeGraphProjection';

const projection = (): GraphProjectionV1 => ({
  schemaVersion: 'think-know.presentation.v1',
  authority: 'joined',
  projectId: 'project-one',
  revision: 'think-one:know-one',
  nodes: [
    { id: 'center', label: 'Center', properties: {} },
    { id: 'think-neighbor', label: 'Think neighbor', properties: {} },
    { id: 'know-neighbor', label: 'Know neighbor', properties: {} },
  ],
  edges: [
    {
      id: 'think-edge', source: 'center', target: 'think-neighbor',
      predicate: 'SUPPORTS', properties: {},
    },
    {
      id: 'know-edge', source: 'know-neighbor', target: 'center',
      predicate: 'CHALLENGES', properties: {},
    },
  ],
});

const focusEntry = (): ManualFocusEntry => ({
  centerId: 'center',
  centerTitle: 'Center',
  status: 'success',
  requestIdentity: 1,
  projectionKey: 'think-one:know-one',
  readWarning: null,
  presentation: {} as ManualFocusEntry['presentation'],
  decision: {
    status: 'success',
    errorCode: null,
    candidates: [
      {
        visualId: 'think-neighbor', authority: 'ThinkGraph', entityId: 'think-one',
        title: 'Think neighbor', description: null, incidentRelationships: [{
          edgeId: 'think-edge', relationshipId: 'provider-think-edge',
          sourceVisualId: 'center', sourceId: 'center-think', sourceTitle: 'Center',
          targetVisualId: 'think-neighbor', targetId: 'think-one', targetTitle: 'Think neighbor',
          predicate: 'SUPPORTS', direction: 'outgoing', relationshipWeight: 0.7,
        }],
        choiceId: 'choice-think', probability: 0.7, selected: true, rank: 1,
      },
      {
        visualId: 'know-neighbor', authority: 'KnowGraph', entityId: 'know-one',
        title: 'Know neighbor', description: null, incidentRelationships: [{
          edgeId: 'know-edge', relationshipId: 'provider-know-edge',
          sourceVisualId: 'know-neighbor', sourceId: 'know-one', sourceTitle: 'Know neighbor',
          targetVisualId: 'center', targetId: 'center-know', targetTitle: 'Center',
          predicate: 'CHALLENGES', direction: 'incoming', relationshipWeight: 0.3,
        }],
        choiceId: 'choice-know', probability: 0.3, selected: false, rank: 2,
      },
    ],
  },
});

describe('Jev Focus contracts', () => {
  it('accepts only an exact decision over the declared provider candidates', () => {
    const expected = focusEntry().decision!.candidates.map((candidate) => ({
      visualId: candidate.visualId,
      authority: candidate.authority,
      entityId: candidate.entityId,
      title: candidate.title,
      description: candidate.description,
      incidentRelationships: candidate.incidentRelationships,
    }));
    const response = {
      schemaVersion: 'jev-focus.v1',
      sourceRevision: 'think-one:know-one',
      status: 'success',
      decisionId: 'decision-one',
      candidates: focusEntry().decision!.candidates.map(candidate => ({
        authority: candidate.authority,
        entityId: candidate.entityId,
        choiceId: candidate.choiceId,
        probability: candidate.probability,
        selected: true,
        rank: candidate.rank,
      })),
      distribution: { 'choice-think': 0.7, 'choice-know': 0.3 },
    };

    const parsed = parseJevFocusDecision(
      response,
      expected,
      'think-one:know-one',
    );

    expect(parsed.status).toBe('success');
    expect(parsed.candidates.map(candidate => [
      candidate.entityId, candidate.probability, candidate.selected,
    ])).toEqual([
      ['think-one', 0.7, true],
      ['know-one', 0.3, true],
    ]);
    expect(() => parseJevFocusDecision(
      { ...response, sourceRevision: 'stale' },
      expected,
      'think-one:know-one',
    )).toThrow('jev_focus_response_invalid');
  });

  it('projects only the center and selected real neighbor without mutating the source', () => {
    const source = projection();
    const before = structuredClone(source);

    const focused = composeManualFocusPresentation(source, focusEntry());
    const expanded = composeExpandedFocusPresentation(source, focusEntry());

    expect(focused.nodeIds).toEqual(['center', 'think-neighbor']);
    expect(focused.edgeIds).toEqual(['think-edge']);
    expect(focused.projection.nodes.map(node => node.id)).toEqual([
      'center', 'think-neighbor',
    ]);
    expect(focused.projection.edges.map(edge => edge.id)).toEqual(['think-edge']);
    expect(expanded?.nodes.map(node => node.id)).toEqual(['center', 'think-neighbor']);
    expect(source).toEqual(before);
  });

  it('marks only the released nodes and edges as transient presentation state', () => {
    const source = projection();
    const released = composeFocusReleasePresentation(source, {
      nodeIds: ['center', 'think-neighbor'],
      edgeIds: ['think-edge'],
    });

    expect(released.nodes.find(node => node.id === 'center')?.material_focus_active)
      .toBe(true);
    expect(released.nodes.find(node => node.id === 'know-neighbor')?.material_focus_active)
      .toBeUndefined();
    expect(released.edges.find(edge => edge.id === 'think-edge')?.properties?.focusRelease)
      .toBe(true);
    expect(released.edges.find(edge => edge.id === 'know-edge')?.properties?.focusRelease)
      .toBeUndefined();
    expect(source.nodes.every(node => node.material_focus_active === undefined)).toBe(true);
  });
});
