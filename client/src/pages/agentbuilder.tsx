import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  AgentManagerLocalConfig,
  AgentManagerMemoryGraphData,
} from "../components/AgentManager";
import BuilderCanvas, {
  type BuilderCanvasFocusRequest,
} from "../components/builder/BuilderCanvas";
import {
  buildStructuredAssistPlanSurface,
  type AnchorSurface,
  type LinkRef,
  normalizeAnchorSurface,
  normalizeLinks,
  normalizePlanItems,
  type PlanItem,
  type StructuredAssistPlanSurface,
} from "../components/builder/assistPlanSurface";
import {
  createEmptyBlackboard,
  normalizeV3Blackboard,
} from "../components/builder/blackboardState";
import {
  buildExecutionPlan,
} from "../components/builder/deckExecution";
import {
  DECK_NODE_PRESETS,
  findDeckNodePreset,
  getAssistStarterRecipe,
  getCommonAssistNextPresetKeys,
  type AssistStarterRecipe,
  type DeckNodePreset,
} from "../components/builder/deckPresets";
import {
  resolveEffectiveAgent,
} from "../components/builder/deckRuntime";
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
import type {
  AgentCardInstance,
  AgentCardRuntimeOptions,
  AgentCardRuntimeType,
  AgentTemplate,
  CardRunResult,
  DeckEdge,
  DeckEdgeType,
  DeckDocument,
  DeckRun,
  PromptTemplate,
  RuntimeBinding,
  V3Blackboard,
} from "../types/agentgraph";
import type {
  KnowledgeGraphScope,
  KnowledgeGraphRelationship,
  KnowledgeGraphNode,
} from "../components/knowledge/KnowledgeGraphNVL";
import UploadAttachment from "../components/knowledge/UploadAttachment";
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
const BUILDER_BLACKBOARD_TABS = ["Blackboard"] as const;
const BUILDER_EDGE_TABS = ["Edge"] as const;

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
  if (normalized === "round_robin") return "round_robin";
  if (normalized === "selector") return "selector";
  if (normalized === "swarm") return "swarm";
  if (normalized === "magentic_one") return "magentic_one";
  if (normalized === "graph_flow") return "graph_flow";
  if (normalized === "adapter") return "adapter";
  return null;
}

function normalizeRuntimeOptions(value: unknown): AgentCardRuntimeOptions | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return cloneDeckDocument(value as AgentCardRuntimeOptions);
}

function normalizeDeckEdgeType(value: unknown): DeckEdgeType {
  return safeText(value).trim().toLowerCase() === "magentic_option"
    ? "magentic_option"
    : "graph_flow";
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
  blackboard: V3Blackboard,
): AgentManagerMemoryGraphData | null {
  if (!selectedCard || !selectedCardConfig || selectedCard.kind === "blackboard") return null;

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
  const blackboardEntries: Array<{ label: string; value: string; type: string }> = [];
  const pushBlackboardEntry = (label: string, value: unknown, type: string) => {
    const text = cleanOptionalText(value);
    if (!text) return;
    blackboardEntries.push({ label, value: text, type });
  };
  let blackboardNodeId: string | null = null;
  let hasBlackboardRead = false;
  let hasBlackboardWrite = false;

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
      sourceNode?.kind !== "blackboard" &&
      sourceNode &&
      (edgeType === "graph_flow" || edgeType === "magentic_option")
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
      sourceNode?.kind === "blackboard" &&
      edge.target === selectedCard.id
    ) {
      blackboardNodeId = `blackboard:${sourceNode.id}`;
      hasBlackboardRead = true;
      pushEntity({
        id: blackboardNodeId,
        rawId: sourceNode.id,
        label: safeText(sourceNode.title || "Blackboard"),
        type: "Blackboard",
        source: "mixed",
        scope: "project",
      });
      pushRelationship({
        id: `rel:blackboard_read:${edge.id}`,
        from: blackboardNodeId,
        to: agentNodeId,
        type: "reads_blackboard",
        source: "mixed",
        scope: "project",
        evidence_snippet: "This card reads shared working state from the blackboard.",
      });
    }

    if (
      targetNode?.kind === "blackboard" &&
      edge.source === selectedCard.id
    ) {
      blackboardNodeId = `blackboard:${targetNode.id}`;
      hasBlackboardWrite = true;
      pushEntity({
        id: blackboardNodeId,
        rawId: targetNode.id,
        label: safeText(targetNode.title || "Blackboard"),
        type: "Blackboard",
        source: "mixed",
        scope: "project",
      });
      pushRelationship({
        id: `rel:blackboard_write:${edge.id}`,
        from: agentNodeId,
        to: blackboardNodeId,
        type: "writes_blackboard",
        source: "mixed",
        scope: "project",
        evidence_snippet: "This card writes shared working state into the blackboard.",
      });
    }

    if (
      edge.source === selectedCard.id &&
      targetNode?.kind !== "blackboard" &&
      targetNode &&
      (edgeType === "graph_flow" || edgeType === "magentic_option")
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

  if (blackboardNodeId && (hasBlackboardRead || hasBlackboardWrite)) {
    pushBlackboardEntry("Current Goal", blackboard.current_goal, "Blackboard Goal");
    pushBlackboardEntry("Next Move", blackboard.next_move, "Blackboard Next Move");
    blackboard.open_questions.slice(0, 2).forEach((entry) => {
      pushBlackboardEntry("Open Question", entry, "Blackboard Question");
    });
    blackboard.findings.slice(0, 2).forEach((entry) => {
      pushBlackboardEntry("Finding", entry, "Blackboard Finding");
    });
    Object.entries(blackboard.store || {})
      .slice(0, 3)
      .forEach(([key, value]) => {
        pushBlackboardEntry(key.replace(/[_-]+/g, " "), value, "Blackboard Store");
      });

    blackboardEntries.forEach((entry, index) => {
      const entryId = `blackboard_context:${selectedCard.id}:${index}`;
      pushEntity({
        id: entryId,
        rawId: entry.value,
        label: summarizeMemoryGraphLabel(entry.value, entry.label),
        type: entry.type,
        source: "mixed",
        scope: "project",
      });
      pushRelationship({
        id: `rel:blackboard_context:${selectedCard.id}:${index}`,
        from: blackboardNodeId!,
        to: entryId,
        type: "holds_context",
        source: "mixed",
        scope: "project",
        evidence_snippet: entry.value,
      });
    });
  }

  return {
    entities: Array.from(entityMap.values()),
    relationships: Array.from(relationshipMap.values()),
  };
}

function isTopLevelCanvasCard(
  node: AgentCardInstance | null | undefined,
): node is AgentCardInstance {
  return Boolean(node && node.kind !== "blackboard" && !cleanOptionalText(node.parentGraphId));
}

