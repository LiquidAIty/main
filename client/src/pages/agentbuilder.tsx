import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  AgentManagerLocalConfig,
  AgentManagerMemoryGraphData,
} from "../components/AgentManager";
import BuilderCanvas, {
  type BuilderCanvasFocusRequest,
} from "../components/builder/BuilderCanvas";
import BuilderChat from "../components/builder/BuilderChat";
import BuilderDrawer from "../components/builder/BuilderDrawer";
import PlanWikiSurface from "../components/assist/PlanWikiSurface";
import {
  buildStructuredAssistPlanSurface,
  type LinkRef,
  normalizeAnchorSurface,
  type PlanItem,
} from "../components/builder/assistPlanSurface";
import DeckEdgeInspector from "../components/builder/DeckEdgeInspector";
import {
  buildExecutionPlan,
} from "../components/builder/deckExecution";
import DeckExecutionPathSummary from "../components/builder/DeckExecutionPathSummary";
import {
  findDeckNodePreset,
  getAssistStarterRecipe,
  type AssistStarterRecipe,
  type DeckNodePreset,
} from "../components/builder/deckPresets";
import DeckQuickAddPanel from "../components/builder/DeckQuickAddPanel";
import {
  resolveEffectiveAgent,
} from "../components/builder/deckRuntime";
import {
  buildDeckRuntimeVisualState,
  buildReloadStateFromDeckRuns,
  resolveDeckRunFinalText,
  streamDeckRunRequest,
} from "../components/builder/deckRunState";
import {
  buildDefaultDeckEdgeMetadata,
  sanitizeDeckEdges,
  validateDeckDocument,
} from "../components/builder/deckValidation";
import {
  formatRequestErrorLine,
  guardedRequest,
  isAbortLikeError,
  isCachedGraphFresh,
  isLatestRequestSequence,
  nextRequestSequence,
  readCachedGraphPayload,
  readJsonAndText,
  safeJson,
  writeCachedGraphPayload,
} from "../components/builder/requestGuards";
import {
  type LatestCardRunRecord,
  useBuilderDeckRuntimeActions,
} from "../components/builder/useBuilderDeckRuntimeActions";
import { useBuilderProjects } from "../components/builder/useBuilderProjects";
import type {
  AgentCardInstance,
  AgentCardRuntimeOptions,
  AgentCardRuntimeType,
  AgentTemplate,
  DeckEdge,
  DeckEdgeType,
  DeckDocument,
  DeckRun,
  DeckRuntimeEvent,
  PromptTemplate,
  RuntimeBinding,
} from "../types/agentgraph";
import type {
  KnowledgeGraphScope,
  KnowledgeGraphRelationship,
  KnowledgeGraphNode,
} from "../components/knowledge/KnowledgeGraphNVL";
import {
  createWorkspaceTestingInteractionId,
  recordWorkspaceTestingEvent,
  type WorkspaceTestingEventInput,
  type WorkspaceTestingObjectType,
  type WorkspaceTestingSurface,
} from "../lib/workspaceTestingTelemetry";

const AgentManager = lazy(async () => {
  const mod = await import("../components/AgentManager");
  return { default: mod.AgentManager };
});
const KnowledgeGraphNVL = lazy(() => import("../components/knowledge/KnowledgeGraphNVL"));
const PlanWikiLexicalView = lazy(async () => {
  try {
    return await import("../components/assist/PlanWikiLexicalView");
  } catch (error) {
    console.error("[PlanWikiLexical] lazy import failed", error);
    return {
      default: function PlanWikiLexicalFallback(props: {
        fallbackText: string;
        textColor: string;
        emptyText?: string;
      }) {
        return (
          <div
            style={{
              color: props.textColor,
              whiteSpace: "pre-wrap",
              lineHeight: 1.65,
              fontSize: 14,
              minHeight: 120,
            }}
          >
            {safeText(props.fallbackText).trim() || props.emptyText || "No plan text yet."}
          </div>
        );
      },
    };
  }
});

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

const HOME_CHAT_TABS = ["Canvas", "Knowledge", "Plan"] as const;
const HOME_PLAN_TABS = ["Chat", "Canvas", "Knowledge"] as const;
const KNOWLEDGE_VIEW_TABS = ["Chat", "Canvas", "Plan"] as const;
const BUILDER_PROJECT_TABS = ["Plan"] as const;
const BUILDER_NODE_TABS = ["Prompt", "Knowledge", "Tools", "Runtime"] as const;
const BUILDER_EDGE_TABS = ["Edge"] as const;
type WorkspaceTestingEventDraft = Omit<WorkspaceTestingEventInput, "projectId"> & {
  projectId?: string | null;
};

function normalizeWorkspaceSurface(value: string): WorkspaceTestingSurface | null {
  const normalized = safeText(value).trim().toLowerCase();
  if (
    normalized === "chat" ||
    normalized === "plan" ||
    normalized === "canvas" ||
    normalized === "knowledge"
  ) {
    return normalized;
  }
  return null;
}

// ---- utils ----
function clamp(x: number, a: number, b: number) {
  return Math.min(b, Math.max(a, x));
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        padding: "12px 14px",
        background: C.bg,
      }}
    >
      <div
        className="text-xs"
        style={{ color: C.text, fontWeight: 700, marginBottom: 8 }}
      >
        {title}
      </div>
      {children}
    </div>
  );
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

function cleanOptionalText(value: unknown): string | null {
  const text = safeText(value).trim();
  return text || null;
}

function normalizeRuntimeType(value: unknown): AgentCardRuntimeType | null {
  const normalized = safeText(value).trim().toLowerCase();
  if (normalized === "assistant_agent") return "assistant_agent";
  if (normalized === "magentic_one") return "magentic_one";
  if (normalized === "graph_flow") return "graph_flow";
  return null;
}

function normalizeRuntimeOptions(value: unknown): AgentCardRuntimeOptions | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return cloneDeckDocument(value as AgentCardRuntimeOptions);
}

function normalizeDeckEdgeType(value: unknown): DeckEdgeType {
  return safeText(value).trim().toLowerCase() === "magentic_option"
    ? "magentic_option"
    : "flow";
}

function extractPromptTemplateField(
  template: string,
  field: "ROLE" | "GOAL" | "CONSTRAINTS" | "IO_SCHEMA" | "MEMORY_POLICY",
): string | null {
  const normalizedTemplate = safeText(template).replace(/\r\n/g, "\n");
  if (!normalizedTemplate.includes(`[${field}]`)) return null;

  const tagRegex = /\[(ROLE|GOAL|CONSTRAINTS|IO_SCHEMA|MEMORY_POLICY)\]/gi;
  const tags: Array<{ key: string; start: number; end: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(normalizedTemplate)) !== null) {
    tags.push({
      key: String(match[1] || "").toUpperCase(),
      start: match.index,
      end: tagRegex.lastIndex,
    });
  }

  for (let index = 0; index < tags.length; index += 1) {
    const current = tags[index];
    if (current.key !== field) continue;
    const next = tags[index + 1];
    const value = normalizedTemplate
      .slice(current.end, next ? next.start : normalizedTemplate.length)
      .trim();
    return value || null;
  }

  return null;
}

function summarizeMemoryGraphLabel(value: string, fallback: string): string {
  const text = safeText(value).trim();
  if (!text) return fallback;
  const normalized = text.replace(/^https?:\/\//i, "").replace(/^[a-z]+:\/\//i, "");
  if (normalized.length <= 30) return normalized;
  const lastSegment = normalized.split(/[\\/]/).filter(Boolean).pop() || normalized;
  if (lastSegment.length <= 30) return lastSegment;
  return `${lastSegment.slice(0, 27)}…`;
}

function normalizeKnowledgeScope(
  value: unknown,
  fallback: KnowledgeGraphScope,
): KnowledgeGraphScope {
  const normalized = safeText(value).trim().toLowerCase();
  if (normalized === "agent") return "agent";
  if (normalized === "project") return "project";
  if (normalized === "system") return "system";
  if (normalized === "grounded_research" || normalized === "grounded-research") {
    return "grounded_research";
  }
  return fallback;
}

function formatKnowledgeScope(scope: KnowledgeGraphScope): string {
  if (scope === "grounded_research") return "grounded research";
  return scope;
}

function buildSelectedCardMemoryGraphData(
  document: DeckDocument,
  selectedCard: AgentCardInstance | null,
  selectedCardConfig: AgentManagerLocalConfig | null,
): AgentManagerMemoryGraphData | null {
  if (!selectedCard || !selectedCardConfig) return null;

  const nodeMap = new Map(document.nodes.map((node) => [node.id, node] as const));
  const entityMap = new Map<string, KnowledgeGraphNode>();
  const relationshipMap = new Map<string, KnowledgeGraphRelationship>();
  const agentNodeId = `memory:${selectedCard.id}`;

  const pushEntity = (entity: KnowledgeGraphNode) => {
    if (!entityMap.has(entity.id)) {
      entityMap.set(entity.id, entity);
    }
  };
  const pushRelationship = (relationship: KnowledgeGraphRelationship) => {
    if (!relationshipMap.has(relationship.id)) {
      relationshipMap.set(relationship.id, relationship);
    }
  };
  pushEntity({
    id: agentNodeId,
    rawId: selectedCard.id,
    label: safeText(selectedCard.title || selectedCard.id),
    type: "Agent",
    source: "mixed",
    scope: "agent",
  });
  pushEntity({
    id: `runtime_input:${selectedCard.id}`,
    rawId: "Current user or upstream turn input.",
    label: "Current Input",
    type: "Runtime Input",
    source: "think",
    scope: "agent",
  });
  pushRelationship({
    id: `rel:runtime_input:${selectedCard.id}`,
    from: `runtime_input:${selectedCard.id}`,
    to: agentNodeId,
    type: "feeds_input",
    source: "think",
    scope: "agent",
    evidence_snippet: "Current turn input is routed into this card at runtime.",
  });

  const memoryPolicy = extractPromptTemplateField(
    String(selectedCardConfig.prompt_template || selectedCard.prompt || ""),
    "MEMORY_POLICY",
  );
  if (memoryPolicy) {
    pushEntity({
      id: `memory_policy:${selectedCard.id}`,
      rawId: memoryPolicy,
      label: "Memory Policy",
      type: "Memory Policy",
      source: "think",
      scope: "agent",
    });
    pushRelationship({
      id: `rel:memory_policy:${selectedCard.id}`,
      from: `memory_policy:${selectedCard.id}`,
      to: agentNodeId,
      type: "shapes_memory",
      source: "think",
      scope: "agent",
      evidence_snippet: "This prompt section shapes how the card carries or constrains memory.",
    });
  }

  (Array.isArray(selectedCardConfig.knowledge_sources)
    ? selectedCardConfig.knowledge_sources
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : []
  ).forEach((source, index) => {
    const sourceNodeId = `knowledge_source:${selectedCard.id}:${index}`;
    pushEntity({
      id: sourceNodeId,
      rawId: source,
      label: summarizeMemoryGraphLabel(source, "Knowledge Source"),
      type: "Knowledge Source",
      source: "know",
      scope: "agent",
      originSource: "know",
    });
    pushRelationship({
      id: `rel:knowledge_source:${selectedCard.id}:${index}`,
      from: sourceNodeId,
      to: agentNodeId,
      type: "grounds_context",
      source: "know",
      scope: "agent",
      evidence_snippet: "Configured knowledge source available to this card.",
    });
  });

  document.edges.forEach((edge) => {
    const edgeType = normalizeDeckEdgeType(edge.edgeType);
    const sourceNode = nodeMap.get(edge.source) || null;
    const targetNode = nodeMap.get(edge.target) || null;

    if (
      edge.target === selectedCard.id &&
      sourceNode &&
      (edgeType === "flow" || edgeType === "magentic_option")
    ) {
      const sourceEntityId = `upstream:${sourceNode.id}`;
      pushEntity({
        id: sourceEntityId,
        rawId: sourceNode.id,
        label: safeText(sourceNode.title || sourceNode.id),
        type: sourceNode.runtimeType === "magentic_one" ? "Orchestrator" : "Upstream Agent",
        source: edgeType === "magentic_option" ? "mixed" : "think",
        scope: "project",
      });
      pushRelationship({
        id: `rel:upstream:${edge.id}`,
        from: sourceEntityId,
        to: agentNodeId,
        type: edgeType === "magentic_option" ? "routes_input" : "feeds_input",
        source: edgeType === "magentic_option" ? "mixed" : "think",
        scope: "project",
        evidence_snippet:
          edgeType === "magentic_option"
            ? "Visible orchestrator route into this card."
            : "Visible upstream graph input into this card.",
      });
    }

    if (
      edge.source === selectedCard.id &&
      targetNode &&
      (edgeType === "flow" || edgeType === "magentic_option")
    ) {
      const targetEntityId = `downstream:${targetNode.id}`;
      pushEntity({
        id: targetEntityId,
        rawId: targetNode.id,
        label: safeText(targetNode.title || targetNode.id),
        type: targetNode.runtimeType === "magentic_one" ? "Orchestrator" : "Downstream Agent",
        source: edgeType === "magentic_option" ? "mixed" : "think",
        scope: "project",
      });
      pushRelationship({
        id: `rel:downstream:${edge.id}`,
        from: agentNodeId,
        to: targetEntityId,
        type: edgeType === "magentic_option" ? "routes_output" : "feeds_output",
        source: edgeType === "magentic_option" ? "mixed" : "think",
        scope: "project",
        evidence_snippet:
          edgeType === "magentic_option"
            ? "This card exposes a callable route into the downstream graph."
            : "Visible downstream graph consumer of this card output.",
      });
    }
  });

  return {
    entities: Array.from(entityMap.values()),
    relationships: Array.from(relationshipMap.values()),
  };
}

function isTopLevelCanvasCard(
  node: AgentCardInstance | null | undefined,
): node is AgentCardInstance {
  return Boolean(node && !cleanOptionalText(node.parentGraphId));
}

function isAssistCanvasCard(
  node: AgentCardInstance | null | undefined,
): node is AgentCardInstance {
  return Boolean(
    node &&
      normalizeRuntimeType(node.runtimeType) === "assistant_agent",
  );
}

function isVisibleAssistFlowPair(
  sourceNode: AgentCardInstance | null | undefined,
  targetNode: AgentCardInstance | null | undefined,
): boolean {
  if (!isAssistCanvasCard(sourceNode) || !isAssistCanvasCard(targetNode)) return false;

  const sourceGraphId = cleanOptionalText(sourceNode.parentGraphId);
  const targetGraphId = cleanOptionalText(targetNode.parentGraphId);

  if (!sourceGraphId && !targetGraphId) {
    return true;
  }

  return Boolean(sourceGraphId && sourceGraphId === targetGraphId);
}

function collectVisibleAssistFlowIds(
  document: DeckDocument,
  startNodeId: string,
): Set<string> {
  const nodeMap = new Map(document.nodes.map((node) => [node.id, node] as const));
  const visited = new Set<string>();
  const queue = [startNodeId];

  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId || visited.has(nodeId)) continue;
    visited.add(nodeId);

    document.edges.forEach((edge) => {
      if (normalizeDeckEdgeType(edge.edgeType) !== "flow") return;
      const sourceNode = nodeMap.get(edge.source);
      const targetNode = nodeMap.get(edge.target);
      if (!isVisibleAssistFlowPair(sourceNode, targetNode)) return;

      if (edge.source === nodeId && !visited.has(edge.target)) {
        queue.push(edge.target);
      }
      if (edge.target === nodeId && !visited.has(edge.source)) {
        queue.push(edge.source);
      }
    });
  }

  return visited;
}

function collectGraphScopedNodeIds(
  document: DeckDocument,
  graphOwnerId: string,
): Set<string> {
  const scopedNodeIds = new Set<string>([graphOwnerId]);
  document.nodes.forEach((node) => {
    if (cleanOptionalText(node.parentGraphId) === graphOwnerId) {
      scopedNodeIds.add(node.id);
    }
  });
  return scopedNodeIds;
}

