import { useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import {
  Tldraw,
  createShapeId,
  getArrowBindings,
  toRichText,
  type Editor,
  type TLArrowShape,
  type TLCreateShapePartial,
  type TLGeoShape,
  type TLShape,
  type TLShapeId,
} from "tldraw";
import "tldraw/tldraw.css";

import type { BuilderCanvasEdge, BuilderCanvasNode, BuilderCanvasState } from "./builderCanvasState";

const BUILDER_META_KEY = "builder_admin_canvas";
const BUILDER_NODE_META = "node";
const BUILDER_EDGE_META = "edge";

const NODE_COLORS: Record<BuilderCanvasNode["type"], TLGeoShape["props"]["color"]> = {
  plan: "blue",
  main_chat: "violet",
  thinkgraph: "yellow",
  research: "green",
  knowgraph: "blue",
  review: "grey",
};

type BuilderAdminCanvasProps = {
  projectId: string;
  state: BuilderCanvasState;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  onChange: (nextState: BuilderCanvasState) => void;
};

type BuilderNodeShape = TLCreateShapePartial<TLGeoShape> & { id: TLShapeId; type: "geo" };
type BuilderEdgeShape = TLCreateShapePartial<TLArrowShape> & { id: TLShapeId; type: "arrow" };

function slug(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function nodeShapeId(nodeId: string): TLShapeId {
  return createShapeId(`builder-node-${slug(nodeId) || "item"}`);
}

function edgeShapeId(edgeId: string): TLShapeId {
  return createShapeId(`builder-edge-${slug(edgeId) || "item"}`);
}

function isBuilderShape(shape: TLShape | null | undefined): boolean {
  return Boolean((shape?.meta as Record<string, unknown> | undefined)?.[BUILDER_META_KEY]);
}

function isBuilderNodeShape(shape: TLShape | null | undefined): shape is TLGeoShape {
  const meta = shape?.meta as Record<string, unknown> | undefined;
  return Boolean(meta?.[BUILDER_META_KEY]) && meta?.canvasRole === BUILDER_NODE_META && shape?.type === "geo";
}

function isBuilderEdgeShape(shape: TLShape | null | undefined): shape is TLArrowShape {
  const meta = shape?.meta as Record<string, unknown> | undefined;
  return Boolean(meta?.[BUILDER_META_KEY]) && meta?.canvasRole === BUILDER_EDGE_META && shape?.type === "arrow";
}

function getNodeIdFromShape(shape: TLShape | null | undefined): string | null {
  if (!isBuilderNodeShape(shape)) return null;
  const nodeId = String((shape.meta as Record<string, unknown> | undefined)?.nodeId || "").trim();
  return nodeId || null;
}

function makeNodeShape(node: BuilderCanvasNode): BuilderNodeShape {
  return {
    id: nodeShapeId(node.id),
    type: "geo",
    x: node.x,
    y: node.y,
    meta: {
      [BUILDER_META_KEY]: true,
      canvasRole: BUILDER_NODE_META,
      nodeId: node.id,
      nodeType: node.type,
      sourceId: node.sourceId,
    },
    props: {
      geo: "rectangle",
      dash: "solid",
      url: "",
      w: node.w,
      h: node.h,
      growY: 0,
      scale: 1,
      labelColor: "black",
      color: NODE_COLORS[node.type],
      fill: "solid",
      size: "m",
      font: "sans",
      align: "middle",
      verticalAlign: "middle",
      richText: toRichText(node.label),
    },
  };
}

function makeEdge(edge: BuilderCanvasEdge): {
  shape: BuilderEdgeShape;
  bindings: Array<{
    type: "arrow";
    fromId: TLShapeId;
    toId: TLShapeId;
    props: {
      terminal: "start" | "end";
      normalizedAnchor: { x: number; y: number };
      isExact: boolean;
      isPrecise: boolean;
      snap: "edge";
    };
  }>;
} {
  const id = edgeShapeId(edge.id);
  return {
    shape: {
      id,
      type: "arrow",
      x: 0,
      y: 0,
      meta: {
        [BUILDER_META_KEY]: true,
        canvasRole: BUILDER_EDGE_META,
        edgeId: edge.id,
        edgeType: edge.type,
        fromNodeId: edge.from,
        toNodeId: edge.to,
      },
      props: {
        kind: "arc",
        labelColor: "black",
        color: "grey",
        fill: "none",
        dash: "solid",
        size: "s",
        arrowheadStart: "none",
        arrowheadEnd: "arrow",
        font: "sans",
        start: { x: 0, y: 0 },
        end: { x: 240, y: 0 },
        bend: 0,
        richText: toRichText(""),
        labelPosition: 0.5,
        scale: 1,
        elbowMidPoint: 0.5,
      },
    },
    bindings: [
      {
        type: "arrow",
        fromId: id,
        toId: nodeShapeId(edge.from),
        props: {
          terminal: "start",
          normalizedAnchor: { x: 0.5, y: 0.5 },
          isExact: false,
          isPrecise: true,
          snap: "edge",
        },
      },
      {
        type: "arrow",
        fromId: id,
        toId: nodeShapeId(edge.to),
        props: {
          terminal: "end",
          normalizedAnchor: { x: 0.5, y: 0.5 },
          isExact: false,
          isPrecise: true,
          snap: "edge",
        },
      },
    ],
  };
}

function snapshotKey(state: BuilderCanvasState): string {
  const nodes = [...state.nodes]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((node) => ({
      id: node.id,
      type: node.type,
      label: node.label,
      sourceKind: node.sourceKind,
      sourceId: node.sourceId,
      agentType: node.agentType,
      x: Math.round(node.x),
      y: Math.round(node.y),
      w: Math.round(node.w),
      h: Math.round(node.h),
    }));
  const edges = [...state.edges]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((edge) => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      type: edge.type,
    }));
  return JSON.stringify({ nodes, edges });
}

