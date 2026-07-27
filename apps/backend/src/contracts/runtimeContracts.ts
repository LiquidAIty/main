export type DeckRunStatus = 'idle' | 'running' | 'success' | 'error' | 'skipped';
export type CoderTaskStatus = 'started' | 'queued' | 'running' | 'completed' | 'failed' | 'blocked';
export type CoderTaskDeliveryStatus = 'accepted' | 'queued' | 'blocked';

// AgentGraph assignment identity and registered artifact locators, transported
// verbatim from Python rails.
export type AgentAssignmentRunResult = {
  assignmentId: string;
  instructionId?: string;
  resultId?: string;
  artifactLocators: string[];
};

export type CardRunResult = {
  output: string | null;
  status: DeckRunStatus;
  error?: string;
  startedAt: string;
  endedAt: string;
  runtimeBinding?: string | null;
  runtimeType?: string | null;
  seed?: string;
  inputSummary?: string;
  outputSummary?: string;
  magenticTrace?: Record<string, unknown> | null;
  agentAssignmentResult?: AgentAssignmentRunResult | null;
};

export type RuntimeScope = {
  projectId: string;
  deckId: string;
  magenticCardId: string;
  visibleNodeIds: string[];
  visibleEdgeIds: string[];
  resolvedMagenticOptionIds: string[];
  pythonWorkerIds: string[];
  calledAgentIds: string[];
  excludedAgentIds: Array<{ id: string; reason: string }>;
};

export type RuntimeGraphNode = {
  cardId: string;
  title: string;
  kind: string;
  runtimeType: string;
  parentGraphId: string | null;
  prompt: string;
  role: string | null;
  tools: string[];
  fanOut: Record<string, any> | null;
  isSocietyOfMind: boolean;
  provider: string | null;
  providerModelId: string | null;
  temperature: number | null;
  maxTokens: number | null;
};

export type RuntimeGraphEdge = {
  id: string;
  source: string;
  target: string;
  edgeType: 'flow' | 'magentic_option' | 'magentic_control';
  loop: Record<string, any> | null;
  data: Record<string, any>;
};

export type RuntimeGraph = {
  nodes: RuntimeGraphNode[];
  edges: RuntimeGraphEdge[];
};

export type PythonAutoGenPayloadShape = {
  session: Record<string, any>;
  userText: string;
  priorAssistantText: string;
  systemPrompt: string;
  plan?: Record<string, any>;
  thinkGraph?: Record<string, any>;
  knowGraph?: Record<string, any>;
  blackboard?: Record<string, any>;
  workspaceObjectContext?: Record<string, any>;
  // Stable identities only. Python creates/claims the assignment and hydrates
  // the exact relational instruction.
  agentAssignment?: { instructionId: string; senderCardId: string; receiverCardId: string };
  cardRuntime: {
    cardId: string;
    title: string;
    runtimeType: string;
    prompt: string;
    runtimeOptions: Record<string, any>;
    graph: RuntimeGraph;
    participants: any[];
    privateParticipants?: any[];
    runtimeScope?: RuntimeScope;
  };
};
