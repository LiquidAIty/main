import type { EnergySurfaceParameters } from '../../types/workspaceActions';
import { calculateSolarPosition } from './solarPosition';
import type {
  EnergyFacadeModel,
  EnergyJPlusParameterSet,
  EnergyRunPrepManifest,
} from './energyModelSchema';
import { validateEnergyFacadeModel } from './energyModelValidation';
import {
  JEPLUS_FACADE_JOBLIST_COLUMNS,
  JEPLUS_FACADE_TEMPLATE_ID,
  JEPLUS_FACADE_TEMPLATE_METADATA,
} from './jeplusFacadeTemplate';

const DEFAULT_RUN_PARAMETERS = {
  jobId: 'prep-preview',
  wallType: 'SteelFramed',
  windowType: 'GenericWindow',
  infiltrationRate: 1,
  insulationLevel: 3,
  pcmMaterial: 'M51Q25',
  occupancyType: 'Office',
  coolingSetpoint: 25,
  heatingSetpoint: 21,
  site: 'City',
  weatherFile: '',
} as const;

const DEFAULT_MEASURED_SURFACE_PARAMETERS = {
  height: 2.45,
  depth: 4.57,
  width: 4.57,
  glazingRatio: 40,
  overhangRatio: 0.5,
  leftFinRatio: 0.2,
  rightFinRatio: 0.2,
  orientation: 180,
} as const;

const DEFAULT_SOLAR_ORIENTATION_DEG = 180;

function round(value: number, digits = 4): number {
  return Number(value.toFixed(digits));
}

function createOpeningAndShadeGeometry(inputs: EnergySurfaceParameters) {
  const glazingRatio = Math.min(Math.max(inputs.glazing, 0), 99);
  if (glazingRatio === 0) {
    return {
      windowWidth: 0,
      windowHeight: 0,
      sillHeight: 0,
      overhangDepth: 0,
      leftFinDepth: 0,
      rightFinDepth: 0,
    };
  }

  const windowArea =
    0.999 * (glazingRatio / 100) * inputs.height * inputs.width;
  const aspectRatio = inputs.height / inputs.width;
  const windowHeight = Math.sqrt(windowArea * aspectRatio);
  const windowWidth = windowArea / windowHeight;
  const sillHeight = (inputs.height - windowHeight) / 2;

  return {
    windowWidth: round(windowWidth),
    windowHeight: round(windowHeight),
    sillHeight: round(sillHeight),
    overhangDepth: round(inputs.overhang * windowHeight),
    leftFinDepth: round(inputs.leftFin * windowWidth),
    rightFinDepth: round(inputs.rightFin * windowWidth),
  };
}

