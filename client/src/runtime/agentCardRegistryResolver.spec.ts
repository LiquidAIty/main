import { describe, expect, it } from 'vitest';

import {
  resolveAllCards,
  resolveBusConnections,
  resolveCardDef,
  type ResolverCardInput,
  type ResolverEdgeInput,
} from './agentCardRegistryResolver';

// ── Test helpers ───────────────────────────────────────────────────

function card(id: string, overrides: Partial<ResolverCardInput> = {}): ResolverCardInput {
  return {
    id,
    runtimeType: 'assistant_agent',
    runtimeBinding: null,
    templateId: `template_${id}`,
    title: id,
    ...overrides,
  };
}

function edge(
  id: string,
  source: string,
  target: string,
  edgeType: string = 'flow',
): ResolverEdgeInput {
  return { id, source, target, edgeType };
}

// ── resolveCardDef ─────────────────────────────────────────────────

describe('resolveCardDef', () => {
  it('resolves magentic_one runtimeType to sol', () => {
    const def = resolveCardDef(card('card_magentic', { runtimeType: 'magentic_one' }));
    expect(def).toBeDefined();
    expect(def!.id).toBe('sol');
    expect(def!.kind).toBe('bus');
  });

  it('resolves local_coder runtimeType to code', () => {
    const def = resolveCardDef(card('card_coder', { runtimeType: 'local_coder' }));
    expect(def).toBeDefined();
    expect(def!.id).toBe('code');
    expect(def!.kind).toBe('workbench');
  });

  it('resolves thinkgraph_agent binding to plan', () => {
    const def = resolveCardDef(card('card_thinkgraph_agent', { runtimeBinding: 'thinkgraph_agent' }));
    expect(def).toBeDefined();
    expect(def!.id).toBe('plan');
  });

  it('resolves kg_ingest binding to plan', () => {
    const def = resolveCardDef(card('card_kg_ingest', { runtimeBinding: 'kg_ingest' }));
    expect(def).toBeDefined();
    expect(def!.id).toBe('plan');
  });

  it('resolves knowgraph_agent binding to knowledge', () => {
    const def = resolveCardDef(card('card_knowgraph_agent', { runtimeBinding: 'knowgraph_agent' }));
    expect(def).toBeDefined();
    expect(def!.id).toBe('knowledge');
  });

  it('resolves knowgraph binding to knowledge', () => {
    const def = resolveCardDef(card('card_knowgraph', { runtimeBinding: 'knowgraph' }));
    expect(def).toBeDefined();
    expect(def!.id).toBe('knowledge');
  });

  it('resolves codegraph_agent binding to knowledge', () => {
    const def = resolveCardDef(card('card_codegraph_agent', { runtimeBinding: 'codegraph_agent' }));
    expect(def).toBeDefined();
    expect(def!.id).toBe('knowledge');
  });

  it('resolves research_agent binding to knowledge', () => {
    const def = resolveCardDef(card('card_research_agent', { runtimeBinding: 'research_agent' }));
    expect(def).toBeDefined();
    expect(def!.id).toBe('knowledge');
  });

  it('returns undefined for main_chat binding (no registry equivalent)', () => {
    const def = resolveCardDef(card('card_main_chat', { runtimeBinding: 'main_chat' }));
    expect(def).toBeUndefined();
  });

  it('returns undefined for neo4j binding (internal worker)', () => {
    const def = resolveCardDef(card('card_neo4j', { runtimeBinding: 'neo4j' }));
    expect(def).toBeUndefined();
  });

  it('returns undefined for unknown assistant_agent with no binding', () => {
    const def = resolveCardDef(card('card_random', { runtimeType: 'assistant_agent', runtimeBinding: null }));
    expect(def).toBeUndefined();
  });

  it('resolves the staged NRGSim/Energy workbench card by template id', () => {
    const def = resolveCardDef(
      card('card_energy_workbench', {
        runtimeType: 'assistant_agent',
        runtimeBinding: null,
        templateId: 'template_energy_workbench',
        title: 'NRGSim / Energy',
      }),
    );
    expect(def).toBeDefined();
    expect(def!.id).toBe('energy');
    expect(def!.kind).toBe('workbench');
    expect(def!.capabilityStatus).toBe('partial');
    expect(def!.runtimeSafe).toBe(false);
  });

  it('resolves staged Trading, Image, Code, and Video workbench cards by template id', () => {
    expect(
      resolveCardDef(
        card('card_trading_workbench', {
          templateId: 'template_trading_workbench',
          title: 'Trading Agent',
        }),
      )?.id,
    ).toBe('trading');
    expect(
      resolveCardDef(
        card('card_image_workbench', {
          templateId: 'template_image_workbench',
          title: 'Image Maker Agent',
        }),
      )?.id,
    ).toBe('image');
    expect(
      resolveCardDef(
        card('card_code_workbench', {
          templateId: 'template_code_workbench',
          title: 'Code Agent',
        }),
      )?.id,
    ).toBe('code');
    expect(
      resolveCardDef(
        card('card_video_workbench', {
          templateId: 'template_video_workbench',
          title: 'Video Agent',
        }),
      )?.id,
    ).toBe('video');
  });

  it('resolves the single UA workbench card by template before the shared assist binding', () => {
    const def = resolveCardDef(
      card('card_understand_anything', {
        runtimeType: 'assistant_agent',
        runtimeBinding: 'assist',
        templateId: 'template_understand_anything_workbench',
        title: 'Understand Anything',
      }),
    );

    expect(def).toBeDefined();
    expect(def!.id).toBe('understand-anything');
    expect(def!.uiEngine).toBe('ua_dashboard');
    expect(def!.uiLens).toBe('project_scanner');
  });

  it('returns undefined for unknown runtimeType', () => {
    const def = resolveCardDef(card('card_alien', { runtimeType: 'alien_runtime' as any }));
    expect(def).toBeUndefined();
  });

  it('handles null and undefined runtimeType gracefully', () => {
    expect(resolveCardDef(card('c1', { runtimeType: null }))).toBeUndefined();
    expect(resolveCardDef(card('c2', { runtimeType: undefined }))).toBeUndefined();
  });

  it('handles case-insensitive runtimeType', () => {
    const def = resolveCardDef(card('c', { runtimeType: 'MAGENTIC_ONE' as any }));
    expect(def).toBeDefined();
    expect(def!.id).toBe('sol');
  });

  it('prioritizes runtimeType over runtimeBinding', () => {
    // A card with magentic_one runtime but thinkgraph binding should resolve to sol
    const def = resolveCardDef(card('c', {
      runtimeType: 'magentic_one',
      runtimeBinding: 'thinkgraph_agent',
    }));
    expect(def).toBeDefined();
    expect(def!.id).toBe('sol');
  });

  it('does not mutate the input card', () => {
    const input = card('card_magentic', { runtimeType: 'magentic_one' });
    const frozen = Object.freeze({ ...input });
    resolveCardDef(frozen);
    // If it mutated, Object.freeze would throw
  });
});

