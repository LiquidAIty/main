export const JEPLUS_FACADE_TEMPLATE_ID = 'jEPlus/Facade' as const;
export const JEPLUS_FACADE_MODEL_TYPE = 'nrgsim-facade' as const;

export const JEPLUS_FACADE_SUPPORTED_M_VALUES = [27, 51, 91] as const;
export const JEPLUS_FACADE_SUPPORTED_Q_VALUES = [21, 23, 25, 27, 29] as const;

export const JEPLUS_FACADE_SUPPORTED_PCM_MATERIALS = [
  'WallAirGap',
  'M27Q21',
  'M51Q21',
  'M91Q21',
  'M27Q23',
  'M51Q23',
  'M91Q23',
  'M27Q25',
  'M51Q25',
  'M91Q25',
  'M27Q27',
  'M51Q27',
  'M91Q27',
  'M27Q29',
  'M51Q29',
  'M91Q29',
] as const;

export const JEPLUS_FACADE_SUPPORTED_WALL_TYPES = [
  'SteelFramed',
  'Mass',
  'Metal-Building',
  'Wood-Framed-and-Other',
] as const;

export const JEPLUS_FACADE_SUPPORTED_WINDOW_TYPES = [
  'GenericWindow',
  'SinglePane',
  'DoublePane',
  'DoublePaneTinted',
  'DoublePaneLowE',
  'TripplePane',
  'TripplePaneTinted',
  'TripplePaneLowE',
] as const;

export const JEPLUS_FACADE_SUPPORTED_OCCUPANCY_TYPES = [
  'Auditorium',
  'Classroom',
  'Clinic',
  'Commercial',
  'ConventionCenter',
  'Financial',
  'Grocery',
  'Industrial',
  'Library',
  'Office',
  'Residential',
  'Restaurant',
  'UnknownOccupancy',
  'Worship',
] as const;

export const JEPLUS_FACADE_JOBLIST_COLUMNS = [
  'job_id',
  'weather_file_index',
  'model_file_index',
  'height',
  'depth',
  'width',
  'window_glazing_ratio',
  'overhang',
  'left_fin',
  'right_fin',
  'orientation',
  'wall_type',
  'window_type',
  'infiltration_rate',
  'insulation_level',
  'pcm_material',
  'occupancy_type',
  'cooling_setpoint',
  'heating_setpoint',
  'site',
] as const;

export const JEPLUS_FACADE_TEMPLATE_METADATA = {
  modelType: JEPLUS_FACADE_MODEL_TYPE,
  template: JEPLUS_FACADE_TEMPLATE_ID,
  sourceReferences: [
    'nrgsim/audits/nrgsimapp-full-extraction-audit.md',
    'nrgsim/audits/nrgsimapp-extraction-summary.json',
    'nrgsim/jEPlus-master/Facade/project.jep',
    'nrgsim/jEPlus-master/Facade/include/Window.idf',
    'nrgsim/jEPlus-master/Facade/include/MaterialsConstructions.idf',
  ],
  supportedMValues: JEPLUS_FACADE_SUPPORTED_M_VALUES,
  supportedQValues: JEPLUS_FACADE_SUPPORTED_Q_VALUES,
  supportedPcmMaterials: JEPLUS_FACADE_SUPPORTED_PCM_MATERIALS,
  supportedWallTypes: JEPLUS_FACADE_SUPPORTED_WALL_TYPES,
  supportedWindowTypes: JEPLUS_FACADE_SUPPORTED_WINDOW_TYPES,
  supportedOccupancyTypes: JEPLUS_FACADE_SUPPORTED_OCCUPANCY_TYPES,
  joblistColumns: JEPLUS_FACADE_JOBLIST_COLUMNS,
  TODO: [
    'Roof construction values are visible in the newer UI snapshot but are not wired in the recovered Facade template.',
    'Weather catalog values exist in the old controller but should be rebuilt as a backend catalog before execution.',
  ],
} as const;

export type EnergySupportedPcmMaterial =
  (typeof JEPLUS_FACADE_SUPPORTED_PCM_MATERIALS)[number];
export type EnergySupportedWallType =
  (typeof JEPLUS_FACADE_SUPPORTED_WALL_TYPES)[number];
export type EnergySupportedWindowType =
  (typeof JEPLUS_FACADE_SUPPORTED_WINDOW_TYPES)[number];
export type EnergySupportedOccupancyType =
  (typeof JEPLUS_FACADE_SUPPORTED_OCCUPANCY_TYPES)[number];
export type EnergyJPlusJoblistColumn =
  (typeof JEPLUS_FACADE_JOBLIST_COLUMNS)[number];

