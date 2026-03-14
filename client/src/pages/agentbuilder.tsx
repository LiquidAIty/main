import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AgentCard } from "../types/agentBuilder";
import { callBossAgent } from "../lib/api";
import { AgentManager } from "../components/AgentManager";
import KnowledgeGraphNVL, {
  type KnowledgeGraphRelationship,
  type KnowledgeGraphNode,
} from "../components/knowledge/KnowledgeGraphNVL";
import UploadAttachment from "../components/knowledge/UploadAttachment";

// AgentPage (MVP): left icon rail + main chat + right tabs (Plan, Links, Knowledge, Dashboard)
// No external deps. Persists per-project to localStorage. Includes mini force-graph.

const C = {
  primary: "#4FA2AD", // teal
  bg: "#1F1F1F",
  panel: "#2B2B2B",
  border: "#3A3A3A",
  text: "#FFFFFF",
  neutral: "#E0DED5",
  accent: "#8358A4",
  warn: "#D98458",
};

// ---- utils ----
function clamp(x: number, a: number, b: number) {
  return Math.min(b, Math.max(a, x));
}

function safeText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    const json = JSON.stringify(value);
    if (typeof json === "string") return json;
  } catch {
    // fallback below
  }
  return String(value);
}

function normalizeMessages(input: unknown): { role: "assistant" | "user"; text: string }[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((m: any) => ({
      role: m?.role === "assistant" ? "assistant" : "user",
      text: safeText(m?.text),
    }))
    .filter((m) => m.text.length > 0);
}

function normalizePlanItems(input: unknown): PlanItem[] {
  if (!Array.isArray(input)) return [];
  const out: PlanItem[] = [];
  input.forEach((item: any, idx) => {
    const text = safeText(item?.text).trim();
    if (!text) return;
    const statusRaw = safeText(item?.status).toLowerCase();
    const status: PlanItem["status"] =
      statusRaw === "approved" || statusRaw === "done" ? (statusRaw as PlanItem["status"]) : "draft";
    out.push({
      id: safeText(item?.id).trim() || `plan_${idx}_${uid()}`,
      text,
      status,
    });
  });
  return out;
}

function normalizeLinks(input: unknown): LinkRef[] {
  if (!Array.isArray(input)) return [];
  const out: LinkRef[] = [];
  input.forEach((item: any, idx) => {
    const id = safeText(item?.id).trim() || `link_${idx}_${uid()}`;
    const title = safeText(item?.title).trim() || "Untitled";
    const url = safeText(item?.url).trim();
    if (!url) return;
    const src = safeText(item?.src).trim();
    const accepted = Boolean(item?.accepted);
    const tsNum = Number(item?.ts);
    out.push({
      id,
      title,
      url,
      src,
      accepted,
      ts: Number.isFinite(tsNum) ? tsNum : Date.now(),
    });
  });
  return out;
}

const uid = () => Math.random().toString(36).slice(2, 8);
const DEBUG = false;
const V2_PROJECTS_API = "/api/v2/projects";

async function safeJson(res: Response): Promise<any | null> {
  if (res.status === 204 || res.status === 304) return null;
  let text = '';
  try {
    text = await res.text();
  } catch (err) {
    console.warn('[safeJson] failed to read body', { status: res.status, url: res.url });
    return null;
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (err: any) {
    console.warn('[safeJson] invalid JSON', { status: res.status, url: res.url, error: err?.message || err });
    return null;
  }
}

async function readJsonAndText(res: Response): Promise<{ data: any | null; text: string }> {
  let text = "";
  try {
    text = await res.text();
  } catch {
    return { data: null, text: "" };
  }
  if (!text) return { data: null, text: "" };
  try {
    return { data: JSON.parse(text), text };
  } catch {
    return { data: null, text };
  }
}

function formatRequestErrorLine(endpoint: string, status: number, bodyPreview: string): string {
  const compactBody = String(bodyPreview || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  return `${endpoint} | ${status} | ${compactBody || "no response body"}`;
}

type GuardedRequestOptions<T> = {
  key: string;
  method?: string;
  ttlMs?: number;
  dedupe?: boolean;
  signal?: AbortSignal;
  fetcher: (signal: AbortSignal) => Promise<T>;
};

const requestGuardInFlight = new Map<string, Promise<any>>();
const requestGuardCache = new Map<string, { expiresAt: number; value: any }>();
const requestGuardSeq = new Map<string, number>();

function makeAbortError() {
  const error = new Error("Request aborted") as Error & { name: string };
  error.name = "AbortError";
  return error;
}

function isAbortLikeError(err: any): boolean {
  const name = String(err?.name || "");
  const message = String(err?.message || "");
  return name === "AbortError" || message.toLowerCase().includes("aborted");
}

function withAbortSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(makeAbortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(makeAbortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => {
        signal.removeEventListener("abort", onAbort);
      });
  });
}

function linkAbortSignal(externalSignal?: AbortSignal): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  if (!externalSignal) return { signal: controller.signal, cleanup: () => {} };
  if (externalSignal.aborted) {
    controller.abort();
    return { signal: controller.signal, cleanup: () => {} };
  }
  const onAbort = () => controller.abort();
  externalSignal.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => externalSignal.removeEventListener("abort", onAbort),
  };
}

async function guardedRequest<T>(options: GuardedRequestOptions<T>): Promise<T> {
  const method = (options.method || "GET").toUpperCase();
  const ttlMs = options.ttlMs || 0;
  const canCache = method === "GET" && ttlMs > 0;
  if (canCache) {
    const cached = requestGuardCache.get(options.key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value as T;
    }
  }

  const shouldDedupe = options.dedupe !== false;
  if (shouldDedupe) {
    const existing = requestGuardInFlight.get(options.key) as Promise<T> | undefined;
    if (existing) {
      return withAbortSignal(existing, options.signal);
    }
  }

  const linked = linkAbortSignal(options.signal);
  const requestPromise = (async () => {
    try {
      const value = await options.fetcher(linked.signal);
      if (canCache) {
        requestGuardCache.set(options.key, {
          expiresAt: Date.now() + ttlMs,
          value,
        });
      }
      return value;
    } finally {
      requestGuardInFlight.delete(options.key);
      linked.cleanup();
    }
  })();
  requestGuardInFlight.set(options.key, requestPromise);
  return withAbortSignal(requestPromise, options.signal);
}

function nextRequestSequence(requestType: string): number {
  const next = (requestGuardSeq.get(requestType) || 0) + 1;
  requestGuardSeq.set(requestType, next);
  return next;
}

function isLatestRequestSequence(requestType: string, sequence: number): boolean {
  return (requestGuardSeq.get(requestType) || 0) === sequence;
}

const KG_CACHE_PREFIX = "agentbuilder:kg-cache:v1";
const KG_CACHE_TTL_MS = 60_000;

type CachedGraphPayload = {
  updatedAt: number;
  cypher: string;
  graphResult: any[];
  knowGraphData: { nodes: any[]; relationships: any[] };
};

function readCachedGraphPayload(cacheKey: string): CachedGraphPayload | null {
  try {
    const raw = window.localStorage.getItem(cacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      updatedAt: Number(parsed.updatedAt) || 0,
      cypher: typeof parsed.cypher === "string" ? parsed.cypher : "",
      graphResult: Array.isArray(parsed.graphResult) ? parsed.graphResult : [],
      knowGraphData: {
        nodes: Array.isArray(parsed?.knowGraphData?.nodes) ? parsed.knowGraphData.nodes : [],
        relationships: Array.isArray(parsed?.knowGraphData?.relationships) ? parsed.knowGraphData.relationships : [],
      },
    };
  } catch {
    return null;
  }
}

function writeCachedGraphPayload(cacheKey: string, payload: CachedGraphPayload): void {
  try {
    window.localStorage.setItem(cacheKey, JSON.stringify(payload));
  } catch {
    // best-effort cache
  }
}

function isCachedGraphFresh(payload: CachedGraphPayload | null, ttlMs: number): boolean {
  if (!payload?.updatedAt) return false;
  return Date.now() - payload.updatedAt <= ttlMs;
}

type PlanItem = { id: string; text: string; status: "draft" | "approved" | "done" };
type LinkRef = {
  id: string;
  title: string;
  url: string;
  src: string;
  accepted: boolean;
  ts: number;
};

type KNode = {
  id: string;
  rawId?: string;
  label: string;
  type?: string;
  graphSource?: "think" | "know";
  last_seen_ts?: string;
  degree?: number;
  createdAtMs?: number;
  confidence?: number;
};

type KEdge = {
  a: string;
  b: string;
  id?: string;
  rawId?: string;
  graphSource?: "think" | "know";
  source?: string;
  target?: string;
  type?: string;
  weight?: number;
  confidence?: number;
  last_seen_ts?: string;
  lastSeenMs?: number;
  evidence_doc_id?: string;
  evidence_snippet?: string;
};

const STRONG_RELATIONS = new Set(["part_of", "member_of", "instance_of"]);
const MEDIUM_RELATIONS = new Set(["works_at", "created_by", "uses"]);
const WEAK_RELATIONS = new Set(["mentions", "related_to"]);
const KG_SEED_QUERY = [
  "MATCH (a:Entity { project_id: $projectId })-[r:REL { project_id: $projectId }]->(b:Entity { project_id: $projectId })",
  "WHERE ($typeFilter IS NULL OR toLower(coalesce(a.etype, 'unknown')) = $typeFilter OR toLower(coalesce(b.etype, 'unknown')) = $typeFilter)",
  "AND ($sinceTs IS NULL OR coalesce(r.created_at, a.created_at, b.created_at) >= $sinceTs)",
  "AND ($minConfidence IS NULL OR coalesce(r.confidence, 0.0) >= $minConfidence)",
  "RETURN {",
  "  a_id: id(a), a_name: coalesce(a.name, toString(id(a))), a_type: coalesce(a.etype, 'unknown'), a_ts: coalesce(a.created_at, r.created_at, b.created_at), a_doc_id: coalesce(a.source.doc_id, a.source.docId, r.source.doc_id, r.source.docId),",
  "  r_type: coalesce(r.rtype, 'related_to'), r_weight: coalesce(r.weight, r.confidence, 0.5), r_confidence: coalesce(r.confidence, r.weight, 0.5), r_ts: coalesce(r.created_at, a.created_at, b.created_at), r_doc_id: coalesce(r.source.doc_id, r.source.docId, a.source.doc_id, b.source.doc_id), r_snippet: coalesce(r.source.snippet, r.attrs.snippet),",
  "  b_id: id(b), b_name: coalesce(b.name, toString(id(b))), b_type: coalesce(b.etype, 'unknown'), b_ts: coalesce(b.created_at, r.created_at, a.created_at), b_doc_id: coalesce(b.source.doc_id, b.source.docId, r.source.doc_id, r.source.docId)",
  "} AS row",
  "ORDER BY coalesce(r.created_at, a.created_at, b.created_at) DESC",
  "LIMIT toInteger($limit)",
].join(" ");
const KG_EXPAND_QUERY = [
  "MATCH (n:Entity { project_id: $projectId })",
  "WHERE id(n) = toInteger($nodeId)",
  "MATCH (n)-[r:REL { project_id: $projectId }]-(m:Entity { project_id: $projectId })",
  "WHERE ($typeFilter IS NULL OR toLower(coalesce(n.etype, 'unknown')) = $typeFilter OR toLower(coalesce(m.etype, 'unknown')) = $typeFilter)",
  "AND ($sinceTs IS NULL OR coalesce(r.created_at, n.created_at, m.created_at) >= $sinceTs)",
  "AND ($minConfidence IS NULL OR coalesce(r.confidence, 0.0) >= $minConfidence)",
  "RETURN {",
  "  a_id: id(n), a_name: coalesce(n.name, toString(id(n))), a_type: coalesce(n.etype, 'unknown'), a_ts: coalesce(n.created_at, r.created_at, m.created_at), a_doc_id: coalesce(n.source.doc_id, n.source.docId, r.source.doc_id, r.source.docId),",
  "  r_type: coalesce(r.rtype, 'related_to'), r_weight: coalesce(r.weight, r.confidence, 0.5), r_confidence: coalesce(r.confidence, r.weight, 0.5), r_ts: coalesce(r.created_at, n.created_at, m.created_at), r_doc_id: coalesce(r.source.doc_id, r.source.docId, n.source.doc_id, m.source.doc_id), r_snippet: coalesce(r.source.snippet, r.attrs.snippet),",
  "  b_id: id(m), b_name: coalesce(m.name, toString(id(m))), b_type: coalesce(m.etype, 'unknown'), b_ts: coalesce(m.created_at, r.created_at, n.created_at), b_doc_id: coalesce(m.source.doc_id, m.source.docId, r.source.doc_id, r.source.docId)",
  "} AS row",
  "ORDER BY coalesce(r.created_at, n.created_at, m.created_at) DESC",
  "LIMIT toInteger($limit)",
].join(" ");

function normalizeRelationType(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseTimestampMs(value: unknown): number | undefined {
  if (value == null) return undefined;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const s = String(value).trim();
  if (!s) return undefined;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : undefined;
}

type AgentPrompt = {
  role: string;
  context: string;
  objectives: string;
  style: string;
};

type WorkbenchOutputMap = Record<"Plan" | "Links" | "Knowledge" | "Dashboard", string>;
type WorkbenchRating = { stars: number; note: string };
type AgentTypeKey = "agent_builder" | "llm_chat" | "kg_ingest" | "knowgraph" | "neo4j" | "research_agent";
const SYSTEM_AGENT_TYPES = new Set<AgentTypeKey>(["llm_chat", "kg_ingest", "knowgraph", "neo4j", "research_agent"]);

function normalizeProjectCardKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function inferProjectCardType(card: any): "assist" | "agent" {
  const explicit = String(card?.project_type ?? "").trim().toLowerCase();
  if (explicit === "assist" || explicit === "agent") {
    return explicit;
  }

  const codeKey = normalizeProjectCardKey(card?.code);
  const nameKey = normalizeProjectCardKey(card?.name);
  const legacyAgentKeys = new Set([
    "main-chat",
    "kg-ingest",
    "thinkgraph",
    "knowgraph",
    "neo4j",
    "research-agent",
    "agent-builder",
  ]);

  if (legacyAgentKeys.has(codeKey) || legacyAgentKeys.has(nameKey) || Boolean(card?.hasAgentConfig)) {
    return "agent";
  }

  return "assist";
}

function dedupeProjectCards(cards: any[]): any[] {
  const byKey = new Map<string, any>();

  cards.forEach((card: any) => {
    const codeKey = normalizeProjectCardKey(card?.code);
    const nameKey = normalizeProjectCardKey(card?.name);
    const idKey = String(card?.id ?? "").trim();
    const key = codeKey ? `code:${codeKey}` : nameKey ? `name:${nameKey}` : `id:${idKey}`;
    if (!key) return;

    const next = {
      ...card,
      project_type: inferProjectCardType(card),
    };
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, next);
      return;
    }

    const existingSynthetic = Boolean(existing?.syntheticSystemDeck);
    const nextSynthetic = Boolean(next?.syntheticSystemDeck);
    if (existingSynthetic && !nextSynthetic) {
      byKey.set(key, next);
      return;
    }
    if (!existing?.project_type && next?.project_type) {
      byKey.set(key, next);
    }
  });

  return Array.from(byKey.values());
}

function buildAgentManagerRenderKey(
  activeConfigProjectId: string,
  selectedAgentProjectId: string,
  selectedAgentType: AgentTypeKey,
): string {
  const configProjectId = String(activeConfigProjectId || "").trim();
  const selectedProjectId = selectedAgentType === "agent_builder"
    ? String(selectedAgentProjectId || "").trim()
    : "";
  return `${configProjectId}:${selectedProjectId}:${selectedAgentType}`;
}

function agentTypeFromProjectCode(projectCode: string): AgentTypeKey {
  const code = String(projectCode || "").toLowerCase();
  if (code === "main-chat" || code === "main_chat" || code === "llm-chat" || code === "llm_chat") return "llm_chat";
  if (code === "kg-ingest" || code === "kg_ingest" || code === "thinkgraph") return "kg_ingest";
  if (code === "knowgraph") return "knowgraph";
  if (code === "neo4j") return "neo4j";
  if (code === "research-agent" || code === "research_agent" || code === "web-research") return "research_agent";
  if (code === "agent-builder" || code === "agent_builder") return "agent_builder";
  return "agent_builder";
}
// helper: load all project-local state (defaults only; real data is fetched from backend)
function loadProjectState(_projectId: string, _mode: "assist" | "agents" = "assist") {
  return {
    messages: [] as { role: "assistant" | "user"; text: string }[],
    plan: [{ id: uid(), text: "Define objective", status: "draft" }] as PlanItem[],
    links: [] as LinkRef[],
  };
}

