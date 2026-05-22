import React from 'react';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { GRAPH_THEME } from '../../components/graph/graphVisualTokens';

type MediaStudioCanvasProps = {
  projectId?: string | null;
};

type VideoTool = 'higgsfield' | 'kling' | 'runway' | 'pika' | 'other';

type StoryboardNodeType =
  | 'shotNode'
  | 'startFrameNode'
  | 'endFrameNode'
  | 'motionPromptNode'
  | 'clipOutputNode';

type ShotNodeData = {
  title: string;
  description: string;
  durationSec: string;
  aspectRatio: string;
  cameraMove: string;
  status: string;
};

type FrameNodeData = {
  imageUrl: string;
  imagePrompt: string;
  notes: string;
};

type MotionPromptNodeData = {
  videoTool: VideoTool;
  motionPrompt: string;
  mustPreserve: string;
  avoid: string;
  styleNotes: string;
};

type ClipOutputNodeData = {
  videoUrl: string;
  toolUsed: string;
  status: string;
  notes: string;
};

type StoryboardNodeData =
  | ShotNodeData
  | FrameNodeData
  | MotionPromptNodeData
  | ClipOutputNodeData;

type StoryboardNode = Node<StoryboardNodeData, StoryboardNodeType>;

const nodeLabels: Record<StoryboardNodeType, string> = {
  shotNode: 'Shot',
  startFrameNode: 'Start Frame',
  endFrameNode: 'End Frame',
  motionPromptNode: 'Motion Prompt',
  clipOutputNode: 'Clip Output',
};

const generateDisabledReason = 'No provider route is wired in this pass.';

const initialNodes: StoryboardNode[] = [
  {
    id: 'shot-1',
    type: 'shotNode',
    position: { x: 100, y: 160 },
    data: {
      title: 'Hero shot',
      description: 'Define the core beat and camera objective.',
      durationSec: '5',
      aspectRatio: '16:9',
      cameraMove: 'slow push-in',
      status: 'draft',
    },
  },
  {
    id: 'start-frame-1',
    type: 'startFrameNode',
    position: { x: 390, y: 70 },
    data: {
      imageUrl: '',
      imagePrompt: 'Crisp starting frame, subject centered, natural light.',
      notes: '',
    },
  },
  {
    id: 'end-frame-1',
    type: 'endFrameNode',
    position: { x: 390, y: 260 },
    data: {
      imageUrl: '',
      imagePrompt: 'Matching ending frame, evolved pose, same identity.',
      notes: '',
    },
  },
  {
    id: 'motion-prompt-1',
    type: 'motionPromptNode',
    position: { x: 700, y: 160 },
    data: {
      videoTool: 'higgsfield',
      motionPrompt:
        'Move from start frame to end frame with smooth subject continuity and consistent lighting.',
      mustPreserve: 'face identity, outfit details',
      avoid: 'warping, duplicate limbs, sudden zoom jumps',
      styleNotes: 'cinematic realism',
    },
  },
  {
    id: 'clip-output-1',
    type: 'clipOutputNode',
    position: { x: 1020, y: 160 },
    data: {
      videoUrl: '',
      toolUsed: '',
      status: 'manual',
      notes: '',
    },
  },
];

const initialEdges: Edge[] = [
  { id: 'shot-1-start-frame-1', source: 'shot-1', target: 'start-frame-1' },
  { id: 'shot-1-end-frame-1', source: 'shot-1', target: 'end-frame-1' },
  {
    id: 'start-frame-1-motion-prompt-1',
    source: 'start-frame-1',
    target: 'motion-prompt-1',
  },
  {
    id: 'end-frame-1-motion-prompt-1',
    source: 'end-frame-1',
    target: 'motion-prompt-1',
  },
  {
    id: 'motion-prompt-1-clip-output-1',
    source: 'motion-prompt-1',
    target: 'clip-output-1',
  },
];

