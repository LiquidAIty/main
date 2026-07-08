// Deck document logic: normalization, hydration, legacy upgrade, quick-add
// mutations, single-card-run scoping, and the Coder controller card
// normalization. Extracted verbatim from pages/agentbuilder.tsx
// (decomposition pass 2026-07-08). Behavior and saved-deck compatibility
// unchanged.
import type {
  AgentCardInstance,
  DeckDocument,
  DeckEdge,
  DeckEdgeType,
  PromptTemplate,
} from '../../../types/agentgraph';
import {
  findDeckNodePreset,
  getAssistStarterRecipe,
  type AssistStarterRecipe,
  type DeckNodePreset,
} from '../../../components/builder/deckPresets';
import {
  buildDefaultDeckEdgeMetadata,
  sanitizeDeckEdges,
} from '../../../components/builder/deckValidation';
import {
  cleanOptionalText,
  cloneDeckDocument,
  isAssistLikeRuntimeType,
  isLegacyUaCard,
  LOCAL_CODER_CONTROLLER_MODEL_KEY,
  LOCAL_CODER_CONTROLLER_PROVIDER,
  LOCAL_CODER_CONTROLLER_TOOLS,
  normalizeDeckEdgeType,
  normalizeRuntimeBinding,
  normalizeRuntimeOptions,
  normalizeRuntimeType,
  safeText,
  STALE_LOCAL_CODER_MODEL_KEYS,
  uid,
} from './deckPrimitives';
import {
  BASELINE_OPTIONAL_CARD_IDS,
  INITIAL_AGENT_TEMPLATES,
  INITIAL_DECK,
  INITIAL_PROMPT_TEMPLATES,
  LEGACY_SYSTEM_CARD_IDS,
  REMOVED_DEFAULT_CARD_IDS,
  REMOVED_DEFAULT_EDGE_IDS,
  SYSTEM_CARD_RUNTIME_BINDINGS,
} from './deckSeed';

export function isLocalCoderControllerCard(card: AgentCardInstance | null | undefined): boolean {
  if (!card) return false;
  return (
    safeText(card.id).trim().toLowerCase() === 'card_local_coder' ||
    safeText(card.runtimeBinding).trim().toLowerCase() === 'local_coder' ||
    safeText(card.runtimeType).trim().toLowerCase() === 'local_coder' ||
    safeText(card.templateId).trim().toLowerCase() === 'template_local_coder'
  );
}

export function isStaleLocalCoderModel(modelKey: string | null): boolean {
  return Boolean(modelKey && STALE_LOCAL_CODER_MODEL_KEYS.has(modelKey));
}

export function normalizeLocalCoderControllerCard(card: AgentCardInstance): AgentCardInstance {
  if (!isLocalCoderControllerCard(card)) return card;
  const runtimeOptions = normalizeRuntimeOptions(card.runtimeOptions) ?? {};
  const modelKey = cleanOptionalText(runtimeOptions.modelKey);
  const provider = cleanOptionalText(runtimeOptions.provider);
  const shouldUseControllerDefault = !modelKey || isStaleLocalCoderModel(modelKey);
  return {
    ...card,
    runtimeBinding: 'local_coder',
    runtimeType: 'local_coder',
    runtimeOptions: {
      ...runtimeOptions,
      provider:
        shouldUseControllerDefault || !provider
          ? LOCAL_CODER_CONTROLLER_PROVIDER
          : runtimeOptions.provider,
      modelKey: shouldUseControllerDefault
        ? LOCAL_CODER_CONTROLLER_MODEL_KEY
        : runtimeOptions.modelKey,
      tools: Array.from(new Set([
        ...LOCAL_CODER_CONTROLLER_TOOLS,
        ...(Array.isArray(runtimeOptions.tools)
          ? runtimeOptions.tools.map((tool) => safeText(tool).trim()).filter(Boolean)
          : []),
      ])),
    },
  };
}

