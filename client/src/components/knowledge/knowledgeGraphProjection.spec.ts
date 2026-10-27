/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: Project Knowledge Graph
 * Relationship: This file verifies exact provider-owned Entity projections compose into one joined view only through the complete canonical directory while preserving records, edges, and authority.
 * Entity: ThinkGraph
 * Relationship: This file verifies Engraphis Entity and relationship records retain their exact provider identity in the joined presentation.
 * Entity: KnowGraph
 * Relationship: This file verifies Graphiti Entity and relationship records retain their exact provider identity in the joined presentation.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_GRAPH_LAYER_VISIBILITY,
  composeThinkKnowPresentation as composeAuthorityThinkKnowPresentation,
  composeVisibleGraphLayers,
  type GraphProjectionV1,
} from './knowledgeGraphProjection';

const empty = (authority: 'thinkgraph' | 'knowgraph'): GraphProjectionV1 => ({
  schemaVersion: authority === 'thinkgraph'
    ? 'thinkgraph.engraphis.v1'
    : 'knowgraph.projection.v1',
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
  const thinkEntities = thinkNodes.filter(node => Boolean(node.canonicalName));
  const knowEntities = knowNodes.filter(node => Boolean(node.canonicalName));
  const entitiesByName = new Map<string, any>();
  for (const node of thinkEntities) {
    entitiesByName.set(String(node.canonicalName), {
      authority: 'thinkgraph' as const,
      canonicalName: String(node.canonicalName),
      engraphisEntityId: node.id,
    });
  }
  for (const node of knowEntities) {
    const canonicalName = String(node.canonicalName);
    const current = entitiesByName.get(canonicalName);
    entitiesByName.set(canonicalName, current ? {
      authority: 'both' as const,
      canonicalName,
      engraphisEntityId: current.engraphisEntityId,
      graphitiEntityId: node.id,
    } : {
      authority: 'knowgraph' as const,
      canonicalName,
      graphitiEntityId: node.id,
    });
  }
  const entities = [...entitiesByName.values()];
  const directory = {
    schemaVersion: 'graph-entity-directory' as const,
    projectId: think.projectId,
    complete: true as const,
    counts: {
      engraphis: thinkEntities.length,
      graphiti: knowEntities.length,
      total: entities.length,
    },
    revisions: { engraphis: 'think-current', graphiti: 'know-current' },
    entities,
    sha256: 'a'.repeat(64),
    bytes: 512,
    estimatedTokens: 128,
    readDurationMs: 1,
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
  return composeAuthorityThinkKnowPresentation(
    projections.thinkgraph, projections.knowgraph,
  );
};

describe('knowledge graph projection composition', () => {
  it('groups one exact authoritative Entity per authority while retaining provider evidence and edges', () => {
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

  it('keeps ambiguous and cross-Project Entities separate while the exact directory owns identity', () => {
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
    expect(composeAuthorityThinkKnowPresentation(currentThink, currentKnow).projection.nodes.map(node => node.id))
      .toEqual(['node-name:Subject']);
  
    const otherProject = { ...currentKnow, projectId: 'project-2' };
    expect(composeAuthorityThinkKnowPresentation(currentThink, otherProject).projection.nodes.map(node => node.id))
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

  it('adds Code as an isolated visual layer without cross-authority identity or edges', () => {
    const current = currentProjections(
      {
        ...empty('thinkgraph'),
        nodes: [{ id: 'think-shared', label: 'Shared', properties: {} }],
      },
      {
        ...empty('knowgraph'),
        nodes: [{ id: 'know-shared', label: 'Shared', properties: {} }],
      },
    );
    const code: GraphProjectionV1 = {
      schemaVersion: 'codegraph.projection.v1',
      authority: 'codegraph',
      projectId: 'project-1',
      nodes: [
        { id: 'feature:shared', label: 'Shared', authority: 'codegraph', type: 'Feature', etype: 'Feature', properties: { recordKind: 'feature', featureName: 'Shared' } },
        { id: 'file:shared', label: 'shared.ts', authority: 'codegraph', type: 'File', etype: 'File', properties: { recordKind: 'file', filePath: 'client/shared.ts', qualifiedName: 'file:shared' } },
      ],
      edges: [{ id: 'feature-file', source: 'feature:shared', target: 'file:shared', predicate: 'FEATURE_CONTRIBUTION' }],
    };
    const before = structuredClone({ current, code });

    const defaultView = composeVisibleGraphLayers(
      current.thinkgraph,
      current.knowgraph,
      code,
      { ...DEFAULT_GRAPH_LAYER_VISIBILITY },
    );
    expect(defaultView.projection.nodes.map(node => node.label)).toEqual(['Shared']);
    expect(defaultView.codeNodeVariants).toEqual(new Map());

    const withCode = composeVisibleGraphLayers(
      current.thinkgraph,
      current.knowgraph,
      code,
      { ...DEFAULT_GRAPH_LAYER_VISIBILITY, codegraph: true },
    );
    const codeVisualId = withCode.visualNodeIdByCodeProviderMember?.get('feature:shared');
    expect(codeVisualId).toBe('codegraph:feature%3Ashared');
    expect(withCode.projection.nodes.map(node => [node.id, node.label])).toEqual([
      ['node-name:Shared', 'Shared'],
      ['codegraph:feature%3Ashared', 'Shared'],
      ['codegraph:file%3Ashared', 'shared.ts'],
    ]);
    expect(withCode.codeNodeVariants?.get(codeVisualId!)).toBe(code.nodes[0]);
    expect(withCode.projection.edges).toEqual([
      expect.objectContaining({
        id: 'codegraph:feature-file',
        source: 'codegraph:feature%3Ashared',
        target: 'codegraph:file%3Ashared',
        layer: 'codegraph',
      }),
    ]);
    expect(withCode.projection.edges.every(edge => (
      edge.source.startsWith('codegraph:') && edge.target.startsWith('codegraph:')
    ))).toBe(true);

    const withoutThink = composeVisibleGraphLayers(
      current.thinkgraph,
      current.knowgraph,
      code,
      { thinkgraph: false, knowgraph: true, codegraph: true },
    );
    const knowOnlyVisualId = withoutThink.visualNodeIdByProviderMember.get(
      'knowgraph:know-shared',
    );
    expect(withoutThink.nodeVariants.get(knowOnlyVisualId!)?.map(item => item.authority))
      .toEqual(['knowgraph']);
    expect({ current, code }).toEqual(before);
  });

});
