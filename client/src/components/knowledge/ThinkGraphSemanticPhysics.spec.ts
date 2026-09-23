// @vitest-environment jsdom

import { beforeAll, describe, expect, it } from 'vitest';

beforeAll(async () => {
  // The vendored renderer is an IIFE. Importing it installs its public test seam;
  // no graph, provider, or canvas is created by this proof.
  await import('../../vendor/engraphis/engraphis-graph.js');
});

describe('ThinkGraph Jev semantic physics', () => {
  it('maps current relationship strength to width and preserves non-Jev defaults', () => {
    const internals = (window as any).EngraphisGraph._internals;
    expect(internals.semanticRelationshipStrength({ relationship_strength: 0.82 }))
      .toBeCloseTo(0.82);
    expect(internals.semanticRelationshipWidth({ relationship_strength: 0.82 }, 1))
      .toBeCloseTo(2.295);
    expect(internals.semanticRelationshipWidth({ relationship_strength: 0.82 }, 1, true, true))
      .toBeCloseTo(3.9015);
    expect(internals.semanticRelationshipWidth({ weight: 9 }, 1)).toBeNull();
  });

  it('uses the persisted preferred distance and spring strength only when supplied', () => {
    const internals = (window as any).EngraphisGraph._internals;
    const edge = { rest_length: 16.16, spring_strength: 0.1744 };
    expect(internals.semanticRelationshipDistance(edge, 30)).toBeCloseTo(16.16);
    expect(internals.semanticRelationshipSpring(edge, 0.5)).toBeCloseTo(0.1744);
    expect(internals.semanticRelationshipDistance({}, 30)).toBe(30);
    expect(internals.semanticRelationshipSpring({}, 0.5)).toBe(0.5);
  });

  it('renders current-turn heat without turning it into permanent semantic mass', () => {
    const internals = (window as any).EngraphisGraph._internals;
    expect(internals.turnHeatIntensity({ turn_heat_active: false, turn_heat: 99 })).toBe(0);
    expect(internals.turnHeatIntensity({ turn_heat_active: true, turn_heat: 0 })).toBe(0.35);
    expect(internals.turnHeatIntensity({ turn_heat_active: true, turn_heat: 3 })).toBe(0.75);
  });

  it('keeps established coordinates across graph revisions without overwriting graph fields', () => {
    const internals = (window as any).EngraphisGraph._internals;
    const refreshed = internals.preserveRefreshPosition(
      { id: 'a', x: 12, y: -4, vx: 0.25, vy: -0.5, oldOnly: true },
      { id: 'a', x: 100, y: 200, label: 'updated', local_resettle: true },
    );
    expect(refreshed).toMatchObject({
      id: 'a', x: 12, y: -4, vx: 0.25, vy: -0.5,
      label: 'updated', local_resettle: true,
    });
    expect(refreshed.oldOnly).toBeUndefined();
  });
});