export function resolveLocalCoderControllerConsoleConfig(
  deck: Pick<DeckDocument, 'nodes'>,
): { provider: string; model: string } {
  const card = deck.nodes.find(isLocalCoderControllerCard) || null;
  const runtimeOptions = normalizeRuntimeOptions(card?.runtimeOptions) ?? {};
  const template =
    INITIAL_AGENT_TEMPLATES.find((candidate) => candidate.id === card?.templateId) ||
    INITIAL_AGENT_TEMPLATES.find((candidate) => candidate.id === 'template_local_coder') ||
    null;
  const rawModel =
    cleanOptionalText(runtimeOptions.modelKey) ||
    cleanOptionalText(template?.model) ||
    LOCAL_CODER_CONTROLLER_MODEL_KEY;
  const shouldUseControllerDefault = isStaleLocalCoderModel(rawModel);
  return {
    provider:
      shouldUseControllerDefault
        ? LOCAL_CODER_CONTROLLER_PROVIDER
        : cleanOptionalText(runtimeOptions.provider) ||
          cleanOptionalText(template?.provider) ||
          LOCAL_CODER_CONTROLLER_PROVIDER,
    model: shouldUseControllerDefault ? LOCAL_CODER_CONTROLLER_MODEL_KEY : rawModel,
  };
}


export function isTopLevelCanvasCard(
  node: AgentCardInstance | null | undefined,
): node is AgentCardInstance {
  return Boolean(node && !cleanOptionalText(node.parentGraphId));
}

export function isAssistCanvasCard(
  node: AgentCardInstance | null | undefined,
): node is AgentCardInstance {
  return Boolean(node && isAssistLikeRuntimeType(normalizeRuntimeType(node.runtimeType)));
}

export function isVisibleAssistFlowPair(
  sourceNode: AgentCardInstance | null | undefined,
  targetNode: AgentCardInstance | null | undefined,
): boolean {
  if (!isAssistCanvasCard(sourceNode) || !isAssistCanvasCard(targetNode))
    return false;

  const sourceGraphId = cleanOptionalText(sourceNode.parentGraphId);
  const targetGraphId = cleanOptionalText(targetNode.parentGraphId);

  if (!sourceGraphId && !targetGraphId) {
    return true;
  }

  return Boolean(sourceGraphId && sourceGraphId === targetGraphId);
}