// ── resolveBusConnections ──────────────────────────────────────────

describe('resolveBusConnections', () => {
  it('marks magentic_one card as orchestrator', () => {
    const cards = [card('sol', { runtimeType: 'magentic_one' })];
    const result = resolveBusConnections(cards, []);
    expect(result.get('sol')).toBe('orchestrator');
  });

  it('marks magentic_option target as orchestrated', () => {
    const cards = [
      card('sol', { runtimeType: 'magentic_one' }),
      card('agent_a'),
    ];
    const edges = [edge('e1', 'sol', 'agent_a', 'magentic_option')];
    const result = resolveBusConnections(cards, edges);
    expect(result.get('sol')).toBe('orchestrator');
    expect(result.get('agent_a')).toBe('orchestrated');
  });

  it('marks flow target from orchestrated card as delegated', () => {
    const cards = [
      card('sol', { runtimeType: 'magentic_one' }),
      card('agent_a'),
      card('agent_b'),
    ];
    const edges = [
      edge('e1', 'sol', 'agent_a', 'magentic_option'),
      edge('e2', 'agent_a', 'agent_b', 'flow'),
    ];
    const result = resolveBusConnections(cards, edges);
    expect(result.get('agent_a')).toBe('orchestrated');
    expect(result.get('agent_b')).toBe('delegated');
  });

  it('propagates delegation through flow chains', () => {
    const cards = [
      card('sol', { runtimeType: 'magentic_one' }),
      card('a'),
      card('b'),
      card('c'),
      card('d'),
    ];
    const edges = [
      edge('e1', 'sol', 'a', 'magentic_option'),
      edge('e2', 'a', 'b', 'flow'),
      edge('e3', 'b', 'c', 'flow'),
      edge('e4', 'c', 'd', 'flow'),
    ];
    const result = resolveBusConnections(cards, edges);
    expect(result.get('a')).toBe('orchestrated');
    expect(result.get('b')).toBe('delegated');
    expect(result.get('c')).toBe('delegated');
    expect(result.get('d')).toBe('delegated');
  });

  it('marks cards with no bus path as disconnected', () => {
    const cards = [
      card('sol', { runtimeType: 'magentic_one' }),
      card('lonely'),
    ];
    const result = resolveBusConnections(cards, []);
    expect(result.get('lonely')).toBe('disconnected');
  });

  it('handles multiple orchestrated heads', () => {
    const cards = [
      card('sol', { runtimeType: 'magentic_one' }),
      card('a'),
      card('b'),
    ];
    const edges = [
      edge('e1', 'sol', 'a', 'magentic_option'),
      edge('e2', 'sol', 'b', 'magentic_option'),
    ];
    const result = resolveBusConnections(cards, edges);
    expect(result.get('a')).toBe('orchestrated');
    expect(result.get('b')).toBe('orchestrated');
  });

  it('does not mark flow target from disconnected card as delegated', () => {
    const cards = [
      card('sol', { runtimeType: 'magentic_one' }),
      card('isolated_a'),
      card('isolated_b'),
    ];
    // flow edge from isolated_a to isolated_b, but isolated_a is not orchestrated
    const edges = [edge('e1', 'isolated_a', 'isolated_b', 'flow')];
    const result = resolveBusConnections(cards, edges);
    expect(result.get('isolated_a')).toBe('disconnected');
    expect(result.get('isolated_b')).toBe('disconnected');
  });

  it('does not treat magentic_option from non-Sol card as orchestration', () => {
    const cards = [card('fake_magentic'), card('target')];
    // magentic_option from a non-Sol card should not create orchestration
    const edges = [edge('e1', 'fake_magentic', 'target', 'magentic_option')];
    const result = resolveBusConnections(cards, edges);
    expect(result.get('fake_magentic')).toBe('disconnected');
    expect(result.get('target')).toBe('disconnected');
  });

  it('does not mutate input edges', () => {
    const cards = [card('sol', { runtimeType: 'magentic_one' }), card('a')];
    const edges = Object.freeze([
      Object.freeze(edge('e1', 'sol', 'a', 'magentic_option')),
    ]) as ResolverEdgeInput[];
    resolveBusConnections(cards, edges);
    // If it mutated, Object.freeze would throw
  });

  it('does not introduce new edge type values', () => {
    const cards = [
      card('sol', { runtimeType: 'magentic_one' }),
      card('a'),
      card('b'),
    ];
    const edges = [
      edge('e1', 'sol', 'a', 'magentic_option'),
      edge('e2', 'a', 'b', 'flow'),
    ];
    const result = resolveBusConnections(cards, edges);
    // BusConnection values are a separate semantic, not DeckEdgeType values
    const values = new Set(result.values());
    for (const v of values) {
      expect(['orchestrator', 'orchestrated', 'delegated', 'disconnected']).toContain(v);
    }
    // The original edges are untouched
    expect(edges[0].edgeType).toBe('magentic_option');
    expect(edges[1].edgeType).toBe('flow');
  });

  it('handles empty card and edge lists', () => {
    const result = resolveBusConnections([], []);
    expect(result.size).toBe(0);
  });
});

