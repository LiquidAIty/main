// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as graphVisualTokens from '../graph/graphVisualTokens';

const forceGraphMocks = vi.hoisted(() => ({ instances: [] as any[] }));

vi.mock('../../vendor/engraphis/vendor/d3.min.js', () => ({}));
vi.mock('../../vendor/engraphis/vendor/force-graph.min.js', () => ({}));
vi.mock('../../vendor/engraphis/engraphis-graph.js', () => {
  window.EngraphisGraph = { create(host, options) {
    expect(Object.keys(options).sort()).toEqual(
      options.onNodeDoubleClick
        ? ['onBackgroundClick', 'onLinkClick', 'onNodeClick', 'onNodeDoubleClick']
        : ['onBackgroundClick', 'onLinkClick', 'onNodeClick'],
    );
    const canvas = document.createElement('canvas');
    host.appendChild(canvas);
    const instance: any = {
      data: { nodes: [], links: [] }, nodeClick: options.onNodeClick,
      nodeDoubleClick: options.onNodeDoubleClick,
      linkClick: options.onLinkClick, backgroundClick: options.onBackgroundClick,
      setData: vi.fn(function (this: any, data: any) {
        const prior = new Map(this.data.nodes.map((node: any) => [node.id, node]));
        this.data = {
          ...data,
          nodes: data.nodes.map((node: any) => {
            const before: any = prior.get(node.id);
            return before
              ? { ...node, x: before.x, y: before.y, vx: before.vx, vy: before.vy }
              : { ...node };
          }),
          links: data.links || data.edges || [],
        };
      }),
      setHighlight: vi.fn(), setLayers: vi.fn(), setThemeColors: vi.fn(), graphToScreen: (x: number, y: number) => ({ x, y }),
      setPreset: vi.fn(() => ({ size: 5, font: 13, linkw: 1, labelDensity: 40, repel: 120, link: 30, gravity: 14 })), setStyle: vi.fn(), setSettings: vi.fn(),
      resize: vi.fn(), setCollapse: vi.fn(), focus: vi.fn(() => true), clearFocus: vi.fn(), freeze: vi.fn(), reheat: vi.fn(), fit: vi.fn(), destroy: vi.fn(() => canvas.remove()),
      wheel: vi.fn(),
    };
    canvas.addEventListener('wheel', instance.wheel);
    forceGraphMocks.instances.push(instance);
    return instance;
  } };
  return {};
});
class ResizeObserverStub { observe() {} disconnect() {} }
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

import {
  JoinedKnowledgeGraphSurface,
} from './KnowledgeAuthorityGraphSurface';
import { graphitiFactIdentity, sourceLinks } from './knowledgeGraphInspectorRecords';
import {
  composeThinkKnowPresentation as composeProviderThinkKnowPresentation,
  type GraphProjectionV1,
} from './joinedKnowledgeGraphProjection';
import type { CanonicalSubjectHeader } from './canonicalSubjectDirectory';
import KnowledgeGraphFramework from './KnowledgeGraphFramework';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  forceGraphMocks.instances.length = 0;
  window.localStorage.clear();
});

