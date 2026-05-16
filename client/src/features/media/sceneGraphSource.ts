export type CanvasLensType =
  | 'media'
  | 'game'
  | 'cad'
  | 'building'
  | 'city'
  | 'energy'
  | 'cfd'
  | 'ar';

export type EngineeringClaimLevel =
  | 'concept'
  | 'modeled'
  | 'tested'
  | 'certified';

export type SceneOutputTarget =
  | 'threejsBlockout'
  | 'svgOverlay'
  | 'seedFrame'
  | 'videoDiffusion'
  | 'remotionAssembly'
  | 'peepshowReview'
  | 'energyPlusContext'
  | 'cfdProxy'
  | 'manufacturingPath'
  | 'arPreview';

export type SceneVector3 = {
  x: number;
  y: number;
  z: number;
};

export type SceneSet = {
  id: string;
  name: string;
  kind: 'classroom' | 'workspace' | 'lab' | 'hybrid';
  dimensionsIn?: {
    width: number;
    depth: number;
    height: number;
  };
  notes?: string;
};

export type SceneAsset = {
  id: string;
  name: string;
  assetKind:
    | 'room_shell'
    | 'furniture'
    | 'human'
    | 'device'
    | 'diagram_arrow'
    | 'diagram_label'
    | 'diagram_bubble';
  source:
    | 'systemBuiltin'
    | 'generated'
    | 'imported'
    | 'userUpload'
    | 'submoduleReference'
    | 'simulationOutput';
  role?: string;
};

export type SceneActor = {
  id: string;
  name: string;
  actorType: 'student' | 'teacher' | 'observer' | 'device_agent';
  assetId?: string;
  anchor?: SceneVector3;
};

export type SceneProp = {
  id: string;
  name: string;
  propType: 'desk' | 'chair' | 'filter' | 'battery_pack' | 'annotation';
  assetId?: string;
  anchor?: SceneVector3;
};

export type SceneProduct = {
  id: string;
  name: string;
  productFamily: 'kool_skools_current' | 'koolphase_internal';
  dimensionsIn?: {
    width: number;
    height: number;
    depth: number;
  };
  mount: 'front_desk_rail' | 'desktop' | 'floor' | 'unknown';
  positionHint?: string;
};

export type SceneCamera = {
  id: string;
  name: string;
  shotType: 'top_down' | 'side_cutaway' | 'before_after' | 'hero';
  lensMm?: number;
  movement: 'static' | 'dolly' | 'pan' | 'tilt';
  description?: string;
};

export type SceneKeyframe = {
  id: string;
  cameraId: string;
  label: string;
  second: number;
  action: string;
};

export type SceneFlowPath = {
  id: string;
  name: string;
  flowType: 'cool_supply' | 'warm_intake' | 'heat_rejection' | 'comfort_zone';
  colorToken: 'blue' | 'orange' | 'teal';
  from: string;
  to: string;
  lockedDirection: boolean;
  description?: string;
};

export type SceneOverlay = {
  id: string;
  overlayType: 'arrow' | 'label' | 'callout' | 'measurement' | 'cutaway_plane';
  text?: string;
  targetId?: string;
  deterministic: boolean;
};

export type VisualContract = {
  id: string;
  title: string;
  requirement: string;
  severity: 'hard' | 'soft';
};

export type NonNegotiableRule = {
  id: string;
  rule: string;
  reason: string;
};

export type DiffusionSeedPlan = {
  seedFrameTargets: string[];
  styleDirectives: string[];
  blockedModelBehaviors: string[];
};

export type CanvasLensDefinition = {
  type: CanvasLensType;
  objective: string;
};

export type SceneGraphSource = {
  id: string;
  name: string;
  claimLevel: EngineeringClaimLevel;
  set: SceneSet;
  assets: SceneAsset[];
  actors: SceneActor[];
  props: SceneProp[];
  products: SceneProduct[];
  cameras: SceneCamera[];
  keyframes: SceneKeyframe[];
  flowPaths: SceneFlowPath[];
  overlays: SceneOverlay[];
  visualContracts: VisualContract[];
  nonNegotiableRules: NonNegotiableRule[];
  outputTargets: SceneOutputTarget[];
  canvasLenses: CanvasLensDefinition[];
  diffusionSeedPlan: DiffusionSeedPlan;
};

