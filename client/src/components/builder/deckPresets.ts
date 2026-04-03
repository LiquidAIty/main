import type {
  AgentCardInstance,
  AgentCardRuntimeType,
  RuntimeBinding,
} from "../../types/agentgraph";

export type DeckNodePreset = {
  key: string;
  label: string;
  kind: "agent";
  templateId: string;
  promptTemplateId: string | null;
  runtimeBinding: RuntimeBinding | null;
  runtimeType: AgentCardRuntimeType;
  title: string;
  subtitle: string;
};

export const DECK_NODE_PRESETS: DeckNodePreset[] = [
  {
    key: "magentic",
    label: "Magentic",
    kind: "agent",
    templateId: "template_magentic",
    promptTemplateId: "prompt_magentic",
    runtimeBinding: null,
    runtimeType: "magentic_one",
    title: "Magentic",
    subtitle: "Top-level orchestrator",
  },
  {
    key: "assist",
    label: "Assist",
    kind: "agent",
    templateId: "template_assist",
    promptTemplateId: "prompt_assist",
    runtimeBinding: null,
    runtimeType: "assistant_agent",
    title: "Assist",
    subtitle: "Single worker or swarm worker",
  },
  {
    key: "graph",
    label: "Workflow Compat",
    kind: "agent",
    templateId: "template_graph",
    promptTemplateId: "prompt_graph",
    runtimeBinding: null,
    runtimeType: "graph_flow",
    title: "Workflow Compat",
    subtitle: "Legacy compatibility workflow",
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
    // ignore
  }
  return String(value);
}

export function findDeckNodePreset(key: string): DeckNodePreset | null {
  return DECK_NODE_PRESETS.find((preset) => preset.key === key) || null;
}

export type DeckQuickAddAction = {
  presetKey: DeckNodePreset["key"];
  label: string;
  description: string;
};

export type AssistStarterRecipe = {
  label: string;
  presetKeys: DeckNodePreset["key"][];
  focusNodeIndex: number;
};

function isGraphOwnedCard(anchorCard: AgentCardInstance | null): boolean {
  return Boolean(anchorCard && String(anchorCard.parentGraphId || "").trim());
}

export function getDeckQuickAddActions(anchorCard: AgentCardInstance | null): DeckQuickAddAction[] {
  if (!anchorCard) {
    return [
      {
        presetKey: "magentic",
        label: "Add Magentic",
        description: "Create the top-level orchestrator card.",
      },
      {
        presetKey: "assist",
        label: "Add Assist",
        description: "Create a top-level Assist worker or entry point.",
      },
    ];
  }

  const runtimeType = safeText(anchorCard.runtimeType).trim();
  if (runtimeType === "magentic_one") {
    return [
      {
        presetKey: "assist",
        label: "Add Callable Assist",
        description: "Create a top-level Assist head and connect it with a blue callable edge.",
      },
    ];
  }

  if (runtimeType === "graph_flow") {
    return [
      {
        presetKey: "assist",
        label: "Add First Assist",
        description: "Create the first Assist inside this compatibility workflow.",
      },
    ];
  }

  if (isGraphOwnedCard(anchorCard)) {
    return [
      {
        presetKey: "assist",
        label: "Add Next Assist",
        description: "Create the next Assist in this compatibility workflow and connect it with an orange execution edge.",
      },
    ];
  }

  if (runtimeType === "assistant_agent") {
    return [
      {
        presetKey: "assist",
        label: "Add Next Assist",
        description: "Create another top-level Assist and connect it with an orange execution edge.",
      },
    ];
  }

  return [
    {
      presetKey: "assist",
      label: "Add Top-level Assist",
      description: "Create another top-level Assist card.",
    },
  ];
}

export function getCommonAssistNextPresetKeys(
  anchorCard: AgentCardInstance | null,
): DeckNodePreset["key"][] {
  return getDeckQuickAddActions(anchorCard).map((action) => action.presetKey);
}

export function getAssistStarterRecipe(
  _anchorCard: AgentCardInstance | null,
): AssistStarterRecipe | null {
  return null;
}

export function getDeckQuickAddHelperText(anchorCard: AgentCardInstance | null): string {
  if (!anchorCard) {
    return "Create top-level Magentic and Assist cards here. The graph lives in the visible connections: orange edges carry execution flow and can branch or recombine naturally.";
  }

  const runtimeType = safeText(anchorCard.runtimeType).trim();
  if (runtimeType === "magentic_one") {
    return "Use this card to add callable top-level Assist entry points only. Blue edges are callable orchestration routes from Magentic into the visible graph.";
  }

  if (runtimeType === "graph_flow") {
    return "This is a legacy compatibility workflow card. Keep it only when preserving older decks; new execution structure should live in visible Assist-to-Assist connections.";
  }

  if (isGraphOwnedCard(anchorCard)) {
    return "This Assist already belongs to a legacy compatibility workflow. Adding another Assist here preserves that older path without teaching it as the new default model.";
  }

  if (runtimeType === "assistant_agent") {
    return "Use this Assist card to extend the visible graph. One downstream orange edge makes a sequence, multiple downstream orange edges make a branch, and multiple inbound orange edges create recombination.";
  }

  return "This is a top-level worker card. Add more top-level heads here, or clear selection to add a Magentic card.";
}
