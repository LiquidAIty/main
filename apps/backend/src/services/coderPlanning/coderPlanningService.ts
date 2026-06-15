import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getNeo4jDriver } from '../../connectors/neo4j';
import {
  coderPacketJsonSchema,
  parseCoderContextPacket,
  parseCoderPacket,
  type CoderContextPacket,
  type CoderPacket,
  type CoderReport,
  type ContextSourceDiagnostic,
  type MagOnePlanningContext,
  type AvailableWorkflowOptions,
} from '../../contracts/coderContracts';
import { resolveLocalCoderWorkspaceRoot } from '../../coder/localcoder/adapter';
import { runLLM } from '../../llm/client';
import { resolveModel } from '../../llm/models.config';
import {
  buildGraphContextPacket,
  type BuildGraphContextPacketArgs,
} from '../graphContext/graphContextBuilder';
import { createEmptyGraphContextPacket } from '../graphContext/graphContextPacket';
import { recordThinkGraphEvent, readThinkGraphContextPacket } from '../thinkgraph/thinkgraphMemory';

const MAX_PLAN_EXCERPT = 16_000;
const MAX_CONTEXT_JSON = 48_000;
const TASKING_INSTRUCTION =
  'Before editing, make a bounded task list with purpose, likely files, proof, done condition, and risk/blocker. Complete those tasks and return a task-by-task CoderReport.';
const PLANNER_CONFIG_OPTIONS =
  'accepted options: SOL_CODER_PLANNER_MODEL_KEY; SOL_CODER_PLANNER_PROVIDER plus SOL_CODER_PLANNER_MODEL_ID; or explicit SOL_PRIMARY=openai|openrouter with its matching provider API key';

type PlanningSource = 'plan_md' | 'thinkgraph' | 'skillgraph' | 'graph_context';
const PLANNING_SOURCE_TIMEOUT_MS: Record<PlanningSource, number> = {
  plan_md: 2_000,
  thinkgraph: 6_000,
  skillgraph: 6_000,
  graph_context: 25_000,
};

type JsonRecord = Record<string, unknown>;

export type PrepareActiveCoderPacketInput = {
  projectId: string;
  userInput: string;
  repoPath?: string | null;
  planFlowState?: JsonRecord | null;
  selectedContext?: JsonRecord | null;
  workflowOption?: string;
};

export type SkillContext = {
  source: 'skillgraph_neo4j';
  skills: Array<{
    id: string;
    sourcePath: string;
    guardrails: string[];
    queryPatterns: string[];
  }>;
  warnings: string[];
};

export type PlannerProvenance = {
  source: 'backend_planning_service';
  provider: string;
  model: string;
  configSource: string;
  contextSources: string[];
};

export type CoderPlanningDeps = {
  now?: () => string;
  clock?: () => number;
  repoRoot?: string;
  sourceTimeoutMs?: Partial<Record<PlanningSource, number>>;
  readPlan?: (repoRoot: string) => Promise<string>;
  readThinkGraph?: typeof readThinkGraphContextPacket;
  buildGraphContext?: (
    args: BuildGraphContextPacketArgs,
  ) => ReturnType<typeof buildGraphContextPacket>;
  readSkillContext?: (userInput: string) => Promise<SkillContext>;
  generatePacket?: (
    contextPacket: CoderContextPacket,
  ) => Promise<{ packet: unknown; provenance: PlannerProvenance }>;
  persistPacket?: (
    packet: CoderPacket,
    contextPacket: CoderContextPacket,
    plannerProvenance: PlannerProvenance,
  ) => Promise<void>;
};

function cleanList(values: unknown[], limit = 40): string[] {
  return Array.from(
    new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean)),
  ).slice(0, limit);
}

function clamp(value: unknown, max = MAX_PLAN_EXCERPT): string {
  const text = String(value ?? '').trim();
  return text.length <= max ? text : `${text.slice(0, max)}\n...[truncated]`;
}

function toRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function extractPlanCodeAnchors(plan: string): string[] {
  const anchors = Array.from(plan.matchAll(/`([^`\r\n]+)`/g))
    .map((match) => match[1]?.trim() || '')
    .filter((value) => /[\\/]|[.][a-z0-9]{1,8}$/i.test(value));
  return cleanList(anchors, 30);
}

function selectedCodeAnchors(selectedContext: JsonRecord): string[] {
  return cleanList([
    ...(Array.isArray(selectedContext.focusPaths) ? selectedContext.focusPaths : []),
    ...(Array.isArray(selectedContext.relatedFiles) ? selectedContext.relatedFiles : []),
  ], 20);
}

function extractSkillQueries(skillContext: SkillContext): string[] {
  return cleanList(
    skillContext.skills.flatMap((skill) => skill.queryPatterns),
    12,
  );
}

function emptyThinkGraphPacket(projectId: string, warning: string) {
  return {
    packet_version: 1 as const,
    source: 'thinkgraph' as const,
    project_id: projectId,
    planflow_nodes: [],
    recent_events: [],
    active_decisions: [],
    assumptions: [],
    open_questions: [],
    last_runs: [],
    next_task: '',
    warnings: [warning],
  };
}

function emptySkillContext(warning: string): SkillContext {
  return { source: 'skillgraph_neo4j', skills: [], warnings: [warning] };
}

async function runPlanningSource<T>(args: {
  source: PlanningSource;
  critical: boolean;
  timeoutMs: number;
  clock: () => number;
  operation: () => Promise<T>;
  fallback: (blocker: string) => T;
  evidenceCount: (value: T) => number;
}): Promise<{ value: T; diagnostic: ContextSourceDiagnostic }> {
  const startedAt = args.clock();
  let timeoutId: NodeJS.Timeout | null = null;
  try {
    const value = await Promise.race([
      args.operation(),
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`source_timeout:${args.source}:${args.timeoutMs}ms`)),
          args.timeoutMs,
        );
      }),
    ]);
    const evidenceCount = args.evidenceCount(value);
    return {
      value,
      diagnostic: {
        source: args.source,
        critical: args.critical,
        status: evidenceCount > 0 ? 'ok' : 'empty',
        elapsedMs: Math.max(0, Math.round(args.clock() - startedAt)),
        evidenceCount,
        summary: `${args.source} returned ${evidenceCount} evidence item(s)`,
        blocker: '',
      },
    };
  } catch (error) {
    const blocker = error instanceof Error ? error.message : String(error);
    return {
      value: args.fallback(blocker),
      diagnostic: {
        source: args.source,
        critical: args.critical,
        status: blocker.startsWith('source_timeout:') ? 'timed_out' : 'failed',
        elapsedMs: Math.max(0, Math.round(args.clock() - startedAt)),
        evidenceCount: 0,
        summary: blocker,
        blocker,
      },
    };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function immediateDiagnostic(
  source: string,
  critical: boolean,
  value: JsonRecord,
): ContextSourceDiagnostic {
  const evidenceCount = Object.keys(value).length;
  return {
    source,
    critical,
    status: evidenceCount > 0 ? 'ok' : 'empty',
    elapsedMs: 0,
    evidenceCount,
    summary: `${source} contains ${evidenceCount} selected field(s)`,
    blocker: '',
  };
}

function contextDiagnosticBlockers(contextPacket: CoderContextPacket): string[] {
  return cleanList(
    contextPacket.sourceDiagnostics
      .filter((diagnostic) => ['blocked', 'timed_out', 'failed'].includes(diagnostic.status))
      .map(
        (diagnostic) =>
          `${diagnostic.source} ${diagnostic.status}: ${diagnostic.blocker || diagnostic.summary}`,
      ),
    20,
  );
}

export function resolveCoderPlannerConfig(env: NodeJS.ProcessEnv = process.env): {
  modelKey?: string;
  provider?: 'openai' | 'openrouter';
  providerModelId?: string;
  configSource: string;
} {
  const modelKey = String(env.SOL_CODER_PLANNER_MODEL_KEY || '').trim();
  const provider = String(env.SOL_CODER_PLANNER_PROVIDER || '').trim().toLowerCase();
  const providerModelId = String(env.SOL_CODER_PLANNER_MODEL_ID || '').trim();
  const solPrimary = String(env.SOL_PRIMARY || '').trim().toLowerCase();

  if (modelKey && (provider || providerModelId)) {
    throw new Error(`coder_planner_config_conflict: ${PLANNER_CONFIG_OPTIONS}`);
  }
  if (provider && !providerModelId) {
    throw new Error(
      `coder_planner_config_incomplete: missing SOL_CODER_PLANNER_MODEL_ID; ${PLANNER_CONFIG_OPTIONS}`,
    );
  }
  if (providerModelId && !provider) {
    throw new Error(
      `coder_planner_config_incomplete: missing SOL_CODER_PLANNER_PROVIDER; ${PLANNER_CONFIG_OPTIONS}`,
    );
  }
  if (modelKey) {
    try {
      resolveModel(modelKey);
    } catch (error) {
      throw new Error(
        `coder_planner_model_invalid: SOL_CODER_PLANNER_MODEL_KEY: ${error instanceof Error ? error.message : String(error)}; ${PLANNER_CONFIG_OPTIONS}`,
      );
    }
    return { modelKey, configSource: 'SOL_CODER_PLANNER_MODEL_KEY' };
  }
  if (provider && providerModelId) {
    if (provider !== 'openai' && provider !== 'openrouter') {
      throw new Error(
        `coder_planner_provider_invalid: SOL_CODER_PLANNER_PROVIDER=${provider}; ${PLANNER_CONFIG_OPTIONS}`,
      );
    }
    return {
      provider,
      providerModelId,
      configSource: 'SOL_CODER_PLANNER_PROVIDER+SOL_CODER_PLANNER_MODEL_ID',
    };
  }
  if (solPrimary === 'openai' || solPrimary === 'openrouter') {
    const requiredKey = solPrimary === 'openai' ? 'OPENAI_API_KEY' : 'OPENROUTER_API_KEY';
    if (!String(env[requiredKey] || '').trim()) {
      throw new Error(
        `coder_planner_provider_key_missing: ${requiredKey}; ${PLANNER_CONFIG_OPTIONS}`,
      );
    }
    const orchestrator = resolveModel(
      solPrimary === 'openai' ? 'gpt-5.1-chat-latest' : 'or-openai-gpt-5.1-chat',
    );
    if (orchestrator.provider !== solPrimary) {
      throw new Error(
        `coder_planner_sol_primary_registry_mismatch: SOL_PRIMARY=${solPrimary}; ${PLANNER_CONFIG_OPTIONS}`,
      );
    }
    return {
      provider: solPrimary,
      providerModelId: orchestrator.id,
      configSource: 'SOL_PRIMARY',
    };
  }
  if (solPrimary) {
    throw new Error(
      `coder_planner_sol_primary_invalid: SOL_PRIMARY must be openai or openrouter; ${PLANNER_CONFIG_OPTIONS}`,
    );
  }
  throw new Error(`coder_planner_model_missing: ${PLANNER_CONFIG_OPTIONS}`);
}

function cbmBlockerFromContext(contextPacket: CoderContextPacket): string {
  const codeGraphContext = toRecord(contextPacket.codeGraphContext);
  return String(codeGraphContext.blocker || '').trim();
}

function cbmEvidenceSummary(contextPacket: CoderContextPacket): {
  status: string;
  anchors: string[];
  summary: string[];
  blocker: string;
} {
  const codeGraphContext = toRecord(contextPacket.codeGraphContext);
  const freshness = toRecord(codeGraphContext.freshness);
  const status = String(freshness.status || 'unavailable').trim();
  const diagnosticStatus = String(freshness.diagnosticStatus || 'unknown').trim();
  const blocker = String(codeGraphContext.blocker || '').trim();
  const symbols = Array.isArray(codeGraphContext.relevantSymbols)
    ? cleanList(codeGraphContext.relevantSymbols, 12)
    : [];
  return {
    status,
    anchors: cleanList(contextPacket.codeAnchors, 20),
    blocker,
    summary: cleanList([
      `CBM status: ${status}`,
      `CBM freshness diagnostic: ${diagnosticStatus}`,
      `CBM project: ${String(freshness.project || 'unknown')}`,
      `CBM graph: ${String(freshness.nodes ?? 'unknown')} nodes / ${String(freshness.edges ?? 'unknown')} edges`,
      `CBM indexed files: ${String(freshness.indexedFileCount ?? 'unknown')}`,
      `CBM indexed revision: ${String(freshness.indexedRevision || 'unknown')}`,
      `CBM indexed at: ${String(freshness.indexedAt || 'unknown')}`,
      ...symbols.map((symbol) => `CBM symbol: ${symbol}`),
      ...(blocker ? [`CBM blocker: ${blocker}`] : []),
    ], 20),
  };
}

async function readSkillContextFromNeo4j(userInput: string): Promise<SkillContext> {
  const tokens = cleanList(
    userInput
      .toLowerCase()
      .split(/[^a-z0-9_.-]+/)
      .filter((token) => token.length >= 4),
    12,
  );
  if (tokens.length === 0) {
    return {
      source: 'skillgraph_neo4j',
      skills: [],
      warnings: ['skillgraph_no_query_tokens'],
    };
  }

  const session = getNeo4jDriver().session();
  try {
    const result = await session.run(
      `
        MATCH (s:Skill)
        WHERE any(token IN $tokens WHERE
          toLower(coalesce(s.id, s.skill_id, s.name, '')) CONTAINS token
          OR toLower(coalesce(s.source_path, '')) CONTAINS token)
        OPTIONAL MATCH (s)-[:HAS_GUARDRAIL]->(g:Guardrail)
        OPTIONAL MATCH (s)-[:HAS_QUERY]->(q:QueryPattern)
        RETURN coalesce(s.id, s.skill_id, s.name) AS id,
          coalesce(s.source_path, '') AS source_path,
          collect(DISTINCT coalesce(g.text, g.id, '')) AS guardrails,
          collect(DISTINCT coalesce(q.text, '')) AS queries
        LIMIT 5
      `,
      { tokens },
    );
    return {
      source: 'skillgraph_neo4j',
      skills: result.records.map((record) => ({
        id: String(record.get('id') || ''),
        sourcePath: String(record.get('source_path') || ''),
        guardrails: cleanList(record.get('guardrails') || []),
        queryPatterns: cleanList(record.get('queries') || []),
      })),
      warnings: result.records.length === 0 ? ['skillgraph_no_matching_skills'] : [],
    };
  } catch (error) {
    return {
      source: 'skillgraph_neo4j',
      skills: [],
      warnings: [
        `skillgraph_unavailable: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  } finally {
    await session.close();
  }
}