export type SceneThreeBlockoutPlan = {
  sceneId: string;
  set: SceneSet;
  objectAnchors: Array<{
    id: string;
    label: string;
    role: string;
  }>;
  cameras: SceneCamera[];
};

export type SceneSvgOverlayPlan = {
  sceneId: string;
  overlays: Array<{
    id: string;
    overlayType: SceneOverlay['overlayType'];
    text?: string;
    targetId?: string;
  }>;
  flowLegend: Array<{
    flowType: SceneFlowPath['flowType'];
    colorToken: SceneFlowPath['colorToken'];
    directionLocked: boolean;
  }>;
};

export type SceneSeedFramePlan = {
  sceneId: string;
  frames: Array<{
    keyframeId: string;
    cameraId: string;
    summary: string;
  }>;
};

export type ScenePeepshowChecklist = {
  sceneId: string;
  checks: Array<{
    id: string;
    requirement: string;
    severity: 'hard' | 'soft';
  }>;
};

export type SceneRemotionPlan = {
  sceneId: string;
  compositionName: string;
  fps: number;
  shots: Array<{
    keyframeId: string;
    cameraId: string;
    atSecond: number;
    label: string;
  }>;
};

export type SceneSimulationProxyPlan = {
  sceneId: string;
  energyHints: string[];
  cfdHints: string[];
  manufacturingHints: string[];
};

