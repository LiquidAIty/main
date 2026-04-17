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

// Only Assist can be added - Magentic is unique and seeded, not addable
export const DECK_NODE_PRESETS: DeckNodePreset[] = [
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

// Only Assist can be added - left rail plus button handles this directly
export function getDeckQuickAddActions(_anchorCard: AgentCardInstance | null): DeckQuickAddAction[] {
  return [];
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

// Helper text removed - left rail plus is the only add mechanism
export function getDeckQuickAddHelperText(_anchorCard: AgentCardInstance | null): string {
  return "";
}
