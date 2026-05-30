export type PromptTemplate = {
  id: string;
  content: string;
};

export type RuntimeBinding =
  | 'assist'
  | 'local_coder'
  | 'main_chat'
  | 'kg_ingest'
  | 'research_agent'
  | 'thinkgraph_agent'
  | 'codegraph_agent'
  | 'knowgraph_agent'
  | 'knowgraph'
  | 'neo4j'
  | 'plan_agent'
  | 'worldsignals_agent'
  | 'telescope_agent'
  | 'energy_agent'
  | 'trading_agent'
  | 'image_agent'
  | 'code_agent'
  | 'video_agent'
  | 'data_formulator_agent';

export type AgentCardRuntimeType =
  | 'assistant_agent'
  | 'magentic_one'
  | 'graph_flow'
  | 'local_coder';

export type DeckEdgeType = 'magentic_option' | 'flow';

export type DeckEdgeRole =
  | 'graph_execution'
  | 'callable_route'
  | 'reconcile_input'
  | 'compatibility_legacy';

export type DeckEdgeExecutionMode = 'required' | 'optional' | 'conditional';

export type DeckEdgeMergeIntent =
  | 'all_inputs'
  | 'any_input'
  | 'first_success'
  | 'summarize_all'
  | 'select_best'
  | 'manual_review';

export type DeckEdgeMetadata = {
  role?: DeckEdgeRole | null;
  executionMode?: DeckEdgeExecutionMode | null;
  conditionType?: string | null;
  conditionExpression?: string | null;
  conditionLabel?: string | null;
  priority?: number | null;
  order?: number | null;
  weight?: number | null;
  mergeIntent?: DeckEdgeMergeIntent | null;
  legacyCompatibility?: boolean | null;
};

export type AssistExecutionMode = 'single' | 'swarm';

export type AgentCardRuntimeOptions = {
  provider?: 'openai' | 'openrouter' | null;
  executionBackend?: 'python_autogen' | null;
  modelKey?: string | null;
  temperature?: number | null;
  maxTokens?: number | null;
  streaming?: boolean | null;
  emitTeamEvents?: boolean | null;
  executionMode?: AssistExecutionMode | null;
  swarmMaxWorkers?: number | null;
  swarmWorkerPromptTemplate?: string | null;
  useSocietyOfMindConsolidation?: boolean | null;
  maxTurns?: number | null;
  maxStalls?: number | null;
  finalAnswerPrompt?: string | null;
  selectorPrompt?: string | null;
  allowRepeatedSpeaker?: boolean | null;
  localCoderMode?: 'headless' | 'terminal' | null;
  localCoderAccess?: 'read' | 'patch' | 'test' | null;
};

export type DeckNodeKind = 'agent';

export type AgentTemplate = {
  id: string;
  name: string;
  promptTemplate?: string | null;
  model?: string | null;
  provider?: string | null;
  temperature?: number | null;
  maxTokens?: number | null;
  tools: string[];
  skills?: string[];
  personas?: string[];
  knowledgeSources?: string[];
  ioSchema?: Record<string, unknown>;
};

export type CloneConfig = {
  enabled: boolean;
  seeds?: string[];
};

export type AgentCardInstance = {
  id: string;
  kind?: DeckNodeKind;
  templateId: string;
  prompt?: string | null;
  runtimeBinding?: RuntimeBinding | null;
  runtimeType?: AgentCardRuntimeType | null;
  runtimeOptions?: AgentCardRuntimeOptions | null;
  parentGraphId?: string | null;
  title: string;
  subtitle?: string;
  position: { x: number; y: number };
  overrides?: Partial<AgentTemplate>;
  status?: 'idle' | 'ready' | 'running' | 'error';
  cloneConfig?: CloneConfig;
};

export type DeckEdge = {
  id: string;
  source: string;
  sourceHandle?: string | null;
  target: string;
  targetHandle?: string | null;
  edgeType?: DeckEdgeType | null;
  metadata?: DeckEdgeMetadata | null;
};

