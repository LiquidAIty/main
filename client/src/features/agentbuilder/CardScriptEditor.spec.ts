// Graph + less = more: less code that does the same work as more code is more useful.
// Entity names the feature; Relationship explains why this file belongs and what it contributes.
// Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
// Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
// Entity: Card Scripts
// Relationship: Verifies the real single-file Python editor and source-owned activation contract.

import { describe, expect, it } from 'vitest';

import { editorOptions, scriptWithSource } from './CardScriptEditor';

describe('CardScriptEditor', () => {
  it('keeps the compact real Python editor controls', () => {
    const options = editorOptions();
    expect(options).toMatchObject({
      language: 'python',
      theme: 'liquidaity-sublime',
      automaticLayout: true,
      folding: true,
      smoothScrolling: true,
      matchBrackets: 'always',
      multiCursorModifier: 'alt',
      wordWrap: 'off',
    });
    expect(options.minimap).toMatchObject({
      enabled: true,
      size: 'fit',
      showSlider: 'mouseover',
      renderCharacters: false,
    });
  });

  it('derives activation only from real nonblank Python source', () => {
    const script = {
      enabled: false,
      source: '',
      version: 1,
      sourceHash: 'old-source',
      compiledHash: 'old-compiled',
      paletteFingerprint: 'old-palette',
      compiled: { mode: 'tool_recipe' as const },
      lastValidation: { status: 'valid' },
    };
    expect(scriptWithSource(script, 'print("ready")\n')).toMatchObject({
      enabled: true,
      source: 'print("ready")\n',
      sourceHash: '',
      compiledHash: '',
      paletteFingerprint: '',
      compiled: {},
      lastValidation: {},
    });
    expect(scriptWithSource(script, '   ').enabled).toBe(false);
  });
});
