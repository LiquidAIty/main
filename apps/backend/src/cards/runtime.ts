import {
  CardRunResult,
  MagOneRoutingAgent,
  MagOneRoutingDiagnostics,
  MagOneRoutingManifest,
  PythonAutoGenPayloadShape,
  RUNTIME_TOOL_SPECS,
  RuntimeGraph,
  RuntimeGraphEdge,
  RuntimeGraphNode,
} from '../contracts/runtimeContracts';
import { orchestrateWithAutoGen } from '../services/autogen/autogenOrchestratorClient';
import { resolveModel } from '../llm/models.config';

export const MAG_ONE_CODING_RUN_SYSTEM_PROMPT = `
You are Mag One, the orchestration router for LiquidAIty. The user chats with you first.

Inspect the current AgentBuilder canvas state before routing. A direct connection to the vertical
Magentic bus means an agent is eligible; disconnected cards are ineligible. The bus does not define
execution order. Choose an execution path from currently eligible agents based on workflow type,
never from stale or assumed topology.

For coding workflows, distinguish explanation, planning, diagnosis, repo edits, tests, and runtime
smoke. If no code action is needed, answer normally. Otherwise use Plan Agent to create or validate
the plan, require the root-bound CodeGraph/CBM scoped gate, send Local Coder one bounded CoderPacket
only after the gate passes, and record the strict CoderReport, proof, blockers, and decisions with
ThinkGraph. Local Coder must invoke its selected coder_console_task tool; do not bypass it or ask the
user to type the task into the terminal. Default Local Coder to read-only/plan mode. Edit mode
requires explicit user approval and CoderPacket writeMode: edit. After tool invocation, report task
started or blocked, session id, target root, provider/model when known, exact blocker, and
"watch in Code Console". Refresh CodeGraph/CBM after successful code changes and update skills only
for reusable learning. Ordinary chat must not invoke coder_console_task.

Agent roles: Plan Agent is the approval/planning surface; CodeGraph Agent owns structural code memory
and the CBM scoped gate; Local Coder is the controlled patch/test/runtime worker; ThinkGraph Agent
stores project decisions, reports, proof, and blockers; KnowGraph Agent provides grounded external
or ingested knowledge and is not the code-memory gate. Use Research, WorldSignals, or Trading for
coding only when required by the workflow and currently connected.

Hard rules: do not call disconnected cards; do not use stale canvas topology; do not ask graph-memory
agents to run tools they do not own; do not treat ThinkGraph as a calculator/date/runtime utility;
do not treat KnowGraph as CodeGraph; do not bypass the CBM scoped gate; do not silently fall back to
grep, cached packets, old CBM results, or direct search as if CBM were fresh; do not fake CoderReport
success. If Plan Agent, CodeGraph Agent, or Local Coder is missing or disconnected for a coding run,
return a clear blocker. If Local Coder times out, report the timeout honestly with stage evidence.

Dogfood target note: C:\\Projects\\main may be the active target root and may receive approved edits
to LiquidAIty-owned source. Vendored localcoder/ remains excluded unless an active CoderPacket
explicitly targets it. Future external project roots must be explicit and use the same root-bound
CBM gate and CoderPacket/CoderReport lifecycle.
`.trim();

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

