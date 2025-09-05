import { ChatOpenAI } from '@langchain/openai';
import { StateGraph, MessagesAnnotation } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { HumanMessage } from '@langchain/core/messages';
import { resolve_model_by_role, type agent_role } from '../../llm/models.config';

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
      role?: agent_role;
      n8nWebhook?: string;
      threadId?: string;
      maxSteps?: number;
    }) {
      const persona = params.persona ?? spec.defaultPersona;
      const role = params.role ?? 'worker';
      const model = resolve_model_by_role(role);
      
      const modelLC = new ChatOpenAI({
        model: model.id,
        openAIApiKey: model.apiKey,
        maxTokens: model.maxTokens,
        ...(model.baseUrl !== 'https://api.openai.com/v1' ? { 
          configuration: { baseURL: model.baseUrl } 
        } : {})
      });

      const tools = [
        {
          name: 'memory_op',
          description: "Store or retrieve information. ops: put|get|all. Example: {op:'put', key:'project', value:'LiquidAIty'}",
          schema: {
            type: 'object',
            properties: {
              op: { type: 'string', enum: ['put', 'get', 'all'] },
              key: { type: 'string' },
              value: { type: 'object' }
            },
            required: ['op']
          },
          func: async (args: any) => {
            // Mock memory for now - can be enhanced later
            const threadId = params.threadId ?? `dept:${spec.id}`;
            if (args.op === 'put') {
              return { success: true, stored: args.key, threadId };
            } else if (args.op === 'get') {
              return { success: true, key: args.key, value: null, threadId };
            } else {
              return { success: true, all: [], threadId };
            }
          }
        },
        {
          name: 'knowledge_graph',
          description: 'Create knowledge graph nodes and relationships from the conversation',
          schema: {
            type: 'object',
            properties: {
              nodes: { type: 'array', items: { type: 'string' } },
              relationships: { type: 'array', items: { type: 'string' } }
            },
            required: ['nodes']
          },
          func: async (args: any) => {
            return {
              success: true,
              nodes: args.nodes || [],
              relationships: args.relationships || [],
              graphId: `kg-${Date.now()}`
            };
          }
        }
      ];

      const toolNode = new ToolNode(tools as any);
      const bound = modelLC.bindTools(tools as any);

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
      return { 
        ok: true, 
        provider: model.provider, 
        model: model.id, 
        output: last?.content, 
        steps: (final as any).messages.length 
      };
    }
  };
}