function isAssistCanvasCard(
  node: AgentCardInstance | null | undefined,
): node is AgentCardInstance {
  return Boolean(
    node &&
      node.kind !== "blackboard" &&
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
      if (normalizeDeckEdgeType(edge.edgeType) !== "graph_flow") return;
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
  const selectedRuntimeType = normalizeRuntimeType(selectedNode.runtimeType);
  const selectedParentGraphId = cleanOptionalText(selectedNode.parentGraphId);

  if (selectedParentGraphId) {
    return collectGraphScopedNodeIds(document, selectedParentGraphId);
  }

  if (selectedRuntimeType === "magentic_one" && isTopLevelCanvasCard(selectedNode)) {
    relatedNodeIds.add(selectedNode.id);

    document.edges.forEach((edge) => {
      if (
        edge.source !== selectedNode.id ||
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
    return collectGraphScopedNodeIds(document, selectedNode.id);
  }

  if (isAssistCanvasCard(selectedNode) && isTopLevelCanvasCard(selectedNode)) {
    return collectVisibleAssistFlowIds(document, selectedNode.id);
  }

  relatedNodeIds.add(selectedNode.id);
  return relatedNodeIds;
}

export function buildSingleCardRunDocument(
  document: DeckDocument,
  cardId: string,
): DeckDocument | null {
  const selectedNode = document.nodes.find((node) => node.id === cardId);
  if (!selectedNode) return null;
  const relatedNodeIds = buildSingleCardRunNodeScope(document, selectedNode);

  document.edges.forEach((edge) => {
    const sourceNode = document.nodes.find((node) => node.id === edge.source) || null;
    const targetNode = document.nodes.find((node) => node.id === edge.target) || null;
    if (
      sourceNode?.kind === "blackboard" &&
      relatedNodeIds.has(edge.target)
    ) {
      relatedNodeIds.add(sourceNode.id);
    }
    if (
      targetNode?.kind === "blackboard" &&
      relatedNodeIds.has(edge.source)
    ) {
      relatedNodeIds.add(targetNode.id);
    }
  });

  return {
    ...document,
    nodes: document.nodes.filter((node) => relatedNodeIds.has(node.id)),
    edges: document.edges.filter(
      (edge) => relatedNodeIds.has(edge.source) && relatedNodeIds.has(edge.target),
    ),
  };
}

function normalizeMessages(input: unknown): { role: "assistant" | "user"; text: string }[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((m: any): { role: "assistant" | "user"; text: string } => ({
      role: m?.role === "assistant" ? "assistant" : "user",
      text: safeText(m?.text),
    }))
    .filter((m) => m.text.length > 0);
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
      role: "You are Magentic-One, the top-level orchestrator for the visible agent graph.",
      goal: "Choose the best callable head to run next or answer directly when no downstream call is needed.",
      constraints: "Route deliberately. Do not invent hidden workers. Stay grounded in the visible deck structure.",
      ioSchema: "Input: user request plus callable head summaries. Output: a direct response or one selected downstream head.",
      memoryPolicy: "Use the current input, callable head summaries, and explicit deck context only.",
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
      edgeType: "graph_flow",
    },
    {
      id: "edge_kg_ingest_research",
      source: "card_kg_ingest",
      target: "card_research",
      edgeType: "graph_flow",
    },
    {
      id: "edge_research_knowgraph",
      source: "card_research",
      target: "card_knowgraph",
      edgeType: "graph_flow",
    },
    {
      id: "edge_knowgraph_neo4j",
      source: "card_knowgraph",
      target: "card_neo4j",
      edgeType: "graph_flow",
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

      if (sourceNode.kind === "blackboard" || targetNode.kind === "blackboard") {
        return true;
      }

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
          typeof (node as AgentCardInstance).id === "string" &&
          typeof (node as AgentCardInstance).templateId === "string",
      ),
  );
  return nextNodes.length > 0
    ? nextNodes.map((node) => ({
        id: safeText(node.id).trim(),
        kind: safeText(node.kind).trim() === "blackboard" ? "blackboard" : "agent",
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
    : cloneDeckDocument(INITIAL_DECK.nodes);
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
      preset.kind === "blackboard"
        ? `node_${slug}_${uid()}`
        : `card_${slug}_${uid()}`,
    kind: preset.kind,
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
  if (anchorNode.kind === "blackboard" || nextNode.kind === "blackboard") return null;

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
    edgeType = "graph_flow";
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
    if (preset.kind === "blackboard") {
      return {
        x: anchorNode.position.x + 40,
        y: anchorNode.position.y + 220 + outgoingCount * 28,
      };
    }

    return {
      x: anchorNode.position.x + 320,
      y: anchorNode.position.y + outgoingCount * 180,
    };
  }

  if (preset.kind === "blackboard") {
    const agentNodes = deck.nodes.filter((node) => node.kind !== "blackboard");
    const averageX =
      agentNodes.length > 0
        ? Math.round(agentNodes.reduce((sum, node) => sum + node.position.x, 0) / agentNodes.length)
        : 120;
    const maxY = deck.nodes.reduce((max, node) => Math.max(max, node.position.y), 0);
    return { x: averageX + 120, y: maxY + 260 };
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
  const upgradedNodes = INITIAL_DECK.nodes.map((seedNode) => {
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
    const nextKind: AgentCardInstance["kind"] =
      safeText((existingNode as any).kind || seedNode.kind).trim() === "blackboard"
        ? "blackboard"
        : "agent";

    return {
      ...cloneDeckDocument(seedNode),
      ...cloneDeckDocument(existingNode),
      kind: nextKind,
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

type LatestCardRunRecord = {
  cardId: string;
  title: string;
  templateId: string;
  runtimeBinding?: RuntimeBinding | null;
  input: string;
  effectiveAgent: AgentTemplate;
  result: CardRunResult;
};

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

function DeckEdgeInspector({
  edge,
  onDelete,
  sourceLabel,
  targetLabel,
}: {
  edge: DeckEdge;
  onDelete: () => void;
  sourceLabel: string;
  targetLabel: string;
}) {
  const isBlackboardWrite = safeText(edge.target).trim() === "node_blackboard";
  const isBlackboardRead = safeText(edge.source).trim() === "node_blackboard";
  const connectionMeaning = isBlackboardWrite
    ? "send output to blackboard"
    : isBlackboardRead
      ? "run using blackboard context"
      : "run next";
  return (
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
        style={{ color: C.text, fontWeight: 700, marginBottom: 12 }}
      >
        Edge
      </div>
      <div className="space-y-3">
        <div
          className="text-xs"
          style={{
            padding: "10px 12px",
            borderRadius: 8,
            border: `1px solid ${C.border}`,
            background: C.panel,
            color: C.neutral,
            lineHeight: 1.5,
          }}
        >
          <div>source: {sourceLabel}</div>
          <div>target: {targetLabel}</div>
          <div>meaning: {connectionMeaning}</div>
        </div>
        <div
          className="text-xs"
          style={{
            padding: "10px 12px",
            borderRadius: 8,
            border: `1px solid ${C.border}`,
            background: C.panel,
            color: C.neutral,
            lineHeight: 1.5,
          }}
        >
          This line is the real saved connection between these two nodes.
          <div style={{ marginTop: 6 }}>
            Drag either end of the selected line on the canvas to rewire it.
          </div>
        </div>
        <button
          onClick={onDelete}
          style={{
            width: "100%",
            padding: "10px 12px",
            borderRadius: 8,
            border: `1px solid ${C.warn}`,
            background: "rgba(217,132,88,0.12)",
            color: C.text,
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          Delete Connection
        </button>
      </div>
    </div>
  );
}

function DeckQuickAddPanel({
  anchorCard,
  onAddPreset,
  onCreateAssistStarter,
}: {
  anchorCard: AgentCardInstance | null;
  onAddPreset: (presetKey: string) => void;
  onCreateAssistStarter: () => void;
}) {
  const commonPresets = getCommonAssistNextPresetKeys(anchorCard)
    .map((presetKey) => findDeckNodePreset(presetKey))
    .filter((preset): preset is DeckNodePreset => Boolean(preset));
  const assistStarterRecipe = getAssistStarterRecipe(anchorCard);
  const helperText = anchorCard
    ? anchorCard.kind === "blackboard"
      ? "New agent cards appear beside Blackboard and connect from it. New blackboards stay disconnected."
      : "New cards appear beside the selected node and connect from it so the new link is immediately visible."
    : "Start with the common Assist roles below, then wire the rest with visible links only.";

  return (
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
        style={{ color: C.text, fontWeight: 700, marginBottom: 10 }}
      >
        Quick Add
      </div>
      {assistStarterRecipe && (
        <div
          style={{
            marginBottom: 10,
            padding: "10px 12px",
            borderRadius: 10,
            border: `1px solid ${C.primary}`,
            background: "rgba(79,162,173,0.08)",
          }}
        >
          <div className="text-xs" style={{ color: C.text, fontWeight: 700, marginBottom: 6 }}>
            Assist Starter
          </div>
          <div className="text-xs" style={{ color: C.neutral, lineHeight: 1.5, marginBottom: 8 }}>
            {assistStarterRecipe.presetKeys
              .map((presetKey) => findDeckNodePreset(presetKey)?.label || presetKey)
              .join(" -> ")}
          </div>
          <button
            onClick={onCreateAssistStarter}
            style={{
              width: "100%",
              padding: "9px 12px",
              borderRadius: 8,
              border: `1px solid ${C.primary}`,
              background: "rgba(79,162,173,0.16)",
              color: C.text,
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            {assistStarterRecipe.label}
          </button>
        </div>
      )}
      {commonPresets.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div className="text-xs" style={{ color: C.neutral, marginBottom: 8 }}>
            {anchorCard ? "Common Next" : "Assist MVP Roles"}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {commonPresets.map((preset) => (
              <button
                key={`common:${preset.key}`}
                onClick={() => onAddPreset(preset.key)}
                style={{
                  padding: "8px 10px",
                  borderRadius: 999,
                  border: `1px solid ${preset.kind === "blackboard" ? C.primary : C.border}`,
                  background:
                    preset.kind === "blackboard"
                      ? "rgba(79,162,173,0.12)"
                      : "rgba(255,255,255,0.04)",
                  color: C.text,
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 8,
        }}
      >
        {DECK_NODE_PRESETS.map((preset) => (
          <button
            key={preset.key}
            onClick={() => onAddPreset(preset.key)}
            style={{
              textAlign: "left",
              padding: "10px 12px",
              borderRadius: 8,
              border: `1px solid ${C.border}`,
              background:
                preset.kind === "blackboard" ? "rgba(79,162,173,0.12)" : "#202020",
              color: C.text,
              cursor: "pointer",
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 700 }}>{preset.label}</div>
            <div
              className="text-xs"
              style={{ color: C.neutral, marginTop: 4, lineHeight: 1.45, opacity: 0.9 }}
            >
              {preset.subtitle}
            </div>
          </button>
        ))}
      </div>
      <div className="text-xs" style={{ color: C.neutral, marginTop: 10, lineHeight: 1.5 }}>
        {helperText}
      </div>
    </div>
  );
}

function DeckExecutionPathSummary({
  deck,
  executionPlan,
}: {
  deck: DeckDocument;
  executionPlan: ReturnType<typeof buildExecutionPlan>;
}) {
  const nodeLabel = new Map(deck.nodes.map((node) => [node.id, safeText(node.title || node.id)] as const));
  const orderedLabels = executionPlan.simpleOrderCardIds
    .map((cardId) => nodeLabel.get(cardId) || cardId)
    .filter(Boolean);
  const hasLoopIssue = executionPlan.issues.some((issue) => issue.toLowerCase().includes("cycle"));

  return (
    <div
      style={{
        padding: "12px 14px",
        borderRadius: 8,
        border: `1px solid ${C.border}`,
        background: C.bg,
        marginBottom: 12,
      }}
    >
      <div
        className="text-xs"
        style={{ color: C.text, fontWeight: 700, marginBottom: 8 }}
      >
        Visible Execution Path
      </div>
      <div className="text-xs" style={{ color: C.neutral, lineHeight: 1.55 }}>
        {orderedLabels.length > 0 ? orderedLabels.join(" -> ") : "No runnable path yet."}
      </div>
      <div className="text-xs" style={{ color: C.neutral, marginTop: 8, opacity: 0.85 }}>
        This order comes directly from the drawn links on the canvas.
      </div>
      {hasLoopIssue && (
        <div
          className="text-xs"
          style={{
            color: C.warn,
            marginTop: 8,
            lineHeight: 1.55,
            padding: "8px 10px",
            borderRadius: 8,
            border: `1px solid rgba(217,132,88,0.34)`,
            background: "rgba(217,132,88,0.08)",
          }}
        >
          Loop detected in the drawn graph. The runtime does not invent a fake simple order through cycles.
        </div>
      )}
    </div>
  );
}

function BlackboardStatePanel({
  title,
  blackboard,
}: {
  title: string;
  blackboard: V3Blackboard;
}) {
  const sections: Array<{ label: string; value: string }> = [
    { label: "Current Goal", value: safeText(blackboard.current_goal) },
    { label: "What Matters Now", value: blackboard.what_matters_now.join("\n") },
    { label: "Open Questions", value: blackboard.open_questions.join("\n") },
    { label: "Findings", value: blackboard.findings.join("\n") },
    { label: "Suggestions", value: blackboard.suggestions.join("\n") },
    { label: "Next Options", value: blackboard.next_options.join("\n") },
    { label: "Next Move", value: safeText(blackboard.next_move) },
  ];
  const storeEntries = Object.entries(blackboard.store || {});

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
      <div className="space-y-3">
        {sections.map((section) => (
          <div key={section.label}>
            <div className="text-xs" style={{ color: C.neutral, marginBottom: 6 }}>
              {section.label}
            </div>
            <div
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 8,
                border: `1px solid ${C.border}`,
                background: "#181818",
                color: C.text,
                whiteSpace: "pre-wrap",
                fontFamily: "monospace",
                fontSize: 12,
                lineHeight: 1.55,
                minHeight: 44,
              }}
            >
              {section.value || "(empty)"}
            </div>
          </div>
        ))}
        <div>
          <div className="text-xs" style={{ color: C.neutral, marginBottom: 6 }}>
            Store
          </div>
          {storeEntries.length === 0 ? (
            <div
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 8,
                border: `1px solid ${C.border}`,
                background: "#181818",
                color: C.neutral,
                fontFamily: "monospace",
                fontSize: 12,
                lineHeight: 1.55,
                minHeight: 44,
              }}
            >
              (empty)
            </div>
          ) : (
            <div className="space-y-2">
              {storeEntries.map(([key, value]) => (
                <div
                  key={key}
                  style={{
                    borderRadius: 8,
                    border: `1px solid ${C.border}`,
                    background: "#181818",
                    padding: "10px 12px",
                  }}
                >
                  <div
                    className="text-xs"
                    style={{ color: C.neutral, marginBottom: 6, fontFamily: "monospace" }}
                  >
                    {key}
                  </div>
                  <div
                    style={{
                      color: C.text,
                      whiteSpace: "pre-wrap",
                      fontFamily: "monospace",
                      fontSize: 12,
                      lineHeight: 1.55,
                    }}
                  >
                    {safeText(value) || "(empty)"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// -------- Main page --------
export default function AgentBuilder(): React.ReactElement {
  const BUILDER_DEV = import.meta.env.DEV;
  const [largeSurface, setLargeSurface] = useState<"chat" | "plan" | "canvas" | "knowledge">("chat");
  const [activeProject, setActiveProject] = useState("");
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelWidth, setPanelWidth] = useState(480);
  const [selectedAgentProjectId, setSelectedAgentProjectId] = useState("");
  const [deck, setDeckState] = useState<DeckDocument>(() => hydrateDeckDocument(INITIAL_DECK));
  const [deckRevision, setDeckRevision] = useState<string | null>(null);
  const [blackboardRevision, setBlackboardRevision] = useState<string | null>(null);
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
  const [v3Blackboard, setV3Blackboard] = useState<V3Blackboard>(() => createEmptyBlackboard());
  const [deckRunBusy, setDeckRunBusy] = useState(false);
  const [cardRunBusy, setCardRunBusy] = useState(false);
  const [deckLoadBusy, setDeckLoadBusy] = useState(false);
  const [deckSaveBusy, setDeckSaveBusy] = useState(false);
  const [deckStatusMessage, setDeckStatusMessage] = useState<string | null>(null);
  const [deckUsingDisplayFallback, setDeckUsingDisplayFallback] = useState(false);
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

  const [tab, setTab] = useState<string>("Canvas");
  const [hoveredCompanionSurface, setHoveredCompanionSurface] =
    useState<null | "chat" | "plan" | "canvas" | "knowledge">(null);
  const [openDrawer, setOpenDrawer] = useState<null | "navigation">(null);
  const [sending, setSending] = useState(false);
  const workspaceView =
    largeSurface === "canvas" ? "canvas" : largeSurface === "knowledge" ? "knowledge" : "home";
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
    (payload: WorkspaceTestingEventInput) => {
      const metadata = {
        activeProjectId: activeProject || null,
        agentProjectId: selectedAgentProjectId || null,
        ...(payload.metadata || {}),
      };
      recordWorkspaceTestingEvent({
        ...payload,
        projectId:
          payload.projectId ??
          cleanOptionalText(activeProject) ??
          cleanOptionalText(selectedAgentProjectId) ??
          null,
        metadata,
      });
    },
    [activeProject, selectedAgentProjectId],
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
  const [projects, setProjects] = useState<any[]>([]);
  const refreshSeq = useRef(0);
  const refreshAbortRef = useRef<AbortController | null>(null);
  const mountRefreshRanRef = useRef(false);
  const canvasSelectionInitializedRef = useRef(false);
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
  const lastBuilderDeckWriteReasonRef = useRef<string | null>(null);
  const lastBuilderUiOnlyActionRef = useRef<string | null>(null);
  const lastBuilderDeckFingerprintRef = useRef<string | null>(null);
  const [projectsError, setProjectsError] = useState<string | null>(null);

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
    if (!selectedAgentProjectId) {
      recordDeckWriteReason("builder-reset");
      setDeck(hydrateDeckDocument(INITIAL_DECK));
      setDeckRevision(null);
      setBlackboardRevision(null);
      setDeckUsingDisplayFallback(false);
      setLatestDeckRun(null);
      setLatestCardRun(null);
      setV3Blackboard(createEmptyBlackboard());
      setDeckStatusMessage(null);
      return;
    }

    const controller = new AbortController();
    const deckRefreshStartedAt = Date.now();
    let usedDisplayFallback = false;
    setDeckLoadBusy(true);
    setDeckRevision(null);
    setBlackboardRevision(null);
      setDeckStatusMessage("Loading canvas...");

    void (async () => {
      try {
        const endpoint = `${V3_PROJECTS_API}/${selectedAgentProjectId}/decks/${BUILDER_DECK_ID}`;
        const payload = await guardedRequest({
          key: `v3-deck:${selectedAgentProjectId}:${BUILDER_DECK_ID}`,
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
        setLatestDeckRun(
          payload.data?.latestRun && typeof payload.data.latestRun === "object"
            ? (payload.data.latestRun as DeckRun)
            : null,
        );
        setV3Blackboard(
          normalizeV3Blackboard(
            payload.data?.blackboard ?? payload.data?.latestRun?.blackboard ?? createEmptyBlackboard(),
          ),
        );
        setBlackboardRevision(
          typeof payload.data?.meta?.blackboardRevision === "string"
            ? payload.data.meta.blackboardRevision
            : null,
        );
        setLatestCardRun(null);
        setDeckStatusMessage(
          loadResult.displayFallbackOnly
            ? "Showing the canonical chain as a temporary fallback for a truncated saved canvas."
            : loadResult.usedFallback
              ? "Using default canvas."
              : "Canvas loaded.",
        );
      } catch (err: any) {
        if (controller.signal.aborted) return;
        recordDeckWriteReason("deck-load-preserve-current");
        setLatestDeckRun(null);
        setLatestCardRun(null);
        setV3Blackboard(createEmptyBlackboard());
        setDeckRevision(null);
        setBlackboardRevision(null);
        setDeckStatusMessage(formatBuilderStatusMessage(err?.message, "Keeping current canvas."));
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
    selectedAgentProjectId,
  ]);

  const showDeckBuilder = workspaceView === "canvas";
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
    if (selectedCard?.kind === "blackboard") return [...BUILDER_BLACKBOARD_TABS];
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
    () => buildSelectedCardMemoryGraphData(deck, selectedCard, selectedCardConfig, v3Blackboard),
    [deck, selectedCard, selectedCardConfig, v3Blackboard],
  );
  const deckValidation = useMemo(
    () => validateDeckDocument(deck, { enforceStartCard: true }),
    [deck],
  );
  const deckExecutionPlan = useMemo(() => buildExecutionPlan(deck), [deck]);
  const drawerBoardCards = useMemo(() => {
    const orderedIds = deckExecutionPlan.simpleOrderCardIds;
    const orderedCards = orderedIds
      .map((cardId) => deck.nodes.find((node) => node.id === cardId) || null)
      .filter((node): node is AgentCardInstance => Boolean(node));
    const orderedCardIds = new Set(orderedCards.map((node) => node.id));
    const remainingCards = deck.nodes.filter((node) => !orderedCardIds.has(node.id));
    return [...orderedCards, ...remainingCards];
  }, [deck.nodes, deckExecutionPlan.simpleOrderCardIds]);

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
    const preferredNode =
      deck.nodes.find((node) => node.kind !== "blackboard") ||
      deck.nodes[0] ||
      null;
    if (!preferredNode) return;
    canvasSelectionInitializedRef.current = true;
    setSelectedCardId(preferredNode.id);
    setTab(preferredNode.kind === "blackboard" ? "Blackboard" : "Prompt");
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
      const selectedNode = deck.nodes.find((node) => node.id === cardId) || null;
      if (selectedNode?.kind === "blackboard") {
        setTab("Blackboard");
      } else if (!BUILDER_NODE_TABS.some((entry) => entry === tab)) {
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

  const handleOpenBoardCardFromDrawer = useCallback(
    (cardId: string) => {
      const selectedNode = deck.nodes.find((node) => node.id === cardId) || null;
      setPanelOpen(true);
      setTab(selectedNode?.kind === "blackboard" ? "Blackboard" : "Prompt");
      setSelectedEdgeId(null);
      setSelectedCardId(cardId);
      queueBuilderCanvasFocus("card", cardId);
      setOpenDrawer(null);
    },
    [deck.nodes, queueBuilderCanvasFocus],
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
      setTab(preset.kind === "blackboard" ? "Blackboard" : "Prompt");
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
      const focusNode = mutation.nextDeck.nodes.find((node) => node.id === mutation.focusNodeId) || null;
      setTab(focusNode?.kind === "blackboard" ? "Blackboard" : "Prompt");
      queueBuilderCanvasFocus("card", mutation.focusNodeId);
    }
    setDeckStatusMessage(
      `${mutation.recipe.label}: ${mutation.recipe.presetKeys
        .map((presetKey) => findDeckNodePreset(presetKey)?.label || presetKey)
        .join(" -> ")}`,
    );
  }, [deck, queueBuilderCanvasFocus, recordDeckWriteReason, selectedCardId]);

  const handleSaveDeck = useCallback(async () => {
    if (!selectedAgentProjectId) {
      setDeckStatusMessage("Open a canvas before saving.");
      return;
    }
    if (deckUsingDisplayFallback) {
      setDeckStatusMessage(
        "This canvas is a temporary display fallback and will not overwrite the saved deck.",
      );
      return;
    }

    const requestedDeckVersion = deck.version;

    // Persist contract:
    // - canvas/deck state is the only persisted graph source of truth
    // - right-panel edits write only explicit node/edge fields into that deck state
    // - selection, tab, drawer, and blackboard inspect UI are non-persisted view state only
    setDeckSaveBusy(true);
    setDeckStatusMessage("Saving deck...");

    try {
      const endpoint = `${V3_PROJECTS_API}/${selectedAgentProjectId}/decks/${BUILDER_DECK_ID}`;
      const response = await fetch(endpoint, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          document: {
            ...deck,
            id: BUILDER_DECK_ID,
          },
          expectedRevision: deckRevision,
        }),
      });
      const data = await safeJson(response);

      if (!response.ok) {
        throw new Error(safeText(data?.error || "deck_save_failed"));
      }

      if (data?.deck && typeof data.deck === "object") {
        recordDeckWriteReason("deck-save-merge");
        setDeck((currentDeck) => {
          if (currentDeck.version !== requestedDeckVersion) {
            if (BUILDER_DEV) {
              console.warn("[builder] skipped stale deck save merge", {
                requestVersion: requestedDeckVersion,
                currentVersion: currentDeck.version,
              });
            }
            return currentDeck;
          }
          return hydrateDeckDocument({ ...(data.deck as DeckDocument), id: BUILDER_DECK_ID });
        });
      }
      setDeckRevision(
        typeof data?.meta?.deckRevision === "string" ? data.meta.deckRevision : deckRevision,
      );
      setV3Blackboard(normalizeV3Blackboard(data?.blackboard ?? v3Blackboard));
      setBlackboardRevision(
        typeof data?.meta?.blackboardRevision === "string"
          ? data.meta.blackboardRevision
          : blackboardRevision,
      );
      setDeckStatusMessage("Board saved.");
    } catch (err: any) {
      const fallbackMessage =
        safeText(err?.message) === "deck_conflict"
          ? "A newer saved canvas exists. Reload the workspace before saving again."
          : "Could not save the current board.";
      setDeckStatusMessage(formatBuilderStatusMessage(err?.message, fallbackMessage));
    } finally {
      setDeckSaveBusy(false);
    }
  }, [
    BUILDER_DEV,
    blackboardRevision,
    deck,
    deckRevision,
    deckUsingDisplayFallback,
    recordDeckWriteReason,
    selectedAgentProjectId,
    v3Blackboard,
  ]);

  const handleRunSelectedCard = useCallback(async () => {
    if (!selectedAgentProjectId) {
      setDeckStatusMessage("Canvas data is unavailable for this selection.");
      return;
    }
    if (!selectedCard || !effectiveAgent) {
      setDeckStatusMessage("Select a card before running it.");
      return;
    }
    if (selectedCard.kind === "blackboard") {
      setDeckStatusMessage("Blackboard is a storage node and cannot run directly.");
      return;
    }

    const singleCardDeck = buildSingleCardRunDocument(deck, selectedCard.id);
    if (!singleCardDeck) {
      setDeckStatusMessage("Selected card could not be isolated for execution.");
      return;
    }

    setCardRunBusy(true);
    setLatestCardRun(null);
    setDeckStatusMessage("Running selected card...");

    try {
      const selectedCardRunAgent = resolveEffectiveAgent(selectedCard, INITIAL_AGENT_TEMPLATES);
      const endpoint = `${V3_PROJECTS_API}/${selectedAgentProjectId}/decks/run`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          deckId: BUILDER_DECK_ID,
          document: {
            ...singleCardDeck,
            id: BUILDER_DECK_ID,
          },
          templates: INITIAL_AGENT_TEMPLATES,
          input: deckRunInput,
          baseBlackboardRevision: blackboardRevision,
        }),
      });
      const data = await safeJson(response);

      if (!response.ok || !data?.run || typeof data.run !== "object") {
        throw new Error(safeText(data?.message || data?.error || "Card run failed."));
      }

      const run = data.run as DeckRun;
      const step = run.steps.find((entry) => entry.cardId === selectedCard.id);
      if (!step) {
        throw new Error("Selected card did not produce a run step.");
      }
      const result: CardRunResult = {
        output: step.output,
        status: step.status,
        error: step.error,
        startedAt: step.startedAt,
        endedAt: step.endedAt,
        runtimeBinding: step.runtimeBinding,
        seed: step.seed,
        contract: step.contract,
        handshake: step.handshake,
        score: step.score,
        passed: step.passed,
        scoreDetail: step.scoreDetail,
        improvementPromptBit: step.improvementPromptBit,
        inputSummary: step.inputSummary,
        outputSummary: step.outputSummary,
        blackboardWrite: step.blackboardWrite,
        blackboard: step.blackboard,
      };
      const nextBlackboard = normalizeV3Blackboard(
        data?.blackboard ?? result.blackboard ?? v3Blackboard,
      );

      setLatestCardRun({
        cardId: selectedCard.id,
        title: selectedCard.title,
        templateId: selectedCard.templateId,
        runtimeBinding: selectedCard.runtimeBinding ?? null,
        input: deckRunInput,
        effectiveAgent: selectedCardRunAgent || effectiveAgent,
        result,
      });
      setLatestDeckRun(run);
      setV3Blackboard(nextBlackboard);
      setBlackboardRevision(
        typeof data?.meta?.blackboardRevision === "string"
          ? data.meta.blackboardRevision
          : blackboardRevision,
      );

      if (result.status === "error") {
        setDeckStatusMessage(formatBuilderStatusMessage(result.error, "Card run failed."));
      } else {
        setDeckStatusMessage("Selected card run complete.");
      }
    } catch (err: any) {
      setLatestCardRun({
        cardId: selectedCard.id,
        title: selectedCard.title,
        templateId: selectedCard.templateId,
        runtimeBinding: selectedCard.runtimeBinding ?? null,
        input: deckRunInput,
        effectiveAgent,
        result: {
          output: null,
          status: "error",
          error: err?.message || "Card run failed.",
          startedAt: new Date().toISOString(),
          endedAt: new Date().toISOString(),
        },
      });
      setDeckStatusMessage(formatBuilderStatusMessage(err?.message, "Card run failed."));
    } finally {
      setCardRunBusy(false);
    }
  }, [
    deck,
    deckRunInput,
    effectiveAgent,
    blackboardRevision,
    selectedAgentProjectId,
    selectedCard,
    v3Blackboard,
  ]);

  const handleRunDeck = useCallback(async () => {
    if (!selectedAgentProjectId) {
      const now = new Date().toISOString();
      setLatestDeckRun({
        id: `deck_run_${uid()}`,
        deckId: BUILDER_DECK_ID,
        startedAt: now,
        endedAt: now,
        status: "error",
        input: deckRunInput,
        error: "Select an Agent workspace before running the deck.",
        steps: [],
        validationSummary: {
          ok: deckValidation.ok,
          errors: deckValidation.errors.map((issue) => issue.message),
          warnings: deckValidation.warnings.map((issue) => issue.message),
        },
        executionPlanSummary: {
          startCardIds: deckExecutionPlan.startCardIds,
          simpleOrderCardIds: deckExecutionPlan.simpleOrderCardIds,
          expandedStepIds: deckExecutionPlan.expandedSteps.map((step) => step.executionId),
        },
      });
      return;
    }

    const requestedDeckVersion = deck.version;

    setDeckRunBusy(true);
    setLatestCardRun(null);
    setLatestDeckRun(null);
    setDeckStatusMessage("Running deck...");

    try {
      const endpoint = `${V3_PROJECTS_API}/${selectedAgentProjectId}/decks/run`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          deckId: BUILDER_DECK_ID,
          document: {
            ...deck,
            id: BUILDER_DECK_ID,
          },
          templates: INITIAL_AGENT_TEMPLATES,
          input: deckRunInput,
          baseBlackboardRevision: blackboardRevision,
        }),
      });
      const data = await safeJson(response);

      if (!response.ok || !data?.run) {
        throw new Error(safeText(data?.error || "Deck run failed."));
      }

      const run = data.run as DeckRun;
      setLatestDeckRun(run);
      setV3Blackboard(normalizeV3Blackboard(data?.blackboard ?? data?.run?.blackboard ?? v3Blackboard));
      setBlackboardRevision(
        typeof data?.meta?.blackboardRevision === "string"
          ? data.meta.blackboardRevision
          : blackboardRevision,
      );
      if (data?.deck && typeof data.deck === "object") {
        recordDeckWriteReason("deck-run-merge");
        setDeck((currentDeck) => {
          if (currentDeck.version !== requestedDeckVersion) {
            if (BUILDER_DEV) {
              console.warn("[builder] skipped stale deck run merge", {
                requestVersion: requestedDeckVersion,
                currentVersion: currentDeck.version,
              });
            }
            return currentDeck;
          }
          return hydrateDeckDocument({ ...(data.deck as DeckDocument), id: BUILDER_DECK_ID });
        });
      }
      setDeckStatusMessage("Board run complete.");
    } catch (err: any) {
      const friendlyError = formatBuilderStatusMessage(err?.message, "Board run failed.");
      const now = new Date().toISOString();
      setLatestDeckRun({
        id: `deck_run_${uid()}`,
        deckId: BUILDER_DECK_ID,
        startedAt: now,
        endedAt: now,
        status: "error",
        input: deckRunInput,
        error: friendlyError,
        steps: [],
        validationSummary: {
          ok: deckValidation.ok,
          errors: deckValidation.errors.map((issue) => issue.message),
          warnings: deckValidation.warnings.map((issue) => issue.message),
        },
        executionPlanSummary: {
          startCardIds: deckExecutionPlan.startCardIds,
          simpleOrderCardIds: deckExecutionPlan.simpleOrderCardIds,
          expandedStepIds: deckExecutionPlan.expandedSteps.map((step) => step.executionId),
        },
      });
      setDeckStatusMessage(friendlyError);
    } finally {
      setDeckRunBusy(false);
    }
  }, [
    BUILDER_DEV,
    blackboardRevision,
    deck,
    deckExecutionPlan,
    deckRunInput,
    deckValidation,
    recordDeckWriteReason,
    selectedAgentProjectId,
    v3Blackboard,
  ]);

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
          />
        </div>
      );
    }

    if (selectedCard && selectedCard.kind === "blackboard") {
      if (tab === "Blackboard") {
        return (
          <div className="space-y-3">
            <BlackboardStatePanel title="Blackboard Node" blackboard={v3Blackboard} />
          </div>
        );
      }
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
                projectId={selectedAgentProjectId || "deck-card"}
                agentType="agent_builder"
                activeTab={tab}
                selectedCardId={selectedCard.id}
                promptTestInput={deckRunInput}
                onChangePromptTestInput={setDeckRunInput}
                onRunPromptTest={handleRunSelectedCard}
                promptTestBusy={cardRunBusy}
                promptTestDisabled={cardRunBusy || deckLoadBusy || !selectedAgentProjectId}
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
          />
          <DeckExecutionPathSummary deck={deck} executionPlan={deckExecutionPlan} />
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
                disabled={deckSaveBusy || deckLoadBusy || !selectedAgentProjectId}
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: `1px solid ${C.border}`,
                  background: deckSaveBusy ? C.panel : "#222222",
                  color: C.text,
                  cursor:
                    deckSaveBusy || deckLoadBusy || !selectedAgentProjectId ? "not-allowed" : "pointer",
                }}
              >
                {deckSaveBusy ? "Saving..." : "Save Deck"}
              </button>
              <button
                onClick={handleRunDeck}
                disabled={deckRunBusy || deckLoadBusy || deck.nodes.length === 0 || !selectedAgentProjectId}
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: `1px solid ${deckRunBusy ? C.border : C.primary}`,
                  background: deckRunBusy ? C.panel : "rgba(79,162,173,0.18)",
                  color: C.text,
                  cursor:
                    deckRunBusy || deckLoadBusy || deck.nodes.length === 0 || !selectedAgentProjectId
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

  // TODO: persist to backend project_state.workflow_board
  const refreshProjects = useCallback(async (reason?: string, preferredAssistId?: string, preferredAgentId?: string) => {
    const seq = ++refreshSeq.current;
    const requestType = "projects-refresh";
    const requestSeq = nextRequestSequence(requestType);
    refreshAbortRef.current?.abort();
    const controller = new AbortController();
    refreshAbortRef.current = controller;

    try {
      setProjectsError(null);
      console.debug("[refreshProjects]", {
        reason: reason || "unknown",
        workspaceView,
        seq,
      });
      
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
      const cards = dedupeProjectCards(rawCards);
      const assistCards = cards.filter((card: any) => inferProjectCardType(card) === "assist");
      const agentCards = cards.filter((card: any) => inferProjectCardType(card) === "agent");
      const AGENT_PRIORITY = [
        "main-chat",
        "kg-ingest",
        "thinkgraph",
        "knowgraph",
        "neo4j",
        "research-agent",
        "agent-builder",
      ];
      const orderedAgentCards = [...agentCards].sort((left: any, right: any) => {
        const leftRank = AGENT_PRIORITY.indexOf(normalizeProjectCardKey(left?.code));
        const rightRank = AGENT_PRIORITY.indexOf(normalizeProjectCardKey(right?.code));
        const normalizedLeftRank = leftRank === -1 ? Number.MAX_SAFE_INTEGER : leftRank;
        const normalizedRightRank = rightRank === -1 ? Number.MAX_SAFE_INTEGER : rightRank;
        if (normalizedLeftRank !== normalizedRightRank) {
          return normalizedLeftRank - normalizedRightRank;
        }
        return safeText(left?.name || left?.id).localeCompare(safeText(right?.name || right?.id));
      });

      setProjects(cards);

      const search = new URLSearchParams(window.location.search);
      const urlId = search.get("projectId") || "";
      const urlIdValid = urlId && assistCards.some((card: any) => card.id === urlId);
      const currentAssistId = preferredAssistId || activeProject || "";
      const hasCurrentAssist = currentAssistId && assistCards.some((card: any) => card.id === currentAssistId);
      const nextAssistId =
        (urlIdValid ? urlId : "") || (hasCurrentAssist ? currentAssistId : "") || assistCards[0]?.id || "";
      if (nextAssistId) {
        setActiveProjectWithUrl(nextAssistId);
      } else {
        setActiveProject("");
      }

      const explicitAgentId = preferredAgentId || "";
      const hasExplicitAgent =
        explicitAgentId && orderedAgentCards.some((card: any) => card.id === explicitAgentId);
      const currentAgentId = selectedAgentProjectId || "";
      const hasCurrentAgent = currentAgentId && orderedAgentCards.some((card: any) => card.id === currentAgentId);
      const agentBuilderCard =
        orderedAgentCards.find(
          (card: any) => normalizeProjectCardKey(card?.code) === "agent-builder",
        ) || null;
      const nextAgentId =
        (hasExplicitAgent ? explicitAgentId : "") ||
        agentBuilderCard?.id ||
        (hasCurrentAgent ? currentAgentId : "") ||
        orderedAgentCards[0]?.id ||
        "";
      setSelectedAgentProjectId(nextAgentId);
    } catch (err: any) {
      if (isAbortLikeError(err)) return;
      console.error("Error loading projects:", err);
      if (seq !== refreshSeq.current || !isLatestRequestSequence(requestType, requestSeq)) return;
      setProjectsError(err?.message || 'Error loading projects');
    }
  }, [activeProject, selectedAgentProjectId, setActiveProjectWithUrl, workspaceView]);

  const assistProjects = useMemo(
    () => projects.filter((project: any) => inferProjectCardType(project) === "assist"),
    [projects],
  );

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

  const loadActiveProjectState = useCallback(async (opts?: { force?: boolean; preserveMessagesOnFallback?: boolean }) => {
    if (!activeProject) {
      stateLoadKeyRef.current = "";
      stateLoadProjectRef.current = "";
      return;
    }
    const projectId = activeProject;
    if (!opts?.force && stateLoadKeyRef.current === projectId) return; // Guard duplicate load cascades for the same project selection.
    stateLoadKeyRef.current = projectId;
    const requestType = "project-state-load";
    const requestSeq = nextRequestSequence(requestType);
    stateLoadAbortRef.current?.abort();
    const controller = new AbortController();
    stateLoadAbortRef.current = controller;
    stateLoadProjectRef.current = projectId;
    setStateLoaded(false);
    const stateRefreshStartedAt = Date.now();

    try {
      const endpoint = `${V2_PROJECTS_API}/${projectId}/state`;
      const payload = await guardedRequest({
        key: `project-state:${projectId}`,
        method: "GET",
        ttlMs: 3_000,
        bypassCache: opts?.force,
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
      setPlanSource(payload.data?.plan);
      setPlan(normalizePlanItems(payload.data?.plan));
      setLinks(normalizeLinks(payload.data?.links));
      setStateLoaded(true);
      const completedAt = Date.now();
      emitWorkspaceTestingEvent({
        event: "workspace_state_refresh_completed",
        durationMs: Math.max(0, completedAt - stateRefreshStartedAt),
        metadata: { source: opts?.force ? "remote_forced" : "remote" },
      });
      recordPostResponseRefreshIfPending("workspace_state", completedAt);
    } catch (err) {
      if (
        isAbortLikeError(err) ||
        !isLatestRequestSequence(requestType, requestSeq) ||
        activeProjectLatestRef.current !== projectId
      ) {
        return;
      }
      const next = loadProjectState(projectId);
      if (!opts?.preserveMessagesOnFallback) {
        setMessages(normalizeMessages(next.messages));
      }
      setPlanSource(next.plan);
      setPlan(normalizePlanItems(next.plan));
      setLinks(normalizeLinks(next.links));
      setStateLoaded(true);
      const completedAt = Date.now();
      emitWorkspaceTestingEvent({
        event: "workspace_state_refresh_completed",
        durationMs: Math.max(0, completedAt - stateRefreshStartedAt),
        metadata: { source: "local_fallback" },
      });
      recordPostResponseRefreshIfPending("workspace_state", completedAt);
    } finally {
      if (stateLoadAbortRef.current === controller) {
        stateLoadAbortRef.current = null;
      }
      if (stateLoadProjectRef.current === projectId) {
        stateLoadProjectRef.current = "";
      }
    }
  }, [activeProject, emitWorkspaceTestingEvent, recordPostResponseRefreshIfPending]);

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
      void refreshProjects("mount");
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
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

  const handleSend = (t: string) => {
    const trimmed = t.trim();
    if (!trimmed) return;
    if (sending) return;
    if (!activeProject) return;
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
        responseMode: "assist_runtime",
        turnId,
      },
    });

    setMessages((m) => [...m, { role: "user", text: trimmed }]);
    setSending(true);

    void (async () => {
      try {
        const endpoint = "/api/agents/boss";
        const response = await fetch(endpoint, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            projectId: activeProject,
            message: trimmed,
            turnId,
          }),
        });
        const data = await safeJson(response);
        if (!response.ok || !data?.ok) {
          throw new Error(
            safeText(data?.message || data?.error || "assist_runtime_failed"),
          );
        }
        const assistantText = cleanOptionalText(data?.result?.final) || "No response returned.";
        setMessages((m) => [...m, { role: "assistant", text: assistantText }]);
        const responseReceivedAt = Date.now();
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
            responseMode: "assist_runtime",
            turnId,
            provider: cleanOptionalText(data?.provider),
            model: cleanOptionalText(data?.model),
            stopReason: cleanOptionalText(data?.orchestration?.stopReason),
            turnsUsed:
              typeof data?.orchestration?.turnsUsed === "number"
                ? data.orchestration.turnsUsed
                : null,
          },
        });

        stateLoadKeyRef.current = "";
        void loadActiveProjectState({ force: true, preserveMessagesOnFallback: true });
        loadProjectSubgraph({ force: true });
        window.setTimeout(() => {
          if (activeProjectLatestRef.current !== activeProject) return;
          loadProjectSubgraph({ force: true });
        }, 1500);
      } catch (err: any) {
        const message = formatBuilderStatusMessage(
          err?.message,
          "Chat request failed.",
        );
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
            responseMode: "assist_runtime",
            turnId,
            ok: false,
            error: message,
          },
        });
      } finally {
        setSending(false);
      }
    })();
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

  const createProjectPrompt = async () => {
    const name = window.prompt("New project name?");
    if (!name || !name.trim()) return;
    let code = window.prompt("Project code (optional)") || "";
    code = code.trim();
    if (!code) {
      code = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    }
    
    const projectType = "assist";
    
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
      
      await refreshProjects("after-create", newId);
      
      // Select the new project
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
        <Chat
          messages={messages}
          onSend={handleSend}
          projectId={projectId}
          disabled={sending}
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
            {structuredAssistPlan.goal && (
              <Section title="Goal">
                <div style={{ color: C.text, whiteSpace: "pre-wrap" }}>
                  {safeText(structuredAssistPlan.goal)}
                </div>
              </Section>
            )}

            {structuredAssistPlan.whatMattersNow.length > 0 && (
              <Section title="What Matters Now">
                <ul style={{ paddingLeft: 18, margin: 0, color: C.text }}>
                  {structuredAssistPlan.whatMattersNow.map((item, index) => (
                    <li key={`wmn-${index}`}>{item}</li>
                  ))}
                </ul>
              </Section>
            )}

            {structuredAssistPlan.nextMove && (
              <Section title="Next Move">
                <div style={{ color: C.text, whiteSpace: "pre-wrap" }}>
                  {safeText(structuredAssistPlan.nextMove)}
                </div>
              </Section>
            )}

            {structuredAssistPlan.assumptions.length > 0 && (
              <Section title="Assumptions">
                <ul style={{ paddingLeft: 18, margin: 0, color: C.text }}>
                  {structuredAssistPlan.assumptions.map((item, index) => (
                    <li key={`assumption-${index}`}>{item}</li>
                  ))}
                </ul>
              </Section>
            )}

            {structuredAssistPlan.research.length > 0 && (
              <Section title="Research">
                <ul style={{ paddingLeft: 18, margin: 0, color: C.text }}>
                  {structuredAssistPlan.research.map((item, index) => (
                    <li key={`research-${index}`}>{item}</li>
                  ))}
                </ul>
              </Section>
            )}

            {structuredAssistPlan.openQuestions.length > 0 && (
              <Section title="Open Questions">
                <ul style={{ paddingLeft: 18, margin: 0, color: C.text }}>
                  {structuredAssistPlan.openQuestions.map((item, index) => (
                    <li key={`question-${index}`}>{item}</li>
                  ))}
                </ul>
              </Section>
            )}

            {structuredAssistPlan.humanTasks.length > 0 && (
              <Section title="Human Tasks">
                <ul style={{ paddingLeft: 18, margin: 0, color: C.text }}>
                  {structuredAssistPlan.humanTasks.map((item, index) => (
                    <li key={`human-${index}`}>{item}</li>
                  ))}
                </ul>
              </Section>
            )}

            {structuredAssistPlan.agentTasks.length > 0 && (
              <Section title="Agent Tasks">
                <ul style={{ paddingLeft: 18, margin: 0, color: C.text }}>
                  {structuredAssistPlan.agentTasks.map((item, index) => (
                    <li key={`agent-${index}`}>{item}</li>
                  ))}
                </ul>
              </Section>
            )}

            {structuredAssistPlan.pathOptions.length > 0 && (
              <Section title="Path Options">
                <ul style={{ paddingLeft: 18, margin: 0, color: C.text }}>
                  {structuredAssistPlan.pathOptions.map((item, index) => (
                    <li key={`path-${index}`}>{item}</li>
                  ))}
                </ul>
              </Section>
            )}

            {structuredAssistPlan.hasExplicitPlanDocument && (
              <Section title="Plan Notes">
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
                    emptyText="No plan notes yet."
                  />
                </Suspense>
              </Section>
            )}

            {structuredAssistPlan.whatChanged.length > 0 && (
              <Section title="What Changed">
                <ul style={{ paddingLeft: 18, margin: 0, color: C.text }}>
                  {structuredAssistPlan.whatChanged.map((item, index) => (
                    <li key={`changed-${index}`}>{item}</li>
                  ))}
                </ul>
              </Section>
            )}

            {structuredAssistPlan.sources.length > 0 && (
              <Section title="Sources">
                <ul style={{ paddingLeft: 18, margin: 0, color: C.text }}>
                  {structuredAssistPlan.sources.map((item, index) => (
                    <li key={`source-${index}`}>{item}</li>
                  ))}
                </ul>
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
          <button
            title="Three-lines"
            aria-label="Three-lines"
            data-testid="header-three-lines-button"
            onClick={() => setOpenDrawer("navigation")}
            className="p-2 rounded"
            style={{
              color: C.text,
              background: "transparent",
            }}
          >
            <Icon d="M4 7h16M4 12h16M4 17h16" />
          </button>
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
            title="Plus"
            aria-label="Plus"
            data-testid="rail-plus-button"
            onClick={showCanvasWorkspace}
            className="p-2 rounded"
            style={{ color: workspaceView === "canvas" ? C.primary : C.text }}
          >
            <Icon d="M3 12h18M12 3v18" />
          </button>
          <button
            title="Burst"
            aria-label="Burst"
            data-testid="rail-burst-button"
            onClick={showKnowledgeWorkspace}
            className="p-2 rounded"
            style={{ color: workspaceView === "knowledge" ? C.primary : C.text }}
          >
            <Icon d="M12 1v3M12 20v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M1 12h3M20 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" />
          </button>
          <div className="flex-1" />
          <button
            title="Orange"
            aria-label="Orange"
            data-testid="rail-orange-button"
            onClick={showPlanWorkspace}
            className="p-2 rounded"
            style={{ color: largeSurface === "plan" ? "#ffb86b" : C.text }}
          >
            <Icon d="M3 12l2-2 4 4L21 4" />
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
        <Drawer title="Projects" onClose={() => setOpenDrawer(null)}>
          <div data-testid="navigation-drawer" className="space-y-3">
            <div
              data-testid="drawer-projects-section"
              className="text-xs uppercase mb-2 flex items-center justify-between"
              style={{ color: C.neutral }}
            >
              <span>Chat Projects</span>
              <button
                onClick={createProjectPrompt}
                className="text-[11px] px-2 py-1 rounded"
                style={{ border: `1px solid ${C.border}`, color: C.text }}
              >
                New Project
              </button>
            </div>
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
                            setActiveProject("");
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
          </div>
        </Drawer>
      )}
    </div>
  );
}
