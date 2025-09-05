import { Step, Plan } from "./schemas";
import { runLLM } from "../llm/client";
import { dispatchTool } from "../dispatch/dispatcher";

async function execStep(s: Step) {
  switch (s.kind) {
    case "llm": return { [s.id]: await runLLM(s.input?.prompt ?? "No prompt", { modelKey: s.modelKey ?? "gpt-5-nano" }) };
    case "tool": return { [s.id]: await dispatchTool({ kind: (s.input?.kind ?? "internal") as any, name: s.name ?? "?", args: s.input?.args }) };
    case "train": return { [s.id]: { enqueued: true } };
    case "graph": return { [s.id]: { nested: true, note: "Nested graph execution not implemented" } };
    default: throw new Error(`Unknown step kind: ${(s as any).kind}`);
  }
}

export async function runnerNode(input: { plan: Plan }): Promise<{ results: Record<string, any> }> {
  const results: Record<string, any> = {};
  for (const step of input.plan.steps) {
    const result = await execStep(step);
    Object.assign(results, result);
  }
  return { results };
}