export function collectVisibleAssistFlowIds(
  document: DeckDocument,
  startNodeId: string,
): Set<string> {
  const nodeMap = new Map(
    document.nodes.map((node) => [node.id, node] as const),
  );
  const visited = new Set<string>();
  const queue = [startNodeId];

  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId || visited.has(nodeId)) continue;
    visited.add(nodeId);

    document.edges.forEach((edge) => {
      if (normalizeDeckEdgeType(edge.edgeType) !== 'flow') return;
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

export function collectGraphScopedNodeIds(
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

export function buildSingleCardRunNodeScope(
  document: DeckDocument,
  selectedNode: AgentCardInstance,
): Set<string> {
  const nodeMap = new Map(
    document.nodes.map((node) => [node.id, node] as const),
  );
  const relatedNodeIds = new Set<string>();
  const selectedNodeId = selectedNode.id;
  const selectedRuntimeType = normalizeRuntimeType(selectedNode.runtimeType);
  const selectedParentGraphId = cleanOptionalText(selectedNode.parentGraphId);

  if (selectedParentGraphId) {
    return collectGraphScopedNodeIds(document, selectedParentGraphId);
  }

  if (
    selectedRuntimeType === 'magentic_one' &&
    isTopLevelCanvasCard(selectedNode)
  ) {
    relatedNodeIds.add(selectedNodeId);

    document.edges.forEach((edge) => {
      if (
        edge.source !== selectedNodeId ||
        normalizeDeckEdgeType(edge.edgeType) !== 'magentic_option'
      ) {
        return;
      }

      const targetNode = nodeMap.get(edge.target);
      if (!targetNode) return;

      const targetRuntimeType = normalizeRuntimeType(targetNode.runtimeType);
      if (
        targetRuntimeType === 'graph_flow' &&
        isTopLevelCanvasCard(targetNode)
      ) {
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

  if (
    selectedRuntimeType === 'graph_flow' &&
    isTopLevelCanvasCard(selectedNode)
  ) {
    return collectGraphScopedNodeIds(document, selectedNodeId);
  }

  if (isAssistCanvasCard(selectedNode) && isTopLevelCanvasCard(selectedNode)) {
    return collectVisibleAssistFlowIds(document, selectedNodeId);
  }

  relatedNodeIds.add(selectedNodeId);
  return relatedNodeIds;
}

export function buildSingleCardRunDocument(
  document: DeckDocument,
  cardId: string,
): DeckDocument | null {
  const selectedNode = document.nodes.find((node) => node.id === cardId);
  if (!selectedNode) return null;
  const relatedNodeIds = buildSingleCardRunNodeScope(document, selectedNode);

  return {
    ...document,
    nodes: document.nodes.filter((node) => relatedNodeIds.has(node.id)),
    edges: document.edges.filter(
      (edge) =>
        relatedNodeIds.has(edge.source) && relatedNodeIds.has(edge.target),
    ),
  };
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

      const edgeType = normalizeDeckEdgeType(edge.edgeType);
      if (edgeType === 'magentic_option') {
        return (
          normalizeRuntimeType(sourceNode.runtimeType) === 'magentic_one' &&
          isTopLevelCanvasCard(sourceNode) &&
          isTopLevelCanvasCard(targetNode) &&
          ['assistant_agent', 'local_coder', 'graph_flow'].includes(
            normalizeRuntimeType(targetNode.runtimeType) || '',
          )
        );
      }

      if (
        normalizeRuntimeType(sourceNode.runtimeType) === 'graph_flow' &&
        cleanOptionalText(targetNode.parentGraphId) === sourceNode.id
      ) {
        return true;
      }

      return isVisibleAssistFlowPair(sourceNode, targetNode);
    })
    .map((edge) => cloneDeckDocument(edge));
}

export function normalizeDeckNodes(value: unknown): AgentCardInstance[] {
  if (!Array.isArray(value)) {
    return cloneDeckDocument(INITIAL_DECK.nodes);
  }
  if (value.length === 0) {
    return [];
  }
  const nextNodes = value.filter((node): node is AgentCardInstance =>
    Boolean(
      node &&
      typeof node === 'object' &&
      !REMOVED_DEFAULT_CARD_IDS.has(
        safeText((node as Partial<AgentCardInstance>).id).trim(),
      ) &&
      safeText((node as Partial<AgentCardInstance>).kind)
        .trim()
        .toLowerCase() !== 'blackboard' &&
      typeof (node as AgentCardInstance).id === 'string' &&
      typeof (node as AgentCardInstance).templateId === 'string',
    ),
  );
  const normalizedNodes =
    nextNodes.length > 0
      ? nextNodes.map((node) => ({
        id: safeText(node.id).trim(),
        kind: 'agent' as const,
        templateId: safeText(node.templateId).trim(),
        prompt: typeof node.prompt === 'string' ? node.prompt : '',
        runtimeBinding: normalizeRuntimeBinding(
          node.runtimeBinding ??
            SYSTEM_CARD_RUNTIME_BINDINGS[safeText(node.id).trim()] ??
            null,
        ),
        runtimeType:
          normalizeRuntimeType(node.runtimeType) ?? 'assistant_agent',
        runtimeOptions: normalizeRuntimeOptions(node.runtimeOptions),
        parentGraphId: cleanOptionalText(node.parentGraphId),
        title:
          safeText(node.title || node.id).trim() || safeText(node.id).trim(),
        subtitle: typeof node.subtitle === 'string' ? node.subtitle : undefined,
        position:
          node.position && typeof node.position === 'object'
            ? {
                x: Number((node.position as { x?: unknown }).x) || 0,
                y: Number((node.position as { y?: unknown }).y) || 0,
              }
            : { x: 0, y: 0 },
        overrides: node.overrides,
        status:
          node.status === 'idle' ||
          node.status === 'ready' ||
          node.status === 'running' ||
          node.status === 'error'
            ? node.status
            : undefined,
        cloneConfig:
          node.cloneConfig && typeof node.cloneConfig === 'object'
            ? node.cloneConfig
            : undefined,
      }))
      : [];
  return normalizedNodes.filter((node) => !isLegacyUaCard(node));
}

export function normalizeDeckPromptTemplates(value: unknown): PromptTemplate[] {
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
        typeof template === 'object' &&
        typeof (template as PromptTemplate).id === 'string' &&
        typeof (template as PromptTemplate).content === 'string',
      ),
  );
  return nextPromptTemplates.length > 0
    ? cloneDeckDocument(nextPromptTemplates)
    : cloneDeckDocument(INITIAL_PROMPT_TEMPLATES);
}

export function normalizeDeckEdges(value: unknown): DeckEdge[] {
  if (!Array.isArray(value)) {
    return cloneDeckDocument(INITIAL_DECK.edges);
  }
  return cloneDeckDocument(
    sanitizeDeckEdges(value).filter(
      (edge) =>
        safeText(edge.id).trim() !== 'edge_magentic_thinkgraph' &&
        !REMOVED_DEFAULT_EDGE_IDS.has(safeText(edge.id).trim()),
    ),
  );
}

export function slugifyDeckIdPart(value: string): string {
  return (
    safeText(value)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'card'
  );
}

export function buildDeckNodeFromPreset(
  preset: DeckNodePreset,
  promptTemplates: PromptTemplate[],
  position: { x: number; y: number },
  options: {
    title?: string;
    parentGraphId?: string | null;
  } = {},
): AgentCardInstance {
  const promptTemplateContent = preset.promptTemplateId
    ? promptTemplates.find(
        (template) => template.id === preset.promptTemplateId,
      )?.content ||
      INITIAL_PROMPT_TEMPLATES.find(
        (template) => template.id === preset.promptTemplateId,
      )?.content ||
      ''
    : '';
  const slug = slugifyDeckIdPart(preset.key);

  return {
    id: `card_${slug}_${uid()}`,
    kind: 'agent',
    templateId: preset.templateId,
    prompt: promptTemplateContent,
    runtimeBinding: preset.runtimeBinding,
    runtimeType: preset.runtimeType,
    runtimeOptions: null,
    parentGraphId: cleanOptionalText(options.parentGraphId),
    title: options.title || preset.title,
    subtitle: preset.subtitle,
    position,
    status: 'ready',
    cloneConfig: { enabled: false, seeds: [] },
  };
}

export function getNextGraphScopedAssistTitle(
  deck: DeckDocument,
  graphOwnerId: string,
): string {
  const assistCount = deck.nodes.filter(
    (node) =>
      cleanOptionalText(node.parentGraphId) === graphOwnerId &&
      isAssistLikeRuntimeType(normalizeRuntimeType(node.runtimeType)),
  ).length;
  return `Assist ${assistCount + 1}`;
}

export function resolveQuickAddParentGraphId(
  preset: DeckNodePreset,
  anchorNode: AgentCardInstance | null,
): string | null {
  if (
    (preset.runtimeType !== 'assistant_agent' &&
      preset.runtimeType !== 'local_coder') ||
    !anchorNode
  ) {
    return null;
  }

  const anchorParentGraphId = cleanOptionalText(anchorNode.parentGraphId);
  if (anchorParentGraphId) {
    return anchorParentGraphId;
  }

  if (
    normalizeRuntimeType(anchorNode.runtimeType) === 'graph_flow' &&
    isTopLevelCanvasCard(anchorNode)
  ) {
    return anchorNode.id;
  }

  return null;
}

export function resolveQuickAddEdge(
  anchorNode: AgentCardInstance | null,
  nextNode: AgentCardInstance,
): DeckEdge | null {
  if (!anchorNode) return null;

  const anchorRuntimeType = normalizeRuntimeType(anchorNode.runtimeType);
  const nextRuntimeType = normalizeRuntimeType(nextNode.runtimeType);
  let edgeType: DeckEdgeType | null = null;

  if (
    anchorRuntimeType === 'magentic_one' &&
    isTopLevelCanvasCard(anchorNode) &&
    isTopLevelCanvasCard(nextNode) &&
    (nextRuntimeType === 'assistant_agent' ||
      nextRuntimeType === 'local_coder' ||
      nextRuntimeType === 'graph_flow')
  ) {
    edgeType = 'magentic_option';
  } else if (isVisibleAssistFlowPair(anchorNode, nextNode)) {
    edgeType = 'flow';
  }

  if (!edgeType) return null;

  const legacyCompatibility = Boolean(
    anchorRuntimeType === 'graph_flow' ||
    nextRuntimeType === 'graph_flow' ||
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

export function getSuggestedDeckNodePosition(
  deck: DeckDocument,
  preset: DeckNodePreset,
  anchorNode: AgentCardInstance | null,
): { x: number; y: number } {
  if (anchorNode) {
    const outgoingCount = deck.edges.filter(
      (edge) => edge.source === anchorNode.id,
    ).length;
    return {
      x: anchorNode.position.x + 320,
      y: anchorNode.position.y + outgoingCount * 180,
    };
  }

  const rightMostX = deck.nodes.reduce(
    (max, node) => Math.max(max, node.position.x),
    -220,
  );
  const nextColumnX = rightMostX + 320;
  const visibleTopLevelAgentXs = deck.nodes
    .filter(
      (node) =>
        !cleanOptionalText(node.parentGraphId) &&
        normalizeRuntimeType(node.runtimeType) !== 'magentic_one',
    )
    .map((node) => node.position.x);
  const wrappedColumnX =
    nextColumnX > 1040 && visibleTopLevelAgentXs.length > 0
      ? Math.min(...visibleTopLevelAgentXs)
      : nextColumnX;
  const occupiedInNextColumn = deck.nodes.filter(
    (node) => Math.abs(node.position.x - wrappedColumnX) < 72,
  ).length;
  return {
    x: wrappedColumnX,
    y: (wrappedColumnX === nextColumnX ? 40 : 140) + occupiedInNextColumn * 180,
  };
}

export function buildQuickAddDeckMutation(
  deck: DeckDocument,
  preset: DeckNodePreset,
  anchorNodeId: string | null,
): {
  nextDeck: DeckDocument;
  nextNode: AgentCardInstance;
  nextEdge: DeckEdge | null;
} {
  const anchorNode =
    deck.nodes.find((node) => node.id === anchorNodeId) || null;
  const nextParentGraphId = resolveQuickAddParentGraphId(preset, anchorNode);
  const nextTitle =
    nextParentGraphId &&
    (preset.runtimeType === 'assistant_agent' ||
      preset.runtimeType === 'local_coder')
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
  const anchorNode =
    deck.nodes.find((node) => node.id === anchorNodeId) || null;
  const recipe = getAssistStarterRecipe(anchorNode);
  if (!recipe) return null;

  let workingDeck = deck;
  let workingAnchorId = anchorNodeId;
  const createdNodes: AgentCardInstance[] = [];
  const createdEdges: DeckEdge[] = [];

  recipe.presetKeys.forEach((presetKey) => {
    const preset = findDeckNodePreset(presetKey);
    if (!preset) return;

    const mutation = buildQuickAddDeckMutation(
      workingDeck,
      preset,
      workingAnchorId,
    );
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
    focusNodeId:
      createdNodes[recipe.focusNodeIndex]?.id || createdNodes[0]?.id || null,
    recipe,
  };
}

export function formatBuilderStatusMessage(
  message: unknown,
  fallback: string,
): string {
  const text = String(message || '').trim();
  const lower = text.toLowerCase();
  if (!text) return fallback;
  if (text === 'project_not_found')
    return 'Canvas data is unavailable for this selection.';
  if (text === 'deck_load_failed') return 'Canvas data could not be loaded.';
  if (text === 'deck_save_failed') return 'Could not save the current board.';
  if (text === 'card_run_failed') return 'Card run failed.';
  if (text === 'deck_run_failed') return 'Board run failed.';
  if (text === 'template_not_found')
    return 'The selected card template could not be resolved.';
  if (text === 'templates_required')
    return 'The selected card could not be run because its template set was missing.';
  if (text === 'card_required')
    return 'No card was provided to the backend run path.';
  if (
    lower.includes('insufficient_quota') ||
    lower.includes('quota exceeded') ||
    (lower.includes('quota') && lower.includes('billing'))
  ) {
    return 'The configured model could not run because provider quota or billing is unavailable right now.';
  }
  if (lower.includes('rate limit') || lower.includes('too many requests')) {
    return 'The configured model is rate-limited right now. Try this card again shortly.';
  }
  if (
    lower.includes('unauthorized') ||
    lower.includes('authentication') ||
    lower.includes('invalid api key') ||
    lower.includes('incorrect api key')
  ) {
    return 'The configured model request was rejected by the provider. Check the backend credentials for this card.';
  }
  if (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('econnrefused') ||
    lower.includes('load failed')
  ) {
    return 'The Builder backend is unavailable right now.';
  }
  if (lower.includes('timed out') || lower.includes('timeout')) {
    return 'The configured model timed out before the card completed.';
  }
  return text;
}

export function seedCurrentSystemCardsIntoLegacyDeck(
  deck: DeckDocument,
): DeckDocument {
  const legacyCompatibleNodeIds = new Set([
    ...Array.from(LEGACY_SYSTEM_CARD_IDS),
    ...Array.from(BASELINE_OPTIONAL_CARD_IDS),
  ]);
  const hasOnlyLegacySystemNodes =
    deck.nodes.length > 0 &&
    deck.nodes.some((node) => LEGACY_SYSTEM_CARD_IDS.has(node.id)) &&
    deck.nodes.every((node) => legacyCompatibleNodeIds.has(node.id));
  void hasOnlyLegacySystemNodes;
  if (!hasOnlyLegacySystemNodes) {
    return deck;
  }

  const existingNodesById = new Map(
    deck.nodes.map((node) => [node.id, node] as const),
  );
  const existingPromptTemplatesById = new Map(
    deck.promptTemplates.map((template) => [template.id, template] as const),
  );
  const initialPromptTemplateIds = new Set(
    INITIAL_PROMPT_TEMPLATES.map((template) => template.id),
  );
  const upgradedNodes: AgentCardInstance[] = INITIAL_DECK.nodes.map(
    (seedNode): AgentCardInstance => {
      const existingNode = existingNodesById.get(seedNode.id);
      if (!existingNode) {
        return cloneDeckDocument(seedNode);
      }

      const nextTitle =
        seedNode.id === 'card_research' &&
        String(existingNode.title || '').trim() === 'Research'
          ? seedNode.title
          : existingNode.title || seedNode.title;
      const nextSubtitle =
        seedNode.id === 'card_research' &&
        String(existingNode.subtitle || '').trim() === 'Gather upstream inputs'
          ? seedNode.subtitle
          : existingNode.subtitle || seedNode.subtitle;
      return {
        ...cloneDeckDocument(seedNode),
        ...cloneDeckDocument(existingNode),
        kind: 'agent',
        prompt:
          typeof (existingNode as any).prompt === 'string'
            ? (existingNode as any).prompt
            : seedNode.prompt || '',
        title: nextTitle,
        subtitle: nextSubtitle,
        runtimeBinding: normalizeRuntimeBinding(
          existingNode.runtimeBinding ?? seedNode.runtimeBinding ?? null,
        ),
        runtimeType: normalizeRuntimeType(
          existingNode.runtimeType ?? seedNode.runtimeType ?? 'assistant_agent',
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
    },
  );

  const upgradedPromptTemplates = [
    ...INITIAL_PROMPT_TEMPLATES.map((seedTemplate) =>
      cloneDeckDocument(
        existingPromptTemplatesById.get(seedTemplate.id) || seedTemplate,
      ),
    ),
    ...deck.promptTemplates
      .filter((template) => !initialPromptTemplateIds.has(template.id))
      .map((template) => cloneDeckDocument(template)),
  ];

  // Preserve persisted edge state exactly; never infer/merge seed edges during hydration.
  const nextEdges = filterAuthoringCompatibleEdges(upgradedNodes, deck.edges);

  return {
    ...deck,
    version: Math.max(deck.version, INITIAL_DECK.version),
    promptTemplates: upgradedPromptTemplates,
    nodes: upgradedNodes,
    edges: nextEdges,
  };
}

export function hydrateDeckDocument(
  value: Partial<DeckDocument> | null | undefined,
): DeckDocument {
  if (!value || typeof value !== 'object') {
    return cloneDeckDocument(INITIAL_DECK);
  }
  const hasExplicitNodes = Array.isArray(value.nodes);
  const nextEdges = Array.isArray(value.edges)
    ? normalizeDeckEdges(value.edges)
    : hasExplicitNodes
      ? []
      : normalizeDeckEdges(value.edges);
  const hydratedDeck = seedCurrentSystemCardsIntoLegacyDeck({
    ...cloneDeckDocument(INITIAL_DECK),
    ...value,
    id: String(value.id || INITIAL_DECK.id).trim() || INITIAL_DECK.id,
    name: String(value.name || INITIAL_DECK.name).trim() || INITIAL_DECK.name,
    version: Number.isFinite(Number(value.version))
      ? Number(value.version)
      : INITIAL_DECK.version,
    nodes: normalizeDeckNodes(value.nodes),
    edges: nextEdges,
    promptTemplates: normalizeDeckPromptTemplates(value.promptTemplates),
  });
  const bannedNodeIds = new Set(['card_synthesis', 'card_review']);
  const bannedPromptTemplateIds = new Set([
    'prompt_synthesis',
    'prompt_review',
  ]);
  const baseDeck = {
    ...hydratedDeck,
    nodes: hydratedDeck.nodes
      .filter((node) => !bannedNodeIds.has(node.id))
      .map(normalizeLocalCoderControllerCard),
    edges: hydratedDeck.edges.filter(
      (edge) =>
        !bannedNodeIds.has(edge.source) && !bannedNodeIds.has(edge.target),
    ),
    promptTemplates: hydratedDeck.promptTemplates.filter(
      (template) => !bannedPromptTemplateIds.has(template.id),
    ),
  };
  return baseDeck;
}

export function resolveProjectDeckPayload(
  deckPayload: Partial<DeckDocument> | null | undefined,
): { deck: DeckDocument; usedFallback: boolean } {
  if (!deckPayload || typeof deckPayload !== 'object') {
    return {
      deck: hydrateDeckDocument(INITIAL_DECK),
      usedFallback: true,
    };
  }

  return {
    deck: hydrateDeckDocument(deckPayload),
    usedFallback: false,
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
} {
  if (preserveCurrentOnFailure) {
    return {
      deck: cloneDeckDocument(currentDeck),
      usedFallback: false,
      preservedCurrent: true,
    };
  }

  const resolved = resolveProjectDeckPayload(deckPayload);
  return {
    ...resolved,
    preservedCurrent: false,
  };
}

export function buildProjectlessDeckDocument(): DeckDocument {
  return hydrateDeckDocument({
    id: INITIAL_DECK.id,
    name: INITIAL_DECK.name,
    version: INITIAL_DECK.version,
    promptTemplates: INITIAL_DECK.promptTemplates,
    nodes: [],
    edges: [],
  });
}


