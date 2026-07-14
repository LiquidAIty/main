import { describe, expect, it } from 'vitest';
import { GRAPH_THEME, graphGroundingColor, graphGroundingLabel } from './graphVisualTokens';

describe('graphGroundingColor', () => {
  it('maps every supported grounding source to its distinct authority token', () => {
    expect(graphGroundingColor('codegraph_grounded')).toBe(GRAPH_THEME.grounding.code);
    expect(graphGroundingColor('knowgraph_grounded')).toBe(GRAPH_THEME.grounding.know);
    expect(graphGroundingColor('main_authored')).toBe(GRAPH_THEME.grounding.main);
  });

  it('is tolerant of casing and surrounding whitespace', () => {
    expect(graphGroundingColor('  CodeGraph_Grounded ')).toBe(GRAPH_THEME.grounding.code);
    expect(graphGroundingColor('MAIN_AUTHORED')).toBe(GRAPH_THEME.grounding.main);
  });

  it('falls back to the unknown token for missing or unrecognized sources', () => {
    expect(graphGroundingColor(undefined)).toBe(GRAPH_THEME.grounding.unknown);
    expect(graphGroundingColor(null)).toBe(GRAPH_THEME.grounding.unknown);
    expect(graphGroundingColor('')).toBe(GRAPH_THEME.grounding.unknown);
    expect(graphGroundingColor('something_else')).toBe(GRAPH_THEME.grounding.unknown);
  });

  it('gives the three grounding sources visually distinct colors', () => {
    const distinct = new Set([
      GRAPH_THEME.grounding.code,
      GRAPH_THEME.grounding.know,
      GRAPH_THEME.grounding.main,
    ]);
    expect(distinct.size).toBe(3);
  });
});

describe('graphGroundingLabel', () => {
  it('returns human-readable, authority-naming labels', () => {
    expect(graphGroundingLabel('codegraph_grounded')).toMatch(/CodeGraph/);
    expect(graphGroundingLabel('knowgraph_grounded')).toMatch(/KnowGraph/);
    expect(graphGroundingLabel('main_authored')).toMatch(/Main/);
    expect(graphGroundingLabel('nope')).toBe('Ungrounded');
  });
});

describe('grounding tokens do not disturb existing graph-type tokens', () => {
  it('leaves think/know accent + edge tokens unchanged', () => {
    // Grounding is additive: graph TYPE styling must be untouched.
    expect(GRAPH_THEME.accent.think).toBe('#37ADAA');
    expect(GRAPH_THEME.accent.know).toBe('#A7B0BA');
    expect(GRAPH_THEME.edge.think).toBe('rgba(55, 173, 170, 0.56)');
    expect(GRAPH_THEME.edge.know).toBe('rgba(167, 176, 186, 0.5)');
  });
});
