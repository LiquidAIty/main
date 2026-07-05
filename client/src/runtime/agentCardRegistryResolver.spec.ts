import { describe, expect, it } from 'vitest';

import {
  resolveBusConnections,
  type ResolverCardInput,
  type ResolverEdgeInput,
} from './agentCardRegistryResolver';

// ── Test helpers ───────────────────────────────────────────────────

function card(id: string, overrides: Partial<ResolverCardInput> = {}): ResolverCardInput {
  return { id, runtimeType: 'assistant_agent', ...overrides };
}

function edge(
  id: string,
  source: string,
  target: string,
  edgeType: string = 'flow',
): ResolverEdgeInput {
  return { id, source, target, edgeType };
}

// ── resolveBusConnections (read-only canvas connectivity projection) ─

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

  it('marks an incoming magentic_option source as orchestrated from current persisted graph state', () => {
    const cards = [
      card('sol', { runtimeType: 'magentic_one' }),
      card('plan_agent'),
    ];
    const edges = [edge('e1', 'plan_agent', 'sol', 'magentic_option')];
    const result = resolveBusConnections(cards, edges);
    expect(result.get('plan_agent')).toBe('orchestrated');
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
    const edges = [edge('e1', 'isolated_a', 'isolated_b', 'flow')];
    const result = resolveBusConnections(cards, edges);
    expect(result.get('isolated_a')).toBe('disconnected');
    expect(result.get('isolated_b')).toBe('disconnected');
  });

  it('does not treat magentic_option from non-Sol card as orchestration', () => {
    const cards = [card('fake_magentic'), card('target')];
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

  it('only uses the four bus-connection values, never new edge types', () => {
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
    for (const v of new Set(result.values())) {
      expect(['orchestrator', 'orchestrated', 'delegated', 'disconnected']).toContain(v);
    }
    expect(edges[0].edgeType).toBe('magentic_option');
    expect(edges[1].edgeType).toBe('flow');
  });

  it('handles empty card and edge lists', () => {
    const result = resolveBusConnections([], []);
    expect(result.size).toBe(0);
  });
});
