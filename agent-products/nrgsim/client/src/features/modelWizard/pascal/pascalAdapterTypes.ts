import type {
  EnergyEditableParameter,
  EnergyMeasuredNumericValue,
  EnergyModelLevel,
  EnergyModelSource,
  EnergyWizardModelObject,
} from '../../energy/energyModelSchema';
import type { WorkspaceObject } from '../../../types/workspaceActions';

export type PascalVector2 = [number, number];
export type PascalVector3 = [number, number, number];

export type PascalNodeLike = {
  id: string;
  type: string;
  name?: string;
  parentId?: string | null;
  children?: string[];
  metadata?: unknown;
};

export type PascalBuildingLike = PascalNodeLike & {
  type: 'building';
  position?: PascalVector3;
  rotation?: PascalVector3;
};

export type PascalLevelLike = PascalNodeLike & {
  type: 'level';
  level?: number;
};

export type PascalSpaceLike = PascalNodeLike & {
  type: 'zone';
  polygon?: PascalVector2[];
};

export type PascalSurfaceLike = PascalNodeLike & {
  type: 'wall' | 'slab' | 'roof';
  start?: PascalVector2;
  end?: PascalVector2;
  polygon?: PascalVector2[];
  height?: number;
  thickness?: number;
  elevation?: number;
};

export type PascalOpeningLike = PascalNodeLike & {
  type: 'window' | 'door';
  wallId?: string;
  width?: number;
  height?: number;
  position?: PascalVector3;
};

export type PascalSceneLike = {
  nodes: Record<string, PascalNodeLike>;
  rootNodeIds?: string[];
};

export type MeasuredEditableDimensions = Record<
  string,
  EnergyMeasuredNumericValue
>;

export type ModelWizardModel = {
  id: string;
  name: string;
  objects: EnergyWizardModelObject[];
};

export type PascalMappedWorkspaceObject = WorkspaceObject & {
  modelLevel: EnergyModelLevel;
  source: EnergyModelSource;
};

export type PascalAdapterResult = {
  model: ModelWizardModel;
  workspaceObjects: PascalMappedWorkspaceObject[];
};

export type { EnergyEditableParameter };