async function generatePacketWithPlanner(
  contextPacket: CoderContextPacket,
): Promise<{ packet: unknown; provenance: PlannerProvenance }> {
  const plannerConfig = resolveCoderPlannerConfig();
  const contextJson = JSON.stringify(contextPacket, null, 2);
  if (contextJson.length > MAX_CONTEXT_JSON) {
    throw new Error(`coder_context_packet_too_large: ${contextJson.length}`);
  }
  const result = await runLLM(contextJson, {
    modelKey: plannerConfig.modelKey,
    provider: plannerConfig.provider,
    providerModelId: plannerConfig.providerModelId,
    temperature: 0.1,
    maxTokens: 5_000,
    jsonSchema: {
      name: 'liquidaity_active_coder_packet',
      schema: coderPacketJsonSchema,
      strict: true,
    },
    useResponsesApi: plannerConfig.provider === 'openai',
    system: [
      'You are the backend planning service for LiquidAIty PlanFlow.',
      'Use only the supplied real Context Packet to create exactly one bounded active CoderPacket.',
      'Do not invent code evidence, planner provenance, execution, or success.',
      'The packet is the complete spec and task. It must stop after one job.',
      TASKING_INSTRUCTION,
    ].join('\n'),
  });
  return {
    packet: JSON.parse(result.text),
    provenance: {
      source: 'backend_planning_service',
      provider: result.provider,
      model: result.model,
      configSource: plannerConfig.configSource,
      contextSources: contextPacket.provenance.sources,
    },
  };
}