export const KoolSkoolsCurrentCoolerSceneGraph: SceneGraphSource = {
  id: 'scene_koolskools_current_cooler_concept',
  name: 'Kool Skools Classroom Concept',
  claimLevel: 'concept',
  set: {
    id: 'set_classroom_a',
    name: 'Classroom shell',
    kind: 'classroom',
    notes: 'Concept-only visual sample for classroom comfort storytelling.',
  },
  assets: [
    { id: 'asset_room', name: 'Classroom shell', assetKind: 'room_shell', source: 'systemBuiltin' },
    { id: 'asset_student', name: 'Student placeholder', assetKind: 'human', source: 'systemBuiltin' },
    { id: 'asset_desk', name: 'Student desk', assetKind: 'furniture', source: 'systemBuiltin' },
    { id: 'asset_cooler', name: 'Current cooler/purifier', assetKind: 'device', source: 'systemBuiltin' },
    { id: 'asset_arrow_blue', name: 'Cool airflow arrow', assetKind: 'diagram_arrow', source: 'systemBuiltin' },
    { id: 'asset_arrow_orange', name: 'Warm intake arrow', assetKind: 'diagram_arrow', source: 'systemBuiltin' },
    { id: 'asset_bubble', name: 'Comfort bubble', assetKind: 'diagram_bubble', source: 'systemBuiltin' },
  ],
  actors: [
    { id: 'actor_student_1', name: 'Student seat A', actorType: 'student', assetId: 'asset_student' },
  ],
  props: [
    { id: 'prop_desk_1', name: 'Desk A', propType: 'desk', assetId: 'asset_desk' },
    { id: 'prop_hepa_filter', name: 'HEPA filter marker', propType: 'filter', assetId: 'asset_cooler' },
  ],
  products: [
    {
      id: 'product_current_cooler',
      name: 'Current Kool Skools cooler/purifier concept',
      productFamily: 'kool_skools_current',
      mount: 'desktop',
      positionHint: 'Classroom occupant zone, concept placement only.',
    },
  ],
  cameras: [
    { id: 'cam_top', name: 'Top-down comfort map', shotType: 'top_down', movement: 'static' },
    { id: 'cam_side', name: 'Side cutaway airflow', shotType: 'side_cutaway', movement: 'pan' },
    { id: 'cam_before_after', name: 'Before/after compare', shotType: 'before_after', movement: 'static' },
  ],
  keyframes: [
    { id: 'kf_1', cameraId: 'cam_top', label: 'Top-down comfort bubble', second: 0.5, action: 'Show bubble and cool supply path.' },
    { id: 'kf_2', cameraId: 'cam_side', label: 'Side cutaway', second: 3.0, action: 'Show warm intake and clean cool output.' },
    { id: 'kf_3', cameraId: 'cam_before_after', label: 'Before/after framing', second: 5.5, action: 'Show concept comparison overlay.' },
  ],
  flowPaths: [
    {
      id: 'flow_cool_supply',
      name: 'Cool clean output',
      flowType: 'cool_supply',
      colorToken: 'blue',
      from: 'product_current_cooler',
      to: 'actor_student_1',
      lockedDirection: true,
      description: 'Blue means cool supply air.',
    },
    {
      id: 'flow_warm_intake',
      name: 'Warm intake',
      flowType: 'warm_intake',
      colorToken: 'orange',
      from: 'classroom_zone_warm',
      to: 'product_current_cooler',
      lockedDirection: true,
      description: 'Orange means warm intake or heat rejection.',
    },
    {
      id: 'flow_comfort_bubble',
      name: 'Comfort envelope',
      flowType: 'comfort_zone',
      colorToken: 'teal',
      from: 'product_current_cooler',
      to: 'actor_student_1',
      lockedDirection: true,
    },
  ],
  overlays: [
    { id: 'ov_1', overlayType: 'arrow', targetId: 'flow_cool_supply', deterministic: true },
    { id: 'ov_2', overlayType: 'arrow', targetId: 'flow_warm_intake', deterministic: true },
    { id: 'ov_3', overlayType: 'label', text: 'Concept visual only', deterministic: true },
    { id: 'ov_4', overlayType: 'callout', text: 'HEPA airflow path', targetId: 'prop_hepa_filter', deterministic: true },
  ],
  visualContracts: [
    { id: 'vc_1', title: 'Flow color contract', requirement: 'Blue must represent cool supply and orange must represent warm intake.', severity: 'hard' },
    { id: 'vc_2', title: 'Product identity', requirement: 'Device silhouette must remain the current cooler/purifier concept shape.', severity: 'hard' },
    { id: 'vc_3', title: 'Claim boundary', requirement: 'Visuals must remain concept-level and not imply tested/certified performance.', severity: 'hard' },
  ],
  nonNegotiableRules: [
    { id: 'nn_1', rule: 'Do not redesign product geometry.', reason: 'Product identity consistency.' },
    { id: 'nn_2', rule: 'Do not reverse airflow direction.', reason: 'Airflow narrative correctness.' },
    { id: 'nn_3', rule: 'Do not move front-mount intent to side/top.', reason: 'Design intent consistency.' },
    { id: 'nn_4', rule: 'Do not output hallucinated labels as factual claims.', reason: 'Claim safety.' },
  ],
  outputTargets: [
    'threejsBlockout',
    'svgOverlay',
    'seedFrame',
    'videoDiffusion',
    'remotionAssembly',
    'peepshowReview',
    'energyPlusContext',
  ],
  canvasLenses: [
    { type: 'media', objective: 'Generate storyboard, seed frames, and rendered concept video.' },
    { type: 'building', objective: 'Connect classroom spatial context to building-scale edits.' },
    { type: 'energy', objective: 'Prepare future EnergyPlus/NRGSIM context.' },
    { type: 'cfd', objective: 'Prepare airflow proxy for later OpenFOAM studies.' },
    { type: 'ar', objective: 'Prepare site demo framing for AR preview.' },
  ],
  diffusionSeedPlan: {
    seedFrameTargets: ['cam_top', 'cam_side', 'cam_before_after'],
    styleDirectives: ['clean classroom look', 'deterministic arrow overlays', 'product stays on-model'],
    blockedModelBehaviors: ['product redesign', 'airflow reversal', 'random text badges'],
  },
};

