import { z } from "zod";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { ChatOpenAI } from "@langchain/openai";
import { wrapHttpToolAsStructured } from "./wrapHttpTool";
import { knowledgeGraphTool, knowledgeGraphQueryTool } from "./knowledgeGraph.neo4j";
import { getMcpTools } from "../mcp/mcpClient";
import { openaiTool } from "../tools/openai";
import { googleTool } from "../tools/google";
import { n8nTool } from "../tools/n8n";
import { memoryTool } from "../tools/memory";
import { pythonTool } from "../tools/python";
import { scraperTool } from "../tools/scraper";
import { uiTool } from "../tools/ui";
import { playbookTool } from "./playbooks.tool";
import { secTool, SecSchema } from "../tools/sec";
import { marketDataTool, MarketDataSchema } from "../tools/marketdata";
import { esnTool, EsnSchema } from "../tools/esn";

const OpenAISchema = z.object({
  prompt: z.string(),
  model: z.string().optional(),
  params: z.record(z.any()).optional(),
});
const GoogleSchema = z.object({
  op: z.enum(["sheets_append", "docs_append", "drive_upload"]),
  args: z.record(z.any()),
});
const N8NSchema = z.object({
  workflow: z.string().optional(),
  payload: z.record(z.any()).default({}),
});
const MemorySchema = z.object({
  op: z.enum(["get", "set"]).default("get"),
  key: z.string(),
  value: z.any().optional(),
});
const PythonSchema = z.object({
  script: z.string(),
  args: z.array(z.string()).default([]),
});
const ScrapeSchema = z.object({
  url: z.string(),
  selector: z.string().optional(),
});
const UiSchema = z.object({
  event: z.string(),
  payload: z.record(z.any()).optional(),
});

const entries: Record<string, StructuredToolInterface> = {
  knowledge_graph: knowledgeGraphTool,
  knowledge_graph_query: knowledgeGraphQueryTool,
  sec_http: wrapHttpToolAsStructured({
    name: "sec_http",
    description: "SEC EDGAR API",
    schema: SecSchema,
    run: secTool.run,
  }),
  marketdata_http: wrapHttpToolAsStructured({
    name: "marketdata_http",
    description: "Market data proxy (pluggable)",
    schema: MarketDataSchema,
    run: marketDataTool.run,
  }),
  esn_http: wrapHttpToolAsStructured({
    name: "esn_http",
    description: "Echo State Network signal",
    schema: EsnSchema,
    run: esnTool.run,
  }),
  openai_http: wrapHttpToolAsStructured({
    name: "openai_http",
    description: "OpenAI via HTTP runner",
    schema: OpenAISchema,
    run: openaiTool.run,
  }),
  google_http: wrapHttpToolAsStructured({
    name: "google_http",
    description: "Google operations via runner",
    schema: GoogleSchema,
    run: googleTool.run,
  }),
  n8n_http: wrapHttpToolAsStructured({
    name: "n8n_http",
    description: "Trigger n8n workflow",
    schema: N8NSchema,
    run: n8nTool.run,
  }),
  memory_http: wrapHttpToolAsStructured({
    name: "memory_http",
    description: "In-memory key/value store",
    schema: MemorySchema,
    run: memoryTool.run,
  }),
  python_http: wrapHttpToolAsStructured({
    name: "python_http",
    description: "Execute python helper",
    schema: PythonSchema,
    run: pythonTool.run,
  }),
  scraper_http: wrapHttpToolAsStructured({
    name: "scraper_http",
    description: "Scrape HTML/text",
    schema: ScrapeSchema,
    run: scraperTool.run,
  }),
  ui_http: wrapHttpToolAsStructured({
    name: "ui_http",
    description: "UI event bus",
    schema: UiSchema,
    run: uiTool.run,
  }),
  playbook_run: playbookTool,
};

export async function uListTools() {
  const mcpTools = await getMcpTools().catch(() => [] as StructuredToolInterface[]);
  const locals = Object.values(entries).map((tool) => ({
    id: (tool as any).name,
    kind: "structured" as const,
    title: (tool as any).name,
    description: (tool as any).description,
  }));
  const remote = mcpTools.map((tool: StructuredToolInterface) => ({
    id: tool.name,
    kind: "structured" as const,
    title: tool.name,
    description: tool.description,
  }));
  return [...locals, ...remote];
}

export async function uRunTool(name: string, input: unknown) {
  const local = entries[name];
  if (local) {
    return await local.invoke(input);
  }
  const mcpTools = await getMcpTools().catch(() => [] as StructuredToolInterface[]);
  const tool = mcpTools.find((entry: StructuredToolInterface) => entry.name === name);
  if (!tool) {
    throw new Error(`Tool not found: ${name}`);
  }
  return await tool.invoke(input);
}

export async function buildUnifiedModelWithTools() {
  const mcpTools = await getMcpTools().catch(() => [] as StructuredToolInterface[]);
  const locals = Object.values(entries);
  const model = new ChatOpenAI({
    model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  });
  return model.bindTools([...locals, ...mcpTools]);
}
