import OpenAI from "openai";

const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
  console.warn("[SOL] OPENAI_API_KEY is not set – Sol will throw on use");
}

const openai = apiKey ? new OpenAI({ apiKey }) : null;

const SYSTEM_PROMPT = "You are Sol, a helpful assistant for LiquidAIty. Answer clearly and concisely.";

export async function runSol(goal: string, _context?: any): Promise<string> {
  if (!openai) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const model = process.env.OPENAI_MODEL || "gpt-5.1-chat-latest";

  console.log("[SOL] calling OpenAI", {
    model,
    goalPreview: goal.slice(0, 80)
  });

  const completion = await openai.chat.completions.create({
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: goal }
    ]
  });

  const text = completion.choices?.[0]?.message?.content?.toString().trim() ?? "";

  if (!text) {
    throw new Error("Sol: empty response from OpenAI");
  }

  return text;
}
