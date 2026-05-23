import React from 'react';
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Handle,
  Position,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  GRAPH_THEME,
  graphControlButtonStyle,
  graphControlStackStyle,
  graphDrawerButtonStyle,
  graphDrawerInputStyle,
  graphDrawerSectionStyle,
  graphGlassCardStyle,
} from '../../components/graph/graphVisualTokens';
import RightGlassDrawer from '../../components/graph/RightGlassDrawer';

type MediaStudioCanvasProps = {
  projectId?: string | null;
};

type NodeType = 'contextNode' | 'sceneNode' | 'framePackNode' | 'outputNode';
type SceneApproval = 'draft' | 'approved';
type FramePackApproval = 'draft' | 'approved';

type ContextNodeData = {
  title: string;
  sourceType: 'typed' | 'dropped';
  content: string;
};

type SceneNodeData = {
  title: string;
  description: string;
  order: number;
  approvalState: SceneApproval;
};

type FramePackNodeData = {
  sceneId: string;
  startImagePrompt: string;
  endImagePrompt: string;
  motionPrompt: string;
  negativePrompt: string;
  styleRules: string;
  continuityRules: string;
  startImageUrl: string;
  endImageUrl: string;
  approvalState: FramePackApproval;
};

type OutputNodeData = {
  videoUrl: string;
  status: string;
  notes: string;
};

type StoryboardNodeData =
  | ContextNodeData
  | SceneNodeData
  | FramePackNodeData
  | OutputNodeData;

type StoryboardNode = Node<StoryboardNodeData, NodeType>;
type EdgeSemantic = 'context_for' | 'next' | 'frame_pack_for' | 'output_of';
type StoryboardEdge = Edge<{
  lane?: 'story' | 'bridge' | 'output';
  semantic?: EdgeSemantic;
}>;

type SceneContextSummary = {
  id: string;
  title: string;
  description: string;
  order: number;
  approvalState: SceneApproval;
};

type ContextSummary = {
  id: string;
  title: string;
  sourceType: 'typed' | 'dropped';
  content: string;
};

type FramePackSummary = {
  id: string;
  data: FramePackNodeData;
};

type OutputSummary = {
  id: string;
  data: OutputNodeData;
};

export type VideoObjectChatContext = {
  selectedScene: SceneContextSummary | null;
  linkedContext: ContextSummary[];
  previousScene: SceneContextSummary | null;
  nextScene: SceneContextSummary | null;
  framePack: FramePackSummary | null;
  output: OutputSummary | null;
};

function resolveEdgeSemantic(
  sourceType: NodeType | undefined,
  targetType: NodeType | undefined,
): { semantic: EdgeSemantic; lane: 'story' | 'bridge' | 'output'; className: string } {
  if (sourceType === 'contextNode' && targetType === 'sceneNode') {
    return { semantic: 'context_for', lane: 'bridge', className: 'edge-secondary' };
  }
  if (sourceType === 'sceneNode' && targetType === 'sceneNode') {
    return { semantic: 'next', lane: 'story', className: 'edge-primary' };
  }
  if (sourceType === 'sceneNode' && targetType === 'framePackNode') {
    return { semantic: 'frame_pack_for', lane: 'bridge', className: 'edge-secondary' };
  }
  if (sourceType === 'framePackNode' && targetType === 'outputNode') {
    return { semantic: 'output_of', lane: 'output', className: 'edge-secondary' };
  }
  return { semantic: 'next', lane: 'bridge', className: 'edge-secondary' };
}

const NODE_ACCENT: Record<NodeType, string> = {
  contextNode: GRAPH_THEME.edge.know,
  sceneNode: GRAPH_THEME.accent.primary,
  framePackNode: GRAPH_THEME.accent.workflow,
  outputNode: GRAPH_THEME.accent.primary,
};

const initialNodes: StoryboardNode[] = [
  {
    id: 'context-1',
    type: 'contextNode',
    position: { x: 90, y: 120 },
    data: {
      title: 'Launch concept',
      sourceType: 'typed',
      content:
        'A rooftop teaser at sunset. Show confidence and momentum. End on logo lockup.',
    },
  },
  {
    id: 'scene-1',
    type: 'sceneNode',
    position: { x: 380, y: 80 },
    data: {
      title: 'Arrival shot',
      description: 'Subject steps into frame with skyline in the background.',
      order: 1,
      approvalState: 'approved',
    },
  },
  {
    id: 'scene-2',
    type: 'sceneNode',
    position: { x: 380, y: 240 },
    data: {
      title: 'Reveal shot',
      description: 'Camera settles on the final hero framing and CTA.',
      order: 2,
      approvalState: 'draft',
    },
  },
  {
    id: 'frame-pack-1',
    type: 'framePackNode',
    position: { x: 700, y: 80 },
    data: {
      sceneId: 'scene-1',
      startImagePrompt: 'Subject entering frame, warm sunset light, city skyline.',
      endImagePrompt: 'Subject centered, confident stance, logo hint in background.',
      motionPrompt:
        'Smooth push-in from wide to medium while preserving identity and lighting.',
      negativePrompt: 'warping, duplicate limbs, inconsistent identity',
      styleRules: 'cinematic realism, clean gradients, natural skin tones',
      continuityRules: 'keep outfit details and skyline geometry consistent',
      startImageUrl: '',
      endImageUrl: '',
      approvalState: 'draft',
    },
  },
  {
    id: 'output-1',
    type: 'outputNode',
    position: { x: 1020, y: 80 },
    data: {
      videoUrl: '',
      status: 'waiting_for_approved_image_pair',
      notes: '',
    },
  },
];

