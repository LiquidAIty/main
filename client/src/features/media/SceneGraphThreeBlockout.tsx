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
    const length = Math.max(0.08, plan.size[1] - radius * 2);
    return (
      <mesh key={asset.sceneAssetId} position={plan.position} rotation={plan.rotation}>
        <capsuleGeometry args={[radius, length, 8, 18]} />
        <meshStandardMaterial {...commonMaterial} roughness={0.74} />
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

function SceneBlockoutMeshes({ scene }: { scene: SceneGraphSource }): React.ReactElement {
  const resolvedAssets = resolveSceneAssetsForSceneGraph(
    scene,
    KoolSkoolsSceneAssetRegistry,
    'warnAndPrimitive',
  );

  return (
    <>
      <color attach="background" args={['#0A111B']} />
      <ambientLight intensity={0.45} />
      <directionalLight position={[4, 6, 3]} intensity={1.2} />
      <directionalLight position={[-3, 4, -4]} intensity={0.5} color="#94A3B8" />

      <mesh position={[0, -0.03, 0]} receiveShadow>
        <boxGeometry args={[6, 0.06, 4.2]} />
        <meshStandardMaterial color="#1E293B" metalness={0.1} roughness={0.95} />
      </mesh>

      {resolvedAssets.map((asset) => renderResolvedAsset(asset))}

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
  return (
    <div style={{ width: '100%', height: 280, borderRadius: 10, overflow: 'hidden' }}>
      <Canvas camera={{ position: [3.1, 2.1, 3.2], fov: 50 }}>
        <SceneBlockoutMeshes scene={scene} />
      </Canvas>
    </div>
  );
}
