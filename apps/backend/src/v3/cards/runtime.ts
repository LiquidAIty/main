// @graph entity: CardRuntime
// @graph role: card-execution-orchestrator
// @graph relates_to: DeckRuntime, Magentic-One Runtime, PlanWiki, ThinkGraph, KnowGraph
// @graph depends_on: OpenAI, RuntimeBindings
// @graph feeds_to: DeckRuntime
import { REPO_DEFAULT_MODEL_KEY, resolveModel, type Provider } from '../../llm/models.config';
import { runLLM } from '../../llm/client';
import { getTool, type Tool } from '../../agents/registry';
import { resolveRuntimeBinding } from '../runtimeBinding';
import {
  buildGraphExecutionInputText,
  createGraphExecutionScheduler,
} from '../runtime/graphExecution';
import type {
  AgentCardInstance,
  AgentCardRuntimeType,
  AgentTemplate,
  CardRunResult,
  CodeGraphViewContract,
  DeckEdge,
  DeckEdgeType,
  DeckRuntimeEvent,
  DeckWorkspaceContext,
  GraphViewContract,
  PromptTemplate,
  RuntimeBinding,
} from '../types';

export type CardRuntimeContext = {
  userInput: string;
  previousOutput?: string;
  promptTemplates?: PromptTemplate[];
  seed?: string;
  projectId?: string;
  workspaceContext?: DeckWorkspaceContext | null;
  deckId?: string;
  deckName?: string;
  allCards?: AgentCardInstance[];
  allEdges?: DeckEdge[];
  allTemplates?: AgentTemplate[];
  allowVisibleAssistWorkflowExpansion?: boolean;
  onRuntimeEvent?: (event: DeckRuntimeEvent) => void;
};

type ResolvedModelConfig = {
  provider: Provider;
  modelKey: string;
  providerModelId: string;
  temperature: number | null;
  maxTokens: number | null;
};

type GraphExecutionStep = {
  card: AgentCardInstance;
  effectiveAgent: AgentTemplate;
};

type ResolvedAssistTool = {
  configuredName: string;
  toolId: string;
  tool: Tool;
};

const CODEGRAPH_DEFAULT_NODE_LABEL_ALLOWLIST = [
  'File',
  'Module',
  'Function',
  'Class',
  'Interface',
  'Route',
];

const CODEGRAPH_DEFAULT_EDGE_TYPE_ALLOWLIST = [
  'IMPORTS',
  'CALLS',
  'DEFINES',
  'HANDLES',
  'CONTAINS_FILE',
];

const PROMPT_DRIVEN_ASSIST_TOOL_IDS = new Set([
  'openai',
  'openai-agent',
  'python',
  'n8n',
  'scraper',
  'ui',
  'mcp',
]);

const ASSIST_TOOL_ALIAS_MAP: Record<string, string> = {
  openai_agent: 'openai-agent',
  openaiagent: 'openai-agent',
};

function summarizeText(value: string | null | undefined, maxLength = 220): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
}

function toWorkspaceFocusSummary(
  workspaceContext: DeckWorkspaceContext | null | undefined,
): {
  activeSurface: string;
  activeTab: string | null;
  objectEditorOpen: boolean;
  objectEditorTab: string | null;
  selectedCardId: string | null;
  selectedCardTitle: string | null;
  selectedCardRuntimeType: string | null;
  editable: boolean;
  runnable: boolean;
} | null {
  if (!workspaceContext || typeof workspaceContext !== 'object') return null;
  const clean = (value: unknown): string | null => {
    const text = String(value || '').trim();
    return text || null;
  };
  const editor =
    workspaceContext.objectEditor && typeof workspaceContext.objectEditor === 'object'
      ? workspaceContext.objectEditor
      : null;
  return {
    activeSurface: clean(workspaceContext.largeSurface) || clean(workspaceContext.workspaceView) || 'chat',
    activeTab: clean(workspaceContext.activeTab),
    objectEditorOpen: Boolean(editor?.open),
    objectEditorTab: clean(editor?.activeTab),
    selectedCardId: clean(editor?.selectedCardId),
    selectedCardTitle: clean(editor?.selectedCardTitle),
    selectedCardRuntimeType: clean(editor?.selectedCardRuntimeType),
    editable: Boolean(editor?.editable),
    runnable: Boolean(editor?.runnable),
  };
}

function emitRuntimeEvent(
  context: Pick<CardRuntimeContext, 'onRuntimeEvent'>,
  event: Omit<DeckRuntimeEvent, 'id' | 'at'>,
): void {
  context.onRuntimeEvent?.({
    id: `evt_${Math.random().toString(36).slice(2, 10)}`,
    at: new Date().toISOString(),
    ...event,
  });
}

function emitRuntimeMessage(
  context: Pick<CardRuntimeContext, 'onRuntimeEvent'>,
  event: {
    cardId: string;
    cardTitle?: string | null;
    runtimeType?: AgentCardRuntimeType | null;
    role: 'assistant' | 'tool' | 'user';
    content: string | null | undefined;
  },
): void {
  const content = String(event.content || '').trim();
  if (!content) return;
  emitRuntimeEvent(context, {
    kind: 'message',
    type: 'message',
    cardId: event.cardId,
    cardTitle: event.cardTitle || null,
    runtimeType: event.runtimeType || null,
    role: event.role,
    content,
  });
}