function buildSingleCardRunNodeScope(
  document: DeckDocument,
  selectedNode: AgentCardInstance,
): Set<string> {
  const nodeMap = new Map(document.nodes.map((node) => [node.id, node] as const));
  const relatedNodeIds = new Set<string>();
  const selectedNodeId = selectedNode.id;
  const selectedRuntimeType = normalizeRuntimeType(selectedNode.runtimeType);
  const selectedParentGraphId = cleanOptionalText(selectedNode.parentGraphId);

  if (selectedParentGraphId) {
    return collectGraphScopedNodeIds(document, selectedParentGraphId);
  }

  if (selectedRuntimeType === "magentic_one" && isTopLevelCanvasCard(selectedNode)) {
    relatedNodeIds.add(selectedNodeId);

    document.edges.forEach((edge) => {
      if (
        edge.source !== selectedNodeId ||
        normalizeDeckEdgeType(edge.edgeType) !== "magentic_option"
      ) {
        return;
      }

      const targetNode = nodeMap.get(edge.target);
      if (!targetNode) return;

      const targetRuntimeType = normalizeRuntimeType(targetNode.runtimeType);
      if (targetRuntimeType === "graph_flow" && isTopLevelCanvasCard(targetNode)) {
        collectGraphScopedNodeIds(document, targetNode.id).forEach((nodeId) => {
          relatedNodeIds.add(nodeId);
        });
        return;
      }

      collectVisibleAssistFlowIds(document, targetNode.id).forEach((nodeId) => {
        relatedNodeIds.add(nodeId);
      });
    });

    return relatedNodeIds;
  }

  if (selectedRuntimeType === "graph_flow" && isTopLevelCanvasCard(selectedNode)) {
    return collectGraphScopedNodeIds(document, selectedNodeId);
  }

  if (isAssistCanvasCard(selectedNode) && isTopLevelCanvasCard(selectedNode)) {
    return collectVisibleAssistFlowIds(document, selectedNodeId);
  }

  relatedNodeIds.add(selectedNodeId);
  return relatedNodeIds;
}

export function buildSingleCardRunDocument(
  document: DeckDocument,
  cardId: string,
): DeckDocument | null {
  const selectedNode = document.nodes.find((node) => node.id === cardId);
  if (!selectedNode) return null;
  const relatedNodeIds = buildSingleCardRunNodeScope(document, selectedNode);

  return {
    ...document,
    nodes: document.nodes.filter((node) => relatedNodeIds.has(node.id)),
    edges: document.edges.filter(
      (edge) => relatedNodeIds.has(edge.source) && relatedNodeIds.has(edge.target),
    ),
  };
}

const uid = () => Math.random().toString(36).slice(2, 8);
const V2_PROJECTS_API = "/api/v2/projects";
const V3_PROJECTS_API = "/api/v3/projects";
const EMPTY_PROJECT_STATE = {
  messages: [] as { role: "assistant" | "user"; text: string }[],
  plan: [] as PlanItem[],
  links: [] as LinkRef[],
};

const KG_CACHE_PREFIX = "agentbuilder:kg-cache:v1";
const KG_CACHE_TTL_MS = 60_000;

type KNode = {
  id: string;
  rawId?: string;
  label: string;
  type?: string;
  graphSource?: "think" | "know";
  scope?: KnowledgeGraphScope;
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
  scope?: KnowledgeGraphScope;
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

function buildSeedPromptTemplate(parts: {
  role: string;
  goal: string;
  constraints: string;
  ioSchema: string;
  memoryPolicy: string;
}): string {
  return `# LIQUIDAITY_PROMPT_V1
[ROLE]
${parts.role}

[GOAL]
${parts.goal}

[CONSTRAINTS]
${parts.constraints}

[IO_SCHEMA]
${parts.ioSchema}

[MEMORY_POLICY]
${parts.memoryPolicy}`;
}

const INITIAL_PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: "prompt_magentic",
    content: buildSeedPromptTemplate({
      role: [
        "You are Magentic-One, the lead orchestrator for the visible agent graph.",
        "You are part of the visible team, not a hidden side system.",
      ].join("\n"),
      goal: [
        "Understand the user goal, make a short working plan for the current task, and decide whether to answer directly or delegate.",
        "Track whether progress is being made, and revise the next step if progress stalls.",
      ].join("\n"),
      constraints: [
        "The visible canvas is your full action space.",
        "You may only delegate through visible outgoing magentic_option connections from this card.",
        "Only visibly connected outgoing magentic_option paths are callable.",
        "If the task can be answered directly without delegation, do so.",
        "If delegation is needed, choose exactly one connected node for the next assignment and explain why that node is the best next move.",
        "Do not invent agents, tools, routes, subprocesses, hidden plans, or capabilities that are not present on the canvas.",
        "Do not create workflow steps that are not represented by the visible graph structure.",
        "If no connected node can validly help, stop and return control to the human.",
      ].join("\n"),
      ioSchema: [
        "Input: user request plus visible callable node summaries and any completed results from this run.",
        "Output: either a direct answer or one selected connected node for the next assignment.",
        "Use the plan stream to report short plain-text updates in this shape:",
        "Goal: ...",
        "Next: calling [Node Title] because ...",
        "Progress: ...",
        "Result: ...",
        "Waiting: more work, human input, or done.",
      ].join("\n"),
      memoryPolicy: [
        "Use only the current request, the visible callable node list, completed results from this run, and explicit deck context.",
        "Keep the working plan short, update it after each result, and re-plan if progress stalls.",
      ].join("\n"),
    }),
  },
  {
    id: "prompt_main_chat",
    content: buildSeedPromptTemplate({
      role: "You are LiquidAIty main chat. You help the user move the project forward with direct, practical answers.",
      goal: "Understand the request, answer clearly, and suggest the next useful move when it helps.",
      constraints: "Do not invent features or hidden state. If context is missing, say so plainly. Do not expose runtime plumbing unless asked.",
      ioSchema: "Input: user message plus current card context. Output: normal conversational text.",
      memoryPolicy: "Use only the current input and any explicit deck context passed into this card.",
    }),
  },
  {
    id: "prompt_kg_ingest",
    content: buildSeedPromptTemplate({
      role: "You act as the KG ingest / ThinkGraph extraction stage.",
      goal: "Turn the current input into candidate entities, relationships, facts, and explicit gaps worth researching.",
      constraints: "Stay close to the source. Separate grounded facts from hypotheses. Keep the structure concise and useful downstream.",
      ioSchema: "Input: user or upstream card input. Output: compact graph-style findings and gaps.",
      memoryPolicy: "Use only the current input passed into this card.",
    }),
  },
  {
    id: "prompt_research",
    content: buildSeedPromptTemplate({
      role: "You are the research agent for the current deck.",
      goal: "Investigate the current gaps, find useful evidence, and return concrete findings with uncertainty called out.",
      constraints: "Stay concise. Prefer primary evidence. Flag uncertainty clearly.",
      ioSchema: "Input: task brief. Output: bullet list of findings and gaps.",
      memoryPolicy: "Use upstream deck context and the current run input only.",
    }),
  },
  {
    id: "prompt_knowgraph",
    content: buildSeedPromptTemplate({
      role: "You are the grounded knowledge normalization stage.",
      goal: "Take researched findings and rewrite them into stable, evidence-backed knowledge that is safe to carry forward.",
      constraints: "Prefer grounded claims. Remove unsupported leaps. Preserve citations or evidence cues when present.",
      ioSchema: "Input: research findings. Output: normalized grounded knowledge summary.",
      memoryPolicy: "Use upstream research output only.",
    }),
  },
  {
    id: "prompt_neo4j",
    content: buildSeedPromptTemplate({
      role: "You represent the graph persistence / relationship-shaping layer.",
      goal: "Prepare graph-ready relationships and persistence notes from grounded knowledge.",
      constraints: "Stay structured. Prefer explicit entities and relationship language. Do not invent graph facts.",
      ioSchema: "Input: grounded knowledge. Output: graph-write oriented summary and relationship candidates.",
      memoryPolicy: "Use upstream grounded knowledge only.",
    }),
  },
];

const INITIAL_AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: "template_magentic",
    name: "Magentic-One",
    promptTemplate: "prompt_magentic",
    model: "gpt-5-mini",
    provider: "openai",
    temperature: 0.2,
    maxTokens: 1200,
    tools: [],
  },
  {
    id: "template_main_chat",
    name: "Main Chat",
    promptTemplate: "prompt_main_chat",
    model: "gpt-5-mini",
    provider: "openai",
    temperature: 0.5,
    maxTokens: 1600,
    tools: ["response_formatter"],
  },
  {
    id: "template_kg_ingest",
    name: "KG Ingest / ThinkGraph",
    promptTemplate: "prompt_kg_ingest",
    model: "gpt-5-mini",
    provider: "openai",
    temperature: 0.2,
    maxTokens: 1400,
    tools: ["entity_extractor"],
  },
  {
    id: "template_research",
    name: "Research Agent",
    promptTemplate: "prompt_research",
    model: "gpt-5-mini",
    provider: "openai",
    temperature: 0.2,
    maxTokens: 1400,
    tools: ["web_search"],
  },
  {
    id: "template_knowgraph",
    name: "KnowGraph",
    promptTemplate: "prompt_knowgraph",
    model: "gpt-5-mini",
    provider: "openai",
    temperature: 0.2,
    maxTokens: 1400,
    tools: ["knowledge_ingest"],
  },
  {
    id: "template_neo4j",
    name: "Neo4j",
    promptTemplate: "prompt_neo4j",
    model: "gpt-5-mini",
    provider: "openai",
    temperature: 0.1,
    maxTokens: 1200,
    tools: ["graph_write"],
  },
];

export const INITIAL_DECK: DeckDocument = {
  id: "deck_builder",
  name: "Agent Card Deck",
  promptTemplates: cloneDeckDocument(INITIAL_PROMPT_TEMPLATES),
  version: 2,
  nodes: [
    {
      id: "card_magentic",
      kind: "agent",
      templateId: "template_magentic",
      prompt: INITIAL_PROMPT_TEMPLATES.find((template) => template.id === "prompt_magentic")?.content || "",
      runtimeBinding: null,
      runtimeType: "magentic_one",
      parentGraphId: null,
      title: "Magentic-One",
      subtitle: "Top-level orchestrator",
      position: { x: -220, y: -120 },
      status: "ready",
      cloneConfig: { enabled: false, seeds: [] },
    },
    {
      id: "card_main_chat",
      kind: "agent",
      templateId: "template_main_chat",
      prompt: INITIAL_PROMPT_TEMPLATES.find((template) => template.id === "prompt_main_chat")?.content || "",
      runtimeBinding: "main_chat",
      runtimeType: "assistant_agent",
      parentGraphId: null,
      title: "Main Chat",
      subtitle: "User-facing control response",
      position: { x: -220, y: 170 },
      status: "ready",
      cloneConfig: { enabled: false, seeds: [] },
    },
    {
      id: "card_kg_ingest",
      kind: "agent",
      templateId: "template_kg_ingest",
      prompt: INITIAL_PROMPT_TEMPLATES.find((template) => template.id === "prompt_kg_ingest")?.content || "",
      runtimeBinding: "kg_ingest",
      runtimeType: "assistant_agent",
      parentGraphId: null,
      title: "ThinkGraph",
      subtitle: "Extract entities, relations, and gaps",
      position: { x: 80, y: 40 },
      status: "ready",
      cloneConfig: { enabled: false, seeds: [] },
    },
    {
      id: "card_research",
      kind: "agent",
      templateId: "template_research",
      prompt: INITIAL_PROMPT_TEMPLATES.find((template) => template.id === "prompt_research")?.content || "",
      runtimeBinding: "research_agent",
      runtimeType: "assistant_agent",
      parentGraphId: null,
      title: "Research Agent",
      subtitle: "Investigate gaps and sources",
      position: { x: 380, y: 40 },
      status: "ready",
      cloneConfig: { enabled: false, seeds: [] },
    },
    {
      id: "card_knowgraph",
      kind: "agent",
      templateId: "template_knowgraph",
      prompt: INITIAL_PROMPT_TEMPLATES.find((template) => template.id === "prompt_knowgraph")?.content || "",
      runtimeBinding: "knowgraph",
      runtimeType: "assistant_agent",
      parentGraphId: null,
      title: "KnowGraph",
      subtitle: "Ground and normalize evidence",
      position: { x: 680, y: 40 },
      status: "ready",
      cloneConfig: { enabled: false, seeds: [] },
    },
    {
      id: "card_neo4j",
      kind: "agent",
      templateId: "template_neo4j",
      prompt: INITIAL_PROMPT_TEMPLATES.find((template) => template.id === "prompt_neo4j")?.content || "",
      runtimeBinding: "neo4j",
      runtimeType: "assistant_agent",
      parentGraphId: null,
      title: "Neo4j",
      subtitle: "Graph persistence and relationship pass",
      position: { x: 980, y: 40 },
      status: "ready",
      cloneConfig: { enabled: false, seeds: [] },
    },
  ],
  edges: [
    {
      id: "edge_magentic_main_chat",
      source: "card_magentic",
      target: "card_main_chat",
      edgeType: "magentic_option",
    },
    {
      id: "edge_main_chat_kg_ingest",
      source: "card_main_chat",
      target: "card_kg_ingest",
      edgeType: "flow",
    },
    {
      id: "edge_kg_ingest_research",
      source: "card_kg_ingest",
      target: "card_research",
      edgeType: "flow",
    },
    {
      id: "edge_research_knowgraph",
      source: "card_research",
      target: "card_knowgraph",
      edgeType: "flow",
    },
    {
      id: "edge_knowgraph_neo4j",
      source: "card_knowgraph",
      target: "card_neo4j",
      edgeType: "flow",
    },
  ],
};

const BUILDER_DECK_ID = INITIAL_DECK.id;
const SYSTEM_CARD_RUNTIME_BINDINGS: Record<string, RuntimeBinding> = {
  card_main_chat: "main_chat",
  card_kg_ingest: "kg_ingest",
  card_research: "research_agent",
  card_knowgraph: "knowgraph",
  card_neo4j: "neo4j",
};
function cloneDeckDocument<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeRuntimeBinding(value: unknown): RuntimeBinding | null {
  const normalized = safeText(value).trim().toLowerCase();
  if (normalized === "main_chat") return "main_chat";
  if (normalized === "kg_ingest") return "kg_ingest";
  if (normalized === "research_agent") return "research_agent";
  if (normalized === "knowgraph") return "knowgraph";
  if (normalized === "neo4j") return "neo4j";
  return null;
}

export function filterAuthoringCompatibleEdges(
  nodes: AgentCardInstance[],
  edges: DeckEdge[],
): DeckEdge[] {
  const nodeMap = new Map(nodes.map((node) => [node.id, node] as const));

  return edges
    .filter((edge) => {
      const sourceNode = nodeMap.get(edge.source);
      const targetNode = nodeMap.get(edge.target);
      if (!sourceNode || !targetNode) return false;

      const edgeType = normalizeDeckEdgeType(edge.edgeType);
      if (edgeType === "magentic_option") {
        return (
          normalizeRuntimeType(sourceNode.runtimeType) === "magentic_one" &&
          isTopLevelCanvasCard(sourceNode) &&
          isTopLevelCanvasCard(targetNode) &&
          ["assistant_agent", "graph_flow"].includes(
            normalizeRuntimeType(targetNode.runtimeType) || "",
          )
        );
      }

      if (
        normalizeRuntimeType(sourceNode.runtimeType) === "graph_flow" &&
        cleanOptionalText(targetNode.parentGraphId) === sourceNode.id
      ) {
        return true;
      }

      return isVisibleAssistFlowPair(sourceNode, targetNode);
    })
    .map((edge) => cloneDeckDocument(edge));
}

function normalizeDeckNodes(value: unknown): AgentCardInstance[] {
  if (!Array.isArray(value)) {
    return cloneDeckDocument(INITIAL_DECK.nodes);
  }
  if (value.length === 0) {
    return [];
  }
  const nextNodes = value.filter(
    (node): node is AgentCardInstance =>
      Boolean(
        node &&
          typeof node === "object" &&
          safeText((node as Partial<AgentCardInstance>).kind).trim().toLowerCase() !== "blackboard" &&
          typeof (node as AgentCardInstance).id === "string" &&
          typeof (node as AgentCardInstance).templateId === "string",
      ),
  );
  return nextNodes.length > 0
    ? nextNodes.map((node) => ({
        id: safeText(node.id).trim(),
        kind: "agent",
        templateId: safeText(node.templateId).trim(),
        prompt: typeof node.prompt === "string" ? node.prompt : "",
        runtimeBinding: normalizeRuntimeBinding(
          node.runtimeBinding ?? SYSTEM_CARD_RUNTIME_BINDINGS[safeText(node.id).trim()] ?? null,
        ),
        runtimeType: normalizeRuntimeType(node.runtimeType) ?? "assistant_agent",
        runtimeOptions: normalizeRuntimeOptions(node.runtimeOptions),
        parentGraphId: cleanOptionalText(node.parentGraphId),
        title: safeText(node.title || node.id).trim() || safeText(node.id).trim(),
        subtitle: typeof node.subtitle === "string" ? node.subtitle : undefined,
        position:
          node.position && typeof node.position === "object"
            ? {
                x: Number((node.position as { x?: unknown }).x) || 0,
                y: Number((node.position as { y?: unknown }).y) || 0,
              }
            : { x: 0, y: 0 },
        overrides: node.overrides,
        status:
          node.status === "idle" ||
          node.status === "ready" ||
          node.status === "running" ||
          node.status === "error"
            ? node.status
            : undefined,
        cloneConfig:
          node.cloneConfig && typeof node.cloneConfig === "object"
            ? node.cloneConfig
            : undefined,
      }))
    : [];
}

