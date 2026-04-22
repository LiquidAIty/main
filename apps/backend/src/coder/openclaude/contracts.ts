export type OpenClaudeMode = 'headless' | 'terminal';
export type OpenClaudeAccess = 'read' | 'patch' | 'test';
export type OpenClaudeState = 'idle' | 'running' | 'error';

export type OpenClaudeProvider = 'openai' | 'openrouter';

export type OpenClaudeStatus = {
  installed: boolean;
  headlessAvailable: boolean;
  terminalAvailable: boolean;
  repoConnected: boolean;
  mode: OpenClaudeMode;
  access: OpenClaudeAccess;
  state: OpenClaudeState;
  modelKey: string;
  provider: OpenClaudeProvider;
  providerModelId: string;
};

export type OpenClaudeRunRequest = {
  task: string;
  mode?: OpenClaudeMode;
  access?: OpenClaudeAccess;
  systemPrompt?: string;
  modelKey?: string;
  provider?: OpenClaudeProvider;
  providerModelId?: string;
  temperature?: number;
  maxTokens?: number;
  terminalSteering?: boolean;
};

export type OpenClaudeRunResult = {
  ok: boolean;
  mode: OpenClaudeMode;
  access: OpenClaudeAccess;
  state: OpenClaudeState;
  output?: string;
  error?: string;
  provider: OpenClaudeProvider;
  model: string;
  responseId: string | null;
  terminal: {
    available: boolean;
    used: boolean;
    launchCommand: string | null;
  };
};

export type OpenClaudeProviderResult = {
  text: string;
  provider: OpenClaudeProvider;
  model: string;
  responseId: string | null;
  modelKey: string;
  providerModelId: string;
};
