export type CodeGraphNode = {
  id: number;
  x: number;
  y: number;
  z: number;
  label: string;
  name: string;
  file_path?: string;
  size: number;
  color: string;
  authority?: 'codegraph' | 'thinkgraph' | 'knowgraph';
  source_id?: string;
  properties?: Record<string, unknown>;
  provenance?: Record<string, unknown>;
  project_id?: string;
  conversation_id?: string;
  goal_id?: string;
  episode_id?: string;
  job_id?: string;
  run_id?: string;
  status?: string;
  trust?: string;
  quality?: string;
  retrieval_reason?: string;
  graph_view_id?: string;
  graph_view_status?: 'candidate' | 'attached' | 'active' | 'consumed' | 'returned' | 'superseded' | 'failed';
};

export type CodeGraphEdge = {
  id?: string;
  source: number;
  target: number;
  type: string;
  cross_authority?: boolean;
};

export type CodeGraphData = {
  nodes: CodeGraphNode[];
  edges: CodeGraphEdge[];
  total_nodes: number;
  linked_projects?: Array<{
    project: string;
    nodes: CodeGraphNode[];
    edges: CodeGraphEdge[];
    offset: { x: number; y: number; z: number };
    cross_edges: CodeGraphEdge[];
  }>;
};

export type CodeGraphViewContract = {
  projectId?: string | null;
  focusPaths?: string[];
  focusSymbols?: string[];
  nodeLabelAllowlist?: string[];
  edgeTypeAllowlist?: string[];
  showLabels?: boolean;
  maxNodes?: number;
};