function normalizeDeckPromptTemplates(value: unknown): PromptTemplate[] {
  if (!Array.isArray(value)) {
    return cloneDeckDocument(INITIAL_PROMPT_TEMPLATES);
  }
  if (value.length === 0) {
    return [];
  }
  const nextPromptTemplates = value.filter(
    (template): template is PromptTemplate =>
      Boolean(
        template &&
          typeof template === "object" &&
          typeof (template as PromptTemplate).id === "string" &&
          typeof (template as PromptTemplate).content === "string",
      ),
  );
  return nextPromptTemplates.length > 0
    ? cloneDeckDocument(nextPromptTemplates)
    : cloneDeckDocument(INITIAL_PROMPT_TEMPLATES);
}

function normalizeDeckEdges(value: unknown): DeckEdge[] {
  if (!Array.isArray(value)) {
    return cloneDeckDocument(INITIAL_DECK.edges);
  }
  return cloneDeckDocument(sanitizeDeckEdges(value));
}

function slugifyDeckIdPart(value: string): string {
  return safeText(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "card";
}

function buildDeckNodeFromPreset(
  preset: DeckNodePreset,
  promptTemplates: PromptTemplate[],
  position: { x: number; y: number },
  options: {
    title?: string;
    parentGraphId?: string | null;
  } = {},
): AgentCardInstance {
  const promptTemplateContent =
    preset.promptTemplateId
      ? promptTemplates.find((template) => template.id === preset.promptTemplateId)?.content ||
        INITIAL_PROMPT_TEMPLATES.find((template) => template.id === preset.promptTemplateId)?.content ||
        ""
      : "";
  const slug = slugifyDeckIdPart(preset.key);

  return {
    id:
      `card_${slug}_${uid()}`,
    kind: "agent",
    templateId: preset.templateId,
    prompt: promptTemplateContent,
    runtimeBinding: preset.runtimeBinding,
    runtimeType: preset.runtimeType,
    runtimeOptions: null,
    parentGraphId: cleanOptionalText(options.parentGraphId),
    title: options.title || preset.title,
    subtitle: preset.subtitle,
    position,
    status: "ready",
    cloneConfig: { enabled: false, seeds: [] },
  };
}

function getNextGraphScopedAssistTitle(deck: DeckDocument, graphOwnerId: string): string {
  const assistCount = deck.nodes.filter(
    (node) =>
      cleanOptionalText(node.parentGraphId) === graphOwnerId &&
      normalizeRuntimeType(node.runtimeType) === "assistant_agent",
  ).length;
  return `Assist ${assistCount + 1}`;
}

function resolveQuickAddParentGraphId(
  preset: DeckNodePreset,
  anchorNode: AgentCardInstance | null,
): string | null {
  if (preset.runtimeType !== "assistant_agent" || !anchorNode) {
    return null;
  }

  const anchorParentGraphId = cleanOptionalText(anchorNode.parentGraphId);
  if (anchorParentGraphId) {
    return anchorParentGraphId;
  }

  if (
    normalizeRuntimeType(anchorNode.runtimeType) === "graph_flow" &&
    isTopLevelCanvasCard(anchorNode)
  ) {
    return anchorNode.id;
  }

  return null;
}

function resolveQuickAddEdge(
  anchorNode: AgentCardInstance | null,
  nextNode: AgentCardInstance,
): DeckEdge | null {
  if (!anchorNode) return null;

  const anchorRuntimeType = normalizeRuntimeType(anchorNode.runtimeType);
  const nextRuntimeType = normalizeRuntimeType(nextNode.runtimeType);
  let edgeType: DeckEdgeType | null = null;

  if (
    anchorRuntimeType === "magentic_one" &&
    isTopLevelCanvasCard(anchorNode) &&
    isTopLevelCanvasCard(nextNode) &&
    (nextRuntimeType === "assistant_agent" || nextRuntimeType === "graph_flow")
  ) {
    edgeType = "magentic_option";
  } else if (isVisibleAssistFlowPair(anchorNode, nextNode)) {
    edgeType = "flow";
  }

  if (!edgeType) return null;

  const legacyCompatibility = Boolean(
    anchorRuntimeType === "graph_flow" ||
    nextRuntimeType === "graph_flow" ||
    cleanOptionalText(anchorNode.parentGraphId) ||
    cleanOptionalText(nextNode.parentGraphId),
  );

  return {
    id: `edge_${slugifyDeckIdPart(anchorNode.id)}_${slugifyDeckIdPart(nextNode.id)}_${uid()}`,
    source: anchorNode.id,
    target: nextNode.id,
    edgeType,
    metadata: buildDefaultDeckEdgeMetadata(edgeType, { legacyCompatibility }),
  };
}

function getSuggestedDeckNodePosition(
  deck: DeckDocument,
  preset: DeckNodePreset,
  anchorNode: AgentCardInstance | null,
): { x: number; y: number } {
  if (anchorNode) {
    const outgoingCount = deck.edges.filter((edge) => edge.source === anchorNode.id).length;
    return {
      x: anchorNode.position.x + 320,
      y: anchorNode.position.y + outgoingCount * 180,
    };
  }

  const rightMostX = deck.nodes.reduce((max, node) => Math.max(max, node.position.x), -220);
  const nextColumnX = rightMostX + 320;
  const occupiedInNextColumn = deck.nodes.filter((node) => Math.abs(node.position.x - nextColumnX) < 72).length;
  return {
    x: nextColumnX,
    y: 40 + occupiedInNextColumn * 180,
  };
}

export function buildQuickAddDeckMutation(
  deck: DeckDocument,
  preset: DeckNodePreset,
  anchorNodeId: string | null,
): { nextDeck: DeckDocument; nextNode: AgentCardInstance; nextEdge: DeckEdge | null } {
  const anchorNode = deck.nodes.find((node) => node.id === anchorNodeId) || null;
  const nextParentGraphId = resolveQuickAddParentGraphId(preset, anchorNode);
  const nextTitle =
    nextParentGraphId && preset.runtimeType === "assistant_agent"
      ? getNextGraphScopedAssistTitle(deck, nextParentGraphId)
      : preset.title;
  const nextNode = buildDeckNodeFromPreset(
    preset,
    deck.promptTemplates,
    getSuggestedDeckNodePosition(deck, preset, anchorNode),
    {
      title: nextTitle,
      parentGraphId: nextParentGraphId,
    },
  );
  const nextEdge = resolveQuickAddEdge(anchorNode, nextNode);

  return {
    nextDeck: {
      ...deck,
      version: deck.version + 1,
      nodes: [...deck.nodes, nextNode],
      edges: nextEdge ? [...deck.edges, nextEdge] : [...deck.edges],
    },
    nextNode,
    nextEdge,
  };
}

export type AssistStarterDeckMutation = {
  nextDeck: DeckDocument;
  createdNodes: AgentCardInstance[];
  createdEdges: DeckEdge[];
  focusNodeId: string | null;
  recipe: AssistStarterRecipe;
};

export function buildAssistStarterDeckMutation(
  deck: DeckDocument,
  anchorNodeId: string | null,
): AssistStarterDeckMutation | null {
  const anchorNode = deck.nodes.find((node) => node.id === anchorNodeId) || null;
  const recipe = getAssistStarterRecipe(anchorNode);
  if (!recipe) return null;

  let workingDeck = deck;
  let workingAnchorId = anchorNodeId;
  const createdNodes: AgentCardInstance[] = [];
  const createdEdges: DeckEdge[] = [];

  recipe.presetKeys.forEach((presetKey) => {
    const preset = findDeckNodePreset(presetKey);
    if (!preset) return;

    const mutation = buildQuickAddDeckMutation(workingDeck, preset, workingAnchorId);
    workingDeck = mutation.nextDeck;
    workingAnchorId = mutation.nextNode.id;
    createdNodes.push(mutation.nextNode);
    if (mutation.nextEdge) {
      createdEdges.push(mutation.nextEdge);
    }
  });

  return {
    nextDeck: workingDeck,
    createdNodes,
    createdEdges,
    focusNodeId: createdNodes[recipe.focusNodeIndex]?.id || createdNodes[0]?.id || null,
    recipe,
  };
}

function formatBuilderStatusMessage(message: unknown, fallback: string): string {
  const text = String(message || "").trim();
  const lower = text.toLowerCase();
  if (!text) return fallback;
  if (text === "project_not_found") return "Canvas data is unavailable for this selection.";
  if (text === "deck_load_failed") return "Canvas data could not be loaded.";
  if (text === "deck_save_failed") return "Could not save the current board.";
  if (text === "card_run_failed") return "Card run failed.";
  if (text === "deck_run_failed") return "Board run failed.";
  if (text === "template_not_found") return "The selected card template could not be resolved.";
  if (text === "templates_required") return "The selected card could not be run because its template set was missing.";
  if (text === "card_required") return "No card was provided to the backend run path.";
  if (
    lower.includes("insufficient_quota") ||
    lower.includes("quota exceeded") ||
    (lower.includes("quota") && lower.includes("billing"))
  ) {
    return "The configured model could not run because provider quota or billing is unavailable right now.";
  }
  if (lower.includes("rate limit") || lower.includes("too many requests")) {
    return "The configured model is rate-limited right now. Try this card again shortly.";
  }
  if (
    lower.includes("unauthorized") ||
    lower.includes("authentication") ||
    lower.includes("invalid api key") ||
    lower.includes("incorrect api key")
  ) {
    return "The configured model request was rejected by the provider. Check the backend credentials for this card.";
  }
  if (
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("econnrefused") ||
    lower.includes("load failed")
  ) {
    return "The Builder backend is unavailable right now.";
  }
  if (lower.includes("timed out") || lower.includes("timeout")) {
    return "The configured model timed out before the card completed.";
  }
  return text;
}

function seedCurrentSystemCardsIntoLegacyDeck(deck: DeckDocument): DeckDocument {
  const defaultNodeIds = new Set(INITIAL_DECK.nodes.map((node) => node.id));
  const hasOnlySystemNodes =
    deck.nodes.length > 0 &&
    deck.nodes.every((node) => defaultNodeIds.has(node.id));
  const isExactSystemDeckShape =
    hasOnlySystemNodes && deck.nodes.length === defaultNodeIds.size;
  const isPartialSystemDeckShape =
    hasOnlySystemNodes && deck.nodes.length < defaultNodeIds.size;

  if (!isExactSystemDeckShape && !isPartialSystemDeckShape) {
    return deck;
  }

  const existingNodesById = new Map(deck.nodes.map((node) => [node.id, node] as const));
  const existingPromptTemplatesById = new Map(
    deck.promptTemplates.map((template) => [template.id, template] as const),
  );
  const initialPromptTemplateIds = new Set(INITIAL_PROMPT_TEMPLATES.map((template) => template.id));
  const upgradedNodes: AgentCardInstance[] = INITIAL_DECK.nodes.map((seedNode): AgentCardInstance => {
    const existingNode = existingNodesById.get(seedNode.id);
    if (!existingNode) {
      return cloneDeckDocument(seedNode);
    }

    const nextTitle =
      seedNode.id === "card_research" && String(existingNode.title || "").trim() === "Research"
        ? seedNode.title
        : existingNode.title || seedNode.title;
  const nextSubtitle =
      seedNode.id === "card_research" &&
      String(existingNode.subtitle || "").trim() === "Gather upstream inputs"
        ? seedNode.subtitle
        : existingNode.subtitle || seedNode.subtitle;
    return {
      ...cloneDeckDocument(seedNode),
      ...cloneDeckDocument(existingNode),
      kind: "agent",
      prompt:
        typeof (existingNode as any).prompt === "string"
          ? (existingNode as any).prompt
          : seedNode.prompt || "",
      title: nextTitle,
      subtitle: nextSubtitle,
      runtimeBinding: normalizeRuntimeBinding(
        existingNode.runtimeBinding ?? seedNode.runtimeBinding ?? null,
      ),
      runtimeType: normalizeRuntimeType(
        existingNode.runtimeType ?? seedNode.runtimeType ?? "assistant_agent",
      ),
      runtimeOptions: normalizeRuntimeOptions(
        existingNode.runtimeOptions ?? seedNode.runtimeOptions ?? null,
      ),
      parentGraphId: cleanOptionalText(
        existingNode.parentGraphId ?? seedNode.parentGraphId ?? null,
      ),
      position: existingNode.position || seedNode.position,
      overrides: existingNode.overrides,
      status: existingNode.status ?? seedNode.status,
      cloneConfig: existingNode.cloneConfig ?? seedNode.cloneConfig,
    };
  });

  const upgradedPromptTemplates = [
    ...INITIAL_PROMPT_TEMPLATES.map((seedTemplate) =>
      cloneDeckDocument(existingPromptTemplatesById.get(seedTemplate.id) || seedTemplate),
    ),
    ...deck.promptTemplates
      .filter((template) => !initialPromptTemplateIds.has(template.id))
      .map((template) => cloneDeckDocument(template)),
  ];

  const nextEdges = isPartialSystemDeckShape
    ? (() => {
        const mergedEdges = new Map<string, DeckEdge>();
        deck.edges.forEach((edge) => {
          mergedEdges.set(edge.id, cloneDeckDocument(edge));
        });
        INITIAL_DECK.edges.forEach((edge) => {
          if (!mergedEdges.has(edge.id)) {
            mergedEdges.set(edge.id, cloneDeckDocument(edge));
          }
        });
        return filterAuthoringCompatibleEdges(upgradedNodes, Array.from(mergedEdges.values()));
      })()
    : filterAuthoringCompatibleEdges(upgradedNodes, deck.edges);

  return {
    ...deck,
    version: Math.max(deck.version, INITIAL_DECK.version),
    promptTemplates: upgradedPromptTemplates,
    nodes: upgradedNodes,
    edges: nextEdges,
  };
}

export function hydrateDeckDocument(value: Partial<DeckDocument> | null | undefined): DeckDocument {
  if (!value || typeof value !== "object") {
    return cloneDeckDocument(INITIAL_DECK);
  }
  const hasExplicitNodes = Array.isArray(value.nodes);
  const nextEdges =
    Array.isArray(value.edges)
      ? normalizeDeckEdges(value.edges)
      : hasExplicitNodes
        ? []
        : normalizeDeckEdges(value.edges);
  const hydratedDeck = seedCurrentSystemCardsIntoLegacyDeck({
    ...cloneDeckDocument(INITIAL_DECK),
    ...value,
    id: String(value.id || INITIAL_DECK.id).trim() || INITIAL_DECK.id,
    name: String(value.name || INITIAL_DECK.name).trim() || INITIAL_DECK.name,
    version: Number.isFinite(Number(value.version)) ? Number(value.version) : INITIAL_DECK.version,
    nodes: normalizeDeckNodes(value.nodes),
    edges: nextEdges,
    promptTemplates: normalizeDeckPromptTemplates(value.promptTemplates),
  });
  const bannedNodeIds = new Set(["card_synthesis", "card_review"]);
  const bannedPromptTemplateIds = new Set(["prompt_synthesis", "prompt_review"]);
  return {
    ...hydratedDeck,
    nodes: hydratedDeck.nodes.filter((node) => !bannedNodeIds.has(node.id)),
    edges: hydratedDeck.edges.filter(
      (edge) => !bannedNodeIds.has(edge.source) && !bannedNodeIds.has(edge.target),
    ),
    promptTemplates: hydratedDeck.promptTemplates.filter((template) =>
      !bannedPromptTemplateIds.has(template.id),
    ),
  };
}

function isTruncatedSystemDeckPayload(deckPayload: Partial<DeckDocument>): boolean {
  if (!Array.isArray(deckPayload.nodes)) {
    return false;
  }

  const canonicalNodeIds = new Set(INITIAL_DECK.nodes.map((node) => node.id));
  const nodeIds = deckPayload.nodes
    .map((node) => safeText((node as { id?: unknown } | null)?.id).trim())
    .filter(Boolean);

  if (nodeIds.length === 0) {
    return false;
  }

  return nodeIds.length < canonicalNodeIds.size && nodeIds.every((nodeId) => canonicalNodeIds.has(nodeId));
}

export function resolveProjectDeckPayload(
  deckPayload: Partial<DeckDocument> | null | undefined,
): { deck: DeckDocument; usedFallback: boolean; displayFallbackOnly: boolean } {
  if (!deckPayload || typeof deckPayload !== "object") {
    return {
      deck: hydrateDeckDocument(INITIAL_DECK),
      usedFallback: true,
      displayFallbackOnly: false,
    };
  }

  if (isTruncatedSystemDeckPayload(deckPayload)) {
    return {
      deck: hydrateDeckDocument(deckPayload),
      usedFallback: true,
      displayFallbackOnly: true,
    };
  }

  return {
    deck: hydrateDeckDocument(deckPayload),
    usedFallback: false,
    displayFallbackOnly: false,
  };
}

export function resolveProjectDeckLoadResult(
  currentDeck: DeckDocument,
  deckPayload: Partial<DeckDocument> | null | undefined,
  preserveCurrentOnFailure = false,
): {
  deck: DeckDocument;
  usedFallback: boolean;
  preservedCurrent: boolean;
  displayFallbackOnly: boolean;
} {
  if (preserveCurrentOnFailure) {
    return {
      deck: cloneDeckDocument(currentDeck),
      usedFallback: false,
      preservedCurrent: true,
      displayFallbackOnly: false,
    };
  }

  const resolved = resolveProjectDeckPayload(deckPayload);
  return {
    ...resolved,
    preservedCurrent: false,
  };
}

function resolveAgentTemplate(
  card: AgentCardInstance | null,
  templates: AgentTemplate[],
): AgentTemplate | null {
  if (!card) return null;
  return templates.find((template) => template.id === card.templateId) || null;
}

function sameStringArray(left: string[] | undefined, right: string[] | undefined): boolean {
  const a = Array.isArray(left) ? left : [];
  const b = Array.isArray(right) ? right : [];
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function sameObjectShape(
  left: Record<string, unknown> | null | undefined,
  right: Record<string, unknown> | null | undefined,
): boolean {
  return JSON.stringify(left || null) === JSON.stringify(right || null);
}

function compactAgentOverrides(
  overrides: Partial<AgentTemplate>,
): Partial<AgentTemplate> | undefined {
  const filtered = Object.fromEntries(
    Object.entries(overrides).filter(([, value]) => value !== undefined),
  ) as Partial<AgentTemplate>;
  return Object.keys(filtered).length > 0 ? filtered : undefined;
}

// helper: load all project-local state (defaults only; real data is fetched from backend)
function loadProjectState(_projectId: string) {
  return {
    messages: [...EMPTY_PROJECT_STATE.messages],
    plan: [...EMPTY_PROJECT_STATE.plan],
    links: [...EMPTY_PROJECT_STATE.links],
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

  const upsertNode = (
    idRaw: unknown,
    labelRaw: unknown,
    typeRaw: unknown,
    tsRaw: unknown,
    scopeRaw?: unknown,
  ) => {
    const id = String(idRaw ?? "").trim();
    if (!id) return;

    const label = String(labelRaw ?? "").trim() || id.slice(0, 12);
    const type = normalizeType(typeRaw);
    const scope = normalizeKnowledgeScope(scopeRaw, "project");
    const nextMs = parseTimestampMs(tsRaw);
    const nextTs = typeof nextMs === "number" ? new Date(nextMs).toISOString() : undefined;

    const existing = nodeMap.get(id);
    if (!existing) {
      nodeMap.set(id, {
        id,
        label,
        type,
        scope,
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
    existing.scope = normalizeKnowledgeScope(existing.scope, scope);
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
    const scope = normalizeKnowledgeScope(
      row.r_scope ?? row.scope ?? row.relationship_scope,
      "project",
    );
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
        scope,
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
    existing.scope = normalizeKnowledgeScope(existing.scope, scope);
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
        row.a_scope,
      );
      upsertNode(
        row.b_id,
        row.b_name,
        row.b_type ?? row.b_etype ?? row.b_category,
        row.b_ts ?? row.b_created_at,
        row.b_scope,
      );
      upsertEdge(row.a_id, row.b_id, row.r_type ?? row.rel_type, row);
      return;
    }

    if (row.a && row.b) {
      const aId = extractNodeId(row.a);
      const bId = extractNodeId(row.b);
      const aProps = row.a?.properties || row.a;
      const bProps = row.b?.properties || row.b;
      upsertNode(
        aId,
        aProps?.name ?? aProps?.label,
        aProps?.etype ?? aProps?.type,
        aProps?.created_at,
        aProps?.scope ?? row.a?.scope,
      );
      upsertNode(
        bId,
        bProps?.name ?? bProps?.label,
        bProps?.etype ?? bProps?.type,
        bProps?.created_at,
        bProps?.scope ?? row.b?.scope,
      );
      upsertEdge(aId, bId, row.r?.rtype ?? row.r?.type ?? row.rtype, {
        ...row,
        r_ts: row.r?.created_at,
        r_weight: row.r?.weight,
        r_confidence: row.r?.confidence,
        r_doc_id: row.r?.source?.doc_id,
        r_snippet: row.r?.source?.snippet,
        r_scope: row.r?.scope ?? row.r?.properties?.scope,
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
      upsertNode(source, source, "unknown", e.last_seen_ts, "project");
    }
    if (!nodeMap.has(target)) {
      upsertNode(target, target, "unknown", e.last_seen_ts, "project");
    }
  });

  const nodes = Array.from(nodeMap.values()).map((n) => ({
    ...n,
    rawId: n.id,
    graphSource: "think" as const,
    scope: normalizeKnowledgeScope(n.scope, "project"),
    degree: degreeByNode.get(n.id) || 0,
    type: normalizeType(n.type),
  }));

  return {
    nodes,
    edges: edges.map((e) => ({
      ...e,
      rawId: e.id,
      graphSource: "think" as const,
      scope: normalizeKnowledgeScope(e.scope, "project"),
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
      scope: normalizeKnowledgeScope(props.scope ?? raw?.scope, "grounded_research"),
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
      scope: normalizeKnowledgeScope(props.scope ?? raw?.scope, "grounded_research"),
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
      scope: normalizeKnowledgeScope(
        n.scope,
        n.graphSource === "know" ? "grounded_research" : "project",
      ),
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
      scope: normalizeKnowledgeScope(
        e.scope,
        e.graphSource === "know" ? "grounded_research" : "project",
      ),
      weight: e.weight,
      confidence: e.confidence,
      last_seen_ts: e.last_seen_ts,
      evidence_doc_id: e.evidence_doc_id,
      evidence_snippet: e.evidence_snippet,
    });
  });

  return { entities, relationships };
}


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

// -------- Main page --------
export default function AgentBuilder(): React.ReactElement {
  const BUILDER_DEV = import.meta.env.DEV;
  const [largeSurface, setLargeSurface] = useState<"chat" | "plan" | "canvas" | "knowledge">("chat");
  const workspaceView =
    largeSurface === "canvas" ? "canvas" : largeSurface === "knowledge" ? "knowledge" : "home";
  const {
    activeProject,
    assistProjects,
    projectsError,
    setProjectsError,
    setActiveProjectWithUrl,
    refreshProjects,
  } = useBuilderProjects({
    projectsApi: V2_PROJECTS_API,
    workspaceView,
  });
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelWidth, setPanelWidth] = useState(480);
  const canvasProjectId = cleanOptionalText(activeProject) ?? "";
  const [deck, setDeckState] = useState<DeckDocument>(() => hydrateDeckDocument(INITIAL_DECK));
  const [deckRevision, setDeckRevision] = useState<string | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedKnowledgeEntityId, setSelectedKnowledgeEntityId] = useState<string | null>(null);
  const [selectedKnowledgeRelationshipId, setSelectedKnowledgeRelationshipId] = useState<string | null>(null);
  const [builderCanvasFocusRequest, setBuilderCanvasFocusRequest] =
    useState<BuilderCanvasFocusRequest | null>(null);
  // TODO: replace manual deck input with plan-driven execution input.
  const [deckRunInput, setDeckRunInput] = useState("");
  const [latestDeckRun, setLatestDeckRun] = useState<DeckRun | null>(null);
  const [, setLatestCardRun] = useState<LatestCardRunRecord | null>(null);
  const [liveDeckEvents, setLiveDeckEvents] = useState<DeckRuntimeEvent[]>([]);
  const [deckRunBusy, setDeckRunBusy] = useState(false);
  const [cardRunBusy, setCardRunBusy] = useState(false);
  const [deckLoadBusy, setDeckLoadBusy] = useState(false);
  const [deckSaveBusy, setDeckSaveBusy] = useState(false);
  const [deckStatusMessage, setDeckStatusMessage] = useState<string | null>(null);
  const [deckUsingDisplayFallback, setDeckUsingDisplayFallback] = useState(false);

  const [tab, setTab] = useState<string>("Canvas");
  const [hoveredCompanionSurface, setHoveredCompanionSurface] =
    useState<null | "chat" | "plan" | "canvas" | "knowledge">(null);
  const [openDrawer, setOpenDrawer] = useState<null | "navigation">(null);
  const [showCreateProjectForm, setShowCreateProjectForm] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectCode, setNewProjectCode] = useState("");
  const [showAdvancedProjectFields, setShowAdvancedProjectFields] = useState(false);
  const [sending, setSending] = useState(false);
  const lastLargeSurfaceTelemetryRef = useRef<WorkspaceTestingSurface | null>(null);
  const lastCompanionSurfaceTelemetryRef = useRef<string | null>(null);
  const chatLoopTelemetryRef = useRef<{
    interactionId: string;
    sendStartedAt: number;
    responseReceivedAt: number | null;
    refreshRecorded: boolean;
  } | null>(null);
  const pendingPanelOpenTelemetryRef = useRef<{
    objectType: WorkspaceTestingObjectType;
    objectId: string;
    graphType: "agent" | "knowledge";
    interactionId: string;
    startedAt: number;
  } | null>(null);

  const emitWorkspaceTestingEvent = useCallback(
    (payload: WorkspaceTestingEventDraft) => {
      const metadata = {
        activeProjectId: activeProject || null,
        ...(payload.metadata || {}),
      };
      recordWorkspaceTestingEvent({
        ...payload,
        projectId:
          payload.projectId ??
          cleanOptionalText(activeProject) ??
          null,
        metadata,
      });
    },
    [activeProject],
  );

  const recordPostResponseRefreshIfPending = useCallback(
    (refreshKind: "workspace_state" | "agent_graph" | "knowledge_graph", completedAt: number) => {
      const activeLoop = chatLoopTelemetryRef.current;
      if (!activeLoop?.responseReceivedAt || activeLoop.refreshRecorded) return;
      activeLoop.refreshRecorded = true;
      emitWorkspaceTestingEvent({
        event: "post_response_refresh_completed",
        interactionId: activeLoop.interactionId,
        durationMs: Math.max(0, completedAt - activeLoop.responseReceivedAt),
        metadata: { refreshKind },
      });
    },
    [emitWorkspaceTestingEvent],
  );

  const queueWorkspacePanelTelemetry = useCallback(
    (
      graphType: "agent" | "knowledge",
      objectType: WorkspaceTestingObjectType,
      objectId: string,
      interactionId: string,
    ) => {
      const startedAt = Date.now();
      if (panelOpen) {
        emitWorkspaceTestingEvent({
          event: "workspace_panel_opened_from_graph_selection",
          objectType,
          objectId,
          interactionId,
          durationMs: 0,
          metadata: { graphType, panelAlreadyOpen: true },
        });
        pendingPanelOpenTelemetryRef.current = null;
        return;
      }
      pendingPanelOpenTelemetryRef.current = {
        objectType,
        objectId,
        graphType,
        interactionId,
        startedAt,
      };
    },
    [emitWorkspaceTestingEvent, panelOpen],
  );

  useEffect(() => {
    const previousSurface = lastLargeSurfaceTelemetryRef.current;
    emitWorkspaceTestingEvent({
      event: "surface_opened",
      surface: largeSurface,
      surfaceRole: "large",
      metadata: { workspaceView },
    });
    if (largeSurface === "chat" && previousSurface && previousSurface !== "chat") {
      emitWorkspaceTestingEvent({
        event: "return_to_chat",
        surface: "chat",
        surfaceRole: "large",
        metadata: { fromSurface: previousSurface },
      });
    }
    lastLargeSurfaceTelemetryRef.current = largeSurface;
  }, [emitWorkspaceTestingEvent, largeSurface, workspaceView]);

  useEffect(() => {
    if (workspaceView === "canvas") {
      lastCompanionSurfaceTelemetryRef.current = null;
      return;
    }
    const companionSurface = normalizeWorkspaceSurface(tab);
    if (!companionSurface) {
      lastCompanionSurfaceTelemetryRef.current = null;
      return;
    }
    const nextKey = `${workspaceView}:${companionSurface}`;
    if (lastCompanionSurfaceTelemetryRef.current === nextKey) return;
    emitWorkspaceTestingEvent({
      event: "surface_opened",
      surface: companionSurface,
      surfaceRole: "companion",
      metadata: { workspaceView },
    });
    lastCompanionSurfaceTelemetryRef.current = nextKey;
  }, [emitWorkspaceTestingEvent, tab, workspaceView]);

  useEffect(() => {
    const pending = pendingPanelOpenTelemetryRef.current;
    if (!panelOpen || !pending) return;
    emitWorkspaceTestingEvent({
      event: "workspace_panel_opened_from_graph_selection",
      objectType: pending.objectType,
      objectId: pending.objectId,
      interactionId: pending.interactionId,
      durationMs: Math.max(0, Date.now() - pending.startedAt),
      metadata: { graphType: pending.graphType, panelAlreadyOpen: false },
    });
    pendingPanelOpenTelemetryRef.current = null;
  }, [emitWorkspaceTestingEvent, panelOpen]);

  // agent builder state
  const deckSaveAbortRef = useRef<AbortController | null>(null);
  const deckExecutionAbortRef = useRef<AbortController | null>(null);
  const canvasSelectionInitializedRef = useRef(false);
  const activeProjectLatestRef = useRef("");
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
  const lastBuilderDeckWriteReasonRef = useRef<string | null>(null);
  const lastBuilderUiOnlyActionRef = useRef<string | null>(null);
  const lastBuilderDeckFingerprintRef = useRef<string | null>(null);

  const recordDeckWriteReason = useCallback(
    (reason: string) => {
      if (!BUILDER_DEV) return;
      lastBuilderDeckWriteReasonRef.current = reason;
      lastBuilderUiOnlyActionRef.current = null;
    },
    [BUILDER_DEV],
  );

  const recordUiOnlyAction = useCallback(
    (action: string) => {
      if (!BUILDER_DEV) return;
      lastBuilderUiOnlyActionRef.current = action;
    },
    [BUILDER_DEV],
  );

  const setDeck = useCallback<React.Dispatch<React.SetStateAction<DeckDocument>>>(
    (update) => {
      setDeckState((prev) => {
        const next =
          typeof update === "function"
            ? (update as (prevState: DeckDocument) => DeckDocument)(prev)
            : update;
        if (BUILDER_DEV) {
          const prevFingerprint = JSON.stringify(prev);
          const nextFingerprint = JSON.stringify(next);
          if (prevFingerprint === nextFingerprint) {
            console.warn("[builder] ignored deck write without persisted graph mutation", {
              reason: lastBuilderDeckWriteReasonRef.current || "unknown",
            });
          }
        }
        return next;
      });
    },
    [BUILDER_DEV],
  );

  useEffect(() => {
    canvasSelectionInitializedRef.current = false;
    if (!canvasProjectId) {
      recordDeckWriteReason("builder-reset");
      setDeck(hydrateDeckDocument(INITIAL_DECK));
      setDeckRevision(null);
      setDeckUsingDisplayFallback(false);
      setLatestDeckRun(null);
      setLatestCardRun(null);
      setLiveDeckEvents([]);
      setMessages([...EMPTY_PROJECT_STATE.messages]);
      setPlanSource([...EMPTY_PROJECT_STATE.plan]);
      setPlan([...EMPTY_PROJECT_STATE.plan]);
      setLinks([...EMPTY_PROJECT_STATE.links]);
      setStateLoaded(false);
      setDeckStatusMessage(null);
      return;
    }

    const controller = new AbortController();
    const deckRefreshStartedAt = Date.now();
    let usedDisplayFallback = false;
    setDeckLoadBusy(true);
    setStateLoaded(false);
    setDeckRevision(null);
      setDeckStatusMessage("Loading canvas...");

    void (async () => {
      try {
        const endpoint = `${V3_PROJECTS_API}/${canvasProjectId}/decks/${BUILDER_DECK_ID}`;
        const payload = await guardedRequest({
          key: `v3-deck:${canvasProjectId}:${BUILDER_DECK_ID}`,
          method: "GET",
          ttlMs: 1_000,
          signal: controller.signal,
          fetcher: async (signal) => {
            const response = await fetch(endpoint, { signal });
            const data = await safeJson(response);
            return { response, data };
          },
        });

        if (controller.signal.aborted) return;
        if (!payload.response.ok) {
          throw new Error(safeText(payload.data?.error || "deck_load_failed"));
        }

        const loadResult = resolveProjectDeckLoadResult(
          deck,
          payload.data?.deck && typeof payload.data.deck === "object"
            ? { ...(payload.data.deck as DeckDocument), id: BUILDER_DECK_ID }
            : null,
        );

        recordDeckWriteReason(loadResult.usedFallback ? "deck-load-default" : "deck-load");
        setDeck(loadResult.deck);
        setDeckRevision(
          typeof payload.data?.meta?.deckRevision === "string"
            ? payload.data.meta.deckRevision
            : null,
        );
        setDeckUsingDisplayFallback(loadResult.displayFallbackOnly);
        usedDisplayFallback = loadResult.displayFallbackOnly;
        const persistedLatestRun =
          payload.data?.latestRun && typeof payload.data.latestRun === "object"
            ? (payload.data.latestRun as DeckRun)
            : null;
        const persistedRuns = Array.isArray(payload.data?.runs)
          ? (payload.data.runs as DeckRun[])
          : [];
        const continuity = buildReloadStateFromDeckRuns(persistedRuns, persistedLatestRun);
        setLatestDeckRun(persistedLatestRun);
        setLatestCardRun(null);
        setLiveDeckEvents([]);
        setMessages(continuity.messages);
        setPlanSource(continuity.planSource);
        setPlan(continuity.plan);
        setLinks(continuity.links);
        setStateLoaded(true);
        setDeckStatusMessage(
          loadResult.displayFallbackOnly
            ? "Showing the canonical chain as a temporary fallback for a truncated saved canvas."
            : loadResult.usedFallback
              ? "Using default canvas."
              : "Canvas loaded.",
        );
      } catch (err: any) {
        if (controller.signal.aborted) return;
        recordDeckWriteReason("deck-load-default-error");
        setDeck(hydrateDeckDocument(INITIAL_DECK));
        setDeckUsingDisplayFallback(false);
        const next = loadProjectState(canvasProjectId);
        setLatestDeckRun(null);
        setLatestCardRun(null);
        setLiveDeckEvents([]);
        setDeckRevision(null);
        setMessages([...next.messages]);
        setPlanSource([...next.plan]);
        setPlan([...next.plan]);
        setLinks([...next.links]);
        setStateLoaded(true);
        setDeckStatusMessage(formatBuilderStatusMessage(err?.message, "Using default canvas."));
      } finally {
        if (!controller.signal.aborted) {
          const completedAt = Date.now();
          emitWorkspaceTestingEvent({
            event: "graph_refresh_completed",
            durationMs: Math.max(0, completedAt - deckRefreshStartedAt),
            metadata: {
              graphType: "agent",
              source: "deck_load",
              usedDisplayFallback,
            },
          });
          recordPostResponseRefreshIfPending("agent_graph", completedAt);
          setDeckLoadBusy(false);
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, [
    emitWorkspaceTestingEvent,
    recordDeckWriteReason,
    recordPostResponseRefreshIfPending,
    canvasProjectId,
  ]);

  useEffect(() => {
    deckSaveAbortRef.current?.abort();
    deckSaveAbortRef.current = null;
    deckExecutionAbortRef.current?.abort();
    deckExecutionAbortRef.current = null;
    setSending(false);
    setDeckSaveBusy(false);
    setDeckRunBusy(false);
    setCardRunBusy(false);
  }, [canvasProjectId]);

  const showDeckBuilder = workspaceView === "canvas";
  const runtimeEvents = useMemo(
    () => (liveDeckEvents.length > 0 ? liveDeckEvents : latestDeckRun?.events || []),
    [latestDeckRun?.events, liveDeckEvents],
  );
  const runtimeVisualState = useMemo(
    () => buildDeckRuntimeVisualState(runtimeEvents),
    [runtimeEvents],
  );
  const selectedCard = useMemo(
    () => deck.nodes.find((node) => node.id === selectedCardId) || null,
    [deck.nodes, selectedCardId],
  );
  const selectedEdge = useMemo(
    () => deck.edges.find((edge) => edge.id === selectedEdgeId) || null,
    [deck.edges, selectedEdgeId],
  );
  const selectedTemplate = useMemo(
    () => resolveAgentTemplate(selectedCard, INITIAL_AGENT_TEMPLATES),
    [selectedCard],
  );
  const effectiveAgent = useMemo(
    () => (selectedCard ? resolveEffectiveAgent(selectedCard, INITIAL_AGENT_TEMPLATES) : null),
    [selectedCard],
  );
  const builderTabs = useMemo(() => {
    if (selectedEdge) return [...BUILDER_EDGE_TABS];
    if (selectedCard) return [...BUILDER_NODE_TABS];
    return [...BUILDER_PROJECT_TABS];
  }, [selectedCard, selectedEdge]);
  const activeTabs = useMemo(() => {
    if (largeSurface === "canvas") return builderTabs;
    if (largeSurface === "knowledge") return [...KNOWLEDGE_VIEW_TABS];
    if (largeSurface === "plan") return [...HOME_PLAN_TABS];
    return [...HOME_CHAT_TABS];
  }, [builderTabs, largeSurface]);
  const selectedCardConfig = useMemo<AgentManagerLocalConfig | null>(() => {
    if (!effectiveAgent || !selectedCard) return null;
    return {
      runtime_binding: selectedCard.runtimeBinding ?? null,
      runtime_type: selectedCard.runtimeType ?? "assistant_agent",
      runtime_options: selectedCard.runtimeOptions ?? null,
      parent_graph_id: selectedCard.parentGraphId ?? null,
      provider:
        effectiveAgent.provider === "openai" || effectiveAgent.provider === "openrouter"
          ? effectiveAgent.provider
          : "",
      model_key: effectiveAgent.model || null,
      temperature: effectiveAgent.temperature ?? null,
      max_tokens: effectiveAgent.maxTokens ?? null,
      prompt_template: selectedCard.prompt || "",
      tools: effectiveAgent.tools,
      knowledge_sources: effectiveAgent.knowledgeSources || [],
      response_format: effectiveAgent.ioSchema
        ? {
            type: "json_schema",
            name: "card_schema",
            schema: effectiveAgent.ioSchema,
          }
        : null,
    };
  }, [effectiveAgent, selectedCard]);
  const selectedCardMemoryGraph = useMemo<AgentManagerMemoryGraphData | null>(
    () => buildSelectedCardMemoryGraphData(deck, selectedCard, selectedCardConfig),
    [deck, selectedCard, selectedCardConfig],
  );
  const deckValidation = useMemo(
    () => validateDeckDocument(deck, { enforceStartCard: true }),
    [deck],
  );
  const deckExecutionPlan = useMemo(() => buildExecutionPlan(deck), [deck]);

  const deckPersistFingerprint = useMemo(
    () => (BUILDER_DEV ? JSON.stringify(deck) : ""),
    [BUILDER_DEV, deck],
  );

  useEffect(() => {
    if (!BUILDER_DEV) return;
    const previousFingerprint = lastBuilderDeckFingerprintRef.current;
    lastBuilderDeckFingerprintRef.current = deckPersistFingerprint;
    if (previousFingerprint === null || previousFingerprint === deckPersistFingerprint) return;

    const writeReason = lastBuilderDeckWriteReasonRef.current;
    const uiOnlyAction = lastBuilderUiOnlyActionRef.current;
    if (!writeReason) {
      console.warn("[builder] deck payload changed without an explicit write reason", {
        action: uiOnlyAction || "unknown",
      });
    } else if (uiOnlyAction) {
      console.warn("[builder] deck payload changed after a UI-only action", {
        action: uiOnlyAction,
        reason: writeReason,
      });
    }
    lastBuilderDeckWriteReasonRef.current = null;
    lastBuilderUiOnlyActionRef.current = null;
  }, [BUILDER_DEV, deckPersistFingerprint]);

  useEffect(() => {
    if (!selectedCardId) return;
    if (deck.nodes.some((node) => node.id === selectedCardId)) return;
    setSelectedCardId(null);
  }, [deck.nodes, selectedCardId]);

  useEffect(() => {
    if (!selectedEdgeId) return;
    if (deck.edges.some((edge) => edge.id === selectedEdgeId)) return;
    setSelectedEdgeId(null);
  }, [deck.edges, selectedEdgeId]);

  useEffect(() => {
    if (workspaceView !== "canvas") return;
    if (selectedCardId || selectedEdgeId) {
      canvasSelectionInitializedRef.current = true;
      return;
    }
    if (canvasSelectionInitializedRef.current) return;
    if (deck.nodes.length === 0) return;
    const preferredNode = deck.nodes[0] || null;
    if (!preferredNode) return;
    canvasSelectionInitializedRef.current = true;
    setSelectedCardId(preferredNode.id);
    setTab("Prompt");
  }, [deck.nodes, selectedCardId, selectedEdgeId, workspaceView]);

  useEffect(() => {
    if (activeTabs.some((entry) => entry === tab)) return;
    setTab(activeTabs[0] || "Plan");
  }, [activeTabs, tab]);

  useEffect(() => {
    if (workspaceView !== "canvas") return;
    recordUiOnlyAction("tab-switch");
  }, [recordUiOnlyAction, tab, workspaceView]);

  useEffect(() => {
    if (workspaceView !== "canvas") return;
    recordUiOnlyAction("drawer-toggle");
  }, [openDrawer, recordUiOnlyAction, workspaceView]);

  const handleSelectCard = useCallback((cardId: string | null) => {
    recordUiOnlyAction("node-selection");
    if (!cardId) {
      pendingPanelOpenTelemetryRef.current = null;
    } else {
      const interactionId = createWorkspaceTestingInteractionId("agent-node");
      emitWorkspaceTestingEvent({
        event: "agent_graph_node_selected",
        objectType: "agent_node",
        objectId: cardId,
        interactionId,
        metadata: { workspaceView: "canvas" },
      });
      queueWorkspacePanelTelemetry("agent", "agent_node", cardId, interactionId);
    }
    setPanelOpen(true);
    setSelectedCardId(cardId);
    if (cardId) {
      setSelectedEdgeId(null);
      if (!BUILDER_NODE_TABS.some((entry) => entry === tab)) {
        setTab("Prompt");
      }
    }
  }, [deck.nodes, emitWorkspaceTestingEvent, queueWorkspacePanelTelemetry, recordUiOnlyAction, tab]);

  const handleSelectEdge = useCallback((edgeId: string | null) => {
    recordUiOnlyAction("edge-selection");
    if (!edgeId) {
      pendingPanelOpenTelemetryRef.current = null;
    } else {
      const interactionId = createWorkspaceTestingInteractionId("agent-edge");
      emitWorkspaceTestingEvent({
        event: "agent_graph_edge_selected",
        objectType: "agent_edge",
        objectId: edgeId,
        interactionId,
        metadata: { workspaceView: "canvas" },
      });
      queueWorkspacePanelTelemetry("agent", "agent_edge", edgeId, interactionId);
    }
    setPanelOpen(true);
    setSelectedEdgeId(edgeId);
    if (edgeId) {
      setSelectedCardId(null);
      setTab("Edge");
    }
  }, [emitWorkspaceTestingEvent, queueWorkspacePanelTelemetry, recordUiOnlyAction]);

  const handleSelectKnowledgeEntity = useCallback((entity: KnowledgeGraphNode | null) => {
    recordUiOnlyAction("knowledge-node-selection");
    if (!entity?.id) {
      pendingPanelOpenTelemetryRef.current = null;
    } else {
      const interactionId = createWorkspaceTestingInteractionId("knowledge-node");
      emitWorkspaceTestingEvent({
        event: "knowledge_graph_node_selected",
        objectType: "knowledge_node",
        objectId: entity.id,
        interactionId,
        metadata: { scope: entity.scope, source: entity.source },
      });
      queueWorkspacePanelTelemetry("knowledge", "knowledge_node", entity.id, interactionId);
    }
    setPanelOpen(true);
    setSelectedEdgeEvidence(null);
    setSelectedKnowledgeRelationshipId(null);
    setSelectedKnowledgeEntityId(entity?.id ?? null);
  }, [emitWorkspaceTestingEvent, queueWorkspacePanelTelemetry, recordUiOnlyAction]);

  const handleSelectKnowledgeRelationship = useCallback((relationship: KnowledgeGraphRelationship | null) => {
    recordUiOnlyAction("knowledge-edge-selection");
    if (!relationship?.id) {
      pendingPanelOpenTelemetryRef.current = null;
    } else {
      const interactionId = createWorkspaceTestingInteractionId("knowledge-edge");
      emitWorkspaceTestingEvent({
        event: "knowledge_graph_edge_selected",
        objectType: "knowledge_edge",
        objectId: relationship.id,
        interactionId,
        metadata: { scope: relationship.scope, source: relationship.source },
      });
      queueWorkspacePanelTelemetry("knowledge", "knowledge_edge", relationship.id, interactionId);
    }
    setPanelOpen(true);
    setSelectedEdgeEvidence(relationship);
    setSelectedKnowledgeEntityId(null);
    setSelectedKnowledgeRelationshipId(relationship?.id ?? null);
  }, [emitWorkspaceTestingEvent, queueWorkspacePanelTelemetry, recordUiOnlyAction]);

  const queueBuilderCanvasFocus = useCallback(
    (kind: BuilderCanvasFocusRequest["kind"], cardId?: string | null) => {
      setBuilderCanvasFocusRequest((current) => ({
        kind,
        cardId: cardId ?? null,
        nonce: (current?.nonce || 0) + 1,
      }));
    },
    [],
  );

  const handleDeleteSelectedEdge = useCallback(() => {
    if (!selectedEdgeId) return;
    recordDeckWriteReason("edge-delete");
    setDeck((currentDeck) => ({
      ...currentDeck,
      version: currentDeck.version + 1,
      edges: currentDeck.edges.filter((edge) => edge.id !== selectedEdgeId),
    }));
    setSelectedEdgeId(null);
  }, [recordDeckWriteReason, selectedEdgeId]);

  const handleQuickAddDeckNode = useCallback(
    (presetKey: string) => {
      const preset = findDeckNodePreset(presetKey);
      if (!preset) return;

      const mutation = buildQuickAddDeckMutation(deck, preset, selectedCardId);
      const anchorNode = selectedCardId
        ? deck.nodes.find((node) => node.id === selectedCardId) || null
        : null;

      setLatestCardRun(null);
      setLatestDeckRun(null);
      recordDeckWriteReason("deck-quick-add");
      setDeck(mutation.nextDeck);
      setPanelOpen(true);
      setSelectedEdgeId(null);
      setSelectedCardId(mutation.nextNode.id);
      setTab("Prompt");
      queueBuilderCanvasFocus("card", mutation.nextNode.id);
      setDeckStatusMessage(
        mutation.nextEdge && anchorNode
          ? `Added ${preset.label} and connected it from ${safeText(anchorNode.title || anchorNode.id)}.`
          : `Added ${preset.label} to the canvas.`,
      );
    },
    [deck, queueBuilderCanvasFocus, recordDeckWriteReason, selectedCardId],
  );

  const handleCreateAssistStarter = useCallback(() => {
    const mutation = buildAssistStarterDeckMutation(deck, selectedCardId);
    if (!mutation) {
      setDeckStatusMessage("Assist starter is not available for this selection.");
      return;
    }

    setLatestCardRun(null);
    setLatestDeckRun(null);
    recordDeckWriteReason("deck-assist-starter");
    setDeck(mutation.nextDeck);
    setPanelOpen(true);
    setSelectedEdgeId(null);
    setSelectedCardId(mutation.focusNodeId);
    if (mutation.focusNodeId) {
      setTab("Prompt");
      queueBuilderCanvasFocus("card", mutation.focusNodeId);
    }
    setDeckStatusMessage(
      `${mutation.recipe.label}: ${mutation.recipe.presetKeys
        .map((presetKey) => findDeckNodePreset(presetKey)?.label || presetKey)
        .join(" -> ")}`,
    );
  }, [deck, queueBuilderCanvasFocus, recordDeckWriteReason, selectedCardId]);

  const { handleSaveDeck, handleRunSelectedCard, handleRunDeck } = useBuilderDeckRuntimeActions({
    builderDev: BUILDER_DEV,
    buildSingleCardRunDocument,
    canvasProjectId,
    deck,
    deckExecutionAbortRef,
    deckExecutionPlan,
    deckId: BUILDER_DECK_ID,
    deckRevision,
    deckRunInput,
    deckSaveAbortRef,
    deckUsingDisplayFallback,
    deckValidation,
    effectiveAgent,
    formatBuilderStatusMessage,
    hydrateDeckDocument,
    selectedCard,
    setCardRunBusy,
    setDeck,
    setDeckRevision,
    setDeckRunBusy,
    setDeckSaveBusy,
    setDeckStatusMessage,
    setLatestCardRun,
    setLatestDeckRun,
    setLiveDeckEvents,
    templates: INITIAL_AGENT_TEMPLATES,
    uid,
    v3ProjectsApi: V3_PROJECTS_API,
    activeProjectLatestRef,
    recordDeckWriteReason,
  });

  const handleSaveSelectedCardConfig = useCallback(
    (nextConfig: AgentManagerLocalConfig) => {
      if (!selectedCard || !selectedTemplate) return;

      setLatestCardRun(null);
      setLatestDeckRun(null);
      recordDeckWriteReason("card-editor");
      setDeck((currentDeck) => {
        const nextRuntimeBinding = normalizeRuntimeBinding(nextConfig.runtime_binding);
        const nextRuntimeType =
          normalizeRuntimeType(nextConfig.runtime_type) ??
          normalizeRuntimeType(selectedCard.runtimeType) ??
          "assistant_agent";
        const nextRuntimeOptions = normalizeRuntimeOptions(nextConfig.runtime_options);
        const nextParentGraphId = cleanOptionalText(nextConfig.parent_graph_id);
        const nextProvider =
          nextConfig.provider === "openai" || nextConfig.provider === "openrouter"
            ? nextConfig.provider
            : null;
        const nextModel = String(nextConfig.model_key || "").trim() || null;
        const nextTemperature =
          typeof nextConfig.temperature === "number" ? nextConfig.temperature : null;
        const nextMaxTokens =
          typeof nextConfig.max_tokens === "number" ? nextConfig.max_tokens : null;
        const nextTools = Array.isArray(nextConfig.tools)
          ? nextConfig.tools
              .filter((tool): tool is string => typeof tool === "string")
              .map((tool) => tool.trim())
              .filter(Boolean)
          : [];
        const nextKnowledgeSources = Array.isArray(nextConfig.knowledge_sources)
          ? nextConfig.knowledge_sources
              .filter((entry): entry is string => typeof entry === "string")
              .map((entry) => entry.trim())
              .filter(Boolean)
          : [];
        const nextIoSchema =
          nextConfig.response_format?.type === "json_schema" &&
          nextConfig.response_format?.schema &&
          typeof nextConfig.response_format.schema === "object"
            ? (nextConfig.response_format.schema as Record<string, unknown>)
            : null;

        const nextOverrides = compactAgentOverrides({
          provider:
            nextProvider !== (selectedTemplate.provider ?? null) ? nextProvider : undefined,
          model: nextModel !== (selectedTemplate.model ?? null) ? nextModel : undefined,
          temperature:
            nextTemperature !== (selectedTemplate.temperature ?? null)
              ? nextTemperature
              : undefined,
          maxTokens:
            nextMaxTokens !== (selectedTemplate.maxTokens ?? null) ? nextMaxTokens : undefined,
          tools: !sameStringArray(nextTools, selectedTemplate.tools) ? nextTools : undefined,
          knowledgeSources:
            !sameStringArray(nextKnowledgeSources, selectedTemplate.knowledgeSources)
              ? nextKnowledgeSources
              : undefined,
          ioSchema:
            !sameObjectShape(nextIoSchema, selectedTemplate.ioSchema)
              ? nextIoSchema || undefined
              : undefined,
        });

        const nextNodes = currentDeck.nodes.map((node) =>
          node.id === selectedCard.id
            ? {
                ...node,
                prompt: String(nextConfig.prompt_template || ""),
                runtimeBinding: nextRuntimeBinding,
                runtimeType: nextRuntimeType,
                runtimeOptions: nextRuntimeOptions,
                parentGraphId: nextParentGraphId,
                overrides: nextOverrides,
              }
            : node,
        );

        return {
          ...currentDeck,
          version: currentDeck.version + 1,
          nodes: nextNodes,
          edges: filterAuthoringCompatibleEdges(nextNodes, currentDeck.edges),
        };
      });
    },
    [recordDeckWriteReason, selectedCard, selectedTemplate],
  );

  const renderAgentBuilderPanel = () => {
    if (!showDeckBuilder) {
      return (
        <div
          style={{
            padding: "16px",
            border: `1px dashed ${C.border}`,
            borderRadius: "8px",
            color: C.neutral,
            background: "#1a1a1a",
          }}
        >
          Select an Assist project for system agents or an Agent workspace for Agent Builder config.
        </div>
      );
    }

    if (selectedEdge && tab === "Edge") {
      const sourceNode = deck.nodes.find((node) => node.id === selectedEdge.source) || null;
      const targetNode = deck.nodes.find((node) => node.id === selectedEdge.target) || null;
      return (
        <div className="space-y-3">
          <DeckEdgeInspector
            edge={selectedEdge}
            onDelete={handleDeleteSelectedEdge}
            sourceLabel={safeText(sourceNode?.title || selectedEdge.source)}
            targetLabel={safeText(targetNode?.title || selectedEdge.target)}
            colors={C}
          />
        </div>
      );
    }

    if (selectedCard && selectedCardConfig) {
      if (tab === "Prompt" || tab === "Knowledge" || tab === "Tools" || tab === "Runtime") {
        return (
          <div>
            <Suspense
              fallback={
                <div
                  style={{
                    padding: "12px 14px",
                    borderRadius: 8,
                    border: `1px solid ${C.border}`,
                    background: C.bg,
                    color: C.neutral,
                  }}
                >
                  Loading card configuration…
                </div>
              }
            >
              <AgentManager
                key={`deck-card:${selectedCard.id}:${tab}`}
                projectId={canvasProjectId || "deck-card"}
                agentType="agent_builder"
                activeTab={tab}
                selectedCardId={selectedCard.id}
                promptTestInput={deckRunInput}
                onChangePromptTestInput={setDeckRunInput}
                onRunPromptTest={handleRunSelectedCard}
                promptTestBusy={cardRunBusy}
                promptTestDisabled={cardRunBusy || deckLoadBusy || !canvasProjectId}
                localConfig={selectedCardConfig}
                memoryGraphData={selectedCardMemoryGraph}
                onSaveLocalConfig={handleSaveSelectedCardConfig}
                onGraphRefresh={() => {
                  // no-op
                }}
              />
            </Suspense>
          </div>
        );
      }
    }

    if (!selectedCard && !selectedEdge && tab === "Plan") {
      return (
        <div className="space-y-3">
          <DeckQuickAddPanel
            anchorCard={null}
            onAddPreset={handleQuickAddDeckNode}
            onCreateAssistStarter={handleCreateAssistStarter}
            colors={C}
          />
          <DeckExecutionPathSummary deck={deck} executionPlan={deckExecutionPlan} colors={C} />
          <div
            style={{
              padding: "12px 14px",
              borderRadius: 8,
              border: `1px solid ${C.border}`,
              background: C.bg,
            }}
          >
            <div
              className="text-xs"
              style={{ color: C.text, fontWeight: 700, marginBottom: 8 }}
            >
              Run Input
            </div>
            <textarea
              value={deckRunInput}
              onChange={(event) => setDeckRunInput(event.target.value)}
              rows={6}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 8,
                border: `1px solid ${C.border}`,
                background: "#181818",
                color: C.text,
                resize: "vertical",
                fontFamily: "monospace",
                fontSize: 12,
              }}
            />
            <div className="flex items-center gap-2" style={{ marginTop: 10 }}>
              <button
                onClick={handleSaveDeck}
                disabled={deckSaveBusy || deckLoadBusy || !canvasProjectId}
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: `1px solid ${C.border}`,
                  background: deckSaveBusy ? C.panel : "#222222",
                  color: C.text,
                  cursor:
                    deckSaveBusy || deckLoadBusy || !canvasProjectId ? "not-allowed" : "pointer",
                }}
              >
                {deckSaveBusy ? "Saving..." : "Save Deck"}
              </button>
              <button
                onClick={handleRunDeck}
                disabled={deckRunBusy || deckLoadBusy || deck.nodes.length === 0 || !canvasProjectId}
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: `1px solid ${deckRunBusy ? C.border : C.primary}`,
                  background: deckRunBusy ? C.panel : "rgba(79,162,173,0.18)",
                  color: C.text,
                  cursor:
                    deckRunBusy || deckLoadBusy || deck.nodes.length === 0 || !canvasProjectId
                      ? "not-allowed"
                      : "pointer",
                }}
              >
                {deckRunBusy ? "Running..." : "Run Deck"}
              </button>
            </div>
            {deckStatusMessage && (
              <div className="text-xs" style={{ marginTop: 8, color: C.neutral }}>
                {deckStatusMessage}
              </div>
            )}
            {latestDeckRun?.error && (
              <div className="text-xs" style={{ marginTop: 8, color: C.warn }}>
                {latestDeckRun.error}
              </div>
            )}
          </div>
        </div>
      );
    }

    return (
      <div
        style={{
          padding: "16px",
          border: `1px dashed ${C.border}`,
          borderRadius: "8px",
          color: C.neutral,
          background: "#1a1a1a",
        }}
      >
        Select a node or edge on the canvas to edit it. Clear the selection to return to project-level tabs.
      </div>
    );
  };

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
  >(() => loadProjectState(activeProject).messages);


  // plan
  const [planSource, setPlanSource] = useState<unknown>(
    () => loadProjectState(activeProject).plan,
  );
  const [plan, setPlan] = useState<PlanItem[]>(
    () => loadProjectState(activeProject).plan,
  );
  const [stateLoaded, setStateLoaded] = useState(false);

  // links
  const [links, setLinks] = useState<LinkRef[]>(
    () => loadProjectState(activeProject).links,
  );
  const assistAnchorSurface = useMemo(
    () => normalizeAnchorSurface(planSource, { messages, planItems: plan, links }),
    [planSource, messages, plan, links],
  );
  const structuredAssistPlan = useMemo(
    () => buildStructuredAssistPlanSurface(planSource, { planItems: plan, anchorSurface: assistAnchorSurface }),
    [planSource, plan, assistAnchorSurface],
  );
  // knowledge graph
  const [cypher, setCypher] = useState("");
  const [graphResult, setGraphResult] = useState<any[]>([]);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [graphResetToken, setGraphResetToken] = useState(0);
  const [expandingNodeId, setExpandingNodeId] = useState<string | null>(null);
  const [graphTypeFilter] = useState<string>("all");
  const [graphRecencyFilter] = useState<"all" | "24h" | "7d" | "30d">("all");
  const [graphMinConfidence] = useState<number>(0);
  const [, setSelectedEdgeEvidence] = useState<KnowledgeGraphRelationship | null>(null);
  const clearKnowledgeWorkspaceSelection = useCallback(() => {
    setSelectedKnowledgeEntityId(null);
    setSelectedKnowledgeRelationshipId(null);
    setSelectedEdgeEvidence(null);
  }, []);
  const [knowGraphData, setKnowGraphData] = useState<{ nodes: any[]; relationships: any[] }>({
    nodes: [],
    relationships: [],
  });
  const [, setLastIngestTrace] = useState<any>(null);
  const scopeKey = activeProject || "";
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
    clearKnowledgeWorkspaceSelection();
  }, [clearKnowledgeWorkspaceSelection]);

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
      bypassCache?: boolean;
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
        bypassCache: opts?.bypassCache,
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
    opts?: { signal?: AbortSignal; requestType?: string; requestSeq?: number; bypassCache?: boolean },
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
        bypassCache: opts?.bypassCache,
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

  useEffect(() => {
    return () => {
      deckSaveAbortRef.current?.abort();
      deckExecutionAbortRef.current?.abort();
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
    clearKnowledgeWorkspaceSelection();
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
    const graphRefreshStartedAt = Date.now();
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
        bypassCache: opts?.force,
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
        bypassCache: opts?.force,
        signal: controller.signal,
        requestType,
        requestSeq,
      });
    })().finally(() => {
      if (
        !controller.signal.aborted &&
        isLatestRequestSequence(requestType, requestSeq) &&
        activeProjectLatestRef.current === projectId
      ) {
        const completedAt = Date.now();
        emitWorkspaceTestingEvent({
          event: "graph_refresh_completed",
          durationMs: Math.max(0, completedAt - graphRefreshStartedAt),
          metadata: {
            graphType: "knowledge",
            source: opts?.force ? "forced_refresh" : "refresh",
          },
        });
        recordPostResponseRefreshIfPending("knowledge_graph", completedAt);
      }
      if (kgLoadAbortRef.current === controller) {
        kgLoadAbortRef.current = null;
      }
      if (kgLoadProjectRef.current === projectId) {
        kgLoadProjectRef.current = "";
      }
    });
  }, [
    activeProject,
    clearKnowledgeWorkspaceSelection,
    emitWorkspaceTestingEvent,
    graphCacheKey,
    loadKnowGraphData,
    loadKnowGraphHealth,
    recordPostResponseRefreshIfPending,
    resetKnowledgePanelState,
    runGraphPresetQuery,
  ]);

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
    const isKnowledgeSurfaceOpen =
      largeSurface === "knowledge" ||
      ((largeSurface === "chat" || largeSurface === "plan") && tab === "Knowledge");
    if (!isKnowledgeSurfaceOpen || !activeProject || !panelOpen) {
      kgAutoLoadKeyRef.current = "";
      return;
    }
    const autoLoadKey = graphCacheScope;
    if (kgAutoLoadKeyRef.current === autoLoadKey) return; // StrictMode/effect-cascade guard.
    kgAutoLoadKeyRef.current = autoLoadKey;
    loadProjectSubgraph();
  }, [activeProject, graphCacheScope, largeSurface, loadProjectSubgraph, panelOpen, tab]);

  useEffect(() => {
    const refresh = () => {
      loadGraphData();
    };
    window.addEventListener("knowledge:refresh", refresh);
    return () => window.removeEventListener("knowledge:refresh", refresh);
  }, [loadGraphData]);

  useEffect(() => {
    clearKnowledgeWorkspaceSelection();
  }, [activeProject, clearKnowledgeWorkspaceSelection, tab]);

  useEffect(() => {
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

  const handleSend = (t: string) => {
    const trimmed = t.trim();
    if (!trimmed) return;
    if (sending || deckRunBusy || cardRunBusy || deckLoadBusy) return;
    if (!canvasProjectId) return;
    const interactionId = createWorkspaceTestingInteractionId("chat");
    const sendStartedAt = Date.now();
    const turnId = `assist:${Date.now()}:${uid()}`;
    chatLoopTelemetryRef.current = {
      interactionId,
      sendStartedAt,
      responseReceivedAt: null,
      refreshRecorded: false,
    };
    emitWorkspaceTestingEvent({
      event: "chat_send_started",
      interactionId,
      surface: largeSurface === "chat" ? "chat" : normalizeWorkspaceSurface(tab),
      surfaceRole: largeSurface === "chat" ? "large" : "companion",
      metadata: {
        messageLength: trimmed.length,
        responseMode: "deck_runtime",
        turnId,
      },
    });

    setMessages((m) => [...m, { role: "user", text: trimmed }]);
    setSending(true);
    setDeckRunBusy(true);
    setLatestCardRun(null);
    setLatestDeckRun(null);
    setLiveDeckEvents([]);
    setDeckStatusMessage("Running deck from chat...");
    const requestProjectId = canvasProjectId;
    deckExecutionAbortRef.current?.abort();
    const controller = new AbortController();
    deckExecutionAbortRef.current = controller;

    void (async () => {
      try {
        const endpoint = `${V3_PROJECTS_API}/${requestProjectId}/decks/run`;
        const data = await streamDeckRunRequest({
          endpoint,
          body: {
            deckId: BUILDER_DECK_ID,
            document: {
              ...deck,
              id: BUILDER_DECK_ID,
            },
            templates: INITIAL_AGENT_TEMPLATES,
            input: trimmed,
          },
          signal: controller.signal,
          onEvent: (event) => {
            if (controller.signal.aborted || activeProjectLatestRef.current !== requestProjectId) return;
            setLiveDeckEvents((current) => [...current, event]);
          },
        });
        if (controller.signal.aborted || activeProjectLatestRef.current !== requestProjectId) {
          return;
        }
        if (!data?.run || typeof data.run !== "object") {
          const failure = data as { message?: unknown; error?: unknown };
          throw new Error(safeText(failure.message || failure.error || "deck_run_failed"));
        }
        const run = data.run as DeckRun;
        const assistantText = resolveDeckRunFinalText(run) || "No response returned.";
        setLatestDeckRun(run);
        setLiveDeckEvents([]);
        setMessages((m) => [...m, { role: "assistant", text: assistantText }]);
        setDeckStatusMessage("Deck run completed.");
        const responseReceivedAt = Date.now();
        const finalStep = [...(run.steps || [])].reverse().find((step) => step.status === "success") || null;
        chatLoopTelemetryRef.current = {
          interactionId,
          sendStartedAt,
          responseReceivedAt,
          refreshRecorded: false,
        };
        emitWorkspaceTestingEvent({
          event: "chat_response_received",
          interactionId,
          durationMs: Math.max(0, responseReceivedAt - sendStartedAt),
          surface: largeSurface === "chat" ? "chat" : normalizeWorkspaceSurface(tab),
          surfaceRole: largeSurface === "chat" ? "large" : "companion",
          metadata: {
            responseMode: "deck_runtime",
            turnId,
            provider: cleanOptionalText(finalStep?.effectiveAgent?.provider),
            model: cleanOptionalText(finalStep?.effectiveAgent?.model),
            stopReason: cleanOptionalText(run.status),
            turnsUsed: Array.isArray(run.steps) ? run.steps.length : null,
          },
        });

        loadProjectSubgraph({ force: true });
        window.setTimeout(() => {
          if (activeProjectLatestRef.current !== requestProjectId) return;
          loadProjectSubgraph({ force: true });
        }, 1500);
      } catch (err: any) {
        if (isAbortLikeError(err) || activeProjectLatestRef.current !== requestProjectId) {
          return;
        }
        const message = formatBuilderStatusMessage(
          err?.message,
          "Deck chat run failed.",
        );
        setLiveDeckEvents([]);
        setLatestDeckRun(null);
        setDeckStatusMessage(message);
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            text: `Request failed: ${message}`,
          },
        ]);
        const responseReceivedAt = Date.now();
        chatLoopTelemetryRef.current = {
          interactionId,
          sendStartedAt,
          responseReceivedAt,
          refreshRecorded: true,
        };
        emitWorkspaceTestingEvent({
          event: "chat_response_received",
          interactionId,
          durationMs: Math.max(0, responseReceivedAt - sendStartedAt),
          surface: largeSurface === "chat" ? "chat" : normalizeWorkspaceSurface(tab),
          surfaceRole: largeSurface === "chat" ? "large" : "companion",
          metadata: {
            responseMode: "deck_runtime",
            turnId,
            ok: false,
            error: message,
          },
        });
      } finally {
        if (deckExecutionAbortRef.current === controller) {
          deckExecutionAbortRef.current = null;
        }
        setSending(false);
        setDeckRunBusy(false);
      }
    })();
  };

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
  const knowledgeEntityById = useMemo(
    () => new Map(graphVizForNVL.entities.map((entity) => [entity.id, entity] as const)),
    [graphVizForNVL.entities],
  );
  const knowledgeRelationshipById = useMemo(
    () => new Map(graphVizForNVL.relationships.map((relationship) => [relationship.id, relationship] as const)),
    [graphVizForNVL.relationships],
  );
  const selectedKnowledgeEntity = useMemo(
    () => (selectedKnowledgeEntityId ? knowledgeEntityById.get(selectedKnowledgeEntityId) || null : null),
    [knowledgeEntityById, selectedKnowledgeEntityId],
  );
  const selectedKnowledgeRelationship = useMemo(
    () =>
      selectedKnowledgeRelationshipId
        ? knowledgeRelationshipById.get(selectedKnowledgeRelationshipId) || null
        : null,
    [knowledgeRelationshipById, selectedKnowledgeRelationshipId],
  );
  const hasKnowledgeWorkspaceSelection = Boolean(selectedKnowledgeEntity || selectedKnowledgeRelationship);

  useEffect(() => {
    if (!selectedKnowledgeEntityId) return;
    if (knowledgeEntityById.has(selectedKnowledgeEntityId)) return;
    setSelectedKnowledgeEntityId(null);
  }, [knowledgeEntityById, selectedKnowledgeEntityId]);

  useEffect(() => {
    if (!selectedKnowledgeRelationshipId) return;
    if (knowledgeRelationshipById.has(selectedKnowledgeRelationshipId)) return;
    setSelectedKnowledgeRelationshipId(null);
  }, [knowledgeRelationshipById, selectedKnowledgeRelationshipId]);

  const handleCreateProject = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    
    const name = newProjectName.trim();
    if (!name) return;
    
    let code = newProjectCode.trim();
    if (!code) {
      code = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    }
    
    const projectType = "assist";
    
    try {
      const res = await fetch(V2_PROJECTS_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          name, 
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
      
      setShowCreateProjectForm(false);
      setNewProjectName("");
      setNewProjectCode("");
      
      await refreshProjects("after-create", newId);
      
      if (newId) {
        setActiveProjectWithUrl(newId);
      }
    } catch (err: any) {
      console.error("Create project failed", err);
      setProjectsError(`Failed to create project: ${err?.message || 'Unknown error'}`);
    }
  };

  const getSurfaceShellStyle = useCallback(
    (
      surfaceKey: "chat" | "plan" | "canvas" | "knowledge",
      compact: boolean,
      surfaceRole: "large" | "companion",
      extra?: React.CSSProperties,
    ): React.CSSProperties => {
      const base: React.CSSProperties = {
        height: "100%",
        minHeight: compact ? 320 : undefined,
        ...extra,
      };
      if (surfaceRole !== "companion") {
        return base;
      }

      const hovered = hoveredCompanionSurface === surfaceKey;
      return {
        ...base,
        cursor: "pointer",
        boxShadow: hovered ? "inset 0 0 0 1px rgba(255,255,255,0.05)" : "none",
        transition: "box-shadow 120ms ease",
      };
    },
    [hoveredCompanionSurface],
  );

  const shouldIgnoreCompanionPromotion = useCallback((target: EventTarget | null): boolean => {
    if (!(target instanceof Element)) return false;
    return Boolean(
      target.closest(
        [
          "button",
          "input",
          "textarea",
          "select",
          "option",
          "label",
          "a[href]",
          "summary",
          ".react-flow__controls",
          '[role="button"]',
          '[role="link"]',
          '[contenteditable="true"]',
          "[data-no-surface-promote='true']",
        ].join(", "),
      ),
    );
  }, []);

  const getCompanionSurfaceHandlers = useCallback(
    (
      surfaceKey: "chat" | "plan" | "canvas" | "knowledge",
      surfaceRole: "large" | "companion",
      onPromote?: () => void,
    ) =>
      surfaceRole === "companion" && onPromote
        ? {
            onClick: (event: React.MouseEvent<HTMLDivElement>) => {
              if (shouldIgnoreCompanionPromotion(event.target)) return;
              onPromote();
            },
            onMouseEnter: () => setHoveredCompanionSurface(surfaceKey),
            onMouseLeave: () =>
              setHoveredCompanionSurface((current) => (current === surfaceKey ? null : current)),
          }
        : {},
    [shouldIgnoreCompanionPromotion],
  );

  const renderChatSurface = (
    projectId: string,
    compact = false,
    surfaceRole: "large" | "companion" = compact ? "companion" : "large",
    onPromote?: () => void,
  ) => (
    <div
      data-testid={`${surfaceRole}-surface-chat`}
      {...getCompanionSurfaceHandlers("chat", surfaceRole, onPromote)}
      style={getSurfaceShellStyle("chat", compact, surfaceRole)}
    >
      <div
        style={{
          height: "100%",
        }}
      >
        <BuilderChat
          messages={messages}
          onSend={handleSend}
          projectId={projectId}
          disabled={sending || deckRunBusy || cardRunBusy || deckLoadBusy || !canvasProjectId}
          colors={C}
        />
      </div>
    </div>
  );

  const renderCanvasSurface = (
    compact = false,
    surfaceRole: "large" | "companion" = compact ? "companion" : "large",
    onPromote?: () => void,
  ) => {
    const isCompanionPreview = surfaceRole === "companion";
    return (
      <div
        data-testid={`${surfaceRole}-surface-canvas`}
        {...getCompanionSurfaceHandlers("canvas", surfaceRole, onPromote)}
        style={getSurfaceShellStyle("canvas", compact, surfaceRole)}
      >
        <div
          style={{
            height: "100%",
          }}
        >
          <BuilderCanvas
            document={deck}
            setDocument={setDeck}
            onPersistGraphMutation={recordDeckWriteReason}
            executionPlan={isCompanionPreview ? null : deckExecutionPlan}
            activeCardIds={isCompanionPreview ? [] : runtimeVisualState.activeCardIds}
            activeEdgeIds={isCompanionPreview ? [] : runtimeVisualState.activeEdgeIds}
            swarmProgressByCardId={
              isCompanionPreview ? {} : runtimeVisualState.swarmProgressByCardId
            }
            selectedCardId={isCompanionPreview ? null : selectedCardId}
            selectedEdgeId={isCompanionPreview ? null : selectedEdgeId}
            onSelectCard={handleSelectCard}
            onSelectEdge={handleSelectEdge}
            onDeleteSelectedEdge={handleDeleteSelectedEdge}
            focusRequest={isCompanionPreview ? null : builderCanvasFocusRequest}
          />
        </div>
      </div>
    );
  };

  const renderKnowledgeWorkspacePanel = () => {
    if (!selectedKnowledgeEntity && !selectedKnowledgeRelationship) return null;

    if (selectedKnowledgeEntity) {
      return (
        <div
          data-testid="companion-surface-knowledge-panel"
          style={{ height: "100%", overflow: "auto" }}
        >
          <div
            data-testid="knowledge-panel-entity"
            style={{
              display: "grid",
              gap: 12,
              paddingRight: 4,
            }}
          >
            <div
              style={{
                border: `1px solid ${C.border}`,
                borderRadius: 10,
                background: C.bg,
                padding: "14px 16px",
              }}
            >
              <div style={{ color: C.text, fontSize: 20, fontWeight: 700, lineHeight: 1.2 }}>
                {safeText(selectedKnowledgeEntity.label)}
              </div>
              <div
                className="text-xs"
                style={{ color: C.neutral, marginTop: 6 }}
              >
                {safeText(selectedKnowledgeEntity.type)} • {safeText(selectedKnowledgeEntity.source)} •{" "}
                {formatKnowledgeScope(selectedKnowledgeEntity.scope)}
              </div>
            </div>

            <div
              style={{
                border: `1px solid ${C.border}`,
                borderRadius: 10,
                background: C.bg,
                padding: "12px 14px",
                color: C.neutral,
                lineHeight: 1.6,
              }}
            >
              Degree {selectedKnowledgeEntity.degree || 0}
              {selectedKnowledgeEntity.last_seen_ts
                ? ` • ${safeText(selectedKnowledgeEntity.last_seen_ts)}`
                : ""}
            </div>
          </div>
        </div>
      );
    }

    if (!selectedKnowledgeRelationship) return null;
    const fromLabel =
      knowledgeEntityById.get(selectedKnowledgeRelationship.from)?.label || selectedKnowledgeRelationship.from;
    const toLabel =
      knowledgeEntityById.get(selectedKnowledgeRelationship.to)?.label || selectedKnowledgeRelationship.to;

    return (
      <div
        data-testid="companion-surface-knowledge-panel"
        style={{ height: "100%", overflow: "auto" }}
      >
        <div
          data-testid="knowledge-panel-relationship"
          style={{
            display: "grid",
            gap: 12,
            paddingRight: 4,
          }}
        >
          <div
            style={{
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              background: C.bg,
              padding: "14px 16px",
            }}
          >
            <div style={{ color: C.text, fontSize: 20, fontWeight: 700, lineHeight: 1.2 }}>
              {safeText(selectedKnowledgeRelationship.type)}
            </div>
            <div
              className="text-xs"
              style={{ color: C.neutral, marginTop: 6 }}
            >
              {safeText(fromLabel)} → {safeText(toLabel)}
            </div>
            <div
              className="text-xs"
              style={{ color: C.neutral, marginTop: 6 }}
            >
              {safeText(selectedKnowledgeRelationship.source)} •{" "}
              {formatKnowledgeScope(selectedKnowledgeRelationship.scope)}
            </div>
          </div>

          {(selectedKnowledgeRelationship.evidence_doc_id || selectedKnowledgeRelationship.last_seen_ts) && (
            <div
              style={{
                border: `1px solid ${C.border}`,
                borderRadius: 10,
                background: C.bg,
                padding: "12px 14px",
                color: C.neutral,
                lineHeight: 1.6,
              }}
            >
              {selectedKnowledgeRelationship.evidence_doc_id
                ? `Doc ${safeText(selectedKnowledgeRelationship.evidence_doc_id)}`
                : ""}
              {selectedKnowledgeRelationship.evidence_doc_id &&
              selectedKnowledgeRelationship.last_seen_ts
                ? " • "
                : ""}
              {selectedKnowledgeRelationship.last_seen_ts
                ? safeText(selectedKnowledgeRelationship.last_seen_ts)
                : ""}
            </div>
          )}

          {selectedKnowledgeRelationship.evidence_snippet && (
            <div
              style={{
                border: `1px solid ${C.border}`,
                borderRadius: 10,
                background: C.bg,
                padding: "12px 14px",
                color: C.text,
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
              }}
            >
              {safeText(selectedKnowledgeRelationship.evidence_snippet)}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderKnowledgeGraphSurface = (
    minHeight = 280,
    surfaceRole: "large" | "companion" = minHeight > 320 ? "large" : "companion",
    onPromote?: () => void,
  ) => (
    <div
      data-testid={`${surfaceRole}-surface-knowledge`}
      {...getCompanionSurfaceHandlers("knowledge", surfaceRole, onPromote)}
      style={getSurfaceShellStyle("knowledge", minHeight <= 320, surfaceRole)}
    >
      <div className="h-full flex flex-col" style={{ position: "relative" }}>
        {graphError && (
          <div
            className="text-xs"
            style={{
              position: "absolute",
              right: 12,
              bottom: 12,
              zIndex: 3,
              color: C.warn,
              border: `1px solid rgba(217,132,88,0.35)`,
              background: "rgba(217,132,88,0.08)",
              borderRadius: 8,
              padding: "6px 8px",
              maxWidth: surfaceRole === "companion" ? 220 : 320,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
            data-no-surface-promote="true"
            title={safeText(graphError)}
          >
            {safeText(graphError)}
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "center", flex: 1, minHeight }}>
          <Suspense
            fallback={
              <div
                style={{
                  width: "100%",
                  minHeight,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                  background: C.bg,
                  color: C.neutral,
                }}
              >
                Loading knowledge graph…
              </div>
            }
          >
            <KnowledgeGraphNVL
              key={`kg-nvl-${graphResetToken}`}
              entities={graphVizForNVL.entities}
              relationships={graphVizForNVL.relationships}
              loading={graphLoading}
              expandingEntityId={expandingNodeId}
              onThinkGraphExpand={expandGraphFromNode}
              onKnowGraphExpand={expandKnowGraphFromEntity}
              onRelationshipInspect={setSelectedEdgeEvidence}
              selectionEnabled={surfaceRole === "large"}
              selectedEntityId={surfaceRole === "large" ? selectedKnowledgeEntityId : null}
              selectedRelationshipId={surfaceRole === "large" ? selectedKnowledgeRelationshipId : null}
              onSelectEntity={surfaceRole === "large" ? handleSelectKnowledgeEntity : undefined}
              onSelectRelationship={
                surfaceRole === "large" ? handleSelectKnowledgeRelationship : undefined
              }
            />
          </Suspense>
        </div>
      </div>
    </div>
  );

  const renderPlanSurface = (
    surfaceRole: "large" | "companion" = "large",
    onPromote?: () => void,
  ) => (
    <div
      data-testid={`${surfaceRole}-surface-plan`}
      {...getCompanionSurfaceHandlers("plan", surfaceRole, onPromote)}
      style={getSurfaceShellStyle("plan", surfaceRole === "companion", surfaceRole, {
        overflow: surfaceRole === "companion" ? "hidden" : "auto",
      })}
    >
      <div
        className="space-y-3 h-full"
        style={{
          overflow: surfaceRole === "companion" ? "hidden" : "auto",
          paddingRight: surfaceRole === "companion" ? 0 : 4,
        }}
      >
        {!activeProject ? (
          <div
            style={{
              padding: "16px",
              border: `1px dashed ${C.border}`,
              borderRadius: "8px",
              color: C.neutral,
              background: "#1a1a1a",
            }}
          >
            Select a project to view its plan.
          </div>
        ) : !stateLoaded ? (
          <div
            style={{
              padding: "16px",
              border: `1px solid ${C.border}`,
              borderRadius: "8px",
              color: C.neutral,
              background: C.bg,
            }}
          >
            Loading plan...
          </div>
        ) : (
          <>
            <PlanWikiSurface
              structuredPlan={structuredAssistPlan}
              colors={C}
              document={
                structuredAssistPlan.hasExplicitPlanDocument ? (
                  <Suspense
                    fallback={
                      <div style={{ color: C.text, whiteSpace: "pre-wrap", minHeight: 120 }}>
                        {safeText(structuredAssistPlan.explicitPlanText).trim() || "No plan notes yet."}
                      </div>
                    }
                  >
                    <PlanWikiLexicalView
                      source={planSource}
                      fallbackText={safeText(structuredAssistPlan.explicitPlanText)}
                      textColor={C.text}
                      mutedColor={C.neutral}
                      emptyText="No plan text yet."
                    />
                  </Suspense>
                ) : null
              }
            />

            {(deckRunBusy || cardRunBusy || runtimeEvents.length > 0) && (
              <Section title="Live Reasoning">
                {runtimeVisualState.reasoningLines.length > 0 ? (
                  <div style={{ display: "grid", gap: 8, color: C.text }}>
                    {runtimeVisualState.reasoningLines.map((line, index) => (
                      <div key={`reasoning-${index}`} style={{ whiteSpace: "pre-wrap" }}>
                        {line}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ color: C.neutral }}>
                    {deckRunBusy || cardRunBusy ? "Waiting: runtime reasoning is still in progress." : "No runtime reasoning captured."}
                  </div>
                )}
              </Section>
            )}

            {(deckRunBusy || cardRunBusy || runtimeEvents.length > 0) && (
              <Section title="Live Team Stream">
                {runtimeVisualState.teamLines.length > 0 ? (
                  <div style={{ display: "grid", gap: 8, color: C.text }}>
                    {runtimeVisualState.teamLines.map((line, index) => (
                      <div key={`team-${index}`} style={{ whiteSpace: "pre-wrap" }}>
                        {line}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ color: C.neutral }}>
                    {deckRunBusy || cardRunBusy ? "Waiting: runtime updates are still in progress." : "No runtime team messages captured."}
                  </div>
                )}
              </Section>
            )}

            {(deckRunBusy || cardRunBusy || runtimeEvents.length > 0) && (
              <Section title="Live Reports">
                {runtimeVisualState.reportLines.length > 0 ? (
                  <div style={{ display: "grid", gap: 8, color: C.text }}>
                    {runtimeVisualState.reportLines.map((line, index) => (
                      <div key={`report-${index}`} style={{ whiteSpace: "pre-wrap" }}>
                        {line}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ color: C.neutral }}>
                    {deckRunBusy || cardRunBusy ? "Waiting: final runtime results are still in progress." : "No runtime reports captured."}
                  </div>
                )}
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  );

  const showHomeChat = useCallback(() => {
    setHoveredCompanionSurface(null);
    setLargeSurface("chat");
    setTab("Canvas");
  }, []);

  const showCanvasWorkspace = useCallback(() => {
    setHoveredCompanionSurface(null);
    setLargeSurface("canvas");
  }, []);

  const showKnowledgeWorkspace = useCallback(() => {
    setHoveredCompanionSurface(null);
    setLargeSurface("knowledge");
    setTab("Chat");
  }, []);

  const showPlanWorkspace = useCallback(() => {
    setHoveredCompanionSurface(null);
    setLargeSurface("plan");
    setTab("Chat");
  }, []);

  const promoteSurface = useCallback(
    (target: "chat" | "plan" | "canvas" | "knowledge") => {
      const previousLargeSurface = largeSurface;
      setHoveredCompanionSurface(null);
      if (target === "canvas") {
        setLargeSurface("canvas");
        return;
      }
      if (target === "knowledge") {
        setLargeSurface("knowledge");
        setTab(previousLargeSurface === "plan" ? "Plan" : "Chat");
        return;
      }
      if (target === "plan") {
        setLargeSurface("plan");
        setTab(previousLargeSurface === "knowledge" ? "Knowledge" : "Chat");
        return;
      }
      setLargeSurface("chat");
      if (previousLargeSurface === "knowledge") {
        setTab("Knowledge");
      } else if (previousLargeSurface === "plan") {
        setTab("Plan");
      } else {
        setTab("Canvas");
      }
    },
    [largeSurface],
  );

  const handleCompanionTabClick = useCallback(
    (nextTab: string) => {
      setHoveredCompanionSurface(null);
      if (workspaceView === "knowledge") {
        clearKnowledgeWorkspaceSelection();
      }
      setTab(nextTab);
    },
    [clearKnowledgeWorkspaceSelection, workspaceView],
  );

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
        <div data-testid="header-actions" className="flex items-center gap-3">
        </div>
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
            title="Home"
            aria-label="Home"
            data-testid="rail-home-button"
            onClick={showHomeChat}
            className="p-2 rounded"
            style={{ color: workspaceView === "home" ? C.primary : C.text }}
          >
            <Icon d="M4 7l8-4 8 4v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
          </button>
          <button
            title="Agents"
            aria-label="Agents"
            data-testid="rail-plus-button"
            onClick={showCanvasWorkspace}
            className="p-2 rounded"
            style={{ color: workspaceView === "canvas" ? C.primary : C.text }}
          >
            <Icon d="M3 12h18M12 3v18" />
          </button>
          <button
            title="Knowledge"
            aria-label="Knowledge"
            data-testid="rail-burst-button"
            onClick={showKnowledgeWorkspace}
            className="p-2 rounded"
            style={{ color: workspaceView === "knowledge" ? C.primary : C.text }}
          >
            <Icon d="M12 1v3M12 20v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M1 12h3M20 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" />
          </button>
          <div className="flex-1" />
          <button
            title="Plan"
            aria-label="Plan"
            data-testid="rail-orange-button"
            onClick={showPlanWorkspace}
            className="p-2 rounded mb-1"
            style={{ color: largeSurface === "plan" ? "#ffb86b" : C.text }}
          >
            <Icon d="M3 12l2-2 4 4L21 4" />
          </button>
          <button
            title="Menu"
            aria-label="Menu"
            data-testid="rail-three-lines-button"
            onClick={() => setOpenDrawer("navigation")}
            className="p-2 rounded"
            style={{
              color: C.text,
              background: "transparent",
            }}
          >
            <Icon d="M4 7h16M4 12h16M4 17h16" />
          </button>
        </aside>

        {/* CENTER content */}
        <div
          data-testid="workspace-large-region"
          data-surface={largeSurface}
          className="h-full transition-[width] duration-150 ease-out min-w-0"
          style={{
            width: panelOpen ? `calc(100% - ${panelWidth}px)` : "100%",
          }}
        >
          {largeSurface === "canvas"
            ? renderCanvasSurface(false, "large")
            : largeSurface === "knowledge"
              ? renderKnowledgeGraphSurface(420, "large")
              : largeSurface === "plan"
                ? renderPlanSurface("large")
                : renderChatSurface(activeProject, false, "large")}
        </div>

        {/* RIGHT panel */}
        {panelOpen && (
          <aside
            data-testid="workspace-companion-region"
            data-workspace={workspaceView}
            className="h-full relative transition-[width] duration-150 ease-out"
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
                    data-testid={`companion-tab-${t.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                    aria-pressed={tab === t}
                    onClick={(event) => {
                      event.stopPropagation();
                      handleCompanionTabClick(t);
                    }}
                    className="font-semibold transition-colors"
                    style={{
                      padding: "8px 10px",
                      color: tab === t ? "#FFFFFF" : C.neutral,
                      background:
                        tab === t
                          ? "rgba(79,162,173,0.10)"
                          : "transparent",
                      border:
                        "1px solid " +
                        (tab === t ? "rgba(79,162,173,0.32)" : "transparent"),
                      borderRadius: 10,
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>

              <div
                className="flex-1 overflow-hidden px-1 pr-3 pb-6 text-sm min-h-0"
                style={{ color: C.neutral }}
              >
                {workspaceView === "canvas" && (
                  <div data-testid="companion-surface-editor" style={{ height: "100%", overflow: "auto" }}>
                    {renderAgentBuilderPanel()}
                  </div>
                )}
                {workspaceView === "knowledge" && hasKnowledgeWorkspaceSelection && renderKnowledgeWorkspacePanel()}

                {workspaceView !== "knowledge" &&
                  largeSurface === "chat" &&
                  tab === "Canvas" &&
                  renderCanvasSurface(true, "companion", () => promoteSurface("canvas"))}
                {workspaceView !== "knowledge" &&
                  largeSurface === "chat" &&
                  tab === "Knowledge" &&
                  renderKnowledgeGraphSurface(320, "companion", () => promoteSurface("knowledge"))}
                {workspaceView !== "knowledge" &&
                  largeSurface === "chat" &&
                  tab === "Plan" &&
                  renderPlanSurface("companion", () => promoteSurface("plan"))}

                {workspaceView !== "knowledge" &&
                  largeSurface === "plan" &&
                  tab === "Chat" &&
                  renderChatSurface(activeProject, true, "companion", () => promoteSurface("chat"))}
                {workspaceView !== "knowledge" &&
                  largeSurface === "plan" &&
                  tab === "Canvas" &&
                  renderCanvasSurface(true, "companion", () => promoteSurface("canvas"))}
                {workspaceView !== "knowledge" &&
                  largeSurface === "plan" &&
                  tab === "Knowledge" &&
                  renderKnowledgeGraphSurface(320, "companion", () => promoteSurface("knowledge"))}

                {workspaceView === "knowledge" &&
                  !hasKnowledgeWorkspaceSelection &&
                  tab === "Chat" &&
                  renderChatSurface(activeProject, true, "companion", () => promoteSurface("chat"))}
                {workspaceView === "knowledge" &&
                  !hasKnowledgeWorkspaceSelection &&
                  tab === "Canvas" &&
                  renderCanvasSurface(true, "companion", () => promoteSurface("canvas"))}
                {workspaceView === "knowledge" &&
                  !hasKnowledgeWorkspaceSelection &&
                  tab === "Plan" &&
                  renderPlanSurface("companion", () => promoteSurface("plan"))}
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
      {openDrawer === "navigation" && (
        <BuilderDrawer title="Projects" onClose={() => setOpenDrawer(null)} colors={C}>
          <div data-testid="navigation-drawer" className="space-y-3">
            <div
              data-testid="drawer-projects-section"
              className="text-xs uppercase mb-2 flex items-center justify-between"
              style={{ color: C.neutral }}
            >
              <span>Chat Projects</span>
              <button
                onClick={() => setShowCreateProjectForm(!showCreateProjectForm)}
                className="text-[11px] px-2 py-1 rounded"
                style={{ border: `1px solid ${C.border}`, color: C.text }}
                data-testid="new-project-button"
              >
                New Project
              </button>
            </div>

            {showCreateProjectForm && (
              <form
                onSubmit={handleCreateProject}
                className="mb-2 p-2 rounded"
                style={{ border: `1px solid ${C.border}`, background: C.bg }}
                data-testid="create-project-form"
              >
                <div className="flex gap-1 mb-1">
                  <input
                    type="text"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    placeholder="Project name"
                    autoFocus
                    className="flex-1 px-2 py-1 text-xs rounded focus:outline-none"
                    style={{ background: C.panel, border: `1px solid ${C.border}`, color: C.text }}
                    data-testid="project-name-input"
                  />
                  <button
                    type="submit"
                    disabled={!newProjectName.trim()}
                    className="text-xs py-1 px-3 rounded font-medium"
                    style={{
                      background: newProjectName.trim() ? `rgba(79,162,173,0.18)` : C.panel,
                      border: `1px solid ${newProjectName.trim() ? C.primary : C.border}`,
                      color: C.text,
                      cursor: newProjectName.trim() ? 'pointer' : 'not-allowed',
                    }}
                    data-testid="create-project-submit"
                  >
                    Create
                  </button>
                </div>
                {showAdvancedProjectFields && (
                  <input
                    type="text"
                    value={newProjectCode}
                    onChange={(e) => setNewProjectCode(e.target.value)}
                    placeholder="code (optional)"
                    className="w-full px-2 py-1 text-xs rounded focus:outline-none mb-1"
                    style={{ background: C.panel, border: `1px solid ${C.border}`, color: C.text }}
                    data-testid="project-code-input"
                  />
                )}
                <button
                  type="button"
                  onClick={() => setShowAdvancedProjectFields(!showAdvancedProjectFields)}
                  className="text-[10px] px-1"
                  style={{ color: C.neutral }}
                >
                  {showAdvancedProjectFields ? '− less' : '+ code'}
                </button>
              </form>
            )}

            <div className="space-y-2" style={{ maxHeight: 400, overflowY: "auto" }}>
              {projectsError && (
                <div className="text-xs" style={{ color: C.neutral }}>
                  {safeText(projectsError)}
                </div>
              )}
              {assistProjects.map((project) => (
                <div key={project.id} className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setActiveProjectWithUrl(project.id);
                      setOpenDrawer(null);
                    }}
                    className="flex-1 text-left p-3 rounded"
                    style={{
                      background:
                        activeProject === project.id
                          ? "rgba(79,162,173,0.18)"
                          : "transparent",
                      border: `1px solid ${activeProject === project.id ? C.primary : C.border}`,
                      color: C.text,
                    }}
                  >
                    <div className="font-medium">{safeText(project.name || project.id)}</div>
                    {project.code && (
                      <div className="opacity-60 text-xs" style={{ marginTop: 2 }}>
                        {safeText(project.code)}
                      </div>
                    )}
                  </button>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (!confirm(`Delete project "${project.name}"? This cannot be undone.`)) return;
                      try {
                        const res = await fetch(`${V2_PROJECTS_API}/${project.id}`, { method: "DELETE" });
                        if (!res.ok) throw new Error(`HTTP ${res.status}`);
                        await refreshProjects("after-delete");
                        if (activeProject === project.id) {
                          const remaining = assistProjects.filter((entry) => entry.id !== project.id);
                          if (remaining.length > 0) {
                            setActiveProjectWithUrl(remaining[0].id);
                          } else {
                            setActiveProjectWithUrl("");
                          }
                        }
                      } catch (err: any) {
                        alert(`Failed to delete project: ${err.message}`);
                      }
                    }}
                    className="p-2 rounded"
                    style={{
                      background: "transparent",
                      border: `1px solid ${C.border}`,
                      color: C.warn,
                    }}
                    title="Delete project"
                  >
                    ×
                  </button>
                </div>
              ))}

              {assistProjects.length === 0 && !projectsError && (
                <div className="text-xs" style={{ color: C.neutral }}>
                  No projects available.
                </div>
              )}
            </div>

            <div className="mt-6 pt-4" style={{ borderTop: `1px solid ${C.border}` }}>
              <div className="text-xs uppercase mb-2" style={{ color: C.neutral }}>
                Account
              </div>
              <button
                onClick={async () => {
                  try {
                    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
                    window.location.href = '/login';
                  } catch (err) {
                    console.error('Logout failed:', err);
                  }
                }}
                className="w-full text-left p-3 rounded"
                style={{
                  background: "transparent",
                  border: `1px solid ${C.border}`,
                  color: C.text,
                }}
              >
                <div className="font-medium">Sign Out</div>
              </button>
            </div>
          </div>
        </BuilderDrawer>
      )}
    </div>
  );
}