export type DeckViewport = {
  x: number;
  y: number;
  zoom: number;
};

export type DeckDocument = {
  id: string;
  name: string;
  promptTemplates: PromptTemplate[];
  nodes: AgentCardInstance[];
  edges: DeckEdge[];
  // Deprecated: Agent Canvas intentionally ignores persisted viewport.
  viewport?: DeckViewport | null;
  version: number;
};

export type DeckRunStatus = 'idle' | 'running' | 'success' | 'error' | 'skipped';

export type TaskContract = {
  id: string;
  task: string;
  purpose: string;
  constraints: string[];
  requiredOutput: {
    format: 'text' | 'json';
    schema?: Record<string, unknown>;
  };
  scoring: {
    passThreshold: number;
    hardChecks: string[];
    rubric: Array<{
      name: string;
      maxScore: number;
    }>;
  };
  context?: {
    userInput?: string;
    priorOutput?: string;
  };
};

export type AgentHandshake = {
  accepted: boolean;
  restatedTask: string;
  confirmedFormat: TaskContract['requiredOutput']['format'];
  notes: string[];
};

export type CardRunScoreDetail = {
  hardChecks: Array<{
    name: string;
    passed: boolean;
  }>;
  rubric: Array<{
    name: string;
    score: number;
    maxScore: number;
  }>;
  total: number;
  maxScore: number;
};

export type CodeGraphViewContract = {
  projectId?: string | null;
  focusPaths?: string[];
  focusSymbols?: string[];
  nodeLabelAllowlist?: string[];
  edgeTypeAllowlist?: string[];
  showLabels?: boolean;
  maxNodes?: number;
};

export type KnowledgeGraphKind = 'thinkgraph' | 'knowgraph' | 'codegraph';

export type GraphViewContract = {
  graphKind: KnowledgeGraphKind;
  projectId?: string | null;
  focusNodeIds?: string[];
  focusPaths?: string[];
  focusSymbols?: string[];
  nodeLabelAllowlist?: string[];
  edgeTypeAllowlist?: string[];
  showLabels?: boolean;
  maxNodes?: number;
  cameraMode?: 'overview' | 'focus' | 'trace' | 'cluster';
  animationMode?: 'calm' | 'guided' | 'active';
  narrativeIntent?: string | null;
};

export type SemanticGraphName = 'think' | 'know' | 'code';

export type SemanticGraphRecordKind =
  | 'entity'
  | 'relationship'
  | 'claim'
  | 'evidence'
  | 'source'
  | 'decision'
  | 'summary'
  | 'action'
  | 'question'
  | 'hypothesis'
  | 'contradiction'
  | 'mission'
  | 'agent_run'
  | 'file'
  | 'component'
  | 'symbol'
  | 'concept'
  | 'event'
  | 'observation';

export type SemanticGraphWriter =
  | 'thinkgraph-agent'
  | 'knowgraph-agent'
  | 'codegraph-agent'
  | 'system';

export type SemanticGraphWriteMode = 'agent-owned' | 'system-owned' | 'read-only';

export type SemanticGraphSourceRefType =
  | 'chat'
  | 'url'
  | 'file'
  | 'code'
  | 'mission'
  | 'agent_run'
  | 'graph_record'
  | 'user_input'
  | 'tool_result'
  | 'model_output';

export type SemanticGraphEntity = {
  id: string;
  label: string;
  type: string;
  aliases?: string[];
  properties?: Record<string, unknown>;
  confidence?: number | null;
};

export type SemanticGraphRelationship = {
  id: string;
  from: string;
  to: string;
  type: string;
  label?: string | null;
  properties?: Record<string, unknown>;
  confidence?: number | null;
};

export type SemanticGraphSourceRef = {
  id?: string;
  type: SemanticGraphSourceRefType;
  ref: string;
  title?: string | null;
  summary?: string | null;
  excerpt?: string | null;
  retrievedAt?: string | null;
  confidence?: number | null;
};