function normalizeEdgeType(value: unknown): DeckEdgeType {
  return String(value || '').trim().toLowerCase() === 'magentic_option'
    ? 'magentic_option'
    : 'flow';
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const source = String(text || '').trim();
  if (!source) return null;
  const firstBrace = source.indexOf('{');
  const lastBrace = source.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace <= firstBrace) return null;
  try {
    const parsed = JSON.parse(source.slice(firstBrace, lastBrace + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function normalizeCodeGraphViewContractCandidate(value: unknown): GraphViewContract | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const toStringArray = (input: unknown): string[] | undefined => {
    if (!Array.isArray(input)) return undefined;
    const normalized = input
      .map((entry) => String(entry || '').trim())
      .filter(Boolean);
    return normalized.length > 0 ? normalized : undefined;
  };

  const nodeLabelAllowlist = toStringArray(
    record.nodeLabelAllowlist ?? record.node_labels ?? record.nodeLabels,
  );
  const edgeTypeAllowlist = toStringArray(
    record.edgeTypeAllowlist ?? record.edge_types ?? record.edgeTypes,
  );
  const focusPaths = toStringArray(record.focusPaths ?? record.focus_paths);
  const focusSymbols = toStringArray(record.focusSymbols ?? record.focus_symbols);
  const focusNodeIds = toStringArray(record.focusNodeIds ?? record.focus_node_ids);
  const showLabelsRaw = record.showLabels ?? record.show_labels;
  const maxNodesRaw = record.maxNodes ?? record.max_nodes;
  const projectIdRaw = record.projectId ?? record.project_id;
  const graphKindRaw = String(record.graphKind ?? record.graph_kind ?? 'codegraph')
    .trim()
    .toLowerCase();
  const cameraModeRaw = record.cameraMode ?? record.camera_mode;
  const animationModeRaw = record.animationMode ?? record.animation_mode;
  const narrativeIntentRaw = record.narrativeIntent ?? record.narrative_intent;
  const showLabels = typeof showLabelsRaw === 'boolean' ? showLabelsRaw : undefined;
  const maxNodes = Number.isFinite(Number(maxNodesRaw)) ? Number(maxNodesRaw) : undefined;
  const projectId = String(projectIdRaw || '').trim() || undefined;
  const graphKind =
    graphKindRaw === 'thinkgraph' || graphKindRaw === 'knowgraph' || graphKindRaw === 'codegraph'
      ? graphKindRaw
      : 'codegraph';
  const cameraMode =
    cameraModeRaw === 'overview' ||
    cameraModeRaw === 'focus' ||
    cameraModeRaw === 'trace' ||
    cameraModeRaw === 'cluster'
      ? cameraModeRaw
      : undefined;
  const animationMode =
    animationModeRaw === 'calm' || animationModeRaw === 'guided' || animationModeRaw === 'active'
      ? animationModeRaw
      : undefined;
  const narrativeIntent = String(narrativeIntentRaw || '').trim() || undefined;

  if (
    !nodeLabelAllowlist &&
    !edgeTypeAllowlist &&
    !focusPaths &&
    !focusSymbols &&
    !focusNodeIds &&
    showLabels == null &&
    maxNodes == null &&
    !projectId &&
    !cameraMode &&
    !animationMode &&
    !narrativeIntent
  ) {
    return null;
  }

  return {
    graphKind: graphKind as GraphViewContract['graphKind'],
    projectId,
    focusNodeIds,
    nodeLabelAllowlist,
    edgeTypeAllowlist,
    focusPaths,
    focusSymbols,
    showLabels,
    maxNodes,
    cameraMode: cameraMode as GraphViewContract['cameraMode'],
    animationMode: animationMode as GraphViewContract['animationMode'],
    narrativeIntent: narrativeIntent ?? null,
  };
}

function extractCodeGraphFocusPaths(text: string): string[] {
  const matches = text.match(
    /[A-Za-z0-9_./-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|sql|py|yml|yaml)/g,
  );
  if (!matches) return [];
  return Array.from(new Set(matches.map((entry) => entry.trim()).filter(Boolean))).slice(0, 8);
}

function extractCodeGraphFocusSymbols(text: string): string[] {
  const values: string[] = [];
  for (const match of text.matchAll(/`([A-Za-z_][A-Za-z0-9_]*)`/g)) {
    values.push(String(match[1] || '').trim());
  }
  for (const match of text.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
    values.push(String(match[1] || '').trim());
  }
  return Array.from(new Set(values.filter(Boolean))).slice(0, 8);
}

function isGraphRelevantHeadCard(card: AgentCardInstance): boolean {
  if (resolveCardRuntimeType(card) === 'graph_flow') return true;
  const runtimeBinding = String(card.runtimeBinding || '').trim().toLowerCase();
  if (runtimeBinding === 'knowgraph' || runtimeBinding === 'neo4j' || runtimeBinding === 'kg_ingest') {
    return true;
  }
  const headText = `${card.title || ''} ${card.prompt || ''}`.toLowerCase();
  return /codegraph|graph|knowgraph|neo4j|cypher|dependency|dependencies|symbol|schema|imports?/.test(
    headText,
  );
}

function isGraphRelevantMagenticTask(runtimeInput: string, callableHeads: AgentCardInstance[]): boolean {
  if (
    /codegraph|graph|knowgraph|neo4j|cypher|dependency|dependencies|focusPaths|focusSymbols|nodeLabelAllowlist|edgeTypeAllowlist/.test(
      runtimeInput.toLowerCase(),
    )
  ) {
    return true;
  }
  return callableHeads.some((head) => isGraphRelevantHeadCard(head));
}

function buildGraphRelevantCodeGraphContract(
  runtimeInput: string,
  projectId?: string,
  base?: GraphViewContract | null,
): GraphViewContract {
  const focusPathsFromInput = extractCodeGraphFocusPaths(runtimeInput);
  const focusSymbolsFromInput = extractCodeGraphFocusSymbols(runtimeInput);
  return {
    graphKind: base?.graphKind || 'codegraph',
    projectId:
      base?.projectId !== undefined
        ? base.projectId
        : projectId
          ? projectId
          : null,
    focusPaths:
      Array.isArray(base?.focusPaths) && base.focusPaths.length > 0
        ? base.focusPaths
        : focusPathsFromInput,
    focusSymbols:
      Array.isArray(base?.focusSymbols) && base.focusSymbols.length > 0
        ? base.focusSymbols
        : focusSymbolsFromInput,
    nodeLabelAllowlist:
      Array.isArray(base?.nodeLabelAllowlist) && base.nodeLabelAllowlist.length > 0
        ? base.nodeLabelAllowlist
        : [...CODEGRAPH_DEFAULT_NODE_LABEL_ALLOWLIST],
    edgeTypeAllowlist:
      Array.isArray(base?.edgeTypeAllowlist) && base.edgeTypeAllowlist.length > 0
        ? base.edgeTypeAllowlist
        : [...CODEGRAPH_DEFAULT_EDGE_TYPE_ALLOWLIST],
    showLabels: typeof base?.showLabels === 'boolean' ? base.showLabels : true,
    maxNodes:
      Number.isFinite(Number(base?.maxNodes)) && Number(base?.maxNodes) > 0
        ? Number(base?.maxNodes)
        : 12000,
    focusNodeIds:
      Array.isArray(base?.focusNodeIds) && base.focusNodeIds.length > 0 ? base.focusNodeIds : undefined,
    cameraMode: base?.cameraMode,
    animationMode: base?.animationMode,
    narrativeIntent: base?.narrativeIntent ?? null,
  };
}

function toGraphViewContract(
  value: GraphViewContract | CodeGraphViewContract | null | undefined,
): GraphViewContract | null {
  return normalizeCodeGraphViewContractCandidate(value);
}

function interpolateWorkerTemplate(template: string, workerIndex: number, workerCount: number): string {
  return template
    .replace(/\{workerIndex\}/g, String(workerIndex))
    .replace(/\{workerCount\}/g, String(workerCount));
}

function formatCardRuntimeError(err: unknown): string {
  const debugMessage = String((err as any)?.message || err || 'card_run_failed').trim();
  const lower = debugMessage.toLowerCase();

  if (
    lower.includes('runtime_not_supported') ||
    lower.includes('participant_runtime_not_supported') ||
    lower.includes('participants_required') ||
    lower.includes('participant_card_missing') ||
    lower.includes('participant_card_invalid') ||
    lower.includes('assistant_tool_') ||
    lower.includes('assistant_swarm_') ||
    lower.includes('assistant_empty_response') ||
    lower.includes('magentic_callable_heads_required') ||
    lower.includes('magentic_invalid_head_selection') ||
    lower.includes('graph_flow_') ||
    lower.includes('provider_model_mismatch') ||
    lower.includes('model_not_configured') ||
    lower.includes('magentic_model_not_approved')
  ) {
    return debugMessage;
  }

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

  if (lower.includes('timed out') || lower.includes('timeout')) {
    return 'The configured model timed out before the card completed.';
  }

  if (
    lower.includes('model') &&
    (lower.includes('not found') || lower.includes('does not exist') || lower.includes('not configured'))
  ) {
    return 'The configured model for this card is unavailable.';
  }

  if (lower.includes('autogen_orchestrator_http_') || lower.includes('autogen_orchestrator_unreachable')) {
    return 'The team runtime sidecar could not complete this card right now.';
  }

  return 'The backend model call failed for this card.';
}

function buildRuntimeInput(input: string, context: CardRuntimeContext): string {
  const primary = String(context.userInput || input || '').trim();
  if (primary) return primary;
  return String(context.previousOutput || '').trim();
}

function buildJsonSchema(cardId: string, schema: Record<string, unknown>) {
  return {
    name: `deck_card_${cardId}_schema`,
    schema,
    strict: true,
  };
}

function normalizeProvider(value: unknown): Provider | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'openai' || normalized === 'openrouter') {
    return normalized;
  }
  return null;
}

