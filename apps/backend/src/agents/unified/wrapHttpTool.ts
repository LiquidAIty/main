import { type ZodTypeAny } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";

type ToolEnvelope<T = unknown> = {
  ok: boolean;
  data: T | null;
  error: string | null;
  meta: unknown;
};

function toEnvelope(out: unknown): ToolEnvelope {
  if (typeof out === "string") {
    return { ok: true, data: out, error: null, meta: null };
  }
  if (out && typeof out === "object") {
    const obj = out as Record<string, unknown>;
    const ok = typeof obj.ok === "boolean" ? (obj.ok as boolean) : true;
    const data = (obj.data ?? (ok ? obj : null)) as unknown;
    const error = (obj.error as string | undefined) ?? (ok ? null : "unknown error");
    const meta = obj.meta ?? null;
    return { ok, data, error, meta };
  }
  return { ok: true, data: out ?? null, error: null, meta: null };
}

export function wrapHttpToolAsStructured(opts: {
  name: string;
  description: string;
  schema: ZodTypeAny;
  run: (input: any) => Promise<any>;
}) {
  const { name, description, schema, run } = opts;
  return new DynamicStructuredTool({
    name,
    description,
    schema,
    func: async (input) => {
      const validated = schema.parse(input);
      const raw = await run(validated);
      const envelope = toEnvelope(raw);
      return JSON.stringify(envelope);
    },
  });
}
