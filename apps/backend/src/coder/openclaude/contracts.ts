export type OpenClaudeProvider = 'openai' | 'openrouter';

export type OpenClaudeProviderTargetInput = {
  modelKey?: string;
  provider?: OpenClaudeProvider;
  providerModelId?: string;
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