function coerceNumber(value: unknown, fallback: number | null = null): number | null {
  if (value == null || value === '') return fallback;
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function resolveCardRuntimeType(card: AgentCardInstance): AgentCardRuntimeType {
  return card.kind === 'agent'
    ? ((card.runtimeType || 'assistant_agent') as AgentCardRuntimeType)
    : 'assistant_agent';
}

function resolveCardSystemPrompt(card: AgentCardInstance, effectiveAgent: AgentTemplate): string {
  return String(card.prompt || effectiveAgent.promptTemplate || '').trim();
}

function resolveModelConfig(
  modelKeyRaw: unknown,
  providerHintRaw: unknown,
  temperatureRaw: unknown,
  maxTokensRaw: unknown,
  scope: string,
): ResolvedModelConfig {
  const providerHint = normalizeProvider(providerHintRaw);
  const modelKey = String(modelKeyRaw || '').trim() || REPO_DEFAULT_MODEL_KEY;

  if (modelKey.includes('/')) {
    const provider = providerHint || 'openrouter';
    if (provider !== 'openrouter') {
      throw new Error(`${scope}_provider_model_mismatch: provider=${provider} model_key=${modelKey}`);
    }
    return {
      provider,
      modelKey,
      providerModelId: modelKey,
      temperature: coerceNumber(temperatureRaw, null),
      maxTokens: coerceNumber(maxTokensRaw, null),
    };
  }

  try {
    const resolved = resolveModel(modelKey);
    if (providerHint && providerHint !== resolved.provider) {
      throw new Error(`${scope}_provider_model_mismatch: provider=${providerHint} model_key=${modelKey}`);
    }
    return {
      provider: resolved.provider,
      modelKey,
      providerModelId: resolved.id,
      temperature: coerceNumber(temperatureRaw, null),
      maxTokens: coerceNumber(maxTokensRaw, null),
    };
  } catch (error: any) {
    if (!providerHint) {
      throw new Error(`${scope}_model_not_configured: ${modelKey}`);
    }
    return {
      provider: providerHint,
      modelKey,
      providerModelId: modelKey,
      temperature: coerceNumber(temperatureRaw, null),
      maxTokens: coerceNumber(maxTokensRaw, null),
    };
  }
}

function resolveCardModelConfig(
  card: AgentCardInstance,
  effectiveAgent: AgentTemplate,
  scope: string,
): ResolvedModelConfig {
  const runtimeOptions = card.runtimeOptions || {};
  return resolveModelConfig(
    runtimeOptions.modelKey ?? effectiveAgent.model,
    runtimeOptions.provider ?? effectiveAgent.provider,
    runtimeOptions.temperature ?? effectiveAgent.temperature,
    runtimeOptions.maxTokens ?? effectiveAgent.maxTokens,
    scope,
  );
}

export function resolveEffectiveAgent(
  card: AgentCardInstance,
  templates: AgentTemplate[],
): AgentTemplate | null {
  const template = templates.find((item) => item.id === card.templateId);
  if (!template) return null;

  const overrides = card.overrides || {};
  return {
    ...template,
    ...overrides,
    tools: Array.isArray(overrides.tools) ? overrides.tools : template.tools,
    skills: Array.isArray(overrides.skills) ? overrides.skills : template.skills,
    personas: Array.isArray(overrides.personas) ? overrides.personas : template.personas,
    knowledgeSources: Array.isArray(overrides.knowledgeSources)
      ? overrides.knowledgeSources
      : template.knowledgeSources,
    ioSchema:
      overrides.ioSchema && typeof overrides.ioSchema === 'object'
        ? overrides.ioSchema
        : template.ioSchema,
  };
}

function getConfiguredTools(effectiveAgent: AgentTemplate): string[] {
  return Array.isArray(effectiveAgent.tools)
    ? effectiveAgent.tools.map((tool) => String(tool || '').trim()).filter(Boolean)
    : [];
}

function normalizeAssistToolName(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/_/g, '-');
}

function resolveConfiguredAssistTools(
  card: AgentCardInstance,
  effectiveAgent: AgentTemplate,
): ResolvedAssistTool[] {
  const seen = new Set<string>();

  return getConfiguredTools(effectiveAgent).map((configuredName) => {
    const normalizedConfiguredName = normalizeAssistToolName(configuredName);
    const lookupName = ASSIST_TOOL_ALIAS_MAP[normalizedConfiguredName] || normalizedConfiguredName;
    const tool = getTool(lookupName) || getTool(configuredName);
    if (!tool) {
      throw new Error(
        `assistant_tool_not_supported: cardId=${card.id} tool=${configuredName}`,
      );
    }
    if (!PROMPT_DRIVEN_ASSIST_TOOL_IDS.has(tool.id)) {
      throw new Error(
        `assistant_tool_structured_params_required: cardId=${card.id} tool=${configuredName} resolvedTool=${tool.id}`,
      );
    }
    if (seen.has(tool.id)) {
      return null;
    }
    seen.add(tool.id);
    return {
      configuredName,
      toolId: tool.id,
      tool,
    };
  }).filter((tool): tool is ResolvedAssistTool => Boolean(tool));
}

function resolveAssistExecutionMode(card: AgentCardInstance): 'single' | 'swarm' {
  return card.runtimeOptions?.executionMode === 'swarm' ? 'swarm' : 'single';
}

