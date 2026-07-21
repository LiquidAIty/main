import { describe, expect, it } from 'vitest';
import {
  CODER_DISPLAY_NAMES,
  containsCoderBranding,
  redactCoderBranding,
} from './coderConsoleNames';

describe('coder console display names', () => {
  it('exposes clean public names with no forbidden branding', () => {
    const values = Object.values(CODER_DISPLAY_NAMES).join(' ');
    // Product language: the coder runtime is "Coder Engine" ("Harness" names
    // the chat front door, not the coder).
    expect(values).toBe('Coder Coder Engine Coder Session');
    expect(containsCoderBranding(values)).toBe(false);
  });

});

describe('redactCoderBranding', () => {
  it('replaces underlying CLI branding with clean product names', () => {
    expect(redactCoderBranding('Welcome to OpenClaude')).toBe('Welcome to Coder Engine');
    expect(redactCoderBranding('LocalCoder ready')).toBe('Coder Engine ready');
    expect(redactCoderBranding('Claude Code v1')).toBe('Coder Engine v1');
    expect(redactCoderBranding('Ask Claude anything')).toBe('Ask Coder anything');
    const out = redactCoderBranding('OpenClaude / LocalCoder / Claude');
    expect(containsCoderBranding(out)).toBe(false);
  });

  it('leaves non-branded terminal output untouched', () => {
    expect(redactCoderBranding('compiled 3 files in 1.2s')).toBe('compiled 3 files in 1.2s');
  });
});
