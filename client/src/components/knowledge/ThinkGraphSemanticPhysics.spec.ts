// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

beforeAll(async () => {
  // The vendored renderer is an IIFE. Importing it installs its public test seam;
  // no graph, provider, or canvas is created by this proof.
  await import('../../vendor/engraphis/engraphis-graph.js');
});

afterEach(() => vi.useRealTimers());

describe('ThinkGraph Jev semantic physics', () => {
  it('resolves node single and double clicks before either callback mutates the canvas', () => {
    vi.useFakeTimers();
    const single = vi.fn();
    const double = vi.fn();
    const arbiter = (window as any).EngraphisGraph._internals
      .createNodeClickArbiter(single, double, 420);
    const center = { id: 'center' };

    arbiter.click(center);
    expect(single).not.toHaveBeenCalled();
    expect(double).not.toHaveBeenCalled();
    arbiter.click(center);
    expect(double).toHaveBeenCalledOnce();
    expect(double).toHaveBeenCalledWith(center);
    vi.advanceTimersByTime(420);
    expect(single).not.toHaveBeenCalled();

    const neighbor = { id: 'neighbor' };
    arbiter.click(neighbor);
    vi.advanceTimersByTime(419);
    expect(single).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(single).toHaveBeenCalledOnce();
    expect(single).toHaveBeenCalledWith(neighbor);
  });

  it('maps current relationship strength to width and preserves non-Jev defaults', () => {
    const internals = (window as any).EngraphisGraph._internals;
    expect(internals.semanticRelationshipStrength({ relationship_strength: 0.82 }))
      .toBeCloseTo(0.82);
    expect(internals.semanticRelationshipWidth({ relationship_strength: 0.82 }, 1))
      .toBeCloseTo(2.295);
    expect(internals.semanticRelationshipWidth({ relationship_strength: 0.82 }, 1, true, true))
      .toBeCloseTo(3.9015);
    expect(internals.semanticRelationshipWidth({
      relationship_strength: 0.82, visual_width: 1.6,
    }, 1)).toBeCloseTo(1.6);
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

  it.each([
    ['THINK_MATERIAL', 'think', 'rgb(55,173,170)'],
    ['KNOW_MATERIAL', 'know', 'rgb(242,166,74)'],
    ['PAIRED_SOLARPUNK_MATERIAL', 'paired', 'rgb(55,173,170)'],
  ])('builds the %s renderer recipe from canonical node colors', (
    materialRole,
    modality,
    dominant,
  ) => {
    const internals = (window as any).EngraphisGraph._internals;
    const recipe = internals.solarpunkMaterialRecipe({
      material_kind: 'solarpunk',
      material_role: materialRole,
      material_blue: '#37ADAA',
      material_orange: '#F2A64A',
      material_surface: '#0B0E12',
    }, {}, '#ffffff');

    expect(recipe).toMatchObject({
      family: 'solarpunk',
      materialRole,
      modality,
      materialBlue: 'rgb(55,173,170)',
      materialOrange: 'rgb(242,166,74)',
      materialSurface: 'rgb(11,14,18)',
      dominant,
      splitSurface: false,
    });
  });

  it('keeps paired Solarpunk material unified and strengthens exposure without changing modality', () => {
    const internals = (window as any).EngraphisGraph._internals;
    const base = {
      material_kind: 'solarpunk',
      material_role: 'PAIRED_SOLARPUNK_MATERIAL',
      material_blue: '#37ADAA',
      material_orange: '#F2A64A',
      material_surface: '#0B0E12',
    };
    const resting = internals.solarpunkMaterialRecipe(base, {}, '#ffffff');
    const activated = internals.solarpunkMaterialRecipe({
      ...base,
      material_think_active: true,
      material_know_active: true,
    }, {}, '#ffffff');
    const heated = internals.solarpunkMaterialRecipe({
      ...base,
      material_think_active: true,
      material_know_active: true,
      turn_heat_active: true,
      turn_heat: 3,
    }, {}, '#ffffff');

    expect(resting).toMatchObject({
      modality: 'paired',
      surfaceModel: 'unified-dark-gloss',
      dualBloom: true,
      splitSurface: false,
      innerLight: 'rgb(55,173,170)',
      solarRim: 'rgb(242,166,74)',
    });
    expect(heated.modality).toBe('paired');
    expect(activated.activeExposure).toBeGreaterThan(resting.activeExposure);
    expect(heated.activeExposure).toBeGreaterThan(activated.activeExposure);
    expect(heated.activeKey).not.toBe(activated.activeKey);
    expect(internals.solarpunkMaterialRecipe({
      ...base,
      material_kind: 'ordinary',
    }, {}, '#ffffff')).toBeNull();
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