function enforceTrustedPacketFields(
  generatedValue: unknown,
  input: PrepareActiveCoderPacketInput,
  repoRoot: string,
  contextPacket: CoderContextPacket,
  now: string,
): CoderPacket {
  const generated = parseCoderPacket(generatedValue);
  const derivedWriteMode = input.workflowOption === 'run_read_only_coder_task' ? 'read-only' : 'edit';
  const isReadOnly = derivedWriteMode === 'read-only';
  const cbmBlocker = cbmBlockerFromContext(contextPacket);
  const sourceBlockers = contextDiagnosticBlockers(contextPacket);
  if (contextPacket.codeAnchors.length === 0 && !cbmBlocker) {
    throw new Error('context_packet_code_anchors_required');
  }
  const packet = parseCoderPacket({
    ...generated,
    id: `coderpacket:${input.projectId}:${now}`,
    projectId: input.projectId,
    repoPath: repoRoot,
    planExcerpt: contextPacket.planExcerpt,
    codeAnchors: contextPacket.codeAnchors,
    cbmQueries: contextPacket.cbmQueries,
    writeMode: derivedWriteMode === 'edit' ? 'edit' : 'read-only',
    contextSummary: cleanList([
      generated.contextSummary,
      ...(cbmBlocker ? [`CBM blocker: ${cbmBlocker}`] : []),
      ...sourceBlockers.map((blocker) => `Context source blocker: ${blocker}`),
    ]).join('\n'),
    guardrails: cleanList([
      ...generated.guardrails,
      'Use fresh Codebase Memory before editing and verify anchors by direct read.',
      'No fake success, silent fallback, spec/task files, commit, or push.',
      ...(isReadOnly ? ['Do not edit files.', 'Do not commit.', 'Do not push.', 'This is a read-only audit.'] : []),
      ...(cbmBlocker ? [`CBM blocker: ${cbmBlocker}`] : []),
      ...sourceBlockers.map((blocker) => `Context source blocker: ${blocker}`),
    ]),
    forbiddenWork: cleanList([
      ...generated.forbiddenWork,
      'Do not create specs/, tasks/, spec.md, or task.md.',
      'Do not start or execute a next CoderPacket.',
      ...(isReadOnly ? ['Editing any file.', 'Committing.', 'Pushing.'] : []),
    ]),
    stopConditions: cleanList([
      ...generated.stopConditions,
      ...(cbmBlocker
        ? ['Do not claim code-context proof until the recorded CBM blocker is resolved.']
        : []),
      ...(sourceBlockers.length > 0
        ? ['Do not claim complete context proof while recorded source blockers remain.']
        : []),
      'Stop after one CoderReport and return control to the user.',
    ]),
    reportFormat: generated.reportFormat.includes('task-by-task CoderReport')
      ? generated.reportFormat
      : `${generated.reportFormat}\n${TASKING_INSTRUCTION}`,
  });
  return packet;
}

