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
  loopMaxIterations?: number | null;
  loopExitText?: string | null;
};

export type AssistExecutionMode = 'single' | 'swarm';

export type AgentCardRuntimeOptions = {
  // 'local_openai_compatible' = a local SLM served over an OpenAI-compatible endpoint.
  provider?: 'openai' | 'openrouter' | 'local_openai_compatible' | null;
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
  role?: string | null;
  tools?: string[] | null;
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
  tools?: string[];
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
  workspaceRoot?: string | null;
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

export type KnowledgeGraphKind = 'thinkgraph' | 'knowgraph' | 'codegraph';

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
  createdByModel?: string | null;
  sourceRefs?: SemanticGraphSourceRef[];
  reasoningSummary?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type SemanticObjectProperty = {
  id?: string;
  from: string;
  to: string;
  type: string;
  confidence?: number | null;
  sourceRefId?: string | null;
};

export type SemanticDatatypeProperty = {
  key: string;
  value: unknown;
  valueType?: string | null;
  unit?: string | null;
};

export type SemanticAnnotationProperty = {
  key: string;
  value: unknown;
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
  owlClass?: string | string[] | null;
  owlIndividual?: string | null;
  objectProperties?: SemanticObjectProperty[];
  datatypeProperties?: SemanticDatatypeProperty[];
  annotationProperties?: SemanticAnnotationProperty[];
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
  proposedEntities?: SemanticGraphEntity[];
  proposedRelationships?: SemanticGraphRelationship[];
  proposedProperties?: Record<string, unknown>;
  proposedOwlClass?: string | string[] | null;
  proposedOwlIndividual?: string | null;
  proposedObjectProperties?: SemanticObjectProperty[];
  proposedDatatypeProperties?: SemanticDatatypeProperty[];
  proposedAnnotationProperties?: SemanticAnnotationProperty[];
  sourceRefs: SemanticGraphSourceRef[];
  provenance?: SemanticGraphProvenance | null;
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
  magenticTrace?: {
    plan?: Record<string, unknown> | unknown[] | null;
    blackboardEntries?: Record<string, unknown> | unknown[] | null;
    reportBacks?: Record<string, unknown> | unknown[] | null;
    transcript?: unknown[] | null;
    metrics?: Record<string, unknown> | null;
    thinkGraph?: Record<string, unknown> | unknown[] | null;
    knowGraph?: Record<string, unknown> | unknown[] | null;
    promptTrace?: {
      magenticCardPromptSource: string;
      participants: string[];
      participantPromptSources: string[];
      sidecarInstructionPresent: boolean;
      effectivePromptPreview: string;
    } | null;
  } | null;
};

export type DeckRuntimeEventKind =
  | 'run_started'
  | 'step_started'
  | 'step_completed'
  | 'step_skipped'
  | 'magentic_assignment'
  | 'magentic_trace'
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
  blackboardEntries?: Record<string, unknown> | unknown[] | null;
  reportBacks?: Record<string, unknown> | unknown[] | null;
  transcript?: unknown[] | null;
  metrics?: Record<string, unknown> | null;
  thinkGraph?: Record<string, unknown> | unknown[] | null;
  knowGraph?: Record<string, unknown> | unknown[] | null;
  promptTrace?: {
    magenticCardPromptSource: string;
    participants: string[];
    participantPromptSources: string[];
    sidecarInstructionPresent: boolean;
    effectivePromptPreview: string;
  } | null;
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
};

export type DeckRunResponse = {
  ok: boolean;
  deck?: DeckDocument;
  run?: DeckRun;
  meta?: Record<string, unknown> | null;
  error?: string;
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
