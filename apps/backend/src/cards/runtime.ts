import { CardRunResult, PythonAutoGenPayloadShape } from '../contracts/runtimeContracts';
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

    const participantModelKey = head.runtimeOptions?.modelKey;
    if (!participantModelKey) {
      throw new Error(
        `card_model_config_missing: cardId=${head.id} runtimeType=${head.runtimeType}`,
      );
    }
    const resolvedModel = resolveModel(participantModelKey);
    const registryProvider = resolvedModel.provider;
    const uiProvider = normalizeProvider(head.runtimeOptions?.provider);
    if (uiProvider && uiProvider !== registryProvider) {
      throw new Error(
        `card_model_config_mismatch: cardId=${head.id} uiProvider=${uiProvider} registryProvider=${registryProvider}`,
      );
    }

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
      provider: registryProvider,
      providerModelId: resolvedModel.id,
      temperature: head.runtimeOptions?.temperature ?? null,
      maxTokens: head.runtimeOptions?.maxTokens ?? null,
    };
  });

  const privateParticipants = callableHeads.map((head) => {
    let mappedRuntimeType = 'assistant_agent';
    if (head.runtimeType === 'research_agent' || head.templateId?.includes('research')) mappedRuntimeType = 'research_agent';
    if (head.runtimeType === 'planner_agent' || head.templateId?.includes('plan')) mappedRuntimeType = 'planner_agent';

    const participantModelKey = head.runtimeOptions?.modelKey;
    if (!participantModelKey) {
      throw new Error(
        `card_model_config_missing: cardId=${head.id} runtimeType=${head.runtimeType}`,
      );
    }
    const resolvedModel = resolveModel(participantModelKey);
    const registryProvider = resolvedModel.provider;
    const uiProvider = normalizeProvider(head.runtimeOptions?.provider);
    if (uiProvider && uiProvider !== registryProvider) {
      throw new Error(
        `card_model_config_mismatch: cardId=${head.id} uiProvider=${uiProvider} registryProvider=${registryProvider}`,
      );
    }

    return {
      cardId: String(head.id || ''),
      runtimeType: mappedRuntimeType,
      runtimeBinding: head.runtimeBinding || null,
      prompt: String(head.prompt || '').trim(),
      provider: registryProvider,
      providerModelId: resolvedModel.id,
      temperature: head.runtimeOptions?.temperature ?? null,
      maxTokens: head.runtimeOptions?.maxTokens ?? null,
    };
  });

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
