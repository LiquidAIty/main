const BASE = import.meta.env.VITE_BACKEND_URL || '/api';

interface SolResponse {
  ok: boolean;
  text: string;
}

export async function runSol(goal: string) {
  const res = await fetch(`${BASE}/sol/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ goal })
  });
  return res;
}

export async function solRun(goal: string): Promise<SolResponse> {
  try {
    const res = await runSol(goal);
    const raw = await res.json().catch(() => null);
    const replyText =
      typeof raw === "string" ? raw :
      (raw && typeof raw === "object" && typeof (raw as any).text === "string") ? (raw as any).text :
      (raw as any)?.choices?.[0]?.message?.content ??
      JSON.stringify(raw ?? { error: `HTTP ${res.status}` });
    return { ok: res.ok, text: replyText };
  } catch (err: any) {
    return { ok: false, text: err.message ?? 'Network error' };
  }
}

export async function solRunQuery(q: string): Promise<SolResponse> {
  try {
    const res = await fetch(`${BASE}/sol/run?q=${encodeURIComponent(q)}`);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${res.statusText} :: ${text}`);
    }
    const data = await res.json();
    const text = data?.combined ?? data?.results?.__final__ ?? JSON.stringify(data);
    return { ok: true, text };
  } catch (err: any) {
    return { ok: false, text: err.message ?? 'Network error' };
  }
}

export interface UPlaybookDescriptor {
  id: string;
  title: string;
  description?: string;
}

export interface UPlaybookRunResponse {
  ok: boolean;
  data: unknown;
  error: string | null;
  meta: { id: string } | null;
}

export async function listUPlaybooks(): Promise<UPlaybookDescriptor[]> {
  const res = await fetch(`${BASE}/u-playbooks/list`);
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  if (!payload?.ok) {
    throw new Error(typeof payload?.error === 'string' ? payload.error : 'Failed to list playbooks');
  }
  const data = Array.isArray(payload.data) ? payload.data : [];
  const mapped = data
    .map((item: any): UPlaybookDescriptor | null => {
      const id = typeof item?.id === 'string' ? item.id : item?.id != null ? String(item.id) : '';
      if (!id) {
        return null;
      }
      const title = typeof item?.title === 'string' ? item.title : id;
      const description = typeof item?.description === 'string' ? item.description : undefined;
      return { id, title, description };
    })
    .filter((item): item is UPlaybookDescriptor => item != null);
  return mapped;
}

export async function runUPlaybook(
  id: string,
  params: Record<string, unknown>,
  corrId?: string
): Promise<UPlaybookRunResponse> {
  const res = await fetch(`${BASE}/u-playbooks/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, params, corrId })
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const message = typeof payload?.error === 'string' ? payload.error : `HTTP ${res.status}`;
    throw new Error(message);
  }
  if (!payload || typeof payload.ok !== 'boolean') {
    throw new Error('Invalid response payload');
  }
  return {
    ok: Boolean(payload.ok),
    data: payload.data ?? null,
    error: typeof payload.error === 'string' ? payload.error : null,
    meta: payload.meta && typeof payload.meta === 'object' ? (payload.meta as { id: string }) : null
  };
}

interface BossAgentResponse {
  ok: boolean;
  projectId: string;
  domain: string;
  result: {
    final: string;
    departments?: Record<string, any>;
  };
}

export interface BossAgentRequest {
  projectId?: string;
  goal: string;
  domain?: string;
}

/**
 * Calls the Boss Agent orchestrator endpoint that uses LangGraph for multi-agent coordination
 * @param params Request parameters for the Boss Agent
 * @returns Response from the Boss Agent with results from all departments
 */
export async function callBossAgent(params: BossAgentRequest): Promise<BossAgentResponse> {
  try {
    const res = await fetch(`${BASE}/agent/boss`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: params.projectId || 'default',
        goal: params.goal,
        domain: params.domain || 'general'
      })
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${res.statusText} :: ${text}`);
    }

    const data = await res.json();
    return data as BossAgentResponse;
  } catch (err: any) {
    return {
      ok: false,
      projectId: params.projectId || 'default',
      domain: params.domain || 'general',
      result: {
        final: err.message || 'Error calling Boss Agent'
      }
    };
  }
}

// MCP Tool interfaces
export interface MCPTool {
  id: string;
  name: string;
  description: string;
  category: string;
  installed: boolean;
}

export interface MCPToolsResponse {
  ok: boolean;
  tools: MCPTool[];
}

/**
 * Get available MCP tools
 */
