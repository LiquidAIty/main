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

type StoryboardNodeType =
  | 'referenceNode'
  | 'shotNode'
  | 'promptNode'
  | 'outputNode';

type ReferenceKind = 'image' | 'document' | 'note';
type OutputKind = 'image' | 'video';

type ReferenceNodeData = {
  title: string;
  kind: ReferenceKind;
  url: string;
  text: string;
};

type ShotNodeData = {
  title: string;
  description: string;
  durationSec: string;
  status: string;
};

type PromptNodeData = {
  prompt: string;
  negativePrompt: string;
  motionInstruction: string;
  styleNotes: string;
};

type OutputNodeData = {
  kind: OutputKind;
  url: string;
  jobStatus: string;
  notes: string;
};

type StoryboardNodeData =
  | ReferenceNodeData
  | ShotNodeData
  | PromptNodeData
  | OutputNodeData;

type StoryboardNode = Node<StoryboardNodeData, StoryboardNodeType>;

const generationDisabledReason =
  'No real generation route is wired for this storyboard pass.';

const nodeLabels: Record<StoryboardNodeType, string> = {
  referenceNode: 'Reference',
  shotNode: 'Shot',
  promptNode: 'Prompt',
  outputNode: 'Output',
};

const initialNodes: StoryboardNode[] = [
  {
    id: 'reference-1',
    type: 'referenceNode',
    position: { x: 80, y: 140 },
    data: {
      title: 'Reference',
      kind: 'note',
      url: '',
      text: 'Add source notes, links, or reference media here.',
    },
  },
  {
    id: 'shot-1',
    type: 'shotNode',
    position: { x: 340, y: 140 },
    data: {
      title: 'Shot',
      description: 'Describe the storyboard beat.',
      durationSec: '8',
      status: 'draft',
    },
  },
  {
    id: 'prompt-1',
    type: 'promptNode',
    position: { x: 600, y: 140 },
    data: {
      prompt: 'Write the generation prompt for this shot.',
      negativePrompt: '',
      motionInstruction: '',
      styleNotes: '',
    },
  },
  {
    id: 'output-1',
    type: 'outputNode',
    position: { x: 860, y: 140 },
    data: {
      kind: 'video',
      url: '',
      jobStatus: 'not generated',
      notes: '',
    },
  },
];

const initialEdges: Edge[] = [
  { id: 'reference-1-shot-1', source: 'reference-1', target: 'shot-1' },
  { id: 'shot-1-prompt-1', source: 'shot-1', target: 'prompt-1' },
  { id: 'prompt-1-output-1', source: 'prompt-1', target: 'output-1' },
];

function createNodeData(type: StoryboardNodeType): StoryboardNodeData {
  if (type === 'referenceNode') {
    return { title: 'Reference', kind: 'note', url: '', text: '' };
  }
  if (type === 'shotNode') {
    return { title: 'Shot', description: '', durationSec: '8', status: 'draft' };
  }
  if (type === 'promptNode') {
    return {
      prompt: '',
      negativePrompt: '',
      motionInstruction: '',
      styleNotes: '',
    };
  }
  return { kind: 'video', url: '', jobStatus: 'not generated', notes: '' };
}

function getNodeTitle(node: StoryboardNode): string {
  if (node.type === 'promptNode') return 'Prompt';
  if (node.type === 'outputNode') return `${nodeLabels[node.type]} ${(node.data as OutputNodeData).kind}`;
  return (node.data as ReferenceNodeData | ShotNodeData).title || nodeLabels[node.type];
}