export type SemanticGraphProvenance = {
  createdByAgent?: string | null;
  missionSpecId?: string | null;
  missionRunId?: string | null;
  missionAgentRunId?: string | null;
  sourceRefs?: SemanticGraphSourceRef[];
  reasoningSummary?: string | null;
  createdAt?: string | null;
};

export type SemanticGraphRecord = {
  id: string;
  graph: SemanticGraphName;
  kind: SemanticGraphRecordKind;
  label: string;
  summary: string;
  entities: SemanticGraphEntity[];
  relationships: SemanticGraphRelationship[];
  properties?: Record<string, unknown>;
  sourceRefs: SemanticGraphSourceRef[];
  confidence?: number | null;
  vectorText?: string | null;
  provenance?: SemanticGraphProvenance | null;
  writer: SemanticGraphWriter;
  writeMode: SemanticGraphWriteMode;
  createdAt: string;
  updatedAt: string;
  '@context'?: string | string[] | Record<string, unknown>;
  '@id'?: string;
  '@type'?: string | string[];
};

export type GraphUpdateRequestStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'applied';

export type GraphUpdateRequester =
  | 'sol'
  | 'magentic-one'
  | 'workspace-harness'
  | 'chat-plan-companion'
  | 'system';

export type GraphUpdateRequest = {
  id: string;
  targetGraph: SemanticGraphName;
  requestedBy: GraphUpdateRequester;
  reason: string;
  proposedRecords: SemanticGraphRecord[];
  sourceRefs: SemanticGraphSourceRef[];
  confidence?: number | null;
  status: GraphUpdateRequestStatus;
  createdAt: string;
};

export type GraphSearchRequest = {
  graph: SemanticGraphName;
  query: string;
  kinds?: SemanticGraphRecordKind[];
  relationshipTypes?: string[];
  nodeId?: string;
  startNodeId?: string;
  depth?: number;
  limit?: number;
  includeSourceRefs?: boolean;
  includeProvenance?: boolean;
  confidenceMin?: number;
};

export type GraphTraverseRequest = {
  graph: SemanticGraphName;
  startNodeId: string;
  query?: string;
  kinds?: SemanticGraphRecordKind[];
  relationshipTypes?: string[];
  depth?: number;
  limit?: number;
  includeSourceRefs?: boolean;
  includeProvenance?: boolean;
  confidenceMin?: number;
};

export type GraphNeighborhoodRequest = {
  graph: SemanticGraphName;
  startNodeId: string;
  query?: string;
  kinds?: SemanticGraphRecordKind[];
  relationshipTypes?: string[];
  depth?: number;
  limit?: number;
  includeSourceRefs?: boolean;
  includeProvenance?: boolean;
  confidenceMin?: number;
};

export type GraphReadResult = {
  records: SemanticGraphRecord[];
  relationships: SemanticGraphRelationship[];
  sourceRefs: SemanticGraphSourceRef[];
  warnings: string[];
  status: 'ok' | 'unavailable' | 'error';
};

export type CardRunResult = {
  output: string | null;
  status: DeckRunStatus;
  error?: string;
  startedAt: string;
  endedAt: string;
  runtimeBinding?: RuntimeBinding | null;
  runtimeType?: AgentCardRuntimeType | null;
  seed?: string;
  contract?: TaskContract;
  handshake?: AgentHandshake;
  score?: number;
  passed?: boolean;
  scoreDetail?: CardRunScoreDetail;
  improvementPromptBit?: string;
  inputSummary?: string;
  outputSummary?: string;
  graphViewContract?: GraphViewContract | null;
  // Temporary legacy alias while clients migrate to graphViewContract.
  codegraphViewContract?: CodeGraphViewContract | null;
  structuredPlan?: Record<string, unknown> | null;
};

export type DeckRuntimeEventKind =
  | 'run_started'
  | 'step_started'
  | 'step_completed'
  | 'step_skipped'
  | 'magentic_assignment'
  | 'swarm_progress'
  | 'message'
  | 'run_completed';

export type DeckRuntimeMessageRole = 'assistant' | 'tool' | 'user';

