import { describe, expect, it } from 'vitest';

import {
  buildGraphContextPacket,
  readCodeGraphContextFromCbm,
} from './graphContextBuilder';
import { createEmptyGraphContextPacket } from './graphContextPacket';

describe('graphContextBuilder', () => {
  it('queries the real CBM tool boundary and returns files, symbols, queries, and freshness', async () => {
    const calls: string[] = [];
    const result = await readCodeGraphContextFromCbm(
      {
        projectId: 'project_admin',
        repoPath: 'C:\\Projects\\main',
        userMessage: 'Context Packet Codebase Memory',
        maxItems: 5,
      },
      {
        now: () => '2026-06-13T00:00:00.000Z',
        callTool: async (tool) => {
          calls.push(tool);
          if (tool === 'list_projects') {
            return {
              projects: [{ name: 'C-Projects-main', root_path: 'C:/Projects/main' }],
            };
          }
          if (tool === 'index_status') {
            return { project: 'C-Projects-main', status: 'ready', nodes: 4640, edges: 8596 };
          }
          if (tool === 'search_graph') {
            return {
              results: [
                {
                  name: 'buildGraphContextPacket',
                  qualified_name:
                    'C-Projects-main.apps.backend.src.services.graphContext.graphContextBuilder.buildGraphContextPacket',
                  label: 'Function',
                  file_path: 'apps/backend/src/services/graphContext/graphContextBuilder.ts',
                },
              ],
            };
          }
          return { changed_count: 0, changed_files: [] };
        },
      },
    );

    expect(calls).toEqual(['list_projects', 'index_status', 'search_graph', 'detect_changes']);
    expect(result.data.relevantFiles).toEqual([
      'apps/backend/src/services/graphContext/graphContextBuilder.ts',
    ]);
    expect(result.data.relevantSymbols).toContain(
      'C-Projects-main.apps.backend.src.services.graphContext.graphContextBuilder.buildGraphContextPacket',
    );
    expect(result.data.codeAnchors).toEqual(result.data.relevantFiles);
    expect(result.data.cbmQueries).toEqual([
      'search_graph query="Context Packet Codebase Memory"',
    ]);
    expect(result.data.freshness).toMatchObject({
      status: 'fresh',
      project: 'C-Projects-main',
      nodes: 4640,
      edges: 8596,
    });
    expect(result.data.blocker).toBeNull();
  });

  it('returns a visible blocker when the CBM tool boundary is unavailable', async () => {
    const result = await readCodeGraphContextFromCbm(
      {
        projectId: 'project_admin',
        repoPath: 'C:\\Projects\\main',
        userMessage: 'Context Packet',
      },
      {
        callTool: async () => {
          throw new Error('stdio server offline');
        },
      },
    );

    expect(result.data.relevantFiles).toEqual([]);
    expect(result.data.freshness?.status).toBe('unavailable');
    expect(result.data.blocker).toContain('cbm_unavailable: stdio server offline');
    expect(result.debugNotes).toContain('cbm_unavailable: stdio server offline');
  });

  it('does not silently accept an empty CBM search result', async () => {
    const result = await readCodeGraphContextFromCbm(
      {
        projectId: 'project_admin',
        repoPath: 'C:\\Projects\\main',
        userMessage: 'symbol that does not exist',
      },
      {
        callTool: async (tool) => {
          if (tool === 'list_projects') {
            return {
              projects: [{ name: 'C-Projects-main', root_path: 'C:/Projects/main' }],
            };
          }
          if (tool === 'index_status') {
            return { project: 'C-Projects-main', status: 'ready', nodes: 4640, edges: 8596 };
          }
          if (tool === 'search_graph') return { results: [] };
          return { changed_count: 0, changed_files: [] };
        },
      },
    );

    expect(result.data.freshness?.status).toBe('fresh');
    expect(result.data.blocker).toBe('cbm_no_matching_code_evidence: symbol that does not exist');
    expect(result.debugNotes).toContain(
      'cbm_no_matching_code_evidence: symbol that does not exist',
    );
  });

  it('returns a valid packet for empty or unavailable graph data', async () => {
    const packet = await buildGraphContextPacket(
      {
        projectId: 'project_admin',
        userMessage: 'What do we know?',
        selectedBoardNodeIds: ['card_magentic'],
      },
      {
        now: () => '2026-06-06T00:00:00.000Z',
        readThinkGraphContext: async () => ({
          data: {
            intent: [],
            assumptions: [],
            hypotheses: [],
            uncertainties: [],
            goals: [],
            decisions: [],
            outcomes: [],
            reasoningNotes: [],
            confidenceNotes: [],
          },
          debugNotes: ['thinkgraph_unavailable: no project-scoped rows found'],
        }),
        readKnowGraphContext: async () => ({
          data: {
            entities: [],
            relations: [],
            evidence: [],
            sources: [],
            citations: [],
            provenance: [],
            confidence: [],
            timestamps: [],
          },
          debugNotes: ['knowgraph_unavailable: no project-scoped records found'],
        }),
        readCodeGraphContext: async () => ({
          data: {
            relevantFiles: [],
            relevantSymbols: [],
            codeAnchors: [],
            cbmQueries: ['search_graph query="What do we know?"'],
            components: [],
            routes: [],
            schemas: [],
            tools: [],
            agentCards: [],
            promptTemplates: [],
            implementationNotes: ['cbm_unavailable: test boundary offline'],
            freshness: {
              status: 'unavailable',
              project: null,
              nodes: null,
              edges: null,
              checkedAt: '2026-06-06T00:00:00.000Z',
              detail: 'cbm_unavailable: test boundary offline',
            },
            blocker: 'cbm_unavailable: test boundary offline',
          },
          debugNotes: ['cbm_unavailable: test boundary offline'],
        }),
      },
    );

    expect(packet.projectId).toBe('project_admin');
    expect(packet.selectedBoardContext.selectedNodeIds).toEqual(['card_magentic']);
    expect(packet.knowGraphContext.evidence).toEqual([]);
    expect(packet.provenance.debugNotes).toContain('thinkgraph_unavailable: no project-scoped rows found');
    expect(packet.provenance.debugNotes).toContain('knowgraph_unavailable: no project-scoped records found');
    expect(packet.codeGraphContext?.implementationNotes[0]).toContain('cbm_unavailable');
  });

  it('keeps ThinkGraph, KnowGraph, and CodeGraph streams separated', async () => {
    const packet = await buildGraphContextPacket(
      {
        projectId: 'project_admin',
      },
      {
        readThinkGraphContext: async () => ({
          data: {
            intent: ['research lithium battery recycling'],
            assumptions: ['need evidence-backed claims'],
            hypotheses: [],
            uncertainties: ['regional recycling capacity unclear'],
            goals: [],
            decisions: [],
            outcomes: [],
            reasoningNotes: ['Start with a research plan.'],
            confidenceNotes: ['intent: medium'],
          },
          sourceLabels: ['ThinkGraph'],
        }),
        readKnowGraphContext: async () => ({
          data: {
            entities: [{ id: 'entity_1', label: 'Lithium battery recycling', type: 'topic', confidence: 'high' }],
            relations: [],
            evidence: [
              {
                id: 'evidence_1',
                title: 'DOE recycling overview',
                snippet: 'Federal overview of recycling capacity.',
                sourceLabel: 'DOE',
                sourceUrl: 'https://energy.gov/example',
                provenance: 'research_agent',
                confidence: 'high',
                timestamp: '2026-06-06T00:00:00.000Z',
              },
            ],
            sources: [{ id: 'source_1', label: 'DOE', url: 'https://energy.gov/example', kind: 'url' }],
            citations: [],
            provenance: [{ id: 'prov_1', label: 'research_agent', confidence: 'high' }],
            confidence: ['DOE recycling overview: high'],
            timestamps: ['2026-06-06T00:00:00.000Z'],
          },
          sourceLabels: ['KnowGraph'],
        }),
        readCodeGraphContext: async () => ({
          data: {
            relevantFiles: ['client/src/pages/agentbuilder.tsx'],
            components: ['PlanMissionFlow'],
            routes: ['/api/projects/:projectId/decks/:deckId/run'],
            schemas: [],
            tools: ['local_coder'],
            agentCards: ['card_magentic'],
            promptTemplates: [],
            implementationNotes: ['CodeGraph context is partial but present.'],
          },
          sourceLabels: ['CodeGraph'],
        }),
      },
    );

    expect(packet.thinkGraphContext.intent).toEqual(['research lithium battery recycling']);
    expect(packet.knowGraphContext.evidence[0]?.sourceLabel).toBe('DOE');
    expect(packet.thinkGraphContext.reasoningNotes).not.toContain('Federal overview of recycling capacity.');
    expect(packet.codeGraphContext?.relevantFiles).toEqual(['client/src/pages/agentbuilder.tsx']);
    expect(packet.provenance.sourceLabels).toEqual(['ThinkGraph', 'KnowGraph', 'CodeGraph']);
  });

  it('preserves project id and reports unavailable streams honestly without inventing conflicts', async () => {
    const packet = await buildGraphContextPacket(
      {
        projectId: 'project_admin',
        selectedGraphNodeIds: ['kg:entity:lithium'],
      },
      {
        readThinkGraphContext: async () => {
          throw new Error('thinkgraph backend offline');
        },
        readKnowGraphContext: async () => ({
          data: {
            entities: [{ id: 'kg:entity:lithium', label: 'Lithium', type: 'element', confidence: 'medium' }],
            relations: [],
            evidence: [],
            sources: [],
            citations: [],
            provenance: [],
            confidence: [],
            timestamps: [],
          },
          sourceLabels: ['KnowGraph'],
        }),
        readCodeGraphContext: async () => ({
          data: null,
          debugNotes: ['codegraph_unavailable: no backend reader wired'],
        }),
      },
    );

    expect(packet.projectId).toBe('project_admin');
    expect(packet.selectedBoardContext.references.some((ref) => ref.id === 'kg:entity:lithium')).toBe(true);
    expect(packet.provenance.debugNotes.some((note) => note.includes('thinkgraph_unavailable'))).toBe(true);
    expect(packet.knowGraphContext.entities).toHaveLength(1);
    expect(packet.thinkGraphContext.intent).toEqual([]);
    expect(packet.comparison.conflicts).toEqual([]);
  });

  it('returns promptly with a visible non-critical KnowGraph timeout', async () => {
    const emptyPacket = createEmptyGraphContextPacket();
    const startedAt = Date.now();
    const packet = await buildGraphContextPacket(
      { projectId: 'project_admin', userMessage: 'Context Packet' },
      {
        sourceTimeoutMs: { graph_thinkgraph: 10, knowgraph: 10, codegraph_cbm: 10 },
        readThinkGraphContext: async () => ({ data: emptyPacket.thinkGraphContext }),
        readKnowGraphContext: () => new Promise(() => undefined),
        readCodeGraphContext: async () => ({ data: emptyPacket.codeGraphContext }),
      },
    );

    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(packet.provenance.sourceDiagnostics).toContainEqual(
      expect.objectContaining({
        source: 'knowgraph',
        critical: false,
        status: 'timed_out',
        blocker: 'source_timeout:knowgraph:10ms',
      }),
    );
  });

  it('records a critical CBM timeout without inventing code context', async () => {
    const emptyPacket = createEmptyGraphContextPacket();
    const packet = await buildGraphContextPacket(
      { projectId: 'project_admin', userMessage: 'Context Packet' },
      {
        sourceTimeoutMs: { graph_thinkgraph: 10, knowgraph: 10, codegraph_cbm: 10 },
        readThinkGraphContext: async () => ({ data: emptyPacket.thinkGraphContext }),
        readKnowGraphContext: async () => ({ data: emptyPacket.knowGraphContext }),
        readCodeGraphContext: () => new Promise(() => undefined),
      },
    );

    expect(packet.codeGraphContext).toBeNull();
    expect(packet.provenance.sourceDiagnostics).toContainEqual(
      expect.objectContaining({
        source: 'codegraph_cbm',
        critical: true,
        status: 'timed_out',
        blocker: 'source_timeout:codegraph_cbm:10ms',
      }),
    );
  });
});