const initialEdges: StoryboardEdge[] = [
  {
    id: 'context-1-scene-1',
    source: 'context-1',
    target: 'scene-1',
    data: { lane: 'bridge', semantic: 'context_for' },
    className: 'edge-secondary',
  },
  {
    id: 'scene-1-scene-2',
    source: 'scene-1',
    target: 'scene-2',
    data: { lane: 'story', semantic: 'next' },
    className: 'edge-primary',
  },
  {
    id: 'scene-1-frame-pack-1',
    source: 'scene-1',
    target: 'frame-pack-1',
    data: { lane: 'bridge', semantic: 'frame_pack_for' },
    className: 'edge-secondary',
  },
  {
    id: 'frame-pack-1-output-1',
    source: 'frame-pack-1',
    target: 'output-1',
    data: { lane: 'output', semantic: 'output_of' },
    className: 'edge-secondary',
  },
];

function parseStoryboardSceneLines(content: string): string[] {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^\d+[\).\-\s]+/, '').trim())
    .filter(Boolean);
}

function asSceneSummary(node: StoryboardNode): SceneContextSummary {
  const data = node.data as SceneNodeData;
  return {
    id: node.id,
    title: data.title,
    description: data.description,
    order: data.order,
    approvalState: data.approvalState,
  };
}

function toSceneNode(node: StoryboardNode | undefined): StoryboardNode | null {
  if (!node || node.type !== 'sceneNode') return null;
  return node;
}

export function buildVideoObjectChatContext(
  selectedNodeId: string | null,
  nodes: StoryboardNode[],
  edges: StoryboardEdge[],
): VideoObjectChatContext {
  if (!selectedNodeId) {
    return {
      selectedScene: null,
      linkedContext: [],
      previousScene: null,
      nextScene: null,
      framePack: null,
      output: null,
    };
  }

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const selected = byId.get(selectedNodeId) ?? null;
  let selectedSceneNode: StoryboardNode | null = null;

  if (selected?.type === 'sceneNode') {
    selectedSceneNode = selected;
  } else if (selected?.type === 'framePackNode') {
    const sceneEdge = edges.find(
      (edge) => edge.target === selected.id && toSceneNode(byId.get(edge.source)),
    );
    selectedSceneNode = sceneEdge ? (byId.get(sceneEdge.source) as StoryboardNode) : null;
  } else if (selected?.type === 'outputNode') {
    const framePackEdge = edges.find(
      (edge) => edge.target === selected.id && byId.get(edge.source)?.type === 'framePackNode',
    );
    if (framePackEdge) {
      const sceneEdge = edges.find(
        (edge) =>
          edge.target === framePackEdge.source && toSceneNode(byId.get(edge.source)),
      );
      selectedSceneNode = sceneEdge ? (byId.get(sceneEdge.source) as StoryboardNode) : null;
    }
  } else if (selected?.type === 'contextNode') {
    const firstSceneEdge = edges.find(
      (edge) => edge.source === selected.id && toSceneNode(byId.get(edge.target)),
    );
    selectedSceneNode = firstSceneEdge
      ? (byId.get(firstSceneEdge.target) as StoryboardNode)
      : null;
  }

  if (!selectedSceneNode) {
    return {
      selectedScene: null,
      linkedContext: [],
      previousScene: null,
      nextScene: null,
      framePack: null,
      output: null,
    };
  }

  const selectedScene = asSceneSummary(selectedSceneNode);
  const linkedContext = edges
    .filter((edge) => edge.target === selectedScene.id)
    .map((edge) => byId.get(edge.source))
    .filter((node): node is StoryboardNode => Boolean(node))
    .filter((node) => node.type === 'contextNode')
    .map((node) => {
      const data = node.data as ContextNodeData;
      return {
        id: node.id,
        title: data.title,
        sourceType: data.sourceType,
        content: data.content,
      };
    });

  const previousSceneNode = edges
    .map((edge) => (edge.target === selectedScene.id ? byId.get(edge.source) : null))
    .find((node) => node?.type === 'sceneNode');
  const nextSceneNode = edges
    .map((edge) => (edge.source === selectedScene.id ? byId.get(edge.target) : null))
    .find((node) => node?.type === 'sceneNode');

  const framePackNode = edges
    .map((edge) => (edge.source === selectedScene.id ? byId.get(edge.target) : null))
    .find((node) => node?.type === 'framePackNode');
  const outputNode =
    framePackNode
      ? edges
          .map((edge) =>
            edge.source === framePackNode.id ? byId.get(edge.target) : null,
          )
          .find((node) => node?.type === 'outputNode')
      : null;

  return {
    selectedScene,
    linkedContext,
    previousScene: previousSceneNode
      ? asSceneSummary(previousSceneNode as StoryboardNode)
      : null,
    nextScene: nextSceneNode ? asSceneSummary(nextSceneNode as StoryboardNode) : null,
    framePack: framePackNode
      ? { id: framePackNode.id, data: framePackNode.data as FramePackNodeData }
      : null,
    output: outputNode
      ? { id: outputNode.id, data: outputNode.data as OutputNodeData }
      : null,
  };
}

export function buildVideoSceneChatContext(
  selectedNodeId: string | null,
  nodes: StoryboardNode[],
  edges: StoryboardEdge[],
): VideoObjectChatContext {
  return buildVideoObjectChatContext(selectedNodeId, nodes, edges);
}

function getSceneTitle(node: StoryboardNode): string {
  if (node.type === 'contextNode') {
    const data = node.data as ContextNodeData;
    return data.title ? `Source: ${data.title}` : 'Source';
  }
  if (node.type === 'framePackNode') {
    const data = node.data as FramePackNodeData;
    return data.sceneId ? `Image Pair: ${data.sceneId}` : 'Image Pair';
  }
  if (node.type === 'outputNode') {
    const data = node.data as OutputNodeData;
    return data.videoUrl ? 'Clip: linked' : 'Clip';
  }
  const data = node.data as SceneNodeData;
  return `Scene ${data.order}: ${data.title || 'Untitled'}`;
}