function createNodeData(type: StoryboardNodeType): StoryboardNodeData {
  if (type === 'shotNode') {
    return {
      title: 'New shot',
      description: '',
      durationSec: '5',
      aspectRatio: '16:9',
      cameraMove: '',
      status: 'draft',
    };
  }
  if (type === 'startFrameNode' || type === 'endFrameNode') {
    return {
      imageUrl: '',
      imagePrompt: '',
      notes: '',
    };
  }
  if (type === 'motionPromptNode') {
    return {
      videoTool: 'higgsfield',
      motionPrompt: '',
      mustPreserve: '',
      avoid: '',
      styleNotes: '',
    };
  }
  return {
    videoUrl: '',
    toolUsed: '',
    status: 'manual',
    notes: '',
  };
}

function getNodeTitle(node: StoryboardNode): string {
  if (node.type === 'shotNode') {
    const data = node.data as ShotNodeData;
    return data.title || nodeLabels.shotNode;
  }
  if (node.type === 'motionPromptNode') {
    const data = node.data as MotionPromptNodeData;
    return data.videoTool ? `${nodeLabels.motionPromptNode} (${data.videoTool})` : nodeLabels.motionPromptNode;
  }
  if (node.type === 'clipOutputNode') {
    const data = node.data as ClipOutputNodeData;
    return data.status ? `${nodeLabels.clipOutputNode} (${data.status})` : nodeLabels.clipOutputNode;
  }
  return nodeLabels[node.type];
}

function getNodeDetail(node: StoryboardNode): string {
  if (node.type === 'shotNode') {
    const data = node.data as ShotNodeData;
    return `${data.durationSec || '0'}s · ${data.aspectRatio || 'ratio?'} · ${data.status || 'draft'}`;
  }
  if (node.type === 'startFrameNode' || node.type === 'endFrameNode') {
    const data = node.data as FrameNodeData;
    return data.imageUrl ? 'frame URL set' : 'no frame URL';
  }
  if (node.type === 'motionPromptNode') {
    const data = node.data as MotionPromptNodeData;
    return data.motionPrompt || 'no motion prompt';
  }
  const data = node.data as ClipOutputNodeData;
  return data.videoUrl ? 'clip URL set' : 'no clip URL';
}

