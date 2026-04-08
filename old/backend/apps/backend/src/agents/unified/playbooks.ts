import { z } from "zod";
import { uRunTool } from "./registry.unified";

export type Step = {
  name: string;
  tool: string;
  mapInput: (ctx: any) => any;
  saveAs?: string;
};

export type Playbook = {
  id: string;
  title: string;
  params: z.ZodTypeAny;
  steps: Step[];
  description?: string;
};

export const Playbooks: Record<string, Playbook> = {};

export function listPlaybooks() {
  return Object.values(Playbooks).map((playbook) => ({
    id: playbook.id,
    title: playbook.title,
    description: playbook.description,
  }));
}

export async function runPlaybook(id: string, params: any, corrId?: string) {
  const playbook = Playbooks[id];
  if (!playbook) {
    throw new Error(`Playbook not found: ${id}`);
  }
  const parsed = playbook.params.parse(params);
  const ctx: any = { params: parsed, corrId, steps: [] };
  for (const step of playbook.steps) {
    const input = step.mapInput(ctx);
    const started = Date.now();
    const data = await uRunTool(step.tool, input);
    const record = {
      step: step.name,
      tool: step.tool,
      ms: Date.now() - started,
      input,
      ok: true,
    };
    if (step.saveAs) {
      ctx[step.saveAs] = data;
    }
    ctx.steps.push(record);
  }
  return { ok: true, playbook: playbook.id, params: parsed, corrId, results: ctx.steps };
}