function resolveCallableHeadCards(
  card: AgentCardInstance,
  context: CardRuntimeContext,
): AgentCardInstance[] {
  const nodeMap = new Map((context.allCards || []).map((node) => [node.id, node]));
  const seen = new Set<string>();
  return (context.allEdges || [])
    .filter(
      (edge) =>
        edge.source === card.id &&
        normalizeEdgeType(edge.edgeType) === 'magentic_option' &&
        edge.target !== card.id,
    )
    .map((edge) => nodeMap.get(edge.target))
    .filter((node): node is AgentCardInstance => Boolean(node && node.kind === 'agent'))
    .filter((node) => !String(node.parentGraphId || '').trim())
    .filter((node) => {
      const runtimeType = resolveCardRuntimeType(node);
      return runtimeType === 'assistant_agent' || runtimeType === 'graph_flow';
    })
    .filter((node) => {
      if (seen.has(node.id)) return false;
      seen.add(node.id);
      return true;
    });
}

function isTopLevelAssistCard(node: AgentCardInstance | undefined | null): node is AgentCardInstance {
  return Boolean(
    node &&
      node.kind === 'agent' &&
      resolveCardRuntimeType(node) === 'assistant_agent' &&
      !String(node.parentGraphId || '').trim(),
  );
}

function resolveGraphExecutionSteps(
  card: AgentCardInstance,
  context: CardRuntimeContext,
): GraphExecutionStep[] {
  const templates = context.allTemplates || [];
  const cards = (context.allCards || []).filter(
    (candidate) =>
      candidate.kind === 'agent' && String(candidate.parentGraphId || '').trim() === card.id,
  );

  return cards.map((stepCard) => {
    if (resolveCardRuntimeType(stepCard) !== 'assistant_agent') {
      throw new Error(
        `graph_flow_step_runtime_not_supported: graphCardId=${card.id} stepCardId=${stepCard.id} runtimeType=${resolveCardRuntimeType(stepCard)}`,
      );
    }
    const effectiveStep = resolveEffectiveAgent(stepCard, templates);
    if (!effectiveStep) {
      throw new Error(
        `graph_flow_step_template_missing: graphCardId=${card.id} stepCardId=${stepCard.id} templateId=${stepCard.templateId}`,
      );
    }
    return {
      card: stepCard,
      effectiveAgent: effectiveStep,
    };
  });
}

function resolveVisibleAssistWorkflowSteps(
  headCard: AgentCardInstance,
  context: CardRuntimeContext,
): GraphExecutionStep[] {
  if (!isTopLevelAssistCard(headCard)) return [];

  const nodeMap = new Map((context.allCards || []).map((node) => [node.id, node] as const));
  const templates = context.allTemplates || [];
  const queue = [headCard.id];
  const visited = new Set<string>();
  const orderedIds: string[] = [];

  while (queue.length > 0) {
    const cardId = queue.shift();
    if (!cardId || visited.has(cardId)) continue;
    visited.add(cardId);
    const currentCard = nodeMap.get(cardId);
    if (!isTopLevelAssistCard(currentCard)) continue;
    orderedIds.push(currentCard.id);

    (context.allEdges || []).forEach((edge) => {
      if (normalizeEdgeType(edge.edgeType) !== 'flow' || edge.source !== currentCard.id) return;
      const nextCard = nodeMap.get(edge.target);
      if (!isTopLevelAssistCard(nextCard)) return;
      queue.push(nextCard.id);
    });
  }

  return orderedIds.map((stepCardId) => {
    const stepCard = nodeMap.get(stepCardId);
    if (!stepCard || !isTopLevelAssistCard(stepCard)) {
      throw new Error(
        `assist_workflow_step_missing: headCardId=${headCard.id} stepCardId=${stepCardId}`,
      );
    }
    const effectiveStep = resolveEffectiveAgent(stepCard, templates);
    if (!effectiveStep) {
      throw new Error(
        `assist_workflow_step_template_missing: headCardId=${headCard.id} stepCardId=${stepCard.id} templateId=${stepCard.templateId}`,
      );
    }
    return {
      card: stepCard,
      effectiveAgent: effectiveStep,
    };
  });
}

function resolveGraphFlowEdges(
  card: AgentCardInstance,
  context: CardRuntimeContext,
  stepIds: Set<string>,
): DeckEdge[] {
  return (context.allEdges || []).filter(
    (edge) =>
      normalizeEdgeType(edge.edgeType) === 'flow' &&
      stepIds.has(edge.source) &&
      stepIds.has(edge.target) &&
      edge.source !== card.id &&
      edge.target !== card.id,
  );
}

function resolveVisibleAssistFlowEdges(
  context: CardRuntimeContext,
  stepIds: Set<string>,
): DeckEdge[] {
  return (context.allEdges || []).filter(
    (edge) =>
      normalizeEdgeType(edge.edgeType) === 'flow' &&
      stepIds.has(edge.source) &&
      stepIds.has(edge.target),
  );
}

async function consolidateCompositeOutput(
  scope: string,
  modelConfig: ResolvedModelConfig,
  systemPrompt: string,
  originalInput: string,
  outputs: string[],
): Promise<string> {
  const consolidationSystem = [
    systemPrompt,
    'Internally consolidate multiple partial results into one clean user-facing answer.',
    'Do not expose worker chatter, intermediate transcripts, or internal process notes.',
    'Return one clean final answer only.',
  ]
    .filter(Boolean)
    .join('\n\n');

  const consolidationInput = [
    'Original task:',
    originalInput,
    '',
    'Internal results:',
    outputs
      .map((output, index) => `Result ${index + 1}:\n${String(output || '').trim()}`)
      .join('\n\n'),
  ]
    .join('\n')
    .trim();

  const llmResult = await runLLM(consolidationInput, {
    modelKey: modelConfig.modelKey,
    provider: modelConfig.provider,
    providerModelId: modelConfig.providerModelId,
    temperature: modelConfig.temperature ?? undefined,
    maxTokens: modelConfig.maxTokens ?? undefined,
    system: consolidationSystem || undefined,
    useResponsesApi: modelConfig.provider === 'openai',
  });

  const finalText = String(llmResult.text || '').trim();
  if (!finalText) {
    throw new Error(`${scope}_empty_consolidated_response`);
  }
  return finalText;
}