// helper: convert AGE query results to graph nodes/edges for visualization
function ageRowsToGraph(rows: any[]): { nodes: KNode[]; edges: KEdge[] } {
  const nodeMap = new Map<string, KNode>();
  const edgeMap = new Map<string, KEdge>();

  const asObject = (raw: any): Record<string, any> | null => {
    const parsed =
      typeof raw === "string"
        ? (() => {
            try {
              return JSON.parse(raw);
            } catch {
              return null;
            }
          })()
        : raw;
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.row && typeof parsed.row === "object") return parsed.row as Record<string, any>;
    return parsed as Record<string, any>;
  };

  const normalizeType = (value: unknown): string => {
    const normalized = String(value ?? "").trim().toLowerCase();
    return normalized || "unknown";
  };

  const toNum = (value: unknown): number | undefined => {
    if (value == null) return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  };

  const toIsoTs = (value: unknown): string | undefined => {
    const ms = parseTimestampMs(value);
    if (typeof ms !== "number") return undefined;
    return new Date(ms).toISOString();
  };

  const upsertNode = (idRaw: unknown, labelRaw: unknown, typeRaw: unknown, tsRaw: unknown) => {
    const id = String(idRaw ?? "").trim();
    if (!id) return;

    const label = String(labelRaw ?? "").trim() || id.slice(0, 12);
    const type = normalizeType(typeRaw);
    const nextMs = parseTimestampMs(tsRaw);
    const nextTs = typeof nextMs === "number" ? new Date(nextMs).toISOString() : undefined;

    const existing = nodeMap.get(id);
    if (!existing) {
      nodeMap.set(id, {
        id,
        label,
        type,
        createdAtMs: nextMs,
        last_seen_ts: nextTs,
      });
      return;
    }

    if (!existing.label || existing.label === existing.id.slice(0, 12)) {
      existing.label = label;
    }
    if ((!existing.type || existing.type === "unknown") && type !== "unknown") {
      existing.type = type;
    }
    if (typeof nextMs === "number" && (!existing.createdAtMs || nextMs > existing.createdAtMs)) {
      existing.createdAtMs = nextMs;
      existing.last_seen_ts = nextTs;
    }
  };

  const upsertEdge = (
    sourceRaw: unknown,
    targetRaw: unknown,
    relTypeRaw: unknown,
    row: Record<string, any>,
  ) => {
    const source = String(sourceRaw ?? "").trim();
    const target = String(targetRaw ?? "").trim();
    if (!source || !target) return;

    const relType = normalizeRelationType(relTypeRaw) || "related_to";
    const evidenceDocId = String(row.r_doc_id ?? row.doc_id ?? "").trim() || undefined;
    const evidenceSnippet = String(row.r_snippet ?? row.snippet ?? "").trim() || undefined;
    const edgeTs = toIsoTs(row.r_ts ?? row.r_created_at ?? row.created_at);
    const edgeWeight = toNum(row.r_weight ?? row.weight ?? row.confidence);
    const edgeConfidence = toNum(row.r_confidence ?? row.confidence ?? row.r_weight ?? row.weight);
    const explicitEdgeId = String(row.r_id ?? row.edge_id ?? "").trim();
    const edgeId =
      explicitEdgeId ||
      `${source}->${target}:${relType}:${evidenceDocId || ""}:${edgeTs || ""}`;

    const existing = edgeMap.get(edgeId);
    if (!existing) {
      edgeMap.set(edgeId, {
        id: edgeId,
        source,
        target,
        a: source,
        b: target,
        type: relType,
        weight: edgeWeight,
        confidence: edgeConfidence,
        last_seen_ts: edgeTs,
        lastSeenMs: parseTimestampMs(edgeTs),
        evidence_doc_id: evidenceDocId,
        evidence_snippet: evidenceSnippet,
      });
      return;
    }

    if (typeof edgeWeight === "number") {
      existing.weight = Math.max(existing.weight ?? 0, edgeWeight);
    }
    if (typeof edgeConfidence === "number") {
      existing.confidence = Math.max(existing.confidence ?? 0, edgeConfidence);
    }
    if (!existing.evidence_doc_id && evidenceDocId) {
      existing.evidence_doc_id = evidenceDocId;
    }
    if (!existing.evidence_snippet && evidenceSnippet) {
      existing.evidence_snippet = evidenceSnippet;
    }
    const nextMs = parseTimestampMs(edgeTs);
    if (typeof nextMs === "number" && (!existing.lastSeenMs || nextMs > existing.lastSeenMs)) {
      existing.lastSeenMs = nextMs;
      existing.last_seen_ts = edgeTs;
    }
  };

  const extractNodeId = (obj: any): string => {
    if (!obj) return "";
    if (obj.id != null) return String(obj.id);
    if (obj._id != null) return String(obj._id);
    if (obj.vid != null) return String(obj.vid);
    return "";
  };

  rows.forEach((rawRow) => {
    const row = asObject(rawRow);
    if (!row) return;

    if (row.a_id != null && row.b_id != null) {
      upsertNode(
        row.a_id,
        row.a_name,
        row.a_type ?? row.a_etype ?? row.a_category,
        row.a_ts ?? row.a_created_at,
      );
      upsertNode(
        row.b_id,
        row.b_name,
        row.b_type ?? row.b_etype ?? row.b_category,
        row.b_ts ?? row.b_created_at,
      );
      upsertEdge(row.a_id, row.b_id, row.r_type ?? row.rel_type, row);
      return;
    }

    if (row.a && row.b) {
      const aId = extractNodeId(row.a);
      const bId = extractNodeId(row.b);
      const aProps = row.a?.properties || row.a;
      const bProps = row.b?.properties || row.b;
      upsertNode(aId, aProps?.name ?? aProps?.label, aProps?.etype ?? aProps?.type, aProps?.created_at);
      upsertNode(bId, bProps?.name ?? bProps?.label, bProps?.etype ?? bProps?.type, bProps?.created_at);
      upsertEdge(aId, bId, row.r?.rtype ?? row.r?.type ?? row.rtype, {
        ...row,
        r_ts: row.r?.created_at,
        r_weight: row.r?.weight,
        r_confidence: row.r?.confidence,
        r_doc_id: row.r?.source?.doc_id,
        r_snippet: row.r?.source?.snippet,
      });
    }
  });

  const edges = Array.from(edgeMap.values());
  const degreeByNode = new Map<string, number>();
  edges.forEach((e) => {
    const source = e.source || e.a;
    const target = e.target || e.b;
    if (!source || !target) return;
    degreeByNode.set(source, (degreeByNode.get(source) || 0) + 1);
    degreeByNode.set(target, (degreeByNode.get(target) || 0) + 1);
    if (!nodeMap.has(source)) {
      upsertNode(source, source, "unknown", e.last_seen_ts);
    }
    if (!nodeMap.has(target)) {
      upsertNode(target, target, "unknown", e.last_seen_ts);
    }
  });

  const nodes = Array.from(nodeMap.values()).map((n) => ({
    ...n,
    rawId: n.id,
    graphSource: "think" as const,
    degree: degreeByNode.get(n.id) || 0,
    type: normalizeType(n.type),
  }));

  return {
    nodes,
    edges: edges.map((e) => ({
      ...e,
      rawId: e.id,
      graphSource: "think" as const,
    })),
  };
}

function safeRecord(input: unknown): Record<string, any> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return input as Record<string, any>;
}

function normalizeKnowGraphResponseToGraph(payload: any): { nodes: KNode[]; edges: KEdge[] } {
  const rawNodes = Array.isArray(payload?.nodes) ? payload.nodes : [];
  const rawRels = Array.isArray(payload?.relationships) ? payload.relationships : [];

  const nodes: KNode[] = [];
  const edges: KEdge[] = [];
  const seenNodeIds = new Set<string>();
  const seenEdgeIds = new Set<string>();

  rawNodes.forEach((raw: any) => {
    const rawId = String(raw?.id ?? "").trim();
    if (!rawId) return;
    const id = `kg:${rawId}`;
    if (seenNodeIds.has(id)) return;
    seenNodeIds.add(id);

    const props = safeRecord(raw?.properties);
    const ts = props.last_seen_ts ?? props.created_at ?? props.updated_at ?? undefined;
    nodes.push({
      id,
      rawId,
      graphSource: "know",
      label: safeText(raw?.label || props.name || props.title || rawId),
      type: safeText(raw?.type || (Array.isArray(raw?.labels) ? raw.labels[0] : "") || "NeoEntity").toLowerCase(),
      last_seen_ts: typeof ts === "string" ? ts : undefined,
      createdAtMs: parseTimestampMs(ts),
      degree: 0,
    });
  });

  rawRels.forEach((raw: any) => {
    const rawId = String(raw?.id ?? "").trim() || `${raw?.from ?? ""}->${raw?.to ?? ""}:${raw?.type ?? "RELATED_TO"}`;
    const fromRaw = String(raw?.from ?? "").trim();
    const toRaw = String(raw?.to ?? "").trim();
    if (!fromRaw || !toRaw) return;

    const id = `kg:${rawId}`;
    if (seenEdgeIds.has(id)) return;
    seenEdgeIds.add(id);

    const props = safeRecord(raw?.properties);
    const source = `kg:${fromRaw}`;
    const target = `kg:${toRaw}`;
    const lastSeen =
      props.last_seen_ts ??
      props.created_at ??
      props.updated_at ??
      undefined;
    const confidenceNum = Number(props.confidence ?? props.score ?? NaN);
    const weightNum = Number(props.weight ?? props.score ?? props.confidence ?? NaN);

    edges.push({
      id,
      rawId,
      graphSource: "know",
      a: source,
      b: target,
      source,
      target,
      type: safeText(raw?.type || "RELATED_TO").toLowerCase(),
      weight: Number.isFinite(weightNum) ? weightNum : undefined,
      confidence: Number.isFinite(confidenceNum) ? confidenceNum : undefined,
      last_seen_ts: typeof lastSeen === "string" ? lastSeen : undefined,
      lastSeenMs: parseTimestampMs(lastSeen),
      evidence_doc_id: safeText(props.document_id || props.doc_id || ""),
      evidence_snippet: safeText(props.snippet || props.evidence_snippet || ""),
    });
  });

  const degreeByNode = new Map<string, number>();
  edges.forEach((e) => {
    const s = e.source || e.a;
    const t = e.target || e.b;
    if (s) degreeByNode.set(s, (degreeByNode.get(s) || 0) + 1);
    if (t) degreeByNode.set(t, (degreeByNode.get(t) || 0) + 1);
  });

  return {
    nodes: nodes.map((n) => ({
      ...n,
      degree: degreeByNode.get(n.id) || n.degree || 0,
    })),
    edges,
  };
}

function prefixThinkGraphIds(graph: { nodes: KNode[]; edges: KEdge[] }): { nodes: KNode[]; edges: KEdge[] } {
  const rawToPrefixed = new Map<string, string>();
  graph.nodes.forEach((n) => {
    rawToPrefixed.set(n.id, `tg:${n.id}`);
  });

  const nodes = graph.nodes.map((n) => ({
    ...n,
    rawId: n.rawId || n.id,
    id: rawToPrefixed.get(n.id) || `tg:${n.id}`,
    graphSource: "think" as const,
  }));

  const edges = graph.edges.map((e) => {
    const rawSource = String(e.source || e.a || "").trim();
    const rawTarget = String(e.target || e.b || "").trim();
    const prefSource = rawToPrefixed.get(rawSource) || `tg:${rawSource}`;
    const prefTarget = rawToPrefixed.get(rawTarget) || `tg:${rawTarget}`;
    return {
      ...e,
      rawId: e.rawId || e.id,
      graphSource: "think" as const,
      id: e.id ? `tg:${e.id}` : `${prefSource}->${prefTarget}:${e.type || "related_to"}`,
      a: prefSource,
      b: prefTarget,
      source: prefSource,
      target: prefTarget,
    };
  });

  return { nodes, edges };
}

function mergeKnowledgeGraphs(...graphs: Array<{ nodes: KNode[]; edges: KEdge[] }>): { nodes: KNode[]; edges: KEdge[] } {
  const nodeMap = new Map<string, KNode>();
  const edgeMap = new Map<string, KEdge>();

  graphs.forEach((graph) => {
    graph.nodes.forEach((node) => {
      if (!node?.id) return;
      if (!nodeMap.has(node.id)) {
        nodeMap.set(node.id, node);
      }
    });
    graph.edges.forEach((edge) => {
      const edgeId = String(edge?.id || "").trim();
      if (!edgeId) return;
      if (!edgeMap.has(edgeId)) {
        edgeMap.set(edgeId, edge);
      }
    });
  });

  const degreeByNode = new Map<string, number>();
  Array.from(edgeMap.values()).forEach((e) => {
    const s = e.source || e.a;
    const t = e.target || e.b;
    if (s) degreeByNode.set(s, (degreeByNode.get(s) || 0) + 1);
    if (t) degreeByNode.set(t, (degreeByNode.get(t) || 0) + 1);
  });

  return {
    nodes: Array.from(nodeMap.values()).map((n) => ({
      ...n,
      degree: degreeByNode.get(n.id) || n.degree || 0,
    })),
    edges: Array.from(edgeMap.values()),
  };
}

function buildGraphVizForNVL(graph: { nodes: KNode[]; edges: KEdge[] }) {
  const entities: KnowledgeGraphNode[] = graph.nodes.map((n) => {
    const source = n.graphSource === "know" ? "know" : "think";
    return {
      id: n.id,
      rawId: n.rawId || n.id,
      label: n.label || n.id,
      type: String(n.type || "unknown").toLowerCase(),
      source,
      originSource: source,
      last_seen_ts: n.last_seen_ts,
      degree: n.degree || 0,
    };
  });

  const relationships: KnowledgeGraphRelationship[] = [];
  graph.edges.forEach((e) => {
    const source = e.source || e.a;
    const target = e.target || e.b;
    if (!source || !target) return;
    relationships.push({
      id: e.id || `${source}->${target}:${e.type || "related_to"}`,
      rawId: e.rawId || e.id || `${source}->${target}:${e.type || "related_to"}`,
      from: source,
      to: target,
      type: e.type || "related_to",
      source: e.graphSource === "know" ? "know" : "think",
      weight: e.weight,
      confidence: e.confidence,
      last_seen_ts: e.last_seen_ts,
      evidence_doc_id: e.evidence_doc_id,
      evidence_snippet: e.evidence_snippet,
    });
  });

  return { entities, relationships };
}

function knowledgePanelSummaryText(graph: { nodes: KNode[]; edges: KEdge[] }): string {
  return `Entities: ${graph.nodes.length} | Relationships: ${graph.edges.length}`;
}

// -------- Knowledge: interactive force-layout canvas --------
type CameraState = { x: number; y: number; scale: number };
type SimNodeState = { x: number; y: number; vx: number; vy: number; mass: number };
type XY = { x: number; y: number };

function pointToSegmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / lenSq, 0, 1);
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function hashString(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) {
    h = (h * 31 + text.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function relationForceConfig(relationType?: string) {
  const rel = normalizeRelationType(relationType);
  if (STRONG_RELATIONS.has(rel)) return { spring: 0.013, length: 92, alpha: 0.75 };
  if (MEDIUM_RELATIONS.has(rel)) return { spring: 0.008, length: 132, alpha: 0.55 };
  if (WEAK_RELATIONS.has(rel)) return { spring: 0.0045, length: 178, alpha: 0.34 };
  return { spring: 0.0058, length: 156, alpha: 0.45 };
}

function relationColor(relationType?: string): string {
  const rel = normalizeRelationType(relationType);
  if (STRONG_RELATIONS.has(rel)) return "110, 233, 172";
  if (MEDIUM_RELATIONS.has(rel)) return "126, 189, 255";
  if (WEAK_RELATIONS.has(rel)) return "138, 148, 168";
  return "122, 172, 214";
}

function edgeControlPoint(ax: number, ay: number, bx: number, by: number, seed: string, cameraScale: number): XY {
  const dx = bx - ax;
  const dy = by - ay;
  const d = Math.max(1, Math.hypot(dx, dy));
  const nx = -dy / d;
  const ny = dx / d;
  const hash = hashString(seed);
  const sign = hash % 2 === 0 ? 1 : -1;
  const bendBase = (14 + (hash % 11)) / Math.max(cameraScale, 0.22);
  const bend = Math.min(bendBase, d * 0.35) * sign;
  return { x: (ax + bx) / 2 + nx * bend, y: (ay + by) / 2 + ny * bend };
}

function quadPoint(ax: number, ay: number, cx: number, cy: number, bx: number, by: number, t: number): XY {
  const mt = 1 - t;
  return {
    x: mt * mt * ax + 2 * mt * t * cx + t * t * bx,
    y: mt * mt * ay + 2 * mt * t * cy + t * t * by,
  };
}

function pointToQuadraticDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  cx: number,
  cy: number,
  bx: number,
  by: number,
): number {
  const steps = 14;
  let prev = { x: ax, y: ay };
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const next = quadPoint(ax, ay, cx, cy, bx, by, t);
    best = Math.min(best, pointToSegmentDistance(px, py, prev.x, prev.y, next.x, next.y));
    prev = next;
  }
  return best;
}

