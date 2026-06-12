import {
  CardRunResult,
  PythonAutoGenPayloadShape,
  RUNTIME_TOOL_SPECS,
  RuntimeGraph,
  RuntimeGraphEdge,
  RuntimeGraphNode,
} from '../contracts/runtimeContracts';
import { orchestrateWithAutoGen } from '../services/autogen/autogenOrchestratorClient';
import { resolveModel } from '../llm/models.config';

function normalizeProvider(value: unknown): 'openai' | 'openrouter' | null {
  const provider = String(value ?? '').trim().toLowerCase();
  if (provider === 'openai' || provider === 'openrouter') return provider;
  return null;
}

function coerceNumber(value: unknown, fallback: number | null): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function resolveOrchestratorCardModel(card: any): {
  provider: string;
  modelKey: string;
  providerModelId: string;
  temperature: number | null;
  maxTokens: number | null;
} {
  const modelKey = card.runtimeOptions?.modelKey;
  if (!modelKey) {
    throw new Error(
      `card_model_config_missing: cardId=${card.id} runtimeType=${card.runtimeType}`,
    );
  }
  const resolved = resolveModel(modelKey);
  const registryProvider = resolved.provider;
  const uiProvider = normalizeProvider(card.runtimeOptions?.provider);
  if (uiProvider && uiProvider !== registryProvider) {
    throw new Error(
      `card_model_config_mismatch: cardId=${card.id} uiProvider=${uiProvider} registryProvider=${registryProvider}`,
    );
  }
  return {
    provider: registryProvider,
    modelKey,
    providerModelId: resolved.id,
    temperature: coerceNumber(card.runtimeOptions?.temperature, null),
    maxTokens: coerceNumber(card.runtimeOptions?.maxTokens, null),
  };
}

function summarizeText(value: string | null | undefined, maxLength = 220): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
}

function normalizeEdgeType(value: unknown): string {
  return String(value || '').trim().toLowerCase() === 'magentic_option'
    ? 'magentic_option'
    : 'flow';
}

function resolveCardRuntimeType(card: any): string {
  return card.kind === 'agent'
    ? (card.runtimeType || 'assistant_agent')
    : 'assistant_agent';
}

function isAssistLikeRuntimeType(runtimeType: string): boolean {
  return runtimeType === 'assistant_agent' || runtimeType === 'local_coder';
}

export function resolvedMagenticOptions(
  magenticCardId: string,
  visibleNodes: any[],
  visibleEdges: any[]
): any[] {
  const nodeMap = new Map(visibleNodes.map((node) => [node.id, node]));
  const seen = new Set<string>();
  return visibleEdges
    .filter(
      (edge) =>
        (edge.source === magenticCardId || edge.target === magenticCardId) &&
        normalizeEdgeType(edge.edgeType) === 'magentic_option' &&
        edge.source !== edge.target,
    )
    .map((edge) => nodeMap.get(edge.source === magenticCardId ? edge.target : edge.source))
    .filter((node): node is any => Boolean(node && node.kind === 'agent'))
    .filter((node) => !String(node.parentGraphId || '').trim())
    .filter((node) => {
      const runtimeType = resolveCardRuntimeType(node);
      return isAssistLikeRuntimeType(runtimeType) || runtimeType === 'graph_flow';
    })
    .filter((node) => {
      if (seen.has(node.id)) return false;
      seen.add(node.id);
      return true;
    });
}

function isPythonAutoGenCallableRuntimeType(runtimeType: string): boolean {
  return runtimeType === 'assistant_agent';
}

function resolveCardModelStrict(card: any): {
  provider: string;
  providerModelId: string;
} {
  const modelKey = card.runtimeOptions?.modelKey;
  if (!modelKey) {
    throw new Error(
      `card_model_config_missing: cardId=${card.id} runtimeType=${card.runtimeType}`,
    );
  }
  const resolved = resolveModel(modelKey);
  const uiProvider = normalizeProvider(card.runtimeOptions?.provider);
  if (uiProvider && uiProvider !== resolved.provider) {
    throw new Error(
      `card_model_config_mismatch: cardId=${card.id} uiProvider=${uiProvider} registryProvider=${resolved.provider}`,
    );
  }
  return { provider: resolved.provider, providerModelId: resolved.id };
}

