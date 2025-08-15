import type { ToolResult } from '../types/agent';
import { mcpTool } from './tools/mcp';
import { n8nTool } from './tools/n8n';
import { openai } from './tools/openai';
import { kimiTool } from './tools/kimi';
import { ragTool } from './tools/rag';
import { memoryTool } from './tools/memory';
import { pythonTool } from './tools/python';
import { uiTool } from './tools/ui';
import { scraperTool } from './tools/scraper';
import { googleTool } from './tools/google';

export type ToolHandler = {
  run: (params: any) => Promise<ToolResult>;
};

export const toolRegistry = new Map<string, ToolHandler>([
  ['openai', openai],
  ['kimi', kimiTool],
  ['mcp', mcpTool],
  ['n8n', n8nTool],
  ['rag', ragTool],
  ['memory', memoryTool],
  ['python', pythonTool],
  ['ui', uiTool],
  ['scraper', scraperTool],
  ['google', googleTool],
]);

export function getTool(name: string): ToolHandler | undefined {
  return toolRegistry.get(name);
}
