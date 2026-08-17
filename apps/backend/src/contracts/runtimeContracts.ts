export type DeckRunStatus = 'idle' | 'running' | 'success' | 'error' | 'skipped';

export type InputDataFile = {
  idfId: string;
  projectId: string;
  deckId: string;
  conversationId: string;
  runId: string;
  originatingCardId: string;
  version: number;
  purpose: 'conversation' | 'coding_job';
  approvalStatus: 'not_required' | 'draft' | 'approved' | 'superseded';
  approvedAt: string | null;
  approvedSha256: string | null;
  supersedesIdfId: string | null;
  jobContext: Record<string, unknown> | null;
  systemText: string;
  userText: string;
  cardContext: Record<string, unknown> | null;
  dynamicContextMarkdown: string;
  nativeReferences: Array<{
    authority: string;
    nativeId: string;
    reason: string;
    asOf: string;
    required: boolean;
  }>;
  modelInputMarkdown: string;
  contentMarkdown: string;
  contentSha256: string;
  createdAt: string;
};

export type ProviderInvocationInput = {
  systemPrompt: string;
  message: string;
  enabledTools: string[];
  enabledToolsets: string[];
  skills: string[];
  mcpToolAllowlist: string[];
  toolDefinitions: Array<Record<string, unknown>>;
  mcpConnectionIds: string[];
};

export type NativeRunResult = {
  runId: string;
  idfId: string;
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
  nativeRunResult?: NativeRunResult | null;
  accessMode?: string;
  idfVersion?: number;
  idfContentSha256?: string;
  transport?: {
    threadId: string | null;
    turnId: string | null;
    authMode: string | null;
    planType: string | null;
  };
};

export type PythonAutoGenPayloadShape = {
  session: Record<string, any>;
  idf: InputDataFile;
  cardRuntime: {
    cardId: string;
    title: string;
    runtimeType: string;
    prompt: string;
    runtimeOptions: Record<string, any>;
    participants: any[];
  };
};