function StoryboardCard({ data, type, selected }: NodeProps<StoryboardNode>): React.ReactElement {
  const nodeType = type as StoryboardNodeType;
  const title =
    nodeType === 'promptNode'
      ? (data as PromptNodeData).prompt || 'Prompt'
      : getNodeTitle({ id: '', position: { x: 0, y: 0 }, data, type: nodeType });
  const detail =
    nodeType === 'referenceNode'
      ? (data as ReferenceNodeData).kind
      : nodeType === 'shotNode'
        ? `${(data as ShotNodeData).durationSec || '0'}s · ${(data as ShotNodeData).status || 'draft'}`
        : nodeType === 'promptNode'
          ? (data as PromptNodeData).motionInstruction || 'No motion instruction yet'
          : (data as OutputNodeData).jobStatus || 'not generated';

  return (
    <div
      style={{
        width: 190,
        borderRadius: 8,
        border: `1px solid ${
          selected ? GRAPH_THEME.accent.primary : GRAPH_THEME.drawer.inputBorder
        }`,
        background: 'rgba(17, 22, 29, 0.96)',
        color: GRAPH_THEME.drawer.inputText,
        boxShadow: selected
          ? '0 0 0 1px rgba(55, 173, 170, 0.24), 0 12px 28px rgba(0, 0, 0, 0.28)'
          : '0 10px 24px rgba(0, 0, 0, 0.22)',
        padding: 10,
        display: 'grid',
        gap: 6,
      }}
    >
      <div style={{ fontSize: 11, color: GRAPH_THEME.drawer.inputMuted }}>
        {nodeLabels[nodeType]}
      </div>
      <div
        style={{
          fontSize: 13,
          fontWeight: 700,
          lineHeight: 1.25,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {title}
      </div>
      <div style={{ fontSize: 11, color: GRAPH_THEME.drawer.inputMuted }}>
        {detail}
      </div>
    </div>
  );
}

const nodeTypes = {
  referenceNode: StoryboardCard,
  shotNode: StoryboardCard,
  promptNode: StoryboardCard,
  outputNode: StoryboardCard,
};

function FieldLabel({
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

function textInputStyle(): React.CSSProperties {
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

export default function MediaStudioCanvas({
  projectId = null,
}: MediaStudioCanvasProps): React.ReactElement {
  const [nodes, setNodes, onNodesChange] = useNodesState<StoryboardNode>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selectedNodeId, setSelectedNodeId] = React.useState<string>('reference-1');
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

  function addStoryboardNode(type: StoryboardNodeType): void {
    const id = `${type.replace('Node', '').toLowerCase()}-${nextNodeIdRef.current}`;
    const offset = nextNodeIdRef.current * 34;
    nextNodeIdRef.current += 1;
    setNodes((currentNodes) => [
      ...currentNodes,
      {
        id,
        type,
        position: { x: 120 + offset, y: 320 + offset },
        data: createNodeData(type),
      },
    ]);
    setSelectedNodeId(id);
  }

  function updateSelectedNodeData(patch: Partial<StoryboardNodeData>): void {
    if (!selectedNode) return;
    setNodes((currentNodes) =>
      currentNodes.map((node) =>
        node.id === selectedNode.id
          ? { ...node, data: { ...node.data, ...patch } as StoryboardNodeData }
          : node,
      ),
    );
  }

  return (
    <div
      data-testid="video-workspace-placeholder"
      style={{
        height: '100%',
        minHeight: 0,
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) 320px',
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
            padding: 12,
            borderBottom: `1px solid ${GRAPH_THEME.drawer.inputBorder}`,
            background: 'rgba(11, 14, 18, 0.82)',
          }}
        >
          {(
            [
              ['referenceNode', 'Add Reference'],
              ['shotNode', 'Add Shot'],
              ['promptNode', 'Add Prompt'],
              ['outputNode', 'Add Output'],
            ] as const
          ).map(([type, label]) => (
            <button
              key={type}
              type="button"
              onClick={() => addStoryboardNode(type)}
              style={{
                border: `1px solid ${GRAPH_THEME.drawer.inputBorder}`,
                borderRadius: 8,
                background: GRAPH_THEME.drawer.inputBackground,
                color: GRAPH_THEME.drawer.inputText,
                padding: '7px 10px',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              {label}
            </button>
          ))}
          <div style={{ marginLeft: 'auto', fontSize: 12, color: GRAPH_THEME.drawer.inputMuted }}>
            Video Agent storyboard
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
            <Background color="rgba(167, 176, 186, 0.28)" gap={18} />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>
      </main>

      <aside
        data-testid="video-storyboard-inspector"
        style={{
          borderLeft: `1px solid ${GRAPH_THEME.drawer.inputBorder}`,
          background: 'rgba(11, 14, 18, 0.9)',
          padding: 14,
          overflow: 'auto',
          display: 'grid',
          alignContent: 'start',
          gap: 12,
        }}
      >
        <div>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Inspector</div>
          <div style={{ fontSize: 12, color: GRAPH_THEME.drawer.inputMuted }}>
            {projectId ? `Project ${projectId}` : 'Local component state only'}
          </div>
        </div>

        {selectedNode ? (
          <InspectorFields
            node={selectedNode}
            onChange={updateSelectedNodeData}
          />
        ) : (
          <div style={{ fontSize: 12, color: GRAPH_THEME.drawer.inputMuted }}>
            Select a storyboard node to edit its fields.
          </div>
        )}

        <div
          style={{
            borderTop: `1px solid ${GRAPH_THEME.drawer.inputBorder}`,
            paddingTop: 12,
            display: 'grid',
            gap: 8,
          }}
        >
          <button
            type="button"
            disabled
            title={generationDisabledReason}
            style={{
              border: `1px solid ${GRAPH_THEME.drawer.inputBorder}`,
              borderRadius: 8,
              background: 'rgba(167, 176, 186, 0.05)',
              color: GRAPH_THEME.drawer.inputMuted,
              padding: '8px 10px',
              fontSize: 12,
              cursor: 'not-allowed',
            }}
          >
            Generate disabled - no route wired
          </button>
          <div style={{ fontSize: 11, color: GRAPH_THEME.drawer.inputMuted }}>
            Future flow note: Video Output -&gt; Peepshow Extract -&gt; Frame References
            -&gt; New Prompt -&gt; New Output. Peepshow is available at
            main/peepshow-main, but is not integrated in this pass.
          </div>
        </div>
      </aside>
    </div>
  );
}

function InspectorFields({
  node,
  onChange,
}: {
  node: StoryboardNode;
  onChange: (patch: Partial<StoryboardNodeData>) => void;
}): React.ReactElement {
  if (node.type === 'referenceNode') {
    const data = node.data as ReferenceNodeData;
    return (
      <div style={{ display: 'grid', gap: 10 }}>
        <FieldLabel label="title">
          <input value={data.title} onChange={(event) => onChange({ title: event.target.value })} style={textInputStyle()} />
        </FieldLabel>
        <FieldLabel label="kind">
          <select value={data.kind} onChange={(event) => onChange({ kind: event.target.value as ReferenceKind })} style={textInputStyle()}>
            <option value="image">image</option>
            <option value="document">document</option>
            <option value="note">note</option>
          </select>
        </FieldLabel>
        <FieldLabel label="url">
          <input value={data.url} onChange={(event) => onChange({ url: event.target.value })} style={textInputStyle()} />
        </FieldLabel>
        <FieldLabel label="text">
          <textarea value={data.text} onChange={(event) => onChange({ text: event.target.value })} rows={5} style={textInputStyle()} />
        </FieldLabel>
      </div>
    );
  }

  if (node.type === 'shotNode') {
    const data = node.data as ShotNodeData;
    return (
      <div style={{ display: 'grid', gap: 10 }}>
        <FieldLabel label="title">
          <input value={data.title} onChange={(event) => onChange({ title: event.target.value })} style={textInputStyle()} />
        </FieldLabel>
        <FieldLabel label="description">
          <textarea value={data.description} onChange={(event) => onChange({ description: event.target.value })} rows={5} style={textInputStyle()} />
        </FieldLabel>
        <FieldLabel label="durationSec">
          <input value={data.durationSec} onChange={(event) => onChange({ durationSec: event.target.value })} style={textInputStyle()} />
        </FieldLabel>
        <FieldLabel label="status">
          <input value={data.status} onChange={(event) => onChange({ status: event.target.value })} style={textInputStyle()} />
        </FieldLabel>
      </div>
    );
  }

  if (node.type === 'promptNode') {
    const data = node.data as PromptNodeData;
    return (
      <div style={{ display: 'grid', gap: 10 }}>
        <FieldLabel label="prompt">
          <textarea value={data.prompt} onChange={(event) => onChange({ prompt: event.target.value })} rows={5} style={textInputStyle()} />
        </FieldLabel>
        <FieldLabel label="negativePrompt">
          <textarea value={data.negativePrompt} onChange={(event) => onChange({ negativePrompt: event.target.value })} rows={4} style={textInputStyle()} />
        </FieldLabel>
        <FieldLabel label="motionInstruction">
          <textarea value={data.motionInstruction} onChange={(event) => onChange({ motionInstruction: event.target.value })} rows={4} style={textInputStyle()} />
        </FieldLabel>
        <FieldLabel label="styleNotes">
          <textarea value={data.styleNotes} onChange={(event) => onChange({ styleNotes: event.target.value })} rows={4} style={textInputStyle()} />
        </FieldLabel>
      </div>
    );
  }

  const data = node.data as OutputNodeData;
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <FieldLabel label="kind">
        <select value={data.kind} onChange={(event) => onChange({ kind: event.target.value as OutputKind })} style={textInputStyle()}>
          <option value="image">image</option>
          <option value="video">video</option>
        </select>
      </FieldLabel>
      <FieldLabel label="url">
        <input value={data.url} onChange={(event) => onChange({ url: event.target.value })} style={textInputStyle()} />
      </FieldLabel>
      <FieldLabel label="jobStatus">
        <input value={data.jobStatus} onChange={(event) => onChange({ jobStatus: event.target.value })} style={textInputStyle()} />
      </FieldLabel>
      <FieldLabel label="notes">
        <textarea value={data.notes} onChange={(event) => onChange({ notes: event.target.value })} rows={5} style={textInputStyle()} />
      </FieldLabel>
    </div>
  );
}
