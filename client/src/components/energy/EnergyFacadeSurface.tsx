import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import * as THREE from 'three';

import {
  GRAPH_THEME,
  graphCompanionTabButtonStyle,
  graphCompanionTabGroupStyle,
  graphControlButtonStyle,
  graphControlStackStyle,
  graphDrawerButtonStyle,
  graphDrawerSectionStyle,
  graphGlassCardStyle,
  graphGlassPillStyle,
} from '../graph/graphVisualTokens';
import {
  calculateSolarPosition,
} from '../../features/energy/solarPosition';
import { createEnergyRunPrepManifestFromSurface } from '../../features/energy/createEnergyRunPrepManifest';
import { ENERGY_DEFAULT_PARAMETERS } from '../../types/workspaceActions';
import type {
  EnergyEditableParameter,
  EnergyModelLevel,
  EnergyModelSource,
  EnergyRunPrepManifest,
} from '../../features/energy/energyModelSchema';
import type {
  EnergyObjectId,
  EnergyParameterKey,
  EnergySurfaceParameters,
  WorkspaceActionCall,
  WorkspaceActionResult,
} from '../../types/workspaceActions';

const R3FSmokeTest = lazy(() => import('../modeling/R3FSmokeTest'));

type EnergyDesignObject = {
  id: string;
  parentId: string | null;
  level: EnergyModelLevel;
  name: string;
  kind: string;
  role: string;
  visualObjectId?: EnergyObjectId;
  tabs: EnergyInspectorTab[];
  source: EnergyModelSource;
  parameters: EnergyEditableParameter[];
  relationships: string[];
};

type EnergyModelTreeNode = {
  id: string;
  label: string;
  depth: number;
};

type EnergyCameraAction = 'zoom_in' | 'zoom_out' | 'fit_view';

type EnergyCameraCommand = {
  action: EnergyCameraAction;
  token: number;
} | null;

const PASCAL_INTEGRATION_STATUS = 'placeholder-adapter-only';
const DEFAULT_SOLAR_ORIENTATION_DEG = 180;

class R3FSmokeBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            display: 'grid',
            height: '100%',
            placeItems: 'center',
            color: GRAPH_THEME.drawer.inputMuted,
            fontSize: 12,
          }}
        >
          R3F smoke test unavailable
        </div>
      );
    }

    return this.props.children;
  }
}

type EnergyInspectorTab =
  | 'summary'
  | 'weather'
  | 'simulation'
  | 'layout'
  | 'envelope'
  | 'openings'
  | 'internalLoads'
  | 'hvac'
  | 'comfort'
  | 'outputs'
  | 'construction'
  | 'boundary'
  | 'glazing'
  | 'shading'
  | 'geometry'
  | 'people'
  | 'lights'
  | 'equipment'
  | 'schedules'
  | 'system'
  | 'setpoints'
  | 'ventilation'
  | 'validation'
  | 'joblistPreview';

const ENERGY_TAB_LABELS: Record<EnergyInspectorTab, string> = {
  summary: 'Summary',
  weather: 'Weather',
  simulation: 'Simulation',
  layout: 'Layout',
  envelope: 'Envelope',
  openings: 'Openings',
  internalLoads: 'Loads',
  hvac: 'HVAC',
  comfort: 'Comfort',
  outputs: 'Outputs',
  construction: 'Construction',
  boundary: 'Boundary',
  glazing: 'Glazing',
  shading: 'Shading',
  geometry: 'Geometry',
  people: 'People',
  lights: 'Lights',
  equipment: 'Equipment',
  schedules: 'Schedules',
  system: 'System',
  setpoints: 'Setpoints',
  ventilation: 'Ventilation',
  validation: 'Validation',
  joblistPreview: 'Parametric Preview',
};

const MODEL_TREE_NODES: EnergyModelTreeNode[] = [
  { id: 'energy:project', label: 'Project', depth: 0 },
  { id: 'energy:site', label: 'Site', depth: 1 },
  { id: 'energy:building', label: 'Building', depth: 2 },
  { id: 'energy:level', label: 'Level 1', depth: 3 },
  { id: 'energy:block', label: 'Shoebox', depth: 4 },
  { id: 'energy:zone', label: 'Zone', depth: 5 },
  { id: 'energy:surfaces', label: 'Surfaces', depth: 6 },
  { id: 'energy:facade', label: 'Wall', depth: 7 },
  { id: 'energy:roof', label: 'Roof', depth: 7 },
  { id: 'energy:floor', label: 'Floor', depth: 7 },
  { id: 'energy:openings', label: 'Openings', depth: 6 },
  { id: 'energy:window', label: 'Window', depth: 7 },
  { id: 'energy:shades', label: 'Shades', depth: 6 },
  { id: 'energy:overhang', label: 'Overhang', depth: 7 },
  { id: 'energy:leftFin', label: 'Left Fin', depth: 7 },
  { id: 'energy:rightFin', label: 'Right Fin', depth: 7 },
  { id: 'energy:loads', label: 'Loads', depth: 6 },
  { id: 'energy:people', label: 'People', depth: 7 },
  { id: 'energy:lights', label: 'Lights', depth: 7 },
  { id: 'energy:equipment', label: 'Equipment', depth: 7 },
  { id: 'energy:hvac', label: 'HVAC', depth: 6 },
  { id: 'energy:simulation', label: 'Simulation', depth: 6 },
  { id: 'energy:outputs', label: 'Outputs', depth: 6 },
];

const MODEL_NODE_DETAILS: Record<
  string,
  { parentId: string | null; level: EnergyModelLevel; source: EnergyModelSource }
> = {
  'energy:project': { parentId: null, level: 'project', source: 'wizard_default' },
  'energy:site': { parentId: 'energy:project', level: 'site', source: 'wizard_default' },
  'energy:building': { parentId: 'energy:site', level: 'building', source: 'wizard_default' },
  'energy:level': { parentId: 'energy:building', level: 'shell', source: 'wizard_default' },
  'energy:block': { parentId: 'energy:level', level: 'block', source: 'imported_from_nrgsim' },
  'energy:zone': { parentId: 'energy:block', level: 'zone', source: 'wizard_default' },
  'energy:surfaces': { parentId: 'energy:zone', level: 'surface', source: 'wizard_default' },
  'energy:facade': { parentId: 'energy:surfaces', level: 'surface', source: 'measured' },
  'energy:roof': { parentId: 'energy:surfaces', level: 'surface', source: 'wizard_default' },
  'energy:floor': { parentId: 'energy:surfaces', level: 'surface', source: 'wizard_default' },
  'energy:openings': { parentId: 'energy:zone', level: 'opening', source: 'wizard_default' },
  'energy:window': { parentId: 'energy:openings', level: 'opening', source: 'measured' },
  'energy:shades': { parentId: 'energy:zone', level: 'shade', source: 'wizard_default' },
  'energy:overhang': { parentId: 'energy:shades', level: 'shade', source: 'measured' },
  'energy:leftFin': { parentId: 'energy:shades', level: 'shade', source: 'measured' },
  'energy:rightFin': { parentId: 'energy:shades', level: 'shade', source: 'measured' },
  'energy:loads': { parentId: 'energy:zone', level: 'internal_load', source: 'wizard_default' },
  'energy:people': { parentId: 'energy:loads', level: 'internal_load', source: 'wizard_default' },
  'energy:lights': { parentId: 'energy:loads', level: 'internal_load', source: 'wizard_default' },
  'energy:equipment': { parentId: 'energy:loads', level: 'internal_load', source: 'wizard_default' },
  'energy:hvac': { parentId: 'energy:zone', level: 'hvac', source: 'wizard_default' },
  'energy:simulation': { parentId: 'energy:zone', level: 'simulation', source: 'wizard_default' },
  'energy:outputs': { parentId: 'energy:zone', level: 'output', source: 'wizard_default' },
  'energy:results': { parentId: 'energy:simulation', level: 'simulation', source: 'wizard_default' },
};

