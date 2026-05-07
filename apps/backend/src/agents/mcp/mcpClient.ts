export type McpToolInfo = {
  name: string;
};

const MCP_UNAVAILABLE_MESSAGE =
  'MCP tools unavailable: direct MCP client not yet implemented after LangChain removal.';

export async function getMcpTools(): Promise<McpToolInfo[]> {
  throw new Error(MCP_UNAVAILABLE_MESSAGE);
}

export async function refreshMcpTools(): Promise<number> {
  throw new Error(MCP_UNAVAILABLE_MESSAGE);
}

export async function closeMcp() {
  return undefined;
}