async function persistCreatedPacket(
  packet: CoderPacket,
  contextPacket: CoderContextPacket,
  plannerProvenance: PlannerProvenance,
): Promise<void> {
  const cbmEvidence = cbmEvidenceSummary(contextPacket);
  const planFlowState = contextPacket.planFlowState as any;
  const realPlans = Array.isArray(planFlowState?.realMagenticPlans) ? planFlowState.realMagenticPlans : [];
  const latestPlan = realPlans[realPlans.length - 1];
  
  await recordThinkGraphEvent({
    projectId: packet.projectId,
    eventType: 'coder_packet_created',
    title: `Active CoderPacket created: ${packet.objective}`,
    summary: clamp(packet.contextSummary, 1_500),
    status: 'pending',
    task: packet.objective,
    runtimeRoute: 'chat -> magentic-one -> context packet -> backend planning service -> PlanFlow',
    assumptions: contextPacket.provenance.warnings,
    nextTask: packet.objective,
    coderPacketId: packet.id,
    coderPacketObjective: packet.objective,
    contextEvidenceSummary: cbmEvidence.summary,
    cbmStatus: cbmEvidence.status,
    codeAnchors: cbmEvidence.anchors,
    cbmBlocker: cbmEvidence.blocker,
    sourceDiagnosticsSummary: contextPacket.sourceDiagnostics.map(
      (diagnostic) =>
        `${diagnostic.source}: ${diagnostic.status}; elapsedMs=${diagnostic.elapsedMs}; evidenceCount=${diagnostic.evidenceCount}${diagnostic.blocker ? `; blocker=${diagnostic.blocker}` : ''}`,
    ),
    plannerProvider: plannerProvenance.provider,
    plannerModel: plannerProvenance.model,
    plannerConfigSource: plannerProvenance.configSource,
    taskLedger: latestPlan?.task_ledger,
    progressLedger: latestPlan?.progress_ledger,
  });
}

