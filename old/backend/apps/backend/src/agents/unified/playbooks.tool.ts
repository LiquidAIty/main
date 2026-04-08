import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { runPlaybook } from "./playbooks";

export const playbookTool = new DynamicStructuredTool({
  name: "playbook_run",
  description: "Execute a named playbook with params",
  schema: z.object({
    name: z.string(),
    params: z.record(z.any()).default({}),
    corrId: z.string().optional(),
  }),
  func: async ({ name, params, corrId }) => {
    const result = await runPlaybook(name, params, corrId);
    return JSON.stringify(result);
  },
});
