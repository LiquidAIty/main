import type {
  EnergyFacadeModel,
  EnergyJPlusParameterSet,
  EnergyValidationAutoFix,
  EnergyValidationIssue,
  EnergyValidationResult,
} from './energyModelSchema';
import {
  JEPLUS_FACADE_SUPPORTED_OCCUPANCY_TYPES,
  JEPLUS_FACADE_SUPPORTED_PCM_MATERIALS,
  JEPLUS_FACADE_SUPPORTED_WALL_TYPES,
  JEPLUS_FACADE_SUPPORTED_WINDOW_TYPES,
} from './jeplusFacadeTemplate';

const TEMPLATE_SAFE_MAX_GLAZING = 99;

function includesString(values: readonly string[], value: string): boolean {
  return values.includes(value);
}

function addRequiredFieldError(
  errors: EnergyValidationIssue[],
  field: keyof EnergyJPlusParameterSet,
  value: unknown,
) {
  if (value === null || value === undefined || value === '') {
    errors.push({ field, message: `${field} is required for run prep.` });
  }
}

export function validateEnergyJPlusParameterSet(
  parameters: EnergyJPlusParameterSet,
): EnergyValidationResult {
  const errors: EnergyValidationIssue[] = [];
  const warnings: EnergyValidationIssue[] = [];
  const autoFixes: EnergyValidationAutoFix[] = [];

  (
    [
      'jobId',
      'width',
      'depth',
      'height',
      'glazingRatio',
      'overhangRatio',
      'leftFinRatio',
      'rightFinRatio',
      'orientation',
      'wallType',
      'windowType',
      'infiltrationRate',
      'insulationLevel',
      'pcmMaterial',
      'occupancyType',
      'coolingSetpoint',
      'heatingSetpoint',
      'site',
    ] as Array<keyof EnergyJPlusParameterSet>
  ).forEach((field) => addRequiredFieldError(errors, field, parameters[field]));

  if (parameters.width <= 0) {
    errors.push({ field: 'width', message: 'Width must be positive.' });
  }
  if (parameters.depth <= 0) {
    errors.push({ field: 'depth', message: 'Depth must be positive.' });
  }
  if (parameters.height <= 0) {
    errors.push({ field: 'height', message: 'Height must be positive.' });
  }
  if (parameters.glazingRatio < 0) {
    errors.push({ field: 'glazingRatio', message: 'Glazing ratio cannot be negative.' });
  }
  if (parameters.glazingRatio > TEMPLATE_SAFE_MAX_GLAZING) {
    errors.push({
      field: 'glazingRatio',
      message: `Glazing ratio must be ${TEMPLATE_SAFE_MAX_GLAZING}% or less for the recovered Facade template.`,
      source: 'nrgsim/jEPlus-master/Facade/include/Window.idf',
    });
    autoFixes.push({
      field: 'glazingRatio',
      from: parameters.glazingRatio,
      to: TEMPLATE_SAFE_MAX_GLAZING,
      reason: 'Recovered Window.idf uses a 0.999 area multiplier, but UI prep should still cap WWR below 100%.',
    });
  }
  if (parameters.orientation < 0 || parameters.orientation > 360) {
    errors.push({ field: 'orientation', message: 'Orientation must be between 0 and 360 degrees.' });
  }
  if (parameters.overhangRatio < 0) {
    errors.push({ field: 'overhangRatio', message: 'Overhang ratio cannot be negative.' });
  }
  if (parameters.leftFinRatio < 0) {
    errors.push({ field: 'leftFinRatio', message: 'Left fin ratio cannot be negative.' });
  }
  if (parameters.rightFinRatio < 0) {
    errors.push({ field: 'rightFinRatio', message: 'Right fin ratio cannot be negative.' });
  }
  if (parameters.overhangRatio > 0.9) {
    warnings.push({
      field: 'overhangRatio',
      message: 'Overhang ratio is above the recovered UI range of 0.9.',
      source: 'nrgsim/nrgsimapp-master/public/app/js/views/sim_page.js',
    });
  }
  if (parameters.leftFinRatio > 0.4) {
    warnings.push({
      field: 'leftFinRatio',
      message: 'Left fin ratio is above the recovered UI range of 0.4.',
      source: 'nrgsim/nrgsimapp-master/public/app/js/views/sim_page.js',
    });
  }
  if (parameters.rightFinRatio > 0.4) {
    warnings.push({
      field: 'rightFinRatio',
      message: 'Right fin ratio is above the recovered UI range of 0.4.',
      source: 'nrgsim/nrgsimapp-master/public/app/js/views/sim_page.js',
    });
  }
  if (!includesString(JEPLUS_FACADE_SUPPORTED_PCM_MATERIALS, parameters.pcmMaterial)) {
    errors.push({
      field: 'pcmMaterial',
      message: `${parameters.pcmMaterial} is not defined in the recovered Facade PCM material set.`,
      source: 'nrgsim/jEPlus-master/Facade/include/MaterialsConstructions.idf',
    });
  }
  if (!includesString(JEPLUS_FACADE_SUPPORTED_WALL_TYPES, parameters.wallType)) {
    errors.push({
      field: 'wallType',
      message: `${parameters.wallType} is not defined as a supported Facade wall construction.`,
      source: 'nrgsim/jEPlus-master/Facade/include/MaterialsConstructions.idf',
    });
  }
  if (!includesString(JEPLUS_FACADE_SUPPORTED_WINDOW_TYPES, parameters.windowType)) {
    errors.push({
      field: 'windowType',
      message: `${parameters.windowType} is not defined as a supported Facade window construction.`,
      source: 'nrgsim/jEPlus-master/Facade/include/MaterialsConstructions.idf',
    });
  }
  if (!includesString(JEPLUS_FACADE_SUPPORTED_OCCUPANCY_TYPES, parameters.occupancyType)) {
    errors.push({
      field: 'occupancyType',
      message: `${parameters.occupancyType} is not available as a recovered occupancy include file.`,
      source: 'nrgsim/jEPlus-master/Facade/include',
    });
  }
  if (parameters.infiltrationRate < 0) {
    errors.push({ field: 'infiltrationRate', message: 'Infiltration rate cannot be negative.' });
  }
  if (parameters.insulationLevel <= 0) {
    errors.push({ field: 'insulationLevel', message: 'Insulation level must be positive.' });
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    autoFixes,
  };
}

export function validateEnergyFacadeModel(model: EnergyFacadeModel): EnergyValidationResult {
  const validation = validateEnergyJPlusParameterSet(model.jplusParameters);
  const errors = [...validation.errors];
  const warnings = [...validation.warnings];

  if (model.room.surfaces.length === 0) {
    errors.push({ field: 'room.surfaces', message: 'At least one surface is required.' });
  }
  if (model.room.openings.length === 0 && model.jplusParameters.glazingRatio > 0) {
    errors.push({
      field: 'room.openings',
      message: 'A glazing ratio above zero requires an opening object.',
    });
  }
  if (!model.room.weatherFile) {
    warnings.push({
      field: 'room.weatherFile',
      message: 'Weather file is a placeholder until backend weather catalog wiring exists.',
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    autoFixes: validation.autoFixes,
  };
}