export const KoolPhaseComfortRailInternalSceneGraph: SceneGraphSource = {
  id: 'scene_koolphase_internal_comfortrail_concept',
  name: 'KOOLPHASE ComfortRail Internal Concept',
  claimLevel: 'concept',
  set: {
    id: 'set_classroom_deskrail',
    name: 'Desk rail cutaway set',
    kind: 'classroom',
    notes: 'Internal concept narrative, not certified performance.',
  },
  assets: [
    { id: 'asset_rail', name: 'ComfortRail shell', assetKind: 'device', source: 'systemBuiltin' },
    { id: 'asset_pcm', name: 'PCM core placeholder', assetKind: 'device', source: 'systemBuiltin' },
    { id: 'asset_vent', name: 'Front-top lip vent', assetKind: 'device', source: 'systemBuiltin' },
    { id: 'asset_arrow_blue_rail', name: 'Blue cool path', assetKind: 'diagram_arrow', source: 'systemBuiltin' },
    { id: 'asset_arrow_orange_rail', name: 'Orange warm intake path', assetKind: 'diagram_arrow', source: 'systemBuiltin' },
  ],
  actors: [
    { id: 'actor_student_rail', name: 'Student desk occupant', actorType: 'student' },
  ],
  props: [
    { id: 'prop_desk_rail', name: 'Desk front rail mount', propType: 'desk' },
    { id: 'prop_battery_optional', name: 'Battery pack optional', propType: 'battery_pack' },
  ],
  products: [
    {
      id: 'product_comfortrail',
      name: 'KOOLPHASE ComfortRail concept',
      productFamily: 'koolphase_internal',
      dimensionsIn: { width: 36, height: 24, depth: 4 },
      mount: 'front_desk_rail',
      positionHint: 'Front-mounted under or at desk lip.',
    },
  ],
  cameras: [
    { id: 'cam_rail_side', name: 'Side cutaway rail airflow', shotType: 'side_cutaway', movement: 'static' },
    { id: 'cam_rail_hero', name: 'Front hero rail shot', shotType: 'hero', movement: 'dolly' },
    { id: 'cam_rail_before_after', name: 'Before/after rail compare', shotType: 'before_after', movement: 'static' },
  ],
  keyframes: [
    { id: 'kf_r1', cameraId: 'cam_rail_hero', label: 'Rail product establish', second: 0.8, action: 'Establish rail form and dimensions.' },
    { id: 'kf_r2', cameraId: 'cam_rail_side', label: 'Air turn across desktop', second: 2.6, action: 'Show cool output path turning back across desk.' },
    { id: 'kf_r3', cameraId: 'cam_rail_before_after', label: 'Concept compare', second: 5.0, action: 'Show current concept vs rail concept framing.' },
  ],
  flowPaths: [
    {
      id: 'flow_rail_cool',
      name: 'Cool output across desktop',
      flowType: 'cool_supply',
      colorToken: 'blue',
      from: 'asset_vent',
      to: 'actor_student_rail',
      lockedDirection: true,
      description: 'Cool air exits front-top lip vent and turns across desktop.',
    },
    {
      id: 'flow_rail_warm',
      name: 'Warm intake from leg zone',
      flowType: 'warm_intake',
      colorToken: 'orange',
      from: 'leg_zone_rear',
      to: 'product_comfortrail',
      lockedDirection: true,
    },
  ],
  overlays: [
    { id: 'ov_r1', overlayType: 'measurement', text: '36in x 24in x 4in', targetId: 'product_comfortrail', deterministic: true },
    { id: 'ov_r2', overlayType: 'arrow', targetId: 'flow_rail_cool', deterministic: true },
    { id: 'ov_r3', overlayType: 'arrow', targetId: 'flow_rail_warm', deterministic: true },
    { id: 'ov_r4', overlayType: 'label', text: 'Concept claim level', deterministic: true },
  ],
  visualContracts: [
    { id: 'vc_r1', title: 'Mount contract', requirement: 'Product remains front-mounted rail, never side/top mounted.', severity: 'hard' },
    { id: 'vc_r2', title: 'Flow contract', requirement: 'Cool output remains blue and warm intake remains orange.', severity: 'hard' },
    { id: 'vc_r3', title: 'Dimension contract', requirement: 'Rendered form must preserve the 36x24x4 concept envelope.', severity: 'hard' },
  ],
  nonNegotiableRules: [
    { id: 'nn_r1', rule: 'AI may enhance style but cannot redesign the rail product.', reason: 'Internal concept control.' },
    { id: 'nn_r2', rule: 'Do not imply modeled/tested/certified performance.', reason: 'Claim safety boundary.' },
    { id: 'nn_r3', rule: 'Keep cutaway logic deterministic with explicit overlays.', reason: 'Engineering communication clarity.' },
  ],
  outputTargets: [
    'threejsBlockout',
    'svgOverlay',
    'seedFrame',
    'videoDiffusion',
    'remotionAssembly',
    'peepshowReview',
    'cfdProxy',
    'energyPlusContext',
    'manufacturingPath',
  ],
  canvasLenses: [
    { type: 'media', objective: 'Create concept video explainers from deterministic scene plans.' },
    { type: 'game', objective: 'Future playable scene edit for camera/object interactions.' },
    { type: 'cad', objective: 'Future product geometry and fabrication path control.' },
    { type: 'energy', objective: 'Future thermal/comfort context mapping.' },
    { type: 'cfd', objective: 'Future airflow simulation proxy planning.' },
  ],
  diffusionSeedPlan: {
    seedFrameTargets: ['cam_rail_hero', 'cam_rail_side'],
    styleDirectives: ['clear desk cutaway', 'deterministic callouts', 'technical concept clean look'],
    blockedModelBehaviors: ['random box redesign', 'airflow inversion', 'factual certification claims'],
  },
};