async function runCompositeWorkflow(
  scopeCard: AgentCardInstance,
  effectiveAgent: AgentTemplate,
  runtimeInput: string,
  context: CardRuntimeContext,
  runtimeBinding: RuntimeBinding | null,
  startedAt: string,
  options: {
    scope: 'graph_flow' | 'assist_workflow';
    runtimeType: CardRunResult['runtimeType'];
    steps: GraphExecutionStep[];
    edges: DeckEdge[];
    emptyOutputError: string;
    stepFailurePrefix: string;
    consolidationScopeId: string;
  },
): Promise<CardRunResult> {
  const scheduler = createGraphExecutionScheduler({
    nodes: options.steps.map((step) => step.card),
    edges: options.edges,
  });
  const stepMap = new Map(options.steps.map((step) => [step.card.id, step] as const));
  const outputsByCardId = new Map<string, string>();
  let executedStepCount = 0;

  while (true) {
    const event = scheduler.next();
    if (!event) break;
    if (event.type === 'skipped') continue;

    const step = stepMap.get(event.card.id);
    if (!step) {
      throw new Error(`${options.scope}_step_missing: cardId=${scopeCard.id} stepCardId=${event.card.id}`);
    }

    const stepInput = buildGraphExecutionInputText({
      card: step.card,
      routeInfo: event.routeInfo,
      isStart: event.isStart,
      baseInput: runtimeInput,
    });
    emitRuntimeEvent(context, {
      kind: 'step_started',
      cardId: step.card.id,
      cardTitle: step.card.title,
      runtimeType: step.card.runtimeType ?? 'assistant_agent',
      edgeIds: (event.routeInfo.inputSources || []).map((source) => source.edgeId),
      notes: [...(event.routeInfo.notes || [])],
      text: `${step.card.title} started.`,
      status: 'running',
    });
    const stepResult = await runCardWithContract(step.card, step.effectiveAgent, stepInput, {
      ...context,
      userInput: stepInput,
      previousOutput: '',
      allowVisibleAssistWorkflowExpansion: false,
    });
    if (stepResult.status !== 'success' || !stepResult.output) {
      emitRuntimeEvent(context, {
        kind: 'step_completed',
        cardId: step.card.id,
        cardTitle: step.card.title,
        runtimeType: step.card.runtimeType ?? 'assistant_agent',
        edgeIds: (event.routeInfo.inputSources || []).map((source) => source.edgeId),
        text:
          stepResult.error ||
          `${step.card.title} failed.`,
        outputSummary: stepResult.outputSummary || null,
        status: stepResult.status,
      });
      throw new Error(
        stepResult.error ||
          `${options.stepFailurePrefix}: cardId=${scopeCard.id} stepCardId=${step.card.id}`,
      );
    }

    executedStepCount += 1;
    outputsByCardId.set(step.card.id, stepResult.output);
    emitRuntimeEvent(context, {
      kind: 'step_completed',
      cardId: step.card.id,
      cardTitle: step.card.title,
      runtimeType: stepResult.runtimeType ?? step.card.runtimeType ?? 'assistant_agent',
      edgeIds: (event.routeInfo.inputSources || []).map((source) => source.edgeId),
      text: `${step.card.title} completed.`,
      outputSummary: stepResult.outputSummary || null,
      status: stepResult.status,
    });
    scheduler.markSuccess(step.card.id, stepResult.output);
  }

  const unresolvedStepIds = scheduler.getUnresolvedNodeIds();
  if (unresolvedStepIds.length > 0) {
    throw new Error(
      `${options.scope}_cycle_or_unresolved_dependency: cardId=${scopeCard.id} unresolved=${unresolvedStepIds.join(',')}`,
    );
  }

  const terminalOutputs = scheduler.getTerminalExecutedNodeIds()
    .map((stepId) => String(outputsByCardId.get(stepId) || '').trim())
    .filter(Boolean);
  if (terminalOutputs.length === 0) {
    throw new Error(options.emptyOutputError);
  }

  const prompt = resolveCardSystemPrompt(scopeCard, effectiveAgent);
  const modelConfig = resolveCardModelConfig(scopeCard, effectiveAgent, `card_${scopeCard.id}`);
  const useConsolidation =
    scopeCard.runtimeOptions?.useSocietyOfMindConsolidation === true ||
    executedStepCount > 1 ||
    terminalOutputs.length > 1;
  const finalText = useConsolidation
    ? await consolidateCompositeOutput(
        options.consolidationScopeId,
        modelConfig,
        prompt,
        runtimeInput,
        terminalOutputs,
      )
    : terminalOutputs[0];

  emitRuntimeMessage(context, {
    cardId: scopeCard.id,
    cardTitle: scopeCard.title,
    runtimeType: options.runtimeType,
    role: 'assistant',
    content: finalText,
  });

  return {
    output: finalText,
    status: 'success',
    startedAt,
    endedAt: new Date().toISOString(),
    runtimeBinding,
    runtimeType: options.runtimeType,
    seed: context.seed,
    inputSummary: summarizeText(runtimeInput),
    outputSummary: summarizeText(finalText),
  };
}

async function runAssistantModelText(
  card: AgentCardInstance,
  effectiveAgent: AgentTemplate,
  modelConfig: ResolvedModelConfig,
  systemPrompt: string,
  runtimeInput: string,
  allowStructuredOutput: boolean,
): Promise<string> {
  const llmResult = await runLLM(runtimeInput, {
    modelKey: modelConfig.modelKey,
    provider: modelConfig.provider,
    providerModelId: modelConfig.providerModelId,
    temperature: modelConfig.temperature ?? undefined,
    maxTokens: modelConfig.maxTokens ?? undefined,
    system: systemPrompt || undefined,
    jsonMode: allowStructuredOutput && Boolean(effectiveAgent.ioSchema),
    jsonSchema:
      allowStructuredOutput && effectiveAgent.ioSchema && typeof effectiveAgent.ioSchema === 'object'
        ? buildJsonSchema(card.id, effectiveAgent.ioSchema)
        : undefined,
    useResponsesApi: modelConfig.provider === 'openai',
  });

  const finalText = String(llmResult.text || '').trim();
  if (!finalText) {
    throw new Error(`assistant_empty_response: cardId=${card.id}`);
  }
  return finalText;
}

function buildPromptDrivenToolParams(
  card: AgentCardInstance,
  tool: ResolvedAssistTool,
  runtimeInput: string,
  context: Pick<CardRuntimeContext, 'projectId' | 'deckId'>,
): Record<string, unknown> {
  return {
    prompt: runtimeInput,
    q: runtimeInput,
    query: runtimeInput,
    task: runtimeInput,
    input: runtimeInput,
    tool: tool.toolId,
    cardId: card.id,
    projectId: context.projectId || null,
    deckId: context.deckId || null,
  };
}

function extractToolFailure(result: unknown): string | null {
  const payload = result as any;
  if (!payload) return 'tool returned no result';
  if (payload.ok === false) {
    return String(payload.error || payload.message || 'tool returned ok=false').trim();
  }

  const status = String(payload.status || '').trim().toLowerCase();
  if (status && status !== 'ok' && status !== 'completed') {
    const eventMessage = Array.isArray(payload.events)
      ? payload.events
          .map((event: any) => String(event?.data?.message || '').trim())
          .filter(Boolean)
          .join('; ')
      : '';
    return eventMessage || String(payload.error || payload.message || `status=${status}`).trim();
  }
  return null;
}