function getNodeSummary(node: StoryboardNode): string {
  if (node.type === 'contextNode') {
    const data = node.data as ContextNodeData;
    return data.content ? 'material attached' : 'add material';
  }
  if (node.type === 'sceneNode') {
    const data = node.data as SceneNodeData;
    return `${data.approvalState} · ${data.description || 'Describe this scene'}`;
  }
  if (node.type === 'framePackNode') {
    const data = node.data as FramePackNodeData;
    return `${data.approvalState} · image pair + motion`;
  }
  const data = node.data as OutputNodeData;
  return data.videoUrl ? 'clip linked' : 'no clip link';
}

function NodeCard({
  id,
  type,
  data,
  selected,
}: NodeProps<StoryboardNode>): React.ReactElement {
  const node = { id, type, data, position: { x: 0, y: 0 } } as StoryboardNode;
  const accent = NODE_ACCENT[type as NodeType];
  return (
    <div
      style={graphGlassCardStyle({
        width: 236,
        minHeight: 102,
        padding: '10px 11px',
        borderRadius: 12,
        border: selected
          ? `1px solid ${GRAPH_THEME.accent.primaryBorder}`
          : `1px solid ${GRAPH_THEME.card.glassBorder}`,
        boxShadow: selected
          ? `${GRAPH_THEME.card.glassInset}, 0 0 0 1px ${GRAPH_THEME.accent.primaryBorder}, 0 14px 28px ${GRAPH_THEME.accent.primaryGlow}`
          : `${GRAPH_THEME.card.glassInset}, ${GRAPH_THEME.surface.shadow}`,
        display: 'grid',
        gap: 6,
      })}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          border: `1px solid ${GRAPH_THEME.accent.primaryBorder}`,
          background: GRAPH_THEME.background.agentSurface,
          left: -5,
        }}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          border: `1px solid ${GRAPH_THEME.accent.primaryBorder}`,
          background: GRAPH_THEME.background.agentSurface,
          right: -5,
        }}
      />
      <div
        style={{
          height: 3,
          borderRadius: 999,
          background: accent,
          opacity: 0.86,
        }}
      />
      <div
        style={{
          fontSize: 14,
          fontWeight: 700,
          lineHeight: 1.2,
          color: GRAPH_THEME.surface.text,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {getSceneTitle(node)}
      </div>
      <div
        style={{
          fontSize: 11,
          lineHeight: 1.35,
          color: GRAPH_THEME.surface.mutedText,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {getNodeSummary(node)}
      </div>
    </div>
  );
}

const nodeTypes = {
  contextNode: NodeCard,
  sceneNode: NodeCard,
  framePackNode: NodeCard,
  outputNode: NodeCard,
};

function ActionButton({
  label,
  onClick,
  disabled = false,
  title,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={graphDrawerButtonStyle({
        padding: '6px 9px',
        borderRadius: 7,
        fontSize: 11,
        lineHeight: 1.2,
        color: disabled ? GRAPH_THEME.drawer.inputMuted : GRAPH_THEME.drawer.inputText,
        opacity: disabled ? 0.72 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      })}
    >
      {label}
    </button>
  );
}

function getMaxSceneOrder(nodes: StoryboardNode[]): number {
  return nodes
    .filter((node) => node.type === 'sceneNode')
    .reduce((max, node) => {
      const order = (node.data as SceneNodeData).order;
      return order > max ? order : max;
    }, 0);
}

function normalizeSceneOrder(nodes: StoryboardNode[]): StoryboardNode[] {
  const sceneNodes = nodes
    .filter((node) => node.type === 'sceneNode')
    .slice()
    .sort((a, b) => {
      const aData = a.data as SceneNodeData;
      const bData = b.data as SceneNodeData;
      return aData.order - bData.order;
    });
  const orderMap = new Map<string, number>();
  sceneNodes.forEach((node, index) => orderMap.set(node.id, index + 1));
  return nodes.map((node) => {
    if (node.type !== 'sceneNode') return node;
    const data = node.data as SceneNodeData;
    return { ...node, data: { ...data, order: orderMap.get(node.id) ?? data.order } };
  });
}

function sceneNodesInOrder(nodes: StoryboardNode[]): StoryboardNode[] {
  return nodes
    .filter((node) => node.type === 'sceneNode')
    .slice()
    .sort((a, b) => {
      const aData = a.data as SceneNodeData;
      const bData = b.data as SceneNodeData;
      return aData.order - bData.order;
    });
}

export default function MediaStudioCanvas({
  projectId = null,
}: MediaStudioCanvasProps): React.ReactElement {
  void projectId;
  const [nodes, setNodes, onNodesChange] = useNodesState<StoryboardNode>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<StoryboardEdge>(initialEdges);
  const [selectedNodeId, setSelectedNodeId] = React.useState<string>('');
  const [lastSceneSelectionId, setLastSceneSelectionId] = React.useState<string>('scene-1');
  const [actionStatus, setActionStatus] = React.useState<string | null>(null);
  const [addMenuOpen, setAddMenuOpen] = React.useState(false);
  const [reactFlowInstance, setReactFlowInstance] = React.useState<
    ReactFlowInstance<StoryboardNode, StoryboardEdge> | null
  >(null);
  const nextNodeIdRef = React.useRef(3);
  const hasInitialFitRef = React.useRef(false);
  const addMenuRef = React.useRef<HTMLDivElement | null>(null);

  const selectedNode = React.useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );
  const selectedChatContext = React.useMemo(
    () => buildVideoObjectChatContext(selectedNodeId, nodes, edges),
    [selectedNodeId, nodes, edges],
  );
  void selectedChatContext;

  const onConnect = React.useCallback(
    (connection: Connection) => {
      const sourceType = nodes.find((node) => node.id === connection.source)?.type;
      const targetType = nodes.find((node) => node.id === connection.target)?.type;
      const semantic = resolveEdgeSemantic(sourceType, targetType);
      setEdges((currentEdges) =>
        addEdge(
          {
            ...connection,
            type: 'smoothstep',
            markerEnd: 'agent-edge-circle',
            data: { lane: semantic.lane, semantic: semantic.semantic },
            className: semantic.className,
            style: { stroke: GRAPH_THEME.edge.neutral, strokeWidth: 1.5, opacity: 0.7 },
          },
          currentEdges,
        ),
      );
    },
    [nodes, setEdges],
  );

  React.useEffect(() => {
    if (!reactFlowInstance) return;
    if (hasInitialFitRef.current) return;
    hasInitialFitRef.current = true;
    const frame = window.requestAnimationFrame(() => {
      reactFlowInstance.fitView({
        padding: GRAPH_THEME.nav.fitPadding,
        minZoom: GRAPH_THEME.nav.minZoom,
        maxZoom: GRAPH_THEME.nav.fitMaxZoom,
        duration: 0,
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [reactFlowInstance]);

  React.useEffect(() => {
    if (!addMenuOpen) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!target) return;
      if (addMenuRef.current?.contains(target as globalThis.Node)) return;
      setAddMenuOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [addMenuOpen]);

  const createContextNode = React.useCallback(
    (title: string, sourceType: 'typed' | 'dropped', content: string) => {
      const id = `context-${nextNodeIdRef.current}`;
      nextNodeIdRef.current += 1;
      const yOffset = 100 + (nextNodeIdRef.current % 5) * 56;
      const newNode: StoryboardNode = {
        id,
        type: 'contextNode',
        position: { x: 90, y: yOffset },
        data: { title, sourceType, content },
      };
      setNodes((current) => [...current, newNode]);
      setSelectedNodeId(id);
      return newNode;
    },
    [setNodes],
  );

  const addSceneNode = React.useCallback(() => {
    setNodes((currentNodes) => {
      const orderedScenes = sceneNodesInOrder(currentNodes);
      const nextOrder = getMaxSceneOrder(currentNodes) + 1;
      const id = `scene-${nextNodeIdRef.current}`;
      nextNodeIdRef.current += 1;
      const sceneNode: StoryboardNode = {
        id,
        type: 'sceneNode',
        position: { x: 380, y: 80 + (nextOrder - 1) * 150 },
        data: {
          title: `Scene ${nextOrder}`,
          description: '',
          order: nextOrder,
          approvalState: 'draft',
        },
      };
      const previousScene = orderedScenes[orderedScenes.length - 1];
      setEdges((currentEdges) => {
        if (!previousScene) return currentEdges;
        const linkId = `${previousScene.id}-${sceneNode.id}`;
        if (currentEdges.some((edge) => edge.id === linkId)) return currentEdges;
        return [
          ...currentEdges,
          {
            id: linkId,
            source: previousScene.id,
            target: sceneNode.id,
            data: { lane: 'story', semantic: 'next' },
            className: 'edge-primary',
          },
        ];
      });
      setSelectedNodeId(id);
      return [...currentNodes, sceneNode];
    });
  }, [setEdges, setNodes]);
  const createImagePairFromScene = React.useCallback(() => {
    const selectedScene =
      selectedNode?.type === 'sceneNode'
        ? selectedNode
        : nodes.find((node) => node.id === lastSceneSelectionId && node.type === 'sceneNode') ?? null;
    if (!selectedScene) {
      setActionStatus('Select an approved Scene first.');
      return;
    }
    const sceneData = selectedScene.data as SceneNodeData;
    if (sceneData.approvalState !== 'approved') {
      setActionStatus('Approve the Scene before creating an Image Pair.');
      return;
    }
    const existingPair = edges.some(
      (edge) =>
        edge.source === selectedScene.id &&
        nodes.find((node) => node.id === edge.target)?.type === 'framePackNode',
    );
    if (existingPair) {
      setActionStatus('This Scene already has an Image Pair.');
      return;
    }
    const id = `image-pair-${nextNodeIdRef.current}`;
    nextNodeIdRef.current += 1;
    const newPair: StoryboardNode = {
      id,
      type: 'framePackNode',
      position: {
        x: (selectedScene.position.x || 380) + 320,
        y: selectedScene.position.y || 120,
      },
      data: {
        sceneId: selectedScene.id,
        startImagePrompt: '',
        endImagePrompt: '',
        motionPrompt: '',
        negativePrompt: '',
        styleRules: '',
        continuityRules: '',
        startImageUrl: '',
        endImageUrl: '',
        approvalState: 'draft',
      },
    };
    setNodes((current) => [...current, newPair]);
    setEdges((current) => [
      ...current,
      {
        id: `${selectedScene.id}-${id}`,
        source: selectedScene.id,
        target: id,
        data: { lane: 'bridge', semantic: 'frame_pack_for' },
        className: 'edge-secondary',
      },
    ]);
    setSelectedNodeId(id);
    setActionStatus('Image Pair created.');
  }, [edges, lastSceneSelectionId, nodes, selectedNode, setEdges, setNodes]);

  const addClipNode = React.useCallback(() => {
    const selectedPair =
      selectedNode?.type === 'framePackNode'
        ? selectedNode
        : nodes.find((node) => node.type === 'framePackNode') ?? null;
    const selectedScene =
      selectedNode?.type === 'sceneNode'
        ? selectedNode
        : sceneNodesInOrder(nodes)[0] ?? null;
    const parent = selectedPair ?? selectedScene;
    if (!parent) return;
    const id = `clip-${nextNodeIdRef.current}`;
    nextNodeIdRef.current += 1;
    const newClip: StoryboardNode = {
      id,
      type: 'outputNode',
      position: {
        x: (parent.position.x || 700) + 320,
        y: parent.position.y || 120,
      },
      data: {
        videoUrl: '',
        status: 'waiting',
        notes: '',
      },
    };
    setNodes((current) => [...current, newClip]);
    setEdges((current) => [
      ...current,
      {
        id: `${parent.id}-${id}`,
        source: parent.id,
        target: id,
        data: { lane: 'output', semantic: 'output_of' },
        className: 'edge-secondary',
      },
    ]);
    setSelectedNodeId(id);
  }, [nodes, selectedNode, setEdges, setNodes]);

  const onDropContext: React.DragEventHandler<HTMLDivElement> = React.useCallback(
    (event) => {
      event.preventDefault();
      const plainText = event.dataTransfer.getData('text/plain').trim();
      const fileName = event.dataTransfer.files[0]?.name ?? '';
      if (!plainText && !fileName) return;
      const title = fileName || 'Dropped source';
      const content = plainText || `Dropped file: ${fileName}`;
      createContextNode(title, 'dropped', content);
      setActionStatus('Source added from drop.');
    },
    [createContextNode],
  );

  const createStoryboardFromSource = React.useCallback(() => {
    const selectedSource =
      selectedNode?.type === 'contextNode'
        ? selectedNode
        : nodes.find((node) => node.type === 'contextNode') ?? null;
    if (!selectedSource) {
      setActionStatus('Add or select a Source first.');
      return;
    }
    const sourceData = selectedSource.data as ContextNodeData;
    const sceneLines = parseStoryboardSceneLines(sourceData.content);
    if (sceneLines.length === 0) {
      setActionStatus('Source has no scene lines to convert.');
      return;
    }

    setNodes((currentNodes) => {
      const nextNodes: StoryboardNode[] = [...currentNodes];
      const startOrder = getMaxSceneOrder(currentNodes);
      const createdSceneIds: string[] = [];
      sceneLines.forEach((line, index) => {
        const sceneOrder = startOrder + index + 1;
        const id = `scene-${nextNodeIdRef.current}`;
        nextNodeIdRef.current += 1;
        nextNodes.push({
          id,
          type: 'sceneNode',
          position: { x: 380, y: 80 + (sceneOrder - 1) * 150 },
          data: {
            title: line.slice(0, 44) || `Scene ${sceneOrder}`,
            description: line,
            order: sceneOrder,
            approvalState: 'draft',
          },
        });
        createdSceneIds.push(id);
      });

      setEdges((currentEdges) => {
        const appendedEdges = [...currentEdges];
        if (createdSceneIds.length > 0) {
          const sourceLinkId = `${selectedSource.id}-${createdSceneIds[0]}`;
          if (!appendedEdges.some((edge) => edge.id === sourceLinkId)) {
            appendedEdges.push({
              id: sourceLinkId,
              source: selectedSource.id,
              target: createdSceneIds[0],
              data: { lane: 'bridge', semantic: 'context_for' },
              className: 'edge-secondary',
            });
          }
        }
        for (let index = 0; index < createdSceneIds.length - 1; index += 1) {
          const source = createdSceneIds[index];
          const target = createdSceneIds[index + 1];
          const id = `${source}-${target}`;
          if (!appendedEdges.some((edge) => edge.id === id)) {
            appendedEdges.push({
              id,
              source,
              target,
              data: { lane: 'story', semantic: 'next' },
              className: 'edge-primary',
            });
          }
        }
        return appendedEdges;
      });
      if (createdSceneIds[0]) {
        setSelectedNodeId(createdSceneIds[0]);
        setLastSceneSelectionId(createdSceneIds[0]);
      }
      setActionStatus(`Created ${createdSceneIds.length} Scene node(s).`);
      return normalizeSceneOrder(nextNodes);
    });
  }, [nodes, selectedNode, setEdges, setNodes]);

  const updateSelectedNodeData = React.useCallback(
    (patch: Partial<StoryboardNodeData>) => {
      if (!selectedNode) return;
      setNodes((currentNodes) =>
        currentNodes.map((node) =>
          node.id === selectedNode.id
            ? { ...node, data: { ...node.data, ...patch } as StoryboardNodeData }
            : node,
        ),
      );
    },
    [selectedNode, setNodes],
  );

  const selectedSceneData =
    selectedNode?.type === 'sceneNode' ? (selectedNode.data as SceneNodeData) : null;

  const copyToClipboard = React.useCallback(
    async (value: string, successMessage: string, emptyMessage: string) => {
      if (!value.trim()) {
        setActionStatus(emptyMessage);
        return;
      }
      const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
      if (!clipboard?.writeText) {
        setActionStatus('Clipboard unavailable.');
        return;
      }
      try {
        await clipboard.writeText(value);
        setActionStatus(successMessage);
      } catch {
        setActionStatus('Clipboard copy failed.');
      }
    },
    [],
  );

  const approveSelectedScene = React.useCallback(() => {
    if (!selectedNode || selectedNode.type !== 'sceneNode') return;
    const sceneData = selectedNode.data as SceneNodeData;
    if (sceneData.approvalState === 'approved') {
      setActionStatus('Scene already approved.');
      return;
    }
    updateSelectedNodeData({ approvalState: 'approved' });
    setActionStatus('Scene approved.');
  }, [selectedNode, updateSelectedNodeData]);

  return (
    <div
      data-testid="video-workspace-placeholder"
      className="video-storyboard-flow"
      data-shared-canvas-theme="graph-paper"
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDropContext}
      style={{
        height: '100%',
        minHeight: 0,
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr)',
        background: GRAPH_THEME.background.agentSurface,
        color: GRAPH_THEME.surface.text,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <style>{`
        .video-storyboard-flow .react-flow__node {
          transition: filter 180ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .video-storyboard-flow .react-flow__node.selected {
          filter: drop-shadow(0 0 7px ${GRAPH_THEME.accent.primaryGlow});
        }
        .video-storyboard-flow .react-flow__edge {
          transition: opacity 180ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .video-storyboard-flow .react-flow__edge-text {
          fill: ${GRAPH_THEME.surface.mutedText};
          font-size: 10px;
          letter-spacing: 0.02em;
          text-transform: lowercase;
        }
        .video-storyboard-flow .react-flow__edge.edge-primary .react-flow__edge-path {
          stroke: ${GRAPH_THEME.accent.primary};
          stroke-width: 1.9;
          opacity: 0.9;
        }
        .video-storyboard-flow .react-flow__edge.edge-secondary .react-flow__edge-path {
          stroke: ${GRAPH_THEME.edge.neutral};
          stroke-width: 1.45;
          opacity: 0.68;
        }
        .video-storyboard-flow .react-flow__handle {
          transition: transform 140ms ease, box-shadow 140ms ease, border-color 140ms ease;
        }
        .video-storyboard-flow .react-flow__handle:hover,
        .video-storyboard-flow .react-flow__handle.connectionindicator {
          transform: scale(1.06);
          box-shadow:
            0 0 0 2px ${GRAPH_THEME.accent.primarySoft},
            0 0 0 5px ${GRAPH_THEME.accent.solarSoft};
        }
        .video-storyboard-flow .react-flow__connection-path {
          stroke: ${GRAPH_THEME.accent.primary};
          stroke-width: 2.2;
        }
        .video-storyboard-flow .react-flow__controls,
        .video-storyboard-flow .react-flow__minimap {
          background: ${GRAPH_THEME.controls.background};
          border: 1px solid ${GRAPH_THEME.controls.border};
          border-radius: 10px;
          box-shadow: ${GRAPH_THEME.controls.shadow};
          overflow: hidden;
        }
        .video-storyboard-flow .react-flow__controls-button {
          background: ${GRAPH_THEME.controls.background};
          border-bottom: 1px solid ${GRAPH_THEME.controls.border};
          color: ${GRAPH_THEME.controls.text};
        }
        .video-storyboard-flow .react-flow__controls-button:hover {
          background: ${GRAPH_THEME.controls.hoverBackground};
        }
        .video-storyboard-flow .react-flow__attribution {
          display: none;
        }
      `}</style>

      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
        <defs>
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
        </defs>
      </svg>

      <main style={{ minWidth: 0, minHeight: 0, display: 'grid', gridTemplateRows: 'auto 1fr' }}>
        <div
          style={{
            ...graphDrawerSectionStyle({
              borderRadius: 0,
              border: 'none',
              borderBottom: `1px solid ${GRAPH_THEME.drawer.sectionBorder}`,
              background: GRAPH_THEME.drawer.tabRailBackground,
              padding: '8px 10px',
            }),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <div ref={addMenuRef} style={{ position: 'relative' }}>
            <button
              type="button"
              aria-label="Add storyboard object"
              data-testid="storyboard-add-control"
              onClick={() => setAddMenuOpen((open) => !open)}
              style={graphDrawerButtonStyle({
                width: 28,
                height: 28,
                padding: 0,
                borderRadius: 999,
                fontSize: 18,
                lineHeight: 1,
                fontWeight: 600,
                color: GRAPH_THEME.drawer.inputText,
              })}
            >
              +
            </button>
            {addMenuOpen ? (
              <div
                style={graphDrawerSectionStyle({
                  position: 'absolute',
                  top: 32,
                  left: 0,
                  minWidth: 148,
                  padding: 6,
                  zIndex: 12,
                  display: 'grid',
                  gap: 4,
                })}
              >
                <ActionButton
                  label="Add Source"
                  onClick={() => {
                    createContextNode('New source', 'typed', '');
                    setAddMenuOpen(false);
                  }}
                />
                <ActionButton
                  label="Add Scene"
                  onClick={() => {
                    addSceneNode();
                    setAddMenuOpen(false);
                  }}
                />
                <ActionButton
                  label="Add Image Pair"
                  onClick={() => {
                    createImagePairFromScene();
                    setAddMenuOpen(false);
                  }}
                />
                <ActionButton
                  label="Add Clip"
                  onClick={() => {
                    addClipNode();
                    setAddMenuOpen(false);
                  }}
                />
              </div>
            ) : null}
          </div>
        </div>

        <div style={{ minHeight: 0, position: 'relative' }}>
          {nodes.length === 0 ? (
            <div
              style={{
                position: 'absolute',
                left: 16,
                bottom: 14,
                zIndex: 6,
                ...graphDrawerSectionStyle({
                  padding: '6px 9px',
                  borderRadius: 999,
                }),
                fontSize: 11,
                color: GRAPH_THEME.drawer.inputMuted,
                pointerEvents: 'none',
              }}
            >
              Drop source or ask chat.
            </div>
          ) : null}
          <div style={{ ...graphControlStackStyle, left: 'auto', right: 16 }}>
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
              aria-label="Fit view"
              onClick={() =>
                reactFlowInstance?.fitView({
                  duration: GRAPH_THEME.nav.fitDurationMs,
                  padding: 0.22,
                  minZoom: GRAPH_THEME.nav.minZoom,
                  maxZoom: GRAPH_THEME.nav.fitMaxZoom,
                })
              }
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

          <ReactFlow<StoryboardNode, StoryboardEdge>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onInit={setReactFlowInstance}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => {
              setSelectedNodeId(node.id);
              if (node.type === 'sceneNode') setLastSceneSelectionId(node.id);
              setAddMenuOpen(false);
            }}
            onPaneClick={() => {
              setSelectedNodeId('');
              setAddMenuOpen(false);
            }}
            defaultEdgeOptions={{
              type: 'smoothstep',
              markerEnd: 'agent-edge-circle',
              selectable: true,
              focusable: true,
              reconnectable: true,
              interactionWidth: 30,
            }}
            defaultViewport={{ x: 72, y: 96, zoom: 0.76 }}
            minZoom={GRAPH_THEME.nav.minZoom}
            maxZoom={GRAPH_THEME.nav.maxZoom}
            panOnDrag
            panOnScroll
            zoomOnPinch
            edgesReconnectable
            connectionMode={ConnectionMode.Loose}
            connectOnClick={false}
            snapToGrid
            snapGrid={[GRAPH_THEME.graphPaper.minorStep, GRAPH_THEME.graphPaper.minorStep]}
            fitView
            fitViewOptions={{
              padding: GRAPH_THEME.nav.fitPadding,
              minZoom: GRAPH_THEME.nav.minZoom,
              maxZoom: GRAPH_THEME.nav.fitMaxZoom,
            }}
            style={{ background: 'transparent' }}
            proOptions={{ hideAttribution: true }}
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
          </ReactFlow>
        </div>
      </main>

      <RightGlassDrawer
        isOpen={Boolean(selectedNode)}
        title={selectedNode ? getSceneTitle(selectedNode) : 'Object'}
        onClose={() => setSelectedNodeId('')}
        dataTestId="video-storyboard-inspector"
        defaultWidth={420}
        minWidth={360}
        maxWidth={700}
        storageKey={`liquidaity:video-storyboard-drawer:${String(projectId || 'default')}`}
        top={12}
        right={12}
        bottom={12}
      >
        {selectedNode ? (
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={graphDrawerSectionStyle({ padding: '10px 11px' })}>
              <div
                data-testid="selected-object-title"
                style={{ fontSize: 13, fontWeight: 700, color: GRAPH_THEME.drawer.inputText }}
              >
                {getSceneTitle(selectedNode)}
              </div>
            </div>

            <InspectorFields node={selectedNode} onChange={updateSelectedNodeData} />

            <div style={graphDrawerSectionStyle({ padding: '10px 11px', display: 'grid', gap: 7 })}>
              {selectedNode.type === 'contextNode' ? (
                <>
                  <ActionButton
                    label="Create scenes from source"
                    onClick={createStoryboardFromSource}
                  />
                  <ActionButton
                    label="Copy for chat"
                    onClick={() =>
                      void copyToClipboard(
                        (selectedNode.data as ContextNodeData).content,
                        'Source copied for chat.',
                        'Source is empty.',
                      )
                    }
                  />
                </>
              ) : null}
              {selectedNode.type === 'sceneNode' ? (
                <>
                  <ActionButton label="Approve scene" onClick={approveSelectedScene} />
                  <ActionButton
                    label="Create Image Pair"
                    onClick={createImagePairFromScene}
                    disabled={selectedSceneData?.approvalState !== 'approved'}
                    title="Approve scene first."
                  />
                  <ActionButton
                    label="Copy for chat"
                    onClick={() =>
                      void copyToClipboard(
                        JSON.stringify(
                          buildVideoObjectChatContext(selectedNode.id, nodes, edges),
                          null,
                          2,
                        ),
                        'Scene context copied for chat.',
                        'Scene context empty.',
                      )
                    }
                  />
                </>
              ) : null}
              {selectedNode.type === 'framePackNode' ? (
                <>
                  <ActionButton
                    label="Copy start prompt"
                    onClick={() =>
                      void copyToClipboard(
                        (selectedNode.data as FramePackNodeData).startImagePrompt,
                        'Start prompt copied.',
                        'Start prompt empty.',
                      )
                    }
                  />
                  <ActionButton
                    label="Copy end prompt"
                    onClick={() =>
                      void copyToClipboard(
                        (selectedNode.data as FramePackNodeData).endImagePrompt,
                        'End prompt copied.',
                        'End prompt empty.',
                      )
                    }
                  />
                  <ActionButton
                    label="Copy motion prompt"
                    onClick={() =>
                      void copyToClipboard(
                        (selectedNode.data as FramePackNodeData).motionPrompt,
                        'Motion prompt copied.',
                        'Motion prompt empty.',
                      )
                    }
                  />
                </>
              ) : null}
              {selectedNode.type === 'outputNode' ? (
                <ActionButton
                  label="Copy clip URL"
                  onClick={() =>
                    void copyToClipboard(
                      (selectedNode.data as OutputNodeData).videoUrl,
                      'Clip URL copied.',
                      'Clip URL is empty.',
                    )
                  }
                />
              ) : null}
            </div>

            {actionStatus ? (
              <div
                data-testid="storyboard-action-status"
                style={{ fontSize: 11, color: GRAPH_THEME.drawer.inputText }}
              >
                {actionStatus}
              </div>
            ) : null}
          </div>
        ) : null}
      </RightGlassDrawer>
    </div>
  );
}

function inputStyle(overrides?: React.CSSProperties): React.CSSProperties {
  return graphDrawerInputStyle({
    padding: '7px 9px',
    borderRadius: 7,
    fontSize: 12,
    lineHeight: 1.45,
    ...overrides,
  });
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <label style={{ display: 'grid', gap: 6, fontSize: 12 }}>
      <span style={{ color: GRAPH_THEME.drawer.inputText, fontWeight: 600 }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function InspectorFields({
  node,
  onChange,
}: {
  node: StoryboardNode;
  onChange: (patch: Partial<StoryboardNodeData>) => void;
}): React.ReactElement {
  if (node.type === 'contextNode') {
    const data = node.data as ContextNodeData;
    return (
      <div style={graphDrawerSectionStyle({ padding: '10px 11px', display: 'grid', gap: 10 })}>
        <Field label="title">
          <input
            aria-label="title"
            value={data.title}
            onChange={(event) => onChange({ title: event.target.value })}
            style={inputStyle()}
          />
        </Field>
        <Field label="sourceType">
          <select
            aria-label="sourceType"
            value={data.sourceType}
            onChange={(event) =>
              onChange({ sourceType: event.target.value as ContextNodeData['sourceType'] })
            }
            style={inputStyle()}
          >
            <option value="typed">typed</option>
            <option value="dropped">dropped</option>
          </select>
        </Field>
        <Field label="content">
          <textarea
            aria-label="content"
            value={data.content}
            onChange={(event) => onChange({ content: event.target.value })}
            rows={6}
            style={inputStyle({ resize: 'vertical' })}
          />
        </Field>
      </div>
    );
  }

  if (node.type === 'sceneNode') {
    const data = node.data as SceneNodeData;
    return (
      <div style={graphDrawerSectionStyle({ padding: '10px 11px', display: 'grid', gap: 10 })}>
        <Field label="title">
          <input
            aria-label="title"
            value={data.title}
            onChange={(event) => onChange({ title: event.target.value })}
            style={inputStyle()}
          />
        </Field>
        <Field label="description">
          <textarea
            aria-label="description"
            value={data.description}
            onChange={(event) => onChange({ description: event.target.value })}
            rows={4}
            style={inputStyle({ resize: 'vertical' })}
          />
        </Field>
        <Field label="order">
          <input
            aria-label="order"
            value={String(data.order)}
            onChange={(event) => {
              const parsed = Number.parseInt(event.target.value, 10);
              onChange({ order: Number.isFinite(parsed) ? parsed : data.order });
            }}
            style={inputStyle()}
          />
        </Field>
        <Field label="approvalState">
          <select
            aria-label="approvalState"
            value={data.approvalState}
            onChange={(event) =>
              onChange({ approvalState: event.target.value as SceneApproval })
            }
            style={inputStyle()}
          >
            <option value="draft">draft</option>
            <option value="approved">approved</option>
          </select>
        </Field>
      </div>
    );
  }

  if (node.type === 'framePackNode') {
    const data = node.data as FramePackNodeData;
    return (
      <div style={graphDrawerSectionStyle({ padding: '10px 11px', display: 'grid', gap: 10 })}>
        <Field label="startImagePrompt">
          <textarea
            aria-label="startImagePrompt"
            value={data.startImagePrompt}
            onChange={(event) => onChange({ startImagePrompt: event.target.value })}
            rows={3}
            style={inputStyle({ resize: 'vertical' })}
          />
        </Field>
        <Field label="endImagePrompt">
          <textarea
            aria-label="endImagePrompt"
            value={data.endImagePrompt}
            onChange={(event) => onChange({ endImagePrompt: event.target.value })}
            rows={3}
            style={inputStyle({ resize: 'vertical' })}
          />
        </Field>
        <Field label="motionPrompt">
          <textarea
            aria-label="motionPrompt"
            value={data.motionPrompt}
            onChange={(event) => onChange({ motionPrompt: event.target.value })}
            rows={3}
            style={inputStyle({ resize: 'vertical' })}
          />
        </Field>
        <Field label="negativePrompt">
          <textarea
            aria-label="negativePrompt"
            value={data.negativePrompt}
            onChange={(event) => onChange({ negativePrompt: event.target.value })}
            rows={2}
            style={inputStyle({ resize: 'vertical' })}
          />
        </Field>
        <Field label="styleRules">
          <textarea
            aria-label="styleRules"
            value={data.styleRules}
            onChange={(event) => onChange({ styleRules: event.target.value })}
            rows={2}
            style={inputStyle({ resize: 'vertical' })}
          />
        </Field>
        <Field label="continuityRules">
          <textarea
            aria-label="continuityRules"
            value={data.continuityRules}
            onChange={(event) => onChange({ continuityRules: event.target.value })}
            rows={2}
            style={inputStyle({ resize: 'vertical' })}
          />
        </Field>
        <Field label="startImageUrl">
          <input
            aria-label="startImageUrl"
            value={data.startImageUrl}
            onChange={(event) => onChange({ startImageUrl: event.target.value })}
            style={inputStyle()}
          />
        </Field>
        <Field label="endImageUrl">
          <input
            aria-label="endImageUrl"
            value={data.endImageUrl}
            onChange={(event) => onChange({ endImageUrl: event.target.value })}
            style={inputStyle()}
          />
        </Field>
        <Field label="approvalState">
          <select
            aria-label="approvalState"
            value={data.approvalState}
            onChange={(event) =>
              onChange({ approvalState: event.target.value as FramePackApproval })
            }
            style={inputStyle()}
          >
            <option value="draft">draft</option>
            <option value="approved">approved</option>
          </select>
        </Field>
      </div>
    );
  }

  const data = node.data as OutputNodeData;
  return (
    <div style={graphDrawerSectionStyle({ padding: '10px 11px', display: 'grid', gap: 10 })}>
      <Field label="videoUrl">
        <input
          aria-label="videoUrl"
          value={data.videoUrl}
          onChange={(event) => onChange({ videoUrl: event.target.value })}
          style={inputStyle()}
        />
      </Field>
      <Field label="status">
        <input
          aria-label="status"
          value={data.status}
          onChange={(event) => onChange({ status: event.target.value })}
          style={inputStyle()}
        />
      </Field>
      <Field label="notes">
        <textarea
          aria-label="notes"
          value={data.notes}
          onChange={(event) => onChange({ notes: event.target.value })}
          rows={4}
          style={inputStyle({ resize: 'vertical' })}
        />
      </Field>
    </div>
  );
}
