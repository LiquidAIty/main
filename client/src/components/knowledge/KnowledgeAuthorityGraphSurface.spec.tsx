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
import { sourceLinks } from './knowledgeGraphInspectorRecords';
import { linearAttachedWordSizeWeights } from './knowledgeGraphRendererProjection';
import {
  composeThinkKnowPresentation as composeProviderThinkKnowPresentation,
  type GraphProjectionV1,
} from './joinedKnowledgeGraphProjection';
import type { CanonicalEntityHeader } from './canonicalEntityDirectory';
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

  it('maps total attached Think and Know words onto one exact linear size scale', () => {
    const weights = linearAttachedWordSizeWeights([
      { id: 'least', label: 'Least', properties: { attachedWordCount: 10 } },
      { id: 'middle', label: 'Middle', properties: { attachedWordCount: 30 } },
      { id: 'most', label: 'Most', properties: { attachedWordCount: 50 } },
    ]);

    expect(weights.get('least')).toBe(0);
    expect(weights.get('middle')).toBe(0.5);
    expect(weights.get('most')).toBe(1);
  });

  const currentProjections = (
    think: GraphProjectionV1,
    know: GraphProjectionV1,
  ) => {
    const thinkNodes = think.nodes.map(node => ({
      ...node,
      canonicalName: node.canonicalName ?? node.label,
      projectId: node.projectId ?? think.projectId,
    }));
    const knowNodes = know.nodes.map(node => ({
      ...node,
      canonicalName: node.canonicalName ?? node.label,
      projectId: node.projectId ?? know.projectId,
    }));
    const thinkEntities = thinkNodes.filter(node => Boolean(node.canonicalName));
    const knowEntities = knowNodes.filter(node => (
      Boolean(node.canonicalName) && node.type !== 'Episodic'
    ));
    const byName = new Map<string, CanonicalEntityHeader>();
    for (const node of thinkEntities) {
      byName.set(node.canonicalName!, {
        authority: 'thinkgraph',
        engraphisEntityId: node.id,
        canonicalName: node.canonicalName!,
      });
    }
    for (const node of knowEntities) {
      const current = byName.get(node.canonicalName!);
      byName.set(node.canonicalName!, current?.authority === 'thinkgraph'
        ? {
          authority: 'both',
          engraphisEntityId: current.engraphisEntityId,
          graphitiEntityId: node.id,
          canonicalName: node.canonicalName!,
        }
        : {
          authority: 'knowgraph',
          graphitiEntityId: node.id,
          canonicalName: node.canonicalName!,
        });
    }
    const directory = {
      schemaVersion: 'graph-entity-directory' as const,
      projectId: think.projectId,
      complete: true as const,
      counts: {
        engraphis: thinkEntities.length,
        graphiti: knowEntities.length,
        total: byName.size,
      },
      revisions: { engraphis: 'think-current', graphiti: 'know-current' },
      entities: [...byName.values()],
      sha256: 'a'.repeat(64),
      bytes: 512,
      estimatedTokens: 128,
      readDurationMs: 1.25,
    };
    return {
      thinkgraph: {
        ...think,
        nodes: thinkNodes,
        canonicalEntityDirectory: directory,
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
    relevanceQuery,
    onReadEntityContext,
    onRemoveThinkGraphEvidence,
    onRemoveThinkGraphRelationship,
    onRemoveKnowGraphEvidence,
    onRemoveKnowGraphRelationship,
  }: {
    thinkgraph?: GraphProjectionV1;
    knowgraph?: GraphProjectionV1;
    strict?: boolean;
    relevanceQuery?: string;
    onReadEntityContext?: (
      entity: CanonicalEntityHeader,
      query: string,
      limit?: number,
      signal?: AbortSignal,
    ) => Promise<Record<string, any>>;
    onRemoveThinkGraphEvidence?: (memoryId: string) => Promise<void>;
    onRemoveThinkGraphRelationship?: (edgeId: string) => Promise<void>;
    onRemoveKnowGraphEvidence?: (episodeId: string) => Promise<void>;
    onRemoveKnowGraphRelationship?: (graphitiRelationshipId: string) => Promise<void>;
  } = {}) => {
    const projections = currentProjections(thinkgraph, knowgraph);
    const surface = (
      <JoinedKnowledgeGraphSurface
        projections={projections}
        relevanceQuery={relevanceQuery}
        onReadEntityContext={onReadEntityContext}
        onRemoveThinkGraphEvidence={onRemoveThinkGraphEvidence}
        onRemoveThinkGraphRelationship={onRemoveThinkGraphRelationship}
        onRemoveKnowGraphEvidence={onRemoveKnowGraphEvidence}
        onRemoveKnowGraphRelationship={onRemoveKnowGraphRelationship}
      />
    );
    return render(strict ? <StrictMode>{surface}</StrictMode> : surface);
  };

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
          properties: { evidence: [{ id: 'think-evidence' }], attachedWordCount: 10 } },
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
          properties: { evidence: [{ id: 'know-evidence' }], attachedWordCount: 30 } },
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
    expect(presentation.projection.nodes.find(node => node.id === sharedVisualId)
      ?.properties?.attachedWordCount).toBe(40);
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

  it('fails closed when provider lookup ids mismatch or directory authority disagrees with its ids', () => {
    const think = {
      ...empty('thinkgraph'),
      nodes: [{ id: 'think-shared', label: 'Shared', properties: {} }],
    };
    const know = {
      ...empty('knowgraph'),
      nodes: [{ id: 'know-shared', label: 'Shared', properties: {} }],
    };
    const mismatched = currentProjections(think, know);
    mismatched.thinkgraph.canonicalEntityDirectory!.entities[0] = {
      authority: 'both',
      engraphisEntityId: 'stale-think-shared',
      graphitiEntityId: 'know-shared',
      canonicalName: 'Shared',
    };
    const mismatchedPresentation = composeProviderThinkKnowPresentation(
      mismatched.thinkgraph, mismatched.knowgraph,
    );
    expect(mismatchedPresentation.projection.nodes).toHaveLength(2);
    expect(mismatchedPresentation.visualNodeIdByProviderMember.get('thinkgraph:think-shared'))
      .not.toBe(mismatchedPresentation.visualNodeIdByProviderMember.get('knowgraph:know-shared'));

    for (const malformed of [
      {
        authority: 'thinkgraph',
        engraphisEntityId: 'think-shared', graphitiEntityId: 'know-shared',
        canonicalName: 'Shared',
      },
      { authority: 'thinkgraph', canonicalName: 'Shared' },
    ]) {
      const current = currentProjections(think, know);
      current.thinkgraph.canonicalEntityDirectory!.entities[0] = (
        malformed as unknown as CanonicalEntityHeader
      );
      const presentation = composeProviderThinkKnowPresentation(
        current.thinkgraph, current.knowgraph,
      );
      expect(presentation.projection.nodes).toHaveLength(2);
      expect(presentation.projection.canonicalEntityDirectory).toBeUndefined();
    }
  });

  it('keeps ambiguous and cross-Project Entities separate while ignoring provider-local types', () => {
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
      { ...empty('thinkgraph'), nodes: [{ id: 'think-entity', label: 'Entity', type: 'person_or_concept', properties: {} }] },
      { ...empty('knowgraph'), nodes: [{ id: 'know-entity', label: 'Entity', type: 'Organization', properties: {} }] },
    );
    const currentThink = current.thinkgraph;
    const currentKnow = current.knowgraph;
    expect(composeThinkKnowPresentation(currentThink, currentKnow).projection.nodes.map(node => node.id))
      .toEqual(['node-name:Entity']);

    const otherProject = { ...currentKnow, projectId: 'project-2' };
    expect(composeThinkKnowPresentation(currentThink, otherProject).projection.nodes.map(node => node.id))
      .toEqual(['thinkgraph:think-entity', 'knowgraph:know-entity']);
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
    ['thinkgraph', 'ThinkGraph', 'KnowGraph'],
    ['knowgraph', 'KnowGraph', 'ThinkGraph'],
  ] as const)('shows only the real authority button for a mixed-canvas %s-only bundle', (authority, realTab, absentTab) => {
    const providerProjection = {
      ...empty(authority),
      nodes: [{
        id: `${authority}-only`,
        label: 'Single authority',
        properties: authority === 'thinkgraph' ? { evidence: [{
          id: 'memory-only', summary: 'One exact Think.',
          metadata: { thinkgraph_origin: { authority: 'thinkgraph' } },
        }] } : {},
      }],
    };
    render(<JoinedKnowledgeGraphSurface
      projections={{
        thinkgraph: authority === 'thinkgraph' ? providerProjection : empty('thinkgraph'),
        knowgraph: authority === 'knowgraph' ? providerProjection : empty('knowgraph'),
      }}
    />);
    const graph = forceGraphMocks.instances.at(-1);
    act(() => graph.nodeClick(graph.data.nodes[0]));

    expect(screen.getAllByRole('tab')).toHaveLength(1);
    expect(screen.getByRole('tab', { name: realTab })).toBeTruthy();
    expect(screen.getByRole('complementary').getAttribute('aria-label')).toBe('Single authority');
    expect(screen.getByRole('complementary').textContent).not.toContain(absentTab);
    expect(screen.queryByRole('tab', { name: absentTab })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Load$/ })).toBeNull();
  });

  it('renders direct Thinks, keeps Relationship facts on edges, and deletes the exact Relationship', async () => {
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
      onRemoveKnowGraphRelationship={removeKnow}
    />);
    const graph = forceGraphMocks.instances.at(-1);
    act(() => graph.nodeClick(graph.data.nodes.find((node: any) => node.label === 'Shared')));

    expect(screen.getByRole('tab', { name: 'ThinkGraph' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'KnowGraph' })).toBeTruthy();
    expect(screen.getByText('Direct Think summary.')).toBeTruthy();
    expect(screen.queryByText('Technical details')).toBeNull();
    expect(screen.queryByText('Reread contents')).toBeNull();
    expect(screen.queryByText('Use selected in chat')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'KnowGraph' }));
    expect(screen.queryByTestId('know-records')).toBeNull();
    expect(screen.queryByText('Direct sourced Know.')).toBeNull();
    act(() => graph.linkClick(graph.data.links.find((edge: any) => (
      edge.properties?.graphitiFactUuid === 'fact-graphiti-1'
    ))));
    expect(screen.getByTestId('knowgraph-edge-inspector').textContent)
      .toContain('Direct sourced Know.');
    expect(screen.queryByRole('link')).toBeNull();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Relationship' }));
    await waitFor(() => expect(removeKnow).toHaveBeenCalledExactlyOnceWith('visual-edge'));
    expect(removeThink).not.toHaveBeenCalled();
  });

  it('removes a ThinkGraph Relationship through the owning authority action', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const think = {
      ...empty('thinkgraph'),
      nodes: [
        { id: 'source', label: 'Source', properties: {} },
        { id: 'target', label: 'Target', properties: {} },
      ],
      edges: [{
        id: 'think-edge', source: 'source', target: 'target', predicate: 'SUPPORTS',
        properties: { reason: 'Current reasoning Relationship.' },
      }],
    };
    renderJoinedProjection({
      thinkgraph: think,
      onRemoveThinkGraphRelationship: remove,
    });
    const graph = forceGraphMocks.instances.at(-1);
    act(() => graph.linkClick(graph.data.links[0]));
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    fireEvent.click(screen.getByRole('button', { name: 'Remove Relationship' }));

    await waitFor(() => expect(remove).toHaveBeenCalledExactlyOnceWith('think-edge'));
  });

  it('defaults joined Entities to ThinkGraph and preserves the chosen authority lens across selections', () => {
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
          graphitiFactUuid: 'fact-a', fact: 'Know A.', temporalStatus: 'current',
        } },
        { id: 'edge-b', source: 'know-b', target: 'target-b', predicate: 'SUPPORTS', properties: {
          graphitiFactUuid: 'fact-b', fact: 'Know B.', temporalStatus: 'current',
        } },
        { id: 'edge-only', source: 'know-only', target: 'target-only', predicate: 'SUPPORTS', properties: {
          graphitiFactUuid: 'fact-only', fact: 'Know only record.', temporalStatus: 'current',
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
    expect(screen.getByRole('tab', { name: 'ThinkGraph' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Think A.')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'KnowGraph' }));
    expect(screen.getByRole('tab', { name: 'KnowGraph' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByTestId('know-records')).toBeNull();

    act(() => graph.nodeClick(node('Joined B')));
    expect(screen.getByRole('tab', { name: 'KnowGraph' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByText('Know B.')).toBeNull();

    act(() => graph.nodeClick(node('Think only')));
    expect(screen.getByRole('tab', { name: 'ThinkGraph' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Think only record.')).toBeTruthy();

    act(() => graph.nodeClick(node('Know only')));
    expect(screen.getByRole('tab', { name: 'KnowGraph' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByText('Know only record.')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('defaults an Entity with both attached Thinks and Knows to KnowGraph', () => {
    const think = { ...empty('thinkgraph'), nodes: [{
      id: 'think-shared', label: 'Shared Entity',
      properties: { evidence: [{ id: 'think-1', summary: 'Attached Think.', ingestedAt: 1 }] },
    }] };
    const know = { ...empty('knowgraph'), nodes: [{
      id: 'know-shared', label: 'Shared Entity',
      properties: { evidence: [{
        id: 'know-1', title: 'Attached Know', ingestedAt: 2,
        body: JSON.stringify({
          schemaVersion: 'know.v1',
          idea: {
            body: 'Attached Know For.',
            citations: [{ url: 'https://example.test/know-for' }],
          },
          counterIdea: {
            body: 'Attached Know Against.',
            citations: [{ url: 'https://example.test/know-against' }],
          },
        }),
        properties: {},
      }] },
    }] };
    render(<JoinedKnowledgeGraphSurface projections={currentProjections(think, know)} />);
    const graph = forceGraphMocks.instances.at(-1);

    act(() => graph.nodeClick(graph.data.nodes[0]));

    expect(screen.getByRole('tab', { name: 'KnowGraph' }).getAttribute('aria-selected'))
      .toBe('true');
    expect(screen.getByText('Attached Know For.')).toBeTruthy();
    expect(screen.getByText('Attached Know Against.')).toBeTruthy();
    expect(screen.queryByText('Attached Think.')).toBeNull();
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
          graphitiFactUuid: 'know-edge', fact: 'Know center.',
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
    expect(screen.queryByRole('combobox', { name: /view$/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Think view' }));
    expect(screen.getByRole('combobox', { name: 'Think view' })).toBeTruthy();
    expect(graph.setCollapse).toHaveBeenCalledWith(false);
    expect([...((screen.getByRole('combobox', { name: 'Think view' }) as HTMLSelectElement).options)]
      .map(option => option.value)).toEqual([
        'compact', 'original', 'communities', 'radial', 'galaxy',
      ]);
    for (const value of ['original', 'communities', 'radial', 'galaxy', 'compact']) {
      fireEvent.change(screen.getByRole('combobox', { name: 'Think view' }), { target: { value } });
      expect(graph.setPreset).toHaveBeenLastCalledWith(value);
      expect(graph.data.nodes).toEqual([]);
    }
    expect(screen.queryByRole('button', { name: /Freeze|Resume|Reheat|Focus/ })).toBeNull();
    expect(graph.freeze).not.toHaveBeenCalled();
    expect(graph.reheat).not.toHaveBeenCalled();
  });

  it('switches the color-key labels through native isolated views and empty canvas back to combined', async () => {
    const think = {
      ...empty('thinkgraph'),
      nodes: [{ id: 'think-entity', label: 'Think Entity', properties: { attachedWordCount: 4 } }],
    };
    const know = {
      ...empty('knowgraph'),
      nodes: [{
        id: 'know-entity', label: 'Know Entity', community_id: 'community-one',
        properties: { attachedWordCount: 8, communityId: 'community-one' },
      }],
    };
    render(<JoinedKnowledgeGraphSurface projections={currentProjections(think, know)} />);
    const graph = forceGraphMocks.instances.at(-1);
    const surface = screen.getByTestId('knowledge-joined-surface');

    expect(surface.getAttribute('data-view-mode')).toBe('combined');
    expect(surface.getAttribute('data-layout')).toBe('compact');
    expect(graph.data.nodes.map((node: any) => node.label).sort()).toEqual([
      'Know Entity', 'Think Entity',
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Think view' }));
    await waitFor(() => expect(surface.getAttribute('data-layout')).toBe('galaxy'));
    expect(surface.getAttribute('data-view-mode')).toBe('thinkgraph');
    expect(graph.data.nodes.map((node: any) => node.label)).toEqual(['Think Entity']);

    fireEvent.click(screen.getByRole('button', { name: 'Know view' }));
    await waitFor(() => expect(surface.getAttribute('data-layout')).toBe('communities'));
    expect(surface.getAttribute('data-view-mode')).toBe('knowgraph');
    expect(graph.data.nodes.map((node: any) => node.label)).toEqual(['Know Entity']);
    expect(graph.data.nodes[0].community_id).toBe('community-one');

    act(() => graph.backgroundClick());
    await waitFor(() => expect(surface.getAttribute('data-layout')).toBe('compact'));
    expect(surface.getAttribute('data-view-mode')).toBe('combined');
    expect(graph.data.nodes.map((node: any) => node.label).sort()).toEqual([
      'Know Entity', 'Think Entity',
    ]);
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
      nodes: [{ id: 'entity-one', label: 'Entity One' }, { id: 'entity-two', label: 'Entity Two' }],
      edges: [{ id: 'edge', source: 'entity-one', target: 'entity-two', predicate: 'DEPENDS_ON',
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
    expect(graph.data.nodes.map((node: any) => [node.id, node.label])).toEqual([
      ['thinkgraph:entity-one', 'Entity One'],
      ['thinkgraph:entity-two', 'Entity Two'],
    ]);
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
      schemaVersion: 7,
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
      schemaVersion: 7,
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
      nodes: [{ id: 'entity', label: 'Entity', properties: {} }],
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
    expect(screen.queryByRole('combobox', { name: /view$/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Think view' }));
    expect((screen.getByRole('combobox', { name: 'Think view' }) as HTMLSelectElement).value)
      .toBe('galaxy');
    expect((screen.getByLabelText('Physics profile') as HTMLSelectElement).value).toBe('galaxy');
    expect(screen.getByRole('slider', { name: 'Node size' }).getAttribute('value')).toBe('5');
    expect((screen.getByLabelText('Think nodes') as HTMLInputElement).value).toBe('#4fa2ad');
    expect((screen.getByLabelText('Know nodes') as HTMLInputElement).value).toBe('#f2a64a');
    expect((screen.getByLabelText('Think edges') as HTMLInputElement).value).toBe('#4fa2ad');
    expect((screen.getByLabelText('Know edges') as HTMLInputElement).value).toBe('#f2a64a');
  });

  it('displays the full union without inventing a join when no Entity directory is supplied', async () => {
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

  it('shows Relevant above distinct Recent and keeps Think depth inside More', async () => {
    const remove = vi.fn().mockRejectedValue(new Error('Removal unavailable'));
    const readEntityContext = vi.fn().mockResolvedValue({
      thinks: {
        relevanceStatus: 'success',
        decisionId: 'decision-one',
        relevant: [{
          engraphisMemoryId: 'memory-relevant',
          engraphisEntityId: 'stored',
          body: 'The most relevant optimistic steelman.',
          detail: 'Technical detail remains inside the same Think.',
          ingestedAt: 200,
          relevance: 0.91,
          relevanceRank: 1,
        }],
        recent: [{
          engraphisMemoryId: 'memory-recent',
          engraphisEntityId: 'stored',
          body: 'The distinct most recent Think.',
          ingestedAt: 300,
        }],
      },
      knows: { relevanceStatus: 'empty', decisionId: null, relevant: [], recent: [] },
    });
    const paragraph = 'Rocket Lab launch cadence is a useful leading indicator only when the complete '
      + 'launch-services revenue attribution remains tied to completed customer missions across the '
      + 'four-quarter test; missing disclosure leaves the thesis unproven rather than contradicted.';
    const projection = { ...empty('thinkgraph'), nodes: [{ id: 'stored', label: 'Existing entry',
      properties: { evidence: [
        { id: 'memory-new', title: 'Neutron as discounted option value', summary: paragraph, ingestedAt: 300,
          metadata: { keywords: ['latest', 'decision'],
            thinkgraph_origin: { authority: 'thinkgraph' }, structured_extraction: { think: {
              detail: 'Technical detail remains inside the same Think.',
              relationships: [
                { source: 'Electron', relation: 'SUPPORTS', target: 'Execution quality' },
                { source: 'Neutron', relation: 'DEPENDS_ON', target: 'Launch cadence' },
                { source: 'Dilution', relation: 'AFFECTS', target: 'Neutron' },
              ],
            } } } },
        { id: 'memory-second', title: 'Second retained Think', summary: 'Second recent saved Think.', ingestedAt: 200,
          metadata: { thinkgraph_origin: { authority: 'thinkgraph' }, relations: [] } },
        { id: 'memory-old', title: 'Earlier retained Think', summary: 'Earlier saved Think.', ingestedAt: 100,
          metadata: { thinkgraph_origin: { authority: 'thinkgraph' }, relations: [] } },
      ] } }] };
    renderJoinedProjection({
      thinkgraph: projection,
      relevanceQuery: 'current user request',
      onReadEntityContext: readEntityContext,
      onRemoveThinkGraphEvidence: remove,
    });
    const graph = forceGraphMocks.instances.at(-1);
    act(() => graph.nodeClick(graph.data.nodes[0]));
    await waitFor(() => expect(screen.getByText('The most relevant optimistic steelman.')).toBeTruthy());
    expect(screen.getByRole('heading', { name: 'Relevant' })).toBeTruthy();
    expect(screen.queryByText('The distinct most recent Think.')).toBeNull();
    expect(screen.queryByText('Relationships')).toBeNull();
    expect(screen.queryByText('Electron SUPPORTS Execution quality')).toBeNull();
    fireEvent.click(screen.getByText('More'));
    expect(screen.getByText('Technical detail remains inside the same Think.')).toBeTruthy();
    for (const rejected of ['Importance', 'Confidence', 'Probability']) {
      expect(screen.queryByText(rejected)).toBeNull();
    }
    expect(screen.queryByText(paragraph)).toBeNull();
    expect(screen.queryByText('Second recent saved Think.')).toBeNull();
    expect(screen.queryByText('Earlier saved Think.')).toBeNull();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove Think' })[0]);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Removal unavailable'));
    expect(remove).toHaveBeenCalledExactlyOnceWith('memory-relevant');
    fireEvent.click(screen.getByRole('button', { name: 'Show Recent' }));
    expect(screen.getByRole('heading', { name: 'Recent' })).toBeTruthy();
    expect(screen.getByText('The distinct most recent Think.')).toBeTruthy();
    expect(screen.queryByText('The most relevant optimistic steelman.')).toBeNull();
    expect(graph.data.nodes.map((node: any) => node.id)).toEqual(['thinkgraph:stored']);
  });

  it('shows one Relevant and one Recent two-sided Know with citations and More', async () => {
    const removeKnow = vi.fn().mockResolvedValue(undefined);
    const readEntityContext = vi.fn().mockResolvedValue({
      thinks: { relevanceStatus: 'empty', decisionId: null, relevant: [], recent: [] },
      knows: {
        relevanceStatus: 'success',
        decisionId: 'decision-two',
        relevant: [{
          graphitiEpisodeId: 'know-relevant',
          graphitiEntityId: 'rocket-lab',
          idea: {
            body: 'Relevant evidence supports the launch thesis.',
            detail: 'The longer source-grounded explanation remains available on demand.',
            citations: [{
              url: 'https://example.test/relevant-for', title: 'For source',
              publisher: 'Example Space', locator: 'p. 4',
              supports: 'Supports the completed-launch count.',
            }],
          },
          counterIdea: {
            body: 'Relevant evidence also shows execution risk.',
            citations: [{
              url: 'https://example.test/relevant-against', title: 'Against source',
            }],
          },
          ingestedAt: 200,
          relevance: 0.92,
          relevanceRank: 1,
        }],
        recent: [{
          graphitiEpisodeId: 'know-recent',
          graphitiEntityId: 'rocket-lab',
          idea: {
            body: 'Recent evidence supports the current move.',
            citations: [{ url: 'https://example.test/recent-for' }],
          },
          counterIdea: {
            body: 'Recent evidence challenges the current move.',
            citations: [{ url: 'https://example.test/recent-against' }],
          },
          ingestedAt: 300,
        }],
      },
    });
    const projection = { ...empty('knowgraph'), nodes: [{
      id: 'rocket-lab',
      label: 'Rocket Lab',
      properties: { evidence: [
        {
          id: 'know-new', title: 'Launch cadence', ingestedAt: 300,
          body: JSON.stringify({
            body: 'Rocket Lab completed the cited launch cadence.',
            detail: 'The longer source-grounded explanation remains available on demand.',
            citations: [{
              url: 'https://example.test/launch-report',
              title: 'Launch report',
              publisher: 'Example Space',
              locator: 'p. 4',
              supports: 'Supports the completed-launch count.',
            }],
          }),
          properties: {},
        },
        {
          id: 'know-second', title: 'Revenue attribution', ingestedAt: 200,
          body: JSON.stringify({
            body: 'Launch-services revenue remains separately attributable.',
            citations: [{ url: 'https://example.test/filing', title: 'Annual filing' }],
          }),
          properties: {},
        },
        {
          id: 'know-third', title: 'Hidden third Know', ingestedAt: 100,
          body: 'This third Know must not enter the two-record surface.',
          properties: { source_url: 'https://example.test/third' },
        },
      ] },
    }] };
    renderJoinedProjection({
      knowgraph: projection,
      relevanceQuery: 'current user request',
      onReadEntityContext: readEntityContext,
      onRemoveKnowGraphEvidence: removeKnow,
    });
    const graph = forceGraphMocks.instances.at(-1);
    act(() => graph.nodeClick(graph.data.nodes[0]));

    await waitFor(() => expect(screen.getByText('Relevant evidence supports the launch thesis.')).toBeTruthy());
    expect(screen.getByRole('heading', { name: 'Relevant' })).toBeTruthy();
    expect(screen.getByText('Relevant evidence also shows execution risk.')).toBeTruthy();
    expect(screen.queryByText('Recent evidence supports the current move.')).toBeNull();
    expect(screen.queryByText('Recent evidence challenges the current move.')).toBeNull();
    expect(screen.getAllByText('For')).toHaveLength(1);
    expect(screen.getAllByText('Against')).toHaveLength(1);
    expect(screen.queryByText('This third Know must not enter the two-record surface.')).toBeNull();
    expect(screen.getByRole('link', { name: 'For source' }).getAttribute('href'))
      .toBe('https://example.test/relevant-for');
    expect(screen.getByRole('link', { name: 'Against source' }).getAttribute('href'))
      .toBe('https://example.test/relevant-against');
    expect(screen.getByText('Example Space · p. 4')).toBeTruthy();
    expect(screen.getByText('Supports the completed-launch count.')).toBeTruthy();
    const more = screen.getByText('More').parentElement as HTMLDetailsElement;
    expect(more.open).toBe(false);
    fireEvent.click(screen.getByText('More'));
    expect(more.open).toBe(true);
    expect(screen.getByText('The longer source-grounded explanation remains available on demand.'))
      .toBeTruthy();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove Know' })[0]);
    await waitFor(() => expect(removeKnow).toHaveBeenCalledExactlyOnceWith('know-relevant'));
    fireEvent.click(screen.getByRole('button', { name: 'Show Recent' }));
    expect(screen.getByRole('heading', { name: 'Recent' })).toBeTruthy();
    expect(screen.getByText('Recent evidence supports the current move.')).toBeTruthy();
    expect(screen.getByText('Recent evidence challenges the current move.')).toBeTruthy();
    expect(screen.queryByText('Relevant evidence supports the launch thesis.')).toBeNull();

    fireEvent.change(screen.getByRole('combobox', { name: 'Results' }), {
      target: { value: '2' },
    });
    await waitFor(() => expect(readEntityContext.mock.calls.at(-1)?.[2]).toBe(2));
    const search = screen.getByRole('textbox', { name: 'Search' });
    fireEvent.change(search, { target: { value: 'launch risk' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Knowledge search' }));
    await waitFor(() => expect(readEntityContext.mock.calls.at(-1)?.[1]).toBe('launch risk'));
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

  it('keeps Citations off Relationship edges while preserving their readable fact and Jev state', () => {
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
        graphitiFactUuid: 'launch', supportingEpisodeUuids: ['article'],
        temporalStatus: 'current', createdAt: '2026-09-23T12:00:00Z',
        validAt: '2022-06-28T00:00:00Z', fact: 'Rocket Lab launched CAPSTONE.',
        graphitiRelation: 'provided launch services for',
        jev: { status: 'success', winner: 'PROVIDES', distribution: { PROVIDES: 0.9, ASSOCIATED_WITH: 0.1 } },
      } }],
    };
    renderJoinedProjection({ knowgraph: projection });
    const graph = forceGraphMocks.instances.at(-1);
    act(() => graph.linkClick(graph.data.links[0]));
    expect(screen.getByTestId('knowgraph-edge-inspector').textContent).toContain('Rocket Lab launched CAPSTONE.');
    expect(screen.queryByTestId('portable-know')).toBeNull();
    expect(screen.getByTestId('knowgraph-edge-inspector').textContent).toContain('PROVIDES');
    expect(screen.getByText('Jev relationship probabilities')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Sources' })).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('does not fabricate an Entity Know or Citation from an incident Relationship episode', () => {
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
          graphitiFactUuid: 'fact-graphiti',
          fact: 'Rocket Lab participates in the launch market.',
          supportingEpisodeUuids: ['article'],
        },
      }],
    };
    renderJoinedProjection({ knowgraph: projection });
    const graph = forceGraphMocks.instances.at(-1);
    act(() => graph.nodeClick(graph.data.nodes[0]));

    expect(screen.queryByTestId('know-records')).toBeNull();
    expect(screen.queryByText('Rocket Lab participates in the launch market.')).toBeNull();
    expect(screen.queryByRole('link', { name: /SEC filing/ })).toBeNull();
    expect(screen.queryByRole('link', { name: 'example.org' })).toBeNull();
  });

  it('keeps long Relationship facts on their arrows and never copies them onto the Entity', () => {
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
          graphitiFactUuid: 'fact-one', fact: paragraph,
          createdAt: '2026-10-03T12:03:00Z', supportingEpisodeUuids: ['package'], temporalStatus: 'current',
        } },
        { id: 'edge-two', source: 'company', target: 'two', predicate: 'REPORTS', properties: {
          graphitiFactUuid: 'fact-two', fact: 'Second complete current Know.',
          createdAt: '2026-10-03T12:02:00Z', supportingEpisodeUuids: ['package'], temporalStatus: 'current',
        } },
        { id: 'edge-three', source: 'company', target: 'three', predicate: 'REPORTS', properties: {
          graphitiFactUuid: 'fact-three', fact: 'Earlier complete Know.',
          createdAt: '2026-10-03T12:01:00Z', supportingEpisodeUuids: ['package'], temporalStatus: 'current',
        } },
      ],
    };
    renderJoinedProjection({ knowgraph: projection });
    const graph = forceGraphMocks.instances.at(-1);
    const company = graph.data.nodes.find((node: any) => node.id === 'knowgraph:company');
    expect(company).toBeTruthy();
    act(() => graph.nodeClick(company));

    expect(paragraph.length).toBeGreaterThan(140);
    expect(screen.queryByText(paragraph)).toBeNull();
    expect(screen.queryByText('Second complete current Know.')).toBeNull();
    expect(screen.queryByText('Earlier complete Know.')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Sources' })).toBeNull();

    act(() => graph.linkClick(graph.data.links.find((edge: any) => (
      edge.properties?.graphitiFactUuid === 'fact-one'
    ))));
    expect(screen.getByText(paragraph)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Sources' })).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it.each(['thinkgraph', 'knowgraph'] as const)('opens a compact movable %s inspector and preserves graph settings without exposing record plumbing', async authority => {
    const panelStyles = vi.spyOn(graphVisualTokens, 'graphInspectorPanelStyle');
    const key = `liquidaity.drawer.${authority}.width`;
    window.localStorage.setItem(key, '390');
    const projection = authority === 'thinkgraph'
      ? { ...empty(authority), nodes: [{ id: 'entity-1', label: 'Recorded Entity',
        runId: 'run-1', conversationId: 'chat-1', createdAt: '2026-09-01',
        properties: { evidence: [{
          id: 'memory-one', ingestedAt: 100, summary: 'The complete Think summary.',
          metadata: { thinkgraph_origin: { authority: 'thinkgraph' } },
        }] },
        provenance: { author: 'Research Agent', correction: 'Source corrected its estimate.' } }] }
      : { ...empty(authority), nodes: [
        { id: 'entity-1', label: 'Recorded Entity', runId: 'run-1', conversationId: 'chat-1' },
        { id: 'entity-target', label: 'Recorded target' },
      ], provenanceNodes: [{ id: 'episode-one', label: 'Recorded source', type: 'Episodic',
        properties: { content: 'The complete original statement.' } }], edges: [{
        id: 'fact-one', source: 'entity-1', target: 'entity-target', predicate: 'SUPPORTS',
        properties: { graphitiFactUuid: 'fact-one',
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
    expect(screen.getByLabelText('Move panel').textContent).toContain('Recorded Entity');
    expect(container.querySelector('[data-testid$="-node-inspector"]')).toBe(document.activeElement);
    if (authority === 'thinkgraph') {
      expect(panel.textContent).toContain('The complete Think summary.');
    } else {
      expect(panel.textContent).not.toContain('The complete original statement.');
    }
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
    expect(screen.getByLabelText('Move panel').textContent).toContain('Recorded Entity');
    expect(screen.queryByRole('slider', { name: 'Node size' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close drawer' }));
    act(() => graph.backgroundClick());
    fireEvent.click(screen.getByRole('button', { name: 'Open graph settings' }));
    expect(screen.getByRole('slider', { name: 'Node size' }).getAttribute('value')).toBe('5');
    expect(screen.getByRole('complementary').style.width).toBe('340px');
    const styleSelect = screen.getByRole('combobox', { name: 'Style' }) as HTMLSelectElement;
    expect(styleSelect.value).toBe('solarpunk');
    expect([...styleSelect.options].map(option => option.textContent)).toContain('Solarpunk');
    expect(graph.data.nodes[0].material_kind).toBe('joined-cyber');
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
      authority === 'thinkgraph' ? ['Recorded Entity'] : ['Recorded Entity', 'Recorded target'],
    );
    act(() => graph.nodeClick(graph.data.nodes[0]));
    act(() => graph.backgroundClick());
    expect(screen.getByRole('complementary', { hidden: true }).getAttribute('data-open')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Open graph settings' }));
    expect(screen.queryByRole('combobox', { name: /view$/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Know view' }));
    expect([...((screen.getByRole('combobox', { name: 'Know view' }) as HTMLSelectElement).options)]
      .map(option => option.value)).toEqual([
        'compact', 'original', 'communities', 'radial', 'galaxy',
      ]);
    expect(screen.getByRole('complementary').style.width).toBe('340px');
  }, 20_000);
});