export async function getAvailableMCPTools(): Promise<MCPToolsResponse> {
  try {
    const res = await fetch(`${BASE}/mcp/available-tools`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();
    return data;
  } catch (err: any) {
    return { ok: false, tools: [] };
  }
}

/**
 * Get installed MCP tools
 */
export async function getInstalledMCPTools(): Promise<MCPToolsResponse> {
  try {
    const res = await fetch(`${BASE}/mcp/installed-tools`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();
    return data;
  } catch (err: any) {
    return { ok: false, tools: [] };
  }
}

/**
 * Install an MCP tool
 */
export async function installMCPTool(toolId: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(`${BASE}/mcp/install-tool`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolId })
    });
    
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} :: ${text}`);
    }
    
    const data = await res.json();
    return { ok: true, message: data.message || 'Tool installed successfully' };
  } catch (err: any) {
    return { ok: false, message: err.message || 'Failed to install tool' };
  }
}

/**
 * Create an n8n workflow using MCP
 */
export async function createN8nWorkflow(
  workflowName: string, 
  description: string, 
  steps: any[]
): Promise<{ ok: boolean; workflowId?: string; message: string }> {
  try {
    const res = await fetch(`${BASE}/mcp/create-workflow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: workflowName,
        description,
        steps
      })
    });
    
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} :: ${text}`);
    }
    
    const data = await res.json();
    return { 
      ok: true, 
      workflowId: data.workflowId,
      message: 'Workflow created successfully' 
    };
  } catch (err: any) {
    return { 
      ok: false, 
      message: err.message || 'Failed to create workflow' 
    };
  }
}

/**
 * Build a knowledge graph using MCP
 */
export async function buildKnowledgeGraph(
  triples: Array<{ a: string; r: string; b: string }>
): Promise<{ ok: boolean; graphId?: string; message: string }> {
  try {
    const res = await fetch(`${BASE}/mcp/build-knowledge-graph`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ triples })
    });
    
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} :: ${text}`);
    }
    
    const data = await res.json();
    return { 
      ok: true, 
      graphId: data.graphId,
      message: 'Knowledge graph built successfully' 
    };
  } catch (err: any) {
    return { 
      ok: false, 
      message: err.message || 'Failed to build knowledge graph' 
    };
  }
}

/**
 * Neo4j/Graphlit Knowledge Graph Integration
 */

// Entity interface
export interface KGEntity {
  id: string;
  label: string;
  type: string;
  meta?: Record<string, any>;
}

// Document interface
export interface KGDocument {
  id: string;
  text: string;
  ts: string;
  source: string;
  embedding?: number[];
  about?: string[];
}

// Event interface
export interface KGEvent {
  id: string;
  kind: string;
  ts: string;
  severity: number;
  description: string;
  affects?: string[];
}

// Series interface
export interface KGSeries {
  id: string;
  name: string;
  entity_id: string;
  meta?: Record<string, any>;
}

// Prediction interface
export interface KGPrediction {
  id: string;
  model: string;
  ts: string;
  horizon: number;
  mean: number;
  q10?: number;
  q90?: number;
  entity_id: string;
  evidence_ids?: string[];
}

/**
 * Upsert an entity into the knowledge graph
 */
export async function kgUpsertEntity(entity: KGEntity): Promise<{ ok: boolean; id?: string; message: string }> {
  try {
    const res = await fetch(`${BASE}/kg/upsert-entity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entity)
    });
    
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} :: ${text}`);
    }
    
    const data = await res.json();
    return { 
      ok: true, 
      id: data.id,
      message: 'Entity upserted successfully' 
    };
  } catch (err: any) {
    return { 
      ok: false, 
      message: err.message || 'Failed to upsert entity' 
    };
  }
}

/**
 * Insert a document into the knowledge graph
 */
export async function kgInsertDoc(doc: KGDocument): Promise<{ ok: boolean; id?: string; message: string }> {
  try {
    const res = await fetch(`${BASE}/kg/insert-doc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(doc)
    });
    
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} :: ${text}`);
    }
    
    const data = await res.json();
    return { 
      ok: true, 
      id: data.id,
      message: 'Document inserted successfully' 
    };
  } catch (err: any) {
    return { 
      ok: false, 
      message: err.message || 'Failed to insert document' 
    };
  }
}

/**
 * Record an event in the knowledge graph
 */
export async function kgRecordEvent(event: KGEvent): Promise<{ ok: boolean; id?: string; message: string }> {
  try {
    const res = await fetch(`${BASE}/kg/record-event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event)
    });
    
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} :: ${text}`);
    }
    
    const data = await res.json();
    return { 
      ok: true, 
      id: data.id,
      message: 'Event recorded successfully' 
    };
  } catch (err: any) {
    return { 
      ok: false, 
      message: err.message || 'Failed to record event' 
    };
  }
}

