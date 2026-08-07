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
  normalizeRuntimeBinding,
  normalizeRuntimeOptions,
  normalizeRuntimeType,
} from '../deck/deckPrimitives';
import { INITIAL_AGENT_TEMPLATES } from '../deck/newProjectDeck';

type UseAgentBuilderCardEditorArgs = {
  deck: DeckDocument;
  recordDeckWriteReason: (reason: string) => void;
  selectedCardId: string | null;
  setDeck: Dispatch<SetStateAction<DeckDocument>>;
};

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
      runtime_binding: selectedCard.runtimeBinding ?? null,
      runtime_type: selectedCard.runtimeType ?? 'assistant_agent',
      runtime_options: runtimeOptions,
      parent_graph_id: selectedCard.parentGraphId ?? null,
      provider:
        resolvedProvider === 'openai' ||
        resolvedProvider === 'openrouter' ||
        resolvedProvider === 'local_openai_compatible'
          ? resolvedProvider
          : '',
      model_key: runtimeOptions.modelKey ?? effectiveAgent?.model ?? null,
      reasoning_effort: runtimeOptions.reasoningEffort ?? null,
      temperature:
        runtimeOptions.temperature ?? effectiveAgent?.temperature ?? null,
      max_tokens: runtimeOptions.maxTokens ?? effectiveAgent?.maxTokens ?? null,
      prompt_template: selectedCard.prompt || '',
      tools: Array.isArray(runtimeOptions.tools)
        ? runtimeOptions.tools
        : Array.isArray(selectedCard.tools)
          ? selectedCard.tools
          : effectiveAgent?.tools || [],
    };
  }, [effectiveAgent, selectedCard]);

  const handleSaveSelectedCardConfig = useCallback(
    (nextConfig: AgentManagerLocalConfig) => {
      if (!selectedCard) return;

      recordDeckWriteReason('card-editor');
      setDeck((currentDeck) => {
        const nextRuntimeBinding = normalizeRuntimeBinding(
          nextConfig.runtime_binding,
        );
        const nextRuntimeType =
          normalizeRuntimeType(nextConfig.runtime_type) ??
          normalizeRuntimeType(selectedCard.runtimeType) ??
          'assistant_agent';
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
        const nextTools = Array.isArray(nextConfig.tools)
          ? nextConfig.tools
              .filter((tool): tool is string => typeof tool === 'string')
              .map((tool) => tool.trim())
              .filter(Boolean)
          : [];
        const nextRuntimeOptions = normalizeRuntimeOptions({
          ...(nextConfig.runtime_options || {}),
          provider: nextProvider,
          modelKey: nextModel,
          reasoningEffort: nextReasoningEffort,
          temperature: nextTemperature,
          maxTokens: nextMaxTokens,
          tools: nextTools,
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
                  runtimeBinding: nextRuntimeBinding,
                  runtimeType: nextRuntimeType,
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
