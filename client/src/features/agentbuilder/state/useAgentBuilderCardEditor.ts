import { useCallback, useMemo } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import type { AgentManagerLocalConfig } from '../../../components/AgentManager';
import { resolveEffectiveAgent } from '../../../components/builder/deckRuntime';
import type {
  AgentTemplate,
  DeckDocument,
} from '../../../types/agentgraph';
import {
  cleanOptionalText,
  normalizeCardRuntime,
  normalizeRuntimeOptions,
} from '../deck/deckPrimitives';
import { INITIAL_AGENT_TEMPLATES } from '../deck/newProjectDeck';

type UseAgentBuilderCardEditorArgs = {
  deck: DeckDocument;
  recordDeckWriteReason: (reason: string) => void;
  selectedCardId: string | null;
  setDeck: Dispatch<SetStateAction<DeckDocument>>;
};

function normalizeStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
}

function resolveAgentTemplate(
  card: DeckDocument['nodes'][number] | null,
): AgentTemplate | null {
  if (!card) return null;
  return (
    INITIAL_AGENT_TEMPLATES.find(
      (template) => template.id === card.templateId,
    ) || null
  );
}

function compactAgentOverrides(
  overrides: Partial<AgentTemplate>,
): Partial<AgentTemplate> | undefined {
  const filtered = Object.fromEntries(
    Object.entries(overrides).filter(([, value]) => value !== undefined),
  ) as Partial<AgentTemplate>;
  return Object.keys(filtered).length > 0 ? filtered : undefined;
}