export type DeckRuntimeEvent = {
  id: string;
  at: string;
  kind: DeckRuntimeEventKind;
  type?: 'message' | null;
  cardId?: string | null;
  cardTitle?: string | null;
  runtimeType?: AgentCardRuntimeType | null;
  edgeIds?: string[];
  text?: string | null;
  role?: DeckRuntimeMessageRole | null;
  content?: string | null;
  progressText?: string | null;
  notes?: string[];
  status?: DeckRunStatus | null;
  outputSummary?: string | null;
  completedWorkers?: number | null;
  totalWorkers?: number | null;
  graphViewContract?: GraphViewContract | null;
  // Temporary legacy alias while clients migrate to graphViewContract.
  codegraphViewContract?: CodeGraphViewContract | null;
};

export type DeckRunStep = {
  id: string;
  executionId: string;
  cardId: string;
  templateId: string;
  title: string;
  input: string;
  runtimeBinding?: RuntimeBinding | null;
  runtimeType?: AgentCardRuntimeType | null;
  effectiveAgent: AgentTemplate;
  output: string | null;
  status: DeckRunStatus;
  error?: string;
  startedAt: string;
  endedAt: string;
  seed?: string;
  contract?: TaskContract;
  handshake?: AgentHandshake;
  score?: number;
  passed?: boolean;
  scoreDetail?: CardRunScoreDetail;
  improvementPromptBit?: string;
  inputSummary?: string;
  outputSummary?: string;
  graphViewContract?: GraphViewContract | null;
  // Temporary legacy alias while clients migrate to graphViewContract.
  codegraphViewContract?: CodeGraphViewContract | null;
  structuredPlan?: Record<string, unknown> | null;
  routeInfo?: {
    mergeIntent?: DeckEdgeMergeIntent | 'legacy_default' | null;
    inputMode?: 'legacy_text' | 'single_upstream' | 'structured_merge' | null;
    notes?: string[];
    inputSources?: Array<{
      edgeId: string;
      sourceCardId: string;
      sourceTitle: string;
      executionMode?: DeckEdgeExecutionMode | 'legacy_default' | null;
      output?: string | null;
    }>;
  } | null;
};

export type DeckWorkspaceObjectEditorContext = {
  open: boolean;
  activeTab?: string | null;
  selectedCardId?: string | null;
  selectedCardTitle?: string | null;
  selectedCardRuntimeType?: AgentCardRuntimeType | null;
  editable: boolean;
  runnable: boolean;
};

export type DeckWorkspaceContext = {
  workspaceView: string;
  largeSurface: string;
  activeTab?: string | null;
  objectEditor: DeckWorkspaceObjectEditorContext;
};

export type WorkspaceObjectContext = {
  activeSurface?: string | null;
  workspaceView?: string | null;
  selectedObjectId?: string | null;
  selectedObjectType?: string | null;
  selectedObjectTitle?: string | null;
  selectedText?: string | null;
  openObjectSummary?: string | null;
  activeMagenticParticipants?: string[];
  availableCanvasAgents?: string[];
  excludedAgents?: string[];
};

export type MissionSpecRunState =
  | 'draft'
  | 'approved'
  | 'wiring'
  | 'running'
  | 'complete'
  | 'failed'
  | 'cancelled'
  | 'needs_user_input';

export type MissionAgentRunStatus =
  | 'queued'
  | 'running'
  | 'complete'
  | 'failed'
  | 'skipped'
  | 'needs_user_input';

export type MissionRunStatus =
  | 'approved'
  | 'wiring'
  | 'running'
  | 'complete'
  | 'failed'
  | 'cancelled'
  | 'needs_user_input';

export type MissionSpec = {
  id: string;
  title: string;
  userGoal: string;
  target: string;
  readContext: string[];
  agentRuns: Array<{
    id?: string;
    agentId: string;
    promptSeed: string;
    required?: boolean;
  }>;
  runState: MissionSpecRunState;
};

