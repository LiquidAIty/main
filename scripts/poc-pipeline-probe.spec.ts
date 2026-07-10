// Pure-helper tests for the POC pipeline probe. The HTTP/live stages are the
// probe's job at runtime; only the local topology math is unit-tested here.
import { describe, expect, it } from 'vitest';
import {
  busConnectedCardIds,
  parseProbeArgs,
  setDifference,
} from './poc-pipeline-probe';

const NODES = [
  { id: 'card_magentic', runtimeType: 'magentic_one' },
  { id: 'card_main_chat', runtimeType: 'assistant_agent' },
  { id: 'card_research_agent', runtimeType: 'assistant_agent' },
  { id: 'card_local_coder', runtimeType: 'local_coder' },
  { id: 'card_child', runtimeType: 'assistant_agent', parentGraphId: 'workbench_x' },
];

describe('busConnectedCardIds', () => {
  it('returns only top-level agent cards on magentic_option edges, either direction', () => {
    const edges = [
      { source: 'card_main_chat', target: 'card_magentic', edgeType: 'magentic_option' },
      { source: 'card_magentic', target: 'card_research_agent', edgeType: 'magentic_option' },
      // flow edges never grant bus membership
      { source: 'card_magentic', target: 'card_local_coder', edgeType: 'flow' },
      // child cards never join the bus even with a bus edge
      { source: 'card_magentic', target: 'card_child', edgeType: 'magentic_option' },
    ];
    expect(busConnectedCardIds(NODES, edges)).toEqual(['card_main_chat', 'card_research_agent']);
  });

  it('returns empty with no orchestrator', () => {
    const noOrch = NODES.filter((n) => n.id !== 'card_magentic');
    expect(
      busConnectedCardIds(noOrch, [
        { source: 'card_main_chat', target: 'card_research_agent', edgeType: 'magentic_option' },
      ]),
    ).toEqual([]);
  });
});

describe('setDifference', () => {
  it('lists items of a missing from b', () => {
    expect(setDifference(['a', 'b', 'c'], ['b'])).toEqual(['a', 'c']);
  });
});

describe('parseProbeArgs', () => {
  it('reads flags with defaults', () => {
    const args = parseProbeArgs(['--project', 'p1']);
    expect(args).toMatchObject({
      project: 'p1',
      deck: 'deck_builder',
      conversation: 'main',
      // 127.0.0.1, not localhost — the backend listens on IPv4 only.
      backend: 'http://127.0.0.1:4000',
    });
  });
});
