import { StateGraph, Annotation, END } from '@langchain/langgraph';
import { routeQuery } from './sol';
import { getTool } from '../registry';
import type { Entity, Gap, Forecast } from '../../types/kg';

// Lazy imports to avoid circular dependencies
const getConnectors = async () => ({
  graphlit: await import('../../connectors/graphlit.mcp.js'),
  infranodus: await import('../../connectors/infranodus.mcp.js'),
  esn: await import('../../connectors/esn.js'),
  neo4j: await import('../../connectors/neo4j.js')
});

// Extended state for full pipeline: ingest → build KG → enrich with gaps → forecast with ESN → answer with RAG → write back to KG
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

// New pipeline nodes
async function plan(state: typeof Agent0State.State) {
  // Extract entities/time/geo from query (simple keyword extraction for now)
  const q = (state as any).q;
  const entities: Entity[] = [];
  
  // Simple entity extraction - look for capitalized words or known patterns
  const words = q.split(/\s+/);
  const capitalizedWords = words.filter((w: string) => /^[A-Z][a-z]+/.test(w));
  
  capitalizedWords.forEach((word: string, idx: number) => {
    entities.push({
      id: `entity-${word.toLowerCase()}-${idx}`,
      labels: ['Entity'],
      properties: { name: word, source: 'query' }
    });
  });
  
  return { entities } as any;
}

async function ingestOrRetrieve(state: typeof Agent0State.State) {
  const q = (state as any).q;
  let docs: any[] = [];
  
  try {
    const { graphlit } = await getConnectors();
    // Check if query references URL/file
    const urlMatch = q.match(/https?:\/\/[^\s]+/);
    
    if (urlMatch) {
      // Ingest then retrieve
      await graphlit.ingest({ url: urlMatch[0] });
      const retrieveResult = await graphlit.retrieve({ query: q, limit: 5 });
      docs = retrieveResult.documents || [];
    } else {
      // Direct retrieve
      const retrieveResult = await graphlit.retrieve({ query: q, limit: 5 });
      docs = retrieveResult.documents || [];
    }
  } catch (error) {
    console.warn('[ingestOrRetrieve] Error:', error);
  }
  
  return { docs } as any;
}

async function buildKg(state: typeof Agent0State.State) {
  const entities = (state as any).entities || [];
  const docs = (state as any).docs || [];
  const writes: any = { entities: [], relations: [], gaps: [], forecasts: [] };
  
  try {
    const { neo4j } = await getConnectors();
    // Write entities to Neo4j
    for (const entity of entities) {
      await neo4j.upsertEntity(entity);
      writes.entities.push(entity.id);
    }
    
    // Attach docs as (:Document)-[:ABOUT]->(:Entity)
    for (const doc of docs) {
      const docId = `doc-${doc.id}`;
      await neo4j.upsertEntity({ id: docId, labels: ['Document'], properties: { content: doc.content, score: doc.score } });
      
      for (const entity of entities) {
        await neo4j.upsertRelation({ sourceId: docId, targetId: entity.id, type: 'ABOUT' });
        writes.relations.push(`${docId}-ABOUT->${entity.id}`);
      }
    }
  } catch (error) {
    console.warn('[buildKg] Error:', error);
  }
  
  return { writes } as any;
}

async function gapEnrich(state: typeof Agent0State.State) {
  const docs = (state as any).docs || [];
  const writes: any = (state as any).writes || { entities: [], relations: [], gaps: [], forecasts: [] };
  
  if (docs.length === 0) return { gaps: [], writes };
  
  try {
    const { infranodus, neo4j } = await getConnectors();
    // Get content gaps from InfraNodus
    const summary = docs.map((d: any) => d.content).join('\n').slice(0, 5000);
    const gapResult = await infranodus.contentGaps({ text: summary });
    const gaps = gapResult.gaps || [];
    
    // Persist gaps as (:Gap)-[:BETWEEN]->(:Topic)
    for (const gap of gaps) {
      const gapId = `gap-${gap.from}-${gap.to}`;
      await neo4j.upsertEntity({ id: gapId, labels: ['Gap'], properties: { from: gap.from, to: gap.to, strength: gap.strength } });
      writes.gaps.push(gapId);
    }
    
    return { gaps, writes } as any;
  } catch (error) {
    console.warn('[gapEnrich] Error:', error);
    return { gaps: [], writes };
  }
}

async function forecast(state: typeof Agent0State.State) {
  const entities = (state as any).entities || [];
  const writes: any = (state as any).writes || { entities: [], relations: [], gaps: [], forecasts: [] };
  const forecasts: Forecast[] = [];
  
  try {
    const { esn, neo4j } = await getConnectors();
    // For each entity, check if it has time-series data
    for (const entity of entities) {
      const points = await neo4j.getTimeSeriesPoints(entity.id, 100);
      
      if (points.length >= 10) {
        // Call ESN service
        const series: Array<[number, number]> = points.map((p: any) => [p.t, p.v]);
        const esnResult = await esn.fitPredict({ series, horizon: 14, rls_lambda: 0.99, leak_rate: 0.3 });
        
        if (esnResult.forecast.length > 0) {
          const forecastId = `forecast-${entity.id}-${Date.now()}`;
          await neo4j.upsertEntity({
            id: forecastId,
            labels: ['Forecast'],
            properties: { entityId: entity.id, horizon: 14, model: 'ESN-RLS', metrics: esnResult.metrics }
          });
          await neo4j.upsertRelation({ sourceId: forecastId, targetId: entity.id, type: 'FOR' });
          
          forecasts.push({
            entityId: entity.id,
            horizon: 14,
            model: 'ESN-RLS',
            predictions: esnResult.forecast,
            metrics: esnResult.metrics
          });
          
          writes.forecasts.push(forecastId);
        }
      }
    }
  } catch (error) {
    console.warn('[forecast] Error:', error);
  }
  
  return { forecasts, writes } as any;
}

async function composeAnswer(state: typeof Agent0State.State) {
  const docs = (state as any).docs || [];
  const gaps = (state as any).gaps || [];
  const forecasts = (state as any).forecasts || [];
  const entities = (state as any).entities || [];
  
  let answer = '## Analysis Results\n\n';
  
  if (entities.length > 0) {
    const entityNames = entities.map((e: Entity) => e.properties?.name || 'Unknown').join(', ');
    answer += 'Entities Found: ' + entityNames + '\n\n';
  }
  
  if (docs.length > 0) {
    answer += 'Sources (' + docs.length + ' documents):\n';
    docs.slice(0, 3).forEach((d: any) => {
      const content = d.content ? d.content.slice(0, 100) : '';
      const score = d.score ? d.score.toFixed(2) : 'N/A';
      answer += '- ' + content + '... (score: ' + score + ')\n';
    });
    answer += '\n';
  }
  
  if (gaps.length > 0) {
    answer += 'Content Gaps (' + gaps.length + '):\n';
    gaps.slice(0, 3).forEach((g: Gap) => {
      answer += '- ' + g.from + ' <-> ' + g.to + ' (strength: ' + g.strength + ')\n';
    });
    answer += '\n';
  }
  
  if (forecasts.length > 0) {
    answer += 'Forecasts (' + forecasts.length + '):\n';
    forecasts.forEach((f: Forecast) => {
      const mse = f.metrics?.mse ? f.metrics.mse.toFixed(4) : 'N/A';
      answer += '- ' + f.entityId + ': ' + f.horizon + '-step ' + f.model + ' forecast (MSE: ' + mse + ')\n';
    });
  }
  
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