const PARAMETER_META: Record<
  EnergyParameterKey,
  { label: string; min: number; max: number; step: number; unit?: string }
> = {
  width: { label: 'Width', min: 3, max: 21, step: 0.01, unit: 'm' },
  height: { label: 'Height', min: 2.13, max: 8, step: 0.01, unit: 'm' },
  depth: { label: 'Depth', min: 3, max: 21, step: 0.01, unit: 'm' },
  glazing: { label: 'Glazing', min: 0, max: 99, step: 1, unit: '%' },
  overhang: { label: 'Overhang ratio', min: 0.01, max: 0.9, step: 0.01 },
  leftFin: { label: 'Left fin ratio', min: 0.01, max: 0.4, step: 0.01 },
  rightFin: { label: 'Right fin ratio', min: 0.01, max: 0.4, step: 0.01 },
  day: { label: 'Day', min: 1, max: 365, step: 1 },
  hour: { label: 'Hour', min: 1, max: 24, step: 1 },
  orientation: { label: 'Orientation', min: 0, max: 360, step: 1, unit: 'deg' },
};

const OBJECT_PARAMETER_KEYS: Record<EnergyObjectId, EnergyParameterKey[]> = {
  'energy:surface': [],
  'energy:facade': ['width', 'height', 'depth'],
  'energy:window': ['glazing'],
  'energy:overhang': ['overhang'],
  'energy:leftFin': ['leftFin'],
  'energy:rightFin': ['rightFin'],
  'energy:sun': ['day', 'hour'],
  'energy:results': [],
};

const SITE_TABS: EnergyInspectorTab[] = [
  'summary',
  'weather',
  'simulation',
];
const BLOCK_TABS: EnergyInspectorTab[] = [
  'summary',
  'layout',
  'envelope',
  'openings',
];
const ZONE_TABS: EnergyInspectorTab[] = [
  'summary',
  'internalLoads',
  'hvac',
  'comfort',
  'outputs',
];
const SURFACE_TABS: EnergyInspectorTab[] = [
  'summary',
  'construction',
  'boundary',
  'openings',
];
const OPENING_TABS: EnergyInspectorTab[] = [
  'summary',
  'glazing',
];
const SHADE_TABS: EnergyInspectorTab[] = ['summary', 'geometry'];
const LOAD_TABS: EnergyInspectorTab[] = [
  'people',
  'lights',
  'equipment',
  'schedules',
];
const HVAC_TABS: EnergyInspectorTab[] = ['system', 'setpoints', 'ventilation'];
const OUTPUT_TABS: EnergyInspectorTab[] = [
  'simulation',
  'outputs',
  'validation',
  'joblistPreview',
];

const PRIORITY_TABS: EnergyInspectorTab[] = [
  'summary',
  'layout',
  'openings',
  'simulation',
  'envelope',
  'internalLoads',
  'hvac',
];

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function orderedTabs(tabs: EnergyInspectorTab[]): EnergyInspectorTab[] {
  return PRIORITY_TABS.filter((tab) => tabs.includes(tab));
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) {
      material.forEach((entry) => entry.dispose());
    } else if (material) {
      material.dispose();
    }
  });
}

function highlightObject(mesh: THREE.Mesh) {
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry),
    new THREE.LineBasicMaterial({
      color: GRAPH_THEME.accent.primary,
      transparent: true,
      opacity: 0.92,
    }),
  );
  edges.renderOrder = 10;
  mesh.add(edges);
}

function selectableBox(
  objectId: EnergyObjectId,
  size: [number, number, number],
  color: string,
  selectedObjectId: string | null,
  materialOptions: THREE.MeshStandardMaterialParameters = {},
): THREE.Mesh {
  const selected = selectedObjectId === objectId;
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(size[0], size[1], size[2]),
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.56,
      emissive: selected ? GRAPH_THEME.accent.primary : '#000000',
      emissiveIntensity: selected ? 0.24 : 0,
      ...materialOptions,
    }),
  );
  mesh.userData.energyObjectId = objectId;
  if (selected) highlightObject(mesh);
  return mesh;
}

function buildFacadeGroup(
  inputs: EnergySurfaceParameters,
  selectedObjectId: string | null,
): THREE.Group {
  const group = new THREE.Group();
  const wallWidth = inputs.width;
  const wallHeight = inputs.height;
  const zoneDepth = inputs.depth;
  const windowScale = Math.sqrt(inputs.glazing / 100);
  const windowWidth = wallWidth * windowScale;
  const windowHeight = wallHeight * windowScale;

  const facade = selectableBox(
    'energy:facade',
    [wallWidth, zoneDepth, wallHeight],
    '#d9bd77',
    selectedObjectId,
    {
      transparent: true,
      opacity: 0.32,
    },
  );
  facade.position.set(0, 0, wallHeight / 2);
  group.add(facade);

  const facadeFace = selectableBox(
    'energy:facade',
    [wallWidth, 0.06, wallHeight],
    '#c99a45',
    selectedObjectId,
  );
  facadeFace.position.set(0, -zoneDepth / 2 - 0.03, wallHeight / 2);
  group.add(facadeFace);

  const windowMesh = selectableBox(
    'energy:window',
    [windowWidth, 0.08, windowHeight],
    '#3b75ff',
    selectedObjectId,
    {
      emissive: selectedObjectId === 'energy:window' ? '#37adaa' : '#143fb5',
      emissiveIntensity: selectedObjectId === 'energy:window' ? 0.36 : 0.26,
      transparent: true,
      opacity: 0.76,
    },
  );
  windowMesh.position.set(0, -zoneDepth / 2 - 0.08, wallHeight / 2);
  group.add(windowMesh);

  const overhang = selectableBox(
    'energy:overhang',
    [windowWidth, inputs.overhang * windowHeight, 0.08],
    '#d85b48',
    selectedObjectId,
  );
  overhang.position.set(
    0,
    -zoneDepth / 2 - (inputs.overhang * windowHeight) / 2,
    wallHeight / 2 + windowHeight / 2,
  );
  group.add(overhang);

  const leftFin = selectableBox(
    'energy:leftFin',
    [0.08, inputs.leftFin * windowWidth, windowHeight],
    '#d85b48',
    selectedObjectId,
  );
  leftFin.position.set(
    -windowWidth / 2,
    -zoneDepth / 2 - (inputs.leftFin * windowWidth) / 2,
    wallHeight / 2,
  );
  group.add(leftFin);

  const rightFin = selectableBox(
    'energy:rightFin',
    [0.08, inputs.rightFin * windowWidth, windowHeight],
    '#d85b48',
    selectedObjectId,
  );
  rightFin.position.set(
    windowWidth / 2,
    -zoneDepth / 2 - (inputs.rightFin * windowWidth) / 2,
    wallHeight / 2,
  );
  group.add(rightFin);

  group.rotation.z = (inputs.orientation - 180) * (Math.PI / 180);
  return group;
}

