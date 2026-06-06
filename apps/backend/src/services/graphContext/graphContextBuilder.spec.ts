import { describe, expect, it } from 'vitest';

import { buildGraphContextPacket } from './graphContextBuilder';

describe('graphContextBuilder', () => {
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
            components: [],
            routes: [],
            schemas: [],
            tools: [],
            agentCards: [],
            promptTemplates: [],
            implementationNotes: ['CodeGraph backend reader not wired yet.'],
          },
          debugNotes: ['codegraph_partial: backend read path not wired yet'],
        }),
      },
    );

    expect(packet.projectId).toBe('project_admin');
    expect(packet.selectedBoardContext.selectedNodeIds).toEqual(['card_magentic']);
    expect(packet.knowGraphContext.evidence).toEqual([]);
    expect(packet.provenance.debugNotes).toContain('thinkgraph_unavailable: no project-scoped rows found');
    expect(packet.provenance.debugNotes).toContain('knowgraph_unavailable: no project-scoped records found');
    expect(packet.codeGraphContext?.implementationNotes[0]).toContain('CodeGraph backend reader not wired yet');
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
});
