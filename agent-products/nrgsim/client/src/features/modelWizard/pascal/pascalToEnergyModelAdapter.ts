import type {
  EnergyEditableParameter,
  EnergyModelLevel,
  EnergyModelSource,
  EnergyOpeningObject,
  EnergySurfaceObject,
  EnergyWizardModelObject,
} from '../../energy/energyModelSchema';
import type { WorkspaceObject } from '../../../types/workspaceActions';
import type {
  MeasuredEditableDimensions,
  ModelWizardModel,
  PascalNodeLike,
  PascalOpeningLike,
  PascalSceneLike,
  PascalSurfaceLike,
} from './pascalAdapterTypes';

const PASCAL_LEVEL_MAP: Record<string, EnergyModelLevel> = {
  site: 'site',
  building: 'building',
  level: 'shell',
  zone: 'zone',
  wall: 'surface',
  slab: 'surface',
  roof: 'surface',
  window: 'opening',
  door: 'opening',
};

function pascalTypeToModelLevel(type: string): EnergyModelLevel {
  return PASCAL_LEVEL_MAP[type] || 'block';
}

function pascalKind(type: string): string {
  if (type === 'level') return 'shell';
  if (type === 'wall') return 'surface: wall';
  if (type === 'slab') return 'surface: floor';
  if (type === 'roof') return 'surface: roof';
  if (type === 'window' || type === 'door') return `opening: ${type}`;
  return type;
}

function measuredParameter(
  key: string,
  label: string,
  value: number,
  unit: string,
  min: number,
  max: number,
  step: number,
): EnergyEditableParameter {
  return {
    key,
    label,
    value,
    measuredValue: value,
    unit,
    source: 'imported_from_pascal',
    min,
    max,
    step,
  };
}

export function mapPascalDimensionsToMeasuredEditableValues(
  pascalObject: PascalNodeLike,
): MeasuredEditableDimensions {
  const dimensions: MeasuredEditableDimensions = {};
  const candidate = pascalObject as PascalSurfaceLike | PascalOpeningLike;

  if ('width' in candidate && typeof candidate.width === 'number') {
    dimensions.width = {
      value: candidate.width,
      measuredValue: candidate.width,
      unit: 'm',
      source: 'imported_from_pascal',
    };
  }
  if ('height' in candidate && typeof candidate.height === 'number') {
    dimensions.height = {
      value: candidate.height,
      measuredValue: candidate.height,
      unit: 'm',
      source: 'imported_from_pascal',
    };
  }
  if ('thickness' in candidate && typeof candidate.thickness === 'number') {
    dimensions.thickness = {
      value: candidate.thickness,
      measuredValue: candidate.thickness,
      unit: 'm',
      source: 'imported_from_pascal',
    };
  }
  if ('start' in candidate && 'end' in candidate && candidate.start && candidate.end) {
    const length = Math.hypot(
      candidate.end[0] - candidate.start[0],
      candidate.end[1] - candidate.start[1],
    );
    dimensions.length = {
      value: Number(length.toFixed(4)),
      measuredValue: Number(length.toFixed(4)),
      unit: 'm',
      source: 'imported_from_pascal',
    };
  }

  return dimensions;
}

export function mapPascalObjectToWorkspaceObject(
  pascalObject: PascalNodeLike,
): WorkspaceObject {
  return {
    id: `pascal:${pascalObject.id}`,
    surface: 'energy',
    type: pascalKind(pascalObject.type),
    label: pascalObject.name || pascalKind(pascalObject.type),
    parameters: mapPascalDimensionsToMeasuredEditableValues(pascalObject),
  };
}

export function mapPascalSceneToModelWizard(
  pascalScene: PascalSceneLike,
): ModelWizardModel {
  const objects: EnergyWizardModelObject[] = Object.values(pascalScene.nodes).map(
    (node) => {
      const dimensions = mapPascalDimensionsToMeasuredEditableValues(node);
      return {
        id: `pascal:${node.id}`,
        parentId: node.parentId ? `pascal:${node.parentId}` : null,
        level: pascalTypeToModelLevel(node.type),
        kind: pascalKind(node.type),
        name: node.name || pascalKind(node.type),
        dimensions,
        measuredValues: dimensions,
        editableParameters: Object.entries(dimensions).map(([key, field]) =>
          measuredParameter(
            key,
            key.replace(/([A-Z])/g, ' $1'),
            field.value,
            field.unit,
            0,
            Math.max(field.value * 4, 1),
            0.01,
          ),
        ),
        relationships: (node.children || []).map((id) => `pascal:${id}`),
        source: 'imported_from_pascal' as EnergyModelSource,
      };
    },
  );

  return {
    id: 'model-wizard:pascal-import-preview',
    name: 'Pascal import preview',
    objects,
  };
}

export function mapPascalSurfacesToEnergySurfaces(
  pascalScene: PascalSceneLike,
): EnergySurfaceObject[] {
  return Object.values(pascalScene.nodes)
    .filter((node): node is PascalSurfaceLike =>
      node.type === 'wall' || node.type === 'slab' || node.type === 'roof',
    )
    .map((surface) => {
      const dimensions = mapPascalDimensionsToMeasuredEditableValues(surface);
      return {
        id: `pascal:${surface.id}`,
        name: surface.name || pascalKind(surface.type),
        orientationDeg: 0,
        width: dimensions.length?.value || 0,
        height: dimensions.height?.value || 0,
        constructionType: surface.type,
        insulationLevel: 0,
        outsideBoundary: surface.type === 'wall' ? 'Outdoors' : 'Adiabatic',
      };
    });
}

export function mapPascalOpeningsToEnergyOpenings(
  pascalScene: PascalSceneLike,
): EnergyOpeningObject[] {
  return Object.values(pascalScene.nodes)
    .filter((node): node is PascalOpeningLike =>
      node.type === 'window' || node.type === 'door',
    )
    .map((opening) => ({
      id: `pascal:${opening.id}`,
      hostSurfaceId: opening.wallId ? `pascal:${opening.wallId}` : '',
      name: opening.name || pascalKind(opening.type),
      glazingRatio: opening.type === 'window' ? 100 : 0,
      constructionType: opening.type,
      width: opening.width || 0,
      height: opening.height || 0,
      sillHeight: opening.position?.[1] || 0,
    }));
}