function resolveCardTools(card: any): string[] {
  const fromOptions = card.runtimeOptions?.tools;
  const raw = Array.isArray(fromOptions) ? fromOptions : Array.isArray(card.tools) ? card.tools : [];
  // T001: the card Tools tab is the only allowed source, and only known
  // enabled ToolSpecs pass through. No fallback or substitution.
  return raw.map((tool: any) => {
    const name = String(tool ?? '').trim();
    if (!name) {
      throw new Error(`card_tool_name_empty: cardId=${card.id}`);
    }
    const spec = RUNTIME_TOOL_SPECS.find((candidate) => candidate.name === name);
    if (!spec) {
      throw new Error(
        `card_tool_unknown: ${name} (cardId=${card.id}, known: ${RUNTIME_TOOL_SPECS.map((s) => s.name).join(',')})`,
      );
    }
    if (!spec.enabled) {
      throw new Error(`card_tool_disabled: ${name} (cardId=${card.id})`);
    }
    return name;
  });
}

function resolveCardFanOut(card: any): Record<string, any> | null {
  const fanOut = card.runtimeOptions?.fanOut;
  if (fanOut && typeof fanOut === 'object') return fanOut;
  // The persisted card-editor fan-out setting is executionMode='swarm'.
  if (card.runtimeOptions?.executionMode === 'swarm') {
    const count = coerceNumber(card.runtimeOptions?.swarmMaxWorkers, null);
    return {
      enabled: true,
      count: count && count > 0 ? count : 2,
      items: [],
    };
  }
  return null;
}

function cardHasChildSubgraph(cardId: string, allCards: any[]): boolean {
  return allCards.some((node) => String(node.parentGraphId || '').trim() === String(cardId));
}

export function buildRuntimeGraph(
  orchestratorCard: any,
  callableHeads: any[],
  allCards: any[],
  allEdges: any[],
  orchestratorModel: { provider?: string; providerModelId?: string },
): RuntimeGraph {
  const headIds = new Set(callableHeads.map((head) => String(head.id)));
  const childCards = allCards.filter((node) =>
    headIds.has(String(node.parentGraphId || '').trim()),
  );

  const toGraphNode = (
    card: any,
    overrides: Partial<RuntimeGraphNode> = {},
  ): RuntimeGraphNode => ({
    cardId: String(card.id || ''),
    title: String(card.title || ''),
    kind: String(card.kind || 'agent'),
    runtimeType: resolveCardRuntimeType(card),
    parentGraphId: String(card.parentGraphId || '').trim() || null,
    prompt: String(card.prompt || '').trim(),
    role: card.runtimeOptions?.role ? String(card.runtimeOptions.role) : null,
    tools: resolveCardTools(card),
    fanOut: resolveCardFanOut(card),
    isSocietyOfMind:
      Boolean(card.runtimeOptions?.isSocietyOfMind) ||
      cardHasChildSubgraph(card.id, allCards),
    provider: null,
    providerModelId: null,
    temperature: coerceNumber(card.runtimeOptions?.temperature, null),
    maxTokens: coerceNumber(card.runtimeOptions?.maxTokens, null),
    ...overrides,
  });

  const nodes: RuntimeGraphNode[] = [
    toGraphNode(orchestratorCard, {
      runtimeType: 'magentic_one',
      provider: orchestratorModel.provider ?? null,
      providerModelId: orchestratorModel.providerModelId ?? null,
      isSocietyOfMind: false,
    }),
  ];

  for (const head of callableHeads) {
    const model = resolveCardModelStrict(head);
    nodes.push(
      toGraphNode(head, {
        provider: model.provider,
        providerModelId: model.providerModelId,
      }),
    );
  }

  for (const child of childCards) {
    const model = resolveCardModelStrict(child);
    nodes.push(
      toGraphNode(child, {
        provider: model.provider,
        providerModelId: model.providerModelId,
        isSocietyOfMind: false,
      }),
    );
  }

  const includedIds = new Set(nodes.map((node) => node.cardId));
  const edges: RuntimeGraphEdge[] = (allEdges || [])
    .filter(
      (edge: any) =>
        includedIds.has(String(edge.source)) && includedIds.has(String(edge.target)),
    )
    .map((edge: any) => ({
      id: String(edge.id || `${edge.source}->${edge.target}`),
      source: String(edge.source),
      target: String(edge.target),
      edgeType: normalizeEdgeType(edge.edgeType) as 'flow' | 'magentic_option',
      loop:
        edge.loop && typeof edge.loop === 'object'
          ? edge.loop
          : edge.data?.loop && typeof edge.data.loop === 'object'
            ? edge.data.loop
            : edge.metadata?.loop && typeof edge.metadata.loop === 'object'
              ? edge.metadata.loop
              : Number(edge.metadata?.loopMaxIterations) >= 1
                ? {
                    maxIterations: Number(edge.metadata.loopMaxIterations),
                    exitOnText: edge.metadata?.loopExitText
                      ? String(edge.metadata.loopExitText)
                      : null,
                  }
                : null,
      data: edge.data && typeof edge.data === 'object' ? edge.data : {},
    }));

  return { nodes, edges };
}

