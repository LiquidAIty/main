import type {
  SceneAsset,
  SceneGraphSource,
} from './sceneGraphSource';
import type {
  PascalNodeLike,
  PascalSceneLike,
} from '../modelWizard/pascal/pascalAdapterTypes';

export type AssetCategory =
  | 'room'
  | 'wall'
  | 'door'
  | 'window'
  | 'furniture'
  | 'humanScale'
  | 'classroom'
  | 'fixture'
  | 'appliance'
  | 'product'
  | 'airflow'
  | 'overlay'
  | 'simulationProxy'
  | 'vehicle';

export type AssetGeometryKind =
  | 'primitiveBox'
  | 'primitiveSphere'
  | 'primitiveCylinder'
  | 'primitiveCapsule'
  | 'curvePath'
  | 'glb'
  | 'svgOverlay'
  | 'imagePlane'
  | 'generatedCad'
  | 'simulationProxy';

export type AssetMaterialPreset =
  | 'slateMatte'
  | 'steelSoft'
  | 'glassTinted'
  | 'tealTransparent'
  | 'coolBlue'
  | 'warmOrange'
  | 'neutralLight'
  | 'airflowGlow'
  | 'ghostOverlay';

export type AssetSource =
  | 'systemBuiltin'
  | 'pascalBuildingModeler'
  | 'gameFeedstock'
  | 'generatedCad'
  | 'userUpload'
  | 'simulationOutput'
  | 'generated'
  | 'imported'
  | 'submoduleReference';

export type AssetRenderRole =
  | 'threejsPreview'
  | 'svgDiagram'
  | 'seedFrame'
  | 'videoDiffusion'
  | 'remotionExport'
  | 'arPreview';

export type AssetSimulationRole =
  | 'none'
  | 'energyContext'
  | 'cfdBoundary'
  | 'thermalMass'
  | 'airflowSource'
  | 'airflowSink'
  | 'occupant'
  | 'equipment'
  | 'manufacturingCandidate';

export type AssetDimensionHint = {
  width?: number;
  height?: number;
  depth?: number;
  radius?: number;
  unit: 'm' | 'in';
};

export type AssetUsageHint = {
  lensTargets: Array<
    'media' | 'game' | 'cad' | 'building' | 'city' | 'energy' | 'cfd' | 'ar'
  >;
  tags: string[];
  note?: string;
};

export type FeedstockAssetHint = {
  id: string;
  label: string;
  suggestedCategory: AssetCategory;
  suggestedGeometryKind: AssetGeometryKind;
  source: 'gameFeedstock' | 'submoduleReference';
  sourcePath: string;
  notes?: string;
};

export type AssetTemplate = {
  id: string;
  name: string;
  category: AssetCategory;
  source: AssetSource;
  geometryKind: AssetGeometryKind;
  materialPreset: AssetMaterialPreset;
  renderRole: AssetRenderRole;
  simulationRole: AssetSimulationRole;
  dimensionHint?: AssetDimensionHint;
  usageHint?: AssetUsageHint;
  defaultPosition?: [number, number, number];
  defaultRotation?: [number, number, number];
  curvePoints?: Array<[number, number, number]>;
  colorHex?: string;
  opacity?: number;
};

export type HumanScaleAssetTemplate = AssetTemplate & {
  category: 'humanScale';
  humanRole: 'standingMarker' | 'seatedStudent' | 'teacher';
};

export type BuildingAssetTemplate = AssetTemplate & {
  category: 'room' | 'wall' | 'door' | 'window' | 'classroom';
  buildingRole: 'shell' | 'surface' | 'opening';
};

export type PascalAssetTemplate = AssetTemplate & {
  source: 'pascalBuildingModeler';
  pascalNodeId?: string;
  pascalNodeType: string;
};

export type SceneAssetRef = {
  id: string;
  name: string;
  templateId: string;
  source: AssetSource;
  renderRole: AssetRenderRole;
  simulationRole: AssetSimulationRole;
  tags: string[];
};

export type SceneAssetRegistry = {
  id: string;
  name: string;
  assets: SceneAssetRef[];
  templates: AssetTemplate[];
};

