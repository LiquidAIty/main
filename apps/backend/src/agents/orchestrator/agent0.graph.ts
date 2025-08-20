import { StateGraph, Annotation, END } from '@langchain/langgraph';
import { routeQuery } from './sol';
import { getTool } from '../registry';

const Agent0State = Annotation.Root({
  q: Annotation<string>(),
  depts: Annotation<Array<{ id: string; prompt: string; provider?: 'openai'|'openrouter'; persona?: string; n8nWebhook?: string }>>({
    value: (_current, next) => next,
    default: () => []
  }),
  results: Annotation<Record<string, any>>({
    value: (_current, next) => next,
    default: () => ({})
  }),
});

async function plan(state: typeof Agent0State.State) {
  const routed = await routeQuery({ q: (state as any).q, meta: {} });
  const primary = routed.tool?.id ? [{ id: routed.tool.id, prompt: (state as any).q }] : [];
  // keep departments isolated; optionally add more here
  const extras: typeof primary = []; // e.g., [{ id: 'openai-agent', prompt: 'Extract 3 bullets', provider: 'openrouter' }]
  return { depts: [...primary, ...extras] } as any;
}

async function runParallel(state: typeof Agent0State.State) {
  const out: Record<string, any> = { ...((state as any).results || {}) };
  await Promise.all(((state as any).depts ?? []).map(async (d: any) => {
    const tool = getTool(d.id) as any;
    if (!tool?.run) { out[d.id] = { error: 'tool unavailable' }; return; }
    out[d.id] = await tool.run({
      prompt: d.prompt,
      provider: d.provider,
      persona: d.persona,
      n8nWebhook: d.n8nWebhook,
      threadId: `dept:${d.id}`,
    });
  }));
  return { results: out } as any;
}

async function reduce(state: typeof Agent0State.State) {
  const results = (state as any).results as Record<string, any>;
  const combined = Object.entries(results)
    .map(([k, v]) => `### ${k}\n${typeof v === 'string' ? v : JSON.stringify(v, null, 2)}`)
    .join('\n\n');
  return { results: { ...results, __final__: combined } } as any;
}

export function buildAgent0() {
  return new StateGraph(Agent0State)
    .addNode('plan', plan)
    .addNode('run', runParallel)
    .addNode('reduce', reduce)
    .addEdge('__start__', 'plan')
    .addEdge('plan', 'run')
    .addEdge('run', 'reduce')
    .addEdge('reduce', END)
    .compile();
}