function convexHull(points: XY[]): XY[] {
  if (points.length <= 2) return points;
  const sorted = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const cross = (o: XY, a: XY, b: XY) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: XY[] = [];
  sorted.forEach((p) => {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  });
  const upper: XY[] = [];
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function detectCommunities(nodeIds: string[], edges: KEdge[]): Map<string, number> {
  const out = new Map<string, number>();
  if (!nodeIds.length) return out;

  const sortedIds = [...nodeIds].sort();
  const neighbors = new Map<string, Set<string>>();
  sortedIds.forEach((id) => neighbors.set(id, new Set()));
  edges.forEach((e) => {
    if (!neighbors.has(e.a) || !neighbors.has(e.b)) return;
    neighbors.get(e.a)!.add(e.b);
    neighbors.get(e.b)!.add(e.a);
  });

  sortedIds.forEach((id, idx) => out.set(id, idx));
  for (let iter = 0; iter < 8; iter += 1) {
    let changed = false;
    sortedIds.forEach((id) => {
      const local = neighbors.get(id);
      if (!local || local.size === 0) return;
      const counts = new Map<number, number>();
      local.forEach((nb) => {
        const label = out.get(nb);
        if (label == null) return;
        counts.set(label, (counts.get(label) || 0) + 1);
      });
      if (!counts.size) return;
      const currentLabel = out.get(id)!;
      let bestLabel = currentLabel;
      let bestCount = -1;
      Array.from(counts.entries())
        .sort((a, b) => a[0] - b[0])
        .forEach(([label, count]) => {
          if (count > bestCount || (count === bestCount && label < bestLabel)) {
            bestCount = count;
            bestLabel = label;
          }
        });
      if (bestLabel !== currentLabel) {
        out.set(id, bestLabel);
        changed = true;
      }
    });
    if (!changed) break;
  }

  const relabel = new Map<number, number>();
  let next = 0;
  sortedIds.forEach((id) => {
    const label = out.get(id)!;
    if (!relabel.has(label)) relabel.set(label, next++);
    out.set(id, relabel.get(label)!);
  });
  return out;
}

function approximateBetweennessCentrality(
  nodeIds: string[],
  adjacency: Map<string, Set<string>>,
  maxSources = 18,
): Map<string, number> {
  const scores = new Map<string, number>();
  nodeIds.forEach((id) => scores.set(id, 0));
  if (nodeIds.length <= 2) return scores;

  const sorted = [...nodeIds].sort();
  const sourceCount = Math.max(1, Math.min(maxSources, sorted.length));
  const step = sorted.length / sourceCount;
  const sources = Array.from(new Set(Array.from({ length: sourceCount }, (_, i) => sorted[Math.floor(i * step)])));

  sources.forEach((source) => {
    const stack: string[] = [];
    const pred = new Map<string, string[]>();
    const sigma = new Map<string, number>();
    const dist = new Map<string, number>();
    nodeIds.forEach((v) => {
      pred.set(v, []);
      sigma.set(v, 0);
      dist.set(v, -1);
    });
    sigma.set(source, 1);
    dist.set(source, 0);

    const queue: string[] = [source];
    while (queue.length) {
      const v = queue.shift()!;
      stack.push(v);
      const neighbors = adjacency.get(v);
      if (!neighbors) continue;
      neighbors.forEach((w) => {
        if (!dist.has(w)) return;
        if ((dist.get(w) ?? -1) < 0) {
          queue.push(w);
          dist.set(w, (dist.get(v) ?? 0) + 1);
        }
        if ((dist.get(w) ?? -1) === (dist.get(v) ?? 0) + 1) {
          sigma.set(w, (sigma.get(w) ?? 0) + (sigma.get(v) ?? 0));
          pred.get(w)!.push(v);
        }
      });
    }

    const delta = new Map<string, number>();
    nodeIds.forEach((v) => delta.set(v, 0));
    while (stack.length) {
      const w = stack.pop()!;
      const sigmaW = sigma.get(w) ?? 0;
      pred.get(w)!.forEach((v) => {
        if (sigmaW <= 0) return;
        const contrib = ((sigma.get(v) ?? 0) / sigmaW) * (1 + (delta.get(w) ?? 0));
        delta.set(v, (delta.get(v) ?? 0) + contrib);
      });
      if (w !== source) {
        scores.set(w, (scores.get(w) ?? 0) + (delta.get(w) ?? 0));
      }
    }
  });

  const denom = Math.max(1, sources.length);
  nodeIds.forEach((v) => scores.set(v, (scores.get(v) ?? 0) / denom));
  return scores;
}

function MiniForce({
  nodes,
  edges,
  onNodeClick,
  onNodeDoubleClick,
  expandingNodeId,
  resetViewToken,
}: {
  nodes: { id: string; label: string; degree?: number; createdAtMs?: number }[];
  edges: { a: string; b: string; type?: string }[];
  onNodeClick?: (nodeId: string) => void;
  onNodeDoubleClick?: (nodeId: string) => void;
  expandingNodeId?: string | null;
  resetViewToken?: number;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const posRef = useRef<Record<string, SimNodeState>>({});
  const cameraRef = useRef<CameraState>({ x: 0, y: 0, scale: 1 });
  const viewportRef = useRef({ width: 1, height: 1, dpr: 1 });
  const pendingAutoFitRef = useRef(true);
  const lastResetTokenRef = useRef<number | undefined>(undefined);
  const hoverNodeRef = useRef<string | null>(null);
  const hoverEdgeRef = useRef<KEdge | null>(null);
  const lastClickRef = useRef<{ nodeId: string; ts: number }>({ nodeId: "", ts: 0 });
  const simAlphaRef = useRef(1);
  const simStartedAtRef = useRef(Date.now());
  const simActiveRef = useRef(true);
  const firstSeenRef = useRef<Map<string, number>>(new Map());
  const [hoverEdgeType, setHoverEdgeType] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [revealDepth, setRevealDepth] = useState(1);
  const [cursor, setCursor] = useState<"grab" | "grabbing" | "default">("grab");
  const interactionRef = useRef<{
    mode: "none" | "pan" | "node";
    nodeId: string | null;
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startCamX: number;
    startCamY: number;
    moved: boolean;
  }>({
    mode: "none",
    nodeId: null,
    pointerId: -1,
    startClientX: 0,
    startClientY: 0,
    startCamX: 0,
    startCamY: 0,
    moved: false,
  });

  const baseRadius = 4.5;
  const bgColor = "#0b0d10";
  const nodeGlow = "#d8f6ff";
  const labelZoomThreshold = 1.35;
  const clusterPalette = ["#34d399", "#60a5fa", "#f59e0b", "#fb7185", "#a78bfa", "#22d3ee"];

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const adjacency = useMemo(() => {
    const map = new Map<string, Set<string>>(nodes.map((n) => [n.id, new Set<string>()]));
    edges.forEach((e) => {
      if (!map.has(e.a)) map.set(e.a, new Set<string>());
      if (!map.has(e.b)) map.set(e.b, new Set<string>());
      map.get(e.a)!.add(e.b);
      map.get(e.b)!.add(e.a);
    });
    return map;
  }, [edges, nodes]);

  const degreeByNode = useMemo(() => {
    const map = new Map<string, number>();
    nodes.forEach((n) => map.set(n.id, n.degree || 0));
    edges.forEach((e) => {
      map.set(e.a, (map.get(e.a) || 0) + 1);
      map.set(e.b, (map.get(e.b) || 0) + 1);
    });
    return map;
  }, [edges, nodes]);
  const degreeCentralityByNode = useMemo(() => {
    const map = new Map<string, number>();
    const denom = Math.max(1, nodes.length - 1);
    nodes.forEach((n) => {
      const degree = degreeByNode.get(n.id) || 0;
      map.set(n.id, clamp(degree / denom, 0, 1));
    });
    return map;
  }, [nodes, degreeByNode]);

  const focusNodeId = useMemo(() => {
    if (!nodes.length) return null;
    if (expandingNodeId && nodeById.has(expandingNodeId)) return expandingNodeId;
    let bestId = nodes[0].id;
    let bestScore = -1;
    nodes.forEach((n) => {
      const score = degreeCentralityByNode.get(n.id) || 0;
      if (score > bestScore) {
        bestScore = score;
        bestId = n.id;
      }
    });
    return bestId;
  }, [nodes, degreeCentralityByNode, expandingNodeId, nodeById]);

  const depthByNode = useMemo(() => {
    const depth = new Map<string, number>();
    nodes.forEach((n) => depth.set(n.id, 3));
    if (!focusNodeId) return depth;

    const q: string[] = [focusNodeId];
    depth.set(focusNodeId, 0);
    while (q.length) {
      const id = q.shift()!;
      const d = depth.get(id) || 0;
      if (d >= 3) continue;
      const neigh = adjacency.get(id);
      if (!neigh) continue;
      neigh.forEach((nb) => {
        const prev = depth.get(nb);
        if (prev == null || prev > d + 1) {
          depth.set(nb, d + 1);
          q.push(nb);
        }
      });
    }
    return depth;
  }, [nodes, adjacency, focusNodeId]);

  const visibleNodeIds = useMemo(() => {
    const out = new Set<string>();
    nodes.forEach((n) => {
      const d = depthByNode.get(n.id) ?? 3;
      if (d <= revealDepth) out.add(n.id);
    });
    if (focusNodeId) out.add(focusNodeId);
    if (selectedNodeId) {
      out.add(selectedNodeId);
      (adjacency.get(selectedNodeId) || new Set<string>()).forEach((id) => out.add(id));
    }
    return out;
  }, [nodes, depthByNode, revealDepth, focusNodeId, selectedNodeId, adjacency]);

  const visibleNodes = useMemo(() => nodes.filter((n) => visibleNodeIds.has(n.id)), [nodes, visibleNodeIds]);
  const visibleEdges = useMemo(
    () => edges.filter((e) => visibleNodeIds.has(e.a) && visibleNodeIds.has(e.b)),
    [edges, visibleNodeIds],
  );

  const visibleAdjacency = useMemo(() => {
    const map = new Map<string, Set<string>>(visibleNodes.map((n) => [n.id, new Set<string>()]));
    visibleEdges.forEach((e) => {
      if (!map.has(e.a)) map.set(e.a, new Set<string>());
      if (!map.has(e.b)) map.set(e.b, new Set<string>());
      map.get(e.a)!.add(e.b);
      map.get(e.b)!.add(e.a);
    });
    return map;
  }, [visibleEdges, visibleNodes]);

  const communityByNode = useMemo(() => detectCommunities(nodes.map((n) => n.id), edges), [nodes, edges]);
  const betweennessByNode = useMemo(
    () => approximateBetweennessCentrality(nodes.map((n) => n.id), adjacency, 16),
    [nodes, adjacency],
  );
  const bridgeThreshold = useMemo(() => {
    const vals = Array.from(betweennessByNode.values()).filter((v) => Number.isFinite(v) && v > 0);
    if (!vals.length) return Number.POSITIVE_INFINITY;
    vals.sort((a, b) => a - b);
    return vals[Math.floor(vals.length * 0.8)] ?? vals[vals.length - 1];
  }, [betweennessByNode]);
  const recentCutoffMs = useMemo(() => {
    const timestamps = nodes
      .map((n) => n.createdAtMs)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (timestamps.length) {
      const newest = Math.max(...timestamps);
      return newest - 30 * 60 * 1000;
    }
    return Date.now() - 20 * 1000;
  }, [nodes]);

  const selectedInfo = useMemo(() => {
    if (!selectedNodeId) return null;
    const node = nodeById.get(selectedNodeId);
    if (!node) return null;
    const relationCounts = new Map<string, number>();
    edges.forEach((e) => {
      if (e.a !== selectedNodeId && e.b !== selectedNodeId) return;
      const rel = normalizeRelationType(e.type) || "related_to";
      relationCounts.set(rel, (relationCounts.get(rel) || 0) + 1);
    });
    const topRelations = Array.from(relationCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
    return {
      node,
      degree: degreeByNode.get(selectedNodeId) || 0,
      degreeCentrality: degreeCentralityByNode.get(selectedNodeId) || 0,
      neighbors: adjacency.get(selectedNodeId)?.size || 0,
      betweenness: betweennessByNode.get(selectedNodeId) || 0,
      cluster: communityByNode.get(selectedNodeId) ?? 0,
      topRelations,
    };
  }, [selectedNodeId, nodeById, edges, degreeByNode, degreeCentralityByNode, adjacency, betweennessByNode, communityByNode]);

  const kickSimulation = useCallback((alpha = 1) => {
    simAlphaRef.current = Math.max(simAlphaRef.current, alpha);
    simStartedAtRef.current = Date.now();
    simActiveRef.current = true;
  }, []);

  const toScreen = useCallback((wx: number, wy: number) => {
    const cam = cameraRef.current;
    return {
      x: wx * cam.scale + cam.x,
      y: wy * cam.scale + cam.y,
    };
  }, []);

  const toWorld = useCallback((sx: number, sy: number) => {
    const cam = cameraRef.current;
    return {
      x: (sx - cam.x) / cam.scale,
      y: (sy - cam.y) / cam.scale,
    };
  }, []);

  const ensureNodePositions = useCallback(() => {
    const P = posRef.current;
    const firstSeen = firstSeenRef.current;
    const ids = new Set(nodes.map((n) => n.id));

    Object.keys(P).forEach((id) => {
      if (!ids.has(id)) {
        delete P[id];
      }
    });
    Array.from(firstSeen.keys()).forEach((id) => {
      if (!ids.has(id)) {
        firstSeen.delete(id);
      }
    });

    const existing = Object.values(P);
    const center =
      existing.length > 0
        ? {
            x: existing.reduce((s, p) => s + p.x, 0) / existing.length,
            y: existing.reduce((s, p) => s + p.y, 0) / existing.length,
          }
        : { x: 0, y: 0 };

    nodes.forEach((n, idx) => {
      if (!firstSeen.has(n.id)) {
        firstSeen.set(n.id, Date.now());
      }
      const centrality = degreeCentralityByNode.get(n.id) || 0;
      const mass = 1 + centrality * 7.5;
      if (P[n.id]) {
        P[n.id].mass = mass;
        return;
      }
      const neigh = Array.from(adjacency.get(n.id) || []);
      const anchored = neigh.map((id) => P[id]).filter((p): p is SimNodeState => Boolean(p));
      let x = center.x;
      let y = center.y;
      if (anchored.length) {
        x = anchored.reduce((sum, p) => sum + p.x, 0) / anchored.length + (Math.random() - 0.5) * 32;
        y = anchored.reduce((sum, p) => sum + p.y, 0) / anchored.length + (Math.random() - 0.5) * 32;
      } else {
        const angle = (idx / Math.max(nodes.length, 1)) * Math.PI * 2;
        const radius = 150 + Math.random() * 72;
        x = center.x + Math.cos(angle) * radius;
        y = center.y + Math.sin(angle) * radius;
      }
      P[n.id] = {
        x,
        y,
        vx: 0,
        vy: 0,
        mass,
      };
    });
  }, [nodes, degreeCentralityByNode, adjacency]);

  const fitGraphToViewport = useCallback(() => {
    const targetNodes = visibleNodes.length ? visibleNodes : nodes;
    if (!targetNodes.length) return;
    ensureNodePositions();

    const { width, height } = viewportRef.current;
    if (width <= 1 || height <= 1) return;

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    const P = posRef.current;

    targetNodes.forEach((n) => {
      const p = P[n.id];
      if (!p) return;
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    });

    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
      return;
    }

    const padding = 48;
    const spanX = Math.max(maxX - minX, 1);
    const spanY = Math.max(maxY - minY, 1);
    const nextScale = clamp(
      Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY),
      0.15,
      2.8,
    );
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    cameraRef.current = {
      x: width / 2 - cx * nextScale,
      y: height / 2 - cy * nextScale,
      scale: nextScale,
    };
  }, [ensureNodePositions, visibleNodes, nodes]);

  useEffect(() => {
    if (!nodes.length) return;
    if (lastResetTokenRef.current === resetViewToken) return;
    lastResetTokenRef.current = resetViewToken;
    setRevealDepth(1);
    setSelectedNodeId(null);
    hoverNodeRef.current = null;
    hoverEdgeRef.current = null;
    setHoverEdgeType(null);
    pendingAutoFitRef.current = true;
    kickSimulation(1);
    const t = window.setTimeout(() => setRevealDepth((d) => Math.max(d, 2)), 150);
    return () => window.clearTimeout(t);
  }, [resetViewToken, nodes.length, kickSimulation]);

  useEffect(() => {
    ensureNodePositions();
    kickSimulation(0.85);
  }, [ensureNodePositions, visibleNodes.length, visibleEdges.length, kickSimulation]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const canvas = canvasRef.current;
    if (!wrapper || !canvas) return;

    const syncCanvasSize = () => {
      const rect = wrapper.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      viewportRef.current = { width, height, dpr };
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      if (pendingAutoFitRef.current && (visibleNodes.length > 0 || nodes.length > 0)) {
        fitGraphToViewport();
        pendingAutoFitRef.current = false;
      }
    };

    syncCanvasSize();
    const ro = new ResizeObserver(syncCanvasSize);
    ro.observe(wrapper);
    window.addEventListener("resize", syncCanvasSize);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", syncCanvasSize);
    };
  }, [fitGraphToViewport, nodes.length, visibleNodes.length]);

  const centerOnNode = useCallback((nodeId: string) => {
    const p = posRef.current[nodeId];
    if (!p) return;
    const { width, height } = viewportRef.current;
    const cam = cameraRef.current;
    cameraRef.current = {
      ...cam,
      x: width / 2 - p.x * cam.scale,
      y: height / 2 - p.y * cam.scale,
    };
  }, []);

  const edgeControlWorld = useCallback((a: SimNodeState, b: SimNodeState, edge: KEdge) => {
    return edgeControlPoint(a.x, a.y, b.x, b.y, `${edge.a}|${edge.b}|${edge.type || ""}`, cameraRef.current.scale);
  }, []);

  const findNodeAt = useCallback(
    (wx: number, wy: number): string | null => {
      const P = posRef.current;
      for (let i = visibleNodes.length - 1; i >= 0; i -= 1) {
        const node = visibleNodes[i];
        const p = P[node.id];
        if (!p) continue;
        const centrality = degreeCentralityByNode.get(node.id) || 0;
        const radius = baseRadius + 2 + centrality * 13;
        const hitRadius = (radius + 4) / cameraRef.current.scale;
        const d = Math.hypot(wx - p.x, wy - p.y);
        if (d <= hitRadius) {
          return node.id;
        }
      }
      return null;
    },
    [visibleNodes, degreeCentralityByNode],
  );

  const findEdgeAt = useCallback(
    (wx: number, wy: number): KEdge | null => {
      const P = posRef.current;
      const threshold = 10 / cameraRef.current.scale;
      let bestEdge: KEdge | null = null;
      let bestDist = Number.POSITIVE_INFINITY;
      for (const e of visibleEdges) {
        const a = P[e.a];
        const b = P[e.b];
        if (!a || !b) continue;
        const c = edgeControlWorld(a, b, e);
        const dist = pointToQuadraticDistance(wx, wy, a.x, a.y, c.x, c.y, b.x, b.y);
        if (dist > threshold) continue;
        if (dist < bestDist) {
          bestDist = dist;
          bestEdge = e;
        }
      }
      return bestEdge;
    },
    [visibleEdges, edgeControlWorld],
  );

  useEffect(() => {
    ensureNodePositions();
    let raf = 0;
    const tick = () => {
      const canvas = canvasRef.current;
      if (!canvas) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        raf = requestAnimationFrame(tick);
        return;
      }

      const P = posRef.current;
      if (simActiveRef.current && visibleNodes.length > 0) {
        const alpha = Math.max(0.01, simAlphaRef.current);
        const repulsionBase = 270;
        for (let i = 0; i < visibleNodes.length; i += 1) {
          const aNode = visibleNodes[i];
          const a = P[aNode.id];
          if (!a) continue;
          for (let j = i + 1; j < visibleNodes.length; j += 1) {
            const bNode = visibleNodes[j];
            const b = P[bNode.id];
            if (!b) continue;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const d2 = dx * dx + dy * dy + 0.01;
            const d = Math.sqrt(d2);
            const force = (repulsionBase * alpha * a.mass * b.mass) / d2;
            const fx = (dx / d) * force;
            const fy = (dy / d) * force;
            a.vx -= fx / a.mass;
            a.vy -= fy / a.mass;
            b.vx += fx / b.mass;
            b.vy += fy / b.mass;
          }
        }

        visibleEdges.forEach((e) => {
          const a = P[e.a];
          const b = P[e.b];
          if (!a || !b) return;
          const cfg = relationForceConfig(e.type);
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = Math.max(0.01, Math.hypot(dx, dy));
          const hubStretch = ((degreeByNode.get(e.a) || 0) + (degreeByNode.get(e.b) || 0)) * 1.8;
          const targetLen = cfg.length + hubStretch;
          const force = (d - targetLen) * cfg.spring * alpha;
          const fx = (dx / d) * force;
          const fy = (dy / d) * force;
          a.vx += fx / a.mass;
          a.vy += fy / a.mass;
          b.vx -= fx / b.mass;
          b.vy -= fy / b.mass;
        });

        let kinetic = 0;
        const damping = 0.85 + (1 - alpha) * 0.1;
        visibleNodes.forEach((n) => {
          const p = P[n.id];
          if (!p) return;
          p.vx *= damping;
          p.vy *= damping;
          p.x += p.vx;
          p.y += p.vy;
          kinetic += Math.abs(p.vx) + Math.abs(p.vy);
        });

        simAlphaRef.current = Math.max(0, simAlphaRef.current * 0.986 - 0.0008);
        if (kinetic < 0.05 || simAlphaRef.current < 0.015 || Date.now() - simStartedAtRef.current > 6500) {
          simActiveRef.current = false;
          visibleNodes.forEach((n) => {
            const p = P[n.id];
            if (!p) return;
            p.vx = Math.abs(p.vx) < 0.0005 ? 0 : p.vx * 0.3;
            p.vy = Math.abs(p.vy) < 0.0005 ? 0 : p.vy * 0.3;
          });
        }
      }

      const { width, height, dpr } = viewportRef.current;
      const hoveredNodeId = hoverNodeRef.current;
      const hoveredNeighbors = hoveredNodeId
        ? visibleAdjacency.get(hoveredNodeId) || new Set<string>()
        : new Set<string>();
      const hoveredEdge = hoverEdgeRef.current;
      const selectedNeighbors = selectedNodeId
        ? visibleAdjacency.get(selectedNodeId) || new Set<string>()
        : new Set<string>();

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, width, height);

      const clusters = new Map<number, XY[]>();
      visibleNodes.forEach((n) => {
        const p = P[n.id];
        if (!p) return;
        const cid = communityByNode.get(n.id);
        if (cid == null) return;
        if (!clusters.has(cid)) clusters.set(cid, []);
        clusters.get(cid)!.push(toScreen(p.x, p.y));
      });

      clusters.forEach((pts, cid) => {
        const color = clusterPalette[cid % clusterPalette.length];
        if (pts.length >= 3) {
          const hull = convexHull(pts);
          if (hull.length >= 3) {
            ctx.beginPath();
            ctx.moveTo(hull[0].x, hull[0].y);
            for (let i = 1; i < hull.length; i += 1) {
              ctx.lineTo(hull[i].x, hull[i].y);
            }
            ctx.closePath();
            ctx.fillStyle = `${color}1E`;
            ctx.strokeStyle = `${color}4F`;
            ctx.lineWidth = 1;
            ctx.fill();
            ctx.stroke();
          }
        } else if (pts.length === 2) {
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          ctx.lineTo(pts[1].x, pts[1].y);
          ctx.strokeStyle = `${color}33`;
          ctx.lineWidth = 18;
          ctx.stroke();
        } else if (pts.length === 1) {
          ctx.beginPath();
          ctx.arc(pts[0].x, pts[0].y, 16, 0, Math.PI * 2);
          ctx.fillStyle = `${color}22`;
          ctx.fill();
        }
      });

      visibleEdges.forEach((e) => {
        const a = P[e.a];
        const b = P[e.b];
        if (!a || !b) return;
        const c = edgeControlWorld(a, b, e);
        const sa = toScreen(a.x, a.y);
        const sc = toScreen(c.x, c.y);
        const sb = toScreen(b.x, b.y);
        const cfg = relationForceConfig(e.type);
        const isSelectedEdge = selectedNodeId ? e.a === selectedNodeId || e.b === selectedNodeId : true;
        const edgeIsHoveredNode = hoveredNodeId ? e.a === hoveredNodeId || e.b === hoveredNodeId : false;
        const isHoveredEdge =
          hoveredEdge && hoveredEdge.a === e.a && hoveredEdge.b === e.b && hoveredEdge.type === e.type;
        let alpha = selectedNodeId ? (isSelectedEdge ? 0.92 : 0.08) : cfg.alpha;
        if (edgeIsHoveredNode) alpha = Math.max(alpha, 0.88);
        if (isHoveredEdge) alpha = 0.97;

        ctx.beginPath();
        ctx.moveTo(sa.x, sa.y);
        ctx.quadraticCurveTo(sc.x, sc.y, sb.x, sb.y);
        ctx.strokeStyle = `rgba(${relationColor(e.type)}, ${alpha})`;
        ctx.lineWidth = isHoveredEdge ? 2.1 : STRONG_RELATIONS.has(normalizeRelationType(e.type)) ? 1.6 : 1.1;
        ctx.stroke();
      });

      if (hoveredEdge?.type) {
        const a = P[hoveredEdge.a];
        const b = P[hoveredEdge.b];
        if (a && b) {
          const c = edgeControlWorld(a, b, hoveredEdge);
          const mid = quadPoint(a.x, a.y, c.x, c.y, b.x, b.y, 0.5);
          const sm = toScreen(mid.x, mid.y);
          const txt = hoveredEdge.type;
          ctx.font = "12px ui-sans-serif, system-ui, -apple-system, Segoe UI";
          const w = ctx.measureText(txt).width + 10;
          const h = 18;
          ctx.fillStyle = "rgba(5, 9, 14, 0.9)";
          ctx.fillRect(sm.x - w / 2, sm.y - h / 2, w, h);
          ctx.strokeStyle = "rgba(138, 226, 255, 0.8)";
          ctx.strokeRect(sm.x - w / 2, sm.y - h / 2, w, h);
          ctx.fillStyle = "#d9f6ff";
          ctx.textBaseline = "middle";
          ctx.fillText(txt, sm.x - w / 2 + 5, sm.y);
        }
      }

      visibleNodes.forEach((n) => {
        const p = P[n.id];
        if (!p) return;
        const s = toScreen(p.x, p.y);
        const centrality = degreeCentralityByNode.get(n.id) || 0;
        const radius = baseRadius + 2 + centrality * 14;
        const isHover = hoveredNodeId === n.id;
        const isSelected = selectedNodeId === n.id;
        const isSelectedNeighbor = selectedNodeId ? selectedNeighbors.has(n.id) : false;
        const isHoverNeighbor = hoveredNeighbors.has(n.id);
        const inContext = !selectedNodeId || isSelected || isSelectedNeighbor;
        const clusterId = communityByNode.get(n.id) ?? 0;
        const fill = clusterPalette[clusterId % clusterPalette.length];
        const bridgeScore = betweennessByNode.get(n.id) || 0;
        const isBridge = bridgeScore >= bridgeThreshold && bridgeScore > 0;
        const createdMs = n.createdAtMs ?? firstSeenRef.current.get(n.id);
        const isRecent = typeof createdMs === "number" && createdMs >= recentCutoffMs;
        const pulse = isRecent ? 1 + 0.14 * Math.sin(Date.now() / 220 + (hashString(n.id) % 37)) : 1;
        const drawRadius = (isSelected ? radius + 2 : radius) * pulse;
        const alpha = inContext ? 1 : 0.25;

        ctx.globalAlpha = alpha;
        ctx.fillStyle = fill;
        ctx.shadowBlur = isBridge ? 22 : isSelected ? 18 : isHover ? 16 : isHoverNeighbor ? 12 : 8;
        ctx.shadowColor = isBridge ? "rgba(255, 236, 153, 0.95)" : isHover ? nodeGlow : fill;
        ctx.beginPath();
        ctx.arc(s.x, s.y, drawRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.lineWidth = isBridge ? 2.4 : isSelected ? 2 : 1;
        ctx.strokeStyle = isBridge
          ? "rgba(255, 236, 153, 0.95)"
          : isSelected
            ? "rgba(230, 247, 255, 0.95)"
            : "rgba(10, 15, 22, 0.55)";
        ctx.stroke();
      });
      ctx.globalAlpha = 1;

      const showLabelsByZoom = cameraRef.current.scale > labelZoomThreshold;
      ctx.font = "12px ui-sans-serif, system-ui, -apple-system, Segoe UI";
      ctx.textBaseline = "middle";
      visibleNodes.forEach((n) => {
        const p = P[n.id];
        if (!p) return;
        const isHover = hoveredNodeId === n.id;
        const isNeighbor = hoveredNeighbors.has(n.id);
        const isSelected = selectedNodeId === n.id;
        const isSelectedNeighbor = selectedNodeId ? selectedNeighbors.has(n.id) : false;
        if (!showLabelsByZoom && !isHover && !isNeighbor && !isSelected && !isSelectedNeighbor) return;
        const s = toScreen(p.x, p.y);
        const label = n.label || n.id.slice(0, 10);
        const m = ctx.measureText(label);
        const w = m.width + 10;
        const h = 18;
        const x = s.x + 9;
        const y = s.y - h / 2;
        ctx.fillStyle = "rgba(5, 9, 14, 0.86)";
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = isSelected
          ? "rgba(225, 246, 255, 0.88)"
          : isHover
            ? "rgba(138, 226, 255, 0.8)"
            : "rgba(145, 160, 180, 0.35)";
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
        ctx.fillStyle = isSelected || isHover ? "#d7f8ff" : "#cfd6e2";
        ctx.fillText(label, x + 5, y + h / 2);
      });

      raf = requestAnimationFrame(tick);
    };

    tick();
    return () => cancelAnimationFrame(raf);
  }, [
    communityByNode,
    degreeByNode,
    degreeCentralityByNode,
    edgeControlWorld,
    ensureNodePositions,
    visibleAdjacency,
    visibleEdges,
    visibleNodes,
    selectedNodeId,
    toScreen,
  ]);

  const getLocalPoint = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const r = canvas.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }, []);

  const handlePointerDown = useCallback(
    (ev: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.setPointerCapture(ev.pointerId);

      const { x, y } = getLocalPoint(ev.clientX, ev.clientY);
      const world = toWorld(x, y);
      const nodeId = findNodeAt(world.x, world.y);
      interactionRef.current = {
        mode: nodeId ? "node" : "pan",
        nodeId,
        pointerId: ev.pointerId,
        startClientX: ev.clientX,
        startClientY: ev.clientY,
        startCamX: cameraRef.current.x,
        startCamY: cameraRef.current.y,
        moved: false,
      };
      setRevealDepth((d) => Math.max(d, 3));
      kickSimulation(0.45);
      setCursor("grabbing");
      ev.preventDefault();
    },
    [findNodeAt, getLocalPoint, toWorld, kickSimulation],
  );

  const handlePointerMove = useCallback(
    (ev: React.PointerEvent<HTMLCanvasElement>) => {
      const interaction = interactionRef.current;
      const { x, y } = getLocalPoint(ev.clientX, ev.clientY);
      const world = toWorld(x, y);

      if (interaction.mode === "pan") {
        const dx = ev.clientX - interaction.startClientX;
        const dy = ev.clientY - interaction.startClientY;
        if (Math.abs(dx) + Math.abs(dy) > 3) interaction.moved = true;
        cameraRef.current.x = interaction.startCamX + dx;
        cameraRef.current.y = interaction.startCamY + dy;
        setCursor("grabbing");
        ev.preventDefault();
        return;
      }

      if (interaction.mode === "node" && interaction.nodeId) {
        const p = posRef.current[interaction.nodeId];
        if (p) {
          p.x = world.x;
          p.y = world.y;
          p.vx = 0;
          p.vy = 0;
        }
        if (
          Math.abs(ev.clientX - interaction.startClientX) + Math.abs(ev.clientY - interaction.startClientY) >
          3
        ) {
          interaction.moved = true;
        }
        setCursor("grabbing");
        kickSimulation(0.62);
        ev.preventDefault();
        return;
      }

      const hitNode = findNodeAt(world.x, world.y);
      hoverNodeRef.current = hitNode;
      if (hitNode) {
        hoverEdgeRef.current = null;
        setHoverEdgeType(null);
        setCursor("default");
        return;
      }

      const hitEdge = findEdgeAt(world.x, world.y);
      hoverEdgeRef.current = hitEdge;
      setHoverEdgeType(hitEdge?.type || null);
      setCursor(hitEdge ? "default" : "grab");
    },
    [findEdgeAt, findNodeAt, getLocalPoint, toWorld, kickSimulation],
  );

  const handlePointerUp = useCallback(
    (ev: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      const interaction = interactionRef.current;
      if (interaction.mode === "node" && interaction.nodeId && !interaction.moved) {
        const nodeId = interaction.nodeId;
        setRevealDepth((d) => Math.max(d, 3));
        setSelectedNodeId(nodeId);
        centerOnNode(nodeId);
        const now = performance.now();
        const isDouble = lastClickRef.current.nodeId === nodeId && now - lastClickRef.current.ts < 280;
        if (isDouble && typeof onNodeDoubleClick === "function") {
          onNodeDoubleClick(nodeId);
        } else if (!isDouble && typeof onNodeClick === "function") {
          onNodeClick(nodeId);
        }
        lastClickRef.current = { nodeId, ts: now };
      }
      interactionRef.current = {
        mode: "none",
        nodeId: null,
        pointerId: -1,
        startClientX: 0,
        startClientY: 0,
        startCamX: cameraRef.current.x,
        startCamY: cameraRef.current.y,
        moved: false,
      };
      if (canvas && canvas.hasPointerCapture(ev.pointerId)) {
        canvas.releasePointerCapture(ev.pointerId);
      }
      kickSimulation(0.34);
      setCursor("grab");
    },
    [centerOnNode, onNodeClick, onNodeDoubleClick, kickSimulation],
  );

  const handlePointerLeave = useCallback(() => {
    if (interactionRef.current.mode !== "none") return;
    hoverNodeRef.current = null;
    hoverEdgeRef.current = null;
    setHoverEdgeType(null);
    setCursor(selectedNodeId ? "default" : "grab");
  }, [selectedNodeId]);

  const handleWheel = useCallback(
    (ev: React.WheelEvent<HTMLCanvasElement>) => {
      const { x, y } = getLocalPoint(ev.clientX, ev.clientY);
      const before = toWorld(x, y);
      const cam = cameraRef.current;
      const factor = Math.exp(-ev.deltaY * 0.0015);
      const nextScale = clamp(cam.scale * factor, 0.12, 4.5);
      cameraRef.current.scale = nextScale;
      cameraRef.current.x = x - before.x * nextScale;
      cameraRef.current.y = y - before.y * nextScale;
      setRevealDepth((d) => Math.max(d, 3));
      kickSimulation(0.25);
      ev.preventDefault();
    },
    [getLocalPoint, toWorld, kickSimulation],
  );

  return (
    <div
      ref={wrapperRef}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        minHeight: 260,
        background: bgColor,
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: "100%",
          height: "100%",
          display: "block",
          cursor,
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onWheel={handleWheel}
      />
      {hoverEdgeType && (
        <div
          className="text-xs"
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            padding: "6px 8px",
            borderRadius: 6,
            background: "rgba(10, 14, 20, 0.9)",
            border: `1px solid ${C.border}`,
            color: "#d9f6ff",
            pointerEvents: "none",
          }}
        >
          Relation: {hoverEdgeType}
        </div>
      )}
      {selectedInfo && (
        <div
          className="text-xs"
          style={{
            position: "absolute",
            top: 8,
            left: 8,
            minWidth: 190,
            maxWidth: 260,
            padding: "8px 10px",
            borderRadius: 8,
            background: "rgba(10, 14, 20, 0.92)",
            border: `1px solid ${C.border}`,
            color: C.neutral,
            pointerEvents: "none",
          }}
        >
          <div style={{ color: C.text, fontWeight: 600, marginBottom: 4 }}>{selectedInfo.node.label}</div>
          <div style={{ marginBottom: 2 }}>degree: {selectedInfo.degree}</div>
          <div style={{ marginBottom: 2 }}>degree centrality: {selectedInfo.degreeCentrality.toFixed(3)}</div>
          <div style={{ marginBottom: 6 }}>neighbors: {selectedInfo.neighbors}</div>
          <div style={{ marginBottom: 2 }}>cluster: {selectedInfo.cluster}</div>
          <div style={{ marginBottom: 6 }}>bridge score: {selectedInfo.betweenness.toFixed(2)}</div>
          {selectedInfo.topRelations.length > 0 &&
            selectedInfo.topRelations.map(([rel, count]) => (
              <div key={rel}>
                {rel}: {count}
              </div>
            ))}
        </div>
      )}
      <div
        className="text-xs"
        style={{
          position: "absolute",
          right: 8,
          bottom: 8,
          padding: "6px 8px",
          borderRadius: 6,
          background: "rgba(10, 14, 20, 0.8)",
          border: `1px solid ${C.border}`,
          color: C.neutral,
          pointerEvents: "none",
        }}
      >
        <div>Core Topic: large central nodes</div>
        <div>Bridge Concept: outlined nodes</div>
        <div>Topic Cluster: color groups</div>
        <div>New Info: pulsing nodes</div>
      </div>
      {expandingNodeId && (
        <div
          className="text-xs"
          style={{
            position: "absolute",
            bottom: 8,
            left: 8,
            padding: "6px 8px",
            borderRadius: 6,
            background: "rgba(10, 14, 20, 0.9)",
            border: `1px solid ${C.border}`,
            color: C.neutral,
            pointerEvents: "none",
          }}
        >
          Expanding node {expandingNodeId}...
        </div>
      )}
    </div>
  );
}