export type AssetFallbackPolicy = 'strict' | 'warnAndPrimitive' | 'alwaysPrimitive';

export type AssetResolutionRequest = {
  sceneId: string;
  sceneAsset: SceneAsset;
  fallbackPolicy?: AssetFallbackPolicy;
};

export type AssetResolutionResult = {
  sceneAssetId: string;
  sceneAssetName: string;
  templateId: string;
  category: AssetCategory;
  source: AssetSource;
  geometryKind: AssetGeometryKind;
  renderRole: AssetRenderRole;
  simulationRole: AssetSimulationRole;
  materialPreset: AssetMaterialPreset;
  dimensionHint?: AssetDimensionHint;
  usageHint?: AssetUsageHint;
  colorHex?: string;
  opacity?: number;
  defaultPosition?: [number, number, number];
  curvePoints?: Array<[number, number, number]>;
  fallbackStatus: 'matched' | 'fallbackKind' | 'fallbackDefault' | 'registrySupplement';
  warnings: string[];
};

export type ThreePrimitivePlan = {
  geometryKind: AssetGeometryKind;
  size: [number, number, number];
  position: [number, number, number];
  rotation: [number, number, number];
  colorHex: string;
  opacity: number;
  curvePoints: Array<[number, number, number]>;
};

const DEFAULT_THREE_PRIMITIVE_PLAN: ThreePrimitivePlan = {
  geometryKind: 'primitiveBox',
  size: [0.3, 0.3, 0.3],
  position: [0, 0.15, 0],
  rotation: [0, 0, 0],
  colorHex: '#94A3B8',
  opacity: 1,
  curvePoints: [],
};

function inferTemplateIdFromSceneAsset(sceneAsset: SceneAsset): string {
  const name = sceneAsset.name.toLowerCase();
  if (sceneAsset.assetKind === 'room_shell') return 'template_classroom_shell';
  if (sceneAsset.assetKind === 'furniture') {
    if (name.includes('chair')) return 'template_chair';
    if (name.includes('couch')) return 'template_couch_placeholder';
    return 'template_student_desk';
  }
  if (sceneAsset.assetKind === 'human') {
    if (name.includes('teacher')) return 'template_teacher_placeholder';
    if (name.includes('standing')) return 'template_standing_human_scale_marker';
    return 'template_seated_student_placeholder';
  }
  if (sceneAsset.assetKind === 'device') {
    if (name.includes('rail')) return 'template_front_rail_product_blockout';
    if (name.includes('hepa') || name.includes('filter')) return 'template_hepa_filter_block';
    return 'template_cooler_purifier_blockout';
  }
  if (sceneAsset.assetKind === 'diagram_arrow') {
    if (name.includes('warm') || name.includes('orange')) return 'template_orange_intake_ribbon';
    return 'template_blue_airflow_ribbon';
  }
  if (sceneAsset.assetKind === 'diagram_bubble') return 'template_comfort_bubble';
  return 'template_generic_fallback';
}