export function buildPythonAutoGenCardRuntimePayload(
  card: any,
  effectiveAgent: any,
  runtimeInput: string,
  context: any,
  modelConfig: any,
  callableHeads: any[],
  startedAt: string,
  graphContextPacket?: any
): PythonAutoGenPayloadShape {
  const sessionId = `${context.deckId || 'deck'}:${card.id}:${Date.now()}`;
  const turnId = `${card.id}:${Date.now()}`;
  const supportedHeads = callableHeads.filter((head) =>
    isPythonAutoGenCallableRuntimeType(resolveCardRuntimeType(head)),
  );
  
  const participants = supportedHeads.map((head) => {
    let mappedRuntimeType = resolveCardRuntimeType(head);
    if (mappedRuntimeType === 'local_coder') {
      mappedRuntimeType = 'assistant_agent';
    }

    const model = resolveCardModelStrict(head);

    return {
      cardId: String(head.id || ''),
      title: String(head.title || 'Agent'),
      runtimeType: mappedRuntimeType,
      role: 'assistant',
      summary: `Participant ${head.title || 'Agent'}`,
      allowedActions: [],
      inputContract: 'text',
      outputContract: 'text',
      callable: true,
      prompt: String(head.prompt || '').trim(),
      tools: resolveCardTools(head),
      fanOut: resolveCardFanOut(head),
      isSocietyOfMind:
        Boolean(head.runtimeOptions?.isSocietyOfMind) ||
        cardHasChildSubgraph(head.id, context.allCards || []),
      provider: model.provider,
      providerModelId: model.providerModelId,
      temperature: head.runtimeOptions?.temperature ?? null,
      maxTokens: head.runtimeOptions?.maxTokens ?? null,
    };
  });

  const privateParticipants = callableHeads.map((head) => {
    let mappedRuntimeType = 'assistant_agent';
    if (head.runtimeType === 'research_agent' || head.templateId?.includes('research')) mappedRuntimeType = 'research_agent';
    if (head.runtimeType === 'planner_agent' || head.templateId?.includes('plan')) mappedRuntimeType = 'planner_agent';

    const model = resolveCardModelStrict(head);

    return {
      cardId: String(head.id || ''),
      runtimeType: mappedRuntimeType,
      runtimeBinding: head.runtimeBinding || null,
      prompt: String(head.prompt || '').trim(),
      provider: model.provider,
      providerModelId: model.providerModelId,
      temperature: head.runtimeOptions?.temperature ?? null,
      maxTokens: head.runtimeOptions?.maxTokens ?? null,
    };
  });

  const runtimeGraph = buildRuntimeGraph(
    card,
    callableHeads,
    context.allCards || [],
    context.allEdges || [],
    {
      provider: modelConfig?.provider,
      providerModelId: modelConfig?.providerModelId,
    },
  );

  const safeRuntimeOptions = { ...(card.runtimeOptions || {}) };
  const rawMaxTokens = safeRuntimeOptions.maxTokens;
  if (rawMaxTokens !== undefined && rawMaxTokens !== null) {
    const numMaxTokens = Number(rawMaxTokens);
    if (Number.isFinite(numMaxTokens) && numMaxTokens > 0) {
      safeRuntimeOptions.maxTokens = numMaxTokens;
    } else {
      delete safeRuntimeOptions.maxTokens;
    }
  }

  const lowerInput = runtimeInput.trim().toLowerCase();
  const isGenericPrompt = [
    'test', 'testing', 'hello', 'hi', 'hey', 'run', 'start', 'go', 'do it', 'execute', 'ping'
  ].includes(lowerInput);

  const isContinuation =
    lowerInput.includes('continue') ||
    lowerInput.includes('use previous') ||
    lowerInput.includes('finish that') ||
    lowerInput.includes('approve') ||
    lowerInput.includes('yes');

  let priorAssistantText = String(context.previousOutput || '').trim();
  if (isGenericPrompt && !isContinuation) {
    priorAssistantText = '';
  }

  const payload: PythonAutoGenPayloadShape = {
    session: {
      sessionId,
      projectId: String(context.projectId || ''),
      turnId,
      route: 'deck_runtime',
      orchestrator: 'magentic_one',
      modelProvider: modelConfig.provider,
      modelKey: modelConfig.modelKey,
      providerModelId: modelConfig.providerModelId,
      startedAt,
    },
    userText: runtimeInput,
    priorAssistantText,
    systemPrompt: String(card.prompt || '').trim(),
    plan: undefined,
    thinkGraph: undefined,
    knowGraph: undefined,
    blackboard: {
      current_goal: '',
      what_matters_now: [],
      open_questions: [],
      findings: [],
    },
    workspaceObjectContext: context.workspaceObjectContext ?? undefined,
    cardRuntime: {
      cardId: String(card.id || ''),
      title: String(card.title || 'Magentic Agent'),
      runtimeType: 'magentic_one',
      prompt: String(card.prompt || '').trim(),
      runtimeOptions: safeRuntimeOptions,
      graph: runtimeGraph,
      participants,
      privateParticipants,
      runtimeScope: {
        projectId: String(context.projectId || ''),
        deckId: String(context.deckId || ''),
        magenticCardId: card.id,
        visibleNodeIds: [card.id, ...callableHeads.map((h) => h.id)],
        visibleEdgeIds: (context.allEdges || [])
          .filter((e: any) => e.source === card.id || e.target === card.id)
          .map((e: any) => e.id),
        resolvedMagenticOptionIds: callableHeads.map((h) => h.id),
        selectedWorkflowNodeIds: [],
        pythonWorkerIds: callableHeads.map((h) => h.id),
        calledAgentIds: [],
        excludedAgentIds: [],
      }
    }
  };

  return payload;
}

