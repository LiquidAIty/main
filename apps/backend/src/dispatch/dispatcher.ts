type ToolCall = { kind: "mcp" | "n8n" | "internal"; name: string; args?: any };

export async function dispatchTool(call: ToolCall) {
  switch (call.kind) {
    case "mcp":
      return { ok: true, via: "mcp", ...call }; // stub
    case "n8n":
      return { ok: true, via: "n8n", ...call }; // stub
    case "internal":
      if (call.name === "sum") return { result: call.args.a + call.args.b };
      return { ok: true, via: "internal", ...call };
    default:
      throw new Error(`Bad tool kind: ${(call as any).kind}`);
  }
}