const ASSET_TEMPLATES: AssetTemplate[] = [
  {
    id: 'template_floor_plane',
    name: 'Floor plane',
    category: 'room',
    source: 'systemBuiltin',
    geometryKind: 'primitiveBox',
    materialPreset: 'slateMatte',
    renderRole: 'threejsPreview',
    simulationRole: 'energyContext',
    dimensionHint: { width: 6, height: 0.06, depth: 4.2, unit: 'm' },
    defaultPosition: [0, -0.03, 0],
    colorHex: '#1E293B',
    opacity: 1,
    usageHint: {
      lensTargets: ['media', 'building', 'energy'],
      tags: ['floor', 'room'],
    },
  },
  {
    id: 'template_classroom_shell',
    name: 'Classroom shell',
    category: 'classroom',
    source: 'systemBuiltin',
    geometryKind: 'primitiveBox',
    materialPreset: 'slateMatte',
    renderRole: 'threejsPreview',
    simulationRole: 'energyContext',
    dimensionHint: { width: 6.2, height: 2.7, depth: 4.4, unit: 'm' },
    defaultPosition: [0, 1.35, 0],
    colorHex: '#0F172A',
    opacity: 0.06,
    usageHint: {
      lensTargets: ['media', 'building', 'energy'],
      tags: ['classroom', 'shell'],
      note: 'Room envelope placeholder for concept visuals.',
    },
  },
  {
    id: 'template_wall_hint',
    name: 'Wall hint',
    category: 'wall',
    source: 'systemBuiltin',
    geometryKind: 'primitiveBox',
    materialPreset: 'slateMatte',
    renderRole: 'threejsPreview',
    simulationRole: 'energyContext',
    dimensionHint: { width: 6.2, height: 2.4, depth: 0.06, unit: 'm' },
    defaultPosition: [0, 1.2, -2.06],
    colorHex: '#1E293B',
    opacity: 0.4,
    usageHint: { lensTargets: ['media', 'building'], tags: ['wall', 'hint'] },
  },
  {
    id: 'template_door_hint',
    name: 'Door hint',
    category: 'door',
    source: 'systemBuiltin',
    geometryKind: 'primitiveBox',
    materialPreset: 'steelSoft',
    renderRole: 'threejsPreview',
    simulationRole: 'none',
    dimensionHint: { width: 0.9, height: 2.0, depth: 0.05, unit: 'm' },
    defaultPosition: [2.1, 1.0, -2.02],
    colorHex: '#64748B',
    opacity: 0.5,
    usageHint: { lensTargets: ['media', 'building'], tags: ['door', 'opening'] },
  },
  {
    id: 'template_window_hint',
    name: 'Window hint',
    category: 'window',
    source: 'systemBuiltin',
    geometryKind: 'primitiveBox',
    materialPreset: 'glassTinted',
    renderRole: 'threejsPreview',
    simulationRole: 'none',
    dimensionHint: { width: 1.4, height: 0.9, depth: 0.04, unit: 'm' },
    defaultPosition: [-1.8, 1.5, -2.03],
    colorHex: '#60A5FA',
    opacity: 0.25,
    usageHint: { lensTargets: ['media', 'building'], tags: ['window', 'opening'] },
  },
  {
    id: 'template_student_desk',
    name: 'Student desk',
    category: 'furniture',
    source: 'systemBuiltin',
    geometryKind: 'primitiveBox',
    materialPreset: 'steelSoft',
    renderRole: 'threejsPreview',
    simulationRole: 'equipment',
    dimensionHint: { width: 1.7, height: 0.76, depth: 0.95, unit: 'm' },
    defaultPosition: [0, 0.38, 0],
    colorHex: '#334155',
    opacity: 1,
    usageHint: { lensTargets: ['media', 'game'], tags: ['desk', 'furniture'] },
  },
  {
    id: 'template_chair',
    name: 'Chair',
    category: 'furniture',
    source: 'systemBuiltin',
    geometryKind: 'primitiveBox',
    materialPreset: 'steelSoft',
    renderRole: 'threejsPreview',
    simulationRole: 'equipment',
    dimensionHint: { width: 0.46, height: 0.9, depth: 0.46, unit: 'm' },
    defaultPosition: [-0.05, 0.45, -0.58],
    colorHex: '#475569',
    opacity: 0.9,
    usageHint: { lensTargets: ['media', 'game'], tags: ['chair'] },
  },
  {
    id: 'template_couch_placeholder',
    name: 'Couch placeholder',
    category: 'furniture',
    source: 'systemBuiltin',
    geometryKind: 'primitiveBox',
    materialPreset: 'neutralLight',
    renderRole: 'threejsPreview',
    simulationRole: 'equipment',
    dimensionHint: { width: 1.8, height: 0.8, depth: 0.82, unit: 'm' },
    defaultPosition: [-2.0, 0.4, 1.3],
    colorHex: '#94A3B8',
    opacity: 0.6,
    usageHint: { lensTargets: ['media'], tags: ['couch', 'placeholder'] },
  },
  {
    id: 'template_standing_human_scale_marker',
    name: 'Standing human scale marker',
    category: 'humanScale',
    source: 'systemBuiltin',
    geometryKind: 'primitiveCapsule',
    materialPreset: 'neutralLight',
    renderRole: 'threejsPreview',
    simulationRole: 'occupant',
    dimensionHint: { height: 1.72, radius: 0.19, unit: 'm' },
    defaultPosition: [1.4, 0.86, -0.42],
    colorHex: '#CBD5E1',
    opacity: 0.45,
    usageHint: { lensTargets: ['media', 'game'], tags: ['human', 'scale'] },
  },
  {
    id: 'template_seated_student_placeholder',
    name: 'Seated student placeholder',
    category: 'humanScale',
    source: 'systemBuiltin',
    geometryKind: 'primitiveSphere',
    materialPreset: 'neutralLight',
    renderRole: 'threejsPreview',
    simulationRole: 'occupant',
    dimensionHint: { radius: 0.17, unit: 'm' },
    defaultPosition: [-0.05, 0.83, -0.35],
    colorHex: '#CBD5E1',
    opacity: 0.92,
    usageHint: { lensTargets: ['media', 'game'], tags: ['student', 'placeholder'] },
  },
  {
    id: 'template_teacher_placeholder',
    name: 'Teacher placeholder',
    category: 'humanScale',
    source: 'systemBuiltin',
    geometryKind: 'primitiveCapsule',
    materialPreset: 'neutralLight',
    renderRole: 'threejsPreview',
    simulationRole: 'occupant',
    dimensionHint: { height: 1.78, radius: 0.2, unit: 'm' },
    defaultPosition: [1.9, 0.89, 0.5],
    colorHex: '#E2E8F0',
    opacity: 0.42,
    usageHint: { lensTargets: ['media'], tags: ['teacher'] },
  },
  {
    id: 'template_cooler_purifier_blockout',
    name: 'Cooler/purifier blockout',
    category: 'product',
    source: 'systemBuiltin',
    geometryKind: 'primitiveBox',
    materialPreset: 'coolBlue',
    renderRole: 'threejsPreview',
    simulationRole: 'airflowSource',
    dimensionHint: { width: 0.34, height: 0.62, depth: 0.26, unit: 'm' },
    defaultPosition: [0.9, 0.66, 0.1],
    colorHex: '#60A5FA',
    opacity: 0.95,
    usageHint: { lensTargets: ['media', 'game', 'cfd'], tags: ['product', 'cooler'] },
  },
  {
    id: 'template_front_rail_product_blockout',
    name: 'Front rail product blockout',
    category: 'product',
    source: 'systemBuiltin',
    geometryKind: 'primitiveBox',
    materialPreset: 'coolBlue',
    renderRole: 'threejsPreview',
    simulationRole: 'airflowSource',
    dimensionHint: { width: 0.91, height: 0.61, depth: 0.1, unit: 'm' },
    defaultPosition: [0.05, 0.52, 0.62],
    colorHex: '#38BDF8',
    opacity: 0.95,
    usageHint: {
      lensTargets: ['media', 'cad', 'cfd'],
      tags: ['product', 'front-rail', 'internal-concept'],
    },
  },
  {
    id: 'template_hepa_filter_block',
    name: 'HEPA filter block',
    category: 'fixture',
    source: 'systemBuiltin',
    geometryKind: 'primitiveBox',
    materialPreset: 'neutralLight',
    renderRole: 'seedFrame',
    simulationRole: 'equipment',
    dimensionHint: { width: 0.16, height: 0.22, depth: 0.08, unit: 'm' },
    defaultPosition: [0.86, 0.66, 0.15],
    colorHex: '#E2E8F0',
    opacity: 0.8,
    usageHint: { lensTargets: ['media', 'cfd'], tags: ['hepa', 'filter'] },
  },
  {
    id: 'template_blue_airflow_ribbon',
    name: 'Blue airflow ribbon',
    category: 'airflow',
    source: 'systemBuiltin',
    geometryKind: 'curvePath',
    materialPreset: 'airflowGlow',
    renderRole: 'svgDiagram',
    simulationRole: 'airflowSource',
    colorHex: '#3B82F6',
    opacity: 0.92,
    curvePoints: [
      [0.9, 1.05, 0.1],
      [0.35, 1.1, -0.1],
      [-0.05, 1.0, -0.35],
    ],
    usageHint: {
      lensTargets: ['media', 'cfd'],
      tags: ['airflow', 'cool', 'blue'],
      note: 'Direction must remain locked toward occupant zone.',
    },
  },
  {
    id: 'template_orange_intake_ribbon',
    name: 'Orange intake ribbon',
    category: 'airflow',
    source: 'systemBuiltin',
    geometryKind: 'curvePath',
    materialPreset: 'airflowGlow',
    renderRole: 'svgDiagram',
    simulationRole: 'airflowSink',
    colorHex: '#F97316',
    opacity: 0.92,
    curvePoints: [
      [-1.2, 0.35, 0.45],
      [-0.65, 0.4, 0.35],
      [0.8, 0.7, 0.2],
    ],
    usageHint: {
      lensTargets: ['media', 'cfd'],
      tags: ['airflow', 'warm', 'orange'],
      note: 'Direction must remain locked toward product intake.',
    },
  },
  {
    id: 'template_comfort_bubble',
    name: 'Transparent comfort bubble',
    category: 'overlay',
    source: 'systemBuiltin',
    geometryKind: 'primitiveSphere',
    materialPreset: 'tealTransparent',
    renderRole: 'svgDiagram',
    simulationRole: 'none',
    dimensionHint: { radius: 0.62, unit: 'm' },
    defaultPosition: [-0.05, 0.95, -0.35],
    colorHex: '#2DD4BF',
    opacity: 0.12,
    usageHint: { lensTargets: ['media'], tags: ['comfort', 'bubble'] },
  },
  {
    id: 'template_generic_fallback',
    name: 'Generic fallback primitive',
    category: 'simulationProxy',
    source: 'systemBuiltin',
    geometryKind: 'primitiveBox',
    materialPreset: 'ghostOverlay',
    renderRole: 'threejsPreview',
    simulationRole: 'none',
    dimensionHint: { width: 0.32, height: 0.32, depth: 0.32, unit: 'm' },
    defaultPosition: [0, 0.16, 0],
    colorHex: '#64748B',
    opacity: 0.45,
    usageHint: { lensTargets: ['media'], tags: ['fallback'] },
  },
];

