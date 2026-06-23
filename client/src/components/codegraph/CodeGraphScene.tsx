import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Billboard, Html, OrbitControls, Text } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import * as THREE from "three";

import { colorForCodeGraphEdgeType, colorForCodeGraphLabel } from "./colors";
import type { CodeGraphData, CodeGraphEdge, CodeGraphNode } from "./types";

type CodeGraphSceneProps = {
  data: CodeGraphData;
  showLabels: boolean;
  highlightedIds: Set<number> | null;
  onNodeClick: (node: CodeGraphNode) => void;
  /** Fires when a click lands on empty canvas (no node hit). Optional; used by KnowGraph to
   *  step back up the explored neighborhood. Omitted callers keep prior behavior. */
  onBackgroundClick?: () => void;
  interactionLocked?: boolean;
  /** Explicit auto-rotate override. Defaults to !interactionLocked (prior behavior); KnowGraph
   *  passes false so its Bloom-style neighborhood stays a stable, readable 2D layout. */
  autoRotate?: boolean;
  cameraAction?: "zoom_in" | "zoom_out" | "fit_view" | null;
  cameraActionToken?: number;
};

function CameraCommandBridge({
  controlsRef,
  interactionLocked,
  autoRotate,
  cameraAction,
  cameraActionToken,
  nodes,
}: {
  controlsRef: MutableRefObject<any>;
  interactionLocked: boolean;
  autoRotate: boolean;
  cameraAction: "zoom_in" | "zoom_out" | "fit_view" | null;
  cameraActionToken: number;
  nodes: CodeGraphNode[];
}) {
  const { camera } = useThree();
  const lastAutoFitSignatureRef = useRef<string>("");

  const fitToGraph = () => {
    const controls = controlsRef.current;
    if (!controls || nodes.length === 0) return;

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;

    for (const node of nodes) {
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      minZ = Math.min(minZ, node.z);
      maxX = Math.max(maxX, node.x);
      maxY = Math.max(maxY, node.y);
      maxZ = Math.max(maxZ, node.z);
    }

    const center = new THREE.Vector3(
      (minX + maxX) / 2,
      (minY + maxY) / 2,
      (minZ + maxZ) / 2,
    );
    const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1);
    const perspectiveCamera = camera as THREE.PerspectiveCamera;
    const fovRadians = ((perspectiveCamera.fov || 50) * Math.PI) / 180;
    const distance = (span / Math.max(Math.tan(fovRadians / 2), 0.01)) * 0.72;

    const direction = new THREE.Vector3()
      .subVectors(camera.position, controls.target)
      .normalize();
    if (!Number.isFinite(direction.lengthSq()) || direction.lengthSq() < 0.001) {
      direction.set(0, 0, 1);
    }
    camera.position.copy(center.clone().add(direction.multiplyScalar(distance)));
    controls.target.copy(center);
    controls.update();
  };

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    controls.enableRotate = !interactionLocked;
    controls.enablePan = !interactionLocked;
    controls.enableZoom = !interactionLocked;
    controls.autoRotate = autoRotate;
    controls.update();
  }, [interactionLocked, autoRotate, controlsRef]);

  useEffect(() => {
    if (!cameraAction || !cameraActionToken) return;
    const controls = controlsRef.current;
    if (!controls) return;

    if (cameraAction === "zoom_in") {
      if (typeof controls.dollyOut === "function") controls.dollyOut(1.2);
      controls.update();
      return;
    }
    if (cameraAction === "zoom_out") {
      if (typeof controls.dollyIn === "function") controls.dollyIn(1.2);
      controls.update();
      return;
    }
    if (cameraAction === "fit_view") {
      fitToGraph();
    }
  }, [cameraAction, cameraActionToken, controlsRef]);

  useEffect(() => {
    if (nodes.length === 0) return;
    const signature = `${nodes.length}:${nodes[0]?.id ?? ""}:${
      nodes[nodes.length - 1]?.id ?? ""
    }`;
    if (lastAutoFitSignatureRef.current === signature) return;
    lastAutoFitSignatureRef.current = signature;
    const frame = window.requestAnimationFrame(() => {
      fitToGraph();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [nodes]);

  return null;
}

function NodeCloud({
  nodes,
  highlightedIds,
  onHover,
  onClick,
}: {
  nodes: CodeGraphNode[];
  highlightedIds: Set<number> | null;
  onHover: (node: CodeGraphNode | null) => void;
  onClick: (node: CodeGraphNode) => void;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const tempObj = useMemo(() => new THREE.Object3D(), []);
  const tempColor = useMemo(() => new THREE.Color(), []);
  const colors = useMemo(() => {
    const arr = new Float32Array(nodes.length * 3);
    const hasHighlight = highlightedIds && highlightedIds.size > 0;

    for (let i = 0; i < nodes.length; i++) {
      tempColor.set(nodes[i].color);
      if (hasHighlight && !highlightedIds.has(nodes[i].id)) {
        tempColor.multiplyScalar(0.15);
      } else {
        const brightness = (tempColor.r + tempColor.g + tempColor.b) / 3;
        const boost = 1.2 + brightness * 0.8;
        tempColor.multiplyScalar(boost);
      }
      arr[i * 3] = tempColor.r;
      arr[i * 3 + 1] = tempColor.g;
      arr[i * 3 + 2] = tempColor.b;
    }
    return arr;
  }, [nodes, highlightedIds, tempColor]);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const hasHighlight = highlightedIds && highlightedIds.size > 0;

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      tempObj.position.set(node.x, node.y, node.z);
      const highlighted = !hasHighlight || highlightedIds.has(node.id);
      const scale = node.size * (highlighted ? 0.5 : 0.2);
      tempObj.scale.set(scale, scale, scale);
      tempObj.updateMatrix();
      mesh.setMatrixAt(i, tempObj.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, nodes.length]}
      frustumCulled={false}
      onPointerOver={(event) => {
        event.stopPropagation();
        if (event.instanceId !== undefined && event.instanceId < nodes.length) {
          onHover(nodes[event.instanceId]);
        }
      }}
      onPointerOut={() => onHover(null)}
      onClick={(event) => {
        event.stopPropagation();
        if (event.instanceId !== undefined && event.instanceId < nodes.length) {
          onClick(nodes[event.instanceId]);
        }
      }}
    >
      <sphereGeometry args={[1, 32, 24]} />
      <meshBasicMaterial vertexColors toneMapped={false} />
      <instancedBufferAttribute attach="geometry-attributes-color" args={[colors, 3]} />
    </instancedMesh>
  );
}

function getClusterKey(filePath?: string): string {
  if (!filePath) return "";
  const parts = filePath.split("/");
  return parts.slice(0, Math.min(2, parts.length)).join("/");
}

function EdgeLines({
  nodes,
  edges,
  highlightedIds,
}: {
  nodes: CodeGraphNode[];
  edges: CodeGraphEdge[];
  highlightedIds: Set<number> | null;
}) {
  const geometry = useMemo(() => {
    const idMap = new Map<number, number>();
    for (let i = 0; i < nodes.length; i++) idMap.set(nodes[i].id, i);
    const hasHighlight = highlightedIds && highlightedIds.size > 0;
    const positions = new Float32Array(edges.length * 6);
    const colors = new Float32Array(edges.length * 6);
    let validCount = 0;

    for (const edge of edges) {
      const sourceIndex = idMap.get(edge.source);
      const targetIndex = idMap.get(edge.target);
      if (sourceIndex === undefined || targetIndex === undefined) continue;
      const source = nodes[sourceIndex];
      const target = nodes[targetIndex];
      const sourceHighlighted = !hasHighlight || highlightedIds.has(source.id);
      const targetHighlighted = !hasHighlight || highlightedIds.has(target.id);
      if (hasHighlight && !sourceHighlighted && !targetHighlighted) continue;

      const sameCluster = getClusterKey(source.file_path) === getClusterKey(target.file_path);
      let intensity = sameCluster ? 0.25 : 0.06;
      if (hasHighlight) intensity = sourceHighlighted && targetHighlighted ? 0.5 : 0.04;
      const color = new THREE.Color(colorForCodeGraphEdgeType(edge.type));
      const offset = validCount * 6;
      positions[offset] = source.x;
      positions[offset + 1] = source.y;
      positions[offset + 2] = source.z;
      positions[offset + 3] = target.x;
      positions[offset + 4] = target.y;
      positions[offset + 5] = target.z;
      colors[offset] = color.r * intensity;
      colors[offset + 1] = color.g * intensity;
      colors[offset + 2] = color.b * intensity;
      colors[offset + 3] = color.r * intensity;
      colors[offset + 4] = color.g * intensity;
      colors[offset + 5] = color.b * intensity;
      validCount += 1;
    }

    const nextGeometry = new THREE.BufferGeometry();
    nextGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(positions.slice(0, validCount * 6), 3),
    );
    nextGeometry.setAttribute(
      "color",
      new THREE.BufferAttribute(colors.slice(0, validCount * 6), 3),
    );
    return nextGeometry;
  }, [nodes, edges, highlightedIds]);

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial
        vertexColors
        transparent
        opacity={1}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </lineSegments>
  );
}

