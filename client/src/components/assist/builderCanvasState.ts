import type { AssistPlanState, PlanAgentType, PlanReportNode } from "../../types/plan";

export type BuilderCanvasNodeType =
  | "plan"
  | "main_chat"
  | "thinkgraph"
  | "research"
  | "knowgraph"
  | "review";

export type BuilderCanvasNode = {
  id: string;
  type: BuilderCanvasNodeType;
  label: string;
  sourceKind: "plan" | "agent" | "report";
  sourceId: string;
  agentType: PlanAgentType | null;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type BuilderCanvasEdge = {
  id: string;
  from: string;
  to: string;
  type: "feeds" | "updates" | "reviews";
};

export type BuilderCanvasState = {
  nodes: BuilderCanvasNode[];
  edges: BuilderCanvasEdge[];
};

export type BuilderDeckRef = {
  id: string;
  code: string;
  name: string;
  synthetic?: boolean;
};

type SeedContext = {
  projectId: string;
  decks: BuilderDeckRef[];
  plan: AssistPlanState;
};

const DEFAULT_W = 172;
const DEFAULT_H = 68;

function safeText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    const json = JSON.stringify(value);
    if (typeof json === "string") return json;
  } catch {
    // ignore
  }
  return String(value);
}

function normalizeCode(value: unknown): string {
  return safeText(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeNodeType(value: unknown): BuilderCanvasNodeType | null {
  const normalized = safeText(value).trim().toLowerCase();
  switch (normalized) {
    case "plan":
    case "main_chat":
    case "thinkgraph":
    case "research":
    case "knowgraph":
    case "review":
      return normalized;
    default:
      return null;
  }
}

function normalizeAgentType(value: unknown): PlanAgentType | null {
  const normalized = safeText(value).trim();
  return normalized === "kg_ingest" ||
    normalized === "knowgraph" ||
    normalized === "neo4j" ||
    normalized === "research_agent" ||
    normalized === "agent_builder" ||
    normalized === "llm_chat"
    ? normalized
    : null;
}

function findDeck(decks: BuilderDeckRef[], ...codes: string[]): BuilderDeckRef | null {
  const targets = new Set(codes.map((code) => normalizeCode(code)));
  return decks.find((deck) => targets.has(normalizeCode(deck.code))) || null;
}

function edgeId(from: string, to: string): string {
  return `edge:${from}:${to}`;
}

function reviewSourceId(projectId: string, report: PlanReportNode | undefined): string {
  return safeText(report?.id).trim() || `review:${projectId}`;
}

function createSeedNode(input: {
  id: string;
  type: BuilderCanvasNodeType;
  label: string;
  sourceKind: BuilderCanvasNode["sourceKind"];
  sourceId: string;
  agentType: BuilderCanvasNode["agentType"];
  x: number;
  y: number;
}): BuilderCanvasNode {
  return {
    ...input,
    w: DEFAULT_W,
    h: DEFAULT_H,
  };
}

export function createSeedBuilderCanvasState({ projectId, decks, plan }: SeedContext): BuilderCanvasState {
  const mainChatDeck = findDeck(decks, "main-chat", "llm-chat", "main_chat", "llm_chat");
  const thinkGraphDeck = findDeck(decks, "kg-ingest", "kg_ingest", "thinkgraph");
  const researchDeck = findDeck(decks, "research-agent", "research_agent");
  const knowGraphDeck = findDeck(decks, "knowgraph");
  const latestReport = Array.isArray(plan.report_nodes) ? plan.report_nodes[0] : undefined;
  const reviewId = reviewSourceId(projectId, latestReport);

  const nodes: BuilderCanvasNode[] = [
    createSeedNode({
      id: `plan:${projectId}`,
      type: "plan",
      label: "Plan",
      sourceKind: "plan",
      sourceId: projectId,
      agentType: null,
      x: 360,
      y: 180,
    }),
    createSeedNode({
      id: `agent:${mainChatDeck?.id || "main-chat"}`,
      type: "main_chat",
      label: "Main Chat",
      sourceKind: "agent",
      sourceId: mainChatDeck?.id || "main-chat",
      agentType: "llm_chat",
      x: 70,
      y: 180,
    }),
    createSeedNode({
      id: `agent:${thinkGraphDeck?.id || "kg-ingest"}`,
      type: "thinkgraph",
      label: "ThinkGraph",
      sourceKind: "agent",
      sourceId: thinkGraphDeck?.id || "kg-ingest",
      agentType: "kg_ingest",
      x: 640,
      y: 64,
    }),
    createSeedNode({
      id: `agent:${researchDeck?.id || "research-agent"}`,
      type: "research",
      label: "Research",
      sourceKind: "agent",
      sourceId: researchDeck?.id || "research-agent",
      agentType: "research_agent",
      x: 640,
      y: 292,
    }),
    createSeedNode({
      id: `agent:${knowGraphDeck?.id || "knowgraph"}`,
      type: "knowgraph",
      label: "KnowGraph",
      sourceKind: "agent",
      sourceId: knowGraphDeck?.id || "knowgraph",
      agentType: "knowgraph",
      x: 920,
      y: 180,
    }),
    createSeedNode({
      id: reviewId,
      type: "review",
      label: "Review",
      sourceKind: latestReport ? "report" : "plan",
      sourceId: reviewId,
      agentType: null,
      x: 1200,
      y: 180,
    }),
  ];

  const edges: BuilderCanvasEdge[] = [
    { id: edgeId(nodes[1].id, nodes[0].id), from: nodes[1].id, to: nodes[0].id, type: "feeds" },
    { id: edgeId(nodes[0].id, nodes[2].id), from: nodes[0].id, to: nodes[2].id, type: "feeds" },
    { id: edgeId(nodes[0].id, nodes[3].id), from: nodes[0].id, to: nodes[3].id, type: "feeds" },
    { id: edgeId(nodes[3].id, nodes[4].id), from: nodes[3].id, to: nodes[4].id, type: "updates" },
    { id: edgeId(nodes[4].id, nodes[5].id), from: nodes[4].id, to: nodes[5].id, type: "reviews" },
    { id: edgeId(nodes[5].id, nodes[0].id), from: nodes[5].id, to: nodes[0].id, type: "updates" },
  ];

  return { nodes, edges };
}

export function normalizeBuilderCanvasState(
  raw: unknown,
  context: SeedContext,
): BuilderCanvasState {
  const candidate = raw && typeof raw === "object" ? (raw as any) : null;
  const rawNodes = Array.isArray(candidate?.nodes) ? candidate.nodes : [];
  const rawEdges = Array.isArray(candidate?.edges) ? candidate.edges : [];

  if (!rawNodes.length) {
    return createSeedBuilderCanvasState(context);
  }

  const seenNodeIds = new Set<string>();
  const nodes = rawNodes
    .map((entry: any) => {
      const id = safeText(entry?.id).trim();
      const type = normalizeNodeType(entry?.type);
      if (!id || !type || seenNodeIds.has(id)) return null;
      seenNodeIds.add(id);
      return {
        id,
        type,
        label: safeText(entry?.label).trim() || type.replace(/_/g, " "),
        sourceKind:
          entry?.sourceKind === "agent" || entry?.sourceKind === "report" ? entry.sourceKind : "plan",
        sourceId: safeText(entry?.sourceId).trim() || context.projectId,
        agentType: normalizeAgentType(entry?.agentType),
        x: Number.isFinite(Number(entry?.x)) ? Number(entry.x) : 0,
        y: Number.isFinite(Number(entry?.y)) ? Number(entry.y) : 0,
        w: Number.isFinite(Number(entry?.w)) ? Number(entry.w) : DEFAULT_W,
        h: Number.isFinite(Number(entry?.h)) ? Number(entry.h) : DEFAULT_H,
      } satisfies BuilderCanvasNode;
    })
    .filter((entry): entry is BuilderCanvasNode => Boolean(entry));

  if (!nodes.length) {
    return createSeedBuilderCanvasState(context);
  }

  const validNodeIds = new Set(nodes.map((node) => node.id));
  const seenEdgeIds = new Set<string>();
  const edges = rawEdges
    .map((entry: any) => {
      const from = safeText(entry?.from).trim();
      const to = safeText(entry?.to).trim();
      if (!from || !to || !validNodeIds.has(from) || !validNodeIds.has(to)) return null;
      const id = safeText(entry?.id).trim() || edgeId(from, to);
      if (seenEdgeIds.has(id)) return null;
      seenEdgeIds.add(id);
      return {
        id,
        from,
        to,
        type: entry?.type === "updates" || entry?.type === "reviews" ? entry.type : "feeds",
      } satisfies BuilderCanvasEdge;
    })
    .filter((entry): entry is BuilderCanvasEdge => Boolean(entry));

  return { nodes, edges };
}
