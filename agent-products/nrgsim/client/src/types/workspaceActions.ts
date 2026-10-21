export type WorkspaceObject = {
  id: string;
  surface: 'energy';
  type: string;
  label: string;
  parameters?: Record<string, unknown>;
};

export type WorkspaceAction = {
  id: 'select_object' | 'update_object_parameter' | 'reset_energy_surface';
  label: string;
  surface: 'energy';
};

export type WorkspaceActionCall = {
  actionId: WorkspaceAction['id'];
  targetObjectId: string;
  parameters?: Record<string, unknown>;
  source?: 'manual' | 'chat' | 'system';
};

export type WorkspaceActionResult = {
  ok: boolean;
  actionId: WorkspaceAction['id'];
  targetObjectId: string;
  summary: string;
  planEventSummary?: string;
  error?: string;
};

export type EnergySurfaceParameters = {
  width: number;
  height: number;
  depth: number;
  glazing: number;
  overhang: number;
  leftFin: number;
  rightFin: number;
  day: number;
  hour: number;
  orientation: number;
};

export type EnergyObjectId =
  | 'energy:surface'
  | 'energy:facade'
  | 'energy:window'
  | 'energy:overhang'
  | 'energy:leftFin'
  | 'energy:rightFin'
  | 'energy:sun'
  | 'energy:results';

export type EnergyParameterKey = keyof EnergySurfaceParameters;

export const ENERGY_DEFAULT_PARAMETERS: EnergySurfaceParameters = {
  width: 4.57,
  height: 2.45,
  depth: 4.57,
  glazing: 40,
  overhang: 0.5,
  leftFin: 0.2,
  rightFin: 0.2,
  day: 150,
  hour: 12,
  orientation: 180,
};