const TEMPLATE_BY_ID = new Map(
  ASSET_TEMPLATES.map((template) => [template.id, template]),
);

const REGISTRY_ASSETS: SceneAssetRef[] = [
  {
    id: 'asset_floor_plane',
    name: 'Floor plane',
    templateId: 'template_floor_plane',
    source: 'systemBuiltin',
    renderRole: 'threejsPreview',
    simulationRole: 'energyContext',
    tags: ['floor', 'room'],
  },
  {
    id: 'asset_classroom_shell',
    name: 'Classroom shell',
    templateId: 'template_classroom_shell',
    source: 'systemBuiltin',
    renderRole: 'threejsPreview',
    simulationRole: 'energyContext',
    tags: ['room', 'shell'],
  },
  {
    id: 'asset_wall_hint',
    name: 'Wall hint',
    templateId: 'template_wall_hint',
    source: 'systemBuiltin',
    renderRole: 'threejsPreview',
    simulationRole: 'energyContext',
    tags: ['wall', 'hint'],
  },
  {
    id: 'asset_door_hint',
    name: 'Door hint',
    templateId: 'template_door_hint',
    source: 'systemBuiltin',
    renderRole: 'threejsPreview',
    simulationRole: 'none',
    tags: ['door', 'opening'],
  },
  {
    id: 'asset_window_hint',
    name: 'Window hint',
    templateId: 'template_window_hint',
    source: 'systemBuiltin',
    renderRole: 'threejsPreview',
    simulationRole: 'none',
    tags: ['window', 'opening'],
  },
  {
    id: 'asset_student_desk',
    name: 'Student desk',
    templateId: 'template_student_desk',
    source: 'systemBuiltin',
    renderRole: 'threejsPreview',
    simulationRole: 'equipment',
    tags: ['furniture', 'desk'],
  },
  {
    id: 'asset_chair',
    name: 'Chair',
    templateId: 'template_chair',
    source: 'systemBuiltin',
    renderRole: 'threejsPreview',
    simulationRole: 'equipment',
    tags: ['furniture', 'chair'],
  },
  {
    id: 'asset_couch_placeholder',
    name: 'Couch placeholder',
    templateId: 'template_couch_placeholder',
    source: 'systemBuiltin',
    renderRole: 'threejsPreview',
    simulationRole: 'equipment',
    tags: ['furniture', 'couch'],
  },
  {
    id: 'asset_human_scale_marker',
    name: 'Standing human scale marker',
    templateId: 'template_standing_human_scale_marker',
    source: 'systemBuiltin',
    renderRole: 'threejsPreview',
    simulationRole: 'occupant',
    tags: ['human', 'scale'],
  },
  {
    id: 'asset_student_placeholder',
    name: 'Seated student placeholder',
    templateId: 'template_seated_student_placeholder',
    source: 'systemBuiltin',
    renderRole: 'threejsPreview',
    simulationRole: 'occupant',
    tags: ['human', 'student'],
  },
  {
    id: 'asset_teacher_placeholder',
    name: 'Teacher placeholder',
    templateId: 'template_teacher_placeholder',
    source: 'systemBuiltin',
    renderRole: 'threejsPreview',
    simulationRole: 'occupant',
    tags: ['human', 'teacher'],
  },
  {
    id: 'asset_cooler_purifier',
    name: 'Cooler/purifier blockout',
    templateId: 'template_cooler_purifier_blockout',
    source: 'systemBuiltin',
    renderRole: 'threejsPreview',
    simulationRole: 'airflowSource',
    tags: ['product', 'cooler'],
  },
  {
    id: 'asset_front_rail_product',
    name: 'Front rail product blockout',
    templateId: 'template_front_rail_product_blockout',
    source: 'systemBuiltin',
    renderRole: 'threejsPreview',
    simulationRole: 'airflowSource',
    tags: ['product', 'rail'],
  },
  {
    id: 'asset_hepa_filter',
    name: 'HEPA filter block',
    templateId: 'template_hepa_filter_block',
    source: 'systemBuiltin',
    renderRole: 'seedFrame',
    simulationRole: 'equipment',
    tags: ['filter', 'hepa'],
  },
  {
    id: 'asset_blue_airflow_arrow',
    name: 'Blue airflow ribbon',
    templateId: 'template_blue_airflow_ribbon',
    source: 'systemBuiltin',
    renderRole: 'svgDiagram',
    simulationRole: 'airflowSource',
    tags: ['overlay', 'airflow', 'cool'],
  },
  {
    id: 'asset_orange_warm_arrow',
    name: 'Orange warm-air ribbon',
    templateId: 'template_orange_intake_ribbon',
    source: 'systemBuiltin',
    renderRole: 'svgDiagram',
    simulationRole: 'airflowSink',
    tags: ['overlay', 'airflow', 'warm'],
  },
  {
    id: 'asset_comfort_bubble',
    name: 'Transparent comfort bubble',
    templateId: 'template_comfort_bubble',
    source: 'systemBuiltin',
    renderRole: 'svgDiagram',
    simulationRole: 'none',
    tags: ['overlay', 'comfort'],
  },
];