export async function assembleCoderContextPacket(
  input: PrepareActiveCoderPacketInput,
  deps: CoderPlanningDeps = {},
): Promise<{ contextPacket: CoderContextPacket; magOnePlanningContext: MagOnePlanningContext; repoRoot: string }> {
  const projectId = String(input.projectId || '').trim();
  const userInput = String(input.userInput || '').trim();
  if (!projectId) throw new Error('coder_context_project_id_required');
  if (!userInput) throw new Error('coder_context_user_input_required');

  const now = (deps.now ?? (() => new Date().toISOString()))();
  const clock = deps.clock ?? (() => Date.now());
  const repoRoot = path.resolve(
    input.repoPath || deps.repoRoot || resolveLocalCoderWorkspaceRoot(process.cwd()),
  );
  const readPlan = deps.readPlan ?? (async (root: string) => fs.readFile(path.join(root, 'PLAN.md'), 'utf8'));
  const planFlowState = toRecord(input.planFlowState);
  const selectedContext = toRecord(input.selectedContext);
  const emptyGraphContext = () => {
    const packet = createEmptyGraphContextPacket({ projectId, generatedAt: now });
    packet.provenance.debugNotes.push('graph_context_unavailable');
    return packet;
  };
  const [planSource, thinkSource, graphSource, skillSource] = await Promise.all([
    runPlanningSource({
      source: 'plan_md',
      critical: true,
      timeoutMs: deps.sourceTimeoutMs?.plan_md ?? PLANNING_SOURCE_TIMEOUT_MS.plan_md,
      clock,
      operation: () => readPlan(repoRoot),
      fallback: () => '',
      evidenceCount: (value) => (String(value).trim() ? 1 : 0),
    }),
    runPlanningSource({
      source: 'thinkgraph',
      critical: false,
      timeoutMs: deps.sourceTimeoutMs?.thinkgraph ?? PLANNING_SOURCE_TIMEOUT_MS.thinkgraph,
      clock,
      operation: () => (deps.readThinkGraph ?? readThinkGraphContextPacket)(projectId, 20),
      fallback: (blocker) => emptyThinkGraphPacket(projectId, blocker),
      evidenceCount: (value) => value.recent_events.length + value.planflow_nodes.length,
    }),
    runPlanningSource({
      source: 'graph_context',
      critical: true,
      timeoutMs: deps.sourceTimeoutMs?.graph_context ?? PLANNING_SOURCE_TIMEOUT_MS.graph_context,
      clock,
      operation: () =>
        (deps.buildGraphContext ?? buildGraphContextPacket)({
          projectId,
          repoPath: repoRoot,
          userMessage: userInput,
          selectedBoardNodeIds: Array.isArray(planFlowState.selectedNodeIds)
            ? planFlowState.selectedNodeIds.map(String)
            : [],
          selectedGraphNodeIds: Array.isArray(selectedContext.selectedGraphNodeIds)
            ? selectedContext.selectedGraphNodeIds.map(String)
            : [],
          planDraft: planFlowState,
          maxItems: 20,
        }),
      fallback: () => emptyGraphContext(),
      evidenceCount: (value) =>
        (value.codeGraphContext?.relevantFiles.length || 0) +
        value.knowGraphContext.entities.length +
        value.thinkGraphContext.reasoningNotes.length,
    }),
    runPlanningSource({
      source: 'skillgraph',
      critical: false,
      timeoutMs: deps.sourceTimeoutMs?.skillgraph ?? PLANNING_SOURCE_TIMEOUT_MS.skillgraph,
      clock,
      operation: () => (deps.readSkillContext ?? readSkillContextFromNeo4j)(userInput),
      fallback: (blocker) => emptySkillContext(blocker),
      evidenceCount: (value) => value.skills.length,
    }),
  ]);
  const plan = planSource.value;
  const thinkGraphContext = thinkSource.value;
  const graphContext = graphSource.value;
  const skillContext = skillSource.value;
  const sourceDiagnostics: ContextSourceDiagnostic[] = [
    planSource.diagnostic,
    thinkSource.diagnostic,
    skillSource.diagnostic,
    graphSource.diagnostic,
    ...graphContext.provenance.sourceDiagnostics,
    immediateDiagnostic('planflow_state', false, planFlowState),
    immediateDiagnostic('selected_context', false, selectedContext),
  ];
  const criticalFailure = sourceDiagnostics.find(
    (diagnostic) =>
      diagnostic.critical &&
      ['timed_out', 'failed'].includes(diagnostic.status),
  );
  if (criticalFailure) {
    throw new Error(
      `context_packet_critical_source_blocked: ${criticalFailure.source}: ${criticalFailure.blocker || criticalFailure.summary}`,
    );
  }
  if (planSource.diagnostic.status !== 'ok') {
    throw new Error(
      `context_packet_critical_source_blocked: plan_md: ${planSource.diagnostic.blocker || planSource.diagnostic.summary}`,
    );
  }
  const codeGraphContext = toRecord(graphContext.codeGraphContext);
  const cbmBlocker = String(codeGraphContext.blocker || '').trim();
  const codeAnchors = cleanList([
    ...(Array.isArray(codeGraphContext.codeAnchors) ? codeGraphContext.codeAnchors : []),
  ], 30);
  const cbmQueries = cleanList([
    ...(Array.isArray(codeGraphContext.cbmQueries) ? codeGraphContext.cbmQueries : []),
    ...extractSkillQueries(skillContext),
    ...selectedCodeAnchors(selectedContext).map((anchor) => `search_graph file_pattern="${anchor}"`),
    ...extractPlanCodeAnchors(plan).slice(0, 8).map((anchor) => `search_graph file_pattern="${anchor}"`),
  ], 20);
  const warnings = cleanList([
    ...thinkGraphContext.warnings,
    ...skillContext.warnings,
    ...graphContext.provenance.debugNotes,
    ...(cbmBlocker ? [cbmBlocker] : []),
    ...sourceDiagnostics
      .filter((diagnostic) => ['blocked', 'timed_out', 'failed'].includes(diagnostic.status))
      .map(
        (diagnostic) =>
          `context_source_${diagnostic.status}: ${diagnostic.source}: ${diagnostic.blocker || diagnostic.summary}`,
      ),
  ], 30);
  const knowGraphRelevant =
    graphContext.knowGraphContext.entities.length > 0 ||
    graphContext.knowGraphContext.evidence.length > 0 ||
    graphContext.knowGraphContext.relations.length > 0;
  const contextPacket = parseCoderContextPacket({
    userInput,
    planFlowState,
    planExcerpt: clamp(plan),
    thinkGraphContext,
    skillContext,
    codeGraphContext,
    cbmQueries,
    codeAnchors,
    sourceDiagnostics,
    ...(knowGraphRelevant ? { knowGraphContext: graphContext.knowGraphContext } : {}),
    selectedContext,
    provenance: {
      assembledAt: now,
      sources: cleanList([
        'user_input',
        'planflow_state',
        'PLAN.md',
        'ThinkGraph',
        'SkillGraph/Neo4j',
        'CodeGraph/Codebase Memory MCP',
        ...(knowGraphRelevant ? ['KnowGraph'] : []),
      ]),
      warnings,
    },
  });
  const magOnePlanningContext = {
    planFlowState,
    cbmInsight: codeGraphContext,
    skillGraphStatus: skillSource.diagnostic.status,
    approvalDecision: 'pending' as const,
    contextPacket,
    workflowOptions: [
      'plan_only',
      'draft_spec_for_approval',
      'run_read_only_coder_task',
      'report_blocker',
      'answer_general',
    ] as AvailableWorkflowOptions[],
  };
  return { contextPacket, magOnePlanningContext, repoRoot };
}

