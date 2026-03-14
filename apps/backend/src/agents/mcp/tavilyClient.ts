import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema, ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { loadMcpServersConfig } from './mcpConfig';
import type { ResearchTargetPacket, TavilySearchResult } from '../../services/research/types';

type TavilyTransport =
  | StreamableHTTPClientTransport
  | SSEClientTransport;

type TavilyRemoteConfig = {
  transport?: 'http' | 'sse';
  url: string;
  headers?: Record<string, string>;
};

function safeJsonParse(text: string): any | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, any> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, any>;
}

function normalizeToolName(name: string): string {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_');
}

function normalizeContentBlocks(content: unknown): any {
  if (!Array.isArray(content)) return null;
  const textBlocks = content
    .map((block) => asRecord(block))
    .filter((block): block is Record<string, any> => Boolean(block));

  for (const block of textBlocks) {
    if (block.type === 'json' && block.json && typeof block.json === 'object') {
      return block.json;
    }
    if (block.type === 'tool_result' && block.content && Array.isArray(block.content)) {
      const nested = normalizeContentBlocks(block.content);
      if (nested) return nested;
    }
    if (block.type === 'resource' && block.resource && typeof block.resource === 'object') {
      const resource = asRecord(block.resource);
      if (resource && typeof resource.text === 'string') {
        return safeJsonParse(resource.text) ?? { text: resource.text };
      }
    }
  }

  const combinedText = textBlocks
    .map((block) => {
      if (typeof block.text === 'string') return block.text;
      if (typeof block.content === 'string') return block.content;
      return '';
    })
    .filter(Boolean)
    .join('\n');

  if (!combinedText.trim()) return null;
  return safeJsonParse(combinedText) ?? { text: combinedText };
}

function normalizeToolOutput(output: unknown): any {
  if (output == null) return {};
  if (typeof output === 'string') {
    return safeJsonParse(output) ?? { text: output };
  }
  if (Array.isArray(output)) {
    return normalizeContentBlocks(output) ?? { content: output };
  }
  const record = asRecord(output);
  if (!record) return { value: output };
  if (record.structuredContent && typeof record.structuredContent === 'object') {
    return record.structuredContent;
  }
  if (Array.isArray(record.content)) {
    return normalizeContentBlocks(record.content) ?? record;
  }
  if (typeof record.content === 'string') {
    return safeJsonParse(record.content) ?? record;
  }
  return record;
}

function coerceString(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text ? text : null;
}

function coerceResults(payload: any): TavilySearchResult[] {
  const candidates = [
    payload?.results,
    payload?.data?.results,
    payload?.search_results,
    payload?.data,
  ];
  const rawResults = candidates.find((entry) => Array.isArray(entry));
  if (!Array.isArray(rawResults)) return [];

  const out: TavilySearchResult[] = [];
  rawResults.forEach((raw) => {
    const row = asRecord(raw);
    if (!row) return;
    const url = coerceString(row.url);
    if (!url) return;
    out.push({
      url,
      title: coerceString(row.title) || url,
      content: coerceString(row.content) ?? undefined,
      rawContent: coerceString(row.raw_content ?? row.rawContent) ?? undefined,
      snippet: coerceString(row.snippet) ?? undefined,
      summary: coerceString(row.summary ?? row.answer) ?? undefined,
      score: Number.isFinite(Number(row.score)) ? Number(row.score) : null,
      publishedAt: coerceString(row.published_date ?? row.publishedAt) ?? undefined,
      metadata: row,
    });
  });
  return out;
}

function findTavilySearchTool(tools: Array<{ name?: string; description?: string }>, preferredToolNames: string[] = []): { name: string; description?: string } | null {
  const preferredSet = new Set(
    preferredToolNames
      .map((name) => normalizeToolName(name))
      .filter(Boolean),
  );
  if (preferredSet.size > 0) {
    const preferred = tools.find((tool) => preferredSet.has(normalizeToolName(tool.name || '')));
    if (preferred?.name) return preferred as { name: string; description?: string };
  }

  const exactNames = new Set(['tavily_search', 'tavily_search_results_json', 'tavily_search_results', 'tavily-search']);
  const exact = tools.find((tool) => exactNames.has(normalizeToolName(tool.name || '')));
  if (exact?.name) return exact as { name: string; description?: string };

  const heuristic = tools.find((tool) => {
    const normalizedName = normalizeToolName(tool.name || '');
    const description = normalizeToolName(String(tool.description || ''));
    const joined = `${normalizedName} ${description}`;
    return joined.includes('tavily') && joined.includes('search');
  });
  return heuristic?.name ? (heuristic as { name: string; description?: string }) : null;
}