function normalizeRoleText(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function resolveMagOneAgentRole(card: any): string {
  const identity = [
    card.id,
    card.title,
    card.templateId,
    card.runtimeType,
    card.runtimeBinding,
  ].map(normalizeRoleText).join(' ');
  if (identity.includes('local_coder') || identity.includes('local coder')) return 'local_coder';
  if (identity.includes('codegraph')) return 'codegraph';
  if (identity.includes('thinkgraph')) return 'thinkgraph';
  if (identity.includes('knowgraph')) return 'knowgraph';
  if (identity.includes('worldsignals')) return 'worldsignals';
  if (identity.includes('trading')) return 'trading';
  if (identity.includes('research')) return 'research';
  if (
    identity.includes('plan_agent') ||
    identity.includes('template_plan_agent') ||
    identity.includes('plan agent')
  ) return 'plan';
  return 'other';
}



function routingAgent(card: any, reason: string): MagOneRoutingAgent {
  return {
    id: String(card.id || ''),
    title: String(card.title || card.id || 'Agent'),
    role: resolveMagOneAgentRole(card),
    reason,
  };
}

export function buildMagOneRoutingDiagnostics(
  magenticCard: any,
  allCards: any[],
  allEdges: any[],
  userText: string,
  context: { projectId?: string; deckId?: string } = {},
): MagOneRoutingDiagnostics {
  const eligible = resolvedMagenticOptions(magenticCard.id, allCards, allEdges);
  const eligibleIds = new Set(eligible.map((card) => String(card.id)));
  // Normal chat submit is a planning turn. TypeScript does not classify the
  // user's request or declare a workflow type — the real Python Magentic-One
  // orchestrator owns that. These diagnostics only describe which bus-connected
  // agents are available; every eligible participant is carried to the
  // orchestrator with no coding gate and no coder-dispatch packet. Execution is
  // a separate, explicit Run action (see coder.routes.ts), not a chat side effect.
  const canvasRuntimeCards = allCards.filter(
    (card) =>
      card.id !== magenticCard.id &&
      (card.kind === 'agent' || Boolean(String(card.runtimeType || '').trim())),
  );
  const selectedCards = eligible;
  const selectedIds = new Set(selectedCards.map((card) => String(card.id)));
  const selectedExecutionPath = selectedCards.map((card) =>
    routingAgent(card, 'eligible current bus participant available to the planning orchestrator'),
  );
  const missingRequiredAgents: string[] = [];

  return {
    projectId: String(context.projectId || ''),
    deckId: String(context.deckId || ''),
    eligibleBusConnectedAgents: eligible.map((card) =>
      routingAgent(card, 'directly connected to the current Magentic bus'),
    ),
    selectedExecutionPath,
    ignoredEligibleAgents: eligible
      .filter((card) => !selectedIds.has(String(card.id)))
      .map((card) =>
        routingAgent(card, 'eligible current bus participant not required for this turn'),
      ),
    disconnectedAgentsIgnored: canvasRuntimeCards
      .filter((card) => !eligibleIds.has(String(card.id)))
      .map((card) => routingAgent(card, 'ignored because the card is disconnected from the current Magentic bus')),
    missingRequiredAgents,
    blockedReason:
      missingRequiredAgents.length > 0
        ? `MAGONE_CODER_CONSOLE_BLOCKED_PARTICIPANT_GATE: missing=${missingRequiredAgents.join(', ')}`
        : null,
  };
}

function roleCapabilities(role: string): string[] {
  if (role === 'local_coder') return ['coding.execute', 'coding.inspect'];
  if (role === 'codegraph') return ['code.context'];
  if (role === 'thinkgraph') return ['project.memory.record'];
  if (role === 'plan') return ['coding.plan'];
  return [];
}

export function buildMagOneRoutingManifest(
  magenticCard: any,
  allCards: any[],
  allEdges: any[],
  userText: string,
): MagOneRoutingManifest {
  // Capability manifest only — it describes which bus-connected agents exist and
  // what they can do, so Python Magentic-One can *propose* an action. It carries
  // no intent/workflow classification; chat submit is always a neutral planning
  // turn and the orchestrator decides what the task is.
  const connected = new Set(
    resolvedMagenticOptions(magenticCard.id, allCards, allEdges).map((card) => String(card.id)),
  );
  const priorityByRole: Record<string, number> = {
    local_coder: 100,
    codegraph: 90,
    plan: 80,
    thinkgraph: 70,
  };
  return {
    agents: allCards
      .filter((card) => card.id !== magenticCard.id && card.kind === 'agent')
      .map((card) => {
        const role = resolveMagOneAgentRole(card);
        const busConnected = connected.has(String(card.id));
        const localCoder = role === 'local_coder';
        return {
          cardId: String(card.id),
          kind: String(card.kind || 'agent'),
          runtimeType: resolveCardRuntimeType(card),
          label: String(card.title || card.id),
          busConnected,
          role,
          capabilities: roleCapabilities(role),
          tools: busConnected ? resolveCardTools(card) : [],
          requiredGates: localCoder ? ['CodeGraph.connected', 'CBM.scope.ok'] : [],
          preferredIntents: roleCapabilities(role).length > 0 ? ['coding'] : [],
          priority: priorityByRole[role] || 0,
          blockedReason: busConnected ? null : 'not_bus_connected',
          ...(localCoder
            ? { defaultEditMode: 'read_only' as const, watchSurface: 'Code Console' as const, async: true }
            : {}),
        };
      }),
  };
}

// buildMagOneCodingWorkflowPacket was removed: TypeScript no longer manufactures
// a coder-dispatch packet (intent, selected primary agent, compactSpec) from
// chat. That was the bypass that overrode the real Magentic-One Task Ledger and
// forced a coder_console_task dispatch + 45s timeout. Coding execution is the
// explicit Run route only (/api/coder/localcoder/run).

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
  return runtimeType === 'assistant_agent' || runtimeType === 'local_coder';
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
  let raw = Array.isArray(fromOptions) ? fromOptions : Array.isArray(card.tools) ? card.tools : [];
  const role = resolveMagOneAgentRole(card);
  if (raw.length === 0 && role === 'local_coder') {
    raw = ['coder_console_task'];
  }
  // T001: the card Tools tab is the only allowed source, and only known
  // enabled ToolSpecs pass through. The Local Coder default is the smallest
  // safe mapping for persisted cards created before this tool existed.
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
    if (name === 'coder_console_task' && role !== 'local_coder') {
      throw new Error(`coder_console_tool_requires_local_coder_card: cardId=${card.id}`);
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
    role: card.runtimeOptions?.role
      ? String(card.runtimeOptions.role)
      : resolveMagOneAgentRole(card),
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
  const routingDiagnostics = buildMagOneRoutingDiagnostics(
    card,
    context.allCards || [card, ...callableHeads],
    context.allEdges || [],
    runtimeInput,
    { projectId: context.projectId, deckId: context.deckId },
  );
  const routingManifest = buildMagOneRoutingManifest(
    card,
    context.allCards || [card, ...callableHeads],
    context.allEdges || [],
    runtimeInput,
  );
  // Normal chat submit is planning only. TypeScript builds no coder-dispatch
  // packet and ships none to Python: the real Magentic-One LedgerOrchestrator
  // owns the Task Ledger / Progress Ledger and may *propose* the Local Coder in
  // its ledger, but execution happens only through the explicit Run route
  // (/api/coder/localcoder/run), never as a side effect of chat.
  // Planning participants = every eligible bus-connected callable agent EXCEPT
  // the Local Coder. Dropping the coder from the planning run makes it
  // structurally impossible to auto-dispatch a coding task from chat: the real
  // Magentic-One orchestrator can still name 'local_coder' as a proposed next
  // actor in its Progress Ledger, but it cannot execute one. Execution is the
  // explicit Run route only.
  const supportedHeads = callableHeads
    .filter((head) => isPythonAutoGenCallableRuntimeType(resolveCardRuntimeType(head)))
    .filter((head) => resolveMagOneAgentRole(head) !== 'local_coder');
  const systemPrompt = [MAG_ONE_CODING_RUN_SYSTEM_PROMPT, String(card.prompt || '').trim()]
    .filter(Boolean)
    .join('\n\n');
  
  const participants = supportedHeads.map((head) => {
    const model = resolveCardModelStrict(head);

    return {
      cardId: String(head.id || ''),
      title: String(head.title || 'Agent'),
      runtimeType: 'assistant_agent',
      runtimeBinding: head.runtimeBinding || null,
      role: resolveMagOneAgentRole(head),
      summary: `Participant ${head.title || 'Agent'}`,
      allowedActions: [],
      inputContract: 'text',
      outputContract: 'text',
      callable: true,
      // NOTE: the full role prompt is intentionally NOT in the public participant
      // manifest (it would bloat the payload and leak internal prompt text). The
      // prompt lives only in `privateParticipants` below, used solely by Python to
      // set AssistantAgent.system_message — never as visible/team-description text.
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

  const privateParticipants = supportedHeads.map((head) => {
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
    supportedHeads,
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
    systemPrompt,
    // Structured Run Task gate (no magic userText command). True only when the
    // explicit Run Task action ran the deck; chat submit leaves it false and the
    // Python rails halts after the Task Ledger.
    runApproved: Boolean((context as any)?.runApproved),
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
    routingManifest,
    cardRuntime: {
      cardId: String(card.id || ''),
      title: String(card.title || 'Magentic Agent'),
      runtimeType: 'magentic_one',
      prompt: systemPrompt,
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
        selectedWorkflowNodeIds: routingDiagnostics.selectedExecutionPath.map((agent) => agent.id),
        pythonWorkerIds: supportedHeads.map((h) => h.id),
        calledAgentIds: [],
        excludedAgentIds: [],
        routingDiagnostics,
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
    const routingDiagnostics = buildMagOneRoutingDiagnostics(
      card,
      context.allCards || [],
      context.allEdges || [],
      input,
      { projectId: context.projectId, deckId: context.deckId },
    );
    const mode = String((card.runtimeOptions as any)?.mode || process.env.AGENT_DISCOVERY_MODE || 'locked_research_runtime').trim();
    const isDiscoveryMode = mode === 'discovery_proposal';

    if (routingDiagnostics.blockedReason) {
      throw new Error(routingDiagnostics.blockedReason);
    }
    if (!isDiscoveryMode && callableHeads.length === 0) {
      throw new Error('magentic_runtime_no_current_bus_connected_participants');
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

    // Call the Python AutoGen rails. Mock success is not allowed on this route.
    let finalText = '';
    let magenticPlan: Record<string, unknown> | null = null;
    // Honest TaskLedger trace from the real Python Magentic-One path.
    let ledgerTrace: Record<string, unknown> | undefined;
    try {
        console.log('[runCardWithContract] executing Python AutoGen rails route.');
        const sidecarResponse = await orchestrateWithAutoGen(payload as any);

        // Transport only. The real AutoGen output is the messages/events the
        // Python rails output captured verbatim from run_stream, plus the orchestrator's own
        // Progress Ledger JSON when the inner loop ran. The backend authors no
        // ledger, no summary, and does not parse message text into runtime state.
        // finalResponseText is the real chat answer: the workbench renders it in
        // chat for non-plan turns, and PlanFlow ignores it entirely (PlanFlow is
        // built only from the taskLedgerArtifact, never from finalResponseText).
        finalText = String(sidecarResponse.finalResponseText || '').trim();
        const autogenMessages = Array.isArray((sidecarResponse as any).autogenMessages)
          ? (sidecarResponse as any).autogenMessages
          : [];
        const autogenEvents = Array.isArray((sidecarResponse as any).autogenEvents)
          ? (sidecarResponse as any).autogenEvents
          : [];
        const taskLedgerArtifact = (sidecarResponse as any).taskLedgerArtifact ?? null;
        const progressLedgerReference = (sidecarResponse as any).progressLedgerReference ?? null;
        magenticPlan = {
          autogenMessages,
          autogenEvents,
          ...(taskLedgerArtifact ? { taskLedgerArtifact } : {}),
          ...(progressLedgerReference ? { progressLedgerReference } : {}),
        };
        ledgerTrace =
          sidecarResponse.ledgerTrace && typeof sidecarResponse.ledgerTrace === 'object'
            ? (sidecarResponse.ledgerTrace as Record<string, unknown>)
            : undefined;
    } catch (e: any) {
        console.error('[runCardWithContract] Exact caught error message:', e?.message || e);
        throw e;
    }

    // Success requires a real chat answer or a real task artifact. Empty transport is a failure.
    const hasArtifact = Boolean((magenticPlan as any)?.taskLedgerArtifact);
    if (!finalText && !hasArtifact) {
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
      // Transported Python rails artifacts for PlanFlow / AgentCanvas projection.
      magenticTrace:
        Object.keys(magenticPlan || {}).length > 0 || ledgerTrace
          ? {
              ...(Object.keys(magenticPlan || {}).length > 0 ? { plan: magenticPlan } : {}),
              ...(ledgerTrace ? { ledgerTrace } : {}),
            }
          : null,
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
