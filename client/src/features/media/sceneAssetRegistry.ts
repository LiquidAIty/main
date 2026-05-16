export type AssetSource =
  | 'generated'
  | 'imported'
  | 'submoduleReference'
  | 'userUpload'
  | 'systemBuiltin'
  | 'simulationOutput';

export type AssetRenderRole =
  | 'threejsPreview'
  | 'svgDiagram'
  | 'seedFrame'
  | 'videoDiffusion'
  | 'remotionExport'
  | 'arPreview';

export type AssetSimulationRole =
  | 'none'
  | 'energyContext'
  | 'cfdBoundary'
  | 'thermalMass'
  | 'airflowSource'
  | 'airflowSink'
  | 'occupant'
  | 'equipment'
  | 'manufacturingCandidate';

export type SceneAssetRef = {
  id: string;
  name: string;
  source: AssetSource;
  renderRole: AssetRenderRole;
  simulationRole: AssetSimulationRole;
  tags: string[];
};

export type SceneAssetRegistry = {
  id: string;
  name: string;
  assets: SceneAssetRef[];
};

export const KoolSkoolsSceneAssetRegistry: SceneAssetRegistry = {
  id: 'registry_kool_skools_default',
  name: 'Kool Skools Scene Assets',
  assets: [
    {
      id: 'asset_classroom_shell',
      name: 'Classroom shell',
      source: 'systemBuiltin',
      renderRole: 'threejsPreview',
      simulationRole: 'energyContext',
      tags: ['room', 'shell'],
    },
    {
      id: 'asset_desk',
      name: 'Desk',
      source: 'systemBuiltin',
      renderRole: 'threejsPreview',
      simulationRole: 'equipment',
      tags: ['furniture'],
    },
    {
      id: 'asset_chair',
      name: 'Chair',
      source: 'systemBuiltin',
      renderRole: 'threejsPreview',
      simulationRole: 'equipment',
      tags: ['furniture'],
    },
    {
      id: 'asset_student_placeholder',
      name: 'Student placeholder',
      source: 'systemBuiltin',
      renderRole: 'threejsPreview',
      simulationRole: 'occupant',
      tags: ['human', 'occupant'],
    },
    {
      id: 'asset_cooler_purifier',
      name: 'Cooler/purifier',
      source: 'systemBuiltin',
      renderRole: 'threejsPreview',
      simulationRole: 'airflowSource',
      tags: ['product', 'cooler'],
    },
    {
      id: 'asset_blue_airflow_arrow',
      name: 'Blue airflow arrow',
      source: 'systemBuiltin',
      renderRole: 'svgDiagram',
      simulationRole: 'airflowSource',
      tags: ['overlay', 'airflow', 'cool'],
    },
    {
      id: 'asset_orange_warm_arrow',
      name: 'Orange warm-air arrow',
      source: 'systemBuiltin',
      renderRole: 'svgDiagram',
      simulationRole: 'airflowSink',
      tags: ['overlay', 'airflow', 'warm'],
    },
    {
      id: 'asset_comfort_bubble',
      name: 'Transparent comfort bubble',
      source: 'systemBuiltin',
      renderRole: 'svgDiagram',
      simulationRole: 'none',
      tags: ['overlay', 'comfort'],
    },
    {
      id: 'asset_hepa_filter',
      name: 'HEPA filter',
      source: 'systemBuiltin',
      renderRole: 'seedFrame',
      simulationRole: 'equipment',
      tags: ['filter', 'hepa'],
    },
  ],
};
