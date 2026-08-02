export type OpenClaudeMode = 'headless' | 'terminal';
export type OpenClaudeAccess = 'read' | 'patch' | 'test';
export type OpenClaudeState = 'idle' | 'running' | 'error';

export type OpenClaudeProvider = 'openai' | 'openrouter';

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

export type OpenClaudeTerminalLaunchResult = {
  ok: boolean;
  terminalAvailable: boolean;
  launchCommand: string | null;
  envOwner: 'backend';
  runtimeOwner: 'backend';
  envPath: string;
  rootPath: string;
  provider: OpenClaudeProvider | null;
  modelKey: string;
  providerModelId: string;
  error?: string;
};
