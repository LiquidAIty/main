import React from 'react';
import { Canvas } from '@react-three/fiber';
import { Line, OrbitControls } from '@react-three/drei';
import type { SceneGraphSource } from './sceneGraphSource';
import {
  compileAssetTemplateToThreePrimitive,
  KoolSkoolsSceneAssetRegistry,
  resolveSceneAssetsForSceneGraph,
  type AssetResolutionResult,
  type AssetTemplate,
} from './sceneAssetRegistry';

type SceneGraphThreeBlockoutProps = { scene: SceneGraphSource };
type SceneBlockoutResolution = {
  assets: AssetResolutionResult[];
  warning: string | null;
};

const FALLBACK_BLOCKOUT_ASSETS: AssetResolutionResult[] = [
  {
    sceneAssetId: 'fallback_floor',
    sceneAssetName: 'Fallback floor',
    templateId: 'template_floor_plane',
    category: 'room',
    source: 'systemBuiltin',
    geometryKind: 'primitiveBox',
    renderRole: 'threejsPreview',
    simulationRole: 'energyContext',
    materialPreset: 'slateMatte',
    dimensionHint: { width: 6, height: 0.06, depth: 4.2, unit: 'm' },
    defaultPosition: [0, -0.03, 0],
    colorHex: '#1E293B',
    opacity: 1,
    fallbackStatus: 'fallbackDefault',
    warnings: ['scene_blockout_asset_resolution_fallback'],
  },
  {
    sceneAssetId: 'fallback_product',
    sceneAssetName: 'Fallback cooler',
    templateId: 'template_cooler_purifier_blockout',
    category: 'product',
    source: 'systemBuiltin',
    geometryKind: 'primitiveBox',
    renderRole: 'threejsPreview',
    simulationRole: 'airflowSource',
    materialPreset: 'coolBlue',
    dimensionHint: { width: 0.34, height: 0.62, depth: 0.26, unit: 'm' },
    defaultPosition: [0.9, 0.66, 0.1],
    colorHex: '#60A5FA',
    opacity: 0.95,
    fallbackStatus: 'fallbackDefault',
    warnings: ['scene_blockout_asset_resolution_fallback'],
  },
];

function sanitizeResolvedAssets(
  assets: AssetResolutionResult[],
): AssetResolutionResult[] {
  return assets.filter((asset) =>
    Boolean(asset && asset.sceneAssetId && asset.geometryKind),
  );
}

function resolveSafeBlockoutAssets(scene: SceneGraphSource): SceneBlockoutResolution {
  try {
    const resolved = resolveSceneAssetsForSceneGraph(
      scene,
      KoolSkoolsSceneAssetRegistry,
      'warnAndPrimitive',
    );
    const safeAssets = sanitizeResolvedAssets(resolved);
    if (safeAssets.length > 0) {
      return { assets: safeAssets, warning: null };
    }
    return {
      assets: FALLBACK_BLOCKOUT_ASSETS,
      warning: 'Asset resolver returned no renderable assets. Showing safe fallback blockout.',
    };
  } catch (error) {
    return {
      assets: FALLBACK_BLOCKOUT_ASSETS,
      warning:
        error instanceof Error
          ? `Asset resolver failed: ${error.message}`
          : 'Asset resolver failed. Showing safe fallback blockout.',
    };
  }
}

function resolveTemplate(result: AssetResolutionResult): AssetTemplate {
  return {
    id: result.templateId,
    name: result.sceneAssetName,
    category: result.category,
    source: result.source,
    geometryKind: result.geometryKind,
    materialPreset: result.materialPreset,
    renderRole: result.renderRole,
    simulationRole: result.simulationRole,
    dimensionHint: result.dimensionHint,
    usageHint: result.usageHint,
    defaultPosition: result.defaultPosition,
    curvePoints: result.curvePoints,
    colorHex: result.colorHex,
    opacity: result.opacity,
  };
}

function renderResolvedAsset(asset: AssetResolutionResult): React.ReactElement | null {
  const plan = compileAssetTemplateToThreePrimitive(resolveTemplate(asset));
  const commonMaterial = {
    color: plan.colorHex,
    transparent: plan.opacity < 1,
    opacity: plan.opacity,
  };

  if (plan.geometryKind === 'curvePath') {
    if (!plan.curvePoints.length) return null;
    return (
      <Line
        key={asset.sceneAssetId}
        points={plan.curvePoints}
        color={plan.colorHex}
        lineWidth={2}
        transparent
        opacity={plan.opacity}
      />
    );
  }

  if (plan.geometryKind === 'primitiveSphere') {
    const radius = Math.max(0.04, plan.size[0] / 2);
    return (
      <mesh key={asset.sceneAssetId} position={plan.position} rotation={plan.rotation}>
        <sphereGeometry args={[radius, 28, 28]} />
        <meshStandardMaterial {...commonMaterial} roughness={0.72} />
      </mesh>
    );
  }

  if (plan.geometryKind === 'primitiveCylinder') {
    const radius = Math.max(0.04, plan.size[0] / 2);
    return (
      <mesh key={asset.sceneAssetId} position={plan.position} rotation={plan.rotation}>
        <cylinderGeometry args={[radius, radius, Math.max(0.08, plan.size[1]), 20]} />
        <meshStandardMaterial {...commonMaterial} roughness={0.68} metalness={0.08} />
      </mesh>
    );
  }

  if (plan.geometryKind === 'primitiveCapsule') {
    const radius = Math.max(0.05, plan.size[0] / 2);
    return (
      <mesh key={asset.sceneAssetId} position={plan.position} rotation={plan.rotation}>
        <cylinderGeometry args={[radius, radius, Math.max(0.2, plan.size[1]), 16]} />
        <meshStandardMaterial {...commonMaterial} roughness={0.74} metalness={0.08} />
      </mesh>
    );
  }

  return (
    <mesh key={asset.sceneAssetId} position={plan.position} rotation={plan.rotation}>
      <boxGeometry args={plan.size} />
      <meshStandardMaterial {...commonMaterial} roughness={0.78} metalness={0.1} />
    </mesh>
  );
}

function SceneBlockoutMeshes({
  assets,
}: {
  assets: AssetResolutionResult[];
}): React.ReactElement {
  return (
    <>
      <color attach="background" args={['#0A111B']} />
      <ambientLight intensity={0.45} />
      <directionalLight position={[4, 6, 3]} intensity={1.2} />
      <directionalLight position={[-3, 4, -4]} intensity={0.5} color="#94A3B8" />

      {assets.map((asset) => renderResolvedAsset(asset))}

      <OrbitControls
        enablePan
        enableZoom
        minDistance={3.2}
        maxDistance={8}
        maxPolarAngle={Math.PI * 0.48}
        target={[0.1, 0.58, -0.05]}
      />
    </>
  );
}

export default function SceneGraphThreeBlockout({
  scene,
}: SceneGraphThreeBlockoutProps): React.ReactElement {
  const resolution = React.useMemo(() => resolveSafeBlockoutAssets(scene), [scene]);

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {resolution.warning ? (
        <div
          style={{
            border: '1px solid rgba(217,132,88,0.55)',
            borderRadius: 8,
            padding: '6px 8px',
            fontSize: 11,
            color: '#D98458',
          }}
        >
          {resolution.warning}
        </div>
      ) : null}
      <div style={{ width: '100%', height: 280, borderRadius: 10, overflow: 'hidden' }}>
        <Canvas camera={{ position: [3.1, 2.1, 3.2], fov: 50 }}>
          <SceneBlockoutMeshes assets={resolution.assets} />
        </Canvas>
      </div>
    </div>
  );
}