function buildEnergyDesignObjects(inputs: EnergySurfaceParameters): EnergyDesignObject[] {
  const solar = calculateSolarPosition({
        dayOfYear: inputs.day,
        hour: inputs.hour,
        latitudeDeg: 45,
        orientationDeg: DEFAULT_SOLAR_ORIENTATION_DEG,
        radius: 10,
      });
  const resultCooling = clampNumber(
    48 +
      inputs.glazing * 0.18 -
      (inputs.overhang * 0.21 + inputs.leftFin * 0.13 + inputs.rightFin * 0.13) *
        24,
    18,
    96,
  );
  const resultHeating = clampNumber(
    62 - inputs.glazing * 0.11 + Math.abs(inputs.orientation - 180) * 0.035,
    22,
    92,
  );

  const makeObject = (
    id: string,
    name: string,
    kind: string,
    role: string,
    relationships: string[],
    tabs: EnergyInspectorTab[],
    visualObjectId?: EnergyObjectId,
    parameterKeys: EnergyParameterKey[] = [],
  ): EnergyDesignObject => {
    const nodeDetails = MODEL_NODE_DETAILS[id] || {
      parentId: null,
      level: 'project' as EnergyModelLevel,
      source: 'wizard_default' as EnergyModelSource,
    };
    return {
      id,
      parentId: nodeDetails.parentId,
      level: nodeDetails.level,
      name,
      kind,
      role,
      tabs,
      visualObjectId,
      source: nodeDetails.source,
      relationships,
      parameters: parameterKeys.map((key) => ({
        key,
        ...PARAMETER_META[key],
        unit: PARAMETER_META[key].unit || '',
        value: inputs[key],
        measuredValue: ENERGY_DEFAULT_PARAMETERS[key],
        source: key === 'day' || key === 'hour' || key === 'orientation' ? 'wizard_default' : 'measured',
      })),
    };
  };

  return [
    makeObject(
      'energy:project',
      'Project',
      'Model Builder',
      'Project root for the shoebox model.',
      ['Site', 'Simulation', 'Outputs'],
      SITE_TABS,
      'energy:facade',
    ),
    makeObject(
      'energy:site',
      'Site',
      'weather and solar context',
      'Defines the site, weather placeholder, and solar date context for the starter shoebox.',
      ['Building 1', 'Weather', 'Solar', 'Simulation'],
      SITE_TABS,
      'energy:sun',
      ['day', 'hour'],
    ),
    makeObject(
      'energy:building',
      'Building 1',
      'building container',
      'Parent building container for the single-block solar shoebox model.',
      ['Site', 'Level 1', 'Zone 1'],
      BLOCK_TABS,
      'energy:facade',
      ['width', 'height', 'depth'],
    ),
    makeObject(
      'energy:level',
      'Level 1',
      'level container',
      'Single starter level hosting the shoebox block and zone.',
      ['Building 1', 'Block 1 / Solar Shoebox', 'Zone 1'],
      BLOCK_TABS,
      'energy:facade',
      ['height'],
    ),
    makeObject(
      'energy:block',
      'Block 1 / Solar Shoebox',
      'simple block model',
      'Simplified solar shoebox block carrying the current width, depth, height, envelope, and opening controls.',
      ['Zone 1', 'Wall: South / Facade', 'Opening: Window', 'External Shades'],
      BLOCK_TABS,
      'energy:facade',
      ['width', 'height', 'depth'],
    ),
    makeObject(
      'energy:zone',
      'Zone 1',
      'thermal zone',
      'Single thermal zone placeholder for internal loads, HVAC setpoints, comfort, and output requests.',
      ['People', 'Lights', 'Equipment', 'HVAC', 'Outputs'],
      ZONE_TABS,
      'energy:facade',
    ),
    makeObject(
      'energy:surfaces',
      'Surfaces',
      'surface group',
      'Envelope surface collection for the starter shoebox. The current editable surface is the south facade.',
      ['Wall: South / Facade', 'Roof', 'Floor'],
      SURFACE_TABS,
      'energy:facade',
    ),
    makeObject(
      'energy:facade',
      'Wall: South / Facade',
      'exterior surface',
      'Primary exterior wall surface receiving the window opening and external shades.',
      ['Block 1 / Solar Shoebox', 'Opening: Window', 'External Shade: Overhang'],
      SURFACE_TABS,
      'energy:facade',
      OBJECT_PARAMETER_KEYS['energy:facade'],
    ),
    makeObject(
      'energy:roof',
      'Roof',
      'surface placeholder',
      'Roof surface placeholder for the simplified shoebox. Detailed roof geometry is not editable yet.',
      ['Block 1 / Solar Shoebox', 'Envelope'],
      SURFACE_TABS,
      'energy:facade',
    ),
    makeObject(
      'energy:floor',
      'Floor',
      'surface placeholder',
      'Floor surface placeholder for the simplified shoebox. Boundary and construction are recorded as future inputs.',
      ['Block 1 / Solar Shoebox', 'Envelope'],
      SURFACE_TABS,
      'energy:facade',
    ),
    makeObject(
      'energy:openings',
      'Openings',
      'opening group',
      'Opening collection for the facade. The current editable opening is the window.',
      ['Wall: South / Facade', 'Opening: Window'],
      OPENING_TABS,
      'energy:window',
    ),
    makeObject(
      'energy:window',
      'Opening: Window',
      'window opening',
      'Controls window-to-wall ratio and drives the visible glazing area on the facade.',
      ['Wall: South / Facade', 'External Shade: Overhang', 'Outputs'],
      OPENING_TABS,
      'energy:window',
      OBJECT_PARAMETER_KEYS['energy:window'],
    ),
    makeObject(
      'energy:shades',
      'External Shades',
      'shade group',
      'External shade collection attached to the window opening.',
      ['Opening: Window', 'External Shade: Overhang', 'External Shade: Left Fin', 'External Shade: Right Fin'],
      SHADE_TABS,
      'energy:overhang',
    ),
    makeObject(
      'energy:overhang',
      'External Shade: Overhang',
      'horizontal shade',
      'Projects from the facade above the window to reduce direct solar gain.',
      ['Opening: Window', 'Site Solar', 'Outputs'],
      SHADE_TABS,
      'energy:overhang',
      OBJECT_PARAMETER_KEYS['energy:overhang'],
    ),
    makeObject(
      'energy:leftFin',
      'External Shade: Left Fin',
      'vertical shade',
      'Left side external fin tied to the current window width.',
      ['Opening: Window', 'Site Solar'],
      SHADE_TABS,
      'energy:leftFin',
      OBJECT_PARAMETER_KEYS['energy:leftFin'],
    ),
    makeObject(
      'energy:rightFin',
      'External Shade: Right Fin',
      'vertical shade',
      'Right side external fin tied to the current window width.',
      ['Opening: Window', 'Site Solar'],
      SHADE_TABS,
      'energy:rightFin',
      OBJECT_PARAMETER_KEYS['energy:rightFin'],
    ),
    makeObject(
      'energy:loads',
      'Internal Loads',
      'load group',
      'Placeholder load group for people, lighting, equipment, and schedules.',
      ['People', 'Lights', 'Equipment', 'Schedules'],
      LOAD_TABS,
      'energy:facade',
    ),
    makeObject(
      'energy:people',
      'People',
      'people loads',
      'People load placeholder for occupancy assumptions recovered into the simulation manifest.',
      ['Zone 1', 'Schedules', 'Comfort'],
      LOAD_TABS,
      'energy:facade',
    ),
    makeObject(
      'energy:lights',
      'Lights',
      'lighting loads',
      'Lighting load placeholder for future gains and schedule inputs.',
      ['Zone 1', 'Schedules', 'Outputs'],
      LOAD_TABS,
      'energy:facade',
    ),
    makeObject(
      'energy:equipment',
      'Equipment',
      'equipment loads',
      'Equipment load placeholder for future plug-load and sensible gain inputs.',
      ['Zone 1', 'Schedules', 'Outputs'],
      LOAD_TABS,
      'energy:facade',
    ),
    makeObject(
      'energy:hvac',
      'HVAC',
      'ideal loads placeholder',
      'HVAC placeholder for system assumptions, heating and cooling setpoints, and ventilation.',
      ['Zone 1', 'Comfort', 'Outputs'],
      HVAC_TABS,
      'energy:facade',
    ),
    makeObject(
      'energy:sun',
      'Site Solar',
      'solar context',
      solar.aboveHorizon
        ? `Altitude ${solar.altitudeDeg.toFixed(1)} deg, azimuth ${solar.azimuthDeg.toFixed(1)} deg.`
        : `Sun below horizon. Sunrise ${solar.sunriseHour.toFixed(1)}, sunset ${solar.sunsetHour.toFixed(1)}.`,
      ['Site', 'Wall: South / Facade', 'External Shades'],
      SITE_TABS,
      'energy:sun',
      OBJECT_PARAMETER_KEYS['energy:sun'],
    ),
    makeObject(
      'energy:simulation',
      'Simulation',
      'simulation setup',
      'Simulation manifest and engine connection placeholder. Execution remains disabled in the UI.',
      ['Outputs', 'Validation', 'Parametric Preview'],
      OUTPUT_TABS,
      'energy:results',
    ),
    makeObject(
      'energy:outputs',
      'Outputs',
      'simulation outputs',
      `Current preview estimate: heating ${resultHeating.toFixed(1)}, cooling ${resultCooling.toFixed(1)}.`,
      ['Simulation', 'Validation', 'Parametric Preview'],
      OUTPUT_TABS,
      'energy:results',
    ),
    makeObject(
      'energy:results',
      'Simulation',
      'run manifest',
      `Backend execution is disabled. Current preview estimate: heating ${resultHeating.toFixed(1)}, cooling ${resultCooling.toFixed(1)}.`,
      ['Outputs', 'Validation', 'Parametric Preview'],
      OUTPUT_TABS,
      'energy:results',
    ),
  ];
}

