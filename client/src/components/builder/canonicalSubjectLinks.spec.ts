import { describe, expect, it } from 'vitest';

import type {
  CanonicalSubjectHeader,
  GraphProjectionV1,
  JoinedGraphPresentation,
} from '../knowledge/KnowledgeAuthorityGraphSurface';
import {
  createCanonicalSubjectMatcher,
  resolveCanonicalSubjectFocusVisualId,
} from './canonicalSubjectLinks';

function projections({
  projectId = 'project-1',
  knowProjectId = projectId,
  subjects = [
    { engraphisEntityId: 'think-rocket', canonicalName: 'Rocket Lab', entityKind: 'person_or_concept' },
    { graphitiEntityId: 'know-rocket', canonicalName: 'Rocket Lab', entityKind: 'Organization' },
    { engraphisEntityId: 'think-rocket-name', canonicalName: 'Rocket', entityKind: 'person_or_concept' },
    { graphitiEntityId: 'know-electron', canonicalName: 'Electron', entityKind: 'Product' },
  ],
  nodes,
}: {
  projectId?: string;
  knowProjectId?: string;
  subjects?: Array<Record<string, string>>;
  nodes?: Partial<Record<'thinkgraph' | 'knowgraph', GraphProjectionV1['nodes']>>;
} = {}) {
  const headers = subjects as unknown as CanonicalSubjectHeader[];
  const lookup = (subject: Record<string, string>) => {
    const hasEngraphis = Object.prototype.hasOwnProperty.call(subject, 'engraphisEntityId');
    const hasGraphiti = Object.prototype.hasOwnProperty.call(subject, 'graphitiEntityId');
    if (hasEngraphis === hasGraphiti) return null;
    return hasEngraphis
      ? { authority: 'thinkgraph' as const, entityId: subject.engraphisEntityId }
      : { authority: 'knowgraph' as const, entityId: subject.graphitiEntityId };
  };
  const makeNodes = (authority: 'thinkgraph' | 'knowgraph') => subjects
    .flatMap(subject => {
      const identity = lookup(subject);
      return identity?.authority === authority ? [{ subject, identity }] : [];
    })
    .map(({ subject, identity }) => ({
      id: identity.entityId,
      label: subject.canonicalName,
      canonicalName: subject.canonicalName,
      entityKind: subject.entityKind,
      projectId: authority === 'thinkgraph' ? projectId : knowProjectId,
    }));
  const directory = {
    schemaVersion: 'graph-subject-directory' as const,
    projectId,
    complete: true as const,
    counts: {
      engraphis: subjects.filter(subject => lookup(subject)?.authority === 'thinkgraph').length,
      graphiti: subjects.filter(subject => lookup(subject)?.authority === 'knowgraph').length,
      total: headers.length,
    },
    revisions: { engraphis: 'think-r1', graphiti: 'know-r1' },
    subjects: headers,
    sha256: 'a'.repeat(64),
    bytes: 512,
    estimatedTokens: 128,
    readDurationMs: 1.25,
  };
  return {
    thinkgraph: {
      schemaVersion: 'thinkgraph.engraphis.v1', projectId,
      nodes: nodes?.thinkgraph || makeNodes('thinkgraph'), edges: [],
      canonicalSubjectDirectory: directory,
    },
    knowgraph: {
      schemaVersion: 'knowgraph.graphiti.v1', projectId: knowProjectId,
      nodes: nodes?.knowgraph || makeNodes('knowgraph'), edges: [],
    },
  } satisfies Record<'thinkgraph' | 'knowgraph', GraphProjectionV1>;
}

function linkedNames(value: ReturnType<NonNullable<ReturnType<typeof createCanonicalSubjectMatcher>>['segmentMessage']>) {
  return value.filter(segment => segment.target).map(segment => segment.text);
}

