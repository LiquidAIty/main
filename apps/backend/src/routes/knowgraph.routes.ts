// @graph entity: KnowGraphRoute
// @graph role: knowgraph-gateway
// @graph relates_to: AgentBuilderWorkspace, KnowGraph API, KnowGraph
// @graph depends_on: Express, Neo4j, KnowGraph API
// @graph feeds_to: KnowGraph API, KnowGraph
import axios from 'axios';
import { Router } from 'express';
import multer from 'multer';
import { pool } from '../db/pool';
import { resolveKnowgraphAgent } from '../services/resolveAgents';
import { isDevTestModeEnabled } from '../services/devTest';
import {
  normalizeKnowGraphOutputToSemanticRecordsWithValidation,
  normalizeThinkGraphOutputToSemanticRecordsWithValidation,
  validateSemanticGraphRecord,
} from '../graph/semanticLanguage';
import type { GraphReadResult, SemanticGraphRecord, SemanticGraphRelationship, SemanticGraphSourceRef } from '../types';

const router = Router();
// DEV TEST LIMIT RAISED: allow large real-document uploads during development and loop testing.
const KNOWGRAPH_UPLOAD_MAX_FILE_SIZE_BYTES = Math.max(
  1_000_000,
  Number(
    process.env.KNOWGRAPH_UPLOAD_MAX_FILE_SIZE_BYTES ||
      (isDevTestModeEnabled() ? 512 * 1024 * 1024 : 25 * 1024 * 1024),
  ),
);
function looksLikePdfUpload(file: { mimetype?: string; originalname?: string } | null | undefined): boolean {
  if (!file) return false;
  const fileName = String(file.originalname || '').toLowerCase();
  const fileType = String(file.mimetype || '').toLowerCase();
  return fileName.endsWith('.pdf') || fileType === 'application/pdf' || fileType.includes('/pdf');
}
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: KNOWGRAPH_UPLOAD_MAX_FILE_SIZE_BYTES,
    files: 1,
    parts: 12,
    fields: 10,
  },
  fileFilter: (_req, file, cb) => {
    if (!looksLikePdfUpload(file)) {
      cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'file'));
      return;
    }
    cb(null, true);
  },
});
const knowgraphUploadSingle = (req: any, res: any, next: any) => {
  upload.single('file')(req, res, (err: any) => {
    if (!err) {
      next();
      return;
    }
    if (err instanceof multer.MulterError) {
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? 'Attached PDF exceeds the current upload size limit.'
          : 'Only a single PDF file is accepted for KnowGraph ingest.';
      res.status(status).json({ ok: false, error: { message } });
      return;
    }
    next(err);
  });
};

export type UploadedFile = {
  buffer: Buffer;
  mimetype?: string;
  originalname?: string;
};

type KnowGraphNodeDto = {
  id: string;
  label: string;
  type: string;
  source: 'know';
  properties: Record<string, unknown>;
};

type KnowGraphRelationshipDto = {
  id: string;
  from: string;
  to: string;
  type: string;
  source: 'know';
  properties: Record<string, unknown>;
};

function legacyGraphToSemanticReadResult(graph: {
  nodes: KnowGraphNodeDto[];
  relationships: KnowGraphRelationshipDto[];
}): GraphReadResult {
  const records: SemanticGraphRecord[] = graph.nodes.map((node) => {
    const props = toNeoJsonValue(node.properties || {}) as Record<string, unknown>;
    const refRaw = String(props.source_url || props.url || '').trim();
    const sourceRefsFromProps = Array.isArray(props.sourceRefs)
      ? (props.sourceRefs as SemanticGraphSourceRef[])
      : [];
    const sourceRefs: SemanticGraphSourceRef[] =
      sourceRefsFromProps.length > 0
        ? sourceRefsFromProps
        : refRaw && /^https?:\/\//i.test(refRaw)
          ? [{ type: 'url', ref: refRaw, title: String(props.source_title || node.label || '').trim() || null }]
          : [];
    return {
      id: `kg:${node.id}`,
      graph: 'know',
      kind: 'entity',
      label: String(node.label || node.id),
      summary: String(props.summary || props.description || node.label || node.id),
      entities: [{ id: `kg:${node.id}`, label: String(node.label || node.id), type: String(node.type || 'entity'), properties: props }],
      relationships: [],
      properties: props,
      owlClass: String(node.type || 'Entity'),
      owlIndividual: `kg:${node.id}`,
      objectProperties: [],
      datatypeProperties: Object.entries(props).map(([key, value]) => ({ key, value, valueType: Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value })),
      annotationProperties: [{ key: 'legacy_adapted', value: true }],
      sourceRefs,
      confidence: Number.isFinite(Number(props.confidence)) ? Number(props.confidence) : null,
      provenance: { createdByAgent: 'knowgraph-agent', reasoningSummary: 'adapted from legacy graph DTO' },
      vectorText: String(props.vectorText || props.summary || node.label || node.id),
      writer: 'knowgraph-agent',
      writeMode: 'read-only',
      createdAt: String(props.created_at || new Date().toISOString()),
      updatedAt: String(props.updated_at || props.created_at || new Date().toISOString()),
      '@id': `kg:${node.id}`,
      '@type': [String(node.type || 'Entity')],
    };
  });

  const relationships: SemanticGraphRelationship[] = graph.relationships.map((rel) => {
    const props = toNeoJsonValue(rel.properties || {}) as Record<string, unknown>;
    return {
      id: `kg:${rel.id}`,
      from: `kg:${rel.from}`,
      to: `kg:${rel.to}`,
      type: String(rel.type || 'related_to'),
      label: String(rel.type || 'related_to'),
      properties: props,
      confidence: Number.isFinite(Number(props.confidence)) ? Number(props.confidence) : null,
    };
  });

  const sourceRefs: SemanticGraphSourceRef[] = records.flatMap((record) => record.sourceRefs || []);
  const warnings: string[] = [
    'semantic payload adapted from legacy /api/knowgraph/graph data; full semantic persistence fields may be missing',
  ];

  return {
    records,
    relationships,
    sourceRefs,
    warnings,
    status: 'ok',
  };
}

function normalizeRelType(value: string): string {
  const normalized = String(value || 'RELATED_TO')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || 'RELATED_TO';
}

