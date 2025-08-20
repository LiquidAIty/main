import { ChatOpenAI } from '@langchain/openai';
import { StateGraph, MessagesAnnotation } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { HumanMessage } from '@langchain/core/messages';
import { n8nCallWebhook } from '../connectors/n8n';
import { makeOpenAIChat, type Provider } from '../llm/client';

export type DeptAgentSpec = {
  id: string;
  name: string;
  defaultPersona: string;
  matchKeywords: string[];
};

export function createDeptAgent(spec: DeptAgentSpec) {
  return {
    id: spec.id,
    name: spec.name,
    kind: 'internal' as const,
    endpoint: `internal:/api/tools/${spec.id}`,
    enabled: true,
    match: { keywords: spec.matchKeywords, weight: 1 },

    async run(params: {
      prompt?: string;
      persona?: string;
      provider?: Provider;      // 'openai' | 'openrouter'
      n8nWebhook?: string;      // optional dept webhook
      threadId?: string;
      maxSteps?: number;
    }) {
      const persona  = params.persona  ?? spec.defaultPersona;
      const provider = params.provider ?? 'openai';
      const { apiKey, baseURL, model } = makeOpenAIChat(provider);
      const modelLC = new ChatOpenAI({ model, temperature: 0, apiKey, ...(baseURL ? { baseURL } : {}) });

      const tools = [{
        name: 'n8n_call_webhook',
        description: `Trigger ${spec.name} sub-workflow via n8n webhook.`,
        schema: { type: 'object', properties: { url: { type: 'string' }, payload: { type: 'object' } }, required: ['url'] },
        func: async (args: any) =>
          n8nCallWebhook(args?.url ?? params.n8nWebhook ?? '', args?.payload ?? { prompt: params.prompt }),
      }];

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
        { messages: [new HumanMessage(params.prompt ?? 'Assist the user.')] },
        { configurable: { thread_id: params.threadId ?? `dept:${spec.id}` } }
      );

      const last = (final as any).messages[(final as any).messages.length - 1] as any;
      return { ok: true, provider, model, output: last?.content, steps: (final as any).messages.length };
    }
  };
}