export type MissionRun = {
  id: string;
  missionSpecId: string;
  status: MissionRunStatus;
  activeAgentRunId: string | null;
  agentRuns: Array<{
    id: string;
    agentId: string;
    status: MissionAgentRunStatus;
    required: boolean;
    promptSeed: string;
    resultSummary?: string | null;
    error?: string | null;
  }>;
  results: Array<{
    agentRunId: string;
    agentId: string;
    status: MissionAgentRunStatus;
    output?: string | null;
    reason?: string | null;
  }>;
  createdAt: string;
  updatedAt: string;
};

export type MissionDeckPatch = {
  missionSpecId: string;
  nodesToCreate: AgentCardInstance[];
  nodesToUpdate: Array<Pick<AgentCardInstance, 'id'> & Partial<AgentCardInstance>>;
  edgesToCreate: DeckEdge[];
  edgesToUpdate: Array<Pick<DeckEdge, 'id'> & Partial<DeckEdge>>;
  promptFieldsToUpdate: Array<{
    nodeId: string;
    prompt: string;
  }>;
  runState: MissionSpecRunState;
};

export type WorkspaceHarnessProvider =
  | 'internal-workspace'
  | 'openclaude'
  | 'claude-code'
  | 'codex'
  | 'local';

export type WorkspaceHarnessOperation =
  | 'inspect_context'
  | 'draft_mission'
  | 'refine_mission'
  | 'generate_deck_patch'
  | 'apply_deck_patch'
  | 'connect_agents'
  | 'seed_prompts'
  | 'run_approved_mission'
  | 'query_graph'
  | 'traverse_graph'
  | 'ask_clarifying_questions'
  | 'request_graph_update';

export type WorkspaceHarnessPermission =
  | 'deck.read'
  | 'deck.write'
  | 'canvas.read'
  | 'canvas.write'
  | 'plan.read'
  | 'plan.write'
  | 'mission.read'
  | 'mission.write'
  | 'agent.read'
  | 'agent.connect'
  | 'agent.prompt.read'
  | 'agent.prompt.write'
  | 'reactflow.nodes.create'
  | 'reactflow.nodes.update'
  | 'reactflow.edges.create'
  | 'reactflow.edges.update'
  | 'graph.query'
  | 'graph.traverse'
  | 'graph.write.request';

export type OpenMissionMessage = {
  missionRunId: string;
  title: string;
  status: MissionRunStatus;
  activeAgents: Array<{
    agentRunId: string;
    label: string;
    status: MissionAgentRunStatus;
    summary?: string;
  }>;
  latestSummary?: string;
  suggestedUserActions?: string[];
};

export type WorkspaceHarnessRequest = {
  provider: WorkspaceHarnessProvider;
  operation: WorkspaceHarnessOperation;
  userGoal: string;
  activeCanvasId?: string | null;
  selectedObject?: CanvasObjectContext | WorkspaceObjectContext | null;
  missionSpec?: MissionSpec | null;
  missionRun?: MissionRun | null;
  currentDeckSummary?: {
    id: string;
    name: string;
    nodeCount: number;
    edgeCount: number;
  } | null;
  availableAgents?: Array<{ id: string; label: string }>;
  graphContextRefs?: string[];
  priorResults?: Array<{ agentId: string; summary?: string | null }>;
  permissions: WorkspaceHarnessPermission[];
};

export type WorkspaceHarnessResult = {
  status: 'complete' | 'needs_user_input' | 'failed';
  summary: string;
  questions?: string[];
  missionSpecPatch?: Partial<MissionSpec> | null;
  missionDeckPatch?: MissionDeckPatch | null;
  missionRunUpdate?: Partial<MissionRun> | null;
  agentRunUpdates?: Array<{
    id: string;
    status: MissionAgentRunStatus;
    resultSummary?: string | null;
    error?: string | null;
  }>;
  openMissionMessage?: OpenMissionMessage | null;
  graphUpdateRequests?: GraphUpdateRequest[];
  suggestedNextAction?: WorkspaceHarnessOperation | null;
  errorReason?: string | null;
};