function AmbientDust({
  nodes,
  highlightedIds,
}: {
  nodes: CodeGraphNode[];
  highlightedIds: Set<number> | null;
}) {
  const pointsRef = useRef<THREE.Points>(null);
  const cloud = useMemo(() => {
    const sample = nodes.slice(0, Math.min(nodes.length, 220));
    const positions = new Float32Array(sample.length * 3);
    const colors = new Float32Array(sample.length * 3);
    const color = new THREE.Color();
    sample.forEach((node, index) => {
      positions[index * 3] = node.x + (Math.random() - 0.5) * 36;
      positions[index * 3 + 1] = node.y + (Math.random() - 0.5) * 36;
      positions[index * 3 + 2] = node.z + (Math.random() - 0.5) * 36;
      color.set(node.color);
      if (highlightedIds?.size && !highlightedIds.has(node.id)) {
        color.multiplyScalar(0.22);
      } else {
        color.lerp(new THREE.Color("#f3b17a"), 0.18);
      }
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
    });
    return { positions, colors };
  }, [nodes, highlightedIds]);

  useFrame(({ clock }) => {
    const points = pointsRef.current;
    if (!points) return;
    points.rotation.y = clock.getElapsedTime() * 0.012;
    points.rotation.x = Math.sin(clock.getElapsedTime() * 0.08) * 0.02;
    const material = points.material as THREE.PointsMaterial;
    material.opacity = highlightedIds?.size ? 0.28 : 0.18;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[cloud.positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[cloud.colors, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={4.2}
        sizeAttenuation
        transparent
        opacity={0.18}
        vertexColors
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
      />
    </points>
  );
}

function NodeLabels({ nodes, highlightedIds, maxLabels = 80 }: { nodes: CodeGraphNode[]; highlightedIds: Set<number> | null; maxLabels?: number; }) {
  const labeled = useMemo(() => {
    const hasHighlight = highlightedIds && highlightedIds.size > 0;
    if (hasHighlight) {
      return nodes
        .filter((node) => highlightedIds.has(node.id))
        .sort((a, b) => b.size - a.size)
        .slice(0, maxLabels);
    }
    return [...nodes].sort((a, b) => b.size - a.size).slice(0, maxLabels);
  }, [nodes, highlightedIds, maxLabels]);

  return (
    <group>
      {labeled.map((node) => (
        <Billboard key={node.id} position={[node.x, node.y + node.size * 0.7, node.z]} follow>
          <Text
            fontSize={Math.max(1.8, node.size * 0.4)}
            color={node.color || colorForCodeGraphLabel(node.label)}
            anchorX="center"
            anchorY="bottom"
            outlineColor="#000000"
            outlineWidth={0.2}
            fillOpacity={0.95}
          >
            {node.name}
          </Text>
        </Billboard>
      ))}
    </group>
  );
}

function NodeTooltip({ node }: { node: CodeGraphNode | null }) {
  if (!node) return null;
  return (
    <Html position={[node.x, node.y + node.size * 0.7, node.z]} center style={{ pointerEvents: "none" }}>
      <div
        style={{
          background: "rgba(26,26,46,0.95)",
          backdropFilter: "blur(6px)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 8,
          padding: "6px 10px",
          fontSize: 12,
          whiteSpace: "nowrap",
          boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
          maxWidth: 350,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              display: "inline-block",
              background: colorForCodeGraphLabel(node.label),
            }}
          />
          <span style={{ color: "#fff", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>{node.name}</span>
          <span style={{ color: "rgba(255,255,255,0.35)" }}>{node.label}</span>
        </div>
        {node.file_path ? <div style={{ color: "rgba(255,255,255,0.35)", fontFamily: "monospace" }}>{node.file_path}</div> : null}
      </div>
    </Html>
  );
}

export function CodeGraphScene({
  data,
  showLabels,
  highlightedIds,
  onNodeClick,
  onBackgroundClick,
  interactionLocked = false,
  autoRotate,
  cameraAction = null,
  cameraActionToken = 0,
}: CodeGraphSceneProps): React.ReactElement {
  const [hoveredNode, setHoveredNode] = useState<CodeGraphNode | null>(null);
  const controlsRef = useRef<any>(null);
  const effectiveAutoRotate = autoRotate ?? !interactionLocked;

  return (
    <Canvas
      camera={{ position: [0, 0, 800], fov: 50, near: 0.1, far: 100000 }}
      style={{ background: "transparent" }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      onPointerMissed={onBackgroundClick ? () => onBackgroundClick() : undefined}
    >
      <ambientLight intensity={0.5} />
      <pointLight position={[500, 500, 500]} intensity={0.6} />
      <pointLight position={[-300, -200, -300]} intensity={0.4} color="#6040ff" />

      <AmbientDust nodes={data.nodes} highlightedIds={highlightedIds} />
      <EdgeLines nodes={data.nodes} edges={data.edges} highlightedIds={highlightedIds} />
      <NodeCloud
        nodes={data.nodes}
        highlightedIds={highlightedIds}
        onHover={setHoveredNode}
        onClick={onNodeClick}
      />
      {showLabels ? <NodeLabels nodes={data.nodes} highlightedIds={highlightedIds} /> : null}
      <NodeTooltip node={hoveredNode} />
      <CameraCommandBridge
        controlsRef={controlsRef}
        interactionLocked={interactionLocked}
        autoRotate={effectiveAutoRotate}
        cameraAction={cameraAction}
        cameraActionToken={cameraActionToken}
        nodes={data.nodes}
      />

      {data.linked_projects?.map((linked) => {
        const offsetNodes = linked.nodes.map((node) => ({
          ...node,
          x: node.x + linked.offset.x,
          y: node.y + linked.offset.y,
          z: node.z + linked.offset.z,
        }));
        return (
          <group key={linked.project}>
            <EdgeLines nodes={offsetNodes} edges={linked.edges} highlightedIds={null} />
            <NodeCloud nodes={offsetNodes} highlightedIds={null} onHover={setHoveredNode} onClick={onNodeClick} />
          </group>
        );
      })}

      <EffectComposer>
        <Bloom
          luminanceThreshold={0.34}
          luminanceSmoothing={0.7}
          intensity={0.95}
          mipmapBlur
          radius={0.5}
        />
      </EffectComposer>

      <OrbitControls
        ref={controlsRef}
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.5}
        zoomSpeed={1.5}
        minDistance={10}
        maxDistance={50000}
        autoRotate={effectiveAutoRotate}
        enableRotate={!interactionLocked}
        enablePan={!interactionLocked}
        enableZoom={!interactionLocked}
        autoRotateSpeed={0.22}
      />
    </Canvas>
  );
}
