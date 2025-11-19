import { z } from "zod";
import { makeZodTool, Z } from "./zodTools";
import { createRagTool } from '../../tools/rag';

export function createAgentTools(specId: string, threadId?: string) {
  const memoryTool = makeZodTool({
    name: 'memory_op',
    description: "Store or retrieve information. ops: put|get|all. Example: {op:'put', key:'project', value:'LiquidAIty'}",
    schema: z.object({
      op: z.enum(['put', 'get', 'all']),
      key: Z.optStr("Key for put/get"),
      value: z.any().optional()
    }),
    func: async ({ op, key, value }) => {
      const tid = threadId ?? `dept:${specId}`;
      if (op === 'put') {
        return { success: true, stored: key, threadId: tid };
      } else if (op === 'get') {
        return { success: true, key, value: null, threadId: tid };
      } else {
        return { success: true, all: [], threadId: tid };
      }
    }
  });

  const ragTool = createRagTool();

  return [memoryTool, ragTool];
}
