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
  agentAssignmentResult?: AgentAssignmentRunResult | null;
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
    participants: any[];
  };
};