const LEGACY_MINI_FORCE_COMPONENT = MiniForce;
void LEGACY_MINI_FORCE_COMPONENT;

// ---- small components ----
function Icon({ d, size = 22 }: { d: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}

function Drawer({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    // clicking the dark background closes the drawer
    <div
      className="fixed inset-0"
      style={{ background: "#0008" }}
      onClick={onClose}
    >
      <div
        className="absolute top-0 left-0 h-full"
        style={{
          width: 300,
          background: C.panel,
          borderRight: `1px solid ${C.border}`,
        }}
        // stop clicks inside the panel from bubbling to the background
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-4"
          style={{ height: 52, borderBottom: `1px solid ${C.border}` }}
        >
          <div style={{ color: C.text, fontWeight: 600 }}>{title}</div>
          <button
            onClick={onClose}
            className="px-2 py-1 rounded"
            style={{ border: `1px solid ${C.border}`, color: C.neutral }}
          >
            ✕
          </button>
        </div>
        <div className="p-4 text-sm" style={{ color: C.text }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function Chat({
  messages,
  onSend,
  projectId,
  disabled = false,
}: {
  messages: { role: "assistant" | "user"; text: string }[];
  onSend: (t: string) => void;
  projectId: string;
  disabled?: boolean;
}) {
  const [v, setV] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: 999999, behavior: "smooth" });
  }, [messages.length]);

  const send = () => {
    if (disabled) return;
    const trimmed = v.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setV("");
  };

  return (
    <div className="h-full flex flex-col" style={{ gap: 12 }}>
      <div
        ref={listRef}
        className="flex-1 overflow-auto"
        style={{
          padding: "14px 18px",
          display: "grid",
          gap: 10,
          alignContent: "start",
        }}
      >
        {messages.map((m, i) => {
          const right = m.role !== "assistant";
          const bg = m.role === "user" ? C.panel : C.bg;
          return (
            <div
              key={i}
              style={{ justifySelf: right ? "end" : "start", maxWidth: "86%" }}
            >
              <div
                style={{ fontSize: 11, color: C.neutral, marginBottom: 4 }}
              >
                {m.role === "assistant" ? "Assistant" : "You"}
              </div>
              <div
                style={{
                  background: bg,
                  border: `1px solid ${C.border}`,
                  borderRadius: 12,
                  padding: "10px 12px",
                  color: C.text,
                  whiteSpace: "pre-wrap",
                }}
              >
                {safeText(m.text)}
              </div>
            </div>
          );
        })}
      </div>
      <div className="px-4 pb-4 flex items-center gap-2">
        <UploadAttachment
          projectId={projectId}
          disabled={disabled || !projectId}
        />
        <input
          value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
          }}
          placeholder="Type a message…"
          className="flex-1"
          style={{
            background: C.panel,
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            padding: "12px 14px",
            color: C.text,
          }}
          disabled={disabled}
        />
        <button
          onClick={send}
          aria-label="Send"
          className="rounded-full flex items-center justify-center"
          style={{
            width: 42,
            height: 42,
            background: C.primary,
            boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
          }}
          disabled={disabled}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#FFFFFF"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 19V5" />
            <path d="M5 12l7-7 7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// -------- Main page --------
