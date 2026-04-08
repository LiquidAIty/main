import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";

export type ToolImpl<T extends z.ZodTypeAny, R = unknown> =
  (args: z.infer<T>) => Promise<R> | R;

export function makeZodTool<T extends z.ZodTypeAny>(opts: {
  name: string;
  description: string;
  schema: T;
  func: ToolImpl<T, string | object>;
}) {
  return new DynamicStructuredTool({
    name: opts.name,
    description: opts.description,
    schema: opts.schema,
    func: async (input) => {
      const parsed = opts.schema.parse(input);
      const out = await opts.func(parsed);
      return typeof out === "string" ? out : JSON.stringify(out);
    },
  });
}

export const Z = {
  str: (d?: string) => z.string().min(1).describe(d ?? ""),
  optStr: (d?: string) => z.string().min(1).describe(d ?? "").optional(),
  bool: (d?: string) => z.boolean().describe(d ?? ""),
  num: (d?: string) => z.number().describe(d ?? ""),
  strArr: (d?: string) => z.array(z.string()).describe(d ?? "")
};