const CLASSROOM_SUPPLEMENT_TEMPLATE_IDS = [
  'template_floor_plane',
  'template_wall_hint',
  'template_door_hint',
  'template_window_hint',
  'template_chair',
];

export const KoolSkoolsSceneAssetRegistry: SceneAssetRegistry = {
  id: 'registry_kool_skools_default',
  name: 'Kool Skools Scene Assets',
  assets: REGISTRY_ASSETS,
  templates: ASSET_TEMPLATES,
};

function lookupTemplate(templateId: string): AssetTemplate {
  return TEMPLATE_BY_ID.get(templateId) || TEMPLATE_BY_ID.get('template_generic_fallback')!;
}

function templateToResolutionResult(args: {
  sceneAssetId: string;
  sceneAssetName: string;
  template: AssetTemplate;
  fallbackStatus: AssetResolutionResult['fallbackStatus'];
  warnings?: string[];
}): AssetResolutionResult {
  const { sceneAssetId, sceneAssetName, template, fallbackStatus, warnings = [] } = args;
  return {
    sceneAssetId,
    sceneAssetName,
    templateId: template.id,
    category: template.category,
    source: template.source,
    geometryKind: template.geometryKind,
    renderRole: template.renderRole,
    simulationRole: template.simulationRole,
    materialPreset: template.materialPreset,
    dimensionHint: template.dimensionHint,
    usageHint: template.usageHint,
    colorHex: template.colorHex,
    opacity: template.opacity,
    defaultPosition: template.defaultPosition,
    curvePoints: template.curvePoints,
    fallbackStatus,
    warnings,
  };
}