function modelBuilderObjectToWorkspaceObject(object: EnergyDesignObject) {
  return {
    id: object.id,
    surface: 'energy' as const,
    type: object.kind,
    label: object.name,
    parameters: {
      level: object.level,
      relationships: object.relationships,
      availableActions: ['select_object', 'update_object_parameter', 'reset_energy_surface'],
      editableParameters: object.parameters,
    },
  };
}

function FacadeScene({
  inputs,
  selectedObjectId,
  interactionLocked,
  cameraCommand,
  onObjectSelect,
}: {
  inputs: EnergySurfaceParameters;
  selectedObjectId: string | null;
  interactionLocked: boolean;
  cameraCommand: EnergyCameraCommand;
  onObjectSelect: (objectId: EnergyObjectId) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const inputsRef = useRef(inputs);
  const selectedObjectIdRef = useRef(selectedObjectId);
  const interactionLockedRef = useRef(interactionLocked);
  const onObjectSelectRef = useRef(onObjectSelect);
  const cameraCommandRef = useRef(cameraCommand);
  inputsRef.current = inputs;
  selectedObjectIdRef.current = selectedObjectId;
  interactionLockedRef.current = interactionLocked;
  onObjectSelectRef.current = onObjectSelect;
  cameraCommandRef.current = cameraCommand;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2('#0b101a', 0.018);
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    host.appendChild(renderer.domElement);

    const target = new THREE.Vector3(0, 0, 1.6);
    let yaw = 0;
    let pitch = 0.32;
    let distance = 13;
    let pointerDownX = 0;
    let pointerDownY = 0;
    let lastPointerX = 0;
    let lastPointerY = 0;
    let dragging = false;
    let panMode = false;
    let frame = 0;
    let previousSignature = '';
    let lastCameraCommandToken = 0;
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    scene.add(new THREE.AmbientLight(0xffffff, 0.68));
    scene.add(new THREE.HemisphereLight('#6f92c7', '#1a202d', 0.45));
    const sunLight = new THREE.DirectionalLight('#fff3c4', 0.95);
    scene.add(sunLight);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(120, 120),
      new THREE.MeshStandardMaterial({
        color: '#0f1724',
        roughness: 0.94,
        metalness: 0.06,
        transparent: true,
        opacity: 0.96,
      }),
    );
    ground.position.set(0, 0, -0.02);
    scene.add(ground);

    const floorGrid = new THREE.GridHelper(120, 80, '#2f3f56', '#1c2738');
    floorGrid.rotation.x = Math.PI / 2;
    floorGrid.position.set(0, 0, 0);
    scene.add(floorGrid);

    const sunSphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.26, 32, 16),
      new THREE.MeshBasicMaterial({ color: '#ffd84a' }),
    );
    sunSphere.userData.energyObjectId = 'energy:sun';
    scene.add(sunSphere);
    const sunRayGeometry = new THREE.BufferGeometry();
    const sunRay = new THREE.Line(
      sunRayGeometry,
      new THREE.LineBasicMaterial({
        color: '#ffd84a',
        transparent: true,
        opacity: 0.36,
      }),
    );
    scene.add(sunRay);

    let sunHighlight: THREE.LineSegments | null = null;
    let facadeGroup = buildFacadeGroup(inputsRef.current, selectedObjectIdRef.current);
    scene.add(facadeGroup);

    const applyCamera = () => {
      const horizontal = Math.cos(pitch) * distance;
      camera.position.set(
        target.x + Math.sin(yaw) * horizontal,
        target.y - Math.cos(yaw) * horizontal,
        target.z + Math.sin(pitch) * distance,
      );
      camera.lookAt(target);
    };

    const fitView = () => {
      const current = inputsRef.current;
      const maxDimension = Math.max(current.width, current.depth, current.height);
      target.set(0, 0, current.height * 0.54);
      yaw = 0;
      pitch = 0.34;
      distance = clampNumber(maxDimension * 2.45, 11, 24);
      applyCamera();
    };

    const applyCameraCommand = (command: EnergyCameraCommand) => {
      if (!command || command.token === lastCameraCommandToken) return;
      lastCameraCommandToken = command.token;
      if (command.action === 'zoom_in') {
        distance = clampNumber(distance * 0.82, 4, 28);
        applyCamera();
        return;
      }
      if (command.action === 'zoom_out') {
        distance = clampNumber(distance * 1.18, 4, 28);
        applyCamera();
        return;
      }
      fitView();
    };

    const resize = () => {
      const width = Math.max(host.clientWidth, 1);
      const height = Math.max(host.clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      applyCamera();
    };

    const selectFromPointer = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects([facadeGroup, sunSphere], true);
      const hit = hits.find((entry) => {
        let current: THREE.Object3D | null = entry.object;
        while (current) {
          if (current.userData.energyObjectId) return true;
          current = current.parent;
        }
        return false;
      });
      if (!hit) return;
      let current: THREE.Object3D | null = hit.object;
      while (current && !current.userData.energyObjectId) current = current.parent;
      const objectId = current?.userData.energyObjectId;
      if (objectId) onObjectSelectRef.current(objectId as EnergyObjectId);
    };

    const onPointerDown = (event: PointerEvent) => {
      dragging = true;
      panMode = event.button === 2 || event.shiftKey;
      pointerDownX = event.clientX;
      pointerDownY = event.clientY;
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
      renderer.domElement.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!dragging || interactionLockedRef.current) return;
      const dx = event.clientX - lastPointerX;
      const dy = event.clientY - lastPointerY;
      if (panMode) {
        const panScale = distance * 0.0019;
        target.x -= dx * panScale;
        target.z += dy * panScale;
      } else {
        yaw += dx * 0.006;
        pitch = clampNumber(pitch + dy * 0.003, -0.35, 1.05);
      }
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
      applyCamera();
    };

    const onPointerUp = (event: PointerEvent) => {
      dragging = false;
      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
      }
      const moved =
        Math.abs(event.clientX - pointerDownX) + Math.abs(event.clientY - pointerDownY);
      if (moved < 5) selectFromPointer(event);
    };

    const onWheel = (event: WheelEvent) => {
      if (interactionLockedRef.current) return;
      event.preventDefault();
      distance = clampNumber(distance + event.deltaY * 0.012, 4, 28);
      applyCamera();
    };

    const onContextMenu = (event: MouseEvent) => event.preventDefault();

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false });
    renderer.domElement.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('resize', resize);
    fitView();
    resize();

    const animate = () => {
      const current = inputsRef.current;
      const signature = `${JSON.stringify(current)}:${selectedObjectIdRef.current}`;
      applyCameraCommand(cameraCommandRef.current);
      if (signature !== previousSignature) {
        previousSignature = signature;
        scene.remove(facadeGroup);
        disposeObject(facadeGroup);
        facadeGroup = buildFacadeGroup(current, selectedObjectIdRef.current);
        scene.add(facadeGroup);
      }

      const solar = calculateSolarPosition({
        dayOfYear: current.day,
        hour: current.hour,
        latitudeDeg: 45,
        // Later, orientation should come from Site/Building layout, not the Solar Position strip.
        orientationDeg: DEFAULT_SOLAR_ORIENTATION_DEG,
        radius: 10,
      });
      const sunPosition = new THREE.Vector3(solar.x, solar.y, solar.z);
      sunSphere.position.copy(sunPosition);
      sunSphere.visible = true;
      sunSphere.scale.setScalar(solar.aboveHorizon ? 1 : 0.54);
      sunLight.position.copy(sunPosition).multiplyScalar(2.5);
      sunLight.intensity = solar.aboveHorizon ? 0.95 : 0.08;
      (sunRay.material as THREE.LineBasicMaterial).opacity = solar.aboveHorizon
        ? 0.36
        : 0.1;
      sunRayGeometry.setFromPoints([
        new THREE.Vector3(0, 0, 0.05),
        sunPosition.clone(),
      ]);
      const sunSelected = selectedObjectIdRef.current === 'energy:sun';
      const sunMaterial = sunSphere.material as THREE.MeshBasicMaterial;
      sunMaterial.color.set(
        sunSelected
          ? GRAPH_THEME.accent.primary
          : solar.aboveHorizon
          ? '#ffd84a'
          : '#6f6f63',
      );
      if (sunSelected && !sunHighlight) {
        sunHighlight = new THREE.LineSegments(
          new THREE.EdgesGeometry(sunSphere.geometry),
          new THREE.LineBasicMaterial({ color: GRAPH_THEME.accent.primary }),
        );
        sunSphere.add(sunHighlight);
      } else if (!sunSelected && sunHighlight) {
        sunSphere.remove(sunHighlight);
        disposeObject(sunHighlight);
        sunHighlight = null;
      }

      renderer.render(scene, camera);
      frame = window.requestAnimationFrame(animate);
    };
    animate();

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('wheel', onWheel);
      renderer.domElement.removeEventListener('contextmenu', onContextMenu);
      scene.remove(facadeGroup);
      disposeObject(facadeGroup);
      disposeObject(sunSphere);
      sunRayGeometry.dispose();
      (sunRay.material as THREE.Material).dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={hostRef} style={{ width: '100%', height: '100%' }} />;
}

