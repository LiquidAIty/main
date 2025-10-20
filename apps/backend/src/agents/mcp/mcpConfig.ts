import fs from "node:fs";
import path from "node:path";

export type McpServersConfig = Record<string,
  | { transport?: "stdio"; command: string; args?: string[]; restart?: { enabled?: boolean; maxAttempts?: number; delayMs?: number } }
  | { transport?: "sse" | "http"; url: string; headers?: Record<string,string>; automaticSSEFallback?: boolean; reconnect?: { enabled?: boolean; maxAttempts?: number; delayMs?: number } }
>;

export function resolveEnvPlaceholders<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(resolveEnvPlaceholders) as unknown as T;
  const out: any = {};
  for (const [k,v] of Object.entries(obj as any)) {
    if (typeof v === "string") {
      out[k] = v.replace(/\$\{([A-Z0-9_]+)\}/g, (_, key) => process.env[key] ?? "");
    } else out[k] = resolveEnvPlaceholders(v as any);
  }
  return out;
}

export function loadMcpServersConfig(): McpServersConfig {
  const cwd = process.cwd();
  const p1 = path.join(cwd, "mcp.config.json");
  const p2 = path.join(cwd, "apps/backend/mcp.config.json");
  const file = fs.existsSync(p1) ? p1 : (fs.existsSync(p2) ? p2 : "");
  if (!file) return {};
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const resolved = resolveEnvPlaceholders(raw?.mcpServers ?? {});
  
  // Filter out entries with invalid/empty URLs for SSE/HTTP transports
  const filtered: McpServersConfig = {};
  for (const [key, config] of Object.entries(resolved)) {
    const typedConfig = config as any;
    if ('url' in typedConfig) {
      // Skip if URL is empty or still has unresolved placeholders
      if (!typedConfig.url || typedConfig.url.includes('${')) {
        console.warn(`[MCP Config] Skipping server '${key}': invalid or unresolved URL`);
        continue;
      }
    }
    filtered[key] = typedConfig;
  }
  
  return filtered;
}
