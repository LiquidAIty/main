// Entity: Building Workspace
// Relationship: These read-only transport types describe SDK projections and application references, never an editable engineering model.
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
  floorArea?: number;
  grossArea?: number;
  netArea?: number;
  surfaceType?: string;
  outsideBoundaryCondition?: string;
}>;

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