export function resolveSceneAsset(
  request: AssetResolutionRequest,
  registry: SceneAssetRegistry = KoolSkoolsSceneAssetRegistry,
): AssetResolutionResult {
  const fallbackPolicy = request.fallbackPolicy ?? 'warnAndPrimitive';
  const warnings: string[] = [];
  const inferredTemplateId = inferTemplateIdFromSceneAsset(request.sceneAsset);
  const registryEntry = registry.assets.find(
    (asset) =>
      asset.id === request.sceneAsset.id ||
      asset.name.toLowerCase() === request.sceneAsset.name.toLowerCase(),
  );
  const templateId = registryEntry?.templateId ?? inferredTemplateId;
  const template = registry.templates.find((candidate) => candidate.id === templateId);

  if (template) {
    const status = registryEntry ? 'matched' : 'fallbackKind';
    if (!registryEntry) {
      warnings.push(
        `asset ${request.sceneAsset.id} not present in registry refs; inferred template ${template.id}`,
      );
    }
    return templateToResolutionResult({
      sceneAssetId: request.sceneAsset.id,
      sceneAssetName: request.sceneAsset.name,
      template,
      fallbackStatus: status,
      warnings,
    });
  }

  if (fallbackPolicy === 'strict') {
    throw new Error(
      `asset_template_not_found_for_${request.sceneAsset.id}_in_scene_${request.sceneId}`,
    );
  }

  const fallbackTemplate = lookupTemplate('template_generic_fallback');
  if (fallbackPolicy !== 'alwaysPrimitive') {
    warnings.push(
      `asset ${request.sceneAsset.id} resolved to generic primitive fallback`,
    );
  }
  return templateToResolutionResult({
    sceneAssetId: request.sceneAsset.id,
    sceneAssetName: request.sceneAsset.name,
    template: fallbackTemplate,
    fallbackStatus: 'fallbackDefault',
    warnings,
  });
}