export function buildSemanticSeedRecords(projectId: string): SemanticGraphRecord[] {
  const now = new Date().toISOString();
  const sourceRef: SemanticGraphSourceRef = {
    id: `seed-source:${projectId}`,
    type: 'graph_record',
    ref: `seed://${projectId}/semantic-seed`,
    title: 'LiquidAIty semantic seed',
    summary: 'Clean test seed data for semantic graph UI validation.',
    retrievedAt: now,
    confidence: 1,
  };

  const urlSourceRef: SemanticGraphSourceRef = {
    id: 'seed-url:jsonld',
    type: 'url',
    ref: 'https://www.w3.org/TR/json-ld11/',
    title: 'JSON-LD 1.1',
    summary: 'Reference for JSON-LD semantic identity fields.',
    retrievedAt: now,
    confidence: 0.95,
  };

  return [
    {
      id: `seed:source:${projectId}`,
      graph: 'know',
      kind: 'source',
      label: 'LiquidAIty semantic seed source',
      summary: 'Internal seed source for graph UI validation.',
      entities: [{ id: 'entity:liquidaity', label: 'LiquidAIty', type: 'Project' }],
      relationships: [],
      properties: { confidence: 1, priority: 1, evidenceCount: 1, launchPhaseScore: 0.8 },
      owlClass: 'Source',
      owlIndividual: `seed:source:${projectId}`,
      objectProperties: [],
      datatypeProperties: [
        { key: 'confidence', value: 1, valueType: 'number' },
        { key: 'priority', value: 1, valueType: 'number' },
        { key: 'evidenceCount', value: 1, valueType: 'number' },
      ],
      annotationProperties: [{ key: 'seedTag', value: 'semantic_seed_launch' }],
      sourceRefs: [sourceRef, urlSourceRef],
      confidence: 1,
      provenance: { createdByAgent: 'knowgraph-agent', reasoningSummary: 'explicit semantic seed for launch UI testing', createdAt: now },
      vectorText: 'LiquidAIty semantic seed source for graph UI validation and source provenance testing.',
      writer: 'knowgraph-agent',
      writeMode: 'agent-owned',
      createdAt: now,
      updatedAt: now,
      '@context': 'https://schema.org',
      '@id': `urn:liquidaity:seed:source:${projectId}`,
      '@type': ['Source'],
    },
    {
      id: `seed:claim:${projectId}`,
      graph: 'know',
      kind: 'claim',
      label: 'Launch general workbench before deep trading',
      summary: 'LiquidAIty should launch the general AI agent workbench before deep trading.',
      entities: [
        { id: 'entity:liquidaity', label: 'LiquidAIty', type: 'Project' },
        { id: 'entity:general_launch', label: 'General Platform Launch', type: 'Mission' },
        { id: 'entity:trading_vertical', label: 'Trading Vertical', type: 'Mission' },
      ],
      relationships: [
        { id: 'rel:launch_precedes_trading', from: 'entity:general_launch', to: 'entity:trading_vertical', type: 'precedes', confidence: 0.93 },
      ],
      properties: { confidence: 0.93, priority: 0.92, evidenceCount: 1, riskLevel: 0.34 },
      owlClass: 'Claim',
      owlIndividual: `seed:claim:${projectId}`,
      objectProperties: [{ id: 'op:launch_precedes_trading', from: 'entity:general_launch', to: 'entity:trading_vertical', type: 'precedes', confidence: 0.93 }],
      datatypeProperties: [
        { key: 'confidence', value: 0.93, valueType: 'number' },
        { key: 'priority', value: 0.92, valueType: 'number' },
        { key: 'evidenceCount', value: 1, valueType: 'number' },
        { key: 'riskLevel', value: 0.34, valueType: 'number' },
      ],
      annotationProperties: [{ key: 'seedTag', value: 'semantic_seed_launch' }],
      sourceRefs: [sourceRef],
      confidence: 0.93,
      provenance: { createdByAgent: 'knowgraph-agent', reasoningSummary: 'user-directed launch sequencing seed claim', createdAt: now },
      vectorText: 'Claim: launch general AI workbench first, then trading vertical.',
      writer: 'knowgraph-agent',
      writeMode: 'agent-owned',
      createdAt: now,
      updatedAt: now,
      '@context': 'https://schema.org',
      '@id': `urn:liquidaity:seed:claim:${projectId}`,
      '@type': ['Claim'],
    },
    {
      id: `seed:decision:${projectId}`,
      graph: 'know',
      kind: 'decision',
      label: 'Focus MVP flow',
      summary: 'Focus MVP on chat -> plan -> agent canvas -> approve -> run -> graph memory.',
      entities: [
        { id: 'entity:agent_builder', label: 'Agent Builder', type: 'UserInterface' },
        { id: 'entity:thinkgraph', label: 'ThinkGraph', type: 'MemoryGraph' },
        { id: 'entity:knowgraph', label: 'KnowGraph', type: 'MemoryGraph' },
      ],
      relationships: [
        { id: 'rel:liquidaity_has_agent_builder', from: 'entity:liquidaity', to: 'entity:agent_builder', type: 'hasComponent', confidence: 0.95 },
        { id: 'rel:liquidaity_has_knowgraph', from: 'entity:liquidaity', to: 'entity:knowgraph', type: 'hasComponent', confidence: 0.95 },
        { id: 'rel:liquidaity_has_thinkgraph', from: 'entity:liquidaity', to: 'entity:thinkgraph', type: 'hasComponent', confidence: 0.95 },
      ],
      properties: { confidence: 0.94, priority: 0.94, evidenceCount: 1, launchPhaseScore: 0.9 },
      owlClass: 'Decision',
      owlIndividual: `seed:decision:${projectId}`,
      objectProperties: [
        { id: 'op:sol_orchestrates_agent_builder', from: 'entity:sol', to: 'entity:agent_builder', type: 'orchestrates', confidence: 0.9 },
      ],
      datatypeProperties: [
        { key: 'confidence', value: 0.94, valueType: 'number' },
        { key: 'priority', value: 0.94, valueType: 'number' },
        { key: 'launchPhaseScore', value: 0.9, valueType: 'number' },
      ],
      annotationProperties: [{ key: 'seedTag', value: 'semantic_seed_launch' }],
      sourceRefs: [sourceRef],
      confidence: 0.94,
      provenance: { createdByAgent: 'knowgraph-agent', reasoningSummary: 'MVP decision seed record for graph drilldown test', createdAt: now },
      vectorText: 'Decision: prioritize MVP flow through chat, planning, canvas approval, execution, and graph memory.',
      writer: 'knowgraph-agent',
      writeMode: 'agent-owned',
      createdAt: now,
      updatedAt: now,
      '@context': 'https://schema.org',
      '@id': `urn:liquidaity:seed:decision:${projectId}`,
      '@type': ['Decision'],
    },
    {
      id: `seed:action:${projectId}`,
      graph: 'know',
      kind: 'action',
      label: 'Build Research-to-KnowGraph demo',
      summary: 'Build a Research-to-KnowGraph demo after graph UI is testable.',
      entities: [
        { id: 'entity:research_agent', label: 'Research Agent', type: 'Agent' },
        { id: 'entity:graph_ui', label: 'Graph UI', type: 'UserInterface' },
      ],
      relationships: [
        { id: 'rel:research_produces_knowgraph', from: 'entity:research_agent', to: 'entity:knowgraph', type: 'produces', confidence: 0.9 },
        { id: 'rel:decision_produces_action', from: 'seed:decision:' + projectId, to: 'seed:action:' + projectId, type: 'produces', confidence: 0.93 },
        { id: 'rel:claim_supports_decision', from: 'seed:claim:' + projectId, to: 'seed:decision:' + projectId, type: 'supports', confidence: 0.91 },
      ],
      properties: { confidence: 0.92, priority: 0.9, evidenceCount: 1, riskLevel: 0.28 },
      owlClass: 'Action',
      owlIndividual: `seed:action:${projectId}`,
      objectProperties: [{ id: 'op:thinkgraph_stores_decision', from: 'entity:thinkgraph', to: 'seed:decision:' + projectId, type: 'stores', confidence: 0.89 }],
      datatypeProperties: [
        { key: 'confidence', value: 0.92, valueType: 'number' },
        { key: 'priority', value: 0.9, valueType: 'number' },
        { key: 'riskLevel', value: 0.28, valueType: 'number' },
      ],
      annotationProperties: [{ key: 'seedTag', value: 'semantic_seed_launch' }],
      sourceRefs: [sourceRef],
      confidence: 0.92,
      provenance: { createdByAgent: 'knowgraph-agent', reasoningSummary: 'action seed after semantic graph UI readiness', createdAt: now },
      vectorText: 'Action: create a research-to-knowgraph demo once semantic graph UI path is verified.',
      writer: 'knowgraph-agent',
      writeMode: 'agent-owned',
      createdAt: now,
      updatedAt: now,
      '@context': 'https://schema.org',
      '@id': `urn:liquidaity:seed:action:${projectId}`,
      '@type': ['Action'],
    },
  ];
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function trimBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function toNeoJsonValue(value: any): any {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map((v) => toNeoJsonValue(v));
  if (typeof value !== 'object') return value;

  if (typeof value.toNumber === 'function') {
    try {
      return value.toNumber();
    } catch {
      // fall through to recursive object copy
    }
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = toNeoJsonValue(v);
  }
  return out;
}

// Neo4j node/edge properties must be primitives or arrays of primitives — never maps or
// arrays-of-maps. Keep primitives and string/number/boolean arrays as-is; JSON-stringify any
// nested object / array-of-object (e.g. OWL objectProperties, sourceRefs, provenance) so the
// seed persists instead of throwing "Property values can only be of primitive types".
function toNeoSafeProperties(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined) {
      out[key] = null;
    } else if (Array.isArray(value)) {
      const allPrimitive = value.every(
        (item) => item === null || ['string', 'number', 'boolean'].includes(typeof item),
      );
      out[key] = allPrimitive ? value : JSON.stringify(value);
    } else if (typeof value === 'object') {
      out[key] = JSON.stringify(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function neoNodeLabel(id: string, props: Record<string, unknown>): string {
  const candidates = [props.name, props.title, props.label, props.id, props.document_id, props.chunk_id];
  for (const candidate of candidates) {
    const text = String(candidate ?? '').trim();
    if (text) return text;
  }
  return id;
}

async function resolveKnowGraphProjectScopeIds(projectId: string): Promise<string[]> {
  const seed = String(projectId || '').trim();
  if (!seed) return [];

  const scopeIds = new Set<string>([seed]);
  try {
    const result = await pool.query(
      `
        SELECT
          id::text AS id,
          coalesce(name, '') AS name,
          coalesce(code, '') AS code
        FROM ag_catalog.projects
        WHERE id::text = $1
           OR lower(coalesce(name, '')) = lower($1)
           OR lower(coalesce(code, '')) = lower($1)
        LIMIT 1
      `,
      [seed],
    );
    const row = result?.rows?.[0] as { id?: string; name?: string; code?: string } | undefined;
    if (row) {
      for (const rawValue of [row.id, row.name, row.code]) {
        const value = String(rawValue || '').trim();
        if (value) scopeIds.add(value);
      }
    }
  } catch (error: any) {
    console.warn('[KNOWGRAPH][SCOPE] project alias resolution failed:', error?.message || error);
  }

  return Array.from(scopeIds);
}

async function queryKnowGraphProject(projectId: string): Promise<{
  nodes: KnowGraphNodeDto[];
  relationships: KnowGraphRelationshipDto[];
}> {
  const uri = String(process.env.NEO4J_URI || '').trim();
  const user = String(process.env.NEO4J_USER || '').trim();
  const password = String(process.env.NEO4J_PASSWORD || '').trim();

  if (!uri || !user || !password) {
    throw new Error('NEO4J_URI, NEO4J_USER, and NEO4J_PASSWORD are required');
  }

  const neo4jModule: any = await import('neo4j-driver');
  const neo4j: any = neo4jModule?.default ?? neo4jModule;
  const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  const database = String(process.env.NEO4J_DATABASE || '').trim();
  const session = driver.session(database ? { database } : undefined);
  const projectScopeIds = await resolveKnowGraphProjectScopeIds(projectId);

  try {
    const nodeMap = new Map<string, KnowGraphNodeDto>();

    const upsertNode = (idRaw: unknown, labelsRaw: unknown, propsRaw: unknown) => {
      const rawId = String(idRaw ?? '').trim();
      if (!rawId) return;

      const labels = Array.isArray(labelsRaw) ? labelsRaw.map((x) => String(x)) : [];
      const props = toNeoJsonValue(propsRaw || {}) as Record<string, unknown>;

      if (!nodeMap.has(rawId)) {
        nodeMap.set(rawId, {
          id: rawId,
          label: neoNodeLabel(rawId, props),
          type: String(labels[0] || 'NeoEntity'),
          source: 'know',
          properties: props,
        });
      }
    };

    const relResult = await session.run(
      `
        MATCH (a)-[r]->(b)
        WHERE toString(a.project_id) IN $projectScopeIds
          AND toString(b.project_id) IN $projectScopeIds
          AND toString(r.project_id) IN $projectScopeIds
        RETURN DISTINCT
          elementId(r) AS rel_id,
          type(r) AS rel_type,
          properties(r) AS rel_props,
          elementId(a) AS from_id,
          labels(a) AS from_labels,
          properties(a) AS from_props,
          elementId(b) AS to_id,
          labels(b) AS to_labels,
          properties(b) AS to_props
      `,
      { projectScopeIds },
    );

    const relationships: KnowGraphRelationshipDto[] = [];

    relResult.records.forEach((record: any) => {
      const relId = String(record.get('rel_id') ?? '').trim();
      const fromId = String(record.get('from_id') ?? '').trim();
      const toId = String(record.get('to_id') ?? '').trim();
      if (!relId || !fromId || !toId) return;

      upsertNode(record.get('from_id'), record.get('from_labels'), record.get('from_props'));
      upsertNode(record.get('to_id'), record.get('to_labels'), record.get('to_props'));

      relationships.push({
        id: relId,
        from: fromId,
        to: toId,
        type: String(record.get('rel_type') || 'RELATED_TO'),
        source: 'know',
        properties: (toNeoJsonValue(record.get('rel_props') || {}) || {}) as Record<string, unknown>,
      });
    });

    const nodeResult = await session.run(
      `
        MATCH (n)
        WHERE toString(n.project_id) IN $projectScopeIds
        RETURN DISTINCT elementId(n) AS node_id, labels(n) AS node_labels, properties(n) AS node_props
      `,
      { projectScopeIds },
    );

    nodeResult.records.forEach((record: any) => {
      upsertNode(record.get('node_id'), record.get('node_labels'), record.get('node_props'));
    });

    return {
      nodes: Array.from(nodeMap.values()),
      relationships,
    };
  } finally {
    await session.close();
    await driver.close();
  }
}

function stripKnowgraphNodeIdPrefix(nodeId: string): string {
  return String(nodeId || '')
    .trim()
    .replace(/^(kg:|know:)/i, '');
}

async function queryKnowGraphExpand(
  projectId: string,
  nodeId: string,
  limit: number,
): Promise<{
  nodes: KnowGraphNodeDto[];
  relationships: KnowGraphRelationshipDto[];
}> {
  const rawNodeId = stripKnowgraphNodeIdPrefix(nodeId);
  if (!rawNodeId) {
    throw new Error('nodeId is required');
  }

  const uri = String(process.env.NEO4J_URI || '').trim();
  const user = String(process.env.NEO4J_USER || '').trim();
  const password = String(process.env.NEO4J_PASSWORD || '').trim();
  if (!uri || !user || !password) {
    throw new Error('NEO4J_URI, NEO4J_USER, and NEO4J_PASSWORD are required');
  }

  const neo4jModule: any = await import('neo4j-driver');
  const neo4j: any = neo4jModule?.default ?? neo4jModule;
  const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  const database = String(process.env.NEO4J_DATABASE || '').trim();
  const session = driver.session(database ? { database } : undefined);
  const projectScopeIds = await resolveKnowGraphProjectScopeIds(projectId);

  try {
    const nodeMap = new Map<string, KnowGraphNodeDto>();
    const upsertNode = (idRaw: unknown, labelsRaw: unknown, propsRaw: unknown) => {
      const rawId = String(idRaw ?? '').trim();
      if (!rawId) return;
      const labels = Array.isArray(labelsRaw) ? labelsRaw.map((x) => String(x)) : [];
      const props = toNeoJsonValue(propsRaw || {}) as Record<string, unknown>;
      if (!nodeMap.has(rawId)) {
        nodeMap.set(rawId, {
          id: rawId,
          label: neoNodeLabel(rawId, props),
          type: String(labels[0] || 'NeoEntity'),
          source: 'know',
          properties: props,
        });
      }
    };

    const centerResult = await session.run(
      `
        MATCH (n)
        WHERE elementId(n) = $nodeId
          AND toString(n.project_id) IN $projectScopeIds
        RETURN elementId(n) AS node_id, labels(n) AS node_labels, properties(n) AS node_props
        LIMIT 1
      `,
      { nodeId: rawNodeId, projectScopeIds },
    );

    if (centerResult.records.length === 0) {
      return { nodes: [], relationships: [] };
    }

    centerResult.records.forEach((record: any) => {
      upsertNode(record.get('node_id'), record.get('node_labels'), record.get('node_props'));
    });

    const relResult = await session.run(
      `
        MATCH (center)
        WHERE elementId(center) = $nodeId
          AND toString(center.project_id) IN $projectScopeIds
        MATCH (a)-[r]-(b)
        WHERE (a = center OR b = center)
          AND toString(a.project_id) IN $projectScopeIds
          AND toString(b.project_id) IN $projectScopeIds
          AND toString(r.project_id) IN $projectScopeIds
        RETURN DISTINCT
          elementId(r) AS rel_id,
          type(r) AS rel_type,
          properties(r) AS rel_props,
          elementId(a) AS from_id,
          labels(a) AS from_labels,
          properties(a) AS from_props,
          elementId(b) AS to_id,
          labels(b) AS to_labels,
          properties(b) AS to_props
        LIMIT toInteger($limit)
      `,
      { nodeId: rawNodeId, projectScopeIds, limit },
    );

    const relationships: KnowGraphRelationshipDto[] = [];
    relResult.records.forEach((record: any) => {
      const relId = String(record.get('rel_id') ?? '').trim();
      const fromId = String(record.get('from_id') ?? '').trim();
      const toId = String(record.get('to_id') ?? '').trim();
      if (!relId || !fromId || !toId) return;

      upsertNode(record.get('from_id'), record.get('from_labels'), record.get('from_props'));
      upsertNode(record.get('to_id'), record.get('to_labels'), record.get('to_props'));

      relationships.push({
        id: relId,
        from: fromId,
        to: toId,
        type: String(record.get('rel_type') || 'RELATED_TO'),
        source: 'know',
        properties: (toNeoJsonValue(record.get('rel_props') || {}) || {}) as Record<string, unknown>,
      });
    });

    return {
      nodes: Array.from(nodeMap.values()),
      relationships,
    };
  } finally {
    await session.close();
    await driver.close();
  }
}

function buildKnowgraphBaseUrls(): string[] {
  const configured = (process.env.KNOWGRAPH_URL || '').trim();
  const localDefault = 'http://localhost:8001';

  if (!configured) {
    return [localDefault];
  }

  const primary = trimBaseUrl(configured);
  const urls = [primary];

  // If a local backend accidentally points at the Docker DNS name, retry localhost.
  if (/^https?:\/\/knowgraph(?::\d+)?(?:\/|$)/i.test(primary)) {
    urls.push(localDefault);
  }

  return Array.from(new Set(urls));
}

async function proxyKnowgraphGetJson(pathname: string, query?: Record<string, string>): Promise<{
  status: number;
  data: any;
}> {
  const baseUrls = buildKnowgraphBaseUrls();
  let lastError: any;

  for (const baseUrl of baseUrls) {
    try {
      const search = new URLSearchParams(query || {});
      const url = `${baseUrl}${pathname}${search.toString() ? `?${search.toString()}` : ''}`;
      const response = await axios.get(url, {
        timeout: 8000,
        validateStatus: () => true,
      });
      return { status: response.status, data: response.data };
    } catch (error: any) {
      lastError = error;
      const code = String(error?.code || '');
      const canRetryNetworkLookup =
        !error?.response && (code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'EAI_AGAIN');
      if (!canRetryNetworkLookup) {
        break;
      }
    }
  }

  throw lastError;
}

router.get('/health', async (_req, res) => {
  try {
    const response = await proxyKnowgraphGetJson('/health');
    return res.status(response.status).json(response.data);
  } catch (error: any) {
    const status = Number(error?.response?.status) || 502;
    const message =
      error?.response?.data?.error?.message ||
      error?.response?.data?.message ||
      error?.message ||
      'KnowGraph health proxy request failed';
    return res.status(status).json({ ok: false, error: { message } });
  }
});

router.get('/graph', async (req, res) => {
  try {
    const projectId =
      (typeof req.query?.projectId === 'string' && req.query.projectId.trim()) ||
      (typeof req.query?.project_id === 'string' && req.query.project_id.trim()) ||
      '';

    if (!projectId) {
      return res.status(400).json({
        ok: false,
        error: { message: 'projectId is required' },
      });
    }

    const graph = await queryKnowGraphProject(projectId);
    return res.json(graph);
  } catch (error: any) {
    const message = error?.message || 'Failed to fetch KnowGraph graph';
    return res.status(500).json({ ok: false, error: { message } });
  }
});

router.get('/expand', async (req, res) => {
  try {
    const projectId =
      (typeof req.query?.projectId === 'string' && req.query.projectId.trim()) ||
      (typeof req.query?.project_id === 'string' && req.query.project_id.trim()) ||
      '';
    const nodeId =
      (typeof req.query?.nodeId === 'string' && req.query.nodeId.trim()) ||
      (typeof req.query?.node_id === 'string' && req.query.node_id.trim()) ||
      '';

    if (!projectId || !nodeId) {
      return res.status(400).json({
        ok: false,
        error: { message: 'projectId and nodeId are required' },
      });
    }

    const limit = clampInt(req.query?.limit, 1, 200, 50);
    // Current endpoint supports 1-hop expansion for interactive use. Depth is accepted but clamped.
    const _depth = clampInt(req.query?.depth, 1, 1, 1);
    void _depth;

    const graph = await queryKnowGraphExpand(projectId, nodeId, limit);
    return res.json(graph);
  } catch (error: any) {
    const message = error?.message || 'Failed to expand KnowGraph graph';
    return res.status(500).json({ ok: false, error: { message } });
  }
});

router.get('/semantic-smoke', async (req, res) => {
  const mode = String(req.query?.mode || 'know').trim().toLowerCase();
  const now = new Date().toISOString();
  const sample =
    mode === 'think'
      ? [
          {
            id: 'smk-think-1',
            graph: 'think',
            kind: 'decision',
            label: 'Launch general workflow first',
            summary: 'Prioritize general platform launch workflow before domain specialization.',
            entities: [
              { id: 'ent-mission', label: 'Mission Alpha', type: 'mission' },
              { id: 'ent-user-intent', label: 'User intent', type: 'concept' },
            ],
            relationships: [
              { id: 'rel-1', from: 'ent-mission', to: 'ent-user-intent', type: 'depends_on', confidence: 0.9 },
            ],
            properties: { confidence: 0.91, risk: 0.22, score: 0.83 },
            sourceRefs: [{ type: 'user_input', ref: 'chat:latest-user-turn' }],
            provenance: { createdByAgent: 'thinkgraph-agent', reasoningSummary: 'safe summary', createdAt: now },
            '@context': 'https://schema.org',
            '@id': 'urn:smoke:think:1',
            '@type': ['Decision'],
          },
        ]
      : [
          {
            id: 'smk-know-1',
            graph: 'know',
            kind: 'claim',
            label: 'Hybrid solvers combine methods',
            summary: 'Hybrid solvers can combine classical and quantum optimization approaches.',
            entities: [
              { id: 'ent-solver', label: 'D-Wave Hybrid Solver', type: 'tool' },
              { id: 'ent-problem', label: 'Optimization Problem', type: 'concept' },
            ],
            relationships: [
              { id: 'rel-k1', from: 'ent-solver', to: 'ent-problem', type: 'used_for', confidence: 0.86 },
            ],
            properties: { confidence: 0.86, relevance: 0.8, evidenceCount: 1 },
            sourceRefs: [{ type: 'url', ref: 'https://example.com/source', title: 'Example Source' }],
            provenance: { createdByAgent: 'knowgraph-agent', reasoningSummary: 'safe summary', createdAt: now },
            '@context': 'https://schema.org',
            '@id': 'urn:smoke:know:1',
            '@type': ['Claim'],
          },
        ];

  const normalized =
    mode === 'think'
      ? normalizeThinkGraphOutputToSemanticRecordsWithValidation(sample)
      : normalizeKnowGraphOutputToSemanticRecordsWithValidation(sample);
  const relationships = normalized.records.flatMap((record) => record.relationships || []);
  const sourceRefs = normalized.records.flatMap((record) => record.sourceRefs || []);
  return res.json({
    status: normalized.validation.ok ? 'ok' : 'error',
    warnings: normalized.validation.warnings,
    errors: normalized.validation.errors,
    records: normalized.records,
    relationships,
    sourceRefs,
    smoke: true,
    persisted: false,
    mode: mode === 'think' ? 'think' : 'know',
  });
});

router.get('/semantic-graph', async (req, res) => {
  const projectId =
    (typeof req.query?.projectId === 'string' && req.query.projectId.trim()) ||
    (typeof req.query?.project_id === 'string' && req.query.project_id.trim()) ||
    '';
  if (!projectId) {
    return res.status(400).json({
      status: 'error',
      records: [],
      relationships: [],
      sourceRefs: [],
      warnings: ['projectId is required'],
    } satisfies GraphReadResult);
  }

  try {
    const graph = await queryKnowGraphProject(projectId);
    if (!graph.nodes.length && !graph.relationships.length) {
      return res.json({
        status: 'unavailable',
        records: [],
        relationships: [],
        sourceRefs: [],
        warnings: ['no semantic records found for project in persisted graph yet'],
      } satisfies GraphReadResult);
    }
    return res.json(legacyGraphToSemanticReadResult(graph));
  } catch (error: any) {
    return res.json({
      status: 'unavailable',
      records: [],
      relationships: [],
      sourceRefs: [],
      warnings: [String(error?.message || 'graph backend unavailable')],
    } satisfies GraphReadResult);
  }
});

/**
 * Persist the established KnowGraph example dataset (semantic seed) into project-scoped Neo4j
 * `:SemanticRecord` nodes/relationships. Shared by the dev-only /semantic-seed route AND the
 * seedKnowGraphExampleData script (which bypasses CORS/auth for local restoration). Returns an
 * HTTP-status + body so the route can relay it directly.
 */
export async function runKnowGraphSemanticSeed(
  projectId: string,
): Promise<{ httpStatus: number; body: any }> {
  const seedRecords = buildSemanticSeedRecords(projectId);
  const errors: string[] = [];
  const warnings: string[] = [];
  const validRecords: SemanticGraphRecord[] = [];

  seedRecords.forEach((record) => {
    const result = validateSemanticGraphRecord(record, { source: 'knowgraph' });
    warnings.push(...result.warnings.map((w) => `${record.id}: ${w}`));
    if (!result.ok) {
      errors.push(...result.errors.map((e) => `${record.id}: ${e}`));
      return;
    }
    validRecords.push(record);
  });

  if (errors.length > 0) {
    return {
      httpStatus: 400,
      body: {
        ok: false,
        inserted: 0,
        skipped: seedRecords.length,
        validation: { ok: false, errors, warnings },
        message: 'seed blocked by validation errors',
      },
    };
  }

  const uri = String(process.env.NEO4J_URI || '').trim();
  const user = String(process.env.NEO4J_USER || '').trim();
  const password = String(process.env.NEO4J_PASSWORD || '').trim();
  if (!uri || !user || !password) {
    return {
      httpStatus: 503,
      body: {
        ok: false,
        inserted: 0,
        skipped: seedRecords.length,
        validation: { ok: false, errors: ['neo4j env missing'], warnings },
        message: 'NEO4J_URI, NEO4J_USER, and NEO4J_PASSWORD are required',
      },
    };
  }

  const neo4jModule: any = await import('neo4j-driver');
  const neo4j: any = neo4jModule?.default ?? neo4jModule;
  const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  const database = String(process.env.NEO4J_DATABASE || '').trim();
  const session = driver.session(database ? { database } : undefined);

  let inserted = 0;
  let relInserted = 0;

  try {
    for (const record of validRecords) {
      const properties: Record<string, unknown> = {
        ...(record.properties || {}),
        graph: record.graph,
        kind: record.kind,
        summary: record.summary,
        confidence: record.confidence,
        sourceRefs: record.sourceRefs || [],
        provenance: record.provenance || null,
        vectorText: record.vectorText || null,
        owlClass: record.owlClass || null,
        owlIndividual: record.owlIndividual || null,
        objectProperties: record.objectProperties || [],
        datatypeProperties: record.datatypeProperties || [],
        annotationProperties: record.annotationProperties || [],
        atType: record['@type'] || null,
        seedTag: 'semantic_seed_launch',
        seededAt: new Date().toISOString(),
      };
      const firstUrl = (record.sourceRefs || []).find((ref) => ref.type === 'url' && /^https?:\/\//i.test(String(ref.ref || '')));
      if (firstUrl?.ref) {
        properties.source_url = firstUrl.ref;
      }

      await session.run(
        `
          MERGE (n:SemanticRecord {project_id: $projectId, semantic_id: $semanticId})
          ON CREATE SET n.created_at = datetime()
          SET n.project_id = $projectId,
              n.label = $label,
              n.type = $type,
              n.seed_group = 'semantic_seed_launch',
              n.updated_at = datetime(),
              n += $props
        `,
        {
          projectId,
          semanticId: record.id,
          label: record.label,
          type: String(record.kind || 'entity'),
          props: toNeoSafeProperties(properties),
        },
      );
      inserted += 1;
    }

    for (const record of validRecords) {
      const allRels: SemanticGraphRelationship[] = [
        ...(Array.isArray(record.relationships) ? record.relationships : []),
        ...(Array.isArray(record.objectProperties)
          ? record.objectProperties.map((rel) => ({
              id: rel.id || `${rel.from}->${rel.to}:${rel.type}`,
              from: rel.from,
              to: rel.to,
              type: rel.type,
              confidence: typeof rel.confidence === 'number' ? rel.confidence : null,
            }))
          : []),
      ];
      for (const rel of allRels) {
        const fromId = String(rel.from || '').trim();
        const toId = String(rel.to || '').trim();
        if (!fromId || !toId) continue;
        const relType = normalizeRelType(String(rel.type || 'RELATED_TO'));
        await session.run(
          `
            MERGE (a:SemanticRecord {project_id: $projectId, semantic_id: $fromId})
            ON CREATE SET a.created_at = datetime(), a.project_id = $projectId, a.label = $fromId, a.type = 'entity'
            MERGE (b:SemanticRecord {project_id: $projectId, semantic_id: $toId})
            ON CREATE SET b.created_at = datetime(), b.project_id = $projectId, b.label = $toId, b.type = 'entity'
            MERGE (a)-[r:${relType} {project_id: $projectId, semantic_rel_id: $relId}]->(b)
            SET r.project_id = $projectId,
                r.semantic_rel_id = $relId,
                r.confidence = $confidence,
                r.summary = $summary,
                r.sourceRefs = $sourceRefs,
                r.seed_group = 'semantic_seed_launch',
                r.updated_at = datetime()
          `,
          {
            projectId,
            fromId,
            toId,
            relId: String(rel.id || `${fromId}->${toId}:${relType}`),
            confidence: typeof rel.confidence === 'number' ? rel.confidence : null,
            summary: String(rel.label || rel.type || ''),
            sourceRefs: JSON.stringify(record.sourceRefs || []),
          },
        );
        relInserted += 1;
      }
    }

    return {
      httpStatus: 200,
      body: {
        ok: true,
        projectId,
        inserted,
        relationshipsInserted: relInserted,
        skipped: seedRecords.length - validRecords.length,
        validation: { ok: true, errors, warnings },
        note: 'semantic seed persisted to project-scoped Neo4j records',
      },
    };
  } catch (error: any) {
    return {
      httpStatus: 500,
      body: {
        ok: false,
        projectId,
        inserted,
        relationshipsInserted: relInserted,
        skipped: seedRecords.length - inserted,
        validation: { ok: false, errors: [String(error?.message || error)], warnings },
        message: 'semantic seed persistence failed',
      },
    };
  } finally {
    await session.close();
    await driver.close();
  }
}

router.post('/semantic-seed', async (req, res) => {
  if (!isDevTestModeEnabled()) {
    return res.status(403).json({
      ok: false,
      error: { message: 'semantic seed route is dev/test only' },
    });
  }
  const projectId =
    (typeof req.query?.projectId === 'string' && req.query.projectId.trim()) ||
    (typeof req.query?.project_id === 'string' && req.query.project_id.trim()) ||
    '';
  if (!projectId) {
    return res.status(400).json({
      ok: false,
      error: { message: 'projectId is required' },
      inserted: 0,
      skipped: 0,
      validation: { ok: false, errors: ['projectId is required'], warnings: [] },
    });
  }
  const result = await runKnowGraphSemanticSeed(projectId);
  return res.status(result.httpStatus).json(result.body);
});

function buildMultipartForm(
  projectId: string,
  documentId: string,
  file: UploadedFile,
  guidance?: {
    organizingPrinciple?: string | null;
    entityTaxonomy?: any | null;
    relationshipTaxonomy?: any | null;
    extractionPolicy?: any | null;
  },
): FormData {
  const form = new FormData();
  form.append('project_id', projectId);
  form.append('document_id', documentId);
  form.append(
    'file',
    new Blob([file.buffer], { type: file.mimetype || 'application/pdf' }),
    file.originalname || `${documentId}.pdf`,
  );
  if (guidance?.organizingPrinciple) {
    form.append('organizing_principle', guidance.organizingPrinciple);
  }
  if (guidance?.entityTaxonomy != null) {
    form.append('entity_taxonomy_json', JSON.stringify(guidance.entityTaxonomy));
  }
  if (guidance?.relationshipTaxonomy != null) {
    form.append('relationship_taxonomy_json', JSON.stringify(guidance.relationshipTaxonomy));
  }
  if (guidance?.extractionPolicy != null) {
    form.append('extraction_policy_json', JSON.stringify(guidance.extractionPolicy));
  }
  return form;
}

async function readResponseDataSafe(response: Response): Promise<any> {
  const text = await response.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { ok: response.ok, message: text };
  }
}

function pickErrorMessage(payload: any): string {
  const candidate =
    payload?.error?.message ??
    payload?.message ??
    payload?.error ??
    '';
  return String(candidate || '').trim();
}

function normalizeKnowgraphIngestError(message: string, provider: string, providerModelId: string): string {
  const raw = String(message || '').trim();
  const providerLabel = provider || 'unknown';
  const modelLabel = providerModelId || 'unknown';
  const lower = raw.toLowerCase();
  if (
    lower.includes('ratelimiterror') ||
    lower.includes('rate limit') ||
    lower.includes('insufficient_quota') ||
    lower.includes('quota')
  ) {
    return `KnowGraph ingest failed for configured provider/model (${providerLabel} / ${modelLabel}): rate limit or quota exceeded. No provider fallback was used.`;
  }
  if (!raw) {
    return `KnowGraph ingest failed for configured provider/model (${providerLabel} / ${modelLabel}). No provider fallback was used.`;
  }
  return `KnowGraph ingest failed for configured provider/model (${providerLabel} / ${modelLabel}). ${raw}`;
}

export async function proxyKnowgraphPdfIngest(input: {
  projectId: string;
  documentId: string;
  file?: UploadedFile | null;
  route?: string;
}): Promise<{ status: number; data: any }> {
  const projectId = String(input.projectId || '').trim();
  const documentId = String(input.documentId || '').trim();
  const file = input.file || undefined;
  const route = String(input.route || '/api/knowgraph/ingest').trim() || '/api/knowgraph/ingest';

  if (!projectId || !documentId || !file) {
    return {
      status: 400,
      data: {
        ok: false,
        error: { message: 'project_id, document_id, and file are required' },
      },
    };
  }

  const fileName = String(file.originalname || '').toLowerCase();
  const fileType = String(file.mimetype || '').toLowerCase();
  const isPdf = fileName.endsWith('.pdf') || fileType.includes('pdf');
  if (!isPdf) {
    return {
      status: 400,
      data: {
        ok: false,
        error: { message: 'Only PDF attachments are supported by the KnowGraph ingest pipeline.' },
      },
    };
  }

  const resolved = await resolveKnowgraphAgent(projectId, route);
  if (!resolved) {
    return {
      status: 409,
      data: {
        ok: false,
        error: { message: 'knowgraph_agent_not_configured' },
      },
    };
  }
  console.log(
    '[RUNTIME_MODEL] route=%s projectId=%s agentType=%s agent_id=%s provider=%s model_key=%s provider_model_id=%s',
    route,
    projectId,
    'knowgraph',
    resolved.agentId,
    resolved.provider,
    resolved.modelKey,
    resolved.providerModelId,
  );
  console.log(
    '[KNOWGRAPH_INGEST] route=%s projectId=%s documentId=%s agentType=knowgraph agentId=%s provider=%s model=%s',
    route,
    projectId,
    documentId,
    resolved.agentId,
    resolved.provider,
    resolved.providerModelId,
  );

  const baseUrls = buildKnowgraphBaseUrls();
  let lastError: any;

  for (const baseUrl of baseUrls) {
    try {
      const form = buildMultipartForm(projectId, documentId, file, {
        organizingPrinciple: resolved.organizingPrinciple ?? null,
        entityTaxonomy: resolved.entityTaxonomy ?? null,
        relationshipTaxonomy: resolved.relationshipTaxonomy ?? null,
        extractionPolicy: resolved.extractionPolicy ?? null,
      });
      const response = await fetch(`${baseUrl}/ingest`, {
        method: 'POST',
        headers: {
          'x-agent-id': resolved.agentId,
          'x-agent-provider': resolved.provider,
          'x-agent-model-key': resolved.modelKey,
          'x-agent-model-id': resolved.providerModelId,
        },
        body: form,
      });
      const data = await readResponseDataSafe(response);
      if (response.ok) {
        return { status: response.status, data };
      }

      const upstreamMessage = pickErrorMessage(data);
      return {
        status: response.status,
        data: {
          ok: false,
          error: {
            code: `knowgraph_ingest_upstream_${response.status}`,
            message: normalizeKnowgraphIngestError(
              upstreamMessage,
              resolved.provider,
              resolved.providerModelId,
            ),
            provider: resolved.provider,
            model_key: resolved.modelKey,
            provider_model_id: resolved.providerModelId,
          },
          upstream: data,
        },
      };
    } catch (error: any) {
      lastError = error;
      const code = String(error?.cause?.code || error?.code || '');
      const canRetryNetworkLookup =
        code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'EAI_AGAIN';
      if (!canRetryNetworkLookup) {
        break;
      }
    }
  }

  throw lastError;
}

router.post('/ingest', knowgraphUploadSingle as any, async (req, res) => {
  try {
    const projectId = typeof req.body?.project_id === 'string' ? req.body.project_id.trim() : '';
    const documentId = typeof req.body?.document_id === 'string' ? req.body.document_id.trim() : '';
    const file = (req as any).file as UploadedFile | undefined;
    const upstream = await proxyKnowgraphPdfIngest({
      projectId,
      documentId,
      file,
      route: '/api/knowgraph/ingest',
    });
    return res.status(upstream.status).json(upstream.data);
  } catch (error: any) {
    const message =
      error?.cause?.message ||
      (typeof error?.toString === 'function' ? error.toString() : undefined) ||
      error?.message ||
      'KnowGraph proxy request failed';
    return res.status(502).json({ ok: false, error: { message } });
  }
});

router.post('/ingest_code', async (req, res) => {
  try {
    const projectId = typeof req.body?.project_id === 'string' ? req.body.project_id.trim() : '';
    const documentId = typeof req.body?.document_id === 'string' ? req.body.document_id.trim() : '';
    const codeText = typeof req.body?.code_text === 'string' ? req.body.code_text : '';
    const filePath = typeof req.body?.file_path === 'string' ? req.body.file_path.trim() : undefined;
    const language = typeof req.body?.language === 'string' ? req.body.language.trim() : undefined;

    if (!projectId || !documentId || !codeText) {
      return res.status(400).json({
        ok: false,
        error: { message: 'project_id, document_id, and code_text are required' },
      });
    }

    const resolved = await resolveKnowgraphAgent(projectId, '/api/knowgraph/ingest_code');
    if (!resolved) {
      return res.status(409).json({
        ok: false,
        error: { message: 'knowgraph_agent_not_configured' },
      });
    }

    const baseUrls = buildKnowgraphBaseUrls();
    let lastError: any;

    for (const baseUrl of baseUrls) {
      try {
        const form = new FormData();
        form.append('project_id', projectId);
        form.append('document_id', documentId);
        form.append('code_text', codeText);
        if (filePath) form.append('file_path', filePath);
        if (language) form.append('language', language);
        if (resolved.organizingPrinciple) form.append('organizing_principle', resolved.organizingPrinciple);
        if (resolved.entityTaxonomy) form.append('entity_taxonomy_json', JSON.stringify(resolved.entityTaxonomy));
        if (resolved.relationshipTaxonomy) form.append('relationship_taxonomy_json', JSON.stringify(resolved.relationshipTaxonomy));
        if (resolved.extractionPolicy) form.append('extraction_policy_json', JSON.stringify(resolved.extractionPolicy));

        const response = await fetch(`${baseUrl}/ingest_code`, {
          method: 'POST',
          headers: {
            'x-agent-id': resolved.agentId,
            'x-agent-provider': resolved.provider,
            'x-agent-model-key': resolved.modelKey,
            'x-agent-model-id': resolved.providerModelId,
          },
          body: form,
        });

        const data = await readResponseDataSafe(response);
        return res.status(response.status).json(data);
      } catch (error: any) {
        lastError = error;
        const code = String(error?.cause?.code || error?.code || '');
        const canRetryNetworkLookup = code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'EAI_AGAIN';
        if (!canRetryNetworkLookup) {
          break;
        }
      }
    }

    throw lastError;
  } catch (error: any) {
    const message = error?.message || 'KnowGraph code ingest proxy request failed';
    return res.status(502).json({ ok: false, error: { message } });
  }
});

export default router;
