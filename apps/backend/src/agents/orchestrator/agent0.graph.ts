import { StateGraph, Annotation, END } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import { routeQuery } from './sol';
import { getTool } from '../registry';
import type { Entity, Gap, Forecast } from '../../types/kg';

// Use Sol-style config: OPENAI_MODEL or default to gpt-5.1
const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-5.1';
let cachedModel: ChatOpenAI | null = null;

function getChatModel() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set. Configure it to run Agent-0.');
  }
  if (!cachedModel) {
    cachedModel = new ChatOpenAI({
      model: DEFAULT_MODEL,
      openAIApiKey: apiKey,
      timeout: 45000
    });
  }
  return cachedModel;
}

function toText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && 'text' in item) {
          return (item as { text?: string }).text ?? '';
        }
        return '';
      })
      .join('\n')
      .trim();
  }
  if (content && typeof content === 'object' && 'text' in content) {
    return String((content as { text?: string }).text ?? '');
  }
  return typeof content === 'undefined' || content === null ? '' : String(content);
}

const Agent0State = Annotation.Root({
  q: Annotation<string>(),
  entities: Annotation<Entity[]>({
    value: (_current, next) => next,
    default: () => []
  }),
  docs: Annotation<any[]>({
    value: (_current, next) => next,
    default: () => []
  }),
  gaps: Annotation<Gap[]>({
    value: (_current, next) => next,
    default: () => []
  }),
  forecasts: Annotation<Forecast[]>({
    value: (_current, next) => next,
    default: () => []
  }),
  answer: Annotation<string>({
    value: (_current, next) => next,
    default: () => ''
  }),
  writes: Annotation<{ entities: string[]; relations: string[]; gaps: string[]; forecasts: string[] }>({
    value: (_current, next) => next,
    default: () => ({ entities: [], relations: [], gaps: [], forecasts: [] })
  }),
  // Legacy fields for backward compatibility
  depts: Annotation<Array<{ id: string; prompt: string; provider?: 'openai'|'openrouter'; persona?: string; n8nWebhook?: string }>>({
    value: (_current, next) => next,
    default: () => []
  }),
  results: Annotation<Record<string, any>>({
    value: (_current, next) => next,
    default: () => ({})
  }),
});

async function composeAnswer(state: typeof Agent0State.State) {
  const q = (state as any).q;
  const model = getChatModel();
  const prompt = [
    'You are the LiquidAIty orchestrator agent.',
    'Provide a concise, actionable response to the user goal.',
    'If data is missing, call it out honestly and suggest next steps.'
  ].join('\n');
  const response = await model.invoke([
    { role: 'system', content: prompt },
    { role: 'user', content: q }
  ]);
  const answer = toText(response.content).trim() || 'No response produced.';
  return { answer, results: { __final__: answer } } as any;
}

// Legacy plan function for backward compatibility
async function legacyPlan(state: typeof Agent0State.State) {
  const routed = await routeQuery({ q: (state as any).q, meta: {} });
  const primary = routed.tool?.id ? [{ id: routed.tool.id, prompt: (state as any).q }] : [];
  const extras: typeof primary = [];
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

// No-op placeholders to keep the full pipeline stable even when external services are offline
async function plan(_state: typeof Agent0State.State) {
  return {};
}

async function ingestOrRetrieve(_state: typeof Agent0State.State) {
  console.warn("[Agent0] ingest_or_retrieve skipped (no connectors configured)");
  return {};
}

async function buildKg(_state: typeof Agent0State.State) {
  console.warn("[Agent0] build_kg skipped (no KG backend configured)");
  return {};
}

async function gapEnrich(_state: typeof Agent0State.State) {
  return {};
}

async function forecast(_state: typeof Agent0State.State) {
  return {};
}

// Export both new and legacy orchestrators
export function buildAgent0(mode: 'full' | 'legacy' = 'full') {
  if (mode === 'legacy') {
    // Legacy mode: keep old behavior
    return new StateGraph(Agent0State)
      .addNode('plan', legacyPlan)
      .addNode('run', runParallel)
      .addNode('reduce', reduce)
      .addEdge('__start__', 'plan')
      .addEdge('plan', 'run')
      .addEdge('run', 'reduce')
      .addEdge('reduce', END)
      .compile();
  }
  
  // Full pipeline: ingest → build KG → enrich with gaps → forecast with ESN → answer with RAG → write back to KG
  return new StateGraph(Agent0State)
    .addNode('plan', plan)
    .addNode('ingest_or_retrieve', ingestOrRetrieve)
    .addNode('build_kg', buildKg)
    .addNode('gap_enrich', gapEnrich)
    .addNode('forecast', forecast)
    .addNode('compose_answer', composeAnswer)
    .addEdge('__start__', 'plan')
    .addEdge('plan', 'ingest_or_retrieve')
    .addEdge('ingest_or_retrieve', 'build_kg')
    .addEdge('build_kg', 'gap_enrich')
    .addEdge('gap_enrich', 'forecast')
    .addEdge('forecast', 'compose_answer')
    .addEdge('compose_answer', END)
    .compile();
}