function readCanvasState(editor: Editor, previousState: BuilderCanvasState): BuilderCanvasState {
  const shapeMap = new Map(
    editor
      .getCurrentPageShapes()
      .filter((shape) => isBuilderShape(shape))
      .map((shape) => [String(shape.id), shape]),
  );

  const previousNodeMap = new Map(previousState.nodes.map((node) => [node.id, node]));
  const nodes = editor
    .getCurrentPageShapes()
    .filter((shape) => isBuilderNodeShape(shape))
    .map((shape) => {
      const nodeId = getNodeIdFromShape(shape) || String(shape.id);
      const previous = previousNodeMap.get(nodeId);
      return {
        id: nodeId,
        type: previous?.type || "plan",
        label: previous?.label || "Node",
        sourceKind: previous?.sourceKind || "plan",
        sourceId: previous?.sourceId || nodeId,
        agentType: previous?.agentType || null,
        x: shape.x,
        y: shape.y,
        w: Number((shape.props as any)?.w) || previous?.w || 172,
        h: Number((shape.props as any)?.h) || previous?.h || 68,
      } satisfies BuilderCanvasNode;
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  const edges = editor
    .getCurrentPageShapes()
    .filter((shape) => isBuilderEdgeShape(shape))
    .map((shape) => {
      const bindings = getArrowBindings(editor, shape);
      const startShape = bindings.start ? shapeMap.get(String(bindings.start.toId)) : null;
      const endShape = bindings.end ? shapeMap.get(String(bindings.end.toId)) : null;
      const fromNodeId = getNodeIdFromShape(startShape);
      const toNodeId = getNodeIdFromShape(endShape);
      if (!fromNodeId || !toNodeId) return null;
      const meta = shape.meta as Record<string, unknown> | undefined;
      return {
        id: String(meta?.edgeId || `${fromNodeId}:${toNodeId}`),
        from: fromNodeId,
        to: toNodeId,
        type:
          meta?.edgeType === "updates" || meta?.edgeType === "reviews" ? (meta.edgeType as BuilderCanvasEdge["type"]) : "feeds",
      } satisfies BuilderCanvasEdge;
    })
    .filter((edge): edge is BuilderCanvasEdge => Boolean(edge))
    .sort((a, b) => a.id.localeCompare(b.id));

  return { nodes, edges };
}

function shapeAtEvent(editor: Editor, event: PointerEvent<HTMLDivElement> | MouseEvent<HTMLDivElement>) {
  const pagePoint = editor.screenToPage({ x: event.clientX, y: event.clientY });
  return editor.getShapeAtPoint(pagePoint, {
    hitInside: true,
    hitLabels: true,
    margin: 4,
    filter: isBuilderNodeShape,
  });
}

export function BuilderAdminCanvas({
  projectId,
  state,
  selectedNodeId,
  onSelectNode,
  onChange,
}: BuilderAdminCanvasProps) {
  const editorRef = useRef<Editor | null>(null);
  const applyingRef = useRef(false);
  const emitTimerRef = useRef<number | null>(null);
  const zoomedProjectRef = useRef<string>("");
  const lastSnapshotKeyRef = useRef(snapshotKey(state));
  const latestStateRef = useRef(state);
  const [pendingConnectionSourceId, setPendingConnectionSourceId] = useState<string | null>(null);

  useEffect(() => {
    latestStateRef.current = state;
    lastSnapshotKeyRef.current = snapshotKey(state);
  }, [state]);

  useEffect(() => {
    return () => {
      if (emitTimerRef.current != null) {
        window.clearTimeout(emitTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const currentBuilderShapes = editor.getCurrentPageShapes().filter((shape) => isBuilderShape(shape));
    const currentNodeShapes = currentBuilderShapes.filter((shape) => isBuilderNodeShape(shape));
    const currentEdgeShapes = currentBuilderShapes.filter((shape) => isBuilderEdgeShape(shape));

    const nextNodeIds = new Set(state.nodes.map((node) => nodeShapeId(node.id)));
    const existingNodeMap = new Map(currentNodeShapes.map((shape) => [String(shape.id), shape]));
    const nodeCreates: BuilderNodeShape[] = [];
    const nodeUpdates: BuilderNodeShape[] = [];
    const nodeDeletes = currentNodeShapes
      .filter((shape) => !nextNodeIds.has(shape.id))
      .map((shape) => shape.id);

    state.nodes.forEach((node) => {
      const nextShape = makeNodeShape(node);
      const existing = existingNodeMap.get(String(nextShape.id)) as TLGeoShape | undefined;
      if (!existing) {
        nodeCreates.push(nextShape);
        return;
      }
      nodeUpdates.push({
        ...nextShape,
        type: "geo",
      });
    });

    const edgeDeletes = currentEdgeShapes.map((shape) => shape.id);
    const nextEdges = state.edges
      .filter((edge) => state.nodes.some((node) => node.id === edge.from) && state.nodes.some((node) => node.id === edge.to))
      .map((edge) => makeEdge(edge));

    applyingRef.current = true;
    editor.run(() => {
      if (edgeDeletes.length) {
        editor.deleteShapes(edgeDeletes);
      }
      if (nodeDeletes.length) {
        editor.deleteShapes(nodeDeletes);
      }
      if (nodeCreates.length) {
        editor.createShapes(nodeCreates);
      }
      if (nodeUpdates.length) {
        editor.updateShapes(nodeUpdates);
      }
      if (nextEdges.length) {
        editor.createShapes(nextEdges.map((edge) => edge.shape));
        editor.createBindings(nextEdges.flatMap((edge) => edge.bindings));
      }
    }, { history: "ignore" });
    applyingRef.current = false;

    if (selectedNodeId) {
      const nextShapeId = nodeShapeId(selectedNodeId);
      if (editor.getShape(nextShapeId)) {
        editor.select(nextShapeId);
      }
    }

    if (zoomedProjectRef.current !== projectId && state.nodes.length) {
      zoomedProjectRef.current = projectId;
      editor.zoomToFit({ animation: { duration: 200 } });
    }
  }, [projectId, selectedNodeId, state]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (!selectedNodeId) {
      editor.setSelectedShapes([]);
      return;
    }
    const shapeId = nodeShapeId(selectedNodeId);
    if (editor.getShape(shapeId)) {
      editor.select(shapeId);
    }
  }, [selectedNodeId]);

  const canvasStyle = useMemo(
    () => ({
      borderRadius: 8,
      overflow: "hidden",
      background: "#171717",
      minHeight: 720,
      height: "100%",
      width: "100%",
      position: "relative" as const,
      border: "1px solid #3A3A3A",
    }),
    [],
  );

  return (
    <div
      style={canvasStyle}
      onDoubleClickCapture={(event) => {
        const editor = editorRef.current;
        if (!editor) return;
        const shape = shapeAtEvent(editor, event);
        const nodeId = getNodeIdFromShape(shape);
        if (!nodeId) return;
        event.preventDefault();
        event.stopPropagation();
        editor.cancelDoubleClick();
        editor.select(shape.id);
        setPendingConnectionSourceId(nodeId);
      }}
      onPointerUpCapture={(event) => {
        if (!pendingConnectionSourceId) return;
        const editor = editorRef.current;
        if (!editor) {
          setPendingConnectionSourceId(null);
          return;
        }
        const shape = shapeAtEvent(editor, event);
        const targetNodeId = getNodeIdFromShape(shape);
        if (!targetNodeId || targetNodeId === pendingConnectionSourceId) {
          setPendingConnectionSourceId(null);
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        const fromShapeId = nodeShapeId(pendingConnectionSourceId);
        const toShapeId = nodeShapeId(targetNodeId);
        if (!editor.getShape(fromShapeId) || !editor.getShape(toShapeId)) {
          setPendingConnectionSourceId(null);
          return;
        }
        const nextEdgeId = `edge:${pendingConnectionSourceId}:${targetNodeId}`;
        const existingEdge = latestStateRef.current.edges.some(
          (edge) => edge.from === pendingConnectionSourceId && edge.to === targetNodeId,
        );
        if (!existingEdge) {
          const nextEdge = makeEdge({
            id: nextEdgeId,
            from: pendingConnectionSourceId,
            to: targetNodeId,
            type: "feeds",
          });
          editor.run(() => {
            editor.createShapes([nextEdge.shape]);
            editor.createBindings(nextEdge.bindings);
          });
        }
        setPendingConnectionSourceId(null);
      }}
    >
      <Tldraw
        hideUi
        onMount={(editor) => {
          editorRef.current = editor;
          editor.setCurrentTool("select");
          const unlisten = editor.store.listen(() => {
            const selected = editor.getSelectedShapeIds()[0] || null;
            const selectedShape = selected ? editor.getShape(selected) : null;
            onSelectNode(getNodeIdFromShape(selectedShape));
            if (applyingRef.current) return;
            if (emitTimerRef.current != null) {
              window.clearTimeout(emitTimerRef.current);
            }
            emitTimerRef.current = window.setTimeout(() => {
              const nextState = readCanvasState(editor, latestStateRef.current);
              const nextKey = snapshotKey(nextState);
              if (nextKey !== lastSnapshotKeyRef.current) {
                lastSnapshotKeyRef.current = nextKey;
                latestStateRef.current = nextState;
                onChange(nextState);
              }
            }, 180);
          });
          return () => {
            if (emitTimerRef.current != null) {
              window.clearTimeout(emitTimerRef.current);
            }
            if (editorRef.current === editor) {
              editorRef.current = null;
            }
            unlisten();
          };
        }}
      />
    </div>
  );
}