// ── resolveAllCards ────────────────────────────────────────────────

describe('resolveAllCards', () => {
  it('combines card def and bus connection in a single pass', () => {
    const cards = [
      card('sol', { runtimeType: 'magentic_one' }),
      card('think', { runtimeBinding: 'thinkgraph_agent' }),
      card('know', { runtimeBinding: 'knowgraph_agent' }),
      card('mystery'),
    ];
    const edges = [
      edge('e1', 'sol', 'think', 'magentic_option'),
      edge('e2', 'think', 'know', 'flow'),
    ];

    const result = resolveAllCards(cards, edges);
    expect(result.size).toBe(4);

    const solResult = result.get('sol')!;
    expect(solResult.def?.id).toBe('sol');
    expect(solResult.busConnection).toBe('orchestrator');

    const thinkResult = result.get('think')!;
    expect(thinkResult.def?.id).toBe('plan');
    expect(thinkResult.busConnection).toBe('orchestrated');

    const knowResult = result.get('know')!;
    expect(knowResult.def?.id).toBe('knowledge');
    expect(knowResult.busConnection).toBe('delegated');

    const mysteryResult = result.get('mystery')!;
    expect(mysteryResult.def).toBeUndefined();
    expect(mysteryResult.busConnection).toBe('disconnected');
  });

  it('resolves the current INITIAL_DECK shape correctly', () => {
    const cards: ResolverCardInput[] = [
      { id: 'card_magentic', runtimeType: 'magentic_one', runtimeBinding: null, templateId: 'template_magentic', title: 'Magentic-One' },
      { id: 'card_assist', runtimeType: 'assistant_agent', runtimeBinding: 'assist', templateId: 'template_assist', title: 'Assist' },
      { id: 'card_plan_agent', runtimeType: 'assistant_agent', runtimeBinding: 'plan_agent', templateId: 'template_plan_agent', title: 'Plan Agent' },
      { id: 'card_worldsignals_agent', runtimeType: 'assistant_agent', runtimeBinding: 'worldsignals_agent', templateId: 'template_worldsignals_agent', title: 'WorldSignals Agent' },
      { id: 'card_thinkgraph_agent', runtimeType: 'assistant_agent', runtimeBinding: 'thinkgraph_agent', templateId: 'template_thinkgraph_agent', title: 'ThinkGraph Agent' },
      { id: 'card_codegraph_agent', runtimeType: 'assistant_agent', runtimeBinding: 'codegraph_agent', templateId: 'template_codegraph_agent', title: 'CodeGraph Agent' },
      { id: 'card_research_agent', runtimeType: 'assistant_agent', runtimeBinding: 'research_agent', templateId: 'template_research_agent', title: 'Research Agent' },
      { id: 'card_knowgraph_agent', runtimeType: 'assistant_agent', runtimeBinding: 'knowgraph_agent', templateId: 'template_knowgraph_agent', title: 'KnowGraph Agent' },
      { id: 'card_energy_workbench', runtimeType: 'assistant_agent', runtimeBinding: 'energy_agent', templateId: 'template_energy_workbench', title: 'NRGSim / Energy' },
      { id: 'card_local_coder', runtimeType: 'local_coder', runtimeBinding: 'local_coder', templateId: 'template_local_coder', title: 'Local Coder' },
      { id: 'card_trading_workbench', runtimeType: 'assistant_agent', runtimeBinding: 'trading_agent', templateId: 'template_trading_workbench', title: 'Trading Agent' },
      { id: 'card_image_workbench', runtimeType: 'assistant_agent', runtimeBinding: 'image_agent', templateId: 'template_image_workbench', title: 'Image Maker Agent' },
      { id: 'card_code_workbench', runtimeType: 'assistant_agent', runtimeBinding: 'code_agent', templateId: 'template_code_workbench', title: 'Code Agent' },
      { id: 'card_video_workbench', runtimeType: 'assistant_agent', runtimeBinding: 'video_agent', templateId: 'template_video_workbench', title: 'Video Agent' },
      { id: 'card_telescope_agent', runtimeType: 'assistant_agent', runtimeBinding: 'telescope_agent', templateId: 'template_telescope_agent', title: 'Telescope Agent' },
      { id: 'card_understand_anything', runtimeType: 'assistant_agent', runtimeBinding: 'assist', templateId: 'template_understand_anything_workbench', title: 'Understand Anything' },
    ];
    const edges: ResolverEdgeInput[] = [
      { id: 'edge_magentic_research', source: 'card_magentic', target: 'card_research_agent', edgeType: 'magentic_option' },
      { id: 'edge_magentic_assist', source: 'card_magentic', target: 'card_assist', edgeType: 'magentic_option' },
      { id: 'edge_knowgraph_research', source: 'card_knowgraph_agent', target: 'card_research_agent', edgeType: 'flow' },
      { id: 'edge_research_codegraph', source: 'card_research_agent', target: 'card_codegraph_agent', edgeType: 'flow' },
      { id: 'edge_codegraph_thinkgraph', source: 'card_codegraph_agent', target: 'card_thinkgraph_agent', edgeType: 'flow' },
    ];

    const result = resolveAllCards(cards, edges);

    expect(result.get('card_magentic')!.def?.id).toBe('sol');
    expect(result.get('card_magentic')!.busConnection).toBe('orchestrator');

    expect(result.get('card_assist')!.def?.id).toBe('assist');
    expect(result.get('card_assist')!.busConnection).toBe('orchestrated');

    expect(result.get('card_plan_agent')!.def?.id).toBe('plan');
    expect(result.get('card_plan_agent')!.busConnection).toBe('disconnected');

    expect(result.get('card_worldsignals_agent')!.def?.id).toBe('worldsignals');
    expect(result.get('card_worldsignals_agent')!.busConnection).toBe('disconnected');

    expect(result.get('card_thinkgraph_agent')!.def?.id).toBe('plan');
    expect(result.get('card_thinkgraph_agent')!.busConnection).toBe('delegated');

    expect(result.get('card_codegraph_agent')!.def?.id).toBe('knowledge');
    expect(result.get('card_codegraph_agent')!.busConnection).toBe('delegated');

    expect(result.get('card_research_agent')!.def?.id).toBe('knowledge');
    expect(result.get('card_research_agent')!.busConnection).toBe('orchestrated');

    expect(result.get('card_knowgraph_agent')!.def?.id).toBe('knowledge');
    expect(result.get('card_knowgraph_agent')!.busConnection).toBe('disconnected');

    expect(result.get('card_energy_workbench')!.def?.id).toBe('energy');
    expect(result.get('card_energy_workbench')!.busConnection).toBe('disconnected');
    expect(result.get('card_local_coder')!.def?.id).toBe('code');
    expect(result.get('card_local_coder')!.busConnection).toBe('disconnected');
    expect(result.get('card_trading_workbench')!.def?.id).toBe('trading');
    expect(result.get('card_trading_workbench')!.busConnection).toBe('disconnected');
    expect(result.get('card_image_workbench')!.def?.id).toBe('image');
    expect(result.get('card_image_workbench')!.busConnection).toBe('disconnected');
    expect(result.get('card_code_workbench')!.def?.id).toBe('code');
    expect(result.get('card_code_workbench')!.busConnection).toBe('disconnected');
    expect(result.get('card_video_workbench')!.def?.id).toBe('video');
    expect(result.get('card_video_workbench')!.busConnection).toBe('disconnected');
    expect(result.get('card_telescope_agent')!.def?.id).toBe('telescope');
    expect(result.get('card_telescope_agent')!.busConnection).toBe('disconnected');
    expect(result.get('card_understand_anything')!.def?.id).toBe('understand-anything');
    expect(result.get('card_understand_anything')!.busConnection).toBe('disconnected');

    // No edge was mutated
    expect(edges[0].edgeType).toBe('magentic_option');
    expect(edges[1].edgeType).toBe('magentic_option');
    expect(edges[2].edgeType).toBe('flow');
  });

  it('resolves the legacy 6-card INITIAL_DECK shape correctly', () => {
    // Shape from agentbuilder.setup.spec.ts (legacy with main_chat, kg_ingest, etc.)
    const cards: ResolverCardInput[] = [
      { id: 'card_magentic', runtimeType: 'magentic_one', runtimeBinding: null },
      { id: 'card_main_chat', runtimeType: 'assistant_agent', runtimeBinding: 'main_chat' },
      { id: 'card_kg_ingest', runtimeType: 'assistant_agent', runtimeBinding: 'kg_ingest' },
      { id: 'card_research', runtimeType: 'assistant_agent', runtimeBinding: 'research_agent' },
      { id: 'card_knowgraph', runtimeType: 'assistant_agent', runtimeBinding: 'knowgraph' },
      { id: 'card_neo4j', runtimeType: 'assistant_agent', runtimeBinding: 'neo4j' },
    ];
    const edges: ResolverEdgeInput[] = [
      { id: 'e1', source: 'card_magentic', target: 'card_main_chat', edgeType: 'magentic_option' },
      { id: 'e2', source: 'card_main_chat', target: 'card_kg_ingest', edgeType: 'flow' },
      { id: 'e3', source: 'card_kg_ingest', target: 'card_research', edgeType: 'flow' },
      { id: 'e4', source: 'card_research', target: 'card_knowgraph', edgeType: 'flow' },
      { id: 'e5', source: 'card_knowgraph', target: 'card_neo4j', edgeType: 'flow' },
    ];

    const result = resolveAllCards(cards, edges);

    expect(result.get('card_magentic')!.def?.id).toBe('sol');
    expect(result.get('card_magentic')!.busConnection).toBe('orchestrator');

    // main_chat has no registry equivalent
    expect(result.get('card_main_chat')!.def).toBeUndefined();
    expect(result.get('card_main_chat')!.busConnection).toBe('orchestrated');

    // kg_ingest maps to plan
    expect(result.get('card_kg_ingest')!.def?.id).toBe('plan');
    expect(result.get('card_kg_ingest')!.busConnection).toBe('delegated');

    // research maps to knowledge
    expect(result.get('card_research')!.def?.id).toBe('knowledge');
    expect(result.get('card_research')!.busConnection).toBe('delegated');

    // knowgraph maps to knowledge
    expect(result.get('card_knowgraph')!.def?.id).toBe('knowledge');
    expect(result.get('card_knowgraph')!.busConnection).toBe('delegated');

    // neo4j has no registry equivalent
    expect(result.get('card_neo4j')!.def).toBeUndefined();
    expect(result.get('card_neo4j')!.busConnection).toBe('delegated');
  });

  it('resolves a local_coder card as code agent', () => {
    const cards = [
      card('sol', { runtimeType: 'magentic_one' }),
      card('coder', { runtimeType: 'local_coder' }),
    ];
    const edges = [edge('e1', 'sol', 'coder', 'magentic_option')];
    const result = resolveAllCards(cards, edges);

    expect(result.get('coder')!.def?.id).toBe('code');
    expect(result.get('coder')!.def?.kind).toBe('workbench');
    expect(result.get('coder')!.busConnection).toBe('orchestrated');
  });

  it('keeps disconnected NRGSim/Energy classified but not bus-active', () => {
    const cards = [
      card('sol', { runtimeType: 'magentic_one' }),
      card('card_energy_workbench', {
        runtimeType: 'assistant_agent',
        runtimeBinding: null,
        templateId: 'template_energy_workbench',
        title: 'NRGSim / Energy',
      }),
    ];
    const result = resolveAllCards(cards, []);

    expect(result.get('card_energy_workbench')!.def?.id).toBe('energy');
    expect(result.get('card_energy_workbench')!.def?.runtimeSafe).toBe(false);
    expect(result.get('card_energy_workbench')!.busConnection).toBe('disconnected');
  });
});
