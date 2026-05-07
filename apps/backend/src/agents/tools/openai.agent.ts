import { n8nCallWebhook } from '../connectors/n8n';
import { makeOpenAIChat, type Provider } from '../llm/client';

type RunParams = {
  prompt?: string;
  persona?: string;               // dept persona
  provider?: Provider;            // 'openai' | 'openrouter' (DeepSeek via OpenRouter)
  n8nWebhook?: string;            // optional sub-work
  threadId?: string;              // per-dept memory
  maxSteps?: number;
};

export const openaiAgentTool = {
  id: 'openai-agent',
  name: 'OpenAI Agent (Dept)',
  kind: 'internal',
  endpoint: 'internal:/api/tools/openai-agent',
  enabled: true,
  match: { keywords: ['agent','dept','openai','plan','orchestrate'], weight: 1 },

  async run(p: RunParams) {
    const persona  = p.persona  ?? 'You are the OpenAI Department. Be terse, factual, and stay in your lane.';
    const provider = p.provider ?? 'openai';
    const { client, model } = makeOpenAIChat(provider);
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [
      { role: 'system', content: persona },
    ];

    let toolOutput: unknown = null;
    if (p.n8nWebhook) {
      toolOutput = await n8nCallWebhook(p.n8nWebhook, { prompt: p.prompt });
    }
    const prompt = toolOutput
      ? `${p.prompt ?? 'Assist the user.'}\n\nn8n result:\n${JSON.stringify(toolOutput)}`
      : p.prompt ?? 'Assist the user.';
    messages.push({ role: 'user', content: prompt });

    const response = await client.chat.completions.create({
      model,
      messages,
      max_tokens: 800,
    });

    const output = response.choices?.[0]?.message?.content ?? '';
    return { ok: true, provider, model, output, steps: messages.length };
  }
};