export function createEnergyFacadeModel(
  inputs: EnergySurfaceParameters,
): EnergyFacadeModel {
  const geometry = createOpeningAndShadeGeometry(inputs);
  const solarPosition = calculateSolarPosition({
    dayOfYear: inputs.day,
    hour: inputs.hour,
    latitudeDeg: 45,
    // Later, orientation should come from Site/Building layout, not the Solar Position strip.
    orientationDeg: DEFAULT_SOLAR_ORIENTATION_DEG,
    radius: 10,
  });
  const jplusParameters: EnergyJPlusParameterSet = {
    jobId: DEFAULT_RUN_PARAMETERS.jobId,
    weatherFileIndex: 0,
    modelFileIndex: 0,
    height: round(inputs.height),
    depth: round(inputs.depth),
    width: round(inputs.width),
    glazingRatio: round(inputs.glazing),
    overhangRatio: round(inputs.overhang),
    leftFinRatio: round(inputs.leftFin),
    rightFinRatio: round(inputs.rightFin),
    orientation: round(inputs.orientation),
    wallType: DEFAULT_RUN_PARAMETERS.wallType,
    windowType: DEFAULT_RUN_PARAMETERS.windowType,
    infiltrationRate: DEFAULT_RUN_PARAMETERS.infiltrationRate,
    insulationLevel: DEFAULT_RUN_PARAMETERS.insulationLevel,
    pcmMaterial: DEFAULT_RUN_PARAMETERS.pcmMaterial,
    occupancyType: DEFAULT_RUN_PARAMETERS.occupancyType,
    coolingSetpoint: DEFAULT_RUN_PARAMETERS.coolingSetpoint,
    heatingSetpoint: DEFAULT_RUN_PARAMETERS.heatingSetpoint,
    site: DEFAULT_RUN_PARAMETERS.site,
  };

  return {
    id: 'energy-model:facade-preview',
    modelType: 'nrgsim-facade',
    primarySurfaceId: 'energy:facade',
    primaryOpeningId: 'energy:window',
    solar: {
      ...solarPosition,
      dayOfYear: inputs.day,
      hour: inputs.hour,
      latitudeDeg: 45,
      orientationDeg: DEFAULT_SOLAR_ORIENTATION_DEG,
    },
    room: {
      id: 'energy-room:shoebox-preview',
      name: 'NRGSIM Facade Shoebox',
      width: round(inputs.width),
      depth: round(inputs.depth),
      height: round(inputs.height),
      infiltrationRate: DEFAULT_RUN_PARAMETERS.infiltrationRate,
      occupancyType: DEFAULT_RUN_PARAMETERS.occupancyType,
      coolingSetpoint: DEFAULT_RUN_PARAMETERS.coolingSetpoint,
      heatingSetpoint: DEFAULT_RUN_PARAMETERS.heatingSetpoint,
      site: DEFAULT_RUN_PARAMETERS.site,
      weatherFile: DEFAULT_RUN_PARAMETERS.weatherFile,
      surfaces: [
        {
          id: 'energy:facade',
          name: 'ExtWall',
          orientationDeg: inputs.orientation,
          width: round(inputs.width),
          height: round(inputs.height),
          constructionType: DEFAULT_RUN_PARAMETERS.wallType,
          insulationLevel: DEFAULT_RUN_PARAMETERS.insulationLevel,
          outsideBoundary: 'Outdoors',
        },
      ],
      openings:
        inputs.glazing > 0
          ? [
              {
                id: 'energy:window',
                hostSurfaceId: 'energy:facade',
                name: 'ExtWin',
                glazingRatio: round(inputs.glazing),
                constructionType: DEFAULT_RUN_PARAMETERS.windowType,
                width: geometry.windowWidth,
                height: geometry.windowHeight,
                sillHeight: geometry.sillHeight,
              },
            ]
          : [],
      shades:
        inputs.glazing > 0
          ? [
              {
                id: 'energy:overhang',
                hostOpeningId: 'energy:window',
                name: 'Overhang',
                kind: 'overhang',
                ratio: round(inputs.overhang),
                depth: geometry.overhangDepth,
              },
              {
                id: 'energy:leftFin',
                hostOpeningId: 'energy:window',
                name: 'FinL',
                kind: 'left-fin',
                ratio: round(inputs.leftFin),
                depth: geometry.leftFinDepth,
              },
              {
                id: 'energy:rightFin',
                hostOpeningId: 'energy:window',
                name: 'FinR',
                kind: 'right-fin',
                ratio: round(inputs.rightFin),
                depth: geometry.rightFinDepth,
              },
            ]
          : [],
    },
    jplusParameters,
    sourceLineage: [
      ...JEPLUS_FACADE_TEMPLATE_METADATA.sourceReferences,
      'client/src/features/energy/solarPosition.ts',
      'client/src/components/energy/EnergyFacadeSurface.tsx',
      'client/src/types/workspaceActions.ts',
    ],
  };
}

export function createEnergyRunPrepManifest(
  model: EnergyFacadeModel,
): EnergyRunPrepManifest {
  const validation = validateEnergyFacadeModel(model);
  const parameters = model.jplusParameters;
  const measuredParameters: EnergyJPlusParameterSet = {
    ...parameters,
    ...DEFAULT_MEASURED_SURFACE_PARAMETERS,
  };
  const modifiedParameters: EnergyJPlusParameterSet = { ...parameters };
  const bioPcmRow: Array<string | number> = [
    'job1',
    parameters.weatherFileIndex,
    parameters.modelFileIndex,
    parameters.height,
    parameters.depth,
    parameters.width,
    parameters.glazingRatio,
    parameters.overhangRatio,
    parameters.leftFinRatio,
    parameters.rightFinRatio,
    parameters.orientation,
    parameters.wallType,
    parameters.windowType,
    parameters.infiltrationRate,
    parameters.insulationLevel,
    parameters.pcmMaterial,
    parameters.occupancyType,
    parameters.coolingSetpoint,
    parameters.heatingSetpoint,
    parameters.site,
  ];
  const baselineRow = [...bioPcmRow];
  baselineRow[0] = 'job0';
  baselineRow[15] = 'WallAirGap';

  return {
    modelType: 'nrgsim-facade',
    template: JEPLUS_FACADE_TEMPLATE_ID,
    backendReady: false,
    executionEnabled: false,
    reason: 'Simulation engine is not connected',
    parameters,
    measuredParameters,
    modifiedParameters,
    joblistColumns: JEPLUS_FACADE_JOBLIST_COLUMNS,
    joblistPreview: [bioPcmRow, baselineRow],
    validation,
    sourceLineage: model.sourceLineage,
    model,
  };
}

export function exportEnergyPrepPackage(
  model: EnergyFacadeModel,
): EnergyRunPrepManifest {
  return createEnergyRunPrepManifest(model);
}

export function createEnergyRunPrepManifestFromSurface(
  inputs: EnergySurfaceParameters,
): EnergyRunPrepManifest {
  return createEnergyRunPrepManifest(createEnergyFacadeModel(inputs));
}