/**
 * Register a time series in the knowledge graph
 */
export async function kgRegisterSeries(series: KGSeries): Promise<{ ok: boolean; id?: string; message: string }> {
  try {
    const res = await fetch(`${BASE}/kg/register-series`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(series)
    });
    
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} :: ${text}`);
    }
    
    const data = await res.json();
    return { 
      ok: true, 
      id: data.id,
      message: 'Series registered successfully' 
    };
  } catch (err: any) {
    return { 
      ok: false, 
      message: err.message || 'Failed to register series' 
    };
  }
}

/**
 * Store a prediction in the knowledge graph
 */
export async function kgStorePrediction(prediction: KGPrediction): Promise<{ ok: boolean; id?: string; message: string }> {
  try {
    const res = await fetch(`${BASE}/kg/store-prediction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(prediction)
    });
    
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} :: ${text}`);
    }
    
    const data = await res.json();
    return { 
      ok: true, 
      id: data.id,
      message: 'Prediction stored successfully' 
    };
  } catch (err: any) {
    return { 
      ok: false, 
      message: err.message || 'Failed to store prediction' 
    };
  }
}

/**
 * Query the knowledge graph
 */
export async function kgQuery(query: { 
  entity_id?: string; 
  window?: string; 
  text?: string;
  limit?: number;
}): Promise<{ 
  ok: boolean; 
  entities?: KGEntity[]; 
  docs?: KGDocument[]; 
  events?: KGEvent[];
  predictions?: KGPrediction[];
  message?: string;
}> {
  try {
    const res = await fetch(`${BASE}/kg/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(query)
    });
    
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} :: ${text}`);
    }
    
    const data = await res.json();
    return { 
      ok: true, 
      ...data
    };
  } catch (err: any) {
    return { 
      ok: false, 
      message: err.message || 'Failed to query knowledge graph' 
    };
  }
}

/**
 * Ground an entity in the knowledge graph based on text
 */
export async function kgGroundEntity(params: {
  text: string;
  window?: string;
}): Promise<{
  ok: boolean;
  entity_ids?: string[];
  event_ids?: string[];
  doc_id?: string;
  message?: string;
}> {
  try {
    const res = await fetch(`${BASE}/kg/ground-entity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} :: ${text}`);
    }
    
    const data = await res.json();
    return { 
      ok: true, 
      ...data
    };
  } catch (err: any) {
    return { 
      ok: false, 
      message: err.message || 'Failed to ground entity' 
    };
  }
}

/**
 * Time Series + Knowledge Graph Integration
 * Functions to link time series data with knowledge graph entities
 */

import { TimeSeriesConfig, TimePoint, AggregationType, TimeInterval } from './services/timeseries';
import { ModelType } from './models/ontology';
import { EvoSelectorRequest, EvoSelectorResponse } from './models/evoselector';

/**
 * Time series metadata for knowledge graph
 */
export interface KGTimeSeriesMetadata {
  entityId: string;
  seriesId: string;
  name: string;
  description?: string;
  source: string;
  tags?: Record<string, string>;
  dataType: 'numeric' | 'categorical';
  unit?: string;
  frequency: string;
  startDate?: string;
  endDate?: string;
  lastUpdated?: string;
  pointCount?: number;
  stats?: {
    min?: number;
    max?: number;
    avg?: number;
    sum?: number;
    stddev?: number;
  };
}

/**
 * Register a time series in the knowledge graph
 */
export async function kgRegisterTimeSeries(
  config: TimeSeriesConfig & { entityId: string }
): Promise<{ ok: boolean; seriesId?: string; message?: string }> {
  try {
    const response = await fetch(`${BASE}/kg/register-time-series`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });
    
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status} :: ${text}`);
    }
    
    const data = await response.json();
    return {
      ok: true,
      seriesId: data.seriesId,
      message: 'Time series registered in knowledge graph successfully'
    };
  } catch (error) {
    console.error('Error registering time series in knowledge graph:', error);
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Update time series statistics in the knowledge graph
 */
export async function kgUpdateTimeSeriesStats(
  seriesId: string,
  stats: {
    min?: number;
    max?: number;
    avg?: number;
    sum?: number;
    stddev?: number;
    lastValue?: number;
    lastUpdated?: string;
    pointCount?: number;
  }
): Promise<{ ok: boolean; message?: string }> {
  try {
    const response = await fetch(`${BASE}/kg/update-time-series-stats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        seriesId,
        stats
      })
    });
    
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status} :: ${text}`);
    }
    
    return {
      ok: true,
      message: 'Time series statistics updated in knowledge graph successfully'
    };
  } catch (error) {
    console.error('Error updating time series statistics:', error);
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Link a time series to an entity in the knowledge graph
 */
export async function kgLinkTimeSeriestoEntity(
  seriesId: string,
  entityId: string,
  relationship: string = 'HAS_TIME_SERIES'
): Promise<{ ok: boolean; message?: string }> {
  try {
    const response = await fetch(`${BASE}/kg/link-time-series`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        seriesId,
        entityId,
        relationship
      })
    });
    
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status} :: ${text}`);
    }
    
    return {
      ok: true,
      message: 'Time series linked to entity successfully'
    };
  } catch (error) {
    console.error('Error linking time series to entity:', error);
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Get time series associated with an entity
 */
export async function kgGetEntityTimeSeries(
  entityId: string
): Promise<{ ok: boolean; series?: KGTimeSeriesMetadata[]; message?: string }> {
  try {
    const response = await fetch(`${BASE}/kg/entity-time-series?entityId=${encodeURIComponent(entityId)}`);
    
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status} :: ${text}`);
    }
    
    const data = await response.json();
    
    return {
      ok: true,
      series: data.series
    };
  } catch (error) {
    console.error('Error getting entity time series:', error);
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Store time series aggregations in the knowledge graph
 */
export async function kgStoreTimeSeriesAggregations(
  seriesId: string,
  entityId: string,
  aggregations: {
    interval: TimeInterval;
    aggregationType: AggregationType;
    value: number;
    min: number;
    max: number;
    count: number;
    timestamp: string;
    weekNumber?: number;
  }[]
): Promise<{ ok: boolean; message?: string }> {
  try {
    const response = await fetch(`${BASE}/kg/store-time-series-aggregations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        seriesId,
        entityId,
        aggregations
      })
    });
    
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status} :: ${text}`);
    }
    
    return {
      ok: true,
      message: 'Time series aggregations stored in knowledge graph successfully'
    };
  } catch (error) {
    console.error('Error storing time series aggregations:', error);
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Run evolutionary model selection for a time series and store in knowledge graph
 */
export async function kgRunEvoModelSelection(
  seriesId: string,
  entityId: string,
  request: EvoSelectorRequest
): Promise<{ ok: boolean; result?: EvoSelectorResponse; message?: string }> {
  try {
    const response = await fetch(`${BASE}/kg/run-evo-model-selection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        seriesId,
        entityId,
        request
      })
    });
    
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status} :: ${text}`);
    }
    
    const data = await response.json();
    
    return {
      ok: true,
      result: data.result,
      message: 'Evolutionary model selection completed and stored in knowledge graph'
    };
  } catch (error) {
    console.error('Error running evolutionary model selection:', error);
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Configure external data feed for time series
 */
export async function configureExternalDataFeed(
  seriesId: string,
  entityId: string,
  source: 'stock-market' | 'google-trends' | 'reddit' | 'weather' | 'ask-the-public' | 'custom',
  config: Record<string, any>
): Promise<{ ok: boolean; jobId?: string; message?: string }> {
  try {
    const response = await fetch(`${BASE}/ts/configure-external-feed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        seriesId,
        entityId,
        source,
        config
      })
    });
    
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status} :: ${text}`);
    }
    
    const data = await response.json();
    
    return {
      ok: true,
      jobId: data.jobId,
      message: `External data feed (${source}) configured successfully`
    };
  } catch (error) {
    console.error('Error configuring external data feed:', error);
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Feed ESN-RLS model with data from other models
 */
export async function feedESNWithModels(
  targetSeriesId: string,
  sourceModelIds: string[],
  config: {
    windowSize: number;
    horizon: number;
    combineMethod: 'concat' | 'average' | 'weighted';
    weights?: Record<string, number>;
  }
): Promise<{ ok: boolean; modelId?: string; message?: string }> {
  try {
    const response = await fetch(`${BASE}/ts/feed-esn-with-models`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetSeriesId,
        sourceModelIds,
        config
      })
    });
    
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status} :: ${text}`);
    }
    
    const data = await response.json();
    
    return {
      ok: true,
      modelId: data.modelId,
      message: 'ESN-RLS model fed with other models successfully'
    };
  } catch (error) {
    console.error('Error feeding ESN with models:', error);
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}
