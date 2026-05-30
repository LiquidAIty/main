import type {
  AgentCardInstance,
  DeckDocument,
  DeckEdge,
  MissionDeckPatch,
  MissionSpec,
} from "../../types/agentgraph";

const DEFAULT_SYSTEM_CARD_IDS = [
  "card_plan_agent",
  "card_local_coder",
  "card_thinkgraph_agent",
  "card_knowgraph_agent",
  "card_research_agent",
  "card_codegraph_agent",
] as const;

const AGENT_CARD_MAP: Record<string, string> = {
  plan_agent: "card_plan_agent",
  local_coder: "card_local_coder",
  thinkgraph_agent: "card_thinkgraph_agent",
  knowgraph_agent: "card_knowgraph_agent",
  research_agent: "card_research_agent",
  codegraph_agent: "card_codegraph_agent",
};

function normalizeAgentId(agentId: string): string {
  return String(agentId || "").trim().toLowerCase();
}

export function buildMissionDeckPatch(
  missionSpec: MissionSpec,
  currentDeck: DeckDocument,
): MissionDeckPatch {
  const nodeById = new Map(currentDeck.nodes.map((n) => [n.id, n] as const));
  const nodesToCreate: AgentCardInstance[] = [];
  const nodesToUpdate: Array<Pick<AgentCardInstance, "id"> & Partial<AgentCardInstance>> = [];
  const edgesToCreate: DeckEdge[] = [];
  const edgesToUpdate: Array<Pick<DeckEdge, "id"> & Partial<DeckEdge>> = [];
  const promptFieldsToUpdate: Array<{ nodeId: string; prompt: string }> = [];

  const requiredCards = new Set<string>(DEFAULT_SYSTEM_CARD_IDS);
  for (const run of missionSpec.agentRuns) {
    const mapped = AGENT_CARD_MAP[normalizeAgentId(run.agentId)];
    if (mapped) requiredCards.add(mapped);
  }

  for (const cardId of requiredCards) {
    if (!nodeById.has(cardId)) continue;
    nodesToUpdate.push({ id: cardId, status: "ready" });
  }

  for (const run of missionSpec.agentRuns) {
    const cardId = AGENT_CARD_MAP[normalizeAgentId(run.agentId)];
    if (!cardId || !nodeById.has(cardId)) continue;
    const promptSeed = String(run.promptSeed || "").trim();
    if (promptSeed) {
      promptFieldsToUpdate.push({ nodeId: cardId, prompt: promptSeed });
    }
    // Board ownership rule:
    // mission patching must not infer or auto-create wiring edges from layout/proximity.
    // explicit edge creation can be added later through an explicit mission graph contract.
  }

  return {
    missionSpecId: missionSpec.id,
    nodesToCreate,
    nodesToUpdate,
    edgesToCreate,
    edgesToUpdate,
    promptFieldsToUpdate,
    runState: "wiring",
  };
}

export function applyMissionDeckPatch(
  currentDeck: DeckDocument,
  patch: MissionDeckPatch,
): DeckDocument {
  const nodes = [...currentDeck.nodes];
  const nodeIndexById = new Map(nodes.map((n, i) => [n.id, i] as const));
  for (const node of patch.nodesToCreate) {
    if (nodeIndexById.has(node.id)) continue;
    nodeIndexById.set(node.id, nodes.length);
    nodes.push(node);
  }
  for (const update of patch.nodesToUpdate) {
    const idx = nodeIndexById.get(update.id);
    if (idx == null) continue;
    nodes[idx] = { ...nodes[idx], ...update };
  }
  for (const promptUpdate of patch.promptFieldsToUpdate) {
    const idx = nodeIndexById.get(promptUpdate.nodeId);
    if (idx == null) continue;
    nodes[idx] = { ...nodes[idx], prompt: promptUpdate.prompt };
  }

  const edges = [...currentDeck.edges];
  const edgeIndexById = new Map(edges.map((e, i) => [e.id, i] as const));
  const edgeKey = new Set(edges.map((e) => `${e.source}->${e.target}`));
  for (const edge of patch.edgesToCreate) {
    const key = `${edge.source}->${edge.target}`;
    if (edgeIndexById.has(edge.id) || edgeKey.has(key)) continue;
    edgeIndexById.set(edge.id, edges.length);
    edgeKey.add(key);
    edges.push(edge);
  }
  for (const update of patch.edgesToUpdate) {
    const idx = edgeIndexById.get(update.id);
    if (idx == null) continue;
    edges[idx] = { ...edges[idx], ...update };
  }

  return {
    ...currentDeck,
    nodes,
    edges,
    version: currentDeck.version + 1,
  };
}
