import type { AgentCardInstance, RuntimeBinding } from "../../types/agentgraph";

export type DeckNodePreset = {
  key: string;
  label: string;
  kind: "agent" | "blackboard";
  templateId: string;
  promptTemplateId: string | null;
  runtimeBinding: RuntimeBinding | null;
  title: string;
  subtitle: string;
};

export const DECK_NODE_PRESETS: DeckNodePreset[] = [
  {
    key: "main_chat",
    label: "Main Chat",
    kind: "agent",
    templateId: "template_main_chat",
    promptTemplateId: "prompt_main_chat",
    runtimeBinding: "main_chat",
    title: "Main Chat",
    subtitle: "Reply / front door",
  },
  {
    key: "kg_ingest",
    label: "ThinkGraph",
    kind: "agent",
    templateId: "template_kg_ingest",
    promptTemplateId: "prompt_kg_ingest",
    runtimeBinding: "kg_ingest",
    title: "ThinkGraph / Extract",
    subtitle: "Extract entities, relations, and open gaps",
  },
  {
    key: "research",
    label: "Research Worker",
    kind: "agent",
    templateId: "template_research",
    promptTemplateId: "prompt_research",
    runtimeBinding: "research_agent",
    title: "Research Worker",
    subtitle: "Investigate gaps and gather evidence",
  },
  {
    key: "summary",
    label: "Summary Step",
    kind: "agent",
    templateId: "template_main_chat",
    promptTemplateId: "prompt_main_chat",
    runtimeBinding: null,
    title: "Summary Step",
    subtitle: "Merge current work into a concise next-step summary",
  },
  {
    key: "knowgraph",
    label: "KnowGraph",
    kind: "agent",
    templateId: "template_knowgraph",
    promptTemplateId: "prompt_knowgraph",
    runtimeBinding: "knowgraph",
    title: "KnowGraph / Grounding",
    subtitle: "Normalize evidence into grounded knowledge",
  },
  {
    key: "neo4j",
    label: "Graph Write",
    kind: "agent",
    templateId: "template_neo4j",
    promptTemplateId: "prompt_neo4j",
    runtimeBinding: "neo4j",
    title: "Graph Write",
    subtitle: "Prepare graph persistence work",
  },
  {
    key: "blackboard",
    label: "Blackboard",
    kind: "blackboard",
    templateId: "template_blackboard",
    promptTemplateId: null,
    runtimeBinding: null,
    title: "Blackboard",
    subtitle: "Explicit shared memory",
  },
];

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

export function findDeckNodePreset(key: string): DeckNodePreset | null {
  return DECK_NODE_PRESETS.find((preset) => preset.key === key) || null;
}

export function isSummaryCard(card: AgentCardInstance | null): boolean {
  if (!card) return false;
  return (
    card.kind !== "blackboard" &&
    card.templateId === "template_main_chat" &&
    !card.runtimeBinding &&
    /summary/i.test(safeText(card.title))
  );
}

export function getCommonAssistNextPresetKeys(anchorCard: AgentCardInstance | null): string[] {
  if (!anchorCard) {
    return ["main_chat", "kg_ingest", "research", "summary", "blackboard"];
  }

  if (anchorCard.kind === "blackboard") {
    return ["main_chat", "summary", "research"];
  }

  if (anchorCard.runtimeBinding === "main_chat") {
    return ["kg_ingest", "summary", "blackboard"];
  }

  if (anchorCard.runtimeBinding === "kg_ingest") {
    return ["research", "summary", "blackboard"];
  }

  if (anchorCard.runtimeBinding === "research_agent") {
    return ["blackboard", "knowgraph", "summary"];
  }

  if (anchorCard.runtimeBinding === "knowgraph") {
    return ["neo4j", "summary", "blackboard"];
  }

  if (anchorCard.runtimeBinding === "neo4j") {
    return ["summary", "blackboard", "main_chat"];
  }

  if (isSummaryCard(anchorCard)) {
    return ["blackboard", "main_chat", "research"];
  }

  return ["research", "summary", "blackboard"];
}

export type AssistStarterRecipe = {
  label: string;
  presetKeys: string[];
  focusNodeIndex: number;
};

export function getAssistStarterRecipe(anchorCard: AgentCardInstance | null): AssistStarterRecipe | null {
  if (!anchorCard) {
    return {
      label: "Add Assist Starter",
      presetKeys: ["main_chat", "kg_ingest", "research", "summary", "blackboard"],
      focusNodeIndex: 0,
    };
  }

  if (anchorCard.kind === "blackboard") {
    return null;
  }

  if (anchorCard.runtimeBinding === "main_chat") {
    return {
      label: "Add Assist Tail",
      presetKeys: ["kg_ingest", "research", "summary", "blackboard"],
      focusNodeIndex: 0,
    };
  }

  if (anchorCard.runtimeBinding === "kg_ingest") {
    return {
      label: "Add Research Tail",
      presetKeys: ["research", "summary", "blackboard"],
      focusNodeIndex: 0,
    };
  }

  if (anchorCard.runtimeBinding === "research_agent") {
    return {
      label: "Add Summary Tail",
      presetKeys: ["summary", "blackboard"],
      focusNodeIndex: 0,
    };
  }

  if (isSummaryCard(anchorCard)) {
    return {
      label: "Add Blackboard Sink",
      presetKeys: ["blackboard"],
      focusNodeIndex: 0,
    };
  }

  return null;
}
