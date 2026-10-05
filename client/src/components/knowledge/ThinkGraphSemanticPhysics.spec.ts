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
    ['THINK_MATERIAL', 'think', 'rgb(110,95,174)', 'rgb(99,199,154)', false],
    ['KNOW_MATERIAL', 'know', 'rgb(242,166,74)', 'rgb(242,209,107)', false],
    ['PAIRED_SOLARPUNK_MATERIAL', 'paired', 'rgb(11,14,18)', 'rgb(11,14,18)', true],
  ])('builds the %s renderer recipe from canonical node colors', (
    materialRole,
    modality,
    dominant,
    secondaryAccent,
    splitSurface,
  ) => {
    const internals = (window as any).EngraphisGraph._internals;
    const recipe = internals.solarpunkMaterialRecipe({
      material_kind: 'solarpunk',
      material_role: materialRole,
      material_blue: '#6E5FAE',
      material_orange: '#F2A64A',
      material_surface: '#0B0E12',
    }, {}, '#ffffff');

    expect(recipe).toMatchObject({
      family: 'solarpunk',
      materialRole,
      modality,
      materialBlue: 'rgb(110,95,174)',
      materialOrange: 'rgb(242,166,74)',
      materialSurface: 'rgb(11,14,18)',
      dominant,
      secondaryAccent,
      splitSurface,
    });
  });

  it('keeps authority color, secondary material accent, and recent activity distinct', () => {
    const internals = (window as any).EngraphisGraph._internals;
    const base = {
      material_kind: 'solarpunk',
      material_blue: '#4FA2AD',
      material_orange: '#F2A64A',
      material_surface: '#0B0E12',
      turn_heat_active: true,
      turn_heat: 3,
    };
    const think = internals.solarpunkMaterialRecipe({
      ...base, material_role: 'THINK_MATERIAL', material_think_active: true,
    }, {}, '#ffffff');
    const know = internals.solarpunkMaterialRecipe({
      ...base, material_role: 'KNOW_MATERIAL', material_know_active: true,
    }, {}, '#ffffff');
    const paired = internals.solarpunkMaterialRecipe({
      ...base, material_role: 'PAIRED_SOLARPUNK_MATERIAL',
      material_think_active: true, material_know_active: true,
    }, {}, '#ffffff');

    expect(think).toMatchObject({
      modality: 'think', dominant: 'rgb(79,162,173)',
      secondaryAccent: 'rgb(99,199,154)',
      activityEmphasis: 'rgb(184,166,255)',
      solarRim: 'rgb(184,166,255)',
    });
    expect(think.secondaryAccent).not.toBe(think.materialOrange);
    expect(know).toMatchObject({
      modality: 'know', dominant: 'rgb(242,166,74)',
      secondaryAccent: 'rgb(242,209,107)',
      activityEmphasis: 'rgb(184,166,255)',
      solarRim: 'rgb(184,166,255)',
    });
    expect(know.secondaryAccent).not.toBe(know.materialBlue);
    expect(paired).toMatchObject({
      modality: 'paired', materialBlue: 'rgb(79,162,173)',
      materialOrange: 'rgb(242,166,74)', splitSurface: true,
    });
  });

  it('paints joined Solarpunk material as separate purple and orange halves', () => {
    const internals = (window as any).EngraphisGraph._internals;
    const base = {
      material_kind: 'solarpunk',
      material_role: 'PAIRED_SOLARPUNK_MATERIAL',
      material_blue: '#6E5FAE',
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
      surfaceModel: 'split-bicolor-gloss',
      dualBloom: true,
      splitSurface: true,
      innerLight: 'rgb(110,95,174)',
      solarRim: 'rgb(242,166,74)',
    });
    const splitFills: string[] = [];
    const context: any = {
      beginPath: vi.fn(), arc: vi.fn(), clip: vi.fn(), fill: vi.fn(), stroke: vi.fn(),
      save: vi.fn(), restore: vi.fn(),
      fillRect: vi.fn(function (this: any) { splitFills.push(this.fillStyle); }),
      fillStyle: '', strokeStyle: '', lineWidth: 1,
    };
    internals.paintMaterialDirect(context, 0, 0, 10, resting, 'signature');
    expect(splitFills).toEqual(['rgb(110,95,174)', 'rgb(242,166,74)']);
    expect(heated.modality).toBe('paired');
    expect(activated.activeExposure).toBeGreaterThan(resting.activeExposure);
    expect(heated.activeExposure).toBeGreaterThan(activated.activeExposure);
    expect(heated.activeKey).not.toBe(activated.activeKey);
    expect(internals.solarpunkMaterialRecipe({
      ...base,
      material_kind: 'ordinary',
    }, {}, '#ffffff')).toBeNull();
  });

  it('uses the supplied authority relationship colors without changing predicates', () => {
    const internals = (window as any).EngraphisGraph._internals;
    for (const edge of [
      { material_kind: 'solarpunk', material_color: '#4FA2AD',
        material_authority: 'thinkgraph', predicate: 'DEPENDS_ON' },
      { material_kind: 'solarpunk', material_color: '#F2A64A',
        material_authority: 'knowgraph', predicate: 'SOURCED_BY' },
    ]) {
      expect(internals.solarpunkLinkColour(edge, true, false))
        .toBe(edge.material_authority === 'knowgraph'
          ? 'rgba(242,166,74,0.4)'
          : 'rgba(79,162,173,0.4)');
    }
    expect(internals.solarpunkLinkColour({ material_kind: 'ordinary' }, true, false))
      .toBeNull();
  });

  it('keeps the Cyberpunk recipe unchanged while Joined substitutes only its node palette', () => {
    const internals = (window as any).EngraphisGraph._internals;
    const ordinary = internals.materialRecipe('cyber', {}, 'theme', '#ffffff');
    expect(ordinary).toMatchObject({
      family: 'iridescent-pvd',
      fixedPalette: {
        cyan: '#21dff3', blue: '#367cff', violet: '#8d61ff',
        magenta: '#ec4fc4', teal: '#4ce4cf',
      },
    });

    const think = internals.materialRecipe('cyber', {}, 'theme', '#ffffff', {
      material_kind: 'joined-cyber', material_role: 'THINK_MATERIAL',
      material_blue: '#4FA2AD', material_orange: '#F2A64A',
    });
    const know = internals.materialRecipe('cyber', {}, 'theme', '#ffffff', {
      material_kind: 'joined-cyber', material_role: 'KNOW_MATERIAL',
      material_blue: '#4FA2AD', material_orange: '#F2A64A',
    });
    const paired = internals.materialRecipe('cyber', {}, 'theme', '#ffffff', {
      material_kind: 'joined-cyber', material_role: 'PAIRED_CYBER_MATERIAL',
      material_blue: '#4FA2AD', material_orange: '#F2A64A',
    });

    expect(think).toMatchObject({
      family: ordinary.family,
      fixedPalette: {
        cyan: '#4FA2AD', blue: '#4FA2AD', violet: '#4FA2AD',
        magenta: '#4FA2AD', teal: '#4FA2AD',
      },
    });
    expect(know).toMatchObject({
      family: ordinary.family,
      fixedPalette: {
        cyan: '#F2A64A', blue: '#F2A64A', violet: '#F2A64A',
        magenta: '#F2A64A', teal: '#F2A64A',
      },
    });
    expect(paired.family).toBe(ordinary.family);
    expect(paired.fixedPalette).toMatchObject({
      cyan: '#4FA2AD', blue: '#4FA2AD', magenta: '#F2A64A', teal: '#4FA2AD',
    });
    expect(paired.fixedPalette.violet).not.toBe(ordinary.fixedPalette.violet);
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