function extractToolNameHints(toolsConfig: any[] = []): string[] {
  return toolsConfig
    .flatMap((entry) => {
      const record = asRecord(entry);
      if (!record) return [];
      return [record.name, record.tool, record.tool_name]
        .map((value) => String(value ?? '').trim())
        .filter(Boolean);
    });
}

function resolveTavilyConfig(): TavilyRemoteConfig {
  const config = loadMcpServersConfig();
  const entry = config.tavily as TavilyRemoteConfig | undefined;
  if (!entry || !entry.url) {
    throw new Error('tavily_mcp_config_missing');
  }
  return {
    transport: entry.transport === 'sse' ? 'sse' : 'http',
    url: String(entry.url).trim(),
    headers:
      entry.headers && typeof entry.headers === 'object'
        ? Object.fromEntries(
            Object.entries(entry.headers)
              .map(([key, value]) => [String(key), String(value ?? '').trim()])
              .filter(([, value]) => value.length > 0),
          )
        : undefined,
  };
}

async function withTimeout<T>(label: string, ms: number, fn: () => Promise<T>): Promise<T> {
  let timeoutId: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      fn(),
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`${label}_timeout_${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function createTavilyClient(config: TavilyRemoteConfig): Promise<{ client: Client; transport: TavilyTransport }> {
  const client = new Client({ name: 'research-agent-tavily', version: '1.0.0' });
  const requestInit = config.headers ? { headers: config.headers } : undefined;
  const eventSourceInit = config.headers
    ? {
        fetch: (input: RequestInfo | URL, init?: RequestInit) =>
          fetch(input, {
            ...init,
            headers: {
              ...(init?.headers && typeof init.headers === 'object' ? init.headers : {}),
              ...config.headers,
            },
          }),
      }
    : undefined;
  const transport =
    config.transport === 'sse'
      ? new SSEClientTransport(new URL(config.url), {
          eventSourceInit,
          requestInit,
        })
      : new StreamableHTTPClientTransport(new URL(config.url), {
          requestInit,
        });

  await withTimeout('tavily_connect', 20_000, () => client.connect(transport));
  return { client, transport };
}

export async function tavilySearch(
  packet: ResearchTargetPacket,
  opts?: { toolsConfig?: any[] },
): Promise<{ toolName: string; results: TavilySearchResult[]; raw: any }> {
  const preferredToolNames = extractToolNameHints(opts?.toolsConfig ?? []);
  const config = resolveTavilyConfig();
  const { client, transport } = await createTavilyClient(config);

  try {
    const list = await withTimeout('tavily_tools_list', 20_000, () =>
      client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema),
    );
    const searchTool = findTavilySearchTool(Array.isArray(list?.tools) ? list.tools : [], preferredToolNames);
    if (!searchTool?.name) {
      const available = Array.isArray(list?.tools)
        ? list.tools.map((tool) => tool?.name).filter(Boolean).join(', ')
        : '';
      throw new Error(`tavily_mcp_tool_missing: ${available || 'no_tavily_tools_loaded'}`);
    }

    const attempts = [
      {
        query: packet.query,
        max_results: packet.maxResults,
        search_depth: packet.searchDepth,
        topic: 'general',
        include_raw_content: true,
      },
      {
        query: packet.query,
        max_results: packet.maxResults,
        search_depth: packet.searchDepth,
        topic: 'general',
        include_raw_content: false,
      },
      {
        query: packet.query,
        max_results: packet.maxResults,
        search_depth: packet.searchDepth,
      },
      {
        query: packet.query,
      },
    ];

    let rawResponse: any = null;
    let lastSchemaError: any = null;
    for (const input of attempts) {
      try {
        rawResponse = await withTimeout('tavily_call', 30_000, () =>
          client.request(
            {
              method: 'tools/call',
              params: {
                name: searchTool.name,
                arguments: input,
              },
            },
            CallToolResultSchema,
          ),
        );
        lastSchemaError = null;
        break;
      } catch (err: any) {
        const message = String(err?.message || err);
        if (!message.toLowerCase().includes('schema')) {
          throw err;
        }
        lastSchemaError = err;
      }
    }
    if (lastSchemaError) {
      throw lastSchemaError;
    }

    if (rawResponse?.isError) {
      const normalizedError = normalizeToolOutput(rawResponse);
      const errorMessage =
        coerceString(normalizedError?.error) ||
        coerceString(normalizedError?.message) ||
        coerceString(normalizedError?.text) ||
        'tavily_tool_call_failed';
      throw new Error(errorMessage);
    }

    const normalized = normalizeToolOutput(rawResponse);
    const results = coerceResults(normalized);
    return {
      toolName: String(searchTool.name || 'tavily_search'),
      results,
      raw: normalized,
    };
  } finally {
    await transport.close().catch(() => undefined);
  }
}
