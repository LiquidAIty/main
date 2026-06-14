import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  LOCALCODER_CBM_REQUIRED_FILES,
  runLocalCoderCbmScopeGate,
} from './cbmScopeGate';
import {
  assessCbmFreshness,
  buildGraphContextPacket,
  listRelevantSourceFiles,
  KNOWGRAPH_NODE_CONTEXT_QUERY,
  KNOWGRAPH_RELATION_CONTEXT_QUERY,
  readCodeGraphContextFromCbm,
} from './graphContextBuilder';
import { createEmptyGraphContextPacket } from './graphContextPacket';

describe('graphContextBuilder', () => {
  const indexedBuilderFile =
    'apps/backend/src/services/graphContext/graphContextBuilder.ts';

  it('honors root-anchored CBM exclusions without hiding the owned nested LocalCoder adapter', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'liquidaity-cbm-scope-'));
    const files = [
      '.cbmignore',
      'localcoder/src/vendored.ts',
      'worldsignal/server.mjs',
      'apps/backend/src/coder/localcoder/adapter.ts',
      'apps/backend/src/contracts/coderContracts.ts',
    ];
    for (const file of files) {
      const absolute = path.join(root, file);
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(
        absolute,
        file === '.cbmignore' ? '/localcoder/\n/worldsignal/\nnode_modules/\n' : 'export {};\n',
      );
    }

    const inventory = await listRelevantSourceFiles(root);

    expect(inventory.files).toContain('apps/backend/src/coder/localcoder/adapter.ts');
    expect(inventory.files).toContain('apps/backend/src/contracts/coderContracts.ts');
    expect(inventory.files).not.toContain('localcoder/src/vendored.ts');
    expect(inventory.files).not.toContain('worldsignal/server.mjs');
  });

  it('runs a real index action before allowing the LocalCoder scoped CBM gate', async () => {
    const calls: string[] = [];
    const result = await runLocalCoderCbmScopeGate('C:\\Projects\\main', {
      callTool: async (tool) => {
        calls.push(tool);
        if (tool === 'index_repository') return { status: 'indexed' };
        if (tool === 'list_projects') {
          return {
            projects: [{ name: 'C-Projects-main', root_path: 'C:/Projects/main' }],
          };
        }
        if (tool === 'index_status') {
          return { status: 'ready', nodes: 10, edges: 20 };
        }
        return {
          rows: LOCALCODER_CBM_REQUIRED_FILES.map((file) => [file]),
          total: LOCALCODER_CBM_REQUIRED_FILES.length,
        };
      },
    });

    expect(calls).toEqual(['index_repository', 'list_projects', 'index_status', 'query_graph']);
    expect(result).toMatchObject({
      indexRan: true,
      indexStatus: 'indexed',
      sourceRoot: 'C:/Projects/main',
      scopeStatus: 'ok',
      editAllowed: true,
      missingRequiredFiles: [],
      excludedFilesFound: [],
    });
    expect(result.requiredFiles).toContain('repo-intake/localcoder-boundary.md');
    expect(result.requiredFiles).toContain('apps/backend/src/coder/localcoder/adapter.ts');
  });

  it('blocks the LocalCoder scoped CBM gate when required boundary files are missing', async () => {
    const result = await runLocalCoderCbmScopeGate('C:\\Projects\\main', {
      callTool: async (tool) => {
        if (tool === 'index_repository') return { status: 'indexed' };
        if (tool === 'list_projects') {
          return {
            projects: [{ name: 'C-Projects-main', root_path: 'C:/Projects/main' }],
          };
        }
        if (tool === 'index_status') return { status: 'ready' };
        return {
          rows: LOCALCODER_CBM_REQUIRED_FILES
            .filter((file) => file !== 'repo-intake/localcoder-boundary.md')
            .map((file) => [file]),
        };
      },
    });

    expect(result.editAllowed).toBe(false);
    expect(result.missingRequiredFiles).toEqual(['repo-intake/localcoder-boundary.md']);
    expect(result.blockedReason).toContain('cbm_scope_required_files_missing');
  });

  it('blocks the LocalCoder scoped CBM gate when vendored LocalCoder source is indexed', async () => {
    const result = await runLocalCoderCbmScopeGate('C:\\Projects\\main', {
      callTool: async (tool) => {
        if (tool === 'index_repository') return { status: 'indexed' };
        if (tool === 'list_projects') {
          return {
            projects: [{ name: 'C-Projects-main', root_path: 'C:/Projects/main' }],
          };
        }
        if (tool === 'index_status') return { status: 'ready' };
        return {
          rows: [
            ...LOCALCODER_CBM_REQUIRED_FILES.map((file) => [file]),
            ['localcoder/src/grpc/server.ts'],
          ],
        };
      },
    });

    expect(result.editAllowed).toBe(false);
    expect(result.excludedFilesFound).toEqual(['localcoder/src/grpc/server.ts']);
    expect(result.blockedReason).toContain('cbm_scope_excluded_files_indexed');
  });

  it('stops the LocalCoder scoped CBM gate immediately when indexing fails', async () => {
    const calls: string[] = [];
    const result = await runLocalCoderCbmScopeGate('C:\\Projects\\main', {
      callTool: async (tool) => {
        calls.push(tool);
        return { status: 'failed' };
      },
    });

    expect(calls).toEqual(['index_repository']);
    expect(result.editAllowed).toBe(false);
    expect(result.blockedReason).toBe('cbm_scope_index_failed: failed');
  });

  it('keeps KnowGraph sort variables in scope while preserving bounded returned fields', () => {
    expect(KNOWGRAPH_NODE_CONTEXT_QUERY).toContain('WITH DISTINCT n,');
    expect(KNOWGRAPH_NODE_CONTEXT_QUERY).toContain('AS sortKey');
    expect(KNOWGRAPH_NODE_CONTEXT_QUERY).toContain('ORDER BY sortKey DESC');
    expect(KNOWGRAPH_NODE_CONTEXT_QUERY).toContain('LIMIT toInteger($limit)');
    expect(KNOWGRAPH_NODE_CONTEXT_QUERY).not.toMatch(
      /RETURN DISTINCT[\s\S]*ORDER BY coalesce\(n\./,
    );
    expect(KNOWGRAPH_RELATION_CONTEXT_QUERY).toContain('WITH DISTINCT a, r, b,');
    expect(KNOWGRAPH_RELATION_CONTEXT_QUERY).toContain('ORDER BY sortKey DESC');
    expect(KNOWGRAPH_RELATION_CONTEXT_QUERY).not.toMatch(
      /RETURN DISTINCT[\s\S]*ORDER BY coalesce\(r\./,
    );
  });

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
            return {
              project: 'C-Projects-main',
              status: 'ready',
              nodes: 4640,
              edges: 8596,
              indexed_revision: 'revision-1',
            };
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
          return { columns: ['file_path'], rows: [[indexedBuilderFile]], total: 1 };
        },
        listSourceFiles: async () => ({
          files: [indexedBuilderFile],
          complete: true,
          reason: '',
        }),
      },
    );

    expect(calls).toEqual(['list_projects', 'index_status', 'search_graph', 'query_graph']);
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
      diagnosticStatus: 'ok',
      project: 'C-Projects-main',
      nodes: 4640,
      edges: 8596,
      indexedFileCount: 1,
      indexedRevision: 'revision-1',
      sourceRoot: 'C:/Projects/main',
      filesystemFileCount: 1,
      missingFileCount: 0,
    });
    expect(result.data.blocker).toBeNull();
  });

  it('returns unknown without inventing an indexed revision or timestamp', async () => {
    const result = await readCodeGraphContextFromCbm(
      {
        projectId: 'project_admin',
        repoPath: 'C:\\Projects\\main',
        userMessage: 'Context Packet Codebase Memory',
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
          if (tool === 'search_graph') {
            return {
              results: [
                {
                  name: 'buildGraphContextPacket',
                  qualified_name: 'buildGraphContextPacket',
                  label: 'Function',
                  file_path: indexedBuilderFile,
                },
              ],
            };
          }
          return { columns: ['file_path'], rows: [[indexedBuilderFile]], total: 1 };
        },
        listSourceFiles: async () => ({
          files: [indexedBuilderFile],
          complete: true,
          reason: '',
        }),
      },
    );

    expect(result.data.freshness).toMatchObject({
      status: 'stale',
      diagnosticStatus: 'unknown',
      indexedRevision: null,
      indexedAt: null,
      detail: 'cbm_freshness_unknown: inventories match but CBM exposes no indexed revision or timestamp',
    });
    expect(result.data.blocker).toContain('cbm_freshness_unknown');
  });

  it('never reports ok when the indexed source root cannot be verified', () => {
    expect(
      assessCbmFreshness({
        statusReady: true,
        sourceRoot: 'C:\\Projects\\other',
        requestedRoot: 'C:\\Projects\\main',
        indexedFiles: [indexedBuilderFile],
        indexedInventoryComplete: true,
        filesystemFiles: [indexedBuilderFile],
        filesystemInventoryComplete: true,
        indexedRevision: 'revision-1',
        indexedAt: null,
      }),
    ).toMatchObject({
      status: 'stale',
      diagnosticStatus: 'unknown',
      reason: expect.stringContaining('source root cannot be tied'),
    });
  });

  it('returns an unknown diagnostic when no indexed project root matches the requested root', async () => {
    const result = await readCodeGraphContextFromCbm(
      {
        projectId: 'project_admin',
        repoPath: 'C:\\Projects\\main',
        userMessage: 'Context Packet Codebase Memory',
      },
      {
        callTool: async () => ({
          projects: [{ name: 'C-Projects-other', root_path: 'C:/Projects/other' }],
        }),
      },
    );

    expect(result.data.freshness).toMatchObject({
      status: 'unavailable',
      diagnosticStatus: 'unknown',
      indexedRevision: null,
      indexedAt: null,
    });
    expect(result.data.blocker).toContain('cbm_project_not_indexed');
  });

  it('detects a newly added source file absent from CBM without git status or diff', async () => {
    const newFile = 'apps/backend/src/services/graphContext/newSource.ts';
    const result = await readCodeGraphContextFromCbm(
      {
        projectId: 'project_admin',
        repoPath: 'C:\\Projects\\main',
        userMessage: 'Context Packet Codebase Memory',
      },
      {
        callTool: async (tool) => {
          if (tool === 'list_projects') {
            return {
              projects: [{ name: 'C-Projects-main', root_path: 'C:/Projects/main' }],
            };
          }
          if (tool === 'index_status') {
            return {
              project: 'C-Projects-main',
              status: 'ready',
              nodes: 4640,
              edges: 8596,
              indexed_at: '2026-06-13T00:00:00.000Z',
            };
          }
          if (tool === 'search_graph') {
            return {
              results: [
                {
                  name: 'buildGraphContextPacket',
                  qualified_name: 'buildGraphContextPacket',
                  label: 'Function',
                  file_path: indexedBuilderFile,
                },
              ],
            };
          }
          return { columns: ['file_path'], rows: [[indexedBuilderFile]], total: 1 };
        },
        listSourceFiles: async () => ({
          files: [indexedBuilderFile, newFile],
          complete: true,
          reason: '',
        }),
      },
    );

    expect(result.data.freshness).toMatchObject({
      status: 'stale',
      diagnosticStatus: 'stale',
      indexedAt: '2026-06-13T00:00:00.000Z',
      missingFileCount: 1,
      missingFiles: [newFile],
    });
    expect(result.data.blocker).toContain('cbm_new_file_risk');
    expect(result.data.tools).not.toContain('detect_changes');
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
            return {
              project: 'C-Projects-main',
              status: 'ready',
              nodes: 4640,
              edges: 8596,
              indexed_revision: 'revision-1',
            };
          }
          if (tool === 'search_graph') return { results: [] };
          return { columns: ['file_path'], rows: [[indexedBuilderFile]], total: 1 };
        },
        listSourceFiles: async () => ({
          files: [indexedBuilderFile],
          complete: true,
          reason: '',
        }),
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
    expect(packet.provenance.sourceDiagnostics).toContainEqual(
      expect.objectContaining({
        source: 'knowgraph',
        critical: false,
        status: 'empty',
        evidenceCount: 0,
        elapsedMs: expect.any(Number),
      }),
    );
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
    expect(packet.provenance.sourceDiagnostics).toContainEqual(
      expect.objectContaining({
        source: 'knowgraph',
        critical: false,
        status: 'ok',
        evidenceCount: expect.any(Number),
        elapsedMs: expect.any(Number),
      }),
    );
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

  it('records a non-critical KnowGraph failure without inventing evidence or blocking the packet', async () => {
    const emptyPacket = createEmptyGraphContextPacket();
    const packet = await buildGraphContextPacket(
      { projectId: 'project_admin', userMessage: 'Context Packet' },
      {
        readThinkGraphContext: async () => ({ data: emptyPacket.thinkGraphContext }),
        readKnowGraphContext: async () => {
          throw new Error(`neo4j query failed ${'x'.repeat(1_000)}`);
        },
        readCodeGraphContext: async () => ({ data: emptyPacket.codeGraphContext }),
      },
    );

    expect(packet.knowGraphContext.evidence).toEqual([]);
    const diagnostic = packet.provenance.sourceDiagnostics.find(
      (item) => item.source === 'knowgraph',
    );
    expect(diagnostic).toMatchObject({
      source: 'knowgraph',
      critical: false,
      status: 'failed',
      evidenceCount: 0,
      elapsedMs: expect.any(Number),
    });
    expect(diagnostic?.blocker).toMatch(/^neo4j query failed/);
    expect(diagnostic?.blocker).toHaveLength(500);
    expect(diagnostic?.blocker).toContain('...[truncated]');
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
