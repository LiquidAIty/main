import type {
  AgentCardInstance,
  AgentCardRuntimeType,
  RuntimeBinding,
} from "../../types/agentgraph";
import { UA_AGENT_DEFINITIONS } from "../../runtime/uaAgentDefinitions";

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

// Addable node presets. Magentic remains seeded/unique.
export const DECK_NODE_PRESETS: DeckNodePreset[] = [
  {
    key: "assist",
    label: "Assist",
    kind: "agent",
    templateId: "template_assist",
    promptTemplateId: "prompt_assist",
    runtimeBinding: "assist",
    runtimeType: "assistant_agent",
    title: "Assist",
    subtitle: "Single worker or swarm worker",
  },
  {
    key: "local_coder",
    label: "Local Coder",
    kind: "agent",
    templateId: "template_local_coder",
    promptTemplateId: "prompt_assist",
    runtimeBinding: "local_coder",
    runtimeType: "local_coder",
    title: "Local Coder",
    subtitle: "Runs via local coder subsystem",
  },
  ...UA_AGENT_DEFINITIONS.map(
    (agent): DeckNodePreset => ({
      key: agent.id,
      label: agent.name,
      kind: "agent",
      templateId: agent.templateId,
      promptTemplateId: agent.promptTemplateId,
      runtimeBinding: agent.runtimeBinding,
      runtimeType: agent.runtimeType,
      title: agent.name,
      subtitle: agent.subtitle,
    }),
  ),
];

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

// Left rail plus handles creation directly from presets.
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
