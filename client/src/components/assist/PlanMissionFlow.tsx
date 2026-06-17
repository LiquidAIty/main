import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  type Edge,
  addEdge,
  Background,
  BackgroundVariant,
  type Connection,
  ConnectionMode,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
  applyEdgeChanges,
  applyNodeChanges,
  useEdgesState,
  useNodesState,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react';

import '@xyflow/react/dist/style.css';

import type { StructuredAssistPlanSurface } from '../builder/assistPlanSurface';

import {
  GRAPH_THEME,
  graphControlButtonStyle,
  graphControlStackStyle,
} from '../graph/graphVisualTokens';
import TurboFlowEdge from '../builder/edges/TurboFlowEdge';
import {
  buildPlanMissionGraph,
  type PlanArtifactNodeData,
  type PlanFrameNodeData,
  type PlanMissionGraph,
  type PlanMissionNodeOverrideMap,
  type PlanMissionFlowEdgeData,
  type PlanMissionNodeData,
  type PlanMissionFlowNode,
  type PlanScene,
  type PlanScenePath,
  type PlanScenePurpose,
} from './planMissionModel';

type PlanMissionFocus = {
  nodeId: string;
  nodeLabel: string;
  nodeKind: string;
  nodeData: PlanMissionNodeData;
} | null;

type PlanMissionFlowProps = {
  structuredPlan: StructuredAssistPlanSurface;
  missionGraph?: PlanMissionGraph;
  projectId?: string | null;
  compact?: boolean;
  fullHeight?: boolean;
  nodeOverrides?: PlanMissionNodeOverrideMap;
  selectedNodeId?: string | null;
  editMode?: boolean;
  drawerLinked?: boolean;
  onFocusChange?: (focus: PlanMissionFocus) => void;
  /** Approval gate only. Called when the canvas Go arrow is clicked with a Step
   *  selected. Must stage the selected step and stop — it never executes. */
  onGoGate?: () => void;
  /** Inspector-style gate status to show near the canvas Go arrow. */
  goGateStatus?: string | null;
};

function toPlanMissionFocus(node: PlanMissionFlowNode): Exclude<PlanMissionFocus, null> {
  const nodeData = (node.data || {}) as PlanMissionNodeData;
  return {
    nodeId: node.id,
    nodeLabel: String(nodeData.label || node.id),
    nodeKind: String(nodeData.kind || 'Task'),
    nodeData: {
      ...nodeData,
      label: String(nodeData.label || node.id),
      kind: String(nodeData.kind || 'Task') as PlanMissionNodeData['kind'],
      status: String(nodeData.status || 'proposed') as PlanMissionNodeData['status'],
      description: String(nodeData.description || ''),
      relatedFiles: Array.isArray(nodeData.relatedFiles)
        ? nodeData.relatedFiles.map((entry) => String(entry || ''))
        : [],
      relatedObjects: Array.isArray(nodeData.relatedObjects)
        ? nodeData.relatedObjects.map((entry) => String(entry || ''))
        : [],
      links: Array.isArray(nodeData.links)
        ? nodeData.links.map((entry) => String(entry || ''))
        : [],
    },
  };
}

const PLAN_LAYOUT_STORAGE_PREFIX = 'liquidaity:plan-layout:v2';

type PlanLayoutViewport = { x: number; y: number; zoom: number };

type PersistedPlanLayout = {
  nodePositions?: Record<string, { x: number; y: number }>;
  viewport?: PlanLayoutViewport;
};

function buildPlanLayoutStorageKey(projectId?: string | null) {
  const normalizedProjectId = String(projectId || '').trim();
  if (!normalizedProjectId) return null;
  return `${PLAN_LAYOUT_STORAGE_PREFIX}:${normalizedProjectId}`;
}

