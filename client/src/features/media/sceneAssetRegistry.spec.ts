import { describe, expect, it } from 'vitest';

import { buildCanvasObjectContext } from './objectAwareCanvasContext';
import {
  compileAssetTemplateToDiffusionPromptHint,
  compileAssetTemplateToSimulationProxyHint,
  compileAssetTemplateToThreePrimitive,
  compilePascalSceneToAssetTemplates,
  compilePascalTypeToAssetCategory,
  KoolSkoolsSceneAssetRegistry,
  resolveSceneAsset,
  resolveSceneAssetsForSceneGraph,
  type SceneAssetRegistry,
} from './sceneAssetRegistry';
import { KoolSkoolsCurrentCoolerSceneGraph } from './sceneGraphSource';

describe('sceneAssetRegistry resolver', () => {
  it('returns matched status for exact registry asset/template match', () => {
    const result = resolveSceneAsset({
      sceneId: 'scene_test',
      sceneAsset: {
        id: 'asset_classroom_shell',
        name: 'Classroom shell',
        assetKind: 'room_shell',
        source: 'systemBuiltin',
      },
    });

    expect(result.fallbackStatus).toBe('matched');
    expect(result.templateId).toBe('template_classroom_shell');
    expect(result.category).toBe('classroom');
  });

  it('returns fallbackKind when registry asset is missing but template inference succeeds', () => {
    const result = resolveSceneAsset({
      sceneId: 'scene_test',
      sceneAsset: {
        id: 'asset_teacher_unknown',
        name: 'Teacher marker',
        assetKind: 'human',
        source: 'systemBuiltin',
      },
    });

    expect(result.fallbackStatus).toBe('fallbackKind');
    expect(result.templateId).toBe('template_teacher_placeholder');
    expect(result.warnings.join(' ')).toContain('not present in registry refs');
  });

  it('returns fallbackDefault when inferred template is unavailable in provided registry', () => {
    const minimalRegistry: SceneAssetRegistry = {
      id: 'minimal_registry',
      name: 'Minimal',
      assets: [],
      templates: [],
    };

    const result = resolveSceneAsset(
      {
        sceneId: 'scene_test',
        sceneAsset: {
          id: 'asset_missing_template',
          name: 'Unknown mobile appliance',
          assetKind: 'device',
          source: 'systemBuiltin',
        },
      },
      minimalRegistry,
    );

    expect(result.fallbackStatus).toBe('fallbackDefault');
    expect(result.templateId).toBe('template_generic_fallback');
  });

  it('adds registry supplements for classroom defaults (floor/wall/door/window/chair)', () => {
    const resolved = resolveSceneAssetsForSceneGraph(KoolSkoolsCurrentCoolerSceneGraph);
    const supplements = resolved.filter(
      (asset) => asset.fallbackStatus === 'registrySupplement',
    );
    const supplementTemplateIds = new Set(supplements.map((asset) => asset.templateId));

    expect(supplementTemplateIds.has('template_floor_plane')).toBe(true);
    expect(supplementTemplateIds.has('template_wall_hint')).toBe(true);
    expect(supplementTemplateIds.has('template_door_hint')).toBe(true);
    expect(supplementTemplateIds.has('template_window_hint')).toBe(true);
    expect(supplementTemplateIds.has('template_chair')).toBe(true);
  });

  it('maps Pascal types to asset categories', () => {
    expect(compilePascalTypeToAssetCategory('building')).toBe('room');
    expect(compilePascalTypeToAssetCategory('level')).toBe('room');
    expect(compilePascalTypeToAssetCategory('zone')).toBe('classroom');
    expect(compilePascalTypeToAssetCategory('wall')).toBe('wall');
    expect(compilePascalTypeToAssetCategory('slab')).toBe('simulationProxy');
    expect(compilePascalTypeToAssetCategory('roof')).toBe('simulationProxy');
    expect(compilePascalTypeToAssetCategory('window')).toBe('window');
    expect(compilePascalTypeToAssetCategory('door')).toBe('door');
  });

  it('builds expected primitive geometry hints from templates', () => {
    const deskTemplate = KoolSkoolsSceneAssetRegistry.templates.find(
      (template) => template.id === 'template_student_desk',
    );
    expect(deskTemplate).toBeDefined();

    const primitive = compileAssetTemplateToThreePrimitive(deskTemplate!);
    expect(primitive.geometryKind).toBe('primitiveBox');
    expect(primitive.size[0]).toBeCloseTo(1.7);
    expect(primitive.size[1]).toBeCloseTo(0.76);
    expect(primitive.size[2]).toBeCloseTo(0.95);
    expect(primitive.position).toEqual([0, 0.38, 0]);
  });

  it('emits simulation proxy hints including simulation role and dimensions', () => {
    const coolerTemplate = KoolSkoolsSceneAssetRegistry.templates.find(
      (template) => template.id === 'template_cooler_purifier_blockout',
    );
    expect(coolerTemplate).toBeDefined();

    const hints = compileAssetTemplateToSimulationProxyHint(coolerTemplate!);
    expect(hints.some((hint) => hint.includes('simulationRole=airflowSource'))).toBe(true);
    expect(hints.some((hint) => hint.includes('dimensions='))).toBe(true);
  });

  it('emits diffusion prompt hint with geometry/material/tag context', () => {
    const airflowTemplate = KoolSkoolsSceneAssetRegistry.templates.find(
      (template) => template.id === 'template_blue_airflow_ribbon',
    );
    expect(airflowTemplate).toBeDefined();

    const hint = compileAssetTemplateToDiffusionPromptHint(airflowTemplate!);
    expect(hint).toContain('geometry=curvePath');
    expect(hint).toContain('material=airflowGlow');
    expect(hint).toContain('tags=airflow, cool, blue');
  });

  it('resolves expected Kool Skools scene assets', () => {
    const resolved = resolveSceneAssetsForSceneGraph(KoolSkoolsCurrentCoolerSceneGraph);
    const byId = new Map(resolved.map((asset) => [asset.sceneAssetId, asset]));

    expect(byId.get('asset_room')?.templateId).toBe('template_classroom_shell');
    expect(byId.get('asset_desk')?.templateId).toBe('template_student_desk');
    expect(byId.get('asset_student')?.templateId).toBe('template_seated_student_placeholder');
    expect(byId.get('asset_cooler')?.templateId).toBe('template_cooler_purifier_blockout');
    expect(byId.get('asset_arrow_blue')?.templateId).toBe('template_blue_airflow_ribbon');
    expect(byId.get('asset_arrow_orange')?.templateId).toBe('template_orange_intake_ribbon');
    expect(byId.get('asset_bubble')?.templateId).toBe('template_comfort_bubble');
    expect(resolved.length).toBeGreaterThanOrEqual(
      KoolSkoolsCurrentCoolerSceneGraph.assets.length,
    );
  });

  it('enriches object-awareness context with source asset/template/dimensions', () => {
    const resolved = resolveSceneAssetsForSceneGraph(KoolSkoolsCurrentCoolerSceneGraph);
    const context = buildCanvasObjectContext(
      KoolSkoolsCurrentCoolerSceneGraph,
      'video',
      resolved,
    );

    expect(context.selected).toBeTruthy();
    expect(context.selected?.sourceAssetId).toBe('asset_cooler');
    expect(context.selected?.properties.sourceTemplateId).toBe(
      'template_cooler_purifier_blockout',
    );
    expect(context.selected?.properties.sourceDimensions).toBe('0.34x0.62x0.26m');
  });
});

describe('Pascal scene bridge helpers', () => {
  it('compiles Pascal scene nodes into asset templates', () => {
    const templates = compilePascalSceneToAssetTemplates({
      nodes: {
        b1: { id: 'b1', type: 'building', name: 'Building A' },
        w1: { id: 'w1', type: 'wall', name: 'Wall 1' },
        d1: { id: 'd1', type: 'door', name: 'Door 1' },
      },
    });

    expect(templates.map((template) => template.id)).toEqual(
      expect.arrayContaining([
        'template_pascal_b1',
        'template_pascal_w1',
        'template_pascal_d1',
      ]),
    );
    expect(templates.find((template) => template.id === 'template_pascal_w1')?.simulationRole).toBe(
      'cfdBoundary',
    );
  });
});