export default function AgentBuilder() {
  const [activeProject, setActiveProject] = useState("");
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelWidth, setPanelWidth] = useState(480);
  const [mode, setMode] = useState<"assist" | "agents">("assist");
  const [selectedAgentType, setSelectedAgentType] = useState<AgentTypeKey>("llm_chat");
  const [selectedAgentProjectId, setSelectedAgentProjectId] = useState("");
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const messagesByScopeRef = useRef<Record<string, { role: "assistant" | "user"; text: string }[]>>({});
  const [projectLoading, setProjectLoading] = useState(false);
  const [projectSaveStatus, setProjectSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [projectSaveError, setProjectSaveError] = useState<string | null>(null);
  const setActiveProjectWithUrl = useCallback(
    (projectId: string) => {
      const currentSearch = window.location.search.replace(/^\?/, "");
      const current = new URLSearchParams(currentSearch).get("projectId") || "";
      if (projectId === activeProject && projectId === current) {
        return;
      }
      const nextSearch = new URLSearchParams(window.location.search);
      nextSearch.set("projectId", projectId);
      const nextQs = nextSearch.toString();
      setActiveProject(projectId);
      if (nextQs !== currentSearch) {
        window.history.replaceState({}, "", `${window.location.pathname}?${nextQs}`);
      }
    },
    [activeProject],
  );

  const tabs = ["Plan", "Links", "Knowledge", "Dashboard"] as const;
  const activeTabs = mode === "assist" ? ["Knowledge"] : tabs;

  const [tab, setTab] = useState<string>("Knowledge");
  
  // Force tab by mode
  useEffect(() => {
    if (mode === "agents") setTab("Plan");
    if (mode === "assist") setTab("Knowledge");
  }, [mode]);
  useEffect(() => {
    if (mode === "agents" && !selectedAgentProjectId) setSelectedAgentType("llm_chat");
  }, [mode, selectedAgentProjectId]);
  const [openDrawer, setOpenDrawer] = useState<
    null | "project" | "apps" | "settings" | "admin"
  >(null);
  const [sending, setSending] = useState(false);

  // agent builder state
  const [projects, setProjects] = useState<any[]>([]);
  const refreshSeq = useRef(0);
  const refreshAbortRef = useRef<AbortController | null>(null);
  const mountRefreshRanRef = useRef(false);
  const activeProjectLatestRef = useRef("");
  const stateLoadKeyRef = useRef("");
  const stateLoadAbortRef = useRef<AbortController | null>(null);
  const stateLoadProjectRef = useRef("");
  const healthCheckScheduledRef = useRef(false);
  const kgAutoLoadKeyRef = useRef("");
  const kgLoadAbortRef = useRef<AbortController | null>(null);
  const kgLoadProjectRef = useRef("");
  const kgExpandAbortRef = useRef<AbortController | null>(null);
  const kgExpandProjectRef = useRef("");
  const graphHydrateKeyRef = useRef("");
  const dashboardPollRunRef = useRef(0);
  const dashboardPollTimerRef = useRef<number | null>(null);
  const dashboardPollAbortRef = useRef<AbortController | null>(null);
  const dashboardPollProjectRef = useRef("");
  const loggedProjectRef = useRef<string | null>(null);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [agentPrompt, setAgentPrompt] = useState<AgentPrompt>({
    role: "",
    context: "",
    objectives: "",
    style: "",
  });
  useEffect(() => {
    if (mode !== "agents" || !selectedAgentProjectId) return;
    const match = (Array.isArray(projects) ? projects : []).find((p) => p.id === selectedAgentProjectId);
    if (!match) return;
    setSelectedAgentType(agentTypeFromProjectCode(String(match.code || "")));
  }, [mode, selectedAgentProjectId, projects]);

  const activeConfigProjectId =
    selectedAgentType === "agent_builder"
      ? String(selectedAgentProjectId || "").trim()
      : String(activeProject || "").trim();
  const selectedAgentProject = useMemo(
    () =>
      (Array.isArray(projects) ? projects : []).find((p) => p.id === selectedAgentProjectId) || null,
    [projects, selectedAgentProjectId],
  );
  const agentManagerRenderKey = buildAgentManagerRenderKey(
    activeConfigProjectId,
    selectedAgentProjectId,
    selectedAgentType,
  );

  // Boss agent prompt configuration (per project)
  const [bossPromptConfig, setBossPromptConfig] = useState({
    role: "You are Sol, the primary assistant inside LiquidAIty.\nYou talk with the user to help them build their system.\nYou are direct and practical.\nYou do not invent features that don't exist.\nWhen something is broken, you help debug it using the UI and logs.\nYou remember project facts only when they appear in retrieved context (KG/RAG).\nIf no retrieved context is provided, you do not pretend to remember.",
    goal: "Help the user make progress building LiquidAIty.\nPriorities:\n- Keep Assist chat working reliably.\n- Capture durable facts into knowledge (through the KG ingest pipeline).\n- Use retrieved knowledge to answer with better continuity and less repetition.\n- Keep solutions minimal and avoid UI bloat.",
    constraints: "- Do not claim something works unless it is wired and verified.\n- Prefer the smallest change that restores functionality.\n- When diagnosing errors, ask for the exact error message or stack trace.\n- Do not suggest new UI controls unless required for the core loop.\n- When referring to acronyms, expand them the first time (e.g., KG (Knowledge Graph), RAG (Retrieval-Augmented Generation)).",
    ioSchema: "Input: user message text + optional retrieved context block.\nOutput: normal conversational text.\nIf you need structured output, ask before switching formats.",
    memoryPolicy: "No hidden memory.\nOnly use:\n- the visible chat history in this session, and\n- any explicit retrieved context provided from KG/RAG.\nIf context is missing, say so plainly.",
    model: "gpt-5-nano",
    temperature: 0.7,
  });
  const refreshProjects = useCallback(async (preferredId?: string, filterType?: 'assist' | 'agent', reason?: string) => {
    const seq = ++refreshSeq.current;
    const requestType = "projects-refresh";
    const requestSeq = nextRequestSequence(requestType);
    refreshAbortRef.current?.abort();
    const controller = new AbortController();
    refreshAbortRef.current = controller;

    try {
      setProjectsError(null);
      const projectType = filterType || (mode === 'assist' ? 'assist' : 'agent');
      
      console.debug('[refreshProjects]', { reason: reason || 'unknown', mode, project_type_filter: projectType, seq });
      
      const endpoint = V2_PROJECTS_API;
      const payload = await guardedRequest({
        key: "projects:list:all",
        method: "GET",
        ttlMs: 3_000,
        signal: controller.signal,
        fetcher: async (signal) => {
          const response = await fetch(endpoint, { signal });
          const data = await safeJson(response);
          return { response, data };
        },
      });
      const { response, data } = payload;
      
      if (controller.signal.aborted || seq !== refreshSeq.current || !isLatestRequestSequence(requestType, requestSeq)) return;
      if (!data) {
        console.warn('[refreshProjects] empty response', { status: response.status, url: response.url });
        if (response.status !== 304 && response.status !== 204) {
          setProjectsError(`Error loading projects (HTTP ${response.status})`);
          setProjects([]);
        }
        return;
      }

      const rawCards = Array.isArray(data?.projects) ? data.projects : [];
      let cards = dedupeProjectCards(rawCards).filter((card: any) => inferProjectCardType(card) === projectType);
      
      // Pin canonical agent decks to top in agent mode
      if (projectType === 'agent') {
        const PINNED_CODES = ['main-chat', 'kg-ingest', 'thinkgraph', 'knowgraph', 'neo4j', 'research-agent', 'agent-builder'];
        const pinned = cards.filter((c: any) => PINNED_CODES.includes(normalizeProjectCardKey(c?.code)));
        const others = cards.filter((c: any) => !PINNED_CODES.includes(normalizeProjectCardKey(c?.code)));
        if (!pinned.some((c: any) => normalizeProjectCardKey(c?.code) === 'neo4j')) {
          pinned.push({
            id: 'system:neo4j',
            name: 'Neo4j',
            code: 'neo4j',
            status: 'active',
            project_type: 'agent',
            syntheticSystemDeck: true,
          });
        }
        if (!pinned.some((c: any) => normalizeProjectCardKey(c?.code) === 'research-agent')) {
          pinned.push({
            id: 'system:research-agent',
            name: 'Research Agent',
            code: 'research-agent',
            status: 'active',
            project_type: 'agent',
            syntheticSystemDeck: true,
          });
        }
        pinned.sort(
          (a: any, b: any) =>
            PINNED_CODES.indexOf(normalizeProjectCardKey(a?.code)) -
            PINNED_CODES.indexOf(normalizeProjectCardKey(b?.code)),
        );
        cards = dedupeProjectCards([...pinned, ...others]);
      }

      setProjects(cards);

      if (projectType === "agent") {
        const currentAgentProjectId = preferredId || selectedAgentProjectId || "";
        const hasCurrentAgentProject =
          currentAgentProjectId && cards.some((c: any) => c.id === currentAgentProjectId);
        const main = cards.find((c: any) => normalizeProjectCardKey(c?.code) === "main-chat") || null;
        const kg =
          cards.find((c: any) => {
            const code = normalizeProjectCardKey(c?.code);
            return code === "kg-ingest" || code === "thinkgraph";
          }) || null;
        const knowgraph = cards.find((c: any) => normalizeProjectCardKey(c?.code) === "knowgraph") || null;
        const neo4j = cards.find((c: any) => normalizeProjectCardKey(c?.code) === "neo4j") || null;
        const researchAgent =
          cards.find((c: any) => normalizeProjectCardKey(c?.code) === "research-agent") || null;
        const agentBuilder =
          cards.find((c: any) => normalizeProjectCardKey(c?.code) === "agent-builder") || null;
        const fallbackPinned =
          main?.id || kg?.id || knowgraph?.id || neo4j?.id || researchAgent?.id || agentBuilder?.id || "";
        const nextAgentProjectId =
          (hasCurrentAgentProject ? currentAgentProjectId : "") || fallbackPinned || cards[0]?.id || "";
        setSelectedAgentProjectId(nextAgentProjectId);
        if (nextAgentProjectId) {
          const nextAgentProject = cards.find((c: any) => c.id === nextAgentProjectId);
          setSelectedAgentType(agentTypeFromProjectCode(String(nextAgentProject?.code || "")));
        } else {
          setSelectedAgentType("llm_chat");
        }
        return;
      }

      const search = new URLSearchParams(window.location.search);
      const urlId = search.get("projectId") || "";
      const urlIdValid = urlId && cards.some((c: any) => c.id === urlId);
      const current = preferredId || activeProject || "";
      const hasCurrent = current && cards.some((c: any) => c.id === current);
      const nextId = urlIdValid ? urlId : (hasCurrent ? current : "") || cards[0]?.id || "";
      if (nextId) {
        setActiveProjectWithUrl(nextId);
      } else {
        setActiveProject("");
      }
    } catch (err: any) {
      if (isAbortLikeError(err)) return;
      console.error("Error loading projects:", err);
      if (seq !== refreshSeq.current || !isLatestRequestSequence(requestType, requestSeq)) return;
      setProjectsError(err?.message || 'Error loading projects');
    }
  }, [setActiveProjectWithUrl, mode, activeProject, selectedAgentProjectId]);

  useEffect(() => {
    activeProjectLatestRef.current = activeProject;
  }, [activeProject]);

  useEffect(() => {
    if (activeProject && loggedProjectRef.current !== activeProject) {
      console.log('[AgentBuilder] selected projectId=%s', activeProject);
      loggedProjectRef.current = activeProject;
    }
  }, [activeProject]);

  // chat state
  const [messages, setMessages] = useState<
    { role: "assistant" | "user"; text: string }[]
  >(() => loadProjectState(activeProject, mode).messages);

  // Enforce panel visibility by mode
  useEffect(() => {
    if (!panelOpen) {
      setPanelOpen(true);
    }
  }, [mode, panelOpen]);


  // plan
  const [plan, setPlan] = useState<PlanItem[]>(
    () => loadProjectState(activeProject, mode).plan,
  );
  const [stateLoaded, setStateLoaded] = useState(false);

  // links
  const [links, setLinks] = useState<LinkRef[]>(
    () => loadProjectState(activeProject, mode).links,
  );
  // knowledge graph
  const [cypher, setCypher] = useState("");
  const [graphResult, setGraphResult] = useState<any[]>([]);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [graphResetToken, setGraphResetToken] = useState(0);
  const [expandingNodeId, setExpandingNodeId] = useState<string | null>(null);
  const [graphTypeFilter, setGraphTypeFilter] = useState<string>("all");
  const [graphRecencyFilter, setGraphRecencyFilter] = useState<"all" | "24h" | "7d" | "30d">("all");
  const [graphMinConfidence, setGraphMinConfidence] = useState<number>(0);
  const [, setSelectedEdgeEvidence] = useState<KnowledgeGraphRelationship | null>(null);
  const [knowGraphData, setKnowGraphData] = useState<{ nodes: any[]; relationships: any[] }>({
    nodes: [],
    relationships: [],
  });
  const [kgDebugTrace, setKgDebugTrace] = useState<any>(null);
  const [lastIngestTrace, setLastIngestTrace] = useState<any>(null);
  const scopeKey = `${mode}:${activeProject || ""}`;
  const graphCacheScope = `${scopeKey}:${graphTypeFilter}:${graphRecencyFilter}:${graphMinConfidence}`;
  const graphCacheKey = `${KG_CACHE_PREFIX}:${graphCacheScope}`;

  const resetKnowledgePanelState = useCallback(() => {
    kgLoadAbortRef.current?.abort();
    kgLoadAbortRef.current = null;
    kgLoadProjectRef.current = "";
    kgExpandAbortRef.current?.abort();
    kgExpandAbortRef.current = null;
    kgExpandProjectRef.current = "";
    graphHydrateKeyRef.current = "";
    kgAutoLoadKeyRef.current = "";
    setCypher("");
    setGraphResult([]);
    setKnowGraphData({ nodes: [], relationships: [] });
    setGraphError(null);
    setGraphLoading(false);
    setExpandingNodeId(null);
    setGraphResetToken((v) => v + 1);
    setSelectedEdgeEvidence(null);
  }, []);

  useEffect(() => {
    resetKnowledgePanelState();
  }, [activeProject, resetKnowledgePanelState]);

  useEffect(() => {
    if (healthCheckScheduledRef.current) return;
    healthCheckScheduledRef.current = true;
    let cancelled = false;
    let timeoutId: number | null = null;
    let idleId: number | null = null;
    const endpoint = "/api/health";
    const requestType = "health-check";
    const runCheck = async () => {
      const requestSeq = nextRequestSequence(requestType);
      try {
        const payload = await guardedRequest({
          key: endpoint,
          method: "GET",
          ttlMs: 20_000,
          fetcher: async (signal) => {
            const res = await fetch(endpoint, { credentials: "include", signal });
            const { data, text } = await readJsonAndText(res);
            return { res, data, text };
          },
        });
        if (cancelled || !isLatestRequestSequence(requestType, requestSeq)) return;
        if (!payload.res.ok) {
          throw new Error(formatRequestErrorLine(endpoint, payload.res.status, (payload.data && safeText(payload.data)) || payload.text));
        }
        setGraphError((prev) => (prev && prev.includes(endpoint) ? null : prev));
      } catch (err: any) {
        if (cancelled || isAbortLikeError(err) || !isLatestRequestSequence(requestType, requestSeq)) return;
        setGraphError(formatRequestErrorLine(endpoint, 0, err?.message || "Failed to fetch"));
      }
    };
    const schedule = () => {
      const maybeWindow = window as Window & {
        requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number;
        cancelIdleCallback?: (id: number) => void;
      };
      if (typeof maybeWindow.requestIdleCallback === "function") {
        idleId = maybeWindow.requestIdleCallback(() => {
          void runCheck();
        }, { timeout: 1500 });
        return;
      }
      timeoutId = window.setTimeout(() => {
        void runCheck();
      }, 0);
    };
    schedule();
    return () => {
      cancelled = true;
      if (timeoutId != null) window.clearTimeout(timeoutId);
      const maybeWindow = window as Window & { cancelIdleCallback?: (id: number) => void };
      if (idleId != null && typeof maybeWindow.cancelIdleCallback === "function") {
        maybeWindow.cancelIdleCallback(idleId);
      }
    };
  }, []);

  const runGraphQuery = useCallback(async (
    query?: string,
    opts?: {
      merge?: boolean;
      queryParams?: Record<string, unknown>;
      signal?: AbortSignal;
      requestType?: string;
      requestSeq?: number;
      manageLoading?: boolean;
    },
  ): Promise<boolean> => {
    const projectId = activeProject;
    const q = (query ?? cypher).trim();
    const requestType = opts?.requestType || "kg-query";
    const requestSeq = opts?.requestSeq ?? nextRequestSequence(requestType);
    if (!projectId) return false;
    if (!q) {
      setGraphError("Enter a Cypher query first.");
      return false;
    }
    if (isLatestRequestSequence(requestType, requestSeq)) {
      setGraphError(null);
      if (opts?.manageLoading !== false) setGraphLoading(true);
    }
    try {
      const endpoint = `/api/v2/projects/${projectId}/kg/query`;
      const requestParams = { projectId, ...(opts?.queryParams || {}) };
      const requestBody = JSON.stringify({ cypher: q, params: requestParams });
      const payload = await guardedRequest({
        key: `kg:post:${projectId}:${q}:${JSON.stringify(requestParams)}`,
        method: "POST",
        signal: opts?.signal,
        fetcher: async (signal) => {
          const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: requestBody,
            signal,
          });
          const { data, text } = await readJsonAndText(res);
          return { res, data, text, endpoint };
        },
      });
      if (!payload.res.ok || !payload.data?.ok) {
        const msg = formatRequestErrorLine(
          payload.endpoint,
          payload.res.status,
          (payload.data && safeText(payload.data?.error || payload.data?.message)) || payload.text,
        );
        throw new Error(msg);
      }
      if (activeProjectLatestRef.current !== projectId) return false;
      if (!isLatestRequestSequence(requestType, requestSeq)) return false;
      const rows = Array.isArray(payload.data.rows) ? payload.data.rows : [];
      if (opts?.merge) {
        setGraphResult((prev) => {
          const seen = new Set(
            prev.map((row: any) => (typeof row === "string" ? row : JSON.stringify(row))),
          );
          const merged = [...prev];
          rows.forEach((row: any) => {
            const key = typeof row === "string" ? row : JSON.stringify(row);
            if (!seen.has(key)) {
              seen.add(key);
              merged.push(row);
            }
          });
          return merged;
        });
      } else {
        setGraphResult(rows);
      }
      return true;
    } catch (err: any) {
      if (isAbortLikeError(err)) return false;
      if (activeProjectLatestRef.current !== projectId) return false;
      if (!isLatestRequestSequence(requestType, requestSeq)) return false;
      setGraphError(err?.message || "Graph error");
      return false;
    } finally {
      if (
        opts?.manageLoading !== false &&
        activeProjectLatestRef.current === projectId &&
        isLatestRequestSequence(requestType, requestSeq)
      ) {
        setGraphLoading(false);
      }
    }
  }, [activeProject, cypher]);

  const buildRecencySinceTs = useCallback((): string | null => {
    if (graphRecencyFilter === "all") return null;
    const now = Date.now();
    const deltaMs =
      graphRecencyFilter === "24h"
        ? 24 * 60 * 60 * 1000
        : graphRecencyFilter === "7d"
          ? 7 * 24 * 60 * 60 * 1000
          : 30 * 24 * 60 * 60 * 1000;
    return new Date(now - deltaMs).toISOString();
  }, [graphRecencyFilter]);

  const runGraphPresetQuery = useCallback(async (
    preset: "SEED" | "EXPAND",
    opts?: {
      merge?: boolean;
      nodeId?: string;
      limit?: number;
      signal?: AbortSignal;
      requestType?: string;
      requestSeq?: number;
      allowPostFallback?: boolean;
    },
  ): Promise<boolean> => {
    const projectId = activeProject;
    if (!projectId) return false;
    const requestType = opts?.requestType || "kg-query";
    const requestSeq = opts?.requestSeq ?? nextRequestSequence(requestType);

    const limit = opts?.limit ?? (preset === "SEED" ? 220 : 120);
    const sinceTs = buildRecencySinceTs();
    const queryParams: Record<string, unknown> = {
      projectId,
      limit,
      typeFilter: graphTypeFilter !== "all" ? graphTypeFilter : null,
      sinceTs,
      minConfidence: graphMinConfidence > 0 ? graphMinConfidence : null,
    };
    if (preset === "EXPAND") {
      queryParams.nodeId = opts?.nodeId ?? null;
    }

    const search = new URLSearchParams();
    search.set("query", preset);
    search.set("limit", String(limit));

    if (preset === "EXPAND" && opts?.nodeId) {
      search.set("nodeId", opts.nodeId);
    }
    if (graphTypeFilter !== "all") {
      search.set("type", graphTypeFilter);
    }
    if (sinceTs) {
      search.set("sinceTs", sinceTs);
    }
    if (graphMinConfidence > 0) {
      search.set("minConfidence", String(graphMinConfidence));
    }

    if (isLatestRequestSequence(requestType, requestSeq)) {
      setGraphError(null);
      setGraphLoading(true);
    }
    try {
      const endpoint = `/api/v2/projects/${projectId}/kg/query?${search.toString()}`;
      const payload = await guardedRequest({
        key: `kg:get:${endpoint}`,
        method: "GET",
        ttlMs: preset === "SEED" ? KG_CACHE_TTL_MS : 12_000,
        signal: opts?.signal,
        fetcher: async (signal) => {
          const res = await fetch(endpoint, {
            method: "GET",
            signal,
          });
          const { data, text } = await readJsonAndText(res);
          return { res, data, text, endpoint };
        },
      });
      if (!payload.res.ok || !payload.data?.ok) {
        const msg = formatRequestErrorLine(
          payload.endpoint,
          payload.res.status,
          (payload.data && safeText(payload.data?.error || payload.data?.message)) || payload.text,
        );
        throw new Error(msg);
      }
      if (activeProjectLatestRef.current !== projectId) return false;
      if (!isLatestRequestSequence(requestType, requestSeq)) return false;
      if (typeof payload.data?.cypher === "string") {
        setCypher(payload.data.cypher);
      }

      const rows = Array.isArray(payload.data.rows) ? payload.data.rows : [];
      if (opts?.merge) {
        setGraphResult((prev) => {
          const seen = new Set(prev.map((row: any) => (typeof row === "string" ? row : JSON.stringify(row))));
          const merged = [...prev];
          rows.forEach((row: any) => {
            const key = typeof row === "string" ? row : JSON.stringify(row);
            if (!seen.has(key)) {
              seen.add(key);
              merged.push(row);
            }
          });
          return merged;
        });
      } else {
        setGraphResult(rows);
      }
      return true;
    } catch (err: any) {
      const msg = String(err?.message || "Graph query failed");
      const allowPostFallback = opts?.allowPostFallback !== false;
      if (
        allowPostFallback &&
        (msg.includes("| 404 |") || msg.includes("| 405 |") || msg.includes("HTTP 404") || msg.includes("HTTP 405"))
      ) {
        const fallbackCypher = preset === "SEED" ? KG_SEED_QUERY : KG_EXPAND_QUERY;
        return runGraphQuery(fallbackCypher, {
          merge: opts?.merge,
          queryParams,
          signal: opts?.signal,
          requestType,
          requestSeq,
          manageLoading: false,
        });
      }
      if (isAbortLikeError(err)) return false;
      if (activeProjectLatestRef.current !== projectId) return false;
      if (!isLatestRequestSequence(requestType, requestSeq)) return false;
      setGraphError(msg);
      return false;
    } finally {
      if (activeProjectLatestRef.current === projectId && isLatestRequestSequence(requestType, requestSeq)) {
        setGraphLoading(false);
      }
    }
  }, [activeProject, graphTypeFilter, graphMinConfidence, buildRecencySinceTs, runGraphQuery]);

  const loadKnowGraphData = useCallback(async (
    opts?: { signal?: AbortSignal; requestType?: string; requestSeq?: number },
  ): Promise<boolean> => {
    const projectId = activeProject;
    if (!projectId) {
      setKnowGraphData({ nodes: [], relationships: [] });
      return false;
    }
    const requestType = opts?.requestType || "knowgraph-data";
    const requestSeq = opts?.requestSeq ?? nextRequestSequence(requestType);

    try {
      const endpoint = `/api/knowgraph/graph?projectId=${encodeURIComponent(projectId)}`;
      const payload = await guardedRequest({
        key: `knowgraph:data:${projectId}`,
        method: "GET",
        ttlMs: KG_CACHE_TTL_MS,
        signal: opts?.signal,
        fetcher: async (signal) => {
          const res = await fetch(endpoint, {
            credentials: "include",
            signal,
          });
          const { data, text } = await readJsonAndText(res);
          return { res, data, text, endpoint };
        },
      });
      if (!payload.res.ok) {
        throw new Error(
          formatRequestErrorLine(
            payload.endpoint,
            payload.res.status,
            (payload.data && safeText(payload.data?.error?.message || payload.data?.error)) || payload.text,
          ),
        );
      }
      if (activeProjectLatestRef.current !== projectId) return false;
      if (!isLatestRequestSequence(requestType, requestSeq)) return false;
      setKnowGraphData({
        nodes: Array.isArray(payload.data?.nodes) ? payload.data.nodes : [],
        relationships: Array.isArray(payload.data?.relationships) ? payload.data.relationships : [],
      });
      setGraphError((prev) => (prev && prev.includes("/api/knowgraph/graph") ? null : prev));
      return true;
    } catch (err: any) {
      if (isAbortLikeError(err)) return false;
      if (activeProjectLatestRef.current !== projectId) return false;
      if (!isLatestRequestSequence(requestType, requestSeq)) return false;
      console.warn("[KnowGraph] graph fetch failed:", err?.message || err);
      setKnowGraphData({ nodes: [], relationships: [] });
      setGraphError(err?.message || "KnowGraph graph fetch failed");
      return false;
    }
  }, [activeProject]);

  const loadKnowGraphHealth = useCallback(async (
    opts?: { signal?: AbortSignal; requestType?: string; requestSeq?: number },
  ): Promise<boolean> => {
    const endpoint = "/api/knowgraph/health";
    const requestType = opts?.requestType || "knowgraph-health";
    const requestSeq = opts?.requestSeq ?? nextRequestSequence(requestType);
    try {
      const payload = await guardedRequest({
        key: endpoint,
        method: "GET",
        ttlMs: 20_000,
        signal: opts?.signal,
        fetcher: async (signal) => {
          const res = await fetch(endpoint, { credentials: "include", signal });
          const { data, text } = await readJsonAndText(res);
          return { res, data, text, endpoint };
        },
      });
      if (!payload.res.ok) {
        throw new Error(
          formatRequestErrorLine(
            payload.endpoint,
            payload.res.status,
            (payload.data && safeText(payload.data?.error?.message || payload.data?.error)) || payload.text,
          ),
        );
      }
      if (!isLatestRequestSequence(requestType, requestSeq)) return false;
      setGraphError((prev) => (prev && prev.includes(endpoint) ? null : prev));
      return true;
    } catch (err: any) {
      if (isAbortLikeError(err)) return false;
      if (!isLatestRequestSequence(requestType, requestSeq)) return false;
      setGraphError(err?.message || `${endpoint} | 0 | request failed`);
      return false;
    }
  }, []);

  const expandKnowGraphFromEntity = useCallback(
    async (entity: KnowledgeGraphNode) => {
      const projectId = activeProject;
      if (!projectId) return;
      const requestType = "kg-expand";
      const requestSeq = nextRequestSequence(requestType);
      const rawId = String(entity.rawId || entity.id || "").trim();
      if (!rawId) return;

      const endpoint = `/api/knowgraph/expand?projectId=${encodeURIComponent(projectId)}&nodeId=${encodeURIComponent(rawId)}&depth=1&limit=50`;
      kgExpandAbortRef.current?.abort();
      const controller = new AbortController();
      kgExpandAbortRef.current = controller;
      kgExpandProjectRef.current = projectId;
      setExpandingNodeId(entity.label || entity.id);
      try {
        const payload = await guardedRequest({
          key: `knowgraph:expand:${projectId}:${rawId}`,
          method: "GET",
          ttlMs: 12_000,
          signal: controller.signal,
          fetcher: async (signal) => {
            const res = await fetch(endpoint, { credentials: "include", signal });
            const { data, text } = await readJsonAndText(res);
            return { res, data, text, endpoint };
          },
        });
        if (!payload.res.ok) {
          throw new Error(
            formatRequestErrorLine(
              payload.endpoint,
              payload.res.status,
              (payload.data && safeText(payload.data?.error?.message || payload.data?.error)) || payload.text,
            ),
          );
        }
        if (
          !isLatestRequestSequence(requestType, requestSeq) ||
          controller.signal.aborted ||
          activeProjectLatestRef.current !== projectId
        ) {
          return;
        }

        const nextNodes = Array.isArray(payload.data?.nodes) ? payload.data.nodes : [];
        const nextRelationships = Array.isArray(payload.data?.relationships) ? payload.data.relationships : [];
        setKnowGraphData((prev) => {
          const nodeMap = new Map<string, any>();
          const relationshipMap = new Map<string, any>();
          [...(Array.isArray(prev.nodes) ? prev.nodes : []), ...nextNodes].forEach((n: any) => {
            const id = String(n?.id ?? "").trim();
            if (id && !nodeMap.has(id)) nodeMap.set(id, n);
          });
          [...(Array.isArray(prev.relationships) ? prev.relationships : []), ...nextRelationships].forEach((r: any) => {
            const id = String(r?.id ?? "").trim();
            if (id && !relationshipMap.has(id)) relationshipMap.set(id, r);
          });
          return {
            nodes: Array.from(nodeMap.values()),
            relationships: Array.from(relationshipMap.values()),
          };
        });
        setGraphError((prev) => (prev && prev.includes("/api/knowgraph/expand") ? null : prev));
      } catch (err: any) {
        if (
          isAbortLikeError(err) ||
          !isLatestRequestSequence(requestType, requestSeq) ||
          activeProjectLatestRef.current !== projectId
        ) {
          return;
        }
        setGraphError(err?.message || "KnowGraph expand failed");
      } finally {
        if (activeProjectLatestRef.current === projectId && isLatestRequestSequence(requestType, requestSeq)) {
          setExpandingNodeId(null);
        }
        if (kgExpandAbortRef.current === controller) {
          kgExpandAbortRef.current = null;
        }
        if (kgExpandProjectRef.current === projectId) {
          kgExpandProjectRef.current = "";
        }
      }
    },
    [activeProject],
  );

  const loadActiveProjectState = useCallback(async () => {
    if (!activeProject) {
      stateLoadKeyRef.current = "";
      stateLoadProjectRef.current = "";
      return;
    }
    const projectId = activeProject;
    if (stateLoadKeyRef.current === projectId) return; // Guard duplicate load cascades for the same project selection.
    stateLoadKeyRef.current = projectId;
    const requestType = "project-state-load";
    const requestSeq = nextRequestSequence(requestType);
    stateLoadAbortRef.current?.abort();
    const controller = new AbortController();
    stateLoadAbortRef.current = controller;
    stateLoadProjectRef.current = projectId;
    setStateLoaded(false);

    void (async () => {
      try {
        const endpoint = `${V2_PROJECTS_API}/${projectId}/state`;
        const payload = await guardedRequest({
          key: `project-state:${projectId}`,
          method: "GET",
          ttlMs: 3_000,
          signal: controller.signal,
          fetcher: async (signal) => {
            const response = await fetch(endpoint, { signal });
            const data = await safeJson(response);
            return { response, data };
          },
        });
        if (
          controller.signal.aborted ||
          !isLatestRequestSequence(requestType, requestSeq) ||
          activeProjectLatestRef.current !== projectId
        ) {
          return;
        }
        setMessages(normalizeMessages(payload.data?.messages));
        setPlan(normalizePlanItems(payload.data?.plan));
        setLinks(normalizeLinks(payload.data?.links));
        setStateLoaded(true);
      } catch (err) {
        if (
          isAbortLikeError(err) ||
          !isLatestRequestSequence(requestType, requestSeq) ||
          activeProjectLatestRef.current !== projectId
        ) {
          return;
        }
        const next = loadProjectState(projectId);
        setMessages(normalizeMessages(next.messages));
        setPlan(normalizePlanItems(next.plan));
        setLinks(normalizeLinks(next.links));
        setStateLoaded(true);
      } finally {
        if (stateLoadAbortRef.current === controller) {
          stateLoadAbortRef.current = null;
        }
        if (stateLoadProjectRef.current === projectId) {
          stateLoadProjectRef.current = "";
        }
      }
    })();
  }, [activeProject]);

  // When switching projects, reload all per-project state from storage.
  useEffect(() => {
    void loadActiveProjectState();
  }, [loadActiveProjectState]);

  // Load projects on mount ONLY
  useEffect(() => {
    if (mountRefreshRanRef.current) return;
    let cancelled = false;
    const timerId = window.setTimeout(() => {
      if (cancelled || mountRefreshRanRef.current) return;
      mountRefreshRanRef.current = true;
      const search = new URLSearchParams(window.location.search);
      const urlId = search.get("projectId") || "";
      if (urlId) {
        setActiveProjectWithUrl(urlId);
      }
      void refreshProjects(undefined, mode === "assist" ? "assist" : "agent", "mount");
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
  // Mode is user-chosen via Assist/Agent toggle - do not auto-switch based on project

  useEffect(() => {
    return () => {
      refreshAbortRef.current?.abort();
      stateLoadAbortRef.current?.abort();
      kgLoadAbortRef.current?.abort();
      kgExpandAbortRef.current?.abort();
      dashboardPollAbortRef.current?.abort();
      if (dashboardPollTimerRef.current != null) {
        window.clearTimeout(dashboardPollTimerRef.current);
        dashboardPollTimerRef.current = null;
      }
    };
  }, []);

  const loadProjectSubgraph = useCallback((opts?: { force?: boolean }) => {
    const projectId = activeProject;
    if (!projectId) {
      resetKnowledgePanelState();
      return;
    }
    const cacheKey = graphCacheKey;
    const requestType = "kg-subgraph-load";
    const requestSeq = nextRequestSequence(requestType);
    setGraphResetToken((v) => v + 1);
    setSelectedEdgeEvidence(null);
    const cached = readCachedGraphPayload(cacheKey);
    if (cached) {
      // Show cached graph immediately while refresh decision is made.
      setCypher(cached.cypher || "");
      setGraphResult(Array.isArray(cached.graphResult) ? cached.graphResult : []);
      setKnowGraphData({
        nodes: Array.isArray(cached.knowGraphData?.nodes) ? cached.knowGraphData.nodes : [],
        relationships: Array.isArray(cached.knowGraphData?.relationships) ? cached.knowGraphData.relationships : [],
      });
      graphHydrateKeyRef.current = cacheKey;
    }
    const shouldRefresh = opts?.force || !isCachedGraphFresh(cached, KG_CACHE_TTL_MS);
    if (!shouldRefresh) {
      setGraphLoading(false);
      setGraphError(null);
      return;
    }
    kgLoadAbortRef.current?.abort();
    const controller = new AbortController();
    kgLoadAbortRef.current = controller;
    kgLoadProjectRef.current = projectId;
    setGraphError(null);
    void (async () => {
      const knowHealthOk = await loadKnowGraphHealth({
        signal: controller.signal,
        requestType,
        requestSeq,
      });
      await runGraphPresetQuery("SEED", {
        limit: 220,
        signal: controller.signal,
        requestType,
        requestSeq,
        allowPostFallback: false,
      });
      if (
        controller.signal.aborted ||
        !isLatestRequestSequence(requestType, requestSeq) ||
        activeProjectLatestRef.current !== projectId
      ) {
        return;
      }
      if (!knowHealthOk) {
        setKnowGraphData({ nodes: [], relationships: [] });
        return;
      }
      await loadKnowGraphData({
        signal: controller.signal,
        requestType,
        requestSeq,
      });
    })().finally(() => {
      if (kgLoadAbortRef.current === controller) {
        kgLoadAbortRef.current = null;
      }
      if (kgLoadProjectRef.current === projectId) {
        kgLoadProjectRef.current = "";
      }
    });
  }, [activeProject, graphCacheKey, loadKnowGraphData, loadKnowGraphHealth, resetKnowledgePanelState, runGraphPresetQuery]);

  useEffect(() => {
    if (!activeProject) {
      graphHydrateKeyRef.current = "";
      return;
    }
    if (graphHydrateKeyRef.current === graphCacheKey) return;
    const cached = readCachedGraphPayload(graphCacheKey);
    if (!cached) return;
    setCypher(cached.cypher || "");
    setGraphResult(Array.isArray(cached.graphResult) ? cached.graphResult : []);
    setKnowGraphData({
      nodes: Array.isArray(cached.knowGraphData?.nodes) ? cached.knowGraphData.nodes : [],
      relationships: Array.isArray(cached.knowGraphData?.relationships) ? cached.knowGraphData.relationships : [],
    });
    graphHydrateKeyRef.current = graphCacheKey;
  }, [activeProject, graphCacheKey]);

  useEffect(() => {
    if (!activeProject) return;
    const hasGraphData =
      graphResult.length > 0 ||
      knowGraphData.nodes.length > 0 ||
      knowGraphData.relationships.length > 0;
    if (!hasGraphData) return;
    writeCachedGraphPayload(graphCacheKey, {
      updatedAt: Date.now(),
      cypher,
      graphResult,
      knowGraphData,
    });
  }, [activeProject, graphCacheKey, cypher, graphResult, knowGraphData]);

  const loadGraphData = useCallback(() => {
    if (!activeProject) return;
    loadProjectSubgraph({ force: true });
  }, [activeProject, loadProjectSubgraph]);

  const expandGraphFromNode = useCallback(
    async (nodeId: string) => {
      const projectId = activeProject;
      const trimmed = String(nodeId || "").trim();
      if (!trimmed || !projectId) return;
      const requestType = "kg-expand";
      const requestSeq = nextRequestSequence(requestType);
      kgExpandAbortRef.current?.abort();
      const controller = new AbortController();
      kgExpandAbortRef.current = controller;
      kgExpandProjectRef.current = projectId;
      setExpandingNodeId(trimmed);
      try {
        await runGraphPresetQuery("EXPAND", {
          merge: true,
          nodeId: trimmed,
          limit: 120,
          signal: controller.signal,
          requestType,
          requestSeq,
        });
      } finally {
        if (activeProjectLatestRef.current === projectId && isLatestRequestSequence(requestType, requestSeq)) {
          setExpandingNodeId(null);
        }
        if (kgExpandAbortRef.current === controller) {
          kgExpandAbortRef.current = null;
        }
        if (kgExpandProjectRef.current === projectId) {
          kgExpandProjectRef.current = "";
        }
      }
    },
    [activeProject, runGraphPresetQuery],
  );

  // Auto-load project subgraph when Knowledge tab opens or project changes
  useEffect(() => {
    if (tab !== 'Knowledge' || !activeProject || !panelOpen) {
      kgAutoLoadKeyRef.current = "";
      return;
    }
    const autoLoadKey = graphCacheScope;
    if (kgAutoLoadKeyRef.current === autoLoadKey) return; // StrictMode/effect-cascade guard.
    kgAutoLoadKeyRef.current = autoLoadKey;
    loadProjectSubgraph();
  }, [tab, activeProject, panelOpen, graphCacheScope, loadProjectSubgraph]);

  useEffect(() => {
    const refresh = () => {
      loadGraphData();
    };
    window.addEventListener("knowledge:refresh", refresh);
    return () => window.removeEventListener("knowledge:refresh", refresh);
  }, [loadGraphData]);

  useEffect(() => {
    setSelectedEdgeEvidence(null);
  }, [activeProject, tab]);

  useEffect(() => {
    if (
      stateLoadAbortRef.current &&
      stateLoadProjectRef.current &&
      stateLoadProjectRef.current !== activeProject
    ) {
      stateLoadAbortRef.current.abort();
    }
    if (
      kgLoadAbortRef.current &&
      kgLoadProjectRef.current &&
      kgLoadProjectRef.current !== activeProject
    ) {
      kgLoadAbortRef.current.abort();
    }
    if (
      kgExpandAbortRef.current &&
      kgExpandProjectRef.current &&
      kgExpandProjectRef.current !== activeProject
    ) {
      kgExpandAbortRef.current.abort();
    }
    if (
      dashboardPollAbortRef.current &&
      dashboardPollProjectRef.current &&
      dashboardPollProjectRef.current !== activeProject
    ) {
      dashboardPollAbortRef.current.abort();
    }
    if (
      dashboardPollTimerRef.current != null &&
      dashboardPollProjectRef.current &&
      dashboardPollProjectRef.current !== activeProject
    ) {
      window.clearTimeout(dashboardPollTimerRef.current);
      dashboardPollTimerRef.current = null;
    }
  }, [activeProject]);

  // Poll for last ingest trace when Dashboard tab is active
  useEffect(() => {
    const projectId = activeProject;
    if (tab !== "Dashboard" || !projectId) return;

    if (dashboardPollTimerRef.current != null) {
      window.clearTimeout(dashboardPollTimerRef.current);
      dashboardPollTimerRef.current = null;
    }
    dashboardPollAbortRef.current?.abort();
    const controller = new AbortController();
    dashboardPollAbortRef.current = controller;
    dashboardPollProjectRef.current = projectId;

    const runId = ++dashboardPollRunRef.current;
    let cancelled = false;
    let failureCount = 0;
    const schedule = (baseMs: number) => {
      if (cancelled || controller.signal.aborted || runId !== dashboardPollRunRef.current) return;
      if (dashboardPollTimerRef.current != null) {
        window.clearTimeout(dashboardPollTimerRef.current);
      }
      const jitter = Math.floor(Math.random() * 300);
      dashboardPollTimerRef.current = window.setTimeout(() => {
        void fetchIngestTrace();
      }, baseMs + jitter);
    };
    const fetchIngestTrace = async () => {
      if (
        cancelled ||
        controller.signal.aborted ||
        runId !== dashboardPollRunRef.current ||
        activeProjectLatestRef.current !== projectId
      ) {
        return;
      }
      if (document.visibilityState !== "visible") {
        schedule(3_000);
        return;
      }
      try {
        const endpoint = `${V2_PROJECTS_API}/${projectId}/kg/last-trace`;
        const payload = await guardedRequest({
          key: `dashboard:last-trace:${projectId}`,
          method: "GET",
          ttlMs: 1_200,
          signal: controller.signal,
          fetcher: async (signal) => {
            const res = await fetch(endpoint, { signal });
            const data = await safeJson(res);
            return { data };
          },
        });
        if (
          cancelled ||
          controller.signal.aborted ||
          runId !== dashboardPollRunRef.current ||
          activeProjectLatestRef.current !== projectId
        ) {
          return;
        }
        if (payload.data?.ok && payload.data.trace) {
          setLastIngestTrace(payload.data.trace);
        }
        failureCount = 0;
        schedule(3_000);
      } catch (err) {
        if (
          cancelled ||
          controller.signal.aborted ||
          runId !== dashboardPollRunRef.current ||
          activeProjectLatestRef.current !== projectId ||
          isAbortLikeError(err)
        ) {
          return;
        }
        console.error("[Dashboard] Failed to fetch ingest trace:", err);
        failureCount = Math.min(failureCount + 1, 4);
        schedule(3_000 * Math.pow(2, failureCount));
      }
    };

    void fetchIngestTrace();
    return () => {
      cancelled = true;
      if (dashboardPollTimerRef.current != null) {
        window.clearTimeout(dashboardPollTimerRef.current);
        dashboardPollTimerRef.current = null;
      }
      if (dashboardPollAbortRef.current === controller) {
        dashboardPollAbortRef.current.abort();
        dashboardPollAbortRef.current = null;
      }
      if (dashboardPollProjectRef.current === projectId) {
        dashboardPollProjectRef.current = "";
      }
    };
  }, [tab, activeProject]);


  // Load boss agent prompt config when project changes
  useEffect(() => {
    if (mode === "assist" && activeProject) {
      const saved = localStorage.getItem(`boss-prompt:${activeProject}`);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          setBossPromptConfig({
            role: parsed.role || "",
            goal: parsed.goal || "",
            constraints: parsed.constraints || "",
            ioSchema: parsed.ioSchema || "",
            memoryPolicy: parsed.memoryPolicy || "",
            model: parsed.model || "gpt-5.1-chat-latest",
            temperature: parsed.temperature ?? 0.7,
          });
        } catch (err) {
          console.warn("Failed to load boss prompt config:", err);
        }
      } else {
        // Reset to defaults if no saved config
        setBossPromptConfig({
          role: "",
          goal: "",
          constraints: "",
          ioSchema: "",
          memoryPolicy: "",
          model: "gpt-5.1-chat-latest",
          temperature: 0.7,
        });
      }
    }
  }, [mode, activeProject]);

  const sendToBossAgent = async (userText: string) => {
    setSending(true);
    try {
      // Simple payload - let backend pick runtime model
      const runtimeMode = mode === "agents" ? "agent" : "assist";
      const payload: any = { 
        goal: userText, 
        projectId: activeProject,
        mode: runtimeMode,
        agentConfig: {
          role: bossPromptConfig.role,
          goal: bossPromptConfig.goal,
          constraints: bossPromptConfig.constraints,
          ioSchema: bossPromptConfig.ioSchema,
          memoryPolicy: bossPromptConfig.memoryPolicy,
          // Don't send model - let backend pick from its registry
        }
      };
      
      const data = await callBossAgent(payload);

      let assistantText = "";
      if (data?.ok) {
        const finalText =
          (typeof data?.result?.final === "string" && data.result.final.trim()) ||
          (typeof (data as any)?.result === "string" && (data as any).result.trim()) ||
          (typeof (data as any)?.answer === "string" && (data as any).answer.trim()) ||
          (typeof (data as any)?.text === "string" && (data as any).text.trim());
        assistantText =
          typeof finalText === "string" && finalText.length > 0 ? finalText : JSON.stringify(data);
      } else {
        throw new Error(
          safeText((data as any)?.message || (data as any)?.error || "Boss agent failed"),
        );
      }
      setMessages((prev) => [...prev, { role: "assistant", text: assistantText }]);
      if (mode === "assist" && activeProject) {
        window.dispatchEvent(new CustomEvent("knowledge:refresh"));
      }
    } catch (error: any) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: `Error: ${error?.message || "Request failed"}`,
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  const handleSend = (t: string) => {
    const trimmed = t.trim();
    if (!trimmed) return;
    if (sending) return;

    setMessages((m) => [...m, { role: "user", text: trimmed }]);

    const userText = trimmed;
    void sendToBossAgent(userText);
  };

  const approve = (id: string) =>
    setPlan((p) =>
      p.map((it) =>
        it.id === id
          ? {
              ...it,
              status: it.status === "approved" ? "draft" : "approved",
            }
          : it,
      ),
    );

  const addTask = (text: string) =>
    setPlan((p) => [{ id: uid(), text, status: "draft" }, ...p]);

  const addLinks = (seed: string) => {
    setMessages((m) => [
      ...m,
      {
        role: "assistant",
        text: `Link search for "${seed}" is not connected to the backend yet.`,
      },
    ]);
  };

  const accept = (id: string) =>
    setLinks((ls) =>
      ls.map((x) => (x.id === id ? { ...x, accepted: true } : x)),
    );

  const reject = (id: string) =>
    setLinks((ls) => ls.filter((x) => x.id !== id));

  const thinkGraphViz = useMemo(
    () => prefixThinkGraphIds(ageRowsToGraph(graphResult)),
    [graphResult],
  );

  const knowGraphViz = useMemo(
    () => normalizeKnowGraphResponseToGraph(knowGraphData),
    [knowGraphData],
  );

  const graphViz = useMemo(
    () => mergeKnowledgeGraphs(thinkGraphViz, knowGraphViz),
    [thinkGraphViz, knowGraphViz],
  );

  const graphVizFiltered = useMemo(() => {
    const sinceTs = buildRecencySinceTs();
    const sinceMs = sinceTs ? Date.parse(sinceTs) : null;
    const nodeById = new Map(graphViz.nodes.map((n) => [n.id, n]));

    const edgePasses = (e: KEdge): boolean => {
      const source = e.source || e.a;
      const target = e.target || e.b;
      const sourceNode = source ? nodeById.get(source) : undefined;
      const targetNode = target ? nodeById.get(target) : undefined;
      const score = Number(e.confidence ?? e.weight ?? 0);
      if (graphMinConfidence > 0 && Number.isFinite(score) && score < graphMinConfidence) {
        return false;
      }
      if (sinceMs != null) {
        const edgeTs = parseTimestampMs(e.last_seen_ts);
        if (typeof edgeTs === "number" && edgeTs < sinceMs) {
          return false;
        }
      }
      if (graphTypeFilter !== "all") {
        const sourceType = String(sourceNode?.type || "unknown").toLowerCase();
        const targetType = String(targetNode?.type || "unknown").toLowerCase();
        if (sourceType !== graphTypeFilter && targetType !== graphTypeFilter) {
          return false;
        }
      }
      return true;
    };

    const keptEdges = graphViz.edges.filter(edgePasses);
    const keptNodeIds = new Set<string>();
    keptEdges.forEach((e) => {
      const source = e.source || e.a;
      const target = e.target || e.b;
      if (source) keptNodeIds.add(source);
      if (target) keptNodeIds.add(target);
    });

    graphViz.nodes.forEach((n) => {
      const nodeType = String(n.type || "unknown").toLowerCase();
      if (graphTypeFilter !== "all" && nodeType !== graphTypeFilter) return;
      if (sinceMs != null) {
        const nodeTs = parseTimestampMs(n.last_seen_ts) ?? n.createdAtMs;
        if (typeof nodeTs === "number" && nodeTs < sinceMs) return;
      }
      keptNodeIds.add(n.id);
    });

    const degreeByNode = new Map<string, number>();
    keptEdges.forEach((e) => {
      const source = e.source || e.a;
      const target = e.target || e.b;
      if (source) degreeByNode.set(source, (degreeByNode.get(source) || 0) + 1);
      if (target) degreeByNode.set(target, (degreeByNode.get(target) || 0) + 1);
    });

    const keptNodes = graphViz.nodes
      .filter((n) => keptNodeIds.has(n.id))
      .map((n) => ({
        ...n,
        degree: degreeByNode.get(n.id) || 0,
      }));

    return { nodes: keptNodes, edges: keptEdges };
  }, [graphViz, graphTypeFilter, graphMinConfidence, buildRecencySinceTs]);

  const graphVizForNVL = useMemo(
    () => buildGraphVizForNVL(graphVizFiltered),
    [graphVizFiltered],
  );

  const createProjectPrompt = async () => {
    const name = window.prompt("New project name?");
    if (!name || !name.trim()) return;
    let code = window.prompt("Project code (optional)") || "";
    code = code.trim();
    if (!code) {
      code = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    }
    
    const projectType = mode === 'assist' ? 'assist' : 'agent';
    
    try {
      const res = await fetch(V2_PROJECTS_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          name: name.trim(), 
          code,
          project_type: projectType
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `HTTP ${res.status}`);
      }
      const data = await res.json().catch(() => null);
      const newId = (data && data.id) || "";
      
      // Refresh projects with the correct type filter
      await refreshProjects(newId, projectType, 'after-create');
      
      // Set mode based on project type
      if (projectType === 'assist') {
        setMode('assist');
      } else {
        setMode('agents');
      }
      
      // Select the new project
      if (newId) {
        if (projectType === "assist") {
          setActiveProjectWithUrl(newId);
        } else {
          setSelectedAgentProjectId(newId);
          setSelectedAgentType("agent_builder");
        }
      }
    } catch (err: any) {
      console.error("Create project failed", err);
      setProjectsError(`Failed to create project: ${err?.message || 'Unknown error'}`);
    }
  };

  return (
    <div
      className="h-screen w-full flex flex-col overflow-hidden"
      style={{ background: C.bg, color: C.text }}
    >
      {/* Top bar */}
      <div
        className="flex items-center justify-between px-5"
        style={{ height: 56, borderBottom: `1px solid ${C.border}` }}
      >
        <div className="flex items-center gap-3">
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              background:
                "radial-gradient(circle at 35% 30%, #7ED1DB 0%, " +
                C.primary +
                " 55%, #2E6C75 100%)",
              boxShadow: "0 0 0 2px #000 inset",
            }}
          />
        </div>
        <div className="flex items-center gap-3" />
      </div>

      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* LEFT rail */}
        <aside
          className="h-full flex flex-col items-center gap-3 py-3"
          style={{
            width: 54,
            background: C.panel,
            borderRight: `1px solid ${C.border}`,
          }}
        >
          <button
            title="Project"
            onClick={() => setOpenDrawer("project")}
            className="p-2 rounded"
            style={{ color: C.text }}
          >
            <Icon d="M4 7l8-4 8 4v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
          </button>
          <button
            title={panelOpen ? "Hide Context" : "Show Context"}
            onClick={() => setPanelOpen((v) => !v)}
            className="p-2 rounded"
            style={{ color: panelOpen ? C.primary : C.text }}
          >
            <Icon d="M3 12h18M12 3v18" />
          </button>
          <button
            title="Settings"
            onClick={() => setOpenDrawer("settings")}
            className="p-2 rounded"
            style={{ color: C.text }}
          >
            <Icon d="M12 1v3M12 20v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M1 12h3M20 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" />
          </button>
          <div className="flex-1" />
          <button
            title="Admin"
            onClick={() => setOpenDrawer("admin")}
            className="p-2 rounded"
            style={{ color: "#ffb86b" }}
          >
            <Icon d="M3 12l2-2 4 4L21 4" />
          </button>
        </aside>

        {/* CENTER chat */}
        <div
          className="h-full transition-[width] duration-300 ease-out min-w-0"
          style={{
            width: panelOpen ? `calc(100% - ${panelWidth}px)` : "100%",
          }}
        >
          <Chat
            messages={messages}
            onSend={handleSend}
            projectId={activeProject}
            disabled={sending}
          />
        </div>

        {/* RIGHT panel */}
        {panelOpen && (
          <aside
            className="h-full relative"
            style={{
              width: panelWidth,
              borderLeft: `1px solid ${C.border}`,
              background: C.panel,
              flexShrink: 0,
              overflow: "hidden",
            }}
          >
            <div className="px-4 pt-4 h-full flex flex-col overflow-hidden min-h-0">
              <div className="flex gap-6 mb-3">
                {activeTabs.map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className="font-semibold transition-colors"
                    style={{
                      padding: "8px 10px",
                      color: tab === t ? "#FFFFFF" : C.neutral,
                      background:
                        tab === t
                          ? "rgba(79,162,173,0.18)"
                          : "transparent",
                      border:
                        "1px solid " +
                        (tab === t ? C.primary : "transparent"),
                      borderRadius: 10,
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>

              <div
                className="flex-1 overflow-auto px-1 pr-3 pb-6 text-sm"
                style={{ color: C.neutral }}
              >
                {mode === "agents" && (
                  <>
                    {tab === "Plan" && (
                      <div className="space-y-3">
                        {activeConfigProjectId ? (
                          <div className="space-y-4">
                            <div
                              className="text-xs"
                              style={{
                                padding: "10px 12px",
                                borderRadius: 8,
                                border: `1px solid ${C.border}`,
                                background: C.bg,
                                color: C.neutral,
                              }}
                            >
                              <div style={{ color: C.text, fontWeight: 600, marginBottom: 4 }}>
                                Config Binding
                              </div>
                              <div>current projectId: {activeConfigProjectId}</div>
                              <div>current agentType: {selectedAgentType}</div>
                              {SYSTEM_AGENT_TYPES.has(selectedAgentType) && (
                                <div style={{ opacity: 0.8 }}>
                                  selected deck: {safeText(selectedAgentProject?.name || selectedAgentProject?.id || "system")}
                                </div>
                              )}
                            </div>
                            <div>
                              <AgentManager
                                key={agentManagerRenderKey}
                                projectId={activeConfigProjectId}
                                agentType={selectedAgentType}
                                activeTab={tab}
                                onGraphRefresh={() => {
                                  // no-op
                                }}
                              />
                            </div>
                          </div>
                        ) : (
                          <div
                            style={{
                              padding: '16px',
                              border: `1px dashed ${C.border}`,
                              borderRadius: '8px',
                              color: C.neutral,
                              background: '#1a1a1a',
                            }}
                          >
                            Select an Assist project for system agents or an Agent workspace for Agent Builder config.
                          </div>
                        )}
                      </div>
                    )}

                    {tab === "Links" && (
                      <div className="space-y-3">
                        {/* Sources/Links */}
                        {links.map((l) => (
                          <div
                            key={l.id}
                            style={{
                              border: `1px solid ${C.border}`,
                              borderRadius: 8,
                              padding: "8px",
                            }}
                          >
                            <div
                              style={{
                                color: C.text,
                                fontWeight: 600,
                              }}
                            >
                              {safeText(l.title)}
                            </div>
                            <div
                              className="text-xs"
                              style={{ opacity: 0.8, margin: "4px 0 8px" }}
                            >
                              {safeText(l.url)}
                            </div>
                            <div className="flex gap-6 text-sm">
                              {!l.accepted && (
                                <button
                                  onClick={() => accept(l.id)}
                                  style={{ color: C.primary }}
                                >
                                  Accept
                                </button>
                              )}
                              <button
                                onClick={() => reject(l.id)}
                                style={{ color: C.warn }}
                              >
                                Reject
                              </button>
                              <a
                                href={safeText(l.url)}
                                target="_blank"
                                rel="noreferrer"
                                style={{ color: C.neutral }}
                              >
                                open
                              </a>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {tab === "Dashboard" && (
                      <div className="space-y-3">
                        {/* ThinkGraph ingest results - auto-populated from Assist chat */}
                      <div className="space-y-2">
                        <div
                          className="text-xs font-semibold"
                          style={{ color: C.text }}
                        >
                          Last ThinkGraph Ingest
                        </div>
                        <div className="text-xs" style={{ color: C.neutral, marginBottom: 8 }}>
                          Auto-populated when Assist chat triggers ingest.
                        </div>
                        {lastIngestTrace ? (
                            <div
                              className="text-xs space-y-2 p-3 rounded"
                              style={{
                                background: C.bg,
                                border: `1px solid ${C.border}`,
                                maxHeight: 400,
                                overflow: 'auto',
                              }}
                            >
                              {lastIngestTrace.error ? (
                                <div style={{ color: '#f87171' }}>
                                  <div style={{ fontWeight: 600, marginBottom: 4 }}>❌ Ingest Failed</div>
                                  <div style={{ marginBottom: 4 }}>Step: {safeText(lastIngestTrace.error.step)}</div>
                                  <div style={{ marginBottom: 4 }}>Code: {safeText(lastIngestTrace.error.code)}</div>
                                  <div style={{ marginBottom: 8 }}>{safeText(lastIngestTrace.error.message)}</div>
                                  
                                  {lastIngestTrace.step_states.chunking && !lastIngestTrace.step_states.chunking.ok && (
                                    <div style={{ marginTop: 12, padding: 8, background: '#1a1a1a', borderRadius: 4, fontSize: '11px' }}>
                                      <div style={{ fontWeight: 600, marginBottom: 4, color: '#f87171' }}>CHUNKING EVIDENCE</div>
                                      {lastIngestTrace.step_states.chunking.model_key && (
                                        <div style={{ marginBottom: 4 }}>Model: {safeText(lastIngestTrace.step_states.chunking.model_key)}</div>
                                      )}
                                      {lastIngestTrace.step_states.chunking.prompt_user_sha1 && (
                                        <div style={{ marginBottom: 4 }}>Prompt SHA1: {safeText(lastIngestTrace.step_states.chunking.prompt_user_sha1).slice(0, 12)}...</div>
                                      )}
                                      {lastIngestTrace.step_states.chunking.raw_output_sha1 && (
                                        <div style={{ marginBottom: 4 }}>Output SHA1: {safeText(lastIngestTrace.step_states.chunking.raw_output_sha1).slice(0, 12)}...</div>
                                      )}
                                      {lastIngestTrace.step_states.chunking.parse_error && (
                                        <div style={{ marginBottom: 4, color: '#fca5a5' }}>Parse Error: {safeText(lastIngestTrace.step_states.chunking.parse_error)}</div>
                                      )}
                                      {lastIngestTrace.step_states.chunking.raw_output_preview && (
                                        <div style={{ marginTop: 8 }}>
                                          <div style={{ fontWeight: 600, marginBottom: 4 }}>Raw Output Preview:</div>
                                          <pre style={{ 
                                            whiteSpace: 'pre-wrap', 
                                            wordBreak: 'break-all',
                                            fontSize: '10px',
                                            maxHeight: 200,
                                            overflow: 'auto',
                                            background: '#0a0a0a',
                                            padding: 8,
                                            borderRadius: 4,
                                            margin: 0
                                          }}>{safeText(lastIngestTrace.step_states.chunking.raw_output_preview)}</pre>
                                        </div>
                                      )}
                                      {lastIngestTrace.step_states.chunking.prompt_user_preview && (
                                        <div style={{ marginTop: 8 }}>
                                          <div style={{ fontWeight: 600, marginBottom: 4 }}>Prompt Preview:</div>
                                          <pre style={{ 
                                            whiteSpace: 'pre-wrap', 
                                            wordBreak: 'break-all',
                                            fontSize: '10px',
                                            maxHeight: 200,
                                            overflow: 'auto',
                                            background: '#0a0a0a',
                                            padding: 8,
                                            borderRadius: 4,
                                            margin: 0
                                          }}>{safeText(lastIngestTrace.step_states.chunking.prompt_user_preview)}</pre>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <>
                                  <div>
                                    <div style={{ color: C.primary, fontWeight: 600 }}>✅ LAST INGEST</div>
                                    <div style={{ color: C.neutral }}>Time: {new Date(lastIngestTrace.created_at).toLocaleString()}</div>
                                    <div style={{ color: C.neutral }}>Trace ID: {safeText(lastIngestTrace.trace_id)}</div>
                                    <div style={{ color: C.neutral }}>Model: {safeText(lastIngestTrace.model_key)}</div>
                                    <div style={{ color: C.neutral }}>Source: {safeText(lastIngestTrace.src)}</div>
                                  </div>
                                  <div style={{ marginTop: 8 }}>
                                    <div style={{ color: C.primary, fontWeight: 600 }}>STEP CHECKSUMS</div>
                                    <div style={{ color: C.neutral }}>Start: {lastIngestTrace.step_states.start?.ok ? '✅' : '❌'}</div>
                                    {lastIngestTrace.step_states.chunking && (
                                      <>
                                        <div style={{ color: C.neutral }}>Chunking: {lastIngestTrace.step_states.chunking.ok ? '✅' : '❌'} {lastIngestTrace.step_states.chunking.chunk_count ? `(${lastIngestTrace.step_states.chunking.chunk_count} chunks)` : ''}</div>
                                        {lastIngestTrace.step_states.chunking.ok && (
                                          <div style={{ marginLeft: 16, marginTop: 4, fontSize: '11px', color: C.neutral }}>
                                            {lastIngestTrace.step_states.chunking.model_key && (
                                              <div>Model: {safeText(lastIngestTrace.step_states.chunking.model_key)}</div>
                                            )}
                                            {lastIngestTrace.step_states.chunking.prompt_user_sha1 && (
                                              <div>Prompt SHA1: {safeText(lastIngestTrace.step_states.chunking.prompt_user_sha1).slice(0, 12)}...</div>
                                            )}
                                            {lastIngestTrace.step_states.chunking.raw_output_sha1 && (
                                              <div>Output SHA1: {safeText(lastIngestTrace.step_states.chunking.raw_output_sha1).slice(0, 12)}...</div>
                                            )}
                                          </div>
                                        )}
                                      </>
                                    )}
                                    {lastIngestTrace.step_states.embed && (
                                      <div style={{ color: C.neutral }}>Embed: {lastIngestTrace.step_states.embed.ok ? '✅' : '❌'} {lastIngestTrace.step_states.embed.vectors_count ? `(${lastIngestTrace.step_states.embed.vectors_count} vectors)` : ''}</div>
                                    )}
                                    {lastIngestTrace.step_states.write && (
                                      <div style={{ color: C.neutral }}>Write: {lastIngestTrace.step_states.write.ok ? '✅' : '❌'} {lastIngestTrace.step_states.write.entity_count ? `(${lastIngestTrace.step_states.write.entity_count} entities, ${lastIngestTrace.step_states.write.relation_count} relations)` : ''}</div>
                                    )}
                                    {lastIngestTrace.step_states.done && (
                                      <div style={{ color: lastIngestTrace.step_states.done.ok ? '#10b981' : '#f87171', fontWeight: 600 }}>
                                        Done: {lastIngestTrace.step_states.done.ok ? '✅' : '❌'} ({lastIngestTrace.step_states.done.t_ms}ms)
                                        {lastIngestTrace.step_states.done.entity_count !== undefined && (
                                          <div style={{ fontWeight: 400 }}>Entities: {lastIngestTrace.step_states.done.entity_count}, Relations: {lastIngestTrace.step_states.done.relation_count}, Chunks: {lastIngestTrace.step_states.done.chunk_count}</div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </>
                              )}
                            </div>
                        ) : (
                          <div className="text-xs" style={{ color: C.neutral, fontStyle: 'italic' }}>
                            No ingest activity yet. Send a chat message to trigger auto-ingest.
                          </div>
                        )}
                      </div>
                    </div>
                    )}
                  </>
                )}

                {/* Knowledge tab - available in both modes */}
                {tab === "Knowledge" && (
                  <div className="space-y-3 h-full flex flex-col">
                    <div
                      className="text-xs p-3 rounded"
                      style={{
                        background: C.bg,
                        border: `1px solid ${C.border}`,
                        color: C.neutral,
                      }}
                    >
                      <span>
                        {knowledgePanelSummaryText(graphVizFiltered)}
                      </span>
                    </div>

                    {graphError && (
                      <div
                        className="text-xs"
                        style={{
                          color: C.warn,
                          border: `1px solid rgba(217,132,88,0.35)`,
                          background: "rgba(217,132,88,0.08)",
                          borderRadius: 8,
                          padding: "6px 8px",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                        title={safeText(graphError)}
                      >
                        {safeText(graphError)}
                      </div>
                    )}
                    <div style={{ display: "flex", justifyContent: "center", flex: 1, minHeight: 280 }}>
                      <KnowledgeGraphNVL
                        key={`kg-nvl-${graphResetToken}`}
                        entities={graphVizForNVL.entities}
                        relationships={graphVizForNVL.relationships}
                        loading={graphLoading}
                        expandingEntityId={expandingNodeId}
                        onThinkGraphExpand={expandGraphFromNode}
                        onKnowGraphExpand={expandKnowGraphFromEntity}
                        onRelationshipInspect={setSelectedEdgeEvidence}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* resize handle */}
              <div
                onMouseDown={(e) => {
                  const sx = e.clientX;
                  const sw = panelWidth;
                  const minW = 360;
                  const maxW = 920;
                  const mv = (ev: MouseEvent) => {
                    const d = sx - ev.clientX;
                    setPanelWidth(clamp(sw + d, minW, maxW));
                  };
                  const up = () => {
                    window.removeEventListener("mousemove", mv);
                    window.removeEventListener("mouseup", up);
                  };
                  window.addEventListener("mousemove", mv);
                  window.addEventListener("mouseup", up);
                }}
                style={{
                  position: "absolute",
                  left: -6,
                  top: 0,
                  width: 8,
                  height: "100%",
                  cursor: "col-resize",
                }}
              />
            </div>
          </aside>
        )}
      </div>

      {/* drawers */}
      {openDrawer === "project" && (
        <Drawer title="Project" onClose={() => setOpenDrawer(null)}>
          <div className="space-y-3">
            {/* Mode Selector */}
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => {
                  setMode('assist');
                  refreshProjects(undefined, 'assist', 'mode-change');
                }}
                className="flex-1 px-3 py-2 rounded text-sm font-medium transition-colors"
                style={{
                  background: mode === 'assist' ? C.primary : 'transparent',
                  color: mode === 'assist' ? '#0B0C0E' : C.text,
                  border: `1px solid ${mode === 'assist' ? C.primary : C.border}`,
                }}
              >
                Assist
              </button>
              <button
                onClick={() => {
                  setMode('agents');
                  refreshProjects(undefined, 'agent', 'mode-change');
                }}
                className="flex-1 px-3 py-2 rounded text-sm font-medium transition-colors"
                style={{
                  background: mode === 'agents' ? C.primary : 'transparent',
                  color: mode === 'agents' ? '#0B0C0E' : C.text,
                  border: `1px solid ${mode === 'agents' ? C.primary : C.border}`,
                }}
              >
                Agent
              </button>
            </div>
            
            <div
              className="text-xs uppercase mb-2 flex items-center justify-between"
              style={{ color: C.neutral }}
            >
              <span>{mode === 'assist' ? 'Assist Projects' : 'Agent Projects'}</span>
              <button
                onClick={createProjectPrompt}
                className="text-[11px] px-2 py-1 rounded"
                style={{ border: `1px solid ${C.border}`, color: C.text }}
              >
                {mode === 'assist' ? 'New Project' : 'New Agent'}
              </button>
            </div>
            <div className="space-y-2" style={{ maxHeight: '400px', overflowY: 'auto' }}>
              {!Array.isArray(projects) && (
                <div className="text-xs" style={{ color: C.neutral }}>
                  No projects available.
                </div>
              )}
              {projectsError && (
                <div className="text-xs" style={{ color: C.neutral }}>
                  {safeText(projectsError)}
                </div>
              )}
              {Array.from(
                new Map(
                  (Array.isArray(projects) ? projects : []).map((p) => {
                    const codeKey = String(p.code || '').toLowerCase();
                    const key = codeKey ? `code:${codeKey}` : `id:${p.id}`;
                    return [key, p];
                  }),
                ).values(),
              ).map((project) => {
                return (
                  <React.Fragment key={project.id}>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          if (mode === "agents") {
                            setSelectedAgentProjectId(project.id);
                            setSelectedAgentType(agentTypeFromProjectCode(String(project.code || "")));
                          } else {
                            setActiveProjectWithUrl(project.id);
                          }
                          setOpenDrawer(null);
                        }}
                        className="flex-1 text-left p-3 rounded"
                        style={{
                          background:
                            (mode === "agents" ? selectedAgentProjectId === project.id : activeProject === project.id)
                              ? "rgba(79,162,173,0.18)"
                              : "transparent",
                          border: `1px solid ${
                            (mode === "agents" ? selectedAgentProjectId === project.id : activeProject === project.id)
                              ? C.primary
                              : C.border
                          }`,
                          color: C.text,
                        }}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-medium">
                              {safeText(project.name || project.id)}
                            </div>
                            {project.code && (
                              <div className="opacity-60 text-xs">
                                {safeText(project.code)}
                              </div>
                            )}
                          </div>
                        </div>
                      </button>
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          const PROTECTED_AGENT_CODES = new Set(["main-chat", "kg-ingest", "thinkgraph", "knowgraph", "neo4j", "research-agent"]);
                          const isProtectedAgent = mode === "agents" && PROTECTED_AGENT_CODES.has(project.code);
                          if (isProtectedAgent) {
                            alert("Main Chat, ThinkGraph, KnowGraph, Neo4j, and Research Agent are protected system decks.");
                            return;
                          }
                          if (!confirm(`Delete project "${project.name}"? This cannot be undone.`)) return;
                          try {
                            const res = await fetch(`${V2_PROJECTS_API}/${project.id}`, { method: 'DELETE' });
                            if (!res.ok) throw new Error(`HTTP ${res.status}`);
                            await refreshProjects(undefined, undefined, 'after-delete');
                            if (mode === "assist" && activeProject === project.id) {
                              const remaining = projects.filter(p => p.id !== project.id);
                              if (remaining.length > 0) {
                                setActiveProjectWithUrl(remaining[0].id);
                              } else {
                                setActiveProject('');
                              }
                            }
                          } catch (err: any) {
                            alert(`Failed to delete project: ${err.message}`);
                          }
                        }}
                        className="p-2 rounded"
                        style={{
                          background: 'transparent',
                          border: `1px solid ${C.border}`,
                          color: C.warn,
                        }}
                        title="Delete project"
                      >
                        ×
                      </button>
                    </div>
                  </React.Fragment>
                );
              })}

              {Array.isArray(projects) && projects.length === 0 && !projectsError && (
                <div className="text-xs" style={{ color: C.neutral }}>
                  No projects available.
                </div>
              )}
            </div>
            <div className="text-xs mt-4" style={{ color: C.neutral }}>
              {mode === 'assist'
                ? 'Assist projects are shipped product workspaces.'
                : `System decks save to the active Assist project (${activeProject || "unset"}). Agent Builder workspaces save to their own project.`}
            </div>
          </div>
        </Drawer>
      )}
      {openDrawer === "settings" && (
        <Drawer title="Settings" onClose={() => setOpenDrawer(null)}>
          <div className="text-sm" style={{ color: C.text }}>
            No settings available yet.
          </div>
        </Drawer>
      )}

      {openDrawer === "admin" && (
        <Drawer title="Admin" onClose={() => setOpenDrawer(null)}>
          <div className="text-sm" style={{ color: C.text }}>
            Admin controls placeholder.
          </div>
        </Drawer>
      )}
    </div>
  );
}

function StatCard({ title, value }: { title: string; value: string }) {
  return (
    <div
      style={{
        background: C.bg,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        padding: "12px",
      }}
    >
      <div className="text-xs" style={{ color: C.neutral, marginBottom: 6 }}>
        {title}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: C.text }}>{value}</div>
    </div>
  );
}