function serializeToolResult(result: unknown): string {
  const payload = result as any;
  const directCandidates = [
    payload?.output,
    payload?.text,
    payload?.content,
    payload?.result,
  ];
  for (const candidate of directCandidates) {
    const text = String(candidate || '').trim();
    if (text) return text;
  }

  if (Array.isArray(payload?.artifacts) && payload.artifacts.length > 0) {
    const artifactText = payload.artifacts
      .map((artifact: any, index: number) => {
        const content = artifact?.content ?? artifact?.data ?? artifact;
        if (content == null) return '';
        if (typeof content === 'string') return content.trim();
        try {
          return `Artifact ${index + 1}: ${JSON.stringify(content)}`;
        } catch {
          return `Artifact ${index + 1}: ${String(content)}`;
        }
      })
      .filter(Boolean)
      .join('\n\n');
    if (artifactText) return artifactText;
  }

  if (Array.isArray(payload?.events) && payload.events.length > 0) {
    const eventText = payload.events
      .map((event: any) => String(event?.data?.message || '').trim())
      .filter(Boolean)
      .join('\n');
    if (eventText) return eventText;
  }

  try {
    return JSON.stringify(payload);
  } catch {
    return String(payload || '').trim();
  }
}

async function runToolEnabledAssistantText(
  card: AgentCardInstance,
  effectiveAgent: AgentTemplate,
  runtimeInput: string,
  context: Pick<CardRuntimeContext, 'projectId' | 'deckId' | 'onRuntimeEvent'>,
  systemPrompt: string,
  modelConfig: ResolvedModelConfig,
  allowStructuredOutput: boolean,
  emitToolMessages = true,
): Promise<string> {
  const resolvedTools = resolveConfiguredAssistTools(card, effectiveAgent);
  if (resolvedTools.length === 0) {
    throw new Error(`assistant_tool_not_supported: cardId=${card.id} tool=missing`);
  }

  const toolOutputs: string[] = [];
  for (const resolvedTool of resolvedTools) {
    let toolResult: unknown;
    try {
      toolResult = await resolvedTool.tool.run(
        buildPromptDrivenToolParams(card, resolvedTool, runtimeInput, context),
      );
    } catch (error: any) {
      throw new Error(
        `assistant_tool_call_failed: cardId=${card.id} tool=${resolvedTool.configuredName} message=${String(
          error?.message || error || 'tool_call_failed',
        ).trim()}`,
      );
    }

    const failure = extractToolFailure(toolResult);
    if (failure) {
      throw new Error(
        `assistant_tool_call_failed: cardId=${card.id} tool=${resolvedTool.configuredName} message=${failure}`,
      );
    }

    const toolText = serializeToolResult(toolResult).trim();
    if (!toolText) {
      throw new Error(
        `assistant_tool_empty_result: cardId=${card.id} tool=${resolvedTool.configuredName}`,
      );
    }
    if (emitToolMessages) {
      emitRuntimeMessage(context, {
        cardId: card.id,
        cardTitle: card.title,
        runtimeType: 'assistant_agent',
        role: 'tool',
        content: toolText,
      });
    }
    toolOutputs.push(`Tool ${resolvedTool.toolId}:\n${toolText}`);
  }

  const synthesisSystem = [
    systemPrompt,
    'You are producing the final user-facing answer for this assist card.',
    'Use the tool results below as working context.',
    'Do not mention internal tool routing, raw tool payloads, or internal process notes.',
    'Return one clean answer only.',
  ]
    .filter(Boolean)
    .join('\n\n');
  const synthesisInput = [
    'Original task:',
    runtimeInput,
    '',
    'Tool results:',
    toolOutputs.join('\n\n'),
  ]
    .join('\n')
    .trim();

  return runAssistantModelText(
    card,
    effectiveAgent,
    modelConfig,
    synthesisSystem,
    synthesisInput,
    allowStructuredOutput,
  );
}

async function runAssistantSingleCard(
  card: AgentCardInstance,
  effectiveAgent: AgentTemplate,
  runtimeInput: string,
  runtimeBinding: RuntimeBinding | null,
  context: Pick<CardRuntimeContext, 'projectId' | 'deckId' | 'onRuntimeEvent'>,
  startedAt: string,
): Promise<CardRunResult> {
  const tools = getConfiguredTools(effectiveAgent);
  const prompt = resolveCardSystemPrompt(card, effectiveAgent);
  const modelConfig = resolveCardModelConfig(card, effectiveAgent, `card_${card.id}`);
  const finalText =
    tools.length > 0
      ? await runToolEnabledAssistantText(
          card,
          effectiveAgent,
          runtimeInput,
          context,
          prompt,
          modelConfig,
          true,
        )
      : await runAssistantModelText(
          card,
          effectiveAgent,
          modelConfig,
          prompt,
          runtimeInput,
          true,
        );

  emitRuntimeMessage(context, {
    cardId: card.id,
    cardTitle: card.title,
    runtimeType: 'assistant_agent',
    role: 'assistant',
    content: finalText,
  });

  return {
    output: finalText,
    status: 'success',
    startedAt,
    endedAt: new Date().toISOString(),
    runtimeBinding,
    runtimeType: 'assistant_agent',
    seed: undefined,
    inputSummary: summarizeText(runtimeInput),
    outputSummary: summarizeText(finalText),
  };
}

async function runAssistantSwarmCard(
  card: AgentCardInstance,
  effectiveAgent: AgentTemplate,
  runtimeInput: string,
  runtimeBinding: RuntimeBinding | null,
  context: Pick<CardRuntimeContext, 'projectId' | 'deckId' | 'onRuntimeEvent'>,
  startedAt: string,
): Promise<CardRunResult> {
  const tools = getConfiguredTools(effectiveAgent);
  const prompt = resolveCardSystemPrompt(card, effectiveAgent);
  const runtimeOptions = card.runtimeOptions || {};
  const modelConfig = resolveCardModelConfig(card, effectiveAgent, `card_${card.id}`);
  const workerCount = Math.max(2, Math.min(Number(runtimeOptions.swarmMaxWorkers) || 3, 6));
  const workerTemplate =
    String(runtimeOptions.swarmWorkerPromptTemplate || '').trim() ||
    'You are temporary swarm worker {workerIndex} of {workerCount}. Produce one concise partial answer from a distinct useful angle. Avoid repetition.';
  const workerOutputs: string[] = [];

  for (let index = 0; index < workerCount; index += 1) {
    const workerSystem = [
      prompt,
      interpolateWorkerTemplate(workerTemplate, index + 1, workerCount),
    ]
      .filter(Boolean)
      .join('\n\n');
    const workerText = tools.length > 0
      ? await runToolEnabledAssistantText(
          card,
          effectiveAgent,
          runtimeInput,
          context,
          workerSystem,
          modelConfig,
          false,
          false,
        )
      : await runAssistantModelText(
          card,
          effectiveAgent,
          modelConfig,
          workerSystem,
          runtimeInput,
          false,
        );
    if (workerText) workerOutputs.push(workerText);
    emitRuntimeEvent(context, {
      kind: 'swarm_progress',
      cardId: card.id,
      cardTitle: card.title,
      runtimeType: 'assistant_agent',
      text: `${card.title} swarm worker ${index + 1} of ${workerCount} completed.`,
      completedWorkers: index + 1,
      totalWorkers: workerCount,
      status: 'running',
    });
  }

  if (workerOutputs.length === 0) {
    throw new Error(`assistant_swarm_empty_worker_output: cardId=${card.id}`);
  }

  const finalText = await consolidateCompositeOutput(
    `assistant_swarm_${card.id}`,
    modelConfig,
    prompt,
    runtimeInput,
    workerOutputs,
  );

  emitRuntimeMessage(context, {
    cardId: card.id,
    cardTitle: card.title,
    runtimeType: 'assistant_agent',
    role: 'assistant',
    content: finalText,
  });

  return {
    output: finalText,
    status: 'success',
    startedAt,
    endedAt: new Date().toISOString(),
    runtimeBinding,
    runtimeType: 'assistant_agent',
    seed: undefined,
    inputSummary: summarizeText(runtimeInput),
    outputSummary: summarizeText(finalText),
  };
}

