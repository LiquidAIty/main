import type { SolarPosition } from './solarPosition';
import type {
  EnergyJPlusJoblistColumn,
  EnergySupportedOccupancyType,
  EnergySupportedPcmMaterial,
  EnergySupportedWallType,
  EnergySupportedWindowType,
} from './jeplusFacadeTemplate';

export type EnergyModelType = 'nrgsim-facade';

export type EnergyModelLevel =
  | 'project'
  | 'site'
  | 'building'
  | 'shell'
  | 'block'
  | 'zone'
  | 'surface'
  | 'opening'
  | 'shade'
  | 'internal_load'
  | 'hvac'
  | 'simulation'
  | 'output';

export type EnergyModelSource =
  | 'manual'
  | 'wizard_default'
  | 'measured'
  | 'imported_from_pascal'
  | 'imported_from_nrgsim'
  | 'ai_generated';

export type EnergyMeasuredNumericValue = {
  value: number;
  measuredValue: number;
  unit: string;
  source: EnergyModelSource;
};

export type EnergyEditableParameter = EnergyMeasuredNumericValue & {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
};

export type EnergyWizardModelObject = {
  id: string;
  parentId: string | null;
  level: EnergyModelLevel;
  kind: string;
  name: string;
  dimensions?: Record<string, EnergyMeasuredNumericValue>;
  vertices?: Array<[number, number, number]>;
  measuredValues?: Record<string, EnergyMeasuredNumericValue>;
  editableParameters: EnergyEditableParameter[];
  relationships: string[];
  source: EnergyModelSource;
};

export type EnergyModel = {
  id: string;
  name: string;
  modelType: EnergyModelType;
  objects: EnergyWizardModelObject[];
  currentParameters: EnergyJPlusParameterSet;
  measuredParameters: EnergyJPlusParameterSet;
  modifiedParameters: EnergyJPlusParameterSet;
  sourceLineage: string[];
};

export type EnergyValidationIssue = {
  field: string;
  message: string;
  source?: string;
};

export type EnergyValidationAutoFix = {
  field: string;
  from: unknown;
  to: unknown;
  reason: string;
};

export type EnergyValidationResult = {
  ok: boolean;
  errors: EnergyValidationIssue[];
  warnings: EnergyValidationIssue[];
  autoFixes: EnergyValidationAutoFix[];
};

export type EnergySurfaceObject = {
  id: string;
  name: string;
  orientationDeg: number;
  width: number;
  height: number;
  constructionType: EnergySupportedWallType | string;
  insulationLevel: number;
  outsideBoundary: 'Outdoors' | 'Adiabatic';
};

export type EnergyOpeningObject = {
  id: string;
  hostSurfaceId: string;
  name: string;
  glazingRatio: number;
  constructionType: EnergySupportedWindowType | string;
  width: number;
  height: number;
  sillHeight: number;
};

export type EnergyShadeObject = {
  id: string;
  hostOpeningId: string;
  name: string;
  kind: 'overhang' | 'left-fin' | 'right-fin';
  ratio: number;
  depth: number;
};

export type EnergySolarState = SolarPosition & {
  dayOfYear: number;
  hour: number;
  latitudeDeg: number;
  orientationDeg: number;
};

export type EnergyJPlusParameterSet = {
  jobId: string;
  weatherFileIndex: number;
  modelFileIndex: number;
  height: number;
  depth: number;
  width: number;
  glazingRatio: number;
  overhangRatio: number;
  leftFinRatio: number;
  rightFinRatio: number;
  orientation: number;
  wallType: EnergySupportedWallType | string;
  windowType: EnergySupportedWindowType | string;
  infiltrationRate: number;
  insulationLevel: number;
  pcmMaterial: EnergySupportedPcmMaterial | string;
  occupancyType: EnergySupportedOccupancyType | string;
  coolingSetpoint: number;
  heatingSetpoint: number;
  site: string;
};

export type EnergyRoomModel = {
  id: string;
  name: string;
  width: number;
  depth: number;
  height: number;
  infiltrationRate: number;
  occupancyType: EnergySupportedOccupancyType | string;
  coolingSetpoint: number;
  heatingSetpoint: number;
  site: string;
  weatherFile: string;
  surfaces: EnergySurfaceObject[];
  openings: EnergyOpeningObject[];
  shades: EnergyShadeObject[];
};

export type EnergyFacadeModel = {
  id: string;
  modelType: EnergyModelType;
  room: EnergyRoomModel;
  primarySurfaceId: string;
  primaryOpeningId: string;
  solar: EnergySolarState;
  jplusParameters: EnergyJPlusParameterSet;
  sourceLineage: string[];
};

export type EnergyRunPrepManifest = {
  modelType: EnergyModelType;
  template: 'jEPlus/Facade';
  backendReady: false;
  executionEnabled: false;
  reason: string;
  parameters: EnergyJPlusParameterSet;
  measuredParameters: EnergyJPlusParameterSet;
  modifiedParameters: EnergyJPlusParameterSet;
  joblistColumns: readonly EnergyJPlusJoblistColumn[];
  joblistPreview: Array<Array<string | number>>;
  validation: EnergyValidationResult;
  sourceLineage: string[];
  model: EnergyFacadeModel;
};