export function compileSceneGraphToThreeBlockoutPlan(
  scene: SceneGraphSource,
): SceneThreeBlockoutPlan {
  return {
    sceneId: scene.id,
    set: scene.set,
    objectAnchors: [
      ...scene.products.map((product) => ({
        id: product.id,
        label: product.name,
        role: 'product',
      })),
      ...scene.props.map((prop) => ({
        id: prop.id,
        label: prop.name,
        role: 'prop',
      })),
      ...scene.actors.map((actor) => ({
        id: actor.id,
        label: actor.name,
        role: 'actor',
      })),
    ],
    cameras: scene.cameras.map((camera) => ({ ...camera })),
  };
}

export function compileSceneGraphToSvgOverlayPlan(
  scene: SceneGraphSource,
): SceneSvgOverlayPlan {
  return {
    sceneId: scene.id,
    overlays: scene.overlays.map((overlay) => ({
      id: overlay.id,
      overlayType: overlay.overlayType,
      text: overlay.text,
      targetId: overlay.targetId,
    })),
    flowLegend: scene.flowPaths.map((flow) => ({
      flowType: flow.flowType,
      colorToken: flow.colorToken,
      directionLocked: flow.lockedDirection,
    })),
  };
}

export function compileSceneGraphToSeedFramePlan(
  scene: SceneGraphSource,
): SceneSeedFramePlan {
  return {
    sceneId: scene.id,
    frames: scene.keyframes.map((keyframe) => ({
      keyframeId: keyframe.id,
      cameraId: keyframe.cameraId,
      summary: `${keyframe.label}: ${keyframe.action}`,
    })),
  };
}

