export type DeckRunStatus = 'idle' | 'running' | 'success' | 'error' | 'skipped';

export type InputDataFile = {
  idfId: string;
  projectId: string;
  deckId: string;
  conversationId: string;
  runId: string;
  originatingCardId: string;
  version: number;
  systemText: string;
  userText: string;
  dynamicContextMarkdown: string;
  nativeReferences: Array<{ authority: string; nativeId: string; required: boolean }>;
  modelInputMarkdown: string;
  contentMarkdown: string;
  contentSha256: string;
  createdAt: string;
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