export function resolveSceneAssetsForSceneGraph(
  scene: SceneGraphSource,
  registry: SceneAssetRegistry = KoolSkoolsSceneAssetRegistry,
  fallbackPolicy: AssetFallbackPolicy = 'warnAndPrimitive',
): AssetResolutionResult[] {
  const resolved = scene.assets.map((sceneAsset) =>
    resolveSceneAsset({ sceneId: scene.id, sceneAsset, fallbackPolicy }, registry),
  );

  if (scene.set.kind === 'classroom') {
    for (const templateId of CLASSROOM_SUPPLEMENT_TEMPLATE_IDS) {
      const template = registry.templates.find((candidate) => candidate.id === templateId);
      if (!template) continue;
      const alreadyResolved = resolved.some((asset) => asset.templateId === templateId);
      if (alreadyResolved) continue;
      resolved.push(
        templateToResolutionResult({
          sceneAssetId: `supplement_${template.id}`,
          sceneAssetName: template.name,
          template,
          fallbackStatus: 'registrySupplement',
          warnings: ['supplementary template injected for classroom blockout context'],
        }),
      );
    }
  }

  return resolved;
}

export function compileAssetTemplateToThreePrimitive(
  template: AssetTemplate,
): ThreePrimitivePlan {
  const dimensionHint = template.dimensionHint;
  const size: [number, number, number] = [
    dimensionHint?.width ?? (dimensionHint?.radius != null ? dimensionHint.radius * 2 : 0.3),
    dimensionHint?.height ?? (dimensionHint?.radius != null ? dimensionHint.radius * 2 : 0.3),
    dimensionHint?.depth ?? (dimensionHint?.radius != null ? dimensionHint.radius * 2 : 0.3),
  ];

  return {
    geometryKind: template.geometryKind,
    size,
    position: template.defaultPosition ?? DEFAULT_THREE_PRIMITIVE_PLAN.position,
    rotation: template.defaultRotation ?? DEFAULT_THREE_PRIMITIVE_PLAN.rotation,
    colorHex: template.colorHex ?? DEFAULT_THREE_PRIMITIVE_PLAN.colorHex,
    opacity: template.opacity ?? DEFAULT_THREE_PRIMITIVE_PLAN.opacity,
    curvePoints: template.curvePoints ?? [],
  };
}

