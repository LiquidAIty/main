import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';

export default function R3FSmokeTest() {
  return (
    <Canvas camera={{ position: [2.4, 1.8, 3.2], fov: 48 }}>
      <ambientLight intensity={0.55} />
      <directionalLight position={[3, 4, 5]} intensity={1.2} />
      <mesh rotation={[0.35, 0.55, 0]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#44dbd8" roughness={0.42} />
      </mesh>
      <OrbitControls makeDefault enableDamping />
    </Canvas>
  );
}