export async function prepareActiveCoderPacket(
  input: PrepareActiveCoderPacketInput,
  deps: CoderPlanningDeps = {},
): Promise<{
  contextPacket: CoderContextPacket;
  magOnePlanningContext: MagOnePlanningContext;
  packet: CoderPacket;
  plannerProvenance: PlannerProvenance;
}> {
  const now = (deps.now ?? (() => new Date().toISOString()))();
  const { contextPacket, magOnePlanningContext, repoRoot } = await assembleCoderContextPacket(input, {
    ...deps,
    now: () => now,
  });
  const generated = await (deps.generatePacket ?? generatePacketWithPlanner)(contextPacket);
  const packet = enforceTrustedPacketFields(generated.packet, input, repoRoot, contextPacket, now);
  await (deps.persistPacket ?? persistCreatedPacket)(
    packet,
    contextPacket,
    generated.provenance,
  );
  return { contextPacket, magOnePlanningContext, packet, plannerProvenance: generated.provenance };
}

export async function persistCoderRunOutcome(args: {
  packet: CoderPacket;
  report: CoderReport;
  comparison: {
    completedRequirements: string[];
    incompleteRequirements: string[];
    blockedRequirements: string[];
    changedRequirements: string[];
    outOfScopeFindings: string[];
    nextNarrowerFocus: string;
  };
}): Promise<void> {
  const { packet, report, comparison } = args;
  await recordThinkGraphEvent({
    projectId: packet.projectId,
    eventType: 'coder_report_recorded',
    title: `CoderReport ${report.status}: ${packet.objective}`,
    summary: clamp(report.summary, 1_500),
    status:
      report.status === 'succeeded'
        ? 'complete'
        : report.status === 'failed'
          ? 'failed'
          : 'blocked',
    task: packet.objective,
    runtimeRoute: 'PlanFlow Go -> POST /api/coder/localcoder/run -> CoderReport reconciliation',
    assumptions: report.assumptions,
    nextTask: comparison.nextNarrowerFocus,
    coderPacketId: packet.id,
    coderPacketObjective: packet.objective,
    coderReportStatus: report.status,
    completedRequirements: comparison.completedRequirements,
    incompleteRequirements: comparison.incompleteRequirements,
    blockedRequirements: comparison.blockedRequirements,
    changedRequirements: comparison.changedRequirements,
    outOfScopeFindings: comparison.outOfScopeFindings,
    proofSummary: report.proofResults.map(
      (proof) => `${proof.status}: ${proof.command}: ${clamp(proof.output, 240)}`,
    ),
    error: report.blockers.join('; '),
  });
}
