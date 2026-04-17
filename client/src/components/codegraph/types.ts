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
};

export type CodeGraphEdge = {
  source: number;
  target: number;
  type: string;
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
