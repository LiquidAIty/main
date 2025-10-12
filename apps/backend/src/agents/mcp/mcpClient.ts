import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { loadMcpServersConfig } from "./mcpConfig";

let client: MultiServerMCPClient | null = null;
let cachedTools: StructuredToolInterface[] = [];

export async function getMcpTools(): Promise<StructuredToolInterface[]> {
  const cfg = loadMcpServersConfig();
  if (!client) {
    client = new MultiServerMCPClient({
      mcpServers: cfg,
      // recommended for new apps (normalized tool outputs)
      useStandardContentBlocks: true,
      // prefixToolNameWithServerName: true,  // uncomment if you want names like "filesystem.read_file"
      throwOnLoadError: false  // Don't fail if MCP servers aren't configured
    } as any);
  }
  // lazily load or reload tools
  if (cachedTools.length === 0) {
    try {
      cachedTools = await client.getTools();
    } catch (e) {
      console.warn('[MCP] Failed to load tools:', e instanceof Error ? e.message : e);
      cachedTools = [];
    }
  }
  return cachedTools;
}

export async function refreshMcpTools(): Promise<number> {
  cachedTools = [];
  const tools = await getMcpTools();
  return tools.length;
}

export async function closeMcp() {
  if (client) await client.close();
  client = null;
  cachedTools = [];
}
