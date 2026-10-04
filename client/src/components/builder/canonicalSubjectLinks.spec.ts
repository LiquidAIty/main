import { describe, expect, it } from 'vitest';

import type {
  GraphProjectionV1,
  JoinedGraphPresentation,
} from '../knowledge/NativeAuthorityGraphSurface';
import {
  createCanonicalSubjectMatcher,
  resolveCanonicalSubjectFocusVisualId,
} from './canonicalSubjectLinks';

function projections({
  projectId = 'project-1',
  knowProjectId = projectId,
  subjects = [
    ['ThinkGraph', 'think-rocket', 'Rocket Lab', 'person_or_concept'],
    ['KnowGraph', 'know-rocket', 'Rocket Lab', 'Organization'],
    ['ThinkGraph', 'think-rocket-name', 'Rocket', 'person_or_concept'],
    ['KnowGraph', 'know-electron', 'Electron', 'Product'],
  ],
  nodes,
}: {
  projectId?: string;
  knowProjectId?: string;
  subjects?: string[][];
  nodes?: Partial<Record<'thinkgraph' | 'knowgraph', GraphProjectionV1['nodes']>>;
} = {}) {
  const headers = subjects.map(([authority, nativeId, canonicalName, entityKind]) => ({
    authority: authority as 'ThinkGraph' | 'KnowGraph', nativeId, canonicalName, entityKind,
  }));
  const makeNodes = (authority: 'ThinkGraph' | 'KnowGraph') => headers
    .filter(subject => subject.authority === authority)
    .map(subject => ({
      id: subject.nativeId,
      label: subject.canonicalName,
      canonicalName: subject.canonicalName,
      entityKind: subject.entityKind,
      projectId: authority === 'ThinkGraph' ? projectId : knowProjectId,
    }));
  const directory = {
    schemaVersion: 'cross-graph-subject-directory.v1' as const,
    projectId,
    complete: true as const,
    counts: {
      ThinkGraph: headers.filter(subject => subject.authority === 'ThinkGraph').length,
      KnowGraph: headers.filter(subject => subject.authority === 'KnowGraph').length,
      total: headers.length,
    },
    revisions: { ThinkGraph: 'think-r1', KnowGraph: 'know-r1' },
    subjects: headers,
    sha256: 'a'.repeat(64),
  };
  return {
    thinkgraph: {
      schemaVersion: 'thinkgraph.engraphis.v1', projectId,
      nodes: nodes?.thinkgraph || makeNodes('ThinkGraph'), edges: [],
      canonicalSubjectDirectory: directory,
    },
    knowgraph: {
      schemaVersion: 'knowgraph.graphiti.v1', projectId: knowProjectId,
      nodes: nodes?.knowgraph || makeNodes('KnowGraph'), edges: [],
    },
  } satisfies Record<'thinkgraph' | 'knowgraph', GraphProjectionV1>;
}

function linkedNames(value: ReturnType<NonNullable<ReturnType<typeof createCanonicalSubjectMatcher>>['segmentMessage']>) {
  return value.filter(segment => segment.target).map(segment => segment.text);
}

describe('canonical subject chat links', () => {
  it('matches exact case-sensitive names and carries paired native evidence without displaying ids', () => {
    const matcher = createCanonicalSubjectMatcher(projections())!;
    const segments = matcher.segmentMessage('assistant', 'Rocket Lab builds Electron.');
    expect(linkedNames(segments)).toEqual(['Rocket Lab', 'Electron']);
    expect(segments.find(segment => segment.text === 'Rocket Lab')?.target).toMatchObject({
      canonicalName: 'Rocket Lab', view: 'all', projectId: 'project-1',
      members: [
        { authority: 'thinkgraph', nativeId: 'think-rocket' },
        { authority: 'knowgraph', nativeId: 'know-rocket' },
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
        ['ThinkGraph', 'think-a', 'Shared', 'person_or_concept'],
        ['ThinkGraph', 'think-b', 'Shared', 'person_or_concept'],
      ],
    }));
    expect(matcher).toBeNull();
  });

  it('leaves stale directory names plain when the current native node no longer byte-matches', () => {
    const current = projections();
    current.thinkgraph.nodes[0] = { ...current.thinkgraph.nodes[0], label: 'Rocket lab' };
    const matcher = createCanonicalSubjectMatcher(current)!;
    expect(linkedNames(matcher.segmentMessage('assistant', 'Rocket Lab'))).toEqual([]);
  });

  it('returns raw text segments so React escapes labels without HTML rewriting', () => {
    const current = projections({
      subjects: [['ThinkGraph', 'think-html', 'A <B> & C', 'person_or_concept']],
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
      nativeProjections: current,
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
      visualNodeIdByNativeMember: new Map([
        ['thinkgraph:think-rocket', visualId],
        ['knowgraph:know-rocket', visualId],
        ['knowgraph:know-electron', electronVisualId],
      ]),
    };
    const directory = current.thinkgraph.canonicalSubjectDirectory!;
    expect(resolveCanonicalSubjectFocusVisualId({
      authority: 'joined',
      projection: joinedPresentation.projection,
      joinedPresentation,
      directory,
      request: { ...rocket, requestId: 1 },
    })).toBe(visualId);
    expect(resolveCanonicalSubjectFocusVisualId({
      authority: 'joined',
      projection: joinedPresentation.projection,
      joinedPresentation,
      directory,
      request: { ...electron, requestId: 2 },
    })).toBe(electronVisualId);
    expect(resolveCanonicalSubjectFocusVisualId({
      authority: 'joined',
      projection: joinedPresentation.projection,
      joinedPresentation,
      directory,
      request: { ...rocket, directorySha256: 'b'.repeat(64), requestId: 3 },
    })).toBeNull();
  });
});
