import { ChatOpenAI } from '@langchain/openai';
import { StateGraph, MessagesAnnotation } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { HumanMessage } from '@langchain/core/messages';
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
    const { apiKey, baseURL, model } = makeOpenAIChat(provider);

    // LangChain ChatOpenAI – pass apiKey/baseURL/model
    const modelLC = new ChatOpenAI({ model, temperature: 0, apiKey, ...(baseURL ? { baseURL } : {}) });

    // tools this department can call
    const tools = [
      {
        name: 'n8n_call_webhook',
        description: 'Trigger an n8n webhook to run sub-workflows for this department.',
        schema: {
          type: 'object',
          properties: { url: { type: 'string' }, payload: { type: 'object' } },
          required: ['url']
        },
        func: async (args: any) => {
          const url = args?.url ?? p.n8nWebhook ?? '';
          if (!url) return { error: 'No n8n webhook URL provided' };
          return await n8nCallWebhook(url, args?.payload ?? { prompt: p.prompt });
        }
      }
    ];

    const toolNode = new ToolNode(tools as any);
    const bound    = modelLC.bindTools(tools as any);

    function shouldContinue({ messages }: typeof MessagesAnnotation.State) {
      const last: any = messages[messages.length - 1];
      return last?.tool_calls?.length ? 'tools' : '__end__';
    }

    async function callModel(state: typeof MessagesAnnotation.State) {
      const messages = [{ role: 'system', content: persona }, ...state.messages];
      const response = await bound.invoke(messages as any);
      return { messages: [response] };
    }

    const graph = new StateGraph(MessagesAnnotation)
      .addNode('agent', callModel)
      .addNode('tools', toolNode)
      .addEdge('__start__', 'agent')
      .addEdge('tools', 'agent')
      .addConditionalEdges('agent', shouldContinue)
      .compile();

    const final = await graph.invoke(
      { messages: [new HumanMessage(p.prompt ?? 'Assist the user.')] },
      { configurable: { thread_id: p.threadId ?? 'dept:openai' } }
    );

    const last = (final as any).messages[(final as any).messages.length - 1] as any;
    return { ok: true, provider, model, output: last?.content, steps: (final as any).messages.length };
  }
};