function StoryboardCard({
  id,
  data,
  type,
  selected,
}: NodeProps<StoryboardNode>): React.ReactElement {
  const node = { id, data, type, position: { x: 0, y: 0 } } as StoryboardNode;
  return (
    <div
      style={{
        width: 208,
        borderRadius: 8,
        border: `1px solid ${selected ? GRAPH_THEME.accent.primary : GRAPH_THEME.drawer.inputBorder}`,
        background: 'rgba(17, 22, 29, 0.95)',
        color: GRAPH_THEME.drawer.inputText,
        boxShadow: selected
          ? '0 0 0 1px rgba(55, 173, 170, 0.26), 0 14px 30px rgba(0, 0, 0, 0.26)'
          : '0 10px 26px rgba(0, 0, 0, 0.2)',
        padding: 10,
        display: 'grid',
        gap: 6,
      }}
    >
      <div style={{ fontSize: 11, color: GRAPH_THEME.drawer.inputMuted }}>
        {nodeLabels[type as StoryboardNodeType]}
      </div>
      <div
        style={{
          fontSize: 13,
          fontWeight: 700,
          lineHeight: 1.24,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {getNodeTitle(node)}
      </div>
      <div
        style={{
          fontSize: 11,
          color: GRAPH_THEME.drawer.inputMuted,
          lineHeight: 1.35,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {getNodeDetail(node)}
      </div>
    </div>
  );
}

const nodeTypes = {
  shotNode: StoryboardCard,
  startFrameNode: StoryboardCard,
  endFrameNode: StoryboardCard,
  motionPromptNode: StoryboardCard,
  clipOutputNode: StoryboardCard,
};

function fieldInputStyle(): React.CSSProperties {
  return {
    width: '100%',
    border: `1px solid ${GRAPH_THEME.drawer.inputBorder}`,
    borderRadius: 8,
    background: GRAPH_THEME.drawer.inputBackground,
    color: GRAPH_THEME.drawer.inputText,
    padding: '8px 10px',
    fontSize: 12,
    outline: 'none',
  };
}

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
      title={title}
      disabled={disabled}
      onClick={onClick}
      style={{
        border: `1px solid ${GRAPH_THEME.drawer.inputBorder}`,
        borderRadius: 8,
        background: disabled
          ? 'rgba(167, 176, 186, 0.05)'
          : GRAPH_THEME.drawer.inputBackground,
        color: disabled ? GRAPH_THEME.drawer.inputMuted : GRAPH_THEME.drawer.inputText,
        padding: '7px 10px',
        fontSize: 12,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {label}
    </button>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <label style={{ display: 'grid', gap: 5, fontSize: 12 }}>
      <span style={{ color: GRAPH_THEME.drawer.inputMuted }}>{label}</span>
      {children}
    </label>
  );
}

export default function MediaStudioCanvas({
  projectId = null,
}: MediaStudioCanvasProps): React.ReactElement {
  const [nodes, setNodes, onNodesChange] = useNodesState<StoryboardNode>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selectedNodeId, setSelectedNodeId] = React.useState<string>('shot-1');
  const [copyStatus, setCopyStatus] = React.useState<string | null>(null);
  const nextNodeIdRef = React.useRef(2);

  const selectedNode = React.useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );

  const onConnect = React.useCallback(
    (connection: Connection) => {
      setEdges((currentEdges) => addEdge(connection, currentEdges));
    },
    [setEdges],
  );

  const addStoryboardNode = React.useCallback(
    (type: StoryboardNodeType) => {
      const ordinal = nextNodeIdRef.current;
      nextNodeIdRef.current += 1;
      const id = `${type.replace('Node', '').replace('Prompt', '-prompt').replace('Frame', '-frame')}-${ordinal}`;
      const offset = ordinal * 34;
      setNodes((currentNodes) => [
        ...currentNodes,
        {
          id,
          type,
          position: { x: 140 + offset, y: 340 + (offset % 120) },
          data: createNodeData(type),
        },
      ]);
      setSelectedNodeId(id);
    },
    [setNodes],
  );

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

  const copyText = React.useCallback(async (text: string, label: string) => {
    if (!text.trim()) {
      setCopyStatus(`No ${label} to copy.`);
      return;
    }
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      }
      setCopyStatus(`${label} copied.`);
    } catch {
      setCopyStatus(`Copy failed for ${label}.`);
    }
  }, []);

  return (
    <div
      data-testid="video-workspace-placeholder"
      style={{
        height: '100%',
        minHeight: 0,
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) 330px',
        background: GRAPH_THEME.background.knowledgeSurface,
        color: GRAPH_THEME.drawer.inputText,
      }}
    >
      <main style={{ minWidth: 0, minHeight: 0, display: 'grid', gridTemplateRows: 'auto 1fr' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: 10,
            borderBottom: `1px solid ${GRAPH_THEME.drawer.inputBorder}`,
            background: 'rgba(11, 14, 18, 0.82)',
            flexWrap: 'wrap',
          }}
        >
          <ActionButton label="Add Shot" onClick={() => addStoryboardNode('shotNode')} />
          <ActionButton
            label="Add Start Frame"
            onClick={() => addStoryboardNode('startFrameNode')}
          />
          <ActionButton
            label="Add End Frame"
            onClick={() => addStoryboardNode('endFrameNode')}
          />
          <ActionButton
            label="Add Motion Prompt"
            onClick={() => addStoryboardNode('motionPromptNode')}
          />
          <ActionButton
            label="Add Clip Output"
            onClick={() => addStoryboardNode('clipOutputNode')}
          />
          <div style={{ marginLeft: 'auto', fontSize: 12, color: GRAPH_THEME.drawer.inputMuted }}>
            Video Agent storyboard graph
          </div>
        </div>

        <div style={{ minHeight: 0 }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => setSelectedNodeId(node.id)}
            onPaneClick={() => setSelectedNodeId('')}
            fitView
          >
            <Background color="rgba(167, 176, 186, 0.25)" gap={18} />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>
      </main>

      <aside
        data-testid="video-storyboard-inspector"
        style={{
          borderLeft: `1px solid ${GRAPH_THEME.drawer.inputBorder}`,
          background: 'rgba(11, 14, 18, 0.91)',
          padding: 14,
          overflow: 'auto',
          display: 'grid',
          alignContent: 'start',
          gap: 12,
        }}
      >
        <div style={{ display: 'grid', gap: 3 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Inspector</div>
          <div style={{ fontSize: 12, color: GRAPH_THEME.drawer.inputMuted }}>
            {projectId ? `Project ${projectId}` : 'Local graph state only'}
          </div>
        </div>

        {selectedNode ? (
          <InspectorFields
            node={selectedNode}
            onChange={updateSelectedNodeData}
            onCopy={copyText}
          />
        ) : (
          <div style={{ fontSize: 12, color: GRAPH_THEME.drawer.inputMuted }}>
            Select a node to edit its fields.
          </div>
        )}

        {copyStatus ? (
          <div
            data-testid="copy-status"
            style={{ fontSize: 11, color: GRAPH_THEME.drawer.inputMuted }}
          >
            {copyStatus}
          </div>
        ) : null}

        <div
          style={{
            borderTop: `1px solid ${GRAPH_THEME.drawer.inputBorder}`,
            paddingTop: 12,
            display: 'grid',
            gap: 8,
          }}
        >
          <ActionButton
            label="Generate disabled - no route wired"
            onClick={() => {}}
            disabled
            title={generateDisabledReason}
          />
          <div style={{ fontSize: 11, color: GRAPH_THEME.drawer.inputMuted, lineHeight: 1.4 }}>
            Future flow note: ChatGPT Images generate start/end frames. Higgsfield, Kling, Runway,
            and Pika consume those frames plus motion prompt to create clips. Peepshow later:
            Clip Output -&gt; Peepshow Extract -&gt; Frame Anchors -&gt; New Shot/Motion Prompt
            -&gt; New Clip. Peepshow remains vendored at main/peepshow-main and is not integrated
            in this pass.
          </div>
        </div>
      </aside>
    </div>
  );
}

function InspectorFields({
  node,
  onChange,
  onCopy,
}: {
  node: StoryboardNode;
  onChange: (patch: Partial<StoryboardNodeData>) => void;
  onCopy: (text: string, label: string) => Promise<void>;
}): React.ReactElement {
  if (node.type === 'shotNode') {
    const data = node.data as ShotNodeData;
    return (
      <div style={{ display: 'grid', gap: 10 }}>
        <Field label="title">
          <input
            aria-label="title"
            value={data.title}
            onChange={(event) => onChange({ title: event.target.value })}
            style={fieldInputStyle()}
          />
        </Field>
        <Field label="description">
          <textarea
            aria-label="description"
            value={data.description}
            onChange={(event) => onChange({ description: event.target.value })}
            rows={4}
            style={fieldInputStyle()}
          />
        </Field>
        <Field label="durationSec">
          <input
            aria-label="durationSec"
            value={data.durationSec}
            onChange={(event) => onChange({ durationSec: event.target.value })}
            style={fieldInputStyle()}
          />
        </Field>
        <Field label="aspectRatio">
          <input
            aria-label="aspectRatio"
            value={data.aspectRatio}
            onChange={(event) => onChange({ aspectRatio: event.target.value })}
            style={fieldInputStyle()}
          />
        </Field>
        <Field label="cameraMove">
          <input
            aria-label="cameraMove"
            value={data.cameraMove}
            onChange={(event) => onChange({ cameraMove: event.target.value })}
            style={fieldInputStyle()}
          />
        </Field>
        <Field label="status">
          <input
            aria-label="status"
            value={data.status}
            onChange={(event) => onChange({ status: event.target.value })}
            style={fieldInputStyle()}
          />
        </Field>
      </div>
    );
  }

  if (node.type === 'startFrameNode' || node.type === 'endFrameNode') {
    const data = node.data as FrameNodeData;
    const label = node.type === 'startFrameNode' ? 'start frame prompt' : 'end frame prompt';
    return (
      <div style={{ display: 'grid', gap: 10 }}>
        <Field label="imageUrl">
          <input
            aria-label="imageUrl"
            value={data.imageUrl}
            onChange={(event) => onChange({ imageUrl: event.target.value })}
            style={fieldInputStyle()}
          />
        </Field>
        <Field label="imagePrompt">
          <textarea
            aria-label="imagePrompt"
            value={data.imagePrompt}
            onChange={(event) => onChange({ imagePrompt: event.target.value })}
            rows={4}
            style={fieldInputStyle()}
          />
        </Field>
        <ActionButton
          label="Copy Image Prompt"
          onClick={() => {
            void onCopy(data.imagePrompt, label);
          }}
        />
        <Field label="notes">
          <textarea
            aria-label="notes"
            value={data.notes}
            onChange={(event) => onChange({ notes: event.target.value })}
            rows={3}
            style={fieldInputStyle()}
          />
        </Field>
      </div>
    );
  }

  if (node.type === 'motionPromptNode') {
    const data = node.data as MotionPromptNodeData;
    return (
      <div style={{ display: 'grid', gap: 10 }}>
        <Field label="videoTool">
          <select
            aria-label="videoTool"
            value={data.videoTool}
            onChange={(event) => onChange({ videoTool: event.target.value as VideoTool })}
            style={fieldInputStyle()}
          >
            <option value="higgsfield">higgsfield</option>
            <option value="kling">kling</option>
            <option value="runway">runway</option>
            <option value="pika">pika</option>
            <option value="other">other</option>
          </select>
        </Field>
        <Field label="motionPrompt">
          <textarea
            aria-label="motionPrompt"
            value={data.motionPrompt}
            onChange={(event) => onChange({ motionPrompt: event.target.value })}
            rows={4}
            style={fieldInputStyle()}
          />
        </Field>
        <ActionButton
          label="Copy Video Prompt"
          onClick={() => {
            void onCopy(data.motionPrompt, 'video prompt');
          }}
        />
        <Field label="mustPreserve">
          <textarea
            aria-label="mustPreserve"
            value={data.mustPreserve}
            onChange={(event) => onChange({ mustPreserve: event.target.value })}
            rows={3}
            style={fieldInputStyle()}
          />
        </Field>
        <Field label="avoid">
          <textarea
            aria-label="avoid"
            value={data.avoid}
            onChange={(event) => onChange({ avoid: event.target.value })}
            rows={3}
            style={fieldInputStyle()}
          />
        </Field>
        <Field label="styleNotes">
          <textarea
            aria-label="styleNotes"
            value={data.styleNotes}
            onChange={(event) => onChange({ styleNotes: event.target.value })}
            rows={3}
            style={fieldInputStyle()}
          />
        </Field>
      </div>
    );
  }

  const data = node.data as ClipOutputNodeData;
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <Field label="videoUrl">
        <input
          aria-label="videoUrl"
          value={data.videoUrl}
          onChange={(event) => onChange({ videoUrl: event.target.value })}
          style={fieldInputStyle()}
        />
      </Field>
      <Field label="toolUsed">
        <input
          aria-label="toolUsed"
          value={data.toolUsed}
          onChange={(event) => onChange({ toolUsed: event.target.value })}
          style={fieldInputStyle()}
        />
      </Field>
      <Field label="status">
        <input
          aria-label="status"
          value={data.status}
          onChange={(event) => onChange({ status: event.target.value })}
          style={fieldInputStyle()}
        />
      </Field>
      <Field label="notes">
        <textarea
          aria-label="notes"
          value={data.notes}
          onChange={(event) => onChange({ notes: event.target.value })}
          rows={4}
          style={fieldInputStyle()}
        />
      </Field>
    </div>
  );
}