export function compileAssetTemplateToSimulationProxyHint(
  template: AssetTemplate,
): string[] {
  const hints = [
    `asset=${template.name}`,
    `category=${template.category}`,
    `simulationRole=${template.simulationRole}`,
  ];
  if (template.dimensionHint) {
    const dim = template.dimensionHint;
    hints.push(
      `dimensions=${dim.width ?? '?'}x${dim.height ?? '?'}x${dim.depth ?? '?'}${dim.unit}`,
    );
  }
  if (template.usageHint?.note) hints.push(`note=${template.usageHint.note}`);
  return hints;
}

export function compileAssetTemplateToDiffusionPromptHint(
  template: AssetTemplate,
): string {
  const tags = template.usageHint?.tags?.join(', ') || 'none';
  return [
    `${template.name} (${template.category})`,
    `geometry=${template.geometryKind}`,
    `material=${template.materialPreset}`,
    `color=${template.colorHex ?? 'default'}`,
    `tags=${tags}`,
  ].join(' | ');
}

export function compileFeedstockHintToAssetTemplate(
  hint: FeedstockAssetHint,
): AssetTemplate {
  return {
    id: `template_feedstock_${hint.id}`,
    name: hint.label,
    category: hint.suggestedCategory,
    source: hint.source,
    geometryKind: hint.suggestedGeometryKind,
    materialPreset: 'ghostOverlay',
    renderRole: 'threejsPreview',
    simulationRole: 'none',
    usageHint: {
      lensTargets: ['media', 'game'],
      tags: ['feedstock', hint.source],
      note: hint.notes,
    },
    colorHex: '#A78BFA',
    opacity: 0.45,
  };
}

export function compilePascalTypeToAssetCategory(type: string): AssetCategory {
  if (type === 'wall') return 'wall';
  if (type === 'door') return 'door';
  if (type === 'window') return 'window';
  if (type === 'level' || type === 'building') return 'room';
  if (type === 'zone') return 'classroom';
  return 'simulationProxy';
}

export function compilePascalNodeToAssetTemplate(
  node: PascalNodeLike,
): PascalAssetTemplate {
  const category = compilePascalTypeToAssetCategory(node.type);
  return {
    id: `template_pascal_${node.id}`,
    name: node.name || `Pascal ${node.type}`,
    category,
    source: 'pascalBuildingModeler',
    geometryKind: 'simulationProxy',
    materialPreset: 'ghostOverlay',
    renderRole: 'threejsPreview',
    simulationRole: category === 'wall' ? 'cfdBoundary' : 'energyContext',
    usageHint: {
      lensTargets: ['building', 'energy', 'cfd'],
      tags: ['pascal', node.type],
    },
    opacity: 0.35,
    colorHex: '#7DD3FC',
    pascalNodeId: node.id,
    pascalNodeType: node.type,
  };
}

export function compilePascalSceneToAssetTemplates(
  pascalScene: PascalSceneLike,
): PascalAssetTemplate[] {
  return Object.values(pascalScene.nodes).map((node) =>
    compilePascalNodeToAssetTemplate(node),
  );
}
