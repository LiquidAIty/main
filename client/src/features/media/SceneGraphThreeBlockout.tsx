import React from 'react';
import { Canvas } from '@react-three/fiber';
import { Line, OrbitControls } from '@react-three/drei';
import type { SceneFlowPath, SceneGraphSource } from './sceneGraphSource';

type SceneGraphThreeBlockoutProps = {
  scene: SceneGraphSource;
};

function flowColor(flow: SceneFlowPath): string {
  if (flow.colorToken === 'blue') return '#3B82F6';
  if (flow.colorToken === 'orange') return '#F97316';
  return '#14B8A6';
}

function flowPoints(flow: SceneFlowPath): Array<[number, number, number]> {
  if (flow.flowType === 'cool_supply') {
    return [
      [0.9, 1.05, 0.1],
      [0.35, 1.1, -0.1],
      [-0.05, 1.0, -0.35],
    ];
  }
  if (flow.flowType === 'warm_intake') {
    return [
      [-1.2, 0.35, 0.45],
      [-0.65, 0.4, 0.35],
      [0.8, 0.7, 0.2],
    ];
  }
  return [
    [0.35, 1.0, 0.2],
    [0.05, 1.05, -0.2],
    [-0.25, 1.0, -0.35],
  ];
}

function SceneBlockoutMeshes({ scene }: { scene: SceneGraphSource }): React.ReactElement {
  const hasDesk = scene.props.some((prop) => prop.propType === 'desk');
  const hasStudent = scene.actors.some((actor) => actor.actorType === 'student');
  const hasCooler = scene.products.some(
    (product) =>
      product.productFamily === 'kool_skools_current' ||
      product.productFamily === 'koolphase_internal',
  );
  const hasComfortBubble = scene.flowPaths.some((flow) => flow.flowType === 'comfort_zone');

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

      {hasDesk ? (
        <>
          <mesh position={[0, 0.38, 0]}>
            <boxGeometry args={[1.7, 0.08, 0.95]} />
            <meshStandardMaterial color="#334155" roughness={0.75} />
          </mesh>
          <mesh position={[-0.72, 0.19, -0.35]}>
            <boxGeometry args={[0.08, 0.38, 0.08]} />
            <meshStandardMaterial color="#1F2937" />
          </mesh>
          <mesh position={[0.72, 0.19, -0.35]}>
            <boxGeometry args={[0.08, 0.38, 0.08]} />
            <meshStandardMaterial color="#1F2937" />
          </mesh>
          <mesh position={[-0.72, 0.19, 0.35]}>
            <boxGeometry args={[0.08, 0.38, 0.08]} />
            <meshStandardMaterial color="#1F2937" />
          </mesh>
          <mesh position={[0.72, 0.19, 0.35]}>
            <boxGeometry args={[0.08, 0.38, 0.08]} />
            <meshStandardMaterial color="#1F2937" />
          </mesh>
        </>
      ) : null}

      {hasCooler ? (
        <mesh position={[0.9, 0.66, 0.1]}>
          <boxGeometry args={[0.34, 0.62, 0.26]} />
          <meshStandardMaterial color="#60A5FA" roughness={0.35} metalness={0.12} />
        </mesh>
      ) : null}

      {hasStudent ? (
        <mesh position={[-0.05, 0.83, -0.35]}>
          <sphereGeometry args={[0.12, 22, 22]} />
          <meshStandardMaterial color="#CBD5E1" roughness={0.9} />
        </mesh>
      ) : null}

      {hasComfortBubble ? (
        <mesh position={[-0.05, 0.95, -0.35]}>
          <sphereGeometry args={[0.62, 40, 40]} />
          <meshStandardMaterial color="#2DD4BF" opacity={0.12} transparent />
        </mesh>
      ) : null}

      {scene.flowPaths.map((flow) => (
        <Line
          key={flow.id}
          points={flowPoints(flow)}
          color={flowColor(flow)}
          lineWidth={2}
          transparent
          opacity={0.92}
        />
      ))}

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
