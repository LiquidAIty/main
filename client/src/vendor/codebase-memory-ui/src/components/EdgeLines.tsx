import { useMemo } from "react";
import * as THREE from "three";
import type { GraphNode, GraphEdge } from "../lib/types";

interface EdgeLinesProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  highlightedIds: Set<number> | null;
  opacity?: number;
}

function getClusterKey(fp?: string): string {
  if (!fp) return "";
  const parts = fp.split("/");
  return parts.slice(0, Math.min(2, parts.length)).join("/");
}

/* Edge type → color (matches the filter panel) */
const EDGE_TYPE_COLORS: Record<string, string> = {
  CALLS: "#1DA27E",
  IMPORTS: "#62B0E8",
  DEFINES: "#76A9B8",
  DEFINES_METHOD: "#76A9B8",
  CONTAINS_FILE: "#91C4B3",
  CONTAINS_FOLDER: "#91C4B3",
  CONTAINS_PACKAGE: "#91C4B3",
  HANDLES: "#7BC8C4",
  IMPLEMENTS: "#5E9EA3",
  HTTP_CALLS: "#4E8F9A",
  ASYNC_CALLS: "#6FA8B8",
  MEMBER_OF: "#64748b",
  TESTS_FILE: "#06b6d4",
};

const DEFAULT_EDGE_COLOR = "#1C8585";

export function EdgeLines({ nodes, edges, highlightedIds, opacity = 1.0 }: EdgeLinesProps) {
  const geometry = useMemo(() => {
    const idMap = new Map<number, number>();
    for (let i = 0; i < nodes.length; i++) {
      idMap.set(nodes[i].id, i);
    }

    const hasHighlight = highlightedIds && highlightedIds.size > 0;
    const positions = new Float32Array(edges.length * 6);
    const colors = new Float32Array(edges.length * 6);
    let validCount = 0;

    for (const edge of edges) {
      const si = idMap.get(edge.source);
      const ti = idMap.get(edge.target);
      if (si === undefined || ti === undefined) continue;

      const s = nodes[si];
      const t = nodes[ti];

      const sHL = !hasHighlight || highlightedIds.has(s.id);
      const tHL = !hasHighlight || highlightedIds.has(t.id);
      if (hasHighlight && !sHL && !tHL) continue;

      const sameCluster =
        getClusterKey(s.file_path) === getClusterKey(t.file_path);

      /* Intensity based on cluster membership and highlight.
       * With additive blending + dark background, these glow nicely. */
      let intensity = sameCluster ? 0.25 : 0.06;
      if (hasHighlight) {
        intensity = sHL && tHL ? 0.5 : 0.04;
      }

      const off = validCount * 6;
      positions[off] = s.x;
      positions[off + 1] = s.y;
      positions[off + 2] = s.z;
      positions[off + 3] = t.x;
      positions[off + 4] = t.y;
      positions[off + 5] = t.z;

      /* Color from edge TYPE (correlates with edge type filter) */
      const edgeColor = new THREE.Color(
        EDGE_TYPE_COLORS[edge.type] ?? DEFAULT_EDGE_COLOR,
      );
      colors[off] = edgeColor.r * intensity;
      colors[off + 1] = edgeColor.g * intensity;
      colors[off + 2] = edgeColor.b * intensity;
      colors[off + 3] = edgeColor.r * intensity;
      colors[off + 4] = edgeColor.g * intensity;
      colors[off + 5] = edgeColor.b * intensity;
      validCount++;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.BufferAttribute(positions.slice(0, validCount * 6), 3),
    );
    geo.setAttribute(
      "color",
      new THREE.BufferAttribute(colors.slice(0, validCount * 6), 3),
    );
    return geo;
  }, [nodes, edges, highlightedIds]);

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial
        vertexColors
        transparent
        opacity={opacity}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </lineSegments>
  );
}