export async function runCardWithContract(
  card: any,
  effectiveAgent: any,
  input: string,
  context: any
): Promise<CardRunResult> {
  const startedAt = new Date().toISOString();
  
  if (resolveCardRuntimeType(card) === 'magentic_one') {
    const callableHeads = resolvedMagenticOptions(card.id, context.allCards || [], context.allEdges || []);
    const mode = String((card.runtimeOptions as any)?.mode || process.env.AGENT_DISCOVERY_MODE || 'locked_research_runtime').trim();
    const isDiscoveryMode = mode === 'discovery_proposal';

    if (!isDiscoveryMode && callableHeads.length === 0) {
      throw new Error('No valid locked research runtime path resolved. Connect or select the baseline research agents, or explicitly enter discovery_proposal mode.');
    }
    
    const modelConfig = resolveOrchestratorCardModel(card);

    const payload = buildPythonAutoGenCardRuntimePayload(
      card,
      effectiveAgent,
      input,
      context,
      modelConfig,
      callableHeads,
      startedAt
    );

    // Normally we would call orchestrateWithAutoGen, but here we'll mock success or rely on the real service
    let finalText = '';
    try {
        const payloadStr = JSON.stringify(payload);
        console.log('[DEBUG-TRACE] runCardWithContract exact payload snapshot:');
        console.log('[DEBUG-TRACE] task/user input:', payload.userText);
        console.log('[DEBUG-TRACE] participants public manifest:', JSON.stringify(payload.cardRuntime?.participants || []));
        console.log('[DEBUG-TRACE] privateParticipants keys only:', (payload.cardRuntime?.privateParticipants || []).map((p:any) => p.cardId));
        console.log('[DEBUG-TRACE] visibleNodeIds:', payload.cardRuntime?.runtimeScope?.visibleNodeIds);
        console.log('[DEBUG-TRACE] visibleEdgeIds:', payload.cardRuntime?.runtimeScope?.visibleEdgeIds);
        console.log('[DEBUG-TRACE] workspaceObjectContext present:', !!payload.workspaceObjectContext);
        console.log('[DEBUG-TRACE] availableCanvasAgents present:', !!(payload.cardRuntime as any)?.availableCanvasAgents);
        console.log('[DEBUG-TRACE] excludedAgentIds present:', !!payload.cardRuntime?.runtimeScope?.excludedAgentIds);
        
        console.log('[DEBUG-TRACE] Payload string contains forbidden "sample_excerpt_1":', payloadStr.includes('sample_excerpt_1'));
        console.log('[DEBUG-TRACE] Payload string contains forbidden "DrugX":', payloadStr.includes('DrugX'));
        console.log('[DEBUG-TRACE] Payload string contains forbidden "HbA1c":', payloadStr.includes('HbA1c'));
        console.log('[DEBUG-TRACE] Payload string contains forbidden "Provisional ThinkGraph extraction":', payloadStr.includes('Provisional ThinkGraph extraction'));
        console.log('[DEBUG-TRACE] Payload string contains forbidden "Neo4j:":', payloadStr.includes('Neo4j:'));
        console.log('[DEBUG-TRACE] Payload string contains forbidden "Research Agent:":', payloadStr.includes('Research Agent:'));
        
        console.log('[runCardWithContract] canonical executeDeck entered.');
        console.log('[runCardWithContract] Sending payload to AutoGen sidecar. Keys:', Object.keys(payload));
        console.log('[runCardWithContract] Payload session:', payload.session);
        
        const sidecarResponse = await orchestrateWithAutoGen(payload as any);
        console.log('[runCardWithContract] sidecar response keys:', Object.keys(sidecarResponse));
        
        finalText = String(sidecarResponse.finalResponseText || '').trim();
        console.log('[runCardWithContract] parsed finalResponseText exists:', !!finalText);
    } catch (e: any) {
        console.error('[runCardWithContract] Exact caught error message:', e?.message || e);
        throw e;
    }

    if (!finalText) {
      throw new Error('autogen_orchestrator_missing_final_response');
    }

    return {
      output: finalText,
      status: 'success',
      startedAt,
      endedAt: new Date().toISOString(),
      runtimeType: 'magentic_one',
      inputSummary: summarizeText(input),
      outputSummary: summarizeText(finalText),
    };
  }
  
  return {
    output: "unsupported",
    status: 'error',
    startedAt,
    endedAt: new Date().toISOString(),
    error: "team_runtime_not_supported"
  };
}