export function compileSceneGraphToDiffusionPrompt(
  scene: SceneGraphSource,
): string {
  const flowLines = scene.flowPaths
    .map(
      (flow) =>
        `- ${flow.name}: ${flow.from} -> ${flow.to} (${flow.colorToken}, locked=${flow.lockedDirection})`,
    )
    .join('\n');
  const ruleLines = scene.nonNegotiableRules
    .map((rule) => `- ${rule.rule}`)
    .join('\n');
  const productLines = scene.products
    .map((product) => {
      const dims = product.dimensionsIn
        ? `${product.dimensionsIn.width}x${product.dimensionsIn.height}x${product.dimensionsIn.depth} in`
        : 'dimensions unspecified';
      return `- ${product.name} (${product.mount}, ${dims})`;
    })
    .join('\n');

  return [
    `Scene: ${scene.name}`,
    `Claim level: ${scene.claimLevel}`,
    `Set: ${scene.set.name} (${scene.set.kind})`,
    '',
    'Products:',
    productLines,
    '',
    'Flow paths:',
    flowLines,
    '',
    'Camera beats:',
    ...scene.keyframes.map(
      (keyframe) =>
        `- t=${keyframe.second.toFixed(1)}s (${keyframe.cameraId}) ${keyframe.label}`,
    ),
    '',
    'Non-negotiables:',
    ruleLines,
    '',
    'Output instruction: stylize only. Preserve product geometry, flow direction, mount logic, and claim level.',
  ].join('\n');
}

export function compileSceneGraphToPeepshowChecklist(
  scene: SceneGraphSource,
): ScenePeepshowChecklist {
  return {
    sceneId: scene.id,
    checks: [
      ...scene.visualContracts.map((contract) => ({
        id: contract.id,
        requirement: contract.requirement,
        severity: contract.severity,
      })),
      ...scene.nonNegotiableRules.map((rule) => ({
        id: rule.id,
        requirement: rule.rule,
        severity: 'hard' as const,
      })),
    ],
  };
}

export function compileSceneGraphToRemotionPlan(
  scene: SceneGraphSource,
): SceneRemotionPlan {
  return {
    sceneId: scene.id,
    compositionName: `liquidaity-scene-${scene.id}`,
    fps: 30,
    shots: scene.keyframes.map((keyframe) => ({
      keyframeId: keyframe.id,
      cameraId: keyframe.cameraId,
      atSecond: keyframe.second,
      label: keyframe.label,
    })),
  };
}

export function compileSceneGraphToSimulationProxyPlan(
  scene: SceneGraphSource,
): SceneSimulationProxyPlan {
  const energyHints =
    scene.outputTargets.includes('energyPlusContext')
      ? [
          'Map set dimensions and occupancy proxies into EnergyPlus-ready zones.',
          'Preserve warm/cool flow intent for comfort narrative cross-checks.',
        ]
      : [];
  const cfdHints =
    scene.outputTargets.includes('cfdProxy')
      ? [
          'Translate locked flow arrows into inlet/outlet proxy vectors.',
          'Carry non-negotiable direction locks into CFD boundary assumptions.',
        ]
      : [];
  const manufacturingHints =
    scene.outputTargets.includes('manufacturingPath')
      ? [
          'Preserve product envelope dimensions for CAD/manufacturing handoff.',
          'Track mount and vent positions as fixed interface constraints.',
        ]
      : [];

  return {
    sceneId: scene.id,
    energyHints,
    cfdHints,
    manufacturingHints,
  };
}

export function compileSceneGraphToCanvasLensHints(
  scene: SceneGraphSource,
): Record<CanvasLensType, string[]> {
  const baseHints: Record<CanvasLensType, string[]> = {
    media: [],
    game: [],
    cad: [],
    building: [],
    city: [],
    energy: [],
    cfd: [],
    ar: [],
  };

  for (const lens of scene.canvasLenses) {
    const targetHints = baseHints[lens.type];
    targetHints.push(lens.objective);
  }

  if (scene.outputTargets.includes('svgOverlay')) {
    baseHints.media.push('Render deterministic airflow arrows and labels as overlays.');
  }
  if (scene.outputTargets.includes('threejsBlockout')) {
    baseHints.game.push('Use scene products/props/actors for blockout-ready object placement.');
  }
  if (scene.outputTargets.includes('manufacturingPath')) {
    baseHints.cad.push('Preserve fixed dimensions and mount geometry for later CAD conversion.');
  }
  if (scene.outputTargets.includes('energyPlusContext')) {
    baseHints.energy.push('Export occupancy and set proxies for energy context analysis.');
  }
  if (scene.outputTargets.includes('cfdProxy')) {
    baseHints.cfd.push('Export directional airflow vectors for CFD proxy setup.');
  }

  return baseHints;
}
