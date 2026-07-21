import { useCallback, useMemo } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import type { AgentManagerLocalConfig } from '../../../components/AgentManager';
import { resolveEffectiveAgent } from '../../../components/builder/deckRuntime';
import type { LatestCardRunRecord } from '../../../components/builder/useBuilderDeckRuntimeActions';
import type {
  AgentTemplate,
  DeckDocument,
  DeckRun,
} from '../../../types/agentgraph';
import {
  cleanOptionalText,
  normalizeRuntimeBinding,
  normalizeRuntimeOptions,
  normalizeRuntimeType,
} from '../deck/deckPrimitives';
import { INITIAL_AGENT_TEMPLATES } from '../deck/deckSeed';

type UseAgentBuilderCardEditorArgs = {
  deck: DeckDocument;
  recordDeckWriteReason: (reason: string) => void;
  selectedCardId: string | null;
  setDeck: Dispatch<SetStateAction<DeckDocument>>;
  setLatestCardRun: Dispatch<SetStateAction<LatestCardRunRecord | null>>;
  setLatestDeckRun: Dispatch<SetStateAction<DeckRun | null>>;
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

function sameStringArray(
  left: string[] | undefined,
  right: string[] | undefined,
): boolean {
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

export default function useAgentBuilderCardEditor({
  deck,
  recordDeckWriteReason,
  selectedCardId,
  setDeck,
  setLatestCardRun,
  setLatestDeckRun,
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
    if (!effectiveAgent || !selectedCard) return null;
    return {
      runtime_binding: selectedCard.runtimeBinding ?? null,
      runtime_type: selectedCard.runtimeType ?? 'assistant_agent',
      runtime_options: selectedCard.runtimeOptions ?? null,
      parent_graph_id: selectedCard.parentGraphId ?? null,
      provider:
        effectiveAgent.provider === 'openai' ||
        effectiveAgent.provider === 'openrouter' ||
        effectiveAgent.provider === 'local_openai_compatible'
          ? effectiveAgent.provider
          : '',
      model_key: effectiveAgent.model || null,
      temperature: effectiveAgent.temperature ?? null,
      max_tokens: effectiveAgent.maxTokens ?? null,
      prompt_template: selectedCard.prompt || '',
      tools: effectiveAgent.tools,
      knowledge_sources: effectiveAgent.knowledgeSources || [],
      response_format: effectiveAgent.ioSchema
        ? {
            type: 'json_schema',
            name: 'card_schema',
            schema: effectiveAgent.ioSchema,
          }
        : null,
    };
  }, [effectiveAgent, selectedCard]);

  const handleSaveSelectedCardConfig = useCallback(
    (nextConfig: AgentManagerLocalConfig) => {
      if (!selectedCard || !selectedTemplate) return;

      setLatestCardRun(null);
      setLatestDeckRun(null);
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
          tools: nextTools,
        });
        const nextKnowledgeSources = Array.isArray(
          nextConfig.knowledge_sources,
        )
          ? nextConfig.knowledge_sources
              .filter(
                (entry): entry is string => typeof entry === 'string',
              )
              .map((entry) => entry.trim())
              .filter(Boolean)
          : [];
        const nextIoSchema =
          nextConfig.response_format?.type === 'json_schema' &&
          nextConfig.response_format?.schema &&
          typeof nextConfig.response_format.schema === 'object'
            ? (nextConfig.response_format.schema as Record<string, unknown>)
            : null;

        const nextOverrides = compactAgentOverrides({
          provider:
            nextProvider !== (selectedTemplate.provider ?? null)
              ? nextProvider
              : undefined,
          model:
            nextModel !== (selectedTemplate.model ?? null)
              ? nextModel
              : undefined,
          temperature:
            nextTemperature !== (selectedTemplate.temperature ?? null)
              ? nextTemperature
              : undefined,
          maxTokens:
            nextMaxTokens !== (selectedTemplate.maxTokens ?? null)
              ? nextMaxTokens
              : undefined,
          knowledgeSources: !sameStringArray(
            nextKnowledgeSources,
            selectedTemplate.knowledgeSources,
          )
            ? nextKnowledgeSources
            : undefined,
          ioSchema: !sameObjectShape(
            nextIoSchema,
            selectedTemplate.ioSchema,
          )
            ? nextIoSchema || undefined
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
      setLatestCardRun,
      setLatestDeckRun,
    ],
  );

  const handleRenameSelectedCard = useCallback(
    (nextName: string) => {
      if (!selectedCard) return;
      setLatestCardRun(null);
      setLatestDeckRun(null);
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
      setLatestCardRun,
      setLatestDeckRun,
    ],
  );

  const handleUpdateSelectedCardSubtext = useCallback(
    (nextSubtext: string) => {
      if (!selectedCard) return;
      setLatestCardRun(null);
      setLatestDeckRun(null);
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
      setLatestCardRun,
      setLatestDeckRun,
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
