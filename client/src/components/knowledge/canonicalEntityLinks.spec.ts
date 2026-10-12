import { describe, expect, it } from 'vitest';

import type {
  GraphProjectionV1,
  JoinedGraphPresentation,
} from './joinedKnowledgeGraphProjection';
import {
  readCanonicalEntityProviderPointers,
  type CanonicalEntityHeader,
} from './canonicalEntityDirectory';
import {
  createCanonicalEntityMatcher,
  resolveCanonicalEntityFocusVisualId,
} from './canonicalEntityLinks';

function projections({
  projectId = 'project-1',
  knowProjectId = projectId,
  entities = [
    {
      authority: 'both' as const,
      canonicalName: 'Rocket Lab',
      engraphisEntityId: 'think-rocket',
      graphitiEntityId: 'know-rocket',
    },
    {
      authority: 'thinkgraph' as const,
      canonicalName: 'Rocket',
      engraphisEntityId: 'think-rocket-name',
    },
    {
      authority: 'knowgraph' as const,
      canonicalName: 'Electron',
      graphitiEntityId: 'know-electron',
    },
  ],
  nodes,
}: {
  projectId?: string;
  knowProjectId?: string;
  entities?: CanonicalEntityHeader[];
  nodes?: Partial<Record<'thinkgraph' | 'knowgraph', GraphProjectionV1['nodes']>>;
} = {}) {
  const makeNodes = (authority: 'thinkgraph' | 'knowgraph') => entities.flatMap(entity => {
    const pointer = readCanonicalEntityProviderPointers(entity)?.find(
      candidate => candidate.authority === authority,
    );
    return pointer ? [{
      id: pointer.entityId,
      label: entity.canonicalName,
      canonicalName: entity.canonicalName,
      projectId: authority === 'thinkgraph' ? projectId : knowProjectId,
    }] : [];
  });
  const directory = {
    schemaVersion: 'graph-entity-directory' as const,
    projectId,
    complete: true as const,
    counts: {
      engraphis: entities.filter(entity => (
        entity.authority === 'thinkgraph' || entity.authority === 'both'
      )).length,
      graphiti: entities.filter(entity => (
        entity.authority === 'knowgraph' || entity.authority === 'both'
      )).length,
      total: entities.length,
    },
    revisions: { engraphis: 'think-r1', graphiti: 'know-r1' },
    entities,
    sha256: 'a'.repeat(64),
    bytes: 512,
    estimatedTokens: 128,
    readDurationMs: 1.25,
  };
  return {
    thinkgraph: {
      schemaVersion: 'thinkgraph.engraphis.v1', projectId,
      nodes: nodes?.thinkgraph || makeNodes('thinkgraph'), edges: [],
      canonicalEntityDirectory: directory,
    },
    knowgraph: {
      schemaVersion: 'knowgraph.graphiti.v1', projectId: knowProjectId,
      nodes: nodes?.knowgraph || makeNodes('knowgraph'), edges: [],
    },
  } satisfies Record<'thinkgraph' | 'knowgraph', GraphProjectionV1>;
}

function linkedNames(
  value: ReturnType<NonNullable<ReturnType<typeof createCanonicalEntityMatcher>>['segmentMessage']>,
) {
  return value.filter(segment => segment.target).map(segment => segment.text);
}

