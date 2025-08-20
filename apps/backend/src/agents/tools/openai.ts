import OpenAI from 'openai';

const client = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

export const openaiTool = {
  id: 'openai',
  name: 'OpenAI',
  kind: 'internal',
  endpoint: 'internal:/api/openai',
  enabled: true,
  match: { keywords: ['openai','llm','chat','summarize','explain','analyze'], weight: 1 },
  async run(params: any) {
    const prompt = params?.prompt ?? params?.q ?? 'Say hello in one short sentence.';
    const model = process.env.OPENAI_MODEL ?? 'gpt-4.1-mini';
    if (!client) {
      return { ok: true, provider: 'stub', model, output: `STUB: ${String(prompt).slice(0,80)}` };
    }
    const r = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: String(prompt) }],
      max_tokens: 300
    });
    const text = r.choices?.[0]?.message?.content ?? '';
    return { ok: true, provider: 'openai', model, output: text };
  }
};
