// Entity: Building Workspace
// Relationship: These read-only transport types describe SDK projections and application references, never an editable engineering model.
export type MaterialInput = Readonly<{
  value: number | string | null; unit?: string; minimum?: number; minimumInclusive?: boolean;
  maximum?: number | null; choices?: readonly string[]; isDefaulted?: boolean;
}>;
export type ConstructionEditor = Readonly<{
  surface: Readonly<{ handle: string; name: string }>;
  construction: Readonly<{ handle: string; name: string }>;
  editable: boolean; isConstructionDefaulted: boolean; layerOrder: 'outside-to-inside';
  layers: readonly Readonly<{
    index: number; handle: string; name: string; type: string; editable: boolean;
    properties: Readonly<Record<string, MaterialInput>>;
  }>[];
}>;

export type ModelObject = Readonly<{
  handle: string;
  name: string;
  type: string;
  category?: string;
  layers?: readonly string[];
  buildingStory?: string | null;
  thermalZone?: string | null;
  space?: string | null;
  surface?: string | null;
  construction?: string | null;
  constructionDefaults?: Readonly<Record<string, string>>;
  constructionEditor?: ConstructionEditor | null;
  isConstructionDefaulted?: boolean;
  isOpaque?: boolean;
  isFenestration?: boolean;
  floorArea?: number;
  grossArea?: number;
  netArea?: number;
  surfaceType?: string;
  outsideBoundaryCondition?: string;
  adjacentSurface?: string | null;
  northAxis?: number;
  elevation?: number | null;
  height?: number | null;
  floors?: readonly (readonly (readonly [number, number, number])[])[];
  vertices?: readonly (readonly [number, number, number])[];
  windowToWallRatio?: number;
  thickness?: number;
  conductivity?: number;
  density?: number | null;
  specificHeat?: number;
  roughness?: string;
  definition?: string;
  schedule?: string | null;
  spaceType?: string | null;
  activityLevel?: number | null;
  airLoop?: string | null;
  thermostat?: string | null;
  hasEquipment?: boolean;
  heating?: number | null;
  cooling?: number | null;
  multiplier?: number;
}>;

export type DrawMode = 'select' | 'rectangle' | 'polygon';
export type Point = readonly [number, number];
export type DrawingSettings = {
  mode: DrawMode;
  name: string;
  story: string;
  height: number;
  thermalZone: string;
  snap: number;
};
export type AuthoringOperation = {
  operation: string;
  handle?: string;
  type?: string;
  [key: string]: unknown;
};

export type WorkspaceState = Readonly<{
  projectId: string;
  activeModel: string | null;
  revision: number;
  selection: string | null;
  models: Array<{ id: string; label: string; savedAt?: string; sha256?: string }>;
  projection: null | {
    osmSha256: string;
    sdkVersion: string;
    building: string;
    objects: Record<string, ModelObject>;
    selectableHandles: string[];
    warnings: string[];
    summary?: { spaces: number; thermalZones: number; floorAreaM2: number };
  };
}>;

export const objectLabel: Readonly<Record<string, string>> = {
  BuildingStory: 'Building Story', ThermalZone: 'Thermal Zone', SubSurface: 'SubSurface',
  SpaceType: 'Space Type', AirLoopHVAC: 'Air Loop', PlantLoop: 'Plant Loop',
  LightsDefinition: 'Lights Definition', Material: 'Material',
};

export type ObjectProperties = {
  ok: boolean;
  type: string;
  name: string;
  handle: string;
  properties: Record<string, { value: unknown; type: string }>;
  setters: string[];
};

export async function modelingRequest<T>(
  projectId: string, action: string, body?: unknown,
): Promise<T> {
  const response = await fetch(`/api/nrgsim/${encodeURIComponent(projectId)}/${action}`, {
    credentials: 'include',
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.error || `HTTP ${response.status}`);
  return data as T;
}
