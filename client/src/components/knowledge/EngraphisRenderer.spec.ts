// @vitest-environment jsdom
/**
 * Entity: Project Knowledge Graph
 * Relationship: This file verifies the shared graph renderer's click arbitration, joined materials, edge transfer, and position preservation through its public deterministic seam.
 * Entity: ThinkGraph
 * Relationship: This file verifies ThinkGraph nodes and relationships retain their distinct renderer material and semantic edge values.
 * Entity: KnowGraph
 * Relationship: This file verifies KnowGraph nodes and relationships retain their distinct renderer material and authority color.
 * Entity: Jev Decisions
 * Relationship: This file verifies persisted Jev relationship strength, distance, and spring values reach the renderer without changing ordinary provider edges.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { applyJevGraphPhysics } from './jevGraphPhysics';
import { solarpunkMaterialFields, type GraphProjectionV1 } from './knowledgeGraphProjection';

beforeAll(async () => {
  // The vendored renderer is an IIFE. Importing it installs its public test seam;
  // no graph, provider, or canvas is created by this proof.
  await import('../../vendor/engraphis/engraphis-graph.js');
});

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Engraphis graph renderer contracts', () => {
  it('keeps Jev mass and weighted edges connected through ordinary paint without the removed orbital mode', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.stubGlobal('d3', await import('../../vendor/engraphis/vendor/d3.min.js'));
    const values = new Map<string, any>([['graphData', { nodes: [], links: [] }], ['zoom', 1]]);
    const forces = new Map<string, any>();
    const graph: any = new Proxy(() => graph, { get: (_target, name: string) => {
      if (name === 'd3Force') return (key: string, ...args: any[]) => {
        if (!args.length) return forces.get(key);
        forces.set(key, args[0]); return graph;
      };
      return (...args: any[]) => {
        if (!args.length) return values.get(name);
        values.set(name, args[0]); return graph;
      };
    } });
    vi.stubGlobal('ForceGraph', () => () => graph);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const renderer = (window as any).EngraphisGraph.create(host, {});
    expect((window as any).EngraphisGraph.PRESETS.galaxy).toBeUndefined();
    expect(renderer.getPhysicsSnapshot).toBeUndefined();
    expect(renderer.physicsDiagnostics).toBeUndefined();
    expect(renderer.focus).toBeUndefined();
    expect(renderer.setPreset('galaxy').mode).toBe('compact');
    renderer.setSettings({ mode: 'galaxy', size: 5, linkw: 0.72, repel: 42, gravity: 26 });
    expect(renderer.state().settings.mode).toBe('compact');
    renderer.setCollapse(false);
    const input = {
      schemaVersion: 'think-know.presentation.v1', authority: 'joined', projectId: 'isolated-renderer-fixture', counts: { nodes: 3, edges: 2 },
      nodes: [
        { id: 'a', label: 'Think', authority: 'thinkgraph', properties: {}, ...solarpunkMaterialFields('think', false, false) },
        { id: 'b', label: 'Know', authority: 'knowgraph', properties: {}, ...solarpunkMaterialFields('know', false, false) },
        { id: 'c', label: 'Shared', authority: 'joined', properties: {}, ...solarpunkMaterialFields('paired', false, false) },
      ],
      edges: [
        { id: 'weak', source: 'a', target: 'c', layer: 'thinkgraph', predicate: 'supports', properties: { jev: { winner: 'supports', distribution: { supports: 0.2, challenges: 0.8 } } } },
        { id: 'strong', source: 'b', target: 'c', layer: 'knowgraph', predicate: 'supports', properties: { jev: { winner: 'supports', distribution: { supports: 0.8, challenges: 0.2 } } } },
      ],
    } as GraphProjectionV1;
    const start = performance.now();
    const projection = applyJevGraphPhysics(input, 'galaxy');
    renderer.setData({ nodes: projection.nodes, links: projection.edges });
    const rendered = values.get('graphData').nodes;
    expect(rendered.map((node: any) => node.degree)).toEqual([1, 1, 2]);
    expect(rendered.map((node: any) => node.semantic_mass)).toEqual([0.2, 0.8, 1]);
    expect(forces.get('charge').strength()()).toBe(-42);
    expect(forces.get('x').strength()()).toBe(0.26);
    const links = values.get('graphData').links;
    for (const edge of links) {
      expect(values.get('linkWidth')(edge)).toBeCloseTo(edge.visual_width * 0.72);
      expect(forces.get('link').strength()(edge)).toBeCloseTo(edge.spring_strength);
      expect(forces.get('link').distance()(edge)).toBeCloseTo(edge.rest_length);
    }
    const arcs: number[] = [];
    const context: any = new Proxy({ globalAlpha: 1 }, {
      get: (target: any, name: string) => {
        if (name === 'arc') return (_x: number, _y: number, radius: number) => arcs.push(radius);
        if (['createRadialGradient', 'createLinearGradient', 'createConicGradient'].includes(name)) return () => ({ addColorStop() {} });
        if (name === 'measureText') return () => ({ width: 10 });
        return name in target ? target[name] : () => undefined;
      },
      set: (target: any, name: string, value: any) => { target[name] = value; return true; },
    });
    for (const node of rendered) {
      node.x = 0; node.y = 0;
      const expected = (2.5 + 3.5 * Math.log1p(node.semantic_mass)) * 5 / 3;
      expect(node.visual_radius).toBeCloseTo(2.5 + 3.5 * Math.log1p(node.semantic_mass));
      expect(node.radius).toBeCloseTo(expected);
      arcs.length = 0;
      values.get('nodeCanvasObject')(node, context, 1);
      expect(arcs.some(radius => Math.abs(radius - expected) < 1e-9)).toBe(true);
    }
    expect(rendered[0].radius).not.toBe(rendered[1].radius);
    expect(rendered[0].radius).toBeLessThan(rendered[2].radius);
    const material = (window as any).EngraphisGraph._internals.materialRecipe('cyber', {}, 'theme', '#4fa2ad', rendered[2]);
    expect(material.family).toBe('iridescent-pvd');
    expect(material.fixedPalette.cyan.toLowerCase()).toBe('#4fa2ad');
    expect(material.fixedPalette.magenta.toLowerCase()).toBe('#f2a64a');
    expect(rendered.filter((node: any) => node.name === 'Shared')).toHaveLength(1);
    console.info('Ordinary graph fixture', JSON.stringify({
      milliseconds: performance.now() - start,
      nodes: rendered.map((node: any) => ({ name: node.name, mass: node.gravity_mass, radius: node.radius })),
      edges: links.map((edge: any) => ({ id: edge.id, width: values.get('linkWidth')(edge), spring: forces.get('link').strength()(edge), distance: forces.get('link').distance()(edge) })),
    }));
    renderer.destroy(); host.remove();
  });

  it('preserves calculated knowledge and Code radii instead of overwriting them during normalization', () => {
    const { sanitizeEvidenceMetrics, graphNodeRadius, radiusFromGravityMass } = (window as any).EngraphisGraph._internals;
    const knowledge = { authority: 'joined', visual_radius: 7, gravity_mass: 40 };
    const code = { authority: 'codegraph', visual_radius: 2.4, gravity_mass: 10 };
    const ordinary = { visual_radius: 1, gravity_mass: 10 };
    sanitizeEvidenceMetrics([knowledge, code, ordinary], 50);
    expect(knowledge.visual_radius).toBe(7);
    expect(code.visual_radius).toBe(2.4);
    expect(ordinary.visual_radius).toBeCloseTo(radiusFromGravityMass(10));
    expect(graphNodeRadius(knowledge, 5, 0)).toBe(graphNodeRadius({}, 5, 0));
    expect(graphNodeRadius(knowledge, 5, 1)).toBe(graphNodeRadius({}, 5, 1));
    expect(graphNodeRadius(code, 5, 1)).toBe(2.4);
  });

  it('keeps category attraction non-radial, reciprocal and independent of file count', () => {
    const internals = (window as any).EngraphisGraph._internals;
    const run = (count: number) => {
      const target: any = { id: 'knowledge', x: 400, y: 0, vx: 0, vy: 0, radius: 10 };
      const files = Array.from({ length: count }, (_, index) => ({
        id: `file-${index}`, authority: 'codegraph', x: 0, y: 0, vx: 0, vy: 0, radius: 4,
        properties: { recordKind: 'file', features: ['Trading'],
          categoryTargets: { Trading: 'knowledge' }, categoryConnections: { Trading: 0 } },
      }));
      const nodes = [...files, target];
      const force = internals.codeCategoryForce(nodes);
      force(1);
      expect(nodes).toHaveLength(count + 1);
      expect(files.every(file => file.vx > 0 && file.vy === 0)).toBe(true);
      expect(target.vx).toBeLessThan(0);
      return { file: files[0].vx, target: target.vx };
    };
    expect(run(20)).toEqual(run(1));
    expect(internals.codeCategoryForce([{ id: 'knowledge', x: 0, y: 0 }])).toBeNull();
  });

  it('sizes code by unique caller count without changing knowledge sizing', () => {
    const { graphNodeRadius } = (window as any).EngraphisGraph._internals;
    const file = (count: number) => ({ authority: 'codegraph', properties: {
      recordKind: 'file', callerFileCount: count,
    } });
    expect(graphNodeRadius(file(12), 5, 0)).toBeGreaterThan(graphNodeRadius(file(2), 5, 1));
    expect(graphNodeRadius(file(2), 10, 0)).toBeCloseTo(2 * graphNodeRadius(file(2), 5, 0));
    expect(graphNodeRadius({}, 5, 0)).toBeCloseTo(1.2375);
  });

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
    expect(internals.semanticRelationshipWidth({
      relationship_strength: 0.82, visual_width: 1.6,
    }, 0.75)).toBeCloseTo(1.2);
    expect(internals.semanticRelationshipWidth({
      relationship_strength: 0.8, visual_width: 1.8,
    }, 0.6)).toBeCloseTo(1.08);
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

  it('keeps authority color and secondary material accent distinct', () => {
    const internals = (window as any).EngraphisGraph._internals;
    const base = {
      material_kind: 'solarpunk',
      material_blue: '#4FA2AD',
      material_orange: '#F2A64A',
      material_surface: '#0B0E12',
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
    expect(activated.activeExposure).toBeGreaterThan(resting.activeExposure);
    expect(internals.solarpunkMaterialRecipe({
      ...base,
      material_kind: 'ordinary',
    }, {}, '#ffffff')).toBeNull();
  });

  it('keeps blue/orange materials, adds a violet Code ring, and paints an iridescent Solarpunk rim with face arcs', () => {
    const internals = (window as any).EngraphisGraph._internals;
    const node = { material_kind: 'joined-cyber', material_role: 'PAIRED_CYBER_MATERIAL',
      material_blue: '#4FA2AD', material_orange: '#F2A64A' };
    const plain = internals.materialRecipe('cyber', {}, 'theme', '#ffffff', node);
    const code = internals.materialRecipe('cyber', {}, 'theme', '#ffffff', { ...node, material_code_present: true });
    expect(code).toMatchObject({ fixedPalette: plain.fixedPalette,
      codePresent: true, codeColour: 'rgb(141,97,255)' });
    expect(plain.codePresent).toBe(false);
    expect(code.identityKey).toBe(plain.identityKey);
    expect(code.face).toBe(plain.face);
    const conic = vi.fn(() => ({ addColorStop: vi.fn() }));
    const strokes: string[] = [];
    const context: any = { beginPath: vi.fn(), arc: vi.fn(), clip: vi.fn(), fill: vi.fn(),
      save: vi.fn(), restore: vi.fn(), fillRect: vi.fn(),
      createConicGradient: conic, createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      stroke: vi.fn(function (this: any) { strokes.push(String(this.strokeStyle)); }),
      fillStyle: '', strokeStyle: '', lineWidth: 1 };
    internals.paintMaterialDirect(context, 0, 0, 10, code, 'full');
    expect(conic).toHaveBeenCalled();
    expect(context.arc.mock.calls.filter((call: number[]) => call[3] === -2.88 && call[4] === 0.72))
      .toHaveLength(13);
    expect(strokes.at(-1)).toBe('rgba(141,97,255,0.88)');
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
    const code = internals.materialRecipe('cyber', {}, 'theme', '#ffffff', {
      authority: 'codegraph', properties: { recordKind: 'file' },
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
    expect(code).toMatchObject({
      family: ordinary.family,
      fixedPalette: ordinary.fixedPalette,
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