function ParameterControl({
  parameter,
  value,
  onChange,
  onResetMeasured,
}: {
  parameter: EnergyDesignObject['parameters'][number];
  value: number;
  onChange: (value: number) => void;
  onResetMeasured?: () => void;
}) {
  return (
    <label style={{ display: 'grid', gap: 7, fontSize: 11 }}>
      <span
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 10,
          color: GRAPH_THEME.drawer.inputMuted,
        }}
      >
        <span>{parameter.label}</span>
        <strong style={{ color: GRAPH_THEME.drawer.inputText }}>
          {value}
          {parameter.unit || ''}
        </strong>
      </span>
      <span
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span style={{ color: GRAPH_THEME.drawer.inputMuted }}>
          measured {parameter.measuredValue}
          {parameter.unit}
        </span>
        {value !== parameter.measuredValue && onResetMeasured ? (
          <button
            type="button"
            onClick={onResetMeasured}
            style={graphDrawerButtonStyle({
              minHeight: 22,
              padding: '3px 7px',
              fontSize: 10,
            })}
          >
            Reset measured
          </button>
        ) : null}
      </span>
      <input
        type="range"
        min={parameter.min}
        max={parameter.max}
        step={parameter.step}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        style={{ width: '100%', accentColor: GRAPH_THEME.accent.primary }}
      />
    </label>
  );
}

function SolarTimeControl({
  parameter,
  value,
  onChange,
}: {
  parameter: Pick<EnergyEditableParameter, 'label' | 'min' | 'max' | 'step' | 'unit'>;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label style={{ display: 'grid', gap: 7, fontSize: 11 }}>
      <span
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 10,
          color: GRAPH_THEME.drawer.inputMuted,
        }}
      >
        <span>{parameter.label}</span>
        <strong style={{ color: GRAPH_THEME.drawer.inputText }}>
          {value}
          {parameter.unit || ''}
        </strong>
      </span>
      <input
        type="range"
        min={parameter.min}
        max={parameter.max}
        step={parameter.step}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        style={{ width: '100%', accentColor: GRAPH_THEME.accent.primary }}
      />
    </label>
  );
}

function makeParameter(
  key: EnergyParameterKey,
  value: number,
): EnergyEditableParameter {
  return {
    key,
    ...PARAMETER_META[key],
    unit: PARAMETER_META[key].unit || '',
    value,
    measuredValue: ENERGY_DEFAULT_PARAMETERS[key],
    source:
      key === 'day' || key === 'hour' || key === 'orientation'
        ? 'wizard_default'
        : 'measured',
  };
}