function readPersistedPlanLayout(
  storageKey: string | null,
): PersistedPlanLayout | null {
  if (!storageKey || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedPlanLayout;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function persistPlanLayout(
  storageKey: string | null,
  payload: PersistedPlanLayout,
) {
  if (!storageKey || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(payload));
  } catch {
    // ignore storage failures
  }
}

const DEFAULT_PLAN_SCENE_DEFS: Array<{
  id: string;
  label: string;
  purpose: PlanScenePurpose;
  viewport: { x: number; y: number; zoom: number };
  speakerNote: string;
}> = [
  {
    id: 'scene_overview',
    label: 'Overview',
    purpose: 'overview',
    viewport: { x: 72, y: 96, zoom: 0.58 },
    speakerNote: 'Briefing Agent can later open with the plan map and orient the audience.',
  },
  {
    id: 'scene_goal_problem',
    label: 'Goal',
    purpose: 'problem',
    viewport: { x: 90, y: 120, zoom: 0.82 },
    speakerNote: 'Speaker notes can summarize the user goal, problem framing, and constraints.',
  },
  {
    id: 'scene_evidence_research',
    label: 'Evidence',
    purpose: 'evidence',
    viewport: { x: -260, y: 108, zoom: 0.72 },
    speakerNote: 'Later this scene can collect dropped evidence, source files, and research artifacts.',
  },
  {
    id: 'scene_approach',
    label: 'Approach',
    purpose: 'approach',
    viewport: { x: -520, y: 112, zoom: 0.7 },
    speakerNote: 'Briefing Agent can later turn this into the proposed route through the work.',
  },
  {
    id: 'scene_execution_steps',
    label: 'Execute',
    purpose: 'execution',
    viewport: { x: -760, y: 112, zoom: 0.66 },
    speakerNote: 'This scene can become the step-by-step implementation and dependency view.',
  },
  {
    id: 'scene_agent_roles',
    label: 'Roles',
    purpose: 'execution',
    viewport: { x: -1000, y: 112, zoom: 0.66 },
    speakerNote: 'Later this scene can explain assigned agents and work ownership.',
  },
  {
    id: 'scene_risks',
    label: 'Risks',
    purpose: 'risk',
    viewport: { x: -1230, y: 112, zoom: 0.66 },
    speakerNote: 'Speaker notes can call out blockers, assumptions, and review points.',
  },
  {
    id: 'scene_approval_next_step',
    label: 'Next',
    purpose: 'approval',
    viewport: { x: -1460, y: 112, zoom: 0.66 },
    speakerNote: 'This scene can become the closing approval and next action prompt.',
  },
];

function buildDefaultPlanScenePath(): {
  scenes: PlanScene[];
  defaultPath: PlanScenePath;
} {
  const scenes = DEFAULT_PLAN_SCENE_DEFS.map((scene) => ({
    ...scene,
    frameId: null,
  }));
  return {
    scenes,
    defaultPath: {
      id: 'default_guided_briefing',
      label: 'Guided Briefing',
      sceneIds: scenes.map((scene) => scene.id),
      steps: scenes.map((scene, index) => ({
        id: `default_guided_briefing_step_${index + 1}`,
        sceneId: scene.id,
        label: scene.label,
        order: index + 1,
      })),
      isDefault: true,
    },
  };
}

function WallAnchorNode() {
  return (
    <div
      aria-hidden
      style={{
        width: 1,
        height: 1,
        opacity: 0,
        pointerEvents: 'none',
      }}
    />
  );
}

function MissionNode({ data, selected }: NodeProps<any>) {
  const nodeData = data as PlanMissionNodeData;
  const status = String(nodeData?.status || 'proposed');
  const shellActive = Boolean(selected || status.toLowerCase() === 'running');
  // Canvas node face shows ONLY the object/task title. All metadata (kind, status,
  // source, provenance, raw artifact) stays in node data and the inspector details
  // panel — never rendered as badges, status words, or road-sign text on the face.
  const title = String(nodeData?.title || nodeData?.label || 'Step');
  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          border: `1px solid ${GRAPH_THEME.accent.primaryBorder}`,
          background: GRAPH_THEME.accent.primary,
        }}
      />
      <div
        style={{
          position: 'relative',
          display: 'grid',
          alignContent: 'start',
          gap: 4,
          borderRadius: 14,
          border: `1px solid ${
            selected ? 'rgba(55,173,170,0.75)' : shellActive ? 'rgba(55,173,170,0.44)' : 'rgba(55,173,170,0.24)'
          }`,
          boxShadow: selected
            ? 'inset 0 1px 0 rgba(255,255,255,0.06), 0 0 0 1px rgba(55,173,170,0.4), 0 0 22px rgba(55,173,170,0.32)'
            : shellActive
              ? 'inset 0 1px 0 rgba(255,255,255,0.05), 0 0 0 1px rgba(55,173,170,0.12)'
              : 'inset 0 1px 0 rgba(255,255,255,0.03)',
          padding: '8px 9px',
          background: GRAPH_THEME.card.glassBackground,
          width: 260,
          minHeight: 104,
        }}
      >
        <div
          style={{
            fontSize: 15,
            fontWeight: 700,
            lineHeight: 1.28,
            letterSpacing: '-0.01em',
            color: GRAPH_THEME.surface.text,
            position: 'relative',
            zIndex: 1,
            overflowWrap: 'break-word',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {title}
        </div>
        {/*
          SWAT (Selected Work Action Tray) — the approval gate, attached to the
          selected Step node and anchored just below the card so it does not
          overlap card text. Clicking GO stages the selected step at the gate via
          the injected handler ONLY; it never executes (no coder/tools/terminal/
          Progress Ledger, no autogenMessages/finalResponseText).
        */}
        {selected && typeof nodeData.onGoGate === 'function' ? (
          <div
            data-testid="planflow-swat-tray"
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              marginTop: 10,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              zIndex: 30,
            }}
          >
            <button
              type="button"
              data-testid="planflow-swat-go"
              aria-label="Go — approve selected step"
              title="Go — stage the selected step at the approval gate"
              onClick={(event) => {
                event.stopPropagation();
                nodeData.onGoGate?.();
              }}
              className="flex items-center justify-center"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                padding: '7px 16px',
                borderRadius: 999,
                background: GRAPH_THEME.accent.primary,
                border: '1px solid rgba(79,162,173,0.7)',
                boxShadow:
                  '0 0 0 1px rgba(55,173,170,0.4), 0 10px 22px rgba(55,173,170,0.32), inset 0 1px 0 rgba(255,255,255,0.18)',
                color: '#FFFFFF',
                fontWeight: 800,
                fontSize: 12.5,
                letterSpacing: '0.06em',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              GO
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#FFFFFF"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 19V5" />
                <path d="M5 12l7-7 7 7" />
              </svg>
            </button>
            {nodeData.goGateStatus ? (
              <div
                data-testid="planflow-swat-status"
                style={{
                  maxWidth: 260,
                  padding: '6px 10px',
                  borderRadius: 10,
                  border: `1px solid ${GRAPH_THEME.accent.primaryBorder}`,
                  background: 'rgba(11,14,18,0.96)',
                  color: GRAPH_THEME.surface.text,
                  fontSize: 11,
                  lineHeight: 1.3,
                  boxShadow: '0 12px 28px rgba(0,0,0,0.28)',
                }}
              >
                {nodeData.goGateStatus}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          border: `1px solid ${GRAPH_THEME.accent.primaryBorder}`,
          background: GRAPH_THEME.accent.primary,
        }}
      />
    </>
  );
}

function formatFileSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) return '0 KB';
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function PlanImageNode({ data, selected }: NodeProps<any>) {
  const nodeData = data as PlanArtifactNodeData;
  return (
    <div
      style={{
        width: 220,
        borderRadius: 10,
        border: `1px solid ${selected ? 'rgba(55,173,170,0.56)' : 'rgba(167,176,186,0.22)'}`,
        background: 'rgba(8,12,16,0.88)',
        boxShadow: selected
          ? '0 0 0 1px rgba(55,173,170,0.22), 0 16px 34px rgba(0,0,0,0.24)'
          : '0 12px 28px rgba(0,0,0,0.22)',
        overflow: 'hidden',
      }}
    >
      {nodeData.previewUrl ? (
        <img
          src={nodeData.previewUrl}
          alt={nodeData.label}
          draggable={false}
          style={{
            display: 'block',
            width: '100%',
            height: 140,
            objectFit: 'cover',
            background: 'rgba(255,255,255,0.04)',
          }}
        />
      ) : null}
      <div style={{ padding: '9px 10px', display: 'grid', gap: 3 }}>
        <div
          style={{
            color: GRAPH_THEME.surface.text,
            fontSize: 12,
            fontWeight: 700,
            lineHeight: 1.25,
            overflowWrap: 'anywhere',
          }}
        >
          {nodeData.fileName || nodeData.label}
        </div>
        <div style={{ color: GRAPH_THEME.drawer.inputMuted, fontSize: 11 }}>
          Image - {formatFileSize(nodeData.size)}
        </div>
      </div>
    </div>
  );
}