async function runAssistantLeafCard(
  card: AgentCardInstance,
  effectiveAgent: AgentTemplate,
  runtimeInput: string,
  context: Pick<CardRuntimeContext, 'projectId' | 'deckId' | 'onRuntimeEvent'>,
  runtimeBinding: RuntimeBinding | null,
  startedAt: string,
): Promise<CardRunResult> {
  return resolveAssistExecutionMode(card) === 'swarm'
    ? runAssistantSwarmCard(
        card,
        effectiveAgent,
        runtimeInput,
        runtimeBinding,
        context,
        startedAt,
      )
    : runAssistantSingleCard(
        card,
        effectiveAgent,
        runtimeInput,
        runtimeBinding,
        context,
        startedAt,
      );
}

async function runAssistantWorkflowCard(
  card: AgentCardInstance,
  effectiveAgent: AgentTemplate,
  runtimeInput: string,
  context: CardRuntimeContext,
  runtimeBinding: RuntimeBinding | null,
  startedAt: string,
): Promise<CardRunResult> {
  const workflowSteps = resolveVisibleAssistWorkflowSteps(card, context);
  if (workflowSteps.length <= 1) {
    return runAssistantLeafCard(
      card,
      effectiveAgent,
      runtimeInput,
      context,
      runtimeBinding,
      startedAt,
    );
  }

  const stepIdSet = new Set(workflowSteps.map((step) => step.card.id));
  const workflowEdges = resolveVisibleAssistFlowEdges(context, stepIdSet);
  return runCompositeWorkflow(card, effectiveAgent, runtimeInput, context, runtimeBinding, startedAt, {
    scope: 'assist_workflow',
    runtimeType: 'assistant_agent',
    steps: workflowSteps,
    edges: workflowEdges,
    emptyOutputError: `assist_workflow_empty_output: headCardId=${card.id}`,
    stepFailurePrefix: 'assist_workflow_step_failed',
    consolidationScopeId: `assist_workflow_${card.id}`,
  });
}

async function runAssistantAgentCard(
  card: AgentCardInstance,
  effectiveAgent: AgentTemplate,
  runtimeInput: string,
  context: CardRuntimeContext,
  runtimeBinding: RuntimeBinding | null,
  startedAt: string,
): Promise<CardRunResult> {
  if (context.allowVisibleAssistWorkflowExpansion && isTopLevelAssistCard(card)) {
    return runAssistantWorkflowCard(
      card,
      effectiveAgent,
      runtimeInput,
      context,
      runtimeBinding,
      startedAt,
    );
  }

  return runAssistantLeafCard(
    card,
    effectiveAgent,
    runtimeInput,
    context,
    runtimeBinding,
    startedAt,
  );
}

async function runGraphFlowCard(
  card: AgentCardInstance,
  effectiveAgent: AgentTemplate,
  runtimeInput: string,
  context: CardRuntimeContext,
  runtimeBinding: RuntimeBinding | null,
  startedAt: string,
): Promise<CardRunResult> {
  const graphSteps = resolveGraphExecutionSteps(card, context);
  if (graphSteps.length === 0) {
    throw new Error(`graph_flow_steps_required: graphCardId=${card.id}`);
  }
  const stepIdSet = new Set(graphSteps.map((step) => step.card.id));
  const graphEdges = resolveGraphFlowEdges(card, context, stepIdSet);
  return runCompositeWorkflow(card, effectiveAgent, runtimeInput, context, runtimeBinding, startedAt, {
    scope: 'graph_flow',
    runtimeType: 'graph_flow',
    steps: graphSteps,
    edges: graphEdges,
    emptyOutputError: `graph_flow_empty_output: graphCardId=${card.id}`,
    stepFailurePrefix: 'graph_flow_step_failed',
    consolidationScopeId: `graph_flow_${card.id}`,
  });
}

