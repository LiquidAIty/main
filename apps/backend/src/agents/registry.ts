import { mcpTool } from './tools/mcp';
import { openaiTool } from './tools/openai';
import { openaiAgentTool } from './tools/openai.agent';
import { n8nTool } from './tools/n8n';
import { googleTool } from './tools/google';
import { pythonTool } from './tools/python';
import { ragTool } from './tools/rag';
import { scraperTool } from './tools/scraper';
import { memoryTool } from './tools/memory';
import { uiTool } from './tools/ui';

export type ToolBase = {
  id: string;
  name: string;
  kind: 'internal' | 'external';
  endpoint: string;
  match?: { keywords: string[]; weight?: number };
  enabled?: boolean;
};

export type Tool = ToolBase & {
  run: (params: any) => Promise<any>;
};

function isTool(x: any): x is Tool {
  return !!x && typeof x.id === 'string' && typeof x.run === 'function';
}

const TOOL_LIST: Tool[] = [
  mcpTool,
  openaiTool,
  openaiAgentTool,
  n8nTool,
  googleTool,
  pythonTool,
  ragTool,
  scraperTool,
  memoryTool,
  uiTool,
].filter(isTool);

export function listTools(): Tool[] {
  return TOOL_LIST.filter(t => t.enabled ?? true);
}

export function getTool(idOrName: string): Tool | undefined {
  const s = String(idOrName).toLowerCase();
  return listTools().find(t =>
    t.id.toLowerCase() === s || t.name.toLowerCase() === s
  );
}

export function matchTools(q: string): Array<{ tool: Tool; score: number; hits: number; total: number }> {
  const text = (q ?? '').toLowerCase();
  return listTools()
    .map(tool => {
      const kw = tool.match?.keywords ?? [];
      const hits = kw.filter(k => text.includes(k.toLowerCase())).length;
      const score = hits > 0 ? (tool.match?.weight ?? 1) * (hits / Math.max(kw.length, 1)) : 0;
      return { tool, score, hits, total: kw.length };
    })
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score);
}

// Back-compat map for any legacy usages (optional, retained)
export const toolRegistry = new Map<string, { run: Tool['run'] }>(
  listTools().map(t => [t.id, { run: t.run }])
);