function PlanPdfNode({ data, selected }: NodeProps<any>) {
  const nodeData = data as PlanArtifactNodeData;
  return (
    <div
      style={{
        width: 210,
        minHeight: 118,
        borderRadius: 10,
        border: `1px solid ${selected ? 'rgba(223,146,84,0.54)' : 'rgba(167,176,186,0.22)'}`,
        background: 'linear-gradient(180deg, rgba(18,20,24,0.92), rgba(8,10,13,0.92))',
        boxShadow: selected
          ? '0 0 0 1px rgba(223,146,84,0.18), 0 16px 34px rgba(0,0,0,0.24)'
          : '0 12px 28px rgba(0,0,0,0.22)',
        padding: 12,
        display: 'grid',
        alignContent: 'space-between',
        gap: 14,
      }}
    >
      <div
        aria-hidden
        style={{
          width: 34,
          height: 42,
          borderRadius: 5,
          border: '1px solid rgba(223,146,84,0.46)',
          background: 'rgba(223,146,84,0.12)',
          color: 'rgba(245,197,150,0.9)',
          display: 'grid',
          placeItems: 'center',
          fontSize: 10,
          fontWeight: 800,
        }}
      >
        PDF
      </div>
      <div style={{ display: 'grid', gap: 4 }}>
        <div
          style={{
            color: GRAPH_THEME.surface.text,
            fontSize: 12,
            fontWeight: 700,
            lineHeight: 1.25,
            overflowWrap: 'anywhere',
          }}
        >
          {nodeData.fileName || nodeData.label}
        </div>
        <div style={{ color: GRAPH_THEME.drawer.inputMuted, fontSize: 11 }}>
          {formatFileSize(nodeData.size)}
        </div>
      </div>
    </div>
  );
}

function PlanFrameNode({ data, selected }: NodeProps<any>) {
  const nodeData = data as PlanFrameNodeData;
  return (
    <div
      style={{
        width: 480,
        height: 300,
        borderRadius: 16,
        border: `1px solid ${selected ? 'rgba(55,173,170,0.62)' : 'rgba(55,173,170,0.28)'}`,
        background: 'rgba(55,173,170,0.035)',
        boxShadow: selected
          ? 'inset 0 0 0 1px rgba(55,173,170,0.16), 0 0 34px rgba(55,173,170,0.12)'
          : 'inset 0 0 0 1px rgba(255,255,255,0.025)',
        position: 'relative',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 14,
          top: -28,
          color: GRAPH_THEME.drawer.inputText,
          fontSize: 12,
          fontWeight: 700,
          padding: '5px 9px',
          borderRadius: 999,
          border: '1px solid rgba(55,173,170,0.24)',
          background: 'rgba(8,12,16,0.88)',
          boxShadow: '0 8px 20px rgba(0,0,0,0.18)',
        }}
      >
        {nodeData.label || 'Plan Frame'}
      </div>
      {nodeData.isLanding ? (
        <div
          style={{
            position: 'absolute',
            right: 14,
            bottom: 12,
            color: GRAPH_THEME.drawer.inputMuted,
            fontSize: 11,
          }}
        >
          {nodeData.mode}
        </div>
      ) : null}
    </div>
  );
}

const missionNodeTypes: any = {
  mission: MissionNode,
  wallAnchor: WallAnchorNode,
  planImage: PlanImageNode,
  planPdf: PlanPdfNode,
  planFrame: PlanFrameNode,
};

const missionEdgeTypes = {
  turboFlow: TurboFlowEdge,
};

type PlanSurfaceNode =
  | Node<PlanArtifactNodeData>
  | Node<PlanFrameNodeData>;

const SUPPORTED_PLAN_ARTIFACT_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
]);

function isPlanSurfaceNode(node: { id: string }) {
  return (
    node.id.startsWith('plan_artifact_') || node.id.startsWith('plan_frame_')
  );
}

function buildPlanArtifactNode(
  file: File,
  position: { x: number; y: number },
  previewUrl: string | undefined,
  index: number,
): PlanSurfaceNode | null {
  if (!SUPPORTED_PLAN_ARTIFACT_MIME_TYPES.has(file.type)) return null;
  const artifactType = file.type === 'application/pdf' ? 'pdf' : 'image';
  return {
    id: `plan_artifact_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 8)}`,
    type: artifactType === 'pdf' ? 'planPdf' : 'planImage',
    position,
    data: {
      label: file.name,
      artifactType,
      fileName: file.name,
      mimeType: file.type,
      size: file.size,
      ...(previewUrl ? { previewUrl } : {}),
    },
    draggable: true,
    selectable: true,
  };
}

function resolveNodeStyle(node: PlanMissionFlowNode) {
  void node;
  return {
    borderRadius: 14,
    border: '1px solid transparent',
    background: 'transparent',
    color: GRAPH_THEME.drawer.inputText,
    fontSize: 12.5,
    lineHeight: 1.35,
    width: 260,
    minHeight: 104,
    padding: 0,
    boxShadow: 'none',
    backdropFilter: 'none',
    WebkitBackdropFilter: 'none',
  } as const;
}