describe('canonical Entity chat links', () => {
  it('matches exact case-sensitive names and carries paired provider evidence without displaying ids', () => {
    const matcher = createCanonicalEntityMatcher(projections())!;
    const segments = matcher.segmentMessage('assistant', 'Rocket Lab builds Electron.');
    expect(linkedNames(segments)).toEqual(['Rocket Lab', 'Electron']);
    expect(segments.find(segment => segment.text === 'Rocket Lab')?.target).toMatchObject({
      canonicalName: 'Rocket Lab', view: 'all', projectId: 'project-1',
      members: [
        { authority: 'thinkgraph', entityId: 'think-rocket' },
        { authority: 'knowgraph', entityId: 'know-rocket' },
      ],
    });
    expect(matcher.segmentMessage('assistant', 'rocket lab and RocketLab').some(
      segment => segment.target,
    )).toBe(false);
  });

  it('chooses the longest nonoverlapping exact canonical name', () => {
    const matcher = createCanonicalEntityMatcher(projections())!;
    expect(linkedNames(matcher.segmentMessage('assistant', 'Rocket Lab and Rocket.')))
      .toEqual(['Rocket Lab', 'Rocket']);
  });

  it('rejects duplicate canonical names instead of guessing an identity', () => {
    const matcher = createCanonicalEntityMatcher(projections({
      entities: [
        { authority: 'thinkgraph', canonicalName: 'Shared', engraphisEntityId: 'think-a' },
        { authority: 'thinkgraph', canonicalName: 'Shared', engraphisEntityId: 'think-b' },
      ],
    }));
    expect(matcher).toBeNull();
  });

  it('leaves stale directory names plain when the current provider node no longer byte-matches', () => {
    const current = projections();
    current.thinkgraph.nodes[0] = { ...current.thinkgraph.nodes[0], label: 'Rocket lab' };
    const matcher = createCanonicalEntityMatcher(current)!;
    expect(linkedNames(matcher.segmentMessage('assistant', 'Rocket Lab'))).toEqual([]);
  });

  it('does not link an exact name when its hidden provider id no longer finds that node', () => {
    const current = projections();
    const directory = current.thinkgraph.canonicalEntityDirectory!;
    directory.entities[0] = {
      authority: 'both',
      engraphisEntityId: 'stale-think-rocket',
      graphitiEntityId: 'know-rocket',
      canonicalName: 'Rocket Lab',
    };

    const matcher = createCanonicalEntityMatcher(current)!;
    expect(linkedNames(matcher.segmentMessage('assistant', 'Rocket Lab builds Electron.')))
      .toEqual(['Electron']);
  });

  it.each([
    {
      authority: 'thinkgraph',
      engraphisEntityId: 'think-invalid', graphitiEntityId: 'know-invalid',
      canonicalName: 'Invalid',
    },
    { authority: 'thinkgraph', canonicalName: 'Invalid' },
  ])('fails closed for an authority/identity mismatch', malformed => {
    const current = projections();
    current.thinkgraph.canonicalEntityDirectory = {
      ...current.thinkgraph.canonicalEntityDirectory!,
      counts: { engraphis: 1, graphiti: 0, total: 1 },
      entities: [malformed as unknown as CanonicalEntityHeader],
    };
    expect(createCanonicalEntityMatcher(current)).toBeNull();
  });

  it('returns raw text segments so React escapes labels without HTML rewriting', () => {
    const current = projections({
      entities: [{
        authority: 'thinkgraph',
        engraphisEntityId: 'think-html',
        canonicalName: 'A <B> & C',
      }],
    });
    const matcher = createCanonicalEntityMatcher(current)!;
    const text = 'About A <B> & C today.';
    const segments = matcher.segmentMessage('assistant', text);
    expect(segments.map(segment => segment.text).join('')).toBe(text);
    expect(linkedNames(segments)).toEqual(['A <B> & C']);
  });

  it('does not link inside URLs, Markdown citations, inline code, or fenced code', () => {
    const matcher = createCanonicalEntityMatcher(projections())!;
    const text = [
      'Rocket Lab https://example.test/Rocket%20Lab [Rocket Lab](https://example.test)',
      '`Rocket Lab`',
      '```',
      'Rocket Lab',
      '```',
      '【Rocket Lab】',
    ].join('\n');
    expect(linkedNames(matcher.segmentMessage('assistant', text))).toEqual(['Rocket Lab']);
  });

  it('fails closed across Projects', () => {
    expect(createCanonicalEntityMatcher(projections({ knowProjectId: 'project-2' }))).toBeNull();
  });

  it('never links user messages and preserves every source byte', () => {
    const matcher = createCanonicalEntityMatcher(projections())!;
    const text = 'Rocket Lab\r\nElectron';
    expect(matcher.segmentMessage('user', text)).toEqual([{ text }]);
  });

  it('resolves current single and paired targets and refuses a stale directory receipt', () => {
    const current = projections();
    const matcher = createCanonicalEntityMatcher(current)!;
    const rocket = matcher.segmentMessage('assistant', 'Rocket Lab')[0].target!;
    const electron = matcher.segmentMessage('assistant', 'Electron')[0].target!;
    const visualId = 'node-name:Rocket%20Lab';
    const electronVisualId = 'knowgraph:know-electron';
    const joinedPresentation: JoinedGraphPresentation = {
      projection: {
        schemaVersion: 'joined.v1', projectId: 'project-1',
        nodes: [
          { id: visualId, label: 'Rocket Lab' },
          { id: electronVisualId, label: 'Electron' },
        ], edges: [],
      },
      providerProjections: current,
      nodeVariants: new Map([
        [visualId, [
          { authority: 'thinkgraph', node: current.thinkgraph.nodes[0] },
          { authority: 'knowgraph', node: current.knowgraph.nodes[0] },
        ]],
        [electronVisualId, [{ authority: 'knowgraph', node: current.knowgraph.nodes[1] }]],
      ]),
      edgeVariants: new Map(),
      visualNodeIdByProviderMember: new Map([
        ['thinkgraph:think-rocket', visualId],
        ['knowgraph:know-rocket', visualId],
        ['knowgraph:know-electron', electronVisualId],
      ]),
    };
    const directory = current.thinkgraph.canonicalEntityDirectory!;
    expect(resolveCanonicalEntityFocusVisualId({
      projection: joinedPresentation.projection,
      joinedPresentation,
      directory,
      request: { ...rocket, requestId: 1 },
    })).toBe(visualId);
    expect(resolveCanonicalEntityFocusVisualId({
      projection: joinedPresentation.projection,
      joinedPresentation,
      directory,
      request: { ...electron, requestId: 2 },
    })).toBe(electronVisualId);
    expect(resolveCanonicalEntityFocusVisualId({
      projection: joinedPresentation.projection,
      joinedPresentation,
      directory,
      request: { ...rocket, directorySha256: 'b'.repeat(64), requestId: 3 },
    })).toBeNull();
    expect(resolveCanonicalEntityFocusVisualId({
      projection: joinedPresentation.projection,
      joinedPresentation,
      directory: {
        ...directory,
        counts: { engraphis: 1, graphiti: 0, total: 1 },
        entities: [{
          authority: 'thinkgraph',
          engraphisEntityId: 'think-invalid', graphitiEntityId: 'know-invalid',
          canonicalName: 'Rocket Lab',
        } as unknown as CanonicalEntityHeader],
      },
      request: { ...rocket, requestId: 4 },
    })).toBeNull();
  });
});
