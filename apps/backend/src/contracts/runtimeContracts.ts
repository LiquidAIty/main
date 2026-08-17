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