describe('canonical subject chat links', () => {
  it('matches exact case-sensitive names and carries paired provider evidence without displaying ids', () => {
    const matcher = createCanonicalSubjectMatcher(projections())!;
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
    const matcher = createCanonicalSubjectMatcher(projections())!;
    expect(linkedNames(matcher.segmentMessage('assistant', 'Rocket Lab and Rocket.')))
      .toEqual(['Rocket Lab', 'Rocket']);
  });

  it('leaves an authority-ambiguous canonical name plain', () => {
    const matcher = createCanonicalSubjectMatcher(projections({
      subjects: [
        { engraphisEntityId: 'think-a', canonicalName: 'Shared', entityKind: 'person_or_concept' },
        { engraphisEntityId: 'think-b', canonicalName: 'Shared', entityKind: 'person_or_concept' },
      ],
    }));
    expect(matcher).toBeNull();
  });

  it('leaves stale directory names plain when the current provider node no longer byte-matches', () => {
    const current = projections();
    current.thinkgraph.nodes[0] = { ...current.thinkgraph.nodes[0], label: 'Rocket lab' };
    const matcher = createCanonicalSubjectMatcher(current)!;
    expect(linkedNames(matcher.segmentMessage('assistant', 'Rocket Lab'))).toEqual([]);
  });

  it('does not link an exact name when its hidden provider id no longer finds that node', () => {
    const current = projections();
    const directory = current.thinkgraph.canonicalSubjectDirectory!;
    directory.subjects[0] = {
      engraphisEntityId: 'stale-think-rocket',
      canonicalName: 'Rocket Lab',
      entityKind: 'person_or_concept',
    };

    const matcher = createCanonicalSubjectMatcher(current)!;
    expect(linkedNames(matcher.segmentMessage('assistant', 'Rocket Lab builds Electron.')))
      .toEqual(['Electron']);
  });

  it.each([
    {
      engraphisEntityId: 'think-invalid', graphitiEntityId: 'know-invalid',
      canonicalName: 'Invalid', entityKind: 'person_or_concept',
    },
    { canonicalName: 'Invalid', entityKind: 'person_or_concept' },
  ])('fails closed for a dual or missing provider-id row', malformed => {
    const current = projections();
    current.thinkgraph.canonicalSubjectDirectory = {
      ...current.thinkgraph.canonicalSubjectDirectory!,
      counts: { engraphis: 1, graphiti: 0, total: 1 },
      subjects: [malformed as unknown as CanonicalSubjectHeader],
    };
    expect(createCanonicalSubjectMatcher(current)).toBeNull();
  });

  it('returns raw text segments so React escapes labels without HTML rewriting', () => {
    const current = projections({
      subjects: [{
        engraphisEntityId: 'think-html',
        canonicalName: 'A <B> & C',
        entityKind: 'person_or_concept',
      }],
    });
    const matcher = createCanonicalSubjectMatcher(current)!;
    const text = 'About A <B> & C today.';
    const segments = matcher.segmentMessage('assistant', text);
    expect(segments.map(segment => segment.text).join('')).toBe(text);
    expect(linkedNames(segments)).toEqual(['A <B> & C']);
  });

  it('does not link inside URLs, Markdown citations, inline code, or fenced code', () => {
    const matcher = createCanonicalSubjectMatcher(projections())!;
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
    expect(createCanonicalSubjectMatcher(projections({ knowProjectId: 'project-2' }))).toBeNull();
  });

  it('never links user messages and preserves every source byte', () => {
    const matcher = createCanonicalSubjectMatcher(projections())!;
    const text = 'Rocket Lab\r\nElectron';
    const segments = matcher.segmentMessage('user', text);
    expect(segments).toEqual([{ text }]);
  });

  it('resolves current single and paired targets and refuses a stale directory receipt', () => {
    const current = projections();
    const matcher = createCanonicalSubjectMatcher(current)!;
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
        [electronVisualId, [
          { authority: 'knowgraph', node: current.knowgraph.nodes[1] },
        ]],
      ]),
      edgeVariants: new Map(),
      visualNodeIdByProviderMember: new Map([
        ['thinkgraph:think-rocket', visualId],
        ['knowgraph:know-rocket', visualId],
        ['knowgraph:know-electron', electronVisualId],
      ]),
    };
    const directory = current.thinkgraph.canonicalSubjectDirectory!;
    expect(resolveCanonicalSubjectFocusVisualId({
      projection: joinedPresentation.projection,
      joinedPresentation,
      directory,
      request: { ...rocket, requestId: 1 },
    })).toBe(visualId);
    expect(resolveCanonicalSubjectFocusVisualId({
      projection: joinedPresentation.projection,
      joinedPresentation,
      directory,
      request: { ...electron, requestId: 2 },
    })).toBe(electronVisualId);
    expect(resolveCanonicalSubjectFocusVisualId({
      projection: joinedPresentation.projection,
      joinedPresentation,
      directory,
      request: { ...rocket, directorySha256: 'b'.repeat(64), requestId: 3 },
    })).toBeNull();
    expect(resolveCanonicalSubjectFocusVisualId({
      projection: joinedPresentation.projection,
      joinedPresentation,
      directory: {
        ...directory,
        counts: { engraphis: 1, graphiti: 0, total: 1 },
        subjects: [{
          engraphisEntityId: 'think-invalid', graphitiEntityId: 'know-invalid',
          canonicalName: 'Rocket Lab', entityKind: 'person_or_concept',
        } as unknown as CanonicalSubjectHeader],
      },
      request: { ...rocket, requestId: 4 },
    })).toBeNull();
  });
});
