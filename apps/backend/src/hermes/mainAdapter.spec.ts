import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  deriveHermesSessionKey,
  providerForHermes,
  resolveHermesCardRuntimeHome,
} from './mainAdapter';

describe('Hermes ACP transport identity', () => {
  it('keeps each prepared profile in a stable isolated runtime home', () => {
    const root = 'C:\\Projects\\LiquidAIty\\main\\Hermes';
    expect(resolveHermesCardRuntimeHome(root, 'card_main_chat')).toBe(
      path.join(root, '.hermes', 'profiles', 'card_main_chat'),
    );
    expect(() => resolveHermesCardRuntimeHome(root, '../escape')).toThrow('hermes_profile_invalid');
  });

  it('mechanically maps prepared ChatGPT-account OpenAI transport to Codex ACP', () => {
    expect(providerForHermes('openai', 'chatgpt-account')).toBe('openai-codex');
    expect(providerForHermes('openrouter', 'openrouter-api')).toBe('openrouter');
  });

  it('derives one transport session key from resolved identities', () => {
    expect(deriveHermesSessionKey('project-1', 'conversation-1', 'card_main_chat')).toBe(
      'hermes:project-1:conversation-1:card_main_chat',
    );
  });
});
