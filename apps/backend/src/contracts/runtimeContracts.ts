export type Idf = {
  systemPrompt: string;
  message: string;
  runtime: Record<string, unknown>;
  provider: Record<string, unknown>;
  runtimeOptions: Record<string, unknown>;
  enabledTools: string[];
  toolDefinitions: Array<Record<string, unknown>>;
  nativeTools: string[];
  skills: string[];
  toolsets: string[];
  mcpConnectionIds: string[];
  nativeReferences: Array<{
    authority: string;
    nativeId: string;
    reason: string;
    asOf: string;
    required: boolean;
  }>;
  images: Array<Record<string, unknown>>;
};
