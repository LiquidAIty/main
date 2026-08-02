export type DeckRunStatus = 'idle' | 'running' | 'success' | 'error' | 'skipped';

// AgentGraph assignment, instruction, and result identities transported
// verbatim from Python rails.
export type AgentAssignmentRunResult = {
  assignmentId: string;
  instructionId?: string;
  resultId?: string;
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
  agentAssignmentResult?: AgentAssignmentRunResult | null;
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
  };
};
