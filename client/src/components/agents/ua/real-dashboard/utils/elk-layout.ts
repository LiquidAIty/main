export interface ElkChild {
  id: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
}

export interface ElkEdge {
  id: string;
  sources: string[];
  targets: string[];
}

export interface ElkInput {
  id: string;
  children?: ElkChild[];
  edges?: ElkEdge[];
}

export function applyElkLayout(
  input: ElkInput,
  _options?: { strict?: boolean },
): Promise<{ positioned: ElkInput; issues: [] }> {
  return Promise.resolve({ positioned: input, issues: [] });
}
