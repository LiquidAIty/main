import type { EnergyModel } from './energyModelSchema';

export type PascalEnergyAdapterInput = unknown;

export type PascalEnergyModelMapper = (
  pascalModel: PascalEnergyAdapterInput,
) => EnergyModel;

export const PASCAL_ENERGY_MAPPING_NOTES = [
  'Pascal building/level maps to Building or Shell.',
  'Pascal room/space maps to Zone.',
  'Pascal wall/slab/roof maps to Surface.',
  'Pascal window/door maps to Opening.',
  'Pascal objects with dimensions map to editable measured model objects.',
  'Pascal geometry vertices will later map to EnergyPlus-compatible surfaces.',
] as const;

export const mapPascalBuildingToEnergyModel: PascalEnergyModelMapper = () => {
  throw new Error(
    'Pascal import is not implemented. This adapter is the future Energy Model bridge target.',
  );
};
