/** Public projections of existing runtime authorities, never an execution log/store. */
export type RuntimeIdentity = {
  projectId: string;
  deckId: string;
  cardId: string;
  cardName: string;
  runId: string;
  parentRunId: string | null;
  nativeChildId: string | null;
  taskId?: string | null;
  agentId?: string | null;
  sessionId?: string | null;
};

export type RuntimeEvent = RuntimeIdentity & {
  id: string;
  kind: 'session' | 'mission' | 'model' | 'tool_call' | 'tool_result' | 'tool_error'
    | 'child_started' | 'child_finished' | 'task' | 'error' | 'permission'
    | 'skill' | 'autoskill' | 'artifact' | 'completion';
  sequence: number;
  timestamp: string | null;
  status?: string;
  text?: string;
  toolName?: string;
  toolUseId?: string;
  detail?: string;
  reference?: { id: string; path?: string; sha256?: string };
};

export type RuntimeConfiguration = {
  provider: string | null;
  model: string | null;
  profile: string | null;
  grantedTools: string[] | null;
  // null means the native adapter has not reported loading; not "no skills".
  loadedSkills: string[] | null;
};

export type RuntimeObservation = RuntimeIdentity & {
  events: RuntimeEvent[];
  activeAgentCount: number | null;
  observation: 'live' | 'unavailable' | 'finished';
  unavailableReason: string | null;
  transcript: { sessionId: string | null; unavailableReason: string | null };
  finalText: string;
  errorCode: string | null;
  errorSummary: string;
  configuration?: RuntimeConfiguration;
  nativeTasks?: Record<string, unknown>[];
};
