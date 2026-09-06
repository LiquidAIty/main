import { describe, expect, it } from 'vitest';
import { buildHermesHostSessionProjection, type HermesTurnArgs } from './mainAdapter';

describe('Team configuration recovery', () => {
  it('authorizes the native Team doorway without projecting legacy Card overrides', () => {
    const args = {
      cardId: 'card-one', title: 'Research',
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'research' },
      prompt: 'Original instructions', provider: 'openai', modelKey: 'parent',
      providerModelId: 'parent', accessMode: 'chatgpt-account',
      tools: [], mcpConnectionIds: [], sessionKey: 'session-one', projectId: 'project-one',
      deckId: 'deck-one', conversationId: 'conversation-one', parentRunId: 'run-one',
      message: 'Inspect the repository', delegationRole: 'team',
      team: { mode: 'auto', maxWorkers: 999, retryLimit: 999,
        workerModel: { providerModelId: 'unrequested-worker' },
        leadModel: { providerModelId: 'unrequested-lead' } },
    } as HermesTurnArgs;
    const config = (buildHermesHostSessionProjection(args, {}, 'execution-one')
      .sessionMeta.hermes as any).sessionConfig;
    expect(config.delegationRoles).toEqual(['team']);
    expect(config.team).toBeUndefined();
    expect(config.systemPrompt).toBe(args.prompt);
    expect(config.executionContextId).toBe('execution-one');
    expect(JSON.stringify(config)).not.toMatch(/unrequested-worker|unrequested-lead|maxWorkers|retryLimit/);
  });
});