export default function useAgentBuilderCardEditor({
  deck,
  recordDeckWriteReason,
  selectedCardId,
  setDeck,
}: UseAgentBuilderCardEditorArgs) {
  const selectedCard = useMemo(
    () => deck.nodes.find((node) => node.id === selectedCardId) || null,
    [deck.nodes, selectedCardId],
  );
  const selectedTemplate = useMemo(
    () => resolveAgentTemplate(selectedCard),
    [selectedCard],
  );
  const effectiveAgent = useMemo(
    () =>
      selectedCard
        ? resolveEffectiveAgent(selectedCard, INITIAL_AGENT_TEMPLATES)
        : null,
    [selectedCard],
  );
  const selectedCardConfig = useMemo<AgentManagerLocalConfig | null>(() => {
    if (!selectedCard) return null;
    const runtimeOptions = selectedCard.runtimeOptions || {};
    const resolvedProvider =
      runtimeOptions.provider ?? effectiveAgent?.provider ?? null;
    return {
      runtime: selectedCard.runtime,
      runtime_options: runtimeOptions,
      parent_graph_id: selectedCard.parentGraphId ?? null,
      provider:
        resolvedProvider === 'openai' ||
        resolvedProvider === 'openrouter' ||
        resolvedProvider === 'local_openai_compatible'
          ? resolvedProvider
          : '',
      access_mode:
        runtimeOptions.accessMode === 'chatgpt-account'
        || runtimeOptions.accessMode === 'openai-api'
        || runtimeOptions.accessMode === 'openrouter-api'
          ? runtimeOptions.accessMode
          : '',
      model_key: runtimeOptions.modelKey ?? effectiveAgent?.model ?? null,
      reasoning_effort: runtimeOptions.reasoningEffort ?? null,
      temperature:
        runtimeOptions.temperature ?? effectiveAgent?.temperature ?? null,
      max_tokens: runtimeOptions.maxTokens ?? effectiveAgent?.maxTokens ?? null,
      max_turns: runtimeOptions.maxTurns ?? null,
      prompt_template: selectedCard.prompt || '',
      tools: Array.isArray(runtimeOptions.tools)
        ? runtimeOptions.tools
        : Array.isArray(selectedCard.tools)
          ? selectedCard.tools
          : effectiveAgent?.tools || [],
      skills: normalizeStringList(runtimeOptions.skills),
      toolsets: normalizeStringList(runtimeOptions.toolsets),
      mcp_connection_ids: normalizeStringList(runtimeOptions.mcpConnectionIds),
    };
  }, [effectiveAgent, selectedCard]);

  const handleSaveSelectedCardConfig = useCallback(
    (nextConfig: AgentManagerLocalConfig) => {
      if (!selectedCard) return;

      recordDeckWriteReason('card-editor');
      setDeck((currentDeck) => {
        const nextRuntime = normalizeCardRuntime(nextConfig.runtime);
        if (!nextRuntime) throw new Error('card_runtime_invalid');
        const nextParentGraphId = cleanOptionalText(
          nextConfig.parent_graph_id,
        );
        const nextProvider =
          nextConfig.provider === 'openai' ||
          nextConfig.provider === 'openrouter' ||
          nextConfig.provider === 'local_openai_compatible'
            ? nextConfig.provider
            : null;
        const nextModel = String(nextConfig.model_key || '').trim() || null;
        const nextAccessMode =
          nextConfig.access_mode === 'chatgpt-account'
          || nextConfig.access_mode === 'openai-api'
          || nextConfig.access_mode === 'openrouter-api'
            ? nextConfig.access_mode
            : null;
        const nextReasoningEffort =
          nextConfig.reasoning_effort === 'low' ||
          nextConfig.reasoning_effort === 'medium' ||
          nextConfig.reasoning_effort === 'high' ||
          nextConfig.reasoning_effort === 'xhigh'
            ? nextConfig.reasoning_effort
            : null;
        const nextTemperature =
          typeof nextConfig.temperature === 'number'
            ? nextConfig.temperature
            : null;
        const nextMaxTokens =
          typeof nextConfig.max_tokens === 'number'
            ? nextConfig.max_tokens
            : null;
        const nextMaxTurns =
          typeof nextConfig.max_turns === 'number'
            ? nextConfig.max_turns
            : null;
        const nextTools = normalizeStringList(nextConfig.tools);
        const nextRuntimeOptions = normalizeRuntimeOptions({
          ...(nextConfig.runtime_options || {}),
          provider: nextProvider,
          accessMode: nextAccessMode,
          modelKey: nextModel,
          reasoningEffort: nextReasoningEffort,
          temperature: nextTemperature,
          maxTokens: nextMaxTokens,
          maxTurns: nextMaxTurns,
          tools: nextTools,
          skills: normalizeStringList(nextConfig.skills),
          toolsets: normalizeStringList(nextConfig.toolsets),
          mcpConnectionIds: normalizeStringList(nextConfig.mcp_connection_ids),
        });
        const nextOverrides = compactAgentOverrides({
          ...(selectedCard.overrides || {}),
          provider:
            !selectedTemplate ||
            nextProvider !== (selectedTemplate.provider ?? null)
              ? nextProvider
              : undefined,
          model:
            !selectedTemplate || nextModel !== (selectedTemplate.model ?? null)
              ? nextModel
              : undefined,
          temperature:
            !selectedTemplate ||
            nextTemperature !== (selectedTemplate.temperature ?? null)
              ? nextTemperature
              : undefined,
          maxTokens:
            !selectedTemplate ||
            nextMaxTokens !== (selectedTemplate.maxTokens ?? null)
              ? nextMaxTokens
              : undefined,
        });

        return {
          ...currentDeck,
          version: currentDeck.version + 1,
          nodes: currentDeck.nodes.map((node) =>
            node.id === selectedCard.id
              ? {
                  ...node,
                  prompt: String(nextConfig.prompt_template || ''),
                  runtime: nextRuntime,
                  runtimeOptions: nextRuntimeOptions,
                  parentGraphId: nextParentGraphId,
                  overrides: nextOverrides,
                }
              : node,
          ),
        };
      });
    },
    [
      recordDeckWriteReason,
      selectedCard,
      selectedTemplate,
      setDeck,
    ],
  );

  const handleRenameSelectedCard = useCallback(
    (nextName: string) => {
      if (!selectedCard) return;
      recordDeckWriteReason('card-rename');
      setDeck((currentDeck) => ({
        ...currentDeck,
        version: currentDeck.version + 1,
        nodes: currentDeck.nodes.map((node) =>
          node.id === selectedCard.id
            ? { ...node, title: nextName }
            : node,
        ),
      }));
    },
    [
      recordDeckWriteReason,
      selectedCard,
      setDeck,
    ],
  );

  const handleUpdateSelectedCardSubtext = useCallback(
    (nextSubtext: string) => {
      if (!selectedCard) return;
      recordDeckWriteReason('card-subtitle-update');
      setDeck((currentDeck) => ({
        ...currentDeck,
        version: currentDeck.version + 1,
        nodes: currentDeck.nodes.map((node) =>
          node.id === selectedCard.id
            ? {
                ...node,
                subtitle:
                  nextSubtext.length > 0 ? nextSubtext : undefined,
              }
            : node,
        ),
      }));
    },
    [
      recordDeckWriteReason,
      selectedCard,
      setDeck,
    ],
  );

  return {
    effectiveAgent,
    handleRenameSelectedCard,
    handleSaveSelectedCardConfig,
    handleUpdateSelectedCardSubtext,
    selectedCard,
    selectedCardConfig,
  };
}