describe('knowledge authority graph surfaces', () => {
  const empty = (authority: 'thinkgraph' | 'knowgraph' | 'codegraph'): GraphProjectionV1 => ({
    schemaVersion: `${authority}.projection.v1`,
    authority,
    projectId: 'project-1',
    nodes: [],
    edges: [],
  });

  const currentProjections = (
    think: GraphProjectionV1,
    know: GraphProjectionV1,
  ) => {
    const thinkNodes = think.nodes.map(node => ({
      ...node,
      canonicalName: node.canonicalName ?? node.label,
      entityKind: node.entityKind ?? node.type ?? 'person_or_concept',
      projectId: node.projectId ?? think.projectId,
    }));
    const knowNodes = know.nodes.map(node => ({
      ...node,
      canonicalName: node.canonicalName ?? node.label,
      entityKind: node.entityKind ?? node.type ?? 'Entity',
      projectId: node.projectId ?? know.projectId,
    }));
    const thinkSubjects = thinkNodes.filter(node => Boolean(node.canonicalName));
    const knowSubjects = knowNodes.filter(node => (
      Boolean(node.canonicalName) && node.type !== 'Episodic'
    ));
    const directory = {
      schemaVersion: 'graph-subject-directory' as const,
      projectId: think.projectId,
      complete: true as const,
      counts: {
        engraphis: thinkSubjects.length,
        graphiti: knowSubjects.length,
        total: thinkSubjects.length + knowSubjects.length,
      },
      revisions: { engraphis: 'think-current', graphiti: 'know-current' },
      subjects: [
        ...thinkSubjects.map(node => ({
          engraphisEntityId: node.id,
          canonicalName: node.canonicalName,
          entityKind: node.entityKind,
        })),
        ...knowSubjects.map(node => ({
          graphitiEntityId: node.id,
          canonicalName: node.canonicalName,
          entityKind: node.entityKind,
        })),
      ],
      sha256: 'a'.repeat(64),
      bytes: 512,
      estimatedTokens: 128,
      readDurationMs: 1.25,
    };
    return {
      thinkgraph: {
        ...think,
        nodes: thinkNodes,
        canonicalSubjectDirectory: directory,
      },
      knowgraph: { ...know, nodes: knowNodes },
    };
  };

  const composeThinkKnowPresentation = (
    think: GraphProjectionV1,
    know: GraphProjectionV1,
  ) => {
    const projections = currentProjections(think, know);
    return composeProviderThinkKnowPresentation(
      projections.thinkgraph, projections.knowgraph,
    );
  };

  const renderJoinedProjection = ({
    thinkgraph = empty('thinkgraph'),
    knowgraph = empty('knowgraph'),
    strict = false,
    onRemoveThinkGraphEvidence,
    onRemoveKnowGraphEvidence,
  }: {
    thinkgraph?: GraphProjectionV1;
    knowgraph?: GraphProjectionV1;
    strict?: boolean;
    onRemoveThinkGraphEvidence?: (memoryId: string) => Promise<void>;
    onRemoveKnowGraphEvidence?: (graphitiFactUuid: string) => Promise<void>;
  } = {}) => {
    const projections = currentProjections(thinkgraph, knowgraph);
    const surface = (
      <JoinedKnowledgeGraphSurface
        projections={projections}
        onRemoveThinkGraphEvidence={onRemoveThinkGraphEvidence}
        onRemoveKnowGraphEvidence={onRemoveKnowGraphEvidence}
      />
    );
    return render(strict ? <StrictMode>{surface}</StrictMode> : surface);
  };

  it('uses only the portable Graphiti fact identity for atomic deletion', () => {
    expect(graphitiFactIdentity({
      id: 'visual-edge', source: 'a', target: 'b', predicate: 'RELATES_TO',
      properties: { portableKind: 'know', graphitiFactUuid: 'fact-graphiti-1' },
    })).toBe('fact-graphiti-1');
    expect(graphitiFactIdentity({
      id: 'visual-edge', source: 'a', target: 'b', predicate: 'RELATES_TO',
      properties: { portableKind: 'know' },
    })).toBeNull();
    expect(graphitiFactIdentity({
      id: 'visual-edge', source: 'a', target: 'b', predicate: 'RELATES_TO',
      properties: { graphitiFactUuid: 'fact-graphiti-1' },
    })).toBeNull();
  });

  it('keeps same-domain documents distinct while collapsing exact source URLs', () => {
    const links = sourceLinks({
      source_description: JSON.stringify([
        'https://investors.rocketlabcorp.com/news/third-quarter-2025-results',
        'https://investors.rocketlabcorp.com/news/fourth-quarter-2025-results',
        'https://investors.rocketlabcorp.com/news/third-quarter-2025-results',
      ]),
    });
    expect(links.map(link => [link.label, link.publisher, link.url])).toEqual([
      [
        'Third quarter 2025 results',
        'investors.rocketlabcorp.com',
        'https://investors.rocketlabcorp.com/news/third-quarter-2025-results',
      ],
      [
        'Fourth quarter 2025 results',
        'investors.rocketlabcorp.com',
        'https://investors.rocketlabcorp.com/news/fourth-quarter-2025-results',
      ],
    ]);
  });

  it('renders one exact-name joined node with both real authority edges and provider evidence', () => {
    const think = {
      ...empty('thinkgraph'),
      nodes: [
        { id: 'think-1', canonicalId: 'shared-entity', label: 'Shared',
          properties: { evidence: [{ id: 'think-evidence' }] } },
        { id: 'same-id', label: 'Case', properties: {} },
        { id: 'think-target', label: 'Think target', properties: {} },
        { id: 'empty', label: '', properties: {} },
      ],
      edges: [{
        id: 'same-edge', source: 'think-1', target: 'think-target', predicate: 'DEPENDS_ON',
        layer: 'causal', properties: {},
      }],
    };
    const know = {
      ...empty('knowgraph'),
      nodes: [
        { id: 'know-1', canonicalId: 'shared-entity', label: 'Shared',
          properties: { evidence: [{ id: 'know-evidence' }] } },
        { id: 'same-id', label: 'case', properties: {} },
        { id: 'know-target', label: 'Know target', properties: {} },
        { id: 'empty', label: '', properties: {} },
      ],
      edges: [{
        id: 'same-edge', source: 'know-1', target: 'know-target', predicate: 'SUPPORTS',
        layer: 'semantic', properties: {},
      }],
    };
    const before = structuredClone({ think, know });

    const presentation = composeThinkKnowPresentation(think, know);
    const sharedVisualId = presentation.visualNodeIdByProviderMember.get('thinkgraph:think-1');
    expect(sharedVisualId).toBe(presentation.visualNodeIdByProviderMember.get('knowgraph:know-1'));
    expect(presentation.nodeVariants.get(sharedVisualId!)?.map(
      variant => [variant.authority, variant.node.id],
    )).toEqual([
      ['thinkgraph', think.nodes[0].id],
      ['knowgraph', know.nodes[0].id],
    ]);
    expect(presentation.nodeVariants.get(sharedVisualId!)?.map(
      variant => [variant.authority, variant.node.properties?.evidence],
    )).toEqual([
      ['thinkgraph', [{ id: 'think-evidence' }]],
      ['knowgraph', [{ id: 'know-evidence' }]],
    ]);
    expect(presentation.visualNodeIdByProviderMember.get('thinkgraph:same-id'))
      .not.toBe(presentation.visualNodeIdByProviderMember.get('knowgraph:same-id'));
    expect(presentation.visualNodeIdByProviderMember.get('thinkgraph:empty'))
      .not.toBe(presentation.visualNodeIdByProviderMember.get('knowgraph:empty'));
    expect(presentation.projection.edges.map(edge => [edge.id, edge.layer, edge.predicate]))
      .toEqual([
        ['thinkgraph:same-edge', 'thinkgraph', 'DEPENDS_ON'],
        ['knowgraph:same-edge', 'knowgraph', 'SUPPORTS'],
      ]);
    expect(presentation.projection.edges.map(edge => [edge.layer, edge.source, edge.target]))
      .toEqual([
        ['thinkgraph', sharedVisualId, 'thinkgraph:think-target'],
        ['knowgraph', sharedVisualId, 'knowgraph:know-target'],
      ]);
    expect(presentation.projection.edges[0].properties?.providerSemanticLayer).toBe('causal');
    expect(presentation.projection.edges[1].properties?.providerSemanticLayer).toBe('semantic');
    expect(presentation.edgeVariants.get('thinkgraph:same-edge')?.edge).toBe(think.edges[0]);
    expect(presentation.edgeVariants.get('knowgraph:same-edge')?.edge).toBe(know.edges[0]);
    expect(presentation.projection.nodes.find(node => node.id === sharedVisualId)).toMatchObject({
      material_kind: 'solarpunk',
      material_role: 'PAIRED_SOLARPUNK_MATERIAL',
      material_blue: '#4FA2AD',
      material_orange: '#F2A64A',
    });
    expect({ think, know }).toEqual(before);

    const renamedProviderIds = composeThinkKnowPresentation(
      { ...think, nodes: [{ id: 'replacement-think', canonicalId: 'shared-entity', label: 'Shared', properties: {} }], edges: [] },
      { ...know, nodes: [{ id: 'replacement-know', canonicalId: 'shared-entity', label: 'Shared', properties: {} }], edges: [] },
    );
    expect(renamedProviderIds.visualNodeIdByProviderMember.get('thinkgraph:replacement-think'))
      .toBe(sharedVisualId);
  });

  it('joins exact names, keeps different names separate, and never uses provider IDs as join keys', () => {
    const think = {
      ...empty('thinkgraph'),
      nodes: [
        { id: 'think-exact', label: 'Exact', properties: {} },
        { id: 'think-different', label: 'Think name', properties: {} },
        { id: 'think-target', label: 'Think target', properties: {} },
      ],
      edges: [
        { id: 'think-mismatch', source: 'think-exact', target: 'think-target', predicate: 'THINK_REL', properties: {} },
        { id: 'think-same-rel', source: 'think-different', target: 'think-target', predicate: 'SAME_REL', properties: {} },
      ],
    };
    const know = {
      ...empty('knowgraph'),
      nodes: [
        { id: 'know-exact', label: 'Exact', properties: {} },
        { id: 'know-different', label: 'Know name', properties: {} },
        { id: 'know-target', label: 'Know target', properties: {} },
      ],
      edges: [
        { id: 'know-mismatch', source: 'know-exact', target: 'know-target', predicate: 'KNOW_REL', properties: {} },
        { id: 'know-same-rel', source: 'know-different', target: 'know-target', predicate: 'SAME_REL', properties: {} },
      ],
    };
    const before = structuredClone({ think, know });

    const presentation = composeThinkKnowPresentation(think, know);
    const exactVisualId = presentation.visualNodeIdByProviderMember.get('thinkgraph:think-exact');
    expect(exactVisualId).toBe(
      presentation.visualNodeIdByProviderMember.get('knowgraph:know-exact'),
    );
    expect(presentation.nodeVariants.get(exactVisualId!)?.map(
      variant => [variant.authority, variant.node.id],
    )).toEqual([
      ['thinkgraph', think.nodes[0].id],
      ['knowgraph', know.nodes[0].id],
    ]);
    expect(presentation.visualNodeIdByProviderMember.get('thinkgraph:think-different'))
      .not.toBe(presentation.visualNodeIdByProviderMember.get('knowgraph:know-different'));

    expect(presentation.projection.edges).toHaveLength(think.edges.length + know.edges.length);
    expect(presentation.edgeVariants.size).toBe(think.edges.length + know.edges.length);
    for (const visualEdge of presentation.projection.edges) {
      const providerVariant = presentation.edgeVariants.get(visualEdge.id)!;
      expect(visualEdge.source).toBe(presentation.visualNodeIdByProviderMember.get(
        `${providerVariant.authority}:${providerVariant.edge.source}`,
      ));
      expect(visualEdge.target).toBe(presentation.visualNodeIdByProviderMember.get(
        `${providerVariant.authority}:${providerVariant.edge.target}`,
      ));
    }
    expect({ think, know }).toEqual(before);
    expect(think.nodes.map(node => node.id)).toEqual(['think-exact', 'think-different', 'think-target']);
    expect(know.nodes.map(node => node.id)).toEqual(['know-exact', 'know-different', 'know-target']);
    expect(think.edges.map(edge => edge.id)).toEqual(['think-mismatch', 'think-same-rel']);
    expect(know.edges.map(edge => edge.id)).toEqual(['know-mismatch', 'know-same-rel']);

    const trimmed = composeThinkKnowPresentation(
      { ...empty('thinkgraph'), nodes: [{ id: 'think-trimmed', label: '  Trimmed name  ', properties: {} }] },
      { ...empty('knowgraph'), nodes: [{ id: 'know-trimmed', label: 'Trimmed name', properties: {} }] },
    );
    expect(trimmed.projection.nodes).toHaveLength(2);
    expect(trimmed.visualNodeIdByProviderMember.get('thinkgraph:think-trimmed'))
      .toBe('thinkgraph:think-trimmed');
    expect(trimmed.visualNodeIdByProviderMember.get('knowgraph:know-trimmed'))
      .toBe('knowgraph:know-trimmed');
  });

  it('fails closed when provider lookup ids mismatch or a directory row has dual or no ids', () => {
    const think = {
      ...empty('thinkgraph'),
      nodes: [{ id: 'think-shared', label: 'Shared', properties: {} }],
    };
    const know = {
      ...empty('knowgraph'),
      nodes: [{ id: 'know-shared', label: 'Shared', properties: {} }],
    };
    const mismatched = currentProjections(think, know);
    mismatched.thinkgraph.canonicalSubjectDirectory!.subjects[0] = {
      engraphisEntityId: 'stale-think-shared',
      canonicalName: 'Shared',
      entityKind: 'person_or_concept',
    };
    const mismatchedPresentation = composeProviderThinkKnowPresentation(
      mismatched.thinkgraph, mismatched.knowgraph,
    );
    expect(mismatchedPresentation.projection.nodes).toHaveLength(2);
    expect(mismatchedPresentation.visualNodeIdByProviderMember.get('thinkgraph:think-shared'))
      .not.toBe(mismatchedPresentation.visualNodeIdByProviderMember.get('knowgraph:know-shared'));

    for (const malformed of [
      {
        engraphisEntityId: 'think-shared', graphitiEntityId: 'know-shared',
        canonicalName: 'Shared', entityKind: 'person_or_concept',
      },
      { canonicalName: 'Shared', entityKind: 'person_or_concept' },
    ]) {
      const current = currentProjections(think, know);
      current.thinkgraph.canonicalSubjectDirectory!.subjects[0] = (
        malformed as unknown as CanonicalSubjectHeader
      );
      const presentation = composeProviderThinkKnowPresentation(
        current.thinkgraph, current.knowgraph,
      );
      expect(presentation.projection.nodes).toHaveLength(2);
      expect(presentation.projection.canonicalSubjectDirectory).toBeUndefined();
    }
  });

  it('keeps ambiguous and cross-Project subjects separate while joining exact names across provider kinds', () => {
    const think = {
      ...empty('thinkgraph'),
      nodes: [
        { id: 'think-a', label: 'Shared', type: 'person_or_concept', properties: {} },
        { id: 'think-b', label: 'Shared', type: 'person_or_concept', properties: {} },
      ],
    };
    const know = {
      ...empty('knowgraph'),
      nodes: [{ id: 'know-a', label: 'Shared', type: 'Organization', properties: {} }],
    };
    expect(composeThinkKnowPresentation(think, know).projection.nodes.map(node => node.id))
      .toEqual(['thinkgraph:think-a', 'thinkgraph:think-b', 'knowgraph:know-a']);

    const current = currentProjections(
      { ...empty('thinkgraph'), nodes: [{ id: 'think-kind', label: 'Subject', type: 'person_or_concept', properties: {} }] },
      { ...empty('knowgraph'), nodes: [{ id: 'know-kind', label: 'Subject', type: 'Organization', properties: {} }] },
    );
    const currentThink = current.thinkgraph;
    currentThink.nodes[0] = { ...currentThink.nodes[0], entityKind: 'conflicting-kind' };
    const currentKnow = current.knowgraph;
    expect(composeThinkKnowPresentation(currentThink, currentKnow).projection.nodes.map(node => node.id))
      .toEqual(['node-name:Subject']);

    const otherProject = { ...currentKnow, projectId: 'project-2' };
    expect(composeThinkKnowPresentation(currentThink, otherProject).projection.nodes.map(node => node.id))
      .toEqual(['thinkgraph:think-kind', 'knowgraph:know-kind']);
  });

  it('joins exact Rocket Lab names while retaining both provider records', () => {
    const think = {
      ...empty('thinkgraph'),
      nodes: [{
        id: 'ent-think-rocket-lab', canonicalId: 'ent-think-rocket-lab',
        label: 'Rocket Lab', properties: {},
      }],
    };
    const know = {
      ...empty('knowgraph'),
      nodes: [{
        id: 'uuid-know-rocket-lab', canonicalId: 'uuid-know-rocket-lab',
        label: 'Rocket Lab', properties: {},
      }],
    };

    expect(composeThinkKnowPresentation(think, know).projection.nodes)
      .toHaveLength(1);
  });

  it.each([
    ['thinkgraph', 'Think', 'Know'],
    ['knowgraph', 'Know', 'Think'],
  ] as const)('shows only the real authority button for a mixed-canvas %s-only bundle', (authority, realTab, absentTab) => {
    const providerProjection = {
      ...empty(authority),
      nodes: [{ id: `${authority}-only`, label: 'Single authority', properties: {} }],
    };
    render(<JoinedKnowledgeGraphSurface
      projections={{
        thinkgraph: authority === 'thinkgraph' ? providerProjection : empty('thinkgraph'),
        knowgraph: authority === 'knowgraph' ? providerProjection : empty('knowgraph'),
      }}
    />);
    const graph = forceGraphMocks.instances.at(-1);
    act(() => graph.nodeClick(graph.data.nodes[0]));

    expect(screen.queryAllByRole('tab')).toEqual([]);
    expect(screen.getByRole('complementary').getAttribute('aria-label')).toBe('Open graph settings');
    expect(screen.getByRole('complementary').textContent).not.toContain(absentTab);
    expect(realTab).toBe(authority === 'thinkgraph' ? 'Think' : 'Know');
    expect(screen.queryByRole('tab', { name: absentTab })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Load$/ })).toBeNull();
  });

  it('renders only real direct Think and Know records and deletes the exact atomic fact', async () => {
    const think = {
      ...empty('thinkgraph'),
      nodes: [{
        id: 'think-shared', label: 'Shared', properties: {
          evidence: [{
            id: 'memory-1',
            ingestedAt: '2026-10-03T12:00:00Z',
            summary: 'Direct Think summary.',
            metadata: { thinkgraph_origin: { authority: 'thinkgraph' } },
          }],
        },
      }],
      edges: [],
    };
    const know = {
      ...empty('knowgraph'),
      nodes: [
        { id: 'know-shared', label: 'Shared', properties: {} },
        { id: 'know-target', label: 'Target', properties: {} },
      ],
      provenanceNodes: [{
        id: 'episode-1',
        label: 'Primary source',
        properties: { source_url: 'https://example.com/source' },
      }],
      edges: [{
        id: 'visual-edge',
        source: 'know-shared',
        target: 'know-target',
        predicate: 'SUPPORTS',
        properties: {
          portableKind: 'know',
          graphitiFactUuid: 'fact-graphiti-1',
          fact: 'Direct sourced Know.',
          createdAt: '2026-10-03T12:30:00Z',
          supportingEpisodeUuids: ['episode-1'],
        },
      }],
    };
    const removeThink = vi.fn().mockResolvedValue(undefined);
    const removeKnow = vi.fn().mockResolvedValue(undefined);
    render(<JoinedKnowledgeGraphSurface
      projections={currentProjections(think, know)}
      onRemoveThinkGraphEvidence={removeThink}
      onRemoveKnowGraphEvidence={removeKnow}
    />);
    const graph = forceGraphMocks.instances.at(-1);
    act(() => graph.nodeClick(graph.data.nodes.find((node: any) => node.label === 'Shared')));

    expect(screen.getByRole('tab', { name: 'Think' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Know' })).toBeTruthy();
    expect(screen.getByText('Direct Think summary.')).toBeTruthy();
    expect(screen.queryByText('Technical details')).toBeNull();
    expect(screen.queryByText('Reread contents')).toBeNull();
    expect(screen.queryByText('Use selected in chat')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Know' }));
    expect(screen.getByTestId('know-records').textContent)
      .toContain('Direct sourced Know.');
    expect(screen.getAllByRole('link').some(link => (
      link.getAttribute('href') === 'https://example.com/source'
      && link.textContent?.includes('Source')
    ))).toBe(true);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Delete record' }));
    await waitFor(() => expect(removeKnow).toHaveBeenCalledExactlyOnceWith('fact-graphiti-1'));
    expect(removeThink).not.toHaveBeenCalled();
  });

  it('defaults joined subjects to Think and preserves the chosen authority lens across node selections', () => {
    const thinkRecord = (id: string, summary: string) => ({
      id,
      ingestedAt: '2026-10-03T12:00:00Z',
      summary,
      metadata: { thinkgraph_origin: { authority: 'thinkgraph' } },
    });
    const think = {
      ...empty('thinkgraph'),
      nodes: [
        { id: 'think-a', label: 'Joined A', properties: { evidence: [thinkRecord('memory-a', 'Think A.')] } },
        { id: 'think-b', label: 'Joined B', properties: { evidence: [thinkRecord('memory-b', 'Think B.')] } },
        { id: 'think-only', label: 'Think only', properties: { evidence: [thinkRecord('memory-only', 'Think only record.')] } },
      ],
      edges: [],
    };
    const know = {
      ...empty('knowgraph'),
      nodes: [
        { id: 'know-a', label: 'Joined A', properties: {} },
        { id: 'know-b', label: 'Joined B', properties: {} },
        { id: 'know-only', label: 'Know only', properties: {} },
        { id: 'target-a', label: 'Target A', properties: {} },
        { id: 'target-b', label: 'Target B', properties: {} },
        { id: 'target-only', label: 'Target only', properties: {} },
      ],
      edges: [
        { id: 'edge-a', source: 'know-a', target: 'target-a', predicate: 'SUPPORTS', properties: {
          portableKind: 'know', graphitiFactUuid: 'fact-a', fact: 'Know A.', temporalStatus: 'current',
        } },
        { id: 'edge-b', source: 'know-b', target: 'target-b', predicate: 'SUPPORTS', properties: {
          portableKind: 'know', graphitiFactUuid: 'fact-b', fact: 'Know B.', temporalStatus: 'current',
        } },
        { id: 'edge-only', source: 'know-only', target: 'target-only', predicate: 'SUPPORTS', properties: {
          portableKind: 'know', graphitiFactUuid: 'fact-only', fact: 'Know only record.', temporalStatus: 'current',
        } },
      ],
    };
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    render(<JoinedKnowledgeGraphSurface
      projections={currentProjections(think, know)}
    />);
    const graph = forceGraphMocks.instances.at(-1);
    const node = (label: string) => graph.data.nodes.find((candidate: any) => candidate.label === label);

    act(() => graph.nodeClick(node('Joined A')));
    expect(screen.getByRole('tab', { name: 'Think' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Think A.')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Know' }));
    expect(screen.getByRole('tab', { name: 'Know' }).getAttribute('aria-selected')).toBe('true');

    act(() => graph.nodeClick(node('Joined B')));
    expect(screen.getByRole('tab', { name: 'Know' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Know B.')).toBeTruthy();

    act(() => graph.nodeClick(node('Think only')));
    expect(screen.getByRole('tab', { name: 'Think' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Think only record.')).toBeTruthy();

    act(() => graph.nodeClick(node('Know only')));
    expect(screen.getByRole('tab', { name: 'Know' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Know only record.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resolves a real double-click, expands, and exits Focus through empty canvas without recomputation', async () => {
    const think = {
      ...empty('thinkgraph'),
      nodes: [
        { id: 'think-center', canonicalId: 'shared-center', label: 'Shared center', properties: {
          evidence: [{ id: 'memory-center', content: 'Think center.' }],
        } },
        { id: 'think-neighbor', label: 'Think neighbor', properties: { summary: 'Think neighbor.' } },
      ],
      edges: [{
        id: 'think-edge', source: 'think-center', target: 'think-neighbor',
        predicate: 'THINKS_WITH', relationship_strength: 0.62, properties: {},
      }],
    };
    const know = {
      ...empty('knowgraph'),
      nodes: [
        { id: 'know-center', canonicalId: 'shared-center', label: 'Shared center', properties: { summary: 'Know center.' } },
        { id: 'know-neighbor', label: 'Know neighbor', properties: { summary: 'Know neighbor.' } },
      ],
      edges: [{
        id: 'know-edge', source: 'know-center', target: 'know-neighbor',
        predicate: 'KNOWS_WITH', relationship_strength: 0.54, properties: {
          portableKind: 'know', graphitiFactUuid: 'know-edge', fact: 'Know center.',
        },
      }],
    };
    const focusProjections = currentProjections(think, know);
    const onReadProviderFocusNeighborhood = vi.fn(async (authority: string) => (
      authority === 'thinkgraph' ? focusProjections.thinkgraph : focusProjections.knowgraph
    ));
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as any;
      expect(request.candidates.map((candidate: any) => [candidate.authority, candidate.entityId]))
        .toEqual([
          ['KnowGraph', 'know-neighbor'],
          ['ThinkGraph', 'think-neighbor'],
        ]);
      return {
        ok: true,
        json: async () => ({
          schemaVersion: 'jev-focus.v1',
          sourceRevision: request.sourceRevision,
          status: 'success',
          decisionId: 'focus-decision-1',
          errorCode: null,
          distribution: { know: 0.4, think: 0.6 },
          candidates: [
            { authority: 'ThinkGraph', entityId: 'think-neighbor', choiceId: 'think', probability: 0.6, selected: true, rank: 1 },
            { authority: 'KnowGraph', entityId: 'know-neighbor', choiceId: 'know', probability: 0.4, selected: true, rank: 2 },
          ],
        }),
      } as Response;
    });
    render(<JoinedKnowledgeGraphSurface
      projections={currentProjections(think, know)}
      onReadProviderFocusNeighborhood={onReadProviderFocusNeighborhood}
    />);
    const graph = forceGraphMocks.instances.at(-1);
    const rendererCount = forceGraphMocks.instances.length;
    const center = graph.data.nodes.find((node: any) => node.label === 'Shared center');
    center.x = 18;
    center.y = -7;

    act(() => graph.nodeClick(center));
    expect(screen.getByRole('button', { name: 'Focus' })).toBeTruthy();
    expect(onReadProviderFocusNeighborhood).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();

    act(() => graph.nodeDoubleClick(center));
    await waitFor(() => expect(screen.getByTestId('knowledge-joined-surface')
      .getAttribute('data-focus-phase')).toBe('manual_blackhole_focus'));
    expect(onReadProviderFocusNeighborhood.mock.calls.map(call => call.slice(0, 2))).toEqual([
      ['thinkgraph', 'think-center'],
      ['knowgraph', 'know-center'],
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(forceGraphMocks.instances).toHaveLength(rendererCount);
    await waitFor(() => expect(graph.focus).toHaveBeenCalledWith(center.id));
    expect(graph.setSettings).toHaveBeenCalledWith({ repel: 25, gravity: 48, damping: 6 });
    const focusedNodeIds = graph.data.nodes.map((node: any) => node.id);
    const focusedEdgeIds = graph.data.links.map((edge: any) => edge.id);
    expect(focusedNodeIds).toHaveLength(3);
    expect(focusedEdgeIds).toHaveLength(2);
    expect(graph.data.nodes.find((node: any) => node.id === center.id)).toMatchObject({
      x: 18,
      y: -7,
      gravity_mass: 7,
    });
    expect(screen.getByRole('button', { name: 'Expand' })).toBeTruthy();
    const focusedWeights = graph.data.links.map((edge: any) => ({
      id: edge.id,
      predicate: edge.predicate,
      relationship_strength: edge.relationship_strength,
      label_confidence: edge.label_confidence,
      jev: edge.properties?.jev,
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
    await waitFor(() => expect(screen.getByTestId('knowledge-joined-surface')
      .getAttribute('data-focus-phase')).not.toBe('manual_blackhole_focus'));
    expect(forceGraphMocks.instances).toHaveLength(rendererCount);
    expect(graph.data.nodes.map((node: any) => node.id)).toEqual(focusedNodeIds);
    expect(graph.data.links.map((edge: any) => edge.id)).toEqual(focusedEdgeIds);
    expect(graph.data.links.map((edge: any) => ({
      id: edge.id,
      predicate: edge.predicate,
      relationship_strength: edge.relationship_strength,
      label_confidence: edge.label_confidence,
      jev: edge.properties?.jev,
    }))).toEqual(focusedWeights);
    expect(onReadProviderFocusNeighborhood).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => graph.nodeDoubleClick(center));
    await waitFor(() => expect(screen.getByTestId('knowledge-joined-surface')
      .getAttribute('data-focus-phase')).toBe('manual_blackhole_focus'));
    expect(onReadProviderFocusNeighborhood).toHaveBeenCalledTimes(4);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const emptyCanvasExitWeights = graph.data.links.map((edge: any) => ({
      id: edge.id,
      predicate: edge.predicate,
      relationship_strength: edge.relationship_strength,
      label_confidence: edge.label_confidence,
      jev: edge.properties?.jev,
    }));

    act(() => graph.backgroundClick());
    await waitFor(() => expect(screen.getByTestId('knowledge-joined-surface')
      .getAttribute('data-focus-phase')).not.toBe('manual_blackhole_focus'));
    expect(graph.data.links.map((edge: any) => ({
      id: edge.id,
      predicate: edge.predicate,
      relationship_strength: edge.relationship_strength,
      label_confidence: edge.label_confidence,
      jev: edge.properties?.jev,
    }))).toEqual(emptyCanvasExitWeights);
    expect(onReadProviderFocusNeighborhood).toHaveBeenCalledTimes(4);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the local canvas unchanged when provider Focus preparation is unavailable', async () => {
    const think = {
      ...empty('thinkgraph'),
      nodes: [
        { id: 'center', label: 'Center', properties: {
          evidence: [{ id: 'memory-center', content: 'Center.' }],
        } },
        { id: 'neighbor', label: 'Neighbor', properties: {} },
      ],
      edges: [{ id: 'edge', source: 'center', target: 'neighbor', predicate: 'RELATES_TO', properties: {} }],
    };
    const onReadProviderFocusNeighborhood = vi.fn().mockRejectedValue(new Error('offline'));
    render(<JoinedKnowledgeGraphSurface
      projections={{ thinkgraph: think, knowgraph: empty('knowgraph') }}
      onReadProviderFocusNeighborhood={onReadProviderFocusNeighborhood}
    />);
    const graph = forceGraphMocks.instances.at(-1);
    const nodeIds = graph.data.nodes.map((node: any) => node.id);
    const edgeIds = graph.data.links.map((edge: any) => edge.id);
    const center = graph.data.nodes.find((node: any) => node.label === 'Center');

    act(() => graph.nodeDoubleClick(center));
    await waitFor(() => expect(screen.getByText('Focus unavailable · local view kept')).toBeTruthy());
    expect(graph.data.nodes.map((node: any) => node.id)).toEqual(nodeIds);
    expect(graph.data.links.map((edge: any) => edge.id)).toEqual(edgeIds);
    expect(graph.focus).not.toHaveBeenCalled();
    expect(graph.setPreset).not.toHaveBeenCalledWith('galaxy');
    expect(screen.getByRole('button', { name: 'Focus' })).toBeTruthy();
  });

  it('keeps a healthy authority visible while truthfully reporting the other authority failure', () => {
    const think = {
      ...empty('thinkgraph'),
      nodes: [{ id: 'think-only', label: 'Healthy Think', properties: {} }],
    };
    render(<JoinedKnowledgeGraphSurface
      projections={{ thinkgraph: think, knowgraph: empty('knowgraph') }}
      statuses={{ thinkgraph: 'ready', knowgraph: 'error' }}
      errors={{ knowgraph: 'request timed out' }}
    />);
    const graph = forceGraphMocks.instances.at(-1);
    expect(graph.data.nodes.map((node: any) => node.label)).toEqual(['Healthy Think']);
    expect(screen.getByTestId('knowledge-authority-warning').textContent)
      .toBe('KnowGraph unavailable: request timed out');
    expect(screen.queryByText(/Graph failed/)).toBeNull();
  });

  it('uses the selected Engraphis preset for the joined graph with zoom and shared paper', () => {
    const { container } = renderJoinedProjection();
    const graph = forceGraphMocks.instances.at(-1);
    expect(container.querySelector('[data-renderer="engraphis-1.7.1"]')).toBeTruthy();
    expect(graph.setPreset).toHaveBeenCalledWith('compact');
    expect(graph.setStyle).toHaveBeenCalledWith('cyber');
    expect(graph.setSettings).toHaveBeenCalledWith({
      size: 5,
      font: 13,
      linkw: 1,
      labelDensity: 40,
      repel: 120,
      link: 30,
      gravity: 14,
      labels: true,
    });
    const paper = container.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(paper.style.backgroundSize.startsWith('24px 24px')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(graph.wheel.mock.calls.at(-1)[0].deltaY).toBe(-120);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(graph.wheel.mock.calls.at(-1)[0].deltaY).toBe(120);
    fireEvent.click(screen.getByRole('button', { name: 'Fit view' }));
    expect(graph.fit).toHaveBeenCalledOnce();
    expect(paper.style.backgroundSize.startsWith('24px 24px')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Open graph settings' }));
    expect(screen.getByRole('combobox', { name: 'Layout' }).getAttribute('aria-label')).toBe('Layout');
    expect(graph.setCollapse).toHaveBeenCalledWith(false);
    for (const value of ['original', 'communities', 'radial', 'galaxy', 'compact']) {
      fireEvent.change(screen.getByRole('combobox', { name: 'Layout' }), { target: { value } });
      expect(graph.setPreset).toHaveBeenLastCalledWith(value);
      expect(graph.data.nodes).toEqual([]);
    }
    expect(screen.queryByRole('button', { name: /Freeze|Resume|Reheat|Focus/ })).toBeNull();
    expect(graph.freeze).not.toHaveBeenCalled();
    expect(graph.reheat).not.toHaveBeenCalled();
  });

  it.each(['thinkgraph', 'knowgraph'] as const)(
    'switches %s physics profiles locally without mutating graph data or calling Jev',
    authority => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const projection = {
        ...empty(authority),
        nodes: [{ id: 'a', label: 'Alpha', properties: {} }, { id: 'b', label: 'Beta', properties: {} }],
        edges: [{
          id: 'ab', source: 'a', target: 'b', predicate: 'PROVIDES',
          properties: {
            jev: {
              status: 'success',
              winner: 'PROVIDES',
              distribution: { PROVIDES: 0.8, ASSOCIATED_WITH: 0.2 },
            },
          },
        }],
      };
      const original = structuredClone(projection);
      const { container } = renderJoinedProjection({
        ...(authority === 'thinkgraph'
          ? { thinkgraph: projection }
          : { knowgraph: projection }),
      });
      const graph = forceGraphMocks.instances.at(-1);
      expect(graph.data.links[0]).toMatchObject({
        relationship_strength: 0.8,
        visual_width: 2.35,
        spring_strength: 0.18640000000000004,
        rest_length: 22.639999999999997,
      });
      fireEvent.click(screen.getByRole('button', { name: 'Open graph settings' }));
      expect((screen.getByRole('combobox', { name: 'Physics profile' }) as HTMLSelectElement).value)
        .toBe('galaxy');
      fireEvent.change(screen.getByRole('combobox', { name: 'Physics profile' }), {
        target: { value: 'open' },
      });
      expect(container.querySelector(`[data-physics-profile="open"]`)).toBeTruthy();
      expect(graph.data.links[0]).toMatchObject({
        relationship_strength: 0.8,
        spring_strength: 0.121,
        rest_length: 24.4,
      });
      expect(graph.data.links[0].visual_width).toBeCloseTo(1.8);
      act(() => graph.nodeClick(graph.data.nodes[1]));
      for (const implementationField of ['Semantic mass', 'Physics profile', 'Source graph', 'Entity ID']) {
        expect(screen.queryByText(implementationField)).toBeNull();
      }
      expect(projection).toEqual(original);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('starts KnowGraph empty without loading the complete Neo4j graph', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderJoinedProjection();
    await waitFor(() => expect(screen.getByTestId('knowledge-joined-surface')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Open graph settings' })).toBeTruthy();
    expect(screen.getByText('No knowledge yet.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renders provider entries without hiding isolated nodes or inventing connections', async () => {
    const projection = {
      ...empty('knowgraph'),
      nodes: [{ id: 'entity-one', label: 'Existing entity', mentionCount: 1 }],
    };
    renderJoinedProjection({ knowgraph: projection });
    const graph = forceGraphMocks.instances.at(-1);
    await waitFor(() => expect(graph.data.nodes.map((node: { label: string }) => node.label))
      .toEqual(['Existing entity']));
    expect(graph.data.links).toEqual([]);
    expect(screen.queryByRole('checkbox', { name: 'Hide unconnected entities' })).toBeNull();
    expect(projection.nodes).toEqual([{ id: 'entity-one', label: 'Existing entity', mentionCount: 1 }]);
    expect(projection.edges).toEqual([]);
  });

  it('loads provider records into the replacement renderer after Strict Mode effect replay', () => {
    const projection = { ...empty('knowgraph'), nodes: [{ id: 'source', label: 'W3C', mentionCount: 1 }] };
    renderJoinedProjection({ knowgraph: projection, strict: true });
    expect(forceGraphMocks.instances).toHaveLength(2);
    expect(forceGraphMocks.instances.at(-1).data.nodes.map((node: { label: string }) => node.label))
      .toEqual(['W3C']);
  });

  it('keeps CodeGraph out of the launch graph surface', () => {
    const { container } = render(
      <KnowledgeGraphFramework
        projections={{
          thinkgraph: empty('thinkgraph'),
          knowgraph: empty('knowgraph'),
        }}
        errors={{}}
      />,
    );

    expect(container.querySelector('[data-testid="knowledge-codegraph-surface"]')).toBeNull();
    expect(screen.queryByRole('tablist', { name: 'Knowledge graph view' })).toBeNull();
  });

  it('does not expose the removed copy-into-chat action', async () => {
    const projection = {
      ...empty('knowgraph'),
      nodes: [{
        id: 'mem-one', canonicalId: 'mem-one', label: 'Decision', mentionCount: 1,
        properties: {},
      }],
    };
    renderJoinedProjection({ knowgraph: projection });
    const graph = forceGraphMocks.instances.at(-1);
    await waitFor(() => expect(graph.data.nodes).toHaveLength(1));
    act(() => graph.nodeClick(graph.data.nodes[0]));
    expect(screen.queryByRole('button', { name: 'Use in chat' })).toBeNull();
  });

  it('keeps the relationship word and probability hover-only on a ThinkGraph edge', () => {
    const projection = {
      ...empty('thinkgraph'),
      nodes: [{ id: 'subject', label: 'Subject' }, { id: 'idea', label: 'Idea' }],
      edges: [{ id: 'edge', source: 'subject', target: 'idea', predicate: 'DEPENDS_ON',
        provenance: { memoryId: 'stored-memory' }, properties: {
          summary: 'Recorded relationship.', relationship_strength: 0.71,
          jev: { winner: 'DEPENDS_ON', distribution: { DEPENDS_ON: 0.71, AFFECTS: 0.29 } },
        } }],
    };
    const before = JSON.stringify(projection);
    renderJoinedProjection({ thinkgraph: projection });
    const graph = forceGraphMocks.instances.at(-1);
    expect(graph.data.links).toHaveLength(1);
    expect(graph.data.links[0]).toMatchObject({
      predicate: 'DEPENDS_ON', relation: 'DEPENDS_ON', hover_label: 'DEPENDS_ON · .71',
      directional_arrow_length: 3, directional_arrow_rel_pos: 0.9,
    });
    expect(graph.data.links[0].label).toBe('');
    expect(graph.data.nodes.map((node: any) => [node.id, node.label])).toEqual([['subject', 'Subject'], ['idea', 'Idea']]);
    expect(JSON.stringify(projection)).toBe(before);
    act(() => graph.linkClick(graph.data.links[0]));
    expect(screen.getByTestId('thinkgraph-edge-inspector').textContent).toContain('Recorded relationship.');
  });

  it('renders the joined knowledge surface in the existing canvas and binds the pull tab to Engraphis settings', async () => {
    const { container } = render(<KnowledgeGraphFramework
      projections={{ thinkgraph: empty('thinkgraph'), knowgraph: empty('knowgraph') }}
      errors={{}} />);
    await waitFor(() => expect(screen.getByTestId('knowledge-joined-surface')).toBeTruthy());
    expect(container.querySelector('iframe')).toBeNull();
    expect(screen.getByText('No knowledge yet.')).toBeTruthy();
    await waitFor(() => expect(forceGraphMocks.instances.at(-1)?.data.nodes).toEqual([]));
    const graph = forceGraphMocks.instances.at(-1);
    expect(graph.data.nodes).toEqual([]);
    expect(graph.setPreset).toHaveBeenCalledWith('compact');
    fireEvent.click(screen.getByRole('button', { name: 'Open graph settings' }));
    fireEvent.change(screen.getByRole('slider', { name: 'Node size' }), { target: { value: '7' } });
    expect(graph.setSettings).toHaveBeenLastCalledWith({ size: 7 });
    expect(graph.data.nodes).toEqual([]);
    expect(graph.data.links).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Reset to preset defaults' }));
    expect(screen.getByRole('slider', { name: 'Node size' }).getAttribute('value')).toBe('5');
    expect(screen.getByRole('button', { name: 'Reset to preset defaults' }).textContent)
      .toBe('Preset defaults applied · node size 5');
    expect(graph.setSettings).toHaveBeenLastCalledWith(expect.objectContaining({
      size: 5, labels: true, linkw: 1,
    }));
    expect(screen.queryByRole('button', { name: /^Freeze$/ })).toBeNull();
  });

  it('preserves a valid saved node size on load and visibly applies the current preset default on request', async () => {
    const key = 'liquidaity.graph.joined.presentation.v1';
    window.localStorage.setItem(key, JSON.stringify({
      schemaVersion: 6,
      layout: 'compact',
      style: 'solarpunk',
      physicsProfile: 'galaxy',
      settings: { size: 3, labels: true },
    }));
    renderJoinedProjection();
    fireEvent.click(screen.getByRole('button', { name: 'Open graph settings' }));

    expect(screen.getByRole('slider', { name: 'Node size' }).getAttribute('value')).toBe('3');
    expect(JSON.parse(window.localStorage.getItem(key) || '{}').settings.size).toBe(3);

    fireEvent.click(screen.getByRole('button', { name: 'Reset to preset defaults' }));
    expect(screen.getByRole('slider', { name: 'Node size' }).getAttribute('value')).toBe('5');
    expect(screen.getByRole('button', { name: 'Reset to preset defaults' }).textContent)
      .toBe('Preset defaults applied · node size 5');
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem(key) || '{}').settings.size).toBe(5));
  });

  it('migrates the superseded Cyberpunk size-3 presentation to the Solarpunk size-5 baseline once', async () => {
    const key = 'liquidaity.graph.joined.presentation.v1';
    window.localStorage.setItem(key, JSON.stringify({
      schemaVersion: 3,
      layout: 'compact',
      style: 'cyber',
      physicsProfile: 'galaxy',
      settings: { size: 3, labels: true, linkw: 0.4 },
      solarpunkColors: {
        think: '#6e5fae', know: '#f2a64a', relationship: '#123456',
      },
    }));
    render(<JoinedKnowledgeGraphSurface
      projections={currentProjections(empty('thinkgraph'), empty('knowgraph'))}
    />);
    fireEvent.click(screen.getByRole('button', { name: 'Open graph settings' }));

    expect((screen.getByLabelText('Style') as HTMLSelectElement).value).toBe('solarpunk');
    expect(screen.getByRole('slider', { name: 'Node size' }).getAttribute('value')).toBe('5');
    expect(screen.getByRole('slider', { name: 'Line width' }).getAttribute('value')).toBe('1');
    expect((screen.getByLabelText('Think nodes') as HTMLInputElement).value).toBe('#4fa2ad');
    expect((screen.getByLabelText('Know nodes') as HTMLInputElement).value).toBe('#f2a64a');
    expect((screen.getByLabelText('Think edges') as HTMLInputElement).value).toBe('#4fa2ad');
    expect((screen.getByLabelText('Know edges') as HTMLInputElement).value).toBe('#f2a64a');
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem(key) || '{}')).toMatchObject({
      schemaVersion: 6,
      style: 'solarpunk',
      settings: { size: 5, linkw: 1 },
    }));
  });

  it('renders the mixed canvas with Cyberpunk material and authority-matched colors', async () => {
    const think = {
      ...empty('thinkgraph'),
      nodes: [
        { id: 'think-shared', label: 'Shared', properties: {} },
        { id: 'think-only', label: 'Think only', properties: {} },
      ],
      edges: [{
        id: 'think-edge', source: 'think-shared', target: 'think-only',
        predicate: 'REASONS_ABOUT', properties: { providerMarker: 'think' },
      }],
    };
    const know = {
      ...empty('knowgraph'),
      nodes: [
        { id: 'know-shared', label: 'Shared', properties: {} },
        { id: 'know-only', label: 'Know only', properties: {} },
      ],
      edges: [{
        id: 'know-edge', source: 'know-shared', target: 'know-only',
        predicate: 'SOURCED_BY', properties: { providerMarker: 'know' },
      }],
    };
    render(<JoinedKnowledgeGraphSurface
      projections={currentProjections(think, know)}
    />);
    const graph = forceGraphMocks.instances.at(-1);
    await waitFor(() => expect(graph.data.nodes).toHaveLength(3));
    expect(graph.setStyle).toHaveBeenCalledWith('cyber');

    expect(graph.data.nodes.find((node: any) => node.label === 'Shared')).toMatchObject({
      material_kind: 'joined-cyber', material_role: 'PAIRED_CYBER_MATERIAL',
      material_blue: '#4FA2AD', material_orange: '#F2A64A', material_surface: '#0B0E12',
    });
    expect(graph.data.nodes.find((node: any) => node.label === 'Think only')).toMatchObject({
      material_kind: 'joined-cyber', material_role: 'THINK_MATERIAL', material_blue: '#4FA2AD',
    });
    expect(graph.data.nodes.find((node: any) => node.label === 'Know only')).toMatchObject({
      material_kind: 'joined-cyber', material_role: 'KNOW_MATERIAL', material_orange: '#F2A64A',
    });
    expect(graph.data.links.map((edge: any) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      predicate: edge.predicate,
      authority: edge.material_authority,
      color: edge.material_color,
      providerMarker: edge.properties.providerMarker,
    }))).toEqual([
      {
        id: 'thinkgraph:think-edge', source: 'node-name:Shared', target: 'thinkgraph:think-only',
        predicate: 'REASONS_ABOUT', authority: 'thinkgraph', color: '#4FA2AD', providerMarker: 'think',
      },
      {
        id: 'knowgraph:know-edge', source: 'node-name:Shared', target: 'knowgraph:know-only',
        predicate: 'SOURCED_BY', authority: 'knowgraph', color: '#F2A64A', providerMarker: 'know',
      },
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Open graph settings' }));
    fireEvent.change(screen.getByLabelText('Think nodes'), { target: { value: '#123456' } });
    fireEvent.change(screen.getByLabelText('Know nodes'), { target: { value: '#abcdef' } });
    fireEvent.change(screen.getByLabelText('Think edges'), { target: { value: '#2468ac' } });
    fireEvent.change(screen.getByLabelText('Know edges'), { target: { value: '#ac6824' } });
    await waitFor(() => expect(graph.data.nodes.find((node: any) => node.label === 'Shared'))
      .toMatchObject({ material_blue: '#123456', material_orange: '#abcdef' }));
    expect(graph.data.nodes.find((node: any) => node.label === 'Think only').material_blue)
      .toBe('#123456');
    expect(graph.data.nodes.find((node: any) => node.label === 'Know only').material_orange)
      .toBe('#abcdef');
    expect(graph.data.links.map((edge: any) => edge.material_color))
      .toEqual(['#2468ac', '#ac6824']);
    expect(screen.getByRole('group', { name: 'Solarpunk colors' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Style'), { target: { value: 'classic' } });
    await waitFor(() => expect(graph.data.nodes.every((node: any) => !node.material_kind)).toBe(true));
    expect(graph.data.links.every((edge: any) => !edge.material_kind && !edge.material_color)).toBe(true);
    expect(graph.setThemeColors).toHaveBeenLastCalledWith({});
    expect(screen.queryByRole('group', { name: 'Solarpunk colors' })).toBeNull();
  });

  it('validates and reloads joined preferences without reading an old provider key', async () => {
    const oldKey = 'liquidaity.graph.thinkgraph.presentation.v1';
    const key = 'liquidaity.graph.joined.presentation.v1';
    window.localStorage.setItem(oldKey, 'leave-this-untouched');
    const projection = {
      ...empty('thinkgraph'),
      nodes: [{ id: 'subject', label: 'Subject', properties: {} }],
    };
    const first = renderJoinedProjection({ thinkgraph: projection });
    fireEvent.click(screen.getByRole('button', { name: 'Open graph settings' }));
    fireEvent.change(screen.getByRole('slider', { name: 'Node size' }), { target: { value: '7' } });
    fireEvent.change(screen.getByLabelText('Think nodes'), { target: { value: '#123456' } });
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem(key) || '{}')).toMatchObject({
      style: 'solarpunk', settings: { size: 7 }, solarpunkColors: { think: '#123456' },
    }));
    first.unmount();

    renderJoinedProjection({ thinkgraph: projection });
    fireEvent.click(screen.getByRole('button', { name: 'Open graph settings' }));
    expect((screen.getByLabelText('Style') as HTMLSelectElement).value).toBe('solarpunk');
    expect(screen.getByRole('slider', { name: 'Node size' }).getAttribute('value')).toBe('7');
    expect((screen.getByLabelText('Think nodes') as HTMLInputElement).value).toBe('#123456');
    expect(window.localStorage.getItem(oldKey)).toBe('leave-this-untouched');
  });

  it('rejects invalid persisted presentation values and keeps bounded defaults', () => {
    window.localStorage.setItem('liquidaity.graph.joined.presentation.v1', JSON.stringify({
      style: 'unknown', layout: 'everything', physicsProfile: 'unsafe',
      settings: { size: 99, font: 0, linkw: -1, labelDensity: 101, repel: -2,
        link: 1000, gravity: Infinity, labels: 'yes', arbitrary: 'kept' },
      solarpunkColors: {
        think: 'red', know: '#12345g',
        thinkRelationship: '#12345678', knowRelationship: 'orange',
      },
    }));
    renderJoinedProjection();
    fireEvent.click(screen.getByRole('button', { name: 'Open graph settings' }));

    expect((screen.getByLabelText('Style') as HTMLSelectElement).value).toBe('solarpunk');
    expect((screen.getByLabelText('Layout') as HTMLSelectElement).value).toBe('compact');
    expect((screen.getByLabelText('Physics profile') as HTMLSelectElement).value).toBe('galaxy');
    expect(screen.getByRole('slider', { name: 'Node size' }).getAttribute('value')).toBe('5');
    expect((screen.getByLabelText('Think nodes') as HTMLInputElement).value).toBe('#4fa2ad');
    expect((screen.getByLabelText('Know nodes') as HTMLInputElement).value).toBe('#f2a64a');
    expect((screen.getByLabelText('Think edges') as HTMLInputElement).value).toBe('#4fa2ad');
    expect((screen.getByLabelText('Know edges') as HTMLInputElement).value).toBe('#f2a64a');
  });

  it('displays the full union without inventing a join when no subject directory is supplied', async () => {
    const think = {
      ...empty('thinkgraph'),
      nodes: [
        { id: 'shared-think', canonicalId: 'think-entity', label: 'Shared', properties: {} },
        { id: 'canonical-only-think', canonicalId: 'same-canonical', label: 'Think name', properties: {} },
        { id: 'think-only', label: 'Think only', properties: {} },
      ],
      edges: [{ id: 'think-edge', source: 'shared-think', target: 'think-only', predicate: 'THINKS_WITH', properties: {} }],
    };
    const know = {
      ...empty('knowgraph'),
      nodes: [
        { id: 'shared-know', canonicalId: 'know-entity', label: 'Shared', properties: {} },
        { id: 'canonical-only-know', canonicalId: 'same-canonical', label: 'Know name', properties: {} },
        { id: 'know-only', label: 'Know only', properties: {} },
      ],
      edges: [{ id: 'know-edge', source: 'shared-know', target: 'know-only', predicate: 'KNOWS_WITH', properties: {} }],
    };
    render(<KnowledgeGraphFramework
      projections={{ thinkgraph: think, knowgraph: know }}
      errors={{}}
    />);
    await waitFor(() => expect(screen.getByTestId('knowledge-joined-surface')).toBeTruthy());
    const graph = forceGraphMocks.instances.at(-1);
    expect(forceGraphMocks.instances).toHaveLength(1);
    expect(graph.data.nodes.map((node: any) => node.label))
      .toEqual(['Shared', 'Think name', 'Think only', 'Shared', 'Know name', 'Know only']);
    expect(graph.data.links.map((edge: any) => edge.layer)).toEqual(['thinkgraph', 'knowgraph']);
    expect(screen.queryByRole('button', { name: 'Think relationships' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Know relationships' })).toBeNull();
    expect(graph.setLayers).not.toHaveBeenCalled();
    expect(screen.queryByRole('tablist', { name: 'Knowledge graph view' })).toBeNull();
    expect(graph.destroy).not.toHaveBeenCalled();
    expect(forceGraphMocks.instances).toHaveLength(1);
  });

  it('opens only the selected ThinkGraph entry and keeps graph settings separate', () => {
    const projection = { ...empty('thinkgraph'), nodes: [{ id: 'stored', label: 'Existing entry', properties: {
      evidence: [{ id: 'memory-one', title: 'Existing saved Think', ingestedAt: 100,
        summary: 'Saved Think.',
        metadata: { thinkgraph_origin: { authority: 'thinkgraph' }, relations: [] } }],
    } }] };
    renderJoinedProjection({ thinkgraph: projection });
    const graph = forceGraphMocks.instances.at(-1);
    act(() => graph.nodeClick(graph.data.nodes[0]));
    expect(screen.getByRole('region', { name: 'Existing entry details' }).textContent).toContain('Saved Think.');
    expect(screen.getByText('Existing saved Think')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Expand$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Use in chat' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close drawer' }));
    expect(screen.queryByRole('region', { name: 'Existing entry details' })).toBeNull();
    expect(screen.getByRole('complementary', { hidden: true }).getAttribute('data-open')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Open graph settings' }));
    expect(screen.getByRole('region', { name: 'Existing entry details' }).textContent)
      .toContain('Saved Think.');
  });

  it('shows two complete recent Thinks and keeps older direct Thinks in newest-first history', async () => {
    const remove = vi.fn().mockRejectedValue(new Error('Removal unavailable'));
    const paragraph = 'Rocket Lab launch cadence is a useful leading indicator only when the complete '
      + 'launch-services revenue attribution remains tied to completed customer missions across the '
      + 'four-quarter test; missing disclosure leaves the thesis unproven rather than contradicted.';
    const projection = { ...empty('thinkgraph'), nodes: [{ id: 'stored', label: 'Existing entry',
      properties: { evidence: [
        { id: 'memory-new', title: 'Neutron as discounted option value', summary: paragraph, ingestedAt: 300,
          metadata: { keywords: ['latest', 'decision'],
            thinkgraph_origin: { authority: 'thinkgraph' }, relations: [
            { source: 'Electron', relation: 'SUPPORTS', target: 'Execution quality' },
            { source: 'Neutron', relation: 'DEPENDS_ON', target: 'Launch cadence' },
            { source: 'Dilution', relation: 'AFFECTS', target: 'Neutron' },
          ] } },
        { id: 'memory-second', title: 'Second retained Think', summary: 'Second recent saved Think.', ingestedAt: 200,
          metadata: { thinkgraph_origin: { authority: 'thinkgraph' }, relations: [] } },
        { id: 'memory-old', title: 'Earlier retained Think', summary: 'Earlier saved Think.', ingestedAt: 100,
          metadata: { thinkgraph_origin: { authority: 'thinkgraph' }, relations: [] } },
      ] } }] };
    renderJoinedProjection({ thinkgraph: projection, onRemoveThinkGraphEvidence: remove });
    const graph = forceGraphMocks.instances.at(-1);
    act(() => graph.nodeClick(graph.data.nodes[0]));
    expect(screen.getByText('Recent Thinks')).toBeTruthy();
    expect(screen.getByText(paragraph)).toBeTruthy();
    expect(paragraph.length).toBeGreaterThan(140);
    expect(screen.getByText('Second recent saved Think.')).toBeTruthy();
    expect(screen.getByText('Neutron as discounted option value')).toBeTruthy();
    expect(screen.getByText('Second retained Think')).toBeTruthy();
    expect(screen.getByText('Relationships')).toBeTruthy();
    expect(screen.getByText('Electron SUPPORTS Execution quality')).toBeTruthy();
    expect(screen.getByText('Neutron DEPENDS_ON Launch cadence')).toBeTruthy();
    expect(screen.getByText('Dilution AFFECTS Neutron')).toBeTruthy();
    for (const rejected of ['Importance', 'Confidence', 'Probability', 'Technical details']) {
      expect(screen.queryByText(rejected)).toBeNull();
    }
    const earlier = screen.getByText('Earlier Thinks (1)').parentElement as HTMLDetailsElement;
    expect(earlier.open).toBe(false);
    expect(earlier.textContent).toContain('Earlier saved Think.');
    expect(earlier.textContent).toContain('Earlier retained Think');
    fireEvent.click(screen.getByText('Earlier Thinks (1)'));
    expect(earlier.open).toBe(true);
    expect(screen.getByText('Earlier saved Think.')).toBeTruthy();
    expect(document.querySelector('time')?.getAttribute('datetime'))
      .toBe('1970-01-01T00:05:00.000Z');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete record' })[0]);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Removal unavailable'));
    expect(remove).toHaveBeenCalledExactlyOnceWith('memory-new');
    expect(screen.getByText(paragraph)).toBeTruthy();
    expect(graph.data.nodes.map((node: any) => node.id)).toEqual(['stored']);
  });

  it('opens the exact selected relationship with its recorded claim and keeps diagnostics out of the inspector', () => {
    const projection = {
      ...empty('knowgraph'),
      nodes: [
        { id: 'source', label: 'Source', mentionCount: 1, properties: { summary: 'The recorded source summary.' } },
        { id: 'claim', label: 'Claim', mentionCount: 1 },
      ],
      edges: [{ id: 'evidence', source: 'source', target: 'claim', predicate: 'SUPPORTS', mentionCount: 1,
        properties: { fact: 'This source supports this claim within the recorded scope.' } }],
    };
    renderJoinedProjection({ knowgraph: projection });
    const graph = forceGraphMocks.instances.at(-1);
    act(() => graph.linkClick(graph.data.links[0]));
    const inspector = screen.getByTestId('knowgraph-edge-inspector');
    expect(inspector.getAttribute('data-relationship-id')).toBe('evidence');
    expect(inspector.textContent).toContain('SUPPORTS');
    expect(inspector.textContent).toContain(projection.edges[0].properties.fact);
    expect(screen.queryByTestId('knowgraph-node-inspector')).toBeNull();
    for (const label of ['Identity', 'Controls', 'Graph stats', 'Technical details']) {
      expect(screen.queryByText(label)).toBeNull();
    }
    expect(screen.queryByPlaceholderText('Find entity…')).toBeNull();
  });

  it.each(['thinkgraph', 'knowgraph'] as const)(
    'shows the meaningful Jev winner, natural relation, and full distribution for %s without system fields',
    authority => {
    const distribution = {
      QUALIFIES: 0.76,
      SUPPORTS: 0.14,
      ASSOCIATED_WITH: 0.10,
    };
    const projection = {
      ...empty(authority),
      nodes: [
        { id: 'jev', label: 'Jev', mentionCount: 1 },
        { id: 'thinkgraph', label: 'ThinkGraph', mentionCount: 1 },
      ],
      edges: [{
        id: 'semantic-edge', source: 'jev', target: 'thinkgraph', predicate: 'QUALIFIES',
        properties: {
          directed: true,
          relationship_strength: 0.76,
          label_confidence: 0.76,
          jev: {
            winner: 'QUALIFIES', distribution,
            vocabulary_version: 'jev.semantic-relationships.v1',
            natural_relationship: 'provides probabilistic semantic classification for',
          },
        },
      }],
    };
    renderJoinedProjection({
      ...(authority === 'thinkgraph'
        ? { thinkgraph: projection }
        : { knowgraph: projection }),
    });
    const graph = forceGraphMocks.instances.at(-1);
    act(() => graph.linkClick(graph.data.links[0]));

    expect(screen.getByText('Jev winner').nextSibling?.textContent).toBe('QUALIFIES');
    expect(screen.getByText('Probability').nextSibling?.textContent).toBe('76.0%');
    expect(screen.getByText('Natural extracted relationship').nextSibling?.textContent)
      .toBe('provides probabilistic semantic classification for');
    for (const implementationField of ['Edge ontology', 'Physics profile', 'Source graph', 'Entity ID', 'Record']) {
      expect(screen.queryByText(implementationField)).toBeNull();
    }
    const probabilityDetails = screen.getByText('Jev relationship probabilities')
      .parentElement as HTMLDetailsElement;
    expect(probabilityDetails.open).toBe(true);
    const probability = (choice: string) => Array.from(
      probabilityDetails.querySelectorAll('dt'),
    ).find(item => item.textContent === choice)?.nextElementSibling?.textContent;
    expect(probability('QUALIFIES')).toBe('76.0%');
    expect(probability('SUPPORTS')).toBe('14.0%');
    expect(probability('ASSOCIATED_WITH')).toBe('10.0%');
    const winner = Array.from(probabilityDetails.querySelectorAll('div'))
      .find(item => item.querySelector('dt')?.textContent === 'QUALIFIES')!;
    expect(winner.getAttribute('data-winner')).toBe('true');
    expect((winner.querySelector('.graph-jev-probability-fill') as HTMLElement).style.width)
      .toBe('76.0%');
    },
  );

  it('follows Graphiti episode references to citations without treating unrelated sources as evidence', () => {
    const projection = {
      ...empty('knowgraph'),
      nodes: [
        { id: 'company', label: 'Rocket Lab', mentionCount: 1, properties: { summary: 'Launch provider.' } },
        { id: 'mission', label: 'CAPSTONE', mentionCount: 1 },
      ],
      provenanceNodes: [
        { id: 'article', label: 'NASA launch report', type: 'Episodic', mentionCount: 1, properties: { content: JSON.stringify({ source_description: '["https://www.nasa.gov/mission"]', publisher: 'NASA', summary: 'The launch report.' }) } },
        { id: 'unrelated', label: 'Unrelated source', type: 'Episodic', mentionCount: 1, properties: { source_url: 'https://example.org/unrelated' } },
      ],
      edges: [{ id: 'launch', source: 'company', target: 'mission', predicate: 'PROVIDES', mentionCount: 1, properties: {
        portableKind: 'know', graphitiFactUuid: 'launch', supportingEpisodeUuids: ['article'],
        temporalStatus: 'current', createdAt: '2026-09-23T12:00:00Z',
        validAt: '2022-06-28T00:00:00Z', fact: 'Rocket Lab launched CAPSTONE.',
        graphitiRelation: 'provided launch services for',
        jev: { status: 'success', winner: 'PROVIDES', distribution: { PROVIDES: 0.9, ASSOCIATED_WITH: 0.1 } },
      } }],
    };
    renderJoinedProjection({ knowgraph: projection });
    const graph = forceGraphMocks.instances.at(-1);
    act(() => graph.linkClick(graph.data.links[0]));
    fireEvent.click(screen.getByText('NASA launch report'));
    expect(screen.getByRole('link', { name: 'Mission' }).getAttribute('href')).toBe('https://www.nasa.gov/mission');
    expect(screen.queryByRole('link', { name: 'example.org' })).toBeNull();
    expect(screen.getByTestId('knowgraph-edge-inspector').textContent).toContain('Rocket Lab launched CAPSTONE.');
    expect(screen.queryByTestId('portable-know')).toBeNull();
    expect(screen.getByTestId('knowgraph-edge-inspector').textContent).toContain('PROVIDES');
    expect(screen.getByText('Jev relationship probabilities')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Mission' })).toBeTruthy();
  });

  it('shows Graphiti episode citations as direct clickable sources on a selected Know', () => {
    const projection = {
      ...empty('knowgraph'),
      nodes: [
        { id: 'company', label: 'Rocket Lab', mentionCount: 1, properties: {} },
        { id: 'market', label: 'Launch market', mentionCount: 1, properties: {} },
      ],
      provenanceNodes: [
        {
          id: 'article', label: 'Rocket Lab Form 10-K', type: 'Episodic',
          properties: {
            content: 'Rocket Lab participates in the launch market.',
            source_url: 'https://www.sec.gov/Archives/rocket-lab-10-k',
            source_title: 'SEC filing',
          },
        },
        {
          id: 'unrelated', label: 'Unrelated source', type: 'Episodic',
          properties: { source_url: 'https://example.org/unrelated' },
        },
      ],
      edges: [{
        id: 'fact-visual', source: 'company', target: 'market', predicate: 'PARTICIPATES_IN',
        properties: {
          portableKind: 'know', graphitiFactUuid: 'fact-graphiti',
          fact: 'Rocket Lab participates in the launch market.',
          supportingEpisodeUuids: ['article'],
        },
      }],
    };
    renderJoinedProjection({ knowgraph: projection });
    const graph = forceGraphMocks.instances.at(-1);
    act(() => graph.nodeClick(graph.data.nodes[0]));

    expect(screen.getByTestId('know-records').textContent)
      .toContain('Rocket Lab participates in the launch market.');
    expect(screen.getAllByRole('link', { name: /SEC filing/ }).some(link => (
      link.getAttribute('href') === 'https://www.sec.gov/Archives/rocket-lab-10-k'
    ))).toBe(true);
    expect(screen.queryByRole('link', { name: 'example.org' })).toBeNull();
  });

  it('keeps paragraph Knows intact, limits the calm landing to two, and lists each supporting source', () => {
    const paragraph = 'Across the latest four reported quarters, Rocket Lab disclosed completed launch '
      + 'activity and total revenue growth, but the official releases did not provide mission-level '
      + 'launch-services revenue attribution sufficient to prove the proposed cadence thesis.';
    const packageUrls = [
      'https://investors.rocketlabcorp.com/news/third-quarter-2025-results',
      'https://investors.rocketlabcorp.com/news/fourth-quarter-2025-results',
      'https://investors.rocketlabcorp.com/news/third-quarter-2025-results',
    ];
    const projection = {
      ...empty('knowgraph'),
      nodes: [
        { id: 'company', label: 'Rocket Lab', properties: {} },
        { id: 'one', label: 'One', properties: {} },
        { id: 'two', label: 'Two', properties: {} },
        { id: 'three', label: 'Three', properties: {} },
      ],
      provenanceNodes: [{
        id: 'package', label: 'Quarterly research package', type: 'Episodic',
        properties: { source_description: JSON.stringify(packageUrls) },
      }],
      edges: [
        { id: 'edge-one', source: 'company', target: 'one', predicate: 'REPORTS', properties: {
          portableKind: 'know', graphitiFactUuid: 'fact-one', fact: paragraph,
          createdAt: '2026-10-03T12:03:00Z', supportingEpisodeUuids: ['package'], temporalStatus: 'current',
        } },
        { id: 'edge-two', source: 'company', target: 'two', predicate: 'REPORTS', properties: {
          portableKind: 'know', graphitiFactUuid: 'fact-two', fact: 'Second complete current Know.',
          createdAt: '2026-10-03T12:02:00Z', supportingEpisodeUuids: ['package'], temporalStatus: 'current',
        } },
        { id: 'edge-three', source: 'company', target: 'three', predicate: 'REPORTS', properties: {
          portableKind: 'know', graphitiFactUuid: 'fact-three', fact: 'Earlier complete Know.',
          createdAt: '2026-10-03T12:01:00Z', supportingEpisodeUuids: ['package'], temporalStatus: 'current',
        } },
      ],
    };
    renderJoinedProjection({ knowgraph: projection });
    const graph = forceGraphMocks.instances.at(-1);
    act(() => graph.nodeClick(graph.data.nodes.find((node: any) => node.id === 'company')));

    expect(paragraph.length).toBeGreaterThan(140);
    expect(screen.getByText(paragraph)).toBeTruthy();
    expect(screen.getByText('Second complete current Know.')).toBeTruthy();
    expect(screen.queryByText(/Research package/)).toBeNull();
    const earlier = screen.getByText('Earlier Knows (1)').parentElement!;
    expect(earlier.textContent).toContain('Earlier complete Know.');
    const sourceList = screen.getByRole('heading', { name: 'Sources' }).parentElement!;
    const sourceHrefs = Array.from(sourceList.querySelectorAll('a')).map(link => link.getAttribute('href'));
    expect(sourceHrefs).toEqual([
      'https://investors.rocketlabcorp.com/news/third-quarter-2025-results',
      'https://investors.rocketlabcorp.com/news/fourth-quarter-2025-results',
    ]);
    expect(sourceList.textContent).toContain('Third quarter 2025 results');
    expect(sourceList.textContent).toContain('Fourth quarter 2025 results');
    expect(sourceList.textContent).toContain('investors.rocketlabcorp.com');
  });

  it.each(['thinkgraph', 'knowgraph'] as const)('opens a compact movable %s inspector and preserves graph settings without exposing record plumbing', async authority => {
    const panelStyles = vi.spyOn(graphVisualTokens, 'graphInspectorPanelStyle');
    const key = `liquidaity.drawer.${authority}.width`;
    window.localStorage.setItem(key, '390');
    const projection = authority === 'thinkgraph'
      ? { ...empty(authority), nodes: [{ id: 'entity-1', label: 'Recorded subject',
        runId: 'run-1', conversationId: 'chat-1', createdAt: '2026-09-01',
        properties: { evidence: [{
          id: 'memory-one', ingestedAt: 100, summary: 'The complete Think summary.',
          metadata: { thinkgraph_origin: { authority: 'thinkgraph' } },
        }] },
        provenance: { author: 'Research Agent', correction: 'Source corrected its estimate.' } }] }
      : { ...empty(authority), nodes: [
        { id: 'entity-1', label: 'Recorded subject', runId: 'run-1', conversationId: 'chat-1' },
        { id: 'entity-target', label: 'Recorded target' },
      ], provenanceNodes: [{ id: 'episode-one', label: 'Recorded source', type: 'Episodic',
        properties: { content: 'The complete original statement.' } }], edges: [{
        id: 'fact-one', source: 'entity-1', target: 'entity-target', predicate: 'SUPPORTS',
        properties: { portableKind: 'know', graphitiFactUuid: 'fact-one',
          fact: 'The complete original statement.', supportingEpisodeUuids: ['episode-one'] },
      }] };
    const { container } = renderJoinedProjection({
      ...(authority === 'thinkgraph'
        ? { thinkgraph: projection }
        : { knowgraph: projection }),
    });
    const graph = forceGraphMocks.instances.at(-1);
    fireEvent.click(screen.getByRole('button', { name: 'Open graph settings' }));
    fireEvent.change(screen.getByRole('slider', { name: 'Node size' }), { target: { value: '5' } });
    act(() => graph.nodeClick(graph.data.nodes[0]));
    const panel = screen.getByRole('complementary');
    expect(panel.style.width).toBe('340px');
    expect(screen.getByLabelText('Move panel').textContent).toContain('Recorded subject');
    expect(container.querySelector('[data-testid$="-node-inspector"]')).toBe(document.activeElement);
    expect(panel.textContent).toContain(authority === 'thinkgraph'
      ? 'The complete Think summary.'
      : 'The complete original statement.');
    for (const implementationValue of ['entity-1', 'run-1', 'chat-1', 'Research Agent', 'entity-0']) {
      expect(panel.textContent).not.toContain(implementationValue);
    }
    expect(screen.queryByText('Record')).toBeNull();
    fireEvent.mouseDown(screen.getByLabelText('Resize drawer'), { clientX: 500 });
    fireEvent.mouseMove(window, { clientX: 490 });
    fireEvent.mouseUp(window);
    expect(panel.style.width).toBe('350px');
    expect(window.localStorage.getItem(key)).toBe('390');
    expect(screen.queryByRole('button', { name: 'Detach panel' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Dock panel' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Close drawer' })).toBeTruthy();
    vi.spyOn(panel.parentElement!, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, right: 1200, bottom: 800, width: 1200, height: 800, toJSON() {},
    });
    fireEvent.mouseDown(screen.getByLabelText('Move panel'), { clientX: 900, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 700, clientY: 180 });
    fireEvent.mouseUp(window);
    expect(panelStyles).toHaveBeenLastCalledWith(expect.objectContaining({ right: 'auto' }));
    expect((screen.getByLabelText('Move panel') as HTMLElement).style.cursor).toBe('move');
    fireEvent.mouseDown(screen.getByLabelText('Resize floating panel'), { clientX: 1000, clientY: 500 });
    fireEvent.mouseMove(window, { clientX: 1080, clientY: 560 });
    fireEvent.mouseUp(window);
    expect(panel.style.height).not.toBe('auto');
    fireEvent.click(screen.getByRole('button', { name: 'Close drawer' }));
    expect(screen.getByRole('complementary', { hidden: true }).getAttribute('data-open')).toBe('false');
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(screen.getByRole('complementary', { hidden: true }).getAttribute('data-open')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Open graph settings' }));
    expect(screen.getByRole('complementary').style.width).toBe('340px');
    expect(screen.getByLabelText('Move panel').textContent).toContain('Recorded subject');
    expect(screen.queryByRole('slider', { name: 'Node size' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close drawer' }));
    act(() => graph.backgroundClick());
    fireEvent.click(screen.getByRole('button', { name: 'Open graph settings' }));
    expect(screen.getByRole('slider', { name: 'Node size' }).getAttribute('value')).toBe('5');
    expect(screen.getByRole('complementary').style.width).toBe('340px');
    const styleSelect = screen.getByRole('combobox', { name: 'Style' }) as HTMLSelectElement;
    expect(styleSelect.value).toBe('solarpunk');
    expect([...styleSelect.options].map(option => option.textContent)).toContain('Solarpunk');
    expect(graph.data.nodes[0].material_kind).toBe('solarpunk');
    expect(screen.getByRole('group', { name: 'Solarpunk colors' })).toBeTruthy();
    expect(graph.setStyle).toHaveBeenLastCalledWith('cyber');
    fireEvent.change(styleSelect, { target: { value: 'cyber' } });
    await waitFor(() => expect(graph.data.nodes[0].material_kind).toBeUndefined());
    expect(screen.queryByRole('group', { name: 'Solarpunk colors' })).toBeNull();
    expect(graph.setThemeColors).toHaveBeenLastCalledWith({});
    expect(container.querySelector('.thinkgraph-entry')).toBeNull();
    expect(graph.setPreset).toHaveBeenCalledTimes(1);
    expect(graph.setPreset).toHaveBeenCalledWith('compact');
    expect(graph.setStyle).toHaveBeenCalledWith('cyber');
    expect(graph.fit).not.toHaveBeenCalled();
    expect(graph.data.nodes.map((node: any) => node.label)).toEqual(
      authority === 'thinkgraph' ? ['Recorded subject'] : ['Recorded subject', 'Recorded target'],
    );
    act(() => graph.nodeClick(graph.data.nodes[0]));
    act(() => graph.backgroundClick());
    expect(screen.getByRole('complementary', { hidden: true }).getAttribute('data-open')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Open graph settings' }));
    expect(screen.getByRole('combobox', { name: 'Layout' })).toBeTruthy();
    expect(screen.getByRole('complementary').style.width).toBe('340px');
  }, 20_000);
});