async function runMagenticCard(
  card: AgentCardInstance,
  effectiveAgent: AgentTemplate,
  runtimeInput: string,
  context: CardRuntimeContext,
  runtimeBinding: RuntimeBinding | null,
  startedAt: string,
): Promise<CardRunResult> {
  const callableHeads = resolveCallableHeadCards(card, context);
  if (callableHeads.length === 0) {
    throw new Error(`magentic_callable_heads_required: cardId=${card.id}`);
  }
  const graphRelevantTask = isGraphRelevantMagenticTask(runtimeInput, callableHeads);
  const workspaceFocus = toWorkspaceFocusSummary(context.workspaceContext);

  const modelConfig = resolveCardModelConfig(card, effectiveAgent, `card_${card.id}`);
  const prompt = resolveCardSystemPrompt(card, effectiveAgent);
  const chooserSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      selectedCardId: { type: ['string', 'null'] },
      directResponseText: { type: ['string', 'null'] },
      progressText: { type: ['string', 'null'] },
      graphViewContract: { type: ['object', 'null'], additionalProperties: true },
      // Temporary legacy key accepted during migration.
      codegraphViewContract: { type: ['object', 'null'], additionalProperties: true },
    },
  };
  const chooserSystem = [
    prompt,
    'You are the top-level orchestrator for this deck run.',
    'Choose exactly one callable head card to run next, or answer directly if no head should be called.',
    'Optionally include progressText with one short plain-language status update for the plan stream.',
    graphRelevantTask
      ? 'This routing decision is graph-relevant. Include graphViewContract as structured JSON.'
      : 'Include graphViewContract only when graph focus will materially improve the next step.',
    graphRelevantTask
      ? 'When included, graphViewContract should include graphKind, projectId, focusNodeIds, focusPaths, focusSymbols, nodeLabelAllowlist, edgeTypeAllowlist, showLabels, maxNodes, cameraMode, animationMode, and narrativeIntent.'
      : null,
    workspaceFocus?.objectEditorOpen
      ? 'Workspace focus currently has an object editor open. Prefer decisions that directly help the open card context when that is compatible with the user request.'
      : null,
    'Return JSON only with keys selectedCardId, directResponseText, progressText, and graphViewContract.',
    'Set exactly one of selectedCardId or directResponseText to a non-empty value.',
  ]
    .filter(Boolean)
    .join('\n\n');
  const chooserInput = JSON.stringify(
    {
      userText: runtimeInput,
      callableHeads: callableHeads.map((head) => ({
        cardId: head.id,
        title: head.title,
        runtimeType: resolveCardRuntimeType(head),
        runtimeBinding: head.runtimeBinding || null,
      })),
      graphRelevantTask,
      workspaceFocus,
      graphContractTemplate: graphRelevantTask
        ? buildGraphRelevantCodeGraphContract(runtimeInput, context.projectId)
        : null,
    },
    null,
    2,
  );
  const chooserResult = await runLLM(chooserInput, {
    modelKey: modelConfig.modelKey,
    provider: modelConfig.provider,
    providerModelId: modelConfig.providerModelId,
    temperature: modelConfig.temperature ?? undefined,
    maxTokens: modelConfig.maxTokens ?? undefined,
    system: chooserSystem || undefined,
    jsonMode: true,
    jsonSchema: buildJsonSchema(card.id, chooserSchema),
    useResponsesApi: modelConfig.provider === 'openai',
  });

  const parsed = extractJsonObject(chooserResult.text || '');
  const directResponseText = String(parsed?.directResponseText || '').trim();
  const selectedCardId = String(parsed?.selectedCardId || '').trim();
  const progressText = String(parsed?.progressText || '').trim();
  const parsedCodegraphViewContract = normalizeCodeGraphViewContractCandidate(
    parsed?.graphViewContract ?? parsed?.codegraphViewContract,
  );
  const graphViewContract = graphRelevantTask
    ? buildGraphRelevantCodeGraphContract(
        runtimeInput,
        context.projectId,
        parsedCodegraphViewContract,
      )
    : parsedCodegraphViewContract;

  if (directResponseText) {
    emitRuntimeEvent(context, {
      kind: 'magentic_assignment',
      cardId: card.id,
      cardTitle: card.title,
      runtimeType: 'magentic_one',
      text: `${card.title} answered directly without delegating to another visible card.`,
      progressText: progressText || null,
      status: 'success',
      graphViewContract,
      codegraphViewContract: graphViewContract,
    });
    emitRuntimeMessage(context, {
      cardId: card.id,
      cardTitle: card.title,
      runtimeType: 'magentic_one',
      role: 'assistant',
      content: progressText,
    });
    emitRuntimeMessage(context, {
      cardId: card.id,
      cardTitle: card.title,
      runtimeType: 'magentic_one',
      role: 'assistant',
      content: directResponseText,
    });
    return {
      output: directResponseText,
      status: 'success',
      startedAt,
      endedAt: new Date().toISOString(),
      runtimeBinding,
      runtimeType: 'magentic_one',
      seed: context.seed,
      inputSummary: summarizeText(runtimeInput),
      outputSummary: summarizeText(directResponseText),
      graphViewContract,
      codegraphViewContract: graphViewContract,
    };
  }

  const selectedHead = callableHeads.find((head) => head.id === selectedCardId);
  if (!selectedHead) {
    throw new Error(`magentic_invalid_head_selection: cardId=${card.id} selectedCardId=${selectedCardId || 'missing'}`);
  }
  const templates = context.allTemplates || [];
  const selectedEffectiveAgent = resolveEffectiveAgent(selectedHead, templates);
  if (!selectedEffectiveAgent) {
    throw new Error(
      `magentic_head_template_missing: cardId=${card.id} selectedCardId=${selectedHead.id} templateId=${selectedHead.templateId}`,
    );
  }
  const selectedHeadEdgeId =
    (context.allEdges || []).find(
      (edge) =>
        edge.source === card.id &&
        edge.target === selectedHead.id &&
        normalizeEdgeType(edge.edgeType) === 'magentic_option',
    )?.id || null;
  emitRuntimeEvent(context, {
    kind: 'magentic_assignment',
    cardId: card.id,
    cardTitle: card.title,
    runtimeType: 'magentic_one',
    edgeIds: selectedHeadEdgeId ? [selectedHeadEdgeId] : [],
    text: `${card.title} assigned work to ${selectedHead.title}.`,
    progressText: progressText || null,
    status: 'running',
    graphViewContract,
    codegraphViewContract: graphViewContract,
  });
  emitRuntimeMessage(context, {
    cardId: card.id,
    cardTitle: card.title,
    runtimeType: 'magentic_one',
    role: 'assistant',
    content: progressText,
  });
  const selectedResult = await runCardWithContract(selectedHead, selectedEffectiveAgent, runtimeInput, {
    ...context,
    userInput: runtimeInput,
    previousOutput: '',
    allowVisibleAssistWorkflowExpansion: resolveCardRuntimeType(selectedHead) === 'assistant_agent',
  });
  if (selectedResult.status !== 'success') {
    throw new Error(
      selectedResult.error ||
        `magentic_selected_head_failed: cardId=${card.id} selectedCardId=${selectedHead.id}`,
    );
  }
  const selectedLegacyGraphViewContract = toGraphViewContract(selectedResult.codegraphViewContract);

  return {
    output: selectedResult.output,
    status: 'success',
    startedAt,
    endedAt: new Date().toISOString(),
    runtimeBinding,
    runtimeType: 'magentic_one',
    seed: context.seed,
    inputSummary: summarizeText(runtimeInput),
    outputSummary: summarizeText(selectedResult.output),
    graphViewContract:
      selectedResult.graphViewContract ??
      selectedLegacyGraphViewContract ??
      graphViewContract,
    codegraphViewContract:
      selectedResult.graphViewContract ??
      selectedLegacyGraphViewContract ??
      graphViewContract,
  };
}

export async function runCardWithContract(
  card: AgentCardInstance,
  effectiveAgent: AgentTemplate,
  input: string,
  context: CardRuntimeContext,
): Promise<CardRunResult> {
  const startedAt = new Date().toISOString();
  const runtimeBinding: RuntimeBinding | null = resolveRuntimeBinding(card.runtimeBinding, card.id);
  const runtimeInput = buildRuntimeInput(input, context);
  const runtimeType = resolveCardRuntimeType(card);

  try {
    switch (runtimeType) {
      case 'assistant_agent':
        return await runAssistantAgentCard(
          card,
          effectiveAgent,
          runtimeInput,
          context,
          runtimeBinding,
          startedAt,
        );
      case 'magentic_one':
        return await runMagenticCard(
          card,
          effectiveAgent,
          runtimeInput,
          context,
          runtimeBinding,
          startedAt,
        );
      case 'graph_flow':
        return await runGraphFlowCard(
          card,
          effectiveAgent,
          runtimeInput,
          context,
          runtimeBinding,
          startedAt,
        );
      default:
        throw new Error(`team_runtime_not_supported: runtimeType=${runtimeType} cardId=${card.id}`);
    }
  } catch (err: any) {
    return {
      output: null,
      status: 'error',
      error: formatCardRuntimeError(err),
      startedAt,
      endedAt: new Date().toISOString(),
      runtimeBinding,
      runtimeType,
      seed: context.seed,
      inputSummary: summarizeText(runtimeInput),
      outputSummary: summarizeText(String(err?.message || err || 'card_run_failed')),
    };
  }
}