export default function PlanMissionFlow({
  structuredPlan,
  missionGraph: missionGraphProp,
  projectId = null,
  compact = false,
  fullHeight = false,
  nodeOverrides,
  selectedNodeId = null,
  editMode = false,
  drawerLinked = false,
  onFocusChange,
  onGoGate,
  goGateStatus = null,
}: PlanMissionFlowProps) {
  const WALL_ORCH_ID = 'card_magentic';
  const flowHostRef = useRef<HTMLDivElement | null>(null);
  const objectUrlsRef = useRef<Set<string>>(new Set());
  const pendingConnectionRef = useRef<{
    nodeId: string | null;
    handleType: 'source' | 'target' | null;
  } | null>(null);
  const [reactFlowInstance, setReactFlowInstance] =
    useState<ReactFlowInstance | null>(null);
  const lastInitialFitKeyRef = useRef<string | null>(null);
  const restoredViewportRef = useRef<PlanLayoutViewport | null>(null);
  const hasPersistedLayoutRef = useRef(false);
  const skipNextLayoutPersistRef = useRef(false);
  const layoutHydratedRef = useRef(false);
  const planLayoutStorageKey = useMemo(
    () => buildPlanLayoutStorageKey(projectId),
    [projectId],
  );
  const missionGraph = useMemo(
    () => {
      const baseGraph = missionGraphProp || buildPlanMissionGraph(structuredPlan);
      if (!nodeOverrides || Object.keys(nodeOverrides).length === 0) {
        return baseGraph;
      }
      return {
        ...baseGraph,
        nodes: baseGraph.nodes.map((node) => {
          const override = nodeOverrides[node.id];
          if (!override) return node;
          return {
            ...node,
            data: {
              ...node.data,
              ...override,
            },
          };
        }),
      };
    },
    [missionGraphProp, nodeOverrides, structuredPlan],
  );
  const initialGuidedSceneModel = useMemo(
    () => buildDefaultPlanScenePath(),
    [],
  );
  const [planScenes, setPlanScenes] = useState<PlanScene[]>(
    initialGuidedSceneModel.scenes,
  );
  const [defaultScenePath, setDefaultScenePath] = useState<PlanScenePath>(
    initialGuidedSceneModel.defaultPath,
  );
  const guidedScenesById = useMemo(
    () =>
      new Map(
        planScenes.map((scene) => [scene.id, scene] as const),
      ),
    [planScenes],
  );
  const [activeSceneId, setActiveSceneId] = useState<string>(
    initialGuidedSceneModel.defaultPath.sceneIds[0] || '',
  );
  const [landingSceneId, setLandingSceneId] = useState<string>(
    initialGuidedSceneModel.defaultPath.sceneIds[0] || '',
  );
  const seededNodes = useMemo(() => {
    const missionNodes = missionGraph.nodes.map((node) => ({
      ...node,
      style: resolveNodeStyle(node),
      // Inject the SWAT approval-gate handler/status so the selected node's tray
      // can stage the step at the gate. Never an execution path.
      data: { ...node.data, onGoGate, goGateStatus },
    }));
    const wallNode = {
      id: WALL_ORCH_ID,
      type: 'wallAnchor',
      position: { x: -340, y: -80 },
      data: {},
      draggable: false,
      selectable: false,
      focusable: false,
    } as unknown as PlanMissionFlowNode;
    return [wallNode, ...missionNodes];
  }, [missionGraph.nodes, onGoGate, goGateStatus]);
  const [planSurfaceNodes, setPlanSurfaceNodes] = useState<PlanSurfaceNode[]>(
    [],
  );
  const combinedSeededNodes = useMemo(
    () => [...seededNodes, ...planSurfaceNodes],
    [planSurfaceNodes, seededNodes],
  );
  const [nodes, setNodes] = useNodesState(combinedSeededNodes);
  const [edges, setEdges] = useEdgesState<Edge<PlanMissionFlowEdgeData>>(
    missionGraph.edges,
  );
  const selectedMissionNode = useMemo(
    () =>
      nodes.find(
        (node) => Boolean(node.selected) && !isPlanSurfaceNode(node) && node.id !== WALL_ORCH_ID,
      ) || null,
    [WALL_ORCH_ID, nodes],
  );
  const selectedMissionData = selectedMissionNode?.data as PlanMissionNodeData | undefined;
  const initialFitKey = useMemo(
    () =>
      `${missionGraph.nodes.map((node) => node.id).join('|')}::${missionGraph.edges
        .map((edge) => edge.id)
        .join('|')}::${compact ? 'compact' : 'full'}::${fullHeight ? 'fullheight' : 'fixed'}`,
    [compact, fullHeight, missionGraph.edges, missionGraph.nodes],
  );

  useEffect(() => {
    layoutHydratedRef.current = false;
    restoredViewportRef.current = null;
    hasPersistedLayoutRef.current = false;
    const persisted = readPersistedPlanLayout(planLayoutStorageKey);
    const persistedPositions =
      persisted?.nodePositions && typeof persisted.nodePositions === 'object'
        ? persisted.nodePositions
        : null;
    if (persistedPositions) {
      hasPersistedLayoutRef.current = true;
      skipNextLayoutPersistRef.current = true;
      setNodes((current) =>
        current.map((node) => {
          const nextPosition = persistedPositions[node.id];
          if (!nextPosition) return node;
          return {
            ...node,
            position: {
              x: Number(nextPosition.x) || 0,
              y: Number(nextPosition.y) || 0,
            },
          };
        }),
      );
    }
    const persistedViewport = persisted?.viewport;
    if (
      persistedViewport &&
      Number.isFinite(persistedViewport.x) &&
      Number.isFinite(persistedViewport.y) &&
      Number.isFinite(persistedViewport.zoom)
    ) {
      hasPersistedLayoutRef.current = true;
      restoredViewportRef.current = persistedViewport;
    }
    layoutHydratedRef.current = true;
  }, [planLayoutStorageKey, setNodes]);

  useEffect(() => {
    if (!reactFlowInstance || !restoredViewportRef.current) return;
    reactFlowInstance.setViewport(restoredViewportRef.current, { duration: 0 });
    restoredViewportRef.current = null;
  }, [reactFlowInstance]);

  useEffect(() => {
    setActiveSceneId((current) =>
      defaultScenePath.sceneIds.includes(current)
        ? current
        : defaultScenePath.sceneIds[0] || '',
    );
    setLandingSceneId((current) =>
      defaultScenePath.sceneIds.includes(current)
        ? current
        : defaultScenePath.sceneIds[0] || '',
    );
  }, [defaultScenePath.sceneIds]);

  useEffect(() => {
    setNodes((current) => {
      const byId = new Map(current.map((node) => [node.id, node] as const));
      return combinedSeededNodes.map((node) => {
        const existing = byId.get(node.id);
        const selected = isPlanSurfaceNode(node)
          ? Boolean(existing?.selected)
          : Boolean(selectedNodeId && node.id === selectedNodeId);
        if (!existing) return { ...node, selected };
        return {
          ...node,
          position: existing.position,
          selected,
        };
      });
    });
  }, [combinedSeededNodes, selectedNodeId, setNodes]);

  useEffect(() => {
    return () => {
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      objectUrlsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    setEdges((current) => {
      if (current.length !== missionGraph.edges.length) return missionGraph.edges;
      for (let i = 0; i < current.length; i += 1) {
        const prev = current[i];
        const next = missionGraph.edges[i];
        if (
          prev.id !== next.id ||
          prev.source !== next.source ||
          prev.target !== next.target ||
          prev.className !== next.className
        ) {
          return missionGraph.edges;
        }
      }
      return current;
    });
  }, [missionGraph.edges, setEdges]);

  useEffect(() => {
    setNodes((current) =>
      current.map((node) => {
        const shouldBeSelected = Boolean(
          selectedNodeId && node.id === selectedNodeId,
        );
        if (Boolean(node.selected) === shouldBeSelected) return node;
        return {
          ...node,
          selected: shouldBeSelected,
        };
      }),
    );
  }, [selectedNodeId, setNodes]);

  useEffect(() => {
    if (!reactFlowInstance) return;
    if (hasPersistedLayoutRef.current) return;
    if (restoredViewportRef.current) return;
    if (lastInitialFitKeyRef.current === initialFitKey) return;
    lastInitialFitKeyRef.current = initialFitKey;
    let settleTimer: number | null = null;
    const applyFit = () => {
      const graphNodes = reactFlowInstance
        .getNodes()
        .filter((node) => node.id !== WALL_ORCH_ID);
      if (graphNodes.length === 0) return;
      reactFlowInstance.fitView({
        nodes: graphNodes,
        duration: 0,
        padding: compact ? 0.14 : 0.12,
        minZoom: compact ? 0.62 : 0.6,
        maxZoom: compact ? 0.78 : 0.84,
      });
    };
    const frame = window.requestAnimationFrame(() => {
      applyFit();
      settleTimer = window.setTimeout(() => {
        applyFit();
      }, 96);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (settleTimer != null) {
        window.clearTimeout(settleTimer);
      }
    };
  }, [
    WALL_ORCH_ID,
    compact,
    initialFitKey,
    nodes,
    reactFlowInstance,
  ]);

  useEffect(() => {
    if (!layoutHydratedRef.current) return;
    if (skipNextLayoutPersistRef.current) {
      skipNextLayoutPersistRef.current = false;
      return;
    }
    const persisted = readPersistedPlanLayout(planLayoutStorageKey) || {};
    const nodePositions = Object.fromEntries(
      nodes
        .filter((node) => node.id !== WALL_ORCH_ID)
        .map((node) => [node.id, { x: node.position.x, y: node.position.y }]),
    );
    persistPlanLayout(planLayoutStorageKey, {
      ...persisted,
      nodePositions,
    });
  }, [WALL_ORCH_ID, nodes, planLayoutStorageKey]);

  const persistViewportSnapshot = () => {
    if (!layoutHydratedRef.current || !reactFlowInstance) return;
    const persisted = readPersistedPlanLayout(planLayoutStorageKey) || {};
    persistPlanLayout(planLayoutStorageKey, {
      ...persisted,
      viewport: reactFlowInstance.getViewport(),
    });
  };

  const resetPlanView = () => {
    if (!reactFlowInstance) return;
    const positions = new Map(
      combinedSeededNodes.map((node) => [node.id, node.position] as const),
    );
    setNodes((current) =>
      current.map((node) => ({
        ...node,
        position: positions.get(node.id) || node.position,
      })),
    );
    if (planLayoutStorageKey && typeof window !== 'undefined') {
      window.localStorage.removeItem(planLayoutStorageKey);
    }
    window.requestAnimationFrame(() => {
      const graphNodes = reactFlowInstance
        .getNodes()
        .filter((node) => node.id !== WALL_ORCH_ID);
      reactFlowInstance.fitView({
        nodes: graphNodes,
        duration: GRAPH_THEME.nav.fitDurationMs,
        padding: 0.12,
        minZoom: compact ? 0.62 : 0.6,
        maxZoom: compact ? 0.78 : 0.84,
      });
    });
  };

  useEffect(() => {
    if (!reactFlowInstance || !editMode || !selectedNodeId) return;
    const selectedNode = nodes.find((node) => node.id === selectedNodeId);
    if (!selectedNode) return;
    reactFlowInstance.fitView({
      nodes: [selectedNode],
      duration: GRAPH_THEME.nav.focusDurationMs,
      padding: 0.34,
      minZoom: 0.66,
      maxZoom: 0.9,
    });
  }, [editMode, nodes, reactFlowInstance, selectedNodeId]);

  const visibleEdges = useMemo(() => {
    if (!editMode || !selectedNodeId) return edges;
    return edges.map((edge) => {
      const connected =
        edge.source === selectedNodeId || edge.target === selectedNodeId;
      const baseClass = String(edge.className || '');
      const classes = new Set(
        baseClass
          .split(' ')
          .map((entry) => entry.trim())
          .filter(Boolean),
      );
      if (connected) classes.delete('edge-muted');
      else classes.add('edge-muted');
      const nextClassName = Array.from(classes).join(' ');
      const sourceIsWallEndpoint = edge.source === WALL_ORCH_ID;
      const targetIsWallEndpoint = edge.target === WALL_ORCH_ID;
      const nextData = {
        ...((edge.data || {}) as Record<string, unknown>),
        sourceIsWallEndpoint,
        targetIsWallEndpoint,
      };
      if (
        nextClassName === baseClass &&
        (edge.data as Record<string, unknown> | undefined)?.sourceIsWallEndpoint === sourceIsWallEndpoint &&
        (edge.data as Record<string, unknown> | undefined)?.targetIsWallEndpoint === targetIsWallEndpoint
      ) {
        return edge;
      }
      return {
        ...edge,
        className: nextClassName,
        data: nextData as unknown as PlanMissionFlowEdgeData,
      };
    });
  }, [WALL_ORCH_ID, editMode, edges, selectedNodeId]);

  const onNodesChange = (changes: NodeChange[]) => {
    const hasSurfaceChange = changes.some((change) =>
      'id' in change && typeof change.id === 'string'
        ? isPlanSurfaceNode({ id: change.id })
        : false,
    );
    if (hasSurfaceChange) {
      setPlanSurfaceNodes((current) => {
        const next = applyNodeChanges(
          changes,
          current,
        ) as PlanSurfaceNode[];
        const nextIds = new Set(next.map((node) => node.id));
        current.forEach((node) => {
          if (nextIds.has(node.id)) return;
          const previewUrl = (node.data as PlanArtifactNodeData).previewUrl;
          if (!previewUrl) return;
          URL.revokeObjectURL(previewUrl);
          objectUrlsRef.current.delete(previewUrl);
        });
        return next;
      });
    }
    setNodes((current) => applyNodeChanges(changes, current) as typeof current);
    if (!onFocusChange) return;
    const selectedChange = [...changes]
      .reverse()
      .find(
        (change): change is NodeChange & { id: string; selected: boolean } =>
          change.type === 'select' &&
          'id' in change &&
          typeof change.id === 'string' &&
          Boolean((change as { selected?: boolean }).selected),
      );
    if (!selectedChange) {
      if (changes.some((change) => change.type === 'select')) onFocusChange(null);
      return;
    }
    const selectedNode = nodes.find((node) => node.id === selectedChange.id);
    onFocusChange(
      selectedNode && !isPlanSurfaceNode(selectedNode)
        ? toPlanMissionFocus(selectedNode as PlanMissionFlowNode)
        : null,
    );
  };

  const onEdgesChange = (changes: EdgeChange[]) => {
    setEdges((current) => applyEdgeChanges(changes, current) as typeof current);
  };

  const commitWallConnection = (connection: Connection) => {
    if (!connection.source || !connection.target) return;
    if (
      connection.source !== WALL_ORCH_ID &&
      connection.target !== WALL_ORCH_ID
    ) {
      return;
    }
    setEdges((current) =>
      addEdge(
        {
          ...connection,
          id: `plan_wall_${Math.random().toString(36).slice(2, 10)}`,
          type: 'turboFlow',
          className: 'edge-secondary',
          animated: false,
          data: {
            motion: 'active',
            sourceIsWallEndpoint: connection.source === WALL_ORCH_ID,
            targetIsWallEndpoint: connection.target === WALL_ORCH_ID,
          } as PlanMissionFlowEdgeData,
          style: { stroke: GRAPH_THEME.edge.neutral, strokeWidth: 1.45, opacity: 0.58 },
          markerEnd: 'agent-edge-circle',
        },
        current,
      ),
    );
  };

  const onConnect = (connection: Connection) => {
    commitWallConnection(connection);
    pendingConnectionRef.current = null;
  };

  const addPlanFrame = () => {
    if (!reactFlowInstance || !flowHostRef.current) return;
    const rect = flowHostRef.current.getBoundingClientRect();
    const position = reactFlowInstance.screenToFlowPosition({
      x: rect.left + rect.width / 2 - 240,
      y: rect.top + rect.height / 2 - 150,
    });
    const frameNode: PlanSurfaceNode = {
      id: `plan_frame_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'planFrame',
      position,
      data: {
        label: 'Plan Frame',
        mode: editMode ? 'edit' : 'landing',
        isLanding: !editMode,
      },
      draggable: true,
      selectable: true,
      zIndex: -1,
    };
    setPlanSurfaceNodes((current) => [...current, frameNode]);
  };

  const applyPlanScene = (scene: PlanScene) => {
    setActiveSceneId(scene.id);
    if (!reactFlowInstance || !scene.viewport) return;
    reactFlowInstance.setViewport(scene.viewport, {
      duration: GRAPH_THEME.nav.focusDurationMs,
    });
  };

  const setActiveSceneToCurrentView = () => {
    if (!reactFlowInstance || !activeSceneId) return;
    const viewport = reactFlowInstance.getViewport();
    setPlanScenes((current) =>
      current.map((scene) =>
        scene.id === activeSceneId ? { ...scene, viewport } : scene,
      ),
    );
  };

  const saveCurrentViewAsScene = () => {
    if (!reactFlowInstance) return;
    const viewport = reactFlowInstance.getViewport();
    const nextOrder = defaultScenePath.sceneIds.length + 1;
    const scene: PlanScene = {
      id: `scene_manual_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      label: `Scene ${nextOrder}`,
      viewport,
      frameId: null,
      purpose: 'next-step',
      speakerNote:
        'Manual scene captured from the current Plan viewport. Speaker notes can be generated later.',
    };
    setPlanScenes((current) => [...current, scene]);
    setDefaultScenePath((current) => ({
      ...current,
      sceneIds: [...current.sceneIds, scene.id],
      steps: [
        ...current.steps,
        {
          id: `${current.id}_step_${nextOrder}`,
          sceneId: scene.id,
          label: scene.label,
          order: nextOrder,
        },
      ],
    }));
    setActiveSceneId(scene.id);
  };

  const applySceneByOffset = (offset: number) => {
    if (defaultScenePath.sceneIds.length === 0) return;
    const currentIndex = Math.max(
      0,
      defaultScenePath.sceneIds.indexOf(activeSceneId),
    );
    const nextIndex =
      (currentIndex + offset + defaultScenePath.sceneIds.length) %
      defaultScenePath.sceneIds.length;
    const scene = guidedScenesById.get(defaultScenePath.sceneIds[nextIndex]);
    if (scene) applyPlanScene(scene);
  };

  const setActiveSceneAsLanding = () => {
    if (!activeSceneId) return;
    setLandingSceneId(activeSceneId);
  };

  const goToLandingScene = () => {
    const scene = guidedScenesById.get(landingSceneId);
    if (scene) applyPlanScene(scene);
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!reactFlowInstance) return;
    const files = Array.from(event.dataTransfer.files || []).filter((file) =>
      SUPPORTED_PLAN_ARTIFACT_MIME_TYPES.has(file.type),
    );
    if (files.length === 0) return;
    event.preventDefault();
    const basePosition = reactFlowInstance.screenToFlowPosition({
      x: event.clientX,
      y: event.clientY,
    });
    const droppedNodes = files
      .map((file, index) => {
        const previewUrl = file.type.startsWith('image/')
          ? URL.createObjectURL(file)
          : undefined;
        if (previewUrl) objectUrlsRef.current.add(previewUrl);
        return buildPlanArtifactNode(
          file,
          {
            x: basePosition.x + index * 24,
            y: basePosition.y + index * 24,
          },
          previewUrl,
          index,
        );
      })
      .filter(Boolean) as PlanSurfaceNode[];
    if (droppedNodes.length === 0) return;
    setPlanSurfaceNodes((current) => [...current, ...droppedNodes]);
  };

  const onConnectStart = (
    _event: unknown,
    params: { nodeId?: string | null; handleType?: 'source' | 'target' | null },
  ) => {
    pendingConnectionRef.current = {
      nodeId: params?.nodeId || null,
      handleType: params?.handleType || null,
    };
  };

  const onConnectEnd = (event: MouseEvent | TouchEvent) => {
    const pending = pendingConnectionRef.current;
    pendingConnectionRef.current = null;
    if (!pending?.nodeId || !pending.handleType) return;
    if (pending.nodeId === WALL_ORCH_ID) return;
    const host = flowHostRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const clientX =
      'clientX' in event
        ? event.clientX
        : event.changedTouches && event.changedTouches.length > 0
          ? event.changedTouches[0].clientX
          : null;
    if (clientX == null) return;
    if (Math.abs(clientX - rect.left) > 20) return;
    const wallConnection: Connection =
      pending.handleType === 'target'
        ? {
            source: WALL_ORCH_ID,
            target: pending.nodeId,
            sourceHandle: null,
            targetHandle: null,
          }
        : {
            source: pending.nodeId,
            target: WALL_ORCH_ID,
            sourceHandle: null,
            targetHandle: null,
          };
    commitWallConnection(wallConnection);
  };

  return (
    <div
      ref={flowHostRef}
      className="plan-flow"
      data-testid="plan-mission-flow"
      data-edit-mode={editMode ? 'true' : 'false'}
      data-has-focus={selectedNodeId ? 'true' : 'false'}
      data-drawer-linked={drawerLinked ? 'true' : 'false'}
      style={{
        height: fullHeight ? '100%' : compact ? 600 : 680,
        minHeight: fullHeight ? 300 : undefined,
        width: '100%',
        borderRadius: 0,
        border: 'none',
        background: GRAPH_THEME.background.agentSurface,
        boxShadow: 'none',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <style>{`
        .plan-flow .react-flow__node {
          transition: filter 180ms cubic-bezier(0.22, 1, 0.36, 1), transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .plan-flow .react-flow__node.selected {
          filter: drop-shadow(0 0 10px ${GRAPH_THEME.accent.primaryGlow});
        }
        .plan-flow[data-edit-mode="true"][data-has-focus="true"] .react-flow__node:not(.selected) {
          opacity: 0.68;
          filter: saturate(0.84) brightness(0.86);
        }
        .plan-flow[data-edit-mode="true"][data-has-focus="true"] .react-flow__node.selected {
          opacity: 1;
          filter: drop-shadow(0 0 11px ${GRAPH_THEME.accent.primaryGlow});
        }
        .plan-flow[data-edit-mode="true"][data-has-focus="true"][data-drawer-linked="true"] .react-flow__node.selected {
          filter: drop-shadow(0 0 13px ${GRAPH_THEME.accent.primaryGlow}) drop-shadow(0 0 6px ${GRAPH_THEME.accent.primarySoft});
        }
        .plan-flow .react-flow__edge.selected {
          filter: none;
        }
        .plan-flow[data-edit-mode="true"][data-has-focus="true"] .react-flow__edge.edge-muted {
          opacity: 0.18;
          filter: none;
        }
        .plan-flow .react-flow__handle {
          transition: transform 140ms ease, box-shadow 140ms ease, border-color 140ms ease;
        }
        .plan-flow .react-flow__handle:hover,
        .plan-flow .react-flow__handle.connectionindicator {
          transform: scale(1.06);
          box-shadow:
            0 0 0 2px ${GRAPH_THEME.accent.primarySoft},
            0 0 0 5px ${GRAPH_THEME.accent.solarSoft};
        }
        .plan-flow .react-flow__controls {
          background: ${GRAPH_THEME.controls.background};
          border: 1px solid ${GRAPH_THEME.controls.border};
          border-radius: 10px;
          box-shadow: ${GRAPH_THEME.controls.shadow};
          overflow: hidden;
        }
        .plan-flow .react-flow__controls-button {
          background: ${GRAPH_THEME.controls.background};
          border-bottom: 1px solid ${GRAPH_THEME.controls.border};
          color: ${GRAPH_THEME.controls.text};
        }
        .plan-flow .react-flow__controls-button:hover {
          background: ${GRAPH_THEME.controls.hoverBackground};
        }
        .plan-flow .react-flow__attribution {
          display: none;
        }
        .plan-flow .react-flow__node-mission {
          cursor: pointer;
        }
      `}</style>
      {selectedMissionNode && selectedMissionData ? (
        <aside
          aria-label="Selected PlanFlow node details"
          data-testid="planflow-node-details"
          style={{
            position: 'absolute',
            top: 14,
            right: 14,
            zIndex: 22,
            width: 300,
            maxHeight: 'calc(100% - 28px)',
            overflow: 'auto',
            padding: 14,
            borderRadius: 12,
            border: `1px solid ${GRAPH_THEME.accent.primaryBorder}`,
            background: 'rgba(11,14,18,0.96)',
            color: GRAPH_THEME.surface.text,
            boxShadow: '0 18px 44px rgba(0,0,0,0.34)',
          }}
        >
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', color: GRAPH_THEME.accent.primary }}>
            {String(selectedMissionData.kind || 'Task').toUpperCase()}
          </div>
          <div style={{ marginTop: 5, fontSize: 15, fontWeight: 750, lineHeight: 1.3 }}>
            {selectedMissionData.label}
          </div>
          <div style={{ marginTop: 12, display: 'grid', gap: 8, fontSize: 11.5 }}>
            {[
              ['Status', selectedMissionData.status],
              ['Source', selectedMissionData.source],
              ['Source path', selectedMissionData.sourcePath],
              ['Provenance', selectedMissionData.provenance],
            ].map(([label, value]) =>
              value ? (
                <div key={label}>
                  <div style={{ color: GRAPH_THEME.surface.mutedText, fontSize: 10 }}>{label}</div>
                  <div style={{ marginTop: 2, overflowWrap: 'anywhere' }}>{String(value)}</div>
                </div>
              ) : null,
            )}
            {selectedMissionData.description ? (
              <div>
                <div style={{ color: GRAPH_THEME.surface.mutedText, fontSize: 10 }}>Summary</div>
                <div style={{ marginTop: 2, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {selectedMissionData.description}
                </div>
              </div>
            ) : null}
            {selectedMissionData.kind === 'TaskLedger' ? (
              <>
                {(
                  [
                    ['factsResponse', selectedMissionData.factsResponse],
                    ['planResponse', selectedMissionData.planResponse],
                    ['taskLedgerResponse', selectedMissionData.taskLedgerResponse],
                    ['teamDescription', selectedMissionData.teamDescription],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label}>
                    <div style={{ color: GRAPH_THEME.surface.mutedText, fontSize: 10 }}>{label}</div>
                    <div style={{ marginTop: 2, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                      {String(value || '').trim() || 'missing'}
                    </div>
                  </div>
                ))}
                <div>
                  <div style={{ color: GRAPH_THEME.surface.mutedText, fontSize: 10 }}>raw artifact JSON</div>
                  <pre
                    style={{
                      marginTop: 2,
                      whiteSpace: 'pre-wrap',
                      overflowWrap: 'anywhere',
                      fontSize: 10.5,
                      lineHeight: 1.4,
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    }}
                  >
                    {String(selectedMissionData.payloadJson || '').trim() || 'missing'}
                  </pre>
                </div>
              </>
            ) : null}
            <div>
              <div style={{ color: GRAPH_THEME.surface.mutedText, fontSize: 10 }}>Linked nodes</div>
              <div style={{ marginTop: 2, overflowWrap: 'anywhere' }}>
                {(selectedMissionData.links || selectedMissionData.relatedObjects || []).join(', ') || 'None'}
              </div>
            </div>
          </div>
        </aside>
      ) : null}
      {drawerLinked ? (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: 16,
            right: 0,
            bottom: 16,
            width: 2,
            borderRadius: 999,
            background:
              'linear-gradient(180deg, rgba(55,173,170,0.08), rgba(55,173,170,0.28), rgba(55,173,170,0.08))',
            boxShadow: '0 0 18px rgba(55,173,170,0.18)',
            pointerEvents: 'none',
            zIndex: 2,
          }}
        />
      ) : null}
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
        <defs>
          <linearGradient
            id="agent-edge-gradient-intelligence"
            gradientUnits="userSpaceOnUse"
          >
            <stop
              offset="0%"
              stopColor={GRAPH_THEME.turboFlow.intelligenceGradientStart}
            />
            <stop
              offset="61.8%"
              stopColor={GRAPH_THEME.turboFlow.intelligenceGradientMid}
            />
            <stop
              offset="100%"
              stopColor={GRAPH_THEME.turboFlow.intelligenceGradientEnd}
            />
          </linearGradient>
          <linearGradient
            id="agent-edge-gradient-execution"
            gradientUnits="userSpaceOnUse"
          >
            <stop
              offset="0%"
              stopColor={GRAPH_THEME.turboFlow.executionGradientStart}
            />
            <stop
              offset="61.8%"
              stopColor={GRAPH_THEME.turboFlow.executionGradientMid}
            />
            <stop
              offset="100%"
              stopColor={GRAPH_THEME.turboFlow.executionGradientEnd}
            />
          </linearGradient>
          <linearGradient
            id="agent-edge-gradient-memory"
            gradientUnits="userSpaceOnUse"
          >
            <stop
              offset="0%"
              stopColor={GRAPH_THEME.turboFlow.memoryGradientStart}
            />
            <stop
              offset="61.8%"
              stopColor={GRAPH_THEME.turboFlow.memoryGradientMid}
            />
            <stop
              offset="100%"
              stopColor={GRAPH_THEME.turboFlow.memoryGradientEnd}
            />
          </linearGradient>
          <marker
            id="agent-edge-circle"
            viewBox="-5 -5 10 10"
            refX="0"
            refY="0"
            markerUnits="strokeWidth"
            markerWidth="10"
            markerHeight="10"
            orient="auto"
          >
            <circle
              stroke={GRAPH_THEME.turboFlow.markerStroke}
              strokeOpacity="0.9"
              r="2"
              cx="0"
              cy="0"
              fill="none"
            />
          </marker>
          <marker
            id="agent-edge-circle-hot"
            viewBox="-5 -5 10 10"
            refX="0"
            refY="0"
            markerUnits="strokeWidth"
            markerWidth="10"
            markerHeight="10"
            orient="auto"
          >
            <circle
              stroke={GRAPH_THEME.turboFlow.markerHotStroke}
              strokeOpacity="0.92"
              r="2"
              cx="0"
              cy="0"
              fill="none"
            />
          </marker>
        </defs>
      </svg>
      <div style={graphControlStackStyle}>
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() =>
            reactFlowInstance?.zoomIn({
              duration: GRAPH_THEME.nav.zoomDurationMs,
            })
          }
          style={graphControlButtonStyle({
            borderBottom: `1px solid ${GRAPH_THEME.controls.border}`,
          })}
        >
          +
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() =>
            reactFlowInstance?.zoomOut({
              duration: GRAPH_THEME.nav.zoomDurationMs,
            })
          }
          style={graphControlButtonStyle({
            borderBottom: `1px solid ${GRAPH_THEME.controls.border}`,
          })}
        >
          -
        </button>
        <button
          type="button"
          aria-label="Reset and fit PlanFlow view"
          title="Reset node layout and fit view"
          onClick={resetPlanView}
          style={graphControlButtonStyle()}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path
              d="M2.25 5.25V2.25h3M8.75 2.25h3v3M11.75 8.75v3h-3M5.25 11.75h-3v-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.25"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={visibleEdges}
        nodeTypes={missionNodeTypes}
        edgeTypes={missionEdgeTypes}
        onInit={setReactFlowInstance}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, node) => {
          setNodes((current) =>
            current.map((entry) => ({
              ...entry,
              selected: entry.id === node.id,
            })),
          );
          if (isPlanSurfaceNode(node)) {
            onFocusChange?.(null);
            return;
          }
          if (!onFocusChange) return;
          onFocusChange(toPlanMissionFocus(node as PlanMissionFlowNode));
        }}
        onPaneClick={() => {
          if (!onFocusChange) return;
          onFocusChange(null);
        }}
        onMoveEnd={persistViewportSnapshot}
        defaultViewport={{
          x: compact ? 56 : 72,
          y: compact ? 86 : 96,
          zoom: compact ? 0.62 : 0.72,
        }}
        minZoom={GRAPH_THEME.nav.minZoom}
        maxZoom={GRAPH_THEME.nav.maxZoom}
        nodesConnectable={false}
        nodesDraggable={!editMode}
        elementsSelectable
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onDragOver={onDragOver}
        onDrop={onDrop}
        edgesFocusable={false}
        edgesReconnectable={false}
        connectOnClick={false}
        zoomOnScroll={!editMode}
        zoomOnPinch={!editMode}
        panOnDrag={!editMode}
        connectionMode={ConnectionMode.Loose}
        snapToGrid
        snapGrid={[
          GRAPH_THEME.graphPaper.minorStep,
          GRAPH_THEME.graphPaper.minorStep,
        ]}
        proOptions={{ hideAttribution: true }}
        style={{
          background: 'transparent',
        }}
      >
        <Background
          variant={BackgroundVariant.Lines}
          gap={GRAPH_THEME.graphPaper.minorStep}
          size={GRAPH_THEME.graphPaper.lineWidth}
          color={GRAPH_THEME.background.gridMinor}
        />
        <Background
          variant={BackgroundVariant.Lines}
          gap={GRAPH_THEME.graphPaper.majorStep}
          size={GRAPH_THEME.graphPaper.lineWidth}
          color={GRAPH_THEME.background.gridMajor}
        />
        <Controls showInteractive={!editMode} />
      </ReactFlow>
    </div>
  );
}