function ReadonlyField({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 10,
        color: GRAPH_THEME.drawer.inputMuted,
        fontSize: 11,
      }}
    >
      <span>{label}</span>
      <strong style={{ color: GRAPH_THEME.drawer.inputText, textAlign: 'right' }}>
        {value}
      </strong>
    </div>
  );
}

function TabSection({ children }: { children: ReactNode }) {
  return (
    <div
      style={graphDrawerSectionStyle({
        padding: 10,
        display: 'grid',
        gap: 10,
      })}
    >
      {children}
    </div>
  );
}

function EnergyInspector({
  object,
  inputs,
  prepManifest,
  latestActionSummary,
  onParameterChange,
  onReset,
  onClose,
}: {
  object: EnergyDesignObject;
  inputs: EnergySurfaceParameters;
  prepManifest: EnergyRunPrepManifest;
  latestActionSummary: string | null;
  onParameterChange: (
    objectId: EnergyObjectId,
    key: EnergyParameterKey,
    value: number,
  ) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<EnergyInspectorTab>(object.tabs[0]);
  useEffect(() => {
    setActiveTab(orderedTabs(object.tabs)[0] || 'summary');
  }, [object.id, object.tabs]);
  const renderParameter = (key: EnergyParameterKey) => {
    const parameter = makeParameter(key, inputs[key]);
    return (
      <ParameterControl
        key={key}
        parameter={parameter}
        value={inputs[key]}
        onChange={(value) =>
          onParameterChange(object.visualObjectId || 'energy:surface', key, value)
        }
        onResetMeasured={() =>
          onParameterChange(
            object.visualObjectId || 'energy:surface',
            key,
            ENERGY_DEFAULT_PARAMETERS[key],
          )
        }
      />
    );
  };
  const renderSolarTimeInput = (key: 'day' | 'hour') => (
    <SolarTimeControl
      key={key}
      parameter={{
        ...PARAMETER_META[key],
        unit: PARAMETER_META[key].unit ?? '',
      }}
      value={inputs[key]}
      onChange={(value) => onParameterChange('energy:sun', key, value)}
    />
  );
  const templateParameters = prepManifest.parameters;
  const validationIssueCount =
    prepManifest.validation.errors.length + prepManifest.validation.warnings.length;
  const solarState = prepManifest.model.solar.aboveHorizon ? 'Above' : 'Below';
  const visibleTabs = orderedTabs(object.tabs);

  return (
    <aside
      data-testid="energy-object-inspector"
      className="energy-object-inspector"
      style={graphGlassCardStyle({
        position: 'absolute',
        right: 16,
        top: 16,
        bottom: 16,
        zIndex: 25,
        width: 'min(340px, calc(100% - 92px))',
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        overflow: 'hidden',
        maxHeight: 'calc(100% - 32px)',
      })}
    >
      <div>
        <div style={{ display: 'flex', alignItems: 'start', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ color: GRAPH_THEME.drawer.inputText, fontSize: 18, fontWeight: 700 }}>
            {object.name}
          </div>
          <button
            type="button"
            aria-label="Close edit inspector"
            onClick={onClose}
            style={graphDrawerButtonStyle({ minHeight: 24, padding: '3px 8px' })}
          >
            Close
          </button>
        </div>
        <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <span style={graphGlassPillStyle()}>{object.kind}</span>
        </div>
      </div>

      <div style={graphCompanionTabGroupStyle({ flexWrap: 'wrap', gap: 6 })}>
        {visibleTabs.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            style={graphCompanionTabButtonStyle(activeTab === tab, {
              flex: '1 1 auto',
              minWidth: 56,
              textAlign: 'center',
            })}
          >
            {ENERGY_TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      <div
        className="energy-inspector-scroll"
        style={{
          minHeight: 0,
          overflowY: 'auto',
          paddingRight: 2,
          display: 'grid',
          gap: 10,
        }}
      >
        {activeTab === 'summary' ? (
          <TabSection>
            <div
              style={{
                color: GRAPH_THEME.drawer.inputMuted,
                fontSize: 12,
                lineHeight: 1.45,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {object.role}
            </div>
            <ReadonlyField label="Type" value={object.kind} />
            <ReadonlyField label="Level" value={object.level.replace('_', ' ')} />
            {object.parameters.length ? (
              <div style={{ display: 'grid', gap: 7 }}>
                <div style={{ color: GRAPH_THEME.drawer.inputText, fontSize: 12, fontWeight: 700 }}>
                  Current values
                </div>
                {object.parameters.map((parameter) => (
                  <ReadonlyField
                    key={parameter.key}
                    label={parameter.label}
                    value={`${inputs[parameter.key]}${parameter.unit || ''}`}
                  />
                ))}
              </div>
            ) : null}
            {latestActionSummary ? (
              <div
                data-testid="workspace-action-summary"
                style={{
                  borderTop: `1px solid ${GRAPH_THEME.drawer.sectionBorder}`,
                  paddingTop: 10,
                  color: GRAPH_THEME.drawer.inputMuted,
                  fontSize: 11,
                  lineHeight: 1.45,
                }}
              >
                {latestActionSummary}
              </div>
            ) : null}
          </TabSection>
        ) : null}

        {activeTab === 'layout' ? (
          <TabSection>
            {(['width', 'height', 'depth'] as EnergyParameterKey[]).map(renderParameter)}
            <button
              type="button"
              data-testid="energy-reset-surface"
              onClick={onReset}
              style={graphDrawerButtonStyle({ justifySelf: 'start' })}
            >
              Reset
            </button>
          </TabSection>
        ) : null}

        {activeTab === 'geometry' ? (
          <TabSection>
            {object.id === 'energy:leftFin'
              ? renderParameter('leftFin')
              : object.id === 'energy:rightFin'
              ? renderParameter('rightFin')
              : object.id === 'energy:overhang'
              ? renderParameter('overhang')
              : (['overhang', 'leftFin', 'rightFin'] as EnergyParameterKey[]).map(
                  renderParameter,
                )}
            <ReadonlyField label="Host opening" value="Opening: Window" />
          </TabSection>
        ) : null}

        {activeTab === 'weather' ? (
          <TabSection>
            <ReadonlyField label="Site" value={templateParameters.site} />
            <ReadonlyField label="Weather file" value="Pending backend weather adapter" />
            <ReadonlyField label="Latitude" value="45 deg preview" />
            {object.id === 'energy:site' || object.id === 'energy:sun' ? (
              <>
                {(['day', 'hour'] as const).map(renderSolarTimeInput)}
                <ReadonlyField
                  label="Altitude"
                  value={`${prepManifest.model.solar.altitudeDeg.toFixed(1)} deg`}
                />
                <ReadonlyField
                  label="Azimuth"
                  value={`${prepManifest.model.solar.azimuthDeg.toFixed(1)} deg`}
                />
                <ReadonlyField label="Sun state" value={solarState} />
              </>
            ) : null}
          </TabSection>
        ) : null}

        {activeTab === 'envelope' || activeTab === 'construction' ? (
          <TabSection>
            <ReadonlyField label="Wall type" value={templateParameters.wallType} />
            <ReadonlyField label="PCM material" value={templateParameters.pcmMaterial} />
            <ReadonlyField label="Insulation level" value={templateParameters.insulationLevel} />
            <ReadonlyField label="Boundary basis" value="Recovered facade shoebox defaults" />
          </TabSection>
        ) : null}

        {activeTab === 'boundary' ? (
          <TabSection>
            <ReadonlyField label="Outside boundary" value="Outdoors" />
            <ReadonlyField label="Primary wall" value="Wall: South / Facade" />
            <ReadonlyField label="Orientation" value={`${DEFAULT_SOLAR_ORIENTATION_DEG} deg`} />
          </TabSection>
        ) : null}

        {activeTab === 'openings' || activeTab === 'glazing' ? (
          <TabSection>
            {renderParameter('glazing')}
            <ReadonlyField label="Window type" value={templateParameters.windowType} />
            <ReadonlyField label="Host surface" value="Wall: South / Facade" />
          </TabSection>
        ) : null}

        {activeTab === 'internalLoads' ||
        activeTab === 'people' ||
        activeTab === 'lights' ||
        activeTab === 'equipment' ||
        activeTab === 'schedules' ? (
          <TabSection>
            <ReadonlyField label="Occupancy" value={templateParameters.occupancyType} />
            <ReadonlyField label="People" value="Placeholder load object" />
            <ReadonlyField label="Lights" value="Placeholder load object" />
            <ReadonlyField label="Equipment" value="Placeholder load object" />
            <ReadonlyField label="Schedules" value="Schedule defaults pending" />
          </TabSection>
        ) : null}

        {activeTab === 'hvac' ||
        activeTab === 'system' ||
        activeTab === 'setpoints' ||
        activeTab === 'ventilation' ? (
          <TabSection>
            <ReadonlyField label="System" value="Ideal loads placeholder" />
            <ReadonlyField label="Cooling setpoint" value={`${templateParameters.coolingSetpoint} C`} />
            <ReadonlyField label="Heating setpoint" value={`${templateParameters.heatingSetpoint} C`} />
            <ReadonlyField label="Infiltration" value={`${templateParameters.infiltrationRate} ach`} />
          </TabSection>
        ) : null}

        {activeTab === 'comfort' ? (
          <TabSection>
            <ReadonlyField label="Cooling setpoint" value={`${templateParameters.coolingSetpoint} C`} />
            <ReadonlyField label="Heating setpoint" value={`${templateParameters.heatingSetpoint} C`} />
            <ReadonlyField label="Comfort scan" value="Future Room Comfort Scan" />
          </TabSection>
        ) : null}

        {activeTab === 'simulation' ||
        activeTab === 'outputs' ||
        activeTab === 'validation' ||
        activeTab === 'joblistPreview' ? (
          <TabSection>
            <div
              data-testid="energy-prep-status"
              style={{
                display: 'grid',
                gap: 7,
                color: GRAPH_THEME.drawer.inputMuted,
                fontSize: 11,
                lineHeight: 1.45,
              }}
            >
              <div
                style={{
                  color: prepManifest.validation.ok
                    ? GRAPH_THEME.accent.primary
                    : GRAPH_THEME.accent.solar,
                }}
              >
                {prepManifest.validation.ok
                  ? 'Simulation manifest ready for engine connection'
                  : `${prepManifest.validation.errors.length} validation issue${
                      prepManifest.validation.errors.length === 1 ? '' : 's'
                    }`}
              </div>
              <ReadonlyField label="Selected model item" value={object.name} />
              <ReadonlyField
                label="Backend"
                value={
                  prepManifest.backendReady
                    ? 'Simulation engine ready'
                    : 'Simulation engine not connected'
                }
              />
              <ReadonlyField
                label="Parametric rows"
                value={prepManifest.joblistPreview.length}
              />
              <ReadonlyField label="Issues" value={validationIssueCount} />
              <div>{prepManifest.reason}</div>
              {activeTab === 'joblistPreview' ? (
                <>
                  <ReadonlyField label="Columns" value={prepManifest.joblistColumns.length} />
                  <ReadonlyField
                    label="Measured width"
                    value={`${prepManifest.measuredParameters.width} m`}
                  />
                  <ReadonlyField
                    label="Modified width"
                    value={`${prepManifest.modifiedParameters.width} m`}
                  />
                </>
              ) : null}
              {prepManifest.validation.errors.map((issue) => (
                <div key={`error-${issue.field}`} style={{ color: GRAPH_THEME.accent.solar }}>
                  {issue.field}: {issue.message}
                </div>
              ))}
              {prepManifest.validation.warnings.map((issue) => (
                <div key={`warning-${issue.field}`}>
                  {issue.field}: {issue.message}
                </div>
              ))}
            </div>
          </TabSection>
        ) : null}
      </div>
    </aside>
  );
}

function EnergyModelTree({
  selectedId,
  isOpen,
  onToggle,
  onSelect,
}: {
  selectedId: string;
  isOpen: boolean;
  onToggle: () => void;
  onSelect: (id: string) => void;
}) {
  return (
    <nav
      data-testid="energy-model-tree"
      className="energy-glass-scroll energy-model-tree"
      style={graphGlassCardStyle({
        position: 'absolute',
        left: 16,
        top: 16,
        bottom: isOpen ? 128 : 'auto',
        zIndex: 24,
        width: isOpen ? 210 : 62,
        padding: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        overflow: 'hidden',
        transition: 'width 160ms ease, opacity 160ms ease',
        opacity: isOpen ? 1 : 0.8,
      })}
      aria-label="Energy model navigator"
    >
      <button
        type="button"
        onClick={onToggle}
        style={graphDrawerButtonStyle({
          minHeight: 28,
          width: isOpen ? '100%' : 36,
          justifyContent: 'space-between',
          fontSize: 11,
          padding: '5px 8px',
        })}
      >
        <span>{isOpen ? 'Model' : 'Model'}</span>
        {isOpen ? <span aria-hidden="true">−</span> : null}
      </button>
      <div
        className="energy-glass-scroll"
        style={{
          minHeight: 0,
          overflowY: 'auto',
          display: isOpen ? 'grid' : 'none',
          gap: 2,
        }}
      >
        {MODEL_TREE_NODES.map((node) => {
          const selected = selectedId === node.id;
          return (
            <button
              key={node.id}
              type="button"
              onClick={() => onSelect(node.id)}
              style={{
                width: '100%',
                border: selected
                  ? `1px solid ${GRAPH_THEME.accent.primaryBorder}`
                  : '1px solid transparent',
                borderRadius: 8,
                background: selected
                  ? 'rgba(68, 219, 216, 0.14)'
                  : 'rgba(255,255,255,0.02)',
                color: selected
                  ? GRAPH_THEME.drawer.inputText
                  : GRAPH_THEME.drawer.inputMuted,
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: selected ? 800 : 600,
                lineHeight: 1.25,
                minHeight: 26,
                padding: '5px 7px',
                paddingLeft: 7 + node.depth * 12,
                textAlign: 'left',
                whiteSpace: 'nowrap',
              }}
            >
              {node.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export default function EnergyFacadeSurface({
  inputs,
  selectedObjectId,
  latestActionSummary,
  onWorkspaceAction,
}: {
  inputs: EnergySurfaceParameters;
  selectedObjectId: string | null;
  latestActionSummary: string | null;
  onWorkspaceAction: (call: WorkspaceActionCall) => WorkspaceActionResult;
}): React.ReactElement {
  const [interactionLocked, setInteractionLocked] = useState(false);
  const [cameraCommand, setCameraCommand] = useState<EnergyCameraCommand>(null);
  const [selectedModelObjectId, setSelectedModelObjectId] = useState<string>('energy:block');
  const [modelTreeOpen, setModelTreeOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const showR3FSmoke =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('r3fSmoke') === '1';
  const designObjects = useMemo(() => buildEnergyDesignObjects(inputs), [inputs]);
  const prepManifest = useMemo(
    () => createEnergyRunPrepManifestFromSurface(inputs),
    [inputs],
  );
  const solar = useMemo(
    () =>
      calculateSolarPosition({
        dayOfYear: inputs.day,
        hour: inputs.hour,
        latitudeDeg: 45,
        orientationDeg: DEFAULT_SOLAR_ORIENTATION_DEG,
        radius: 10,
      }),
    [inputs.day, inputs.hour],
  );
  const selectedObject =
    designObjects.find((object) => object.id === selectedModelObjectId) ||
    designObjects.find((object) => object.id === selectedObjectId) ||
    designObjects.find((object) => object.id === 'energy:block') ||
    designObjects[0];
  const selectedWorkspaceObject = useMemo(
    () => modelBuilderObjectToWorkspaceObject(selectedObject),
    [selectedObject],
  );
  const visualSelectedObjectId = selectedObject?.visualObjectId || null;
  const applyParameter = (
    objectId: EnergyObjectId,
    key: EnergyParameterKey,
    value: number,
  ) => {
    onWorkspaceAction({
      actionId: 'update_object_parameter',
      targetObjectId: objectId,
      parameters: { parameter: key, value },
      source: 'manual',
    });
  };

  const selectObject = (objectId: string) => {
    setSelectedModelObjectId(objectId);
    setInspectorOpen(true);
    if (Object.prototype.hasOwnProperty.call(OBJECT_PARAMETER_KEYS, objectId)) {
      onWorkspaceAction({
        actionId: 'select_object',
        targetObjectId: objectId,
        source: 'manual',
      });
    }
  };

  const dispatchCameraAction = (action: EnergyCameraAction) => {
    setCameraCommand({ action, token: Date.now() });
  };

  return (
    <div
      data-testid="energy-facade-surface"
      style={{
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        color: GRAPH_THEME.surface.text,
        background: GRAPH_THEME.background.knowledgeSurface,
      }}
    >
      <style>
        {`
          .energy-inspector-scroll,
          .energy-glass-scroll {
            scrollbar-width: thin;
            scrollbar-color: ${GRAPH_THEME.drawer.tabRailBorder} transparent;
          }
          .energy-inspector-scroll::-webkit-scrollbar,
          .energy-glass-scroll::-webkit-scrollbar {
            width: 7px;
          }
          .energy-inspector-scroll::-webkit-scrollbar-track,
          .energy-glass-scroll::-webkit-scrollbar-track {
            background: transparent;
          }
          .energy-inspector-scroll::-webkit-scrollbar-thumb,
          .energy-glass-scroll::-webkit-scrollbar-thumb {
            background: ${GRAPH_THEME.drawer.tabRailBorder};
            border-radius: 999px;
          }
          .energy-inspector-scroll::-webkit-scrollbar-thumb:hover,
          .energy-glass-scroll::-webkit-scrollbar-thumb:hover {
            background: ${GRAPH_THEME.accent.primaryBorder};
          }
          .energy-model-tree {
            max-width: min(210px, calc(100% - 390px));
          }
        `}
      </style>
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 0,
          background:
            'radial-gradient(120% 85% at 50% 100%, rgba(33, 52, 76, 0.42) 0%, rgba(11, 16, 26, 0.12) 45%, rgba(8, 11, 18, 0.78) 100%)',
        }}
      />
      {showR3FSmoke ? (
        <R3FSmokeBoundary>
          <Suspense fallback={null}>
            <R3FSmokeTest />
          </Suspense>
        </R3FSmokeBoundary>
      ) : (
        <FacadeScene
          inputs={inputs}
          selectedObjectId={visualSelectedObjectId}
          interactionLocked={interactionLocked}
          cameraCommand={cameraCommand}
          onObjectSelect={selectObject}
        />
      )}

      <EnergyModelTree
        selectedId={selectedObject.id}
        isOpen={modelTreeOpen}
        onToggle={() => setModelTreeOpen((current) => !current)}
        onSelect={selectObject}
      />

      {!inspectorOpen ? (
        <button
          type="button"
          data-testid="energy-edit-pill"
          onClick={() => setInspectorOpen(true)}
          style={graphGlassCardStyle({
            position: 'absolute',
            right: 16,
            top: 16,
            zIndex: 24,
            minHeight: 36,
            padding: '8px 14px',
            color: GRAPH_THEME.drawer.inputText,
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 800,
          })}
        >
          Edit
        </button>
      ) : null}

      <div data-no-surface-promote="true" style={graphControlStackStyle}>
        <button
          type="button"
          aria-label="Zoom in"
          title="Zoom in"
          onClick={() => dispatchCameraAction('zoom_in')}
          style={graphControlButtonStyle({
            borderBottom: `1px solid ${GRAPH_THEME.controls.border}`,
          })}
        >
          +
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          title="Zoom out"
          onClick={() => dispatchCameraAction('zoom_out')}
          style={graphControlButtonStyle({
            borderBottom: `1px solid ${GRAPH_THEME.controls.border}`,
          })}
        >
          -
        </button>
        <button
          type="button"
          aria-label="Fit view"
          title="Fit view"
          onClick={() => dispatchCameraAction('fit_view')}
          style={graphControlButtonStyle({
            borderBottom: `1px solid ${GRAPH_THEME.controls.border}`,
          })}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path
              d="M2.25 5.25V2.25h3M8.75 2.25h3v3M11.75 8.75v3h-3M5.25 11.75h-3v-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.25"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          type="button"
          aria-label={interactionLocked ? 'Unlock interaction' : 'Lock interaction'}
          title={interactionLocked ? 'Unlock interaction' : 'Lock interaction'}
          onClick={() => setInteractionLocked((current) => !current)}
          style={graphControlButtonStyle({
            color: interactionLocked
              ? GRAPH_THEME.accent.primary
              : GRAPH_THEME.controls.text,
          })}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path
              d="M4.5 6V4.75a2.5 2.5 0 1 1 5 0V6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.25"
              strokeLinecap="round"
            />
            <rect
              x="3"
              y="6"
              width="8"
              height="6"
              rx="1.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.25"
            />
          </svg>
        </button>
      </div>

      {inspectorOpen ? (
        <EnergyInspector
          object={selectedObject}
          inputs={inputs}
          prepManifest={prepManifest}
          latestActionSummary={latestActionSummary}
          onParameterChange={applyParameter}
          onClose={() => setInspectorOpen(false)}
          onReset={() =>
            onWorkspaceAction({
              actionId: 'reset_energy_surface',
              targetObjectId: 'energy:surface',
              source: 'manual',
            })
          }
        />
      ) : null}
      <div data-testid="energy-selected-workspace-object" hidden>
        {JSON.stringify(selectedWorkspaceObject)}
      </div>
      <div
        data-testid="energy-pascal-integration-status"
        data-model-surface-engine="liquidaity-custom"
        data-geometry-source="nrgsim-solar-shoebox"
        data-pascal-status="adapter-only"
        data-energy-simulation-status="prep-only"
        hidden
      >
        {PASCAL_INTEGRATION_STATUS}
      </div>
    </div>
  );
}
