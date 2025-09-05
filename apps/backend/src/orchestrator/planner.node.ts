import { PlanSchema, Plan } from "./schemas";
import { runLLM } from "../llm/client";

export async function plannerNode(input: { goal: string }): Promise<{ plan: Plan }> {
  const system = `
you are the planner. output only json that matches the existing planschema and stepschema in orchestrator/schemas.ts.
rules:
- use "tool" for external action (mcp, n8n, internal)
- use "llm" for formatting/summarization/codegen
- use "train" to enqueue non-blocking jobs
- default worker model is "gpt-5-nano" unless "modelkey" is set
- max 8 steps
- return valid json only
`;

  const prompt = `
goal: ${input.goal}
schema: ${PlanSchema.toString()}
return only json.
`;
  const out = await runLLM(`${system}\n\n${prompt}`, { modelKey: "gpt-5", temperature: 0.1, maxTokens: 1200 });
  const plan = PlanSchema.parse(JSON.parse(out.text));
  return { plan };
}
