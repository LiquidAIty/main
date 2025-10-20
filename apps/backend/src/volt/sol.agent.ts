import { Agent } from "@voltagent/core";

const SYSTEM_PROMPT =
  "Be concise. No placeholders. If something cannot be verified, say 'not verified'.";

function createAgent(): Agent {
  const modelName = process.env.OPENAI_MODEL || "gpt-4o-mini";
  return new Agent({
    name: "SOL",
    instructions: SYSTEM_PROMPT,
    model: modelName,
  });
}

export async function runSol(goal: string): Promise<string> {
  console.log("[VOLT] runSol start");
  const agent = createAgent();
  const result: any = await agent.generateText(goal);
  const text = result?.response?.text ?? result?.text ?? "";
  if (!text) throw new Error("VoltAgent returned empty text");
  return text;
}