export type PlanDraftStatus =
  | 'idle'
  | 'drafting'
  | 'ready'
  | 'needs_user_input'
  | 'failed';

export type ChatPlanDraftRequest = {
  userMessage: string;
  activeCanvasId?: string;
  selectedObject?: CanvasObjectContext;
  currentMissionSpec?: MissionSpec;
  currentDeckSummary?: unknown;
  availableAgents?: Array<{
    id: string;
    label: string;
    type?: string;
    capabilities?: string[];
  }>;
  graphContextRefs?: string[];
  priorMissionResults?: unknown[];
};

export type ChatPlanDraftResult = {
  status: PlanDraftStatus;
  summary: string;
  missionSpec?: MissionSpec;
  missionSpecPatch?: Partial<MissionSpec>;
  questions?: string[];
  suggestedNextAction?: string;
  errorReason?: string;
};

export type DualChatTurnResult = {
  chatReply: string;
  planDraft?: ChatPlanDraftResult;
};

export type DeckRunMissionMetadata = {
  missionRunId?: string | null;
  missionAgentRunId?: string | null;
  missionStatus?: MissionRunStatus | null;
  agentRunStatus?: MissionAgentRunStatus | null;
  resultSummary?: string | null;
  needsUserInputReason?: string | null;
  errorReason?: string | null;
};

export type CanvasObjectContext = {
  id: string;
  canvasId: string;
  type: string;
  title: string;
  props: Record<string, unknown>;
  editableTargets: string[];
  graphRefs: string[];
};

export type DeckRun = {
  id: string;
  deckId: string;
  startedAt: string;
  endedAt?: string;
  status: DeckRunStatus;
  input: string;
  error?: string;
  workspaceContext?: DeckWorkspaceContext | null;
  workspaceObjectContext?: WorkspaceObjectContext | null;
  steps: DeckRunStep[];
  graphViewContract?: GraphViewContract | null;
  // Temporary legacy alias while clients migrate to graphViewContract.
  codegraphViewContract?: CodeGraphViewContract | null;
  validationSummary: {
    ok: boolean;
    errors: string[];
    warnings: string[];
  };
  events?: DeckRuntimeEvent[];
  executionPlanSummary: {
    startCardIds: string[];
    simpleOrderCardIds: string[];
    expandedStepIds: string[];
  };
  mission?: DeckRunMissionMetadata | null;
};

export type DeckRunRequest = {
  deckId?: string;
  document?: DeckDocument;
  templates?: AgentTemplate[];
  promptTemplates?: PromptTemplate[];
  input?: string;
  stream?: boolean;
  workspaceContext?: DeckWorkspaceContext | null;
  workspaceObjectContext?: WorkspaceObjectContext | null;
  missionSpec?: MissionSpec;
  missionRunId?: string;
  missionAgentRunId?: string;
};

export type DeckRunResponse = {
  ok: boolean;
  deck?: DeckDocument;
  run?: DeckRun;
  meta?: Record<string, unknown> | null;
  error?: string;
  missionRunId?: string | null;
  missionAgentRunId?: string | null;
  missionStatus?: MissionRunStatus | null;
  agentRunStatus?: MissionAgentRunStatus | null;
  resultSummary?: string | null;
  needsUserInputReason?: string | null;
  errorReason?: string | null;
};

export type V3RevisionMeta = {
  revision: string;
  savedAt: string | null;
};

export type V3ProjectBlobMeta = {
  decks: Record<string, V3RevisionMeta>;
};

export type V3ProjectBlob = {
  decks: Record<string, DeckDocument>;
  deckRuns: Record<string, DeckRun[]>;
  hiddenTelemetry: Record<string, unknown>;
  meta: V3ProjectBlobMeta;
};

export type {
  ProjectKnowledgeSeed,
  SeedEntity,
  SeedEntityKind,
  SeedPattern,
  SeedProvenance,
  SeedRelationship,
  SeedSourceKind,
  SeedStatus,
  SeedTruth,
  SeedTruthScope,
} from './knowledgeSeed';
