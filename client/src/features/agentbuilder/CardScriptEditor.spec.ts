import { describe, expect, it } from 'vitest';

import {
  SCRIPT_EXAMPLES,
  SCRIPT_SECTIONS,
  STARTER_SCRIPT,
  TOOL_MODE_COMPLETIONS,
  changedSourceDraft,
  symbolAtPosition,
} from './cardScriptLanguage';
import { editorOptions } from './cardScriptMonaco';

describe('CardScriptEditor Monaco contract', () => {
  it('keeps the executable starter limited to the three model-tool recipe sections', () => {
    for (const section of SCRIPT_SECTIONS) {
      expect(STARTER_SCRIPT).toContain(`# region ${section}`);
    }
    expect(STARTER_SCRIPT.match(/# region /g)).toHaveLength(3);
    expect(STARTER_SCRIPT.match(/# endregion/g)).toHaveLength(3);
    expect(STARTER_SCRIPT).toContain('"mode": "tool_recipe"');
    expect(STARTER_SCRIPT).toContain('output.emit({');
    expect(STARTER_SCRIPT).not.toContain('card.subagents');
    expect(STARTER_SCRIPT).not.toContain('delegate_task');
  });

  it('offers disabled-by-default examples using only canonical graph operations', () => {
    expect(SCRIPT_EXAMPLES.map((example) => example.id)).toEqual([
      'thinkgraph-context', 'knowgraph-evidence',
    ]);
    const examples = SCRIPT_EXAMPLES.map((example) => example.source).join('\n');
    expect(examples).toContain('engraphis_recall_context');
    expect(examples).toContain('engraphis_get_memory');
    expect(examples).toContain('graphiti.search_nodes');
    expect(examples).toContain('graphiti.search_memory_facts');
    expect(examples).toContain('graphiti.get_episodes');
    expect(examples).not.toContain('think.context');
    expect(examples).not.toContain('know.context');
  });

  it('uses the compact code-first Monaco feature set', () => {
    const options = editorOptions();
    expect(options.theme).toBe('card-script-sublime');
    expect(options.minimap).toMatchObject({
      enabled: true,
      size: 'fit',
      showSlider: 'mouseover',
      renderCharacters: false,
    });
    expect(options).toMatchObject({
      automaticLayout: true,
      folding: true,
      smoothScrolling: true,
      matchBrackets: 'always',
      multiCursorModifier: 'alt',
      wordWrap: 'off',
    });
    expect(options.guides).toMatchObject({
      indentation: true,
      highlightActiveIndentation: true,
    });
  });

  it('documents the exact Python-owned tool modes for completion and hover', () => {
    expect(TOOL_MODE_COMPLETIONS.map(({ label, value }) => ({ label, value }))).toEqual([
      { label: 'OFF', value: 0 },
      { label: 'SCRIPT', value: 1 },
      { label: 'AGENT', value: 2 },
      { label: 'BOTH', value: 3 },
    ]);
    expect(TOOL_MODE_COMPLETIONS.every((mode) => mode.documentation.length > 40)).toBe(true);
    for (const mode of TOOL_MODE_COMPLETIONS) {
      expect(symbolAtPosition({
        getLineContent: () => mode.label,
        getWordAtPosition: () => ({ word: mode.label }),
      } as never, { lineNumber: 1, column: 2 })).toBe(mode.label);
    }
  });

  it('invalidates compiled identity without inventing a second enable state', () => {
    const source = changedSourceDraft({
      source: 'old',
      version: 3,
      author: {},
      sourceHash: 'source-hash',
      compiledHash: 'compiled-hash',
      paletteFingerprint: 'palette',
      compiled: {
        schemaVersion: 'liquidaity.card-script.compiled.v1',
        mode: 'tool_recipe',
      },
      lastValidation: { status: 'valid', errors: [], toolHandles: [] },
    }, 'new');

    expect(source).toMatchObject({
      source: 'new',
      sourceHash: '',
      compiledHash: '',
      compiled: {},
      lastValidation: { status: 'invalid' },
    });
    expect(source).not.toHaveProperty('enabled');
    expect(source).not.toHaveProperty('hermesSupport');
    expect(source).not.toHaveProperty('rollback');
  });
});
