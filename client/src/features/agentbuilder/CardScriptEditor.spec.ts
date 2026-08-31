import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  editorOptions,
  SCRIPT_EXAMPLES,
  SCRIPT_SECTIONS,
  STARTER_SCRIPT,
  TOOL_MODE_COMPLETIONS,
  symbolAtPosition,
} from './CardScriptEditor';

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
    expect(examples).toContain('constellation.context');
    expect(examples).toContain('constellation.inspect');
    expect(examples).toContain('graphiti.search_nodes');
    expect(examples).toContain('graphiti.search_memory_facts');
    expect(examples).toContain('graphiti.get_episodes');
    expect(examples).not.toContain('think.context');
    expect(examples).not.toContain('know.context');
  });

  it('uses the compact code-first Monaco feature set', () => {
    const options = editorOptions();
    expect(options.theme).toBe('liquidaity-sublime');
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

  it('lazy-loads one pinned Monaco engine and owns bounded model disposal', () => {
    const source = readFileSync(
      path.resolve(process.cwd(), 'client/src/features/agentbuilder/CardScriptEditor.tsx'),
      'utf8',
    );
    const clientPackage = JSON.parse(readFileSync(
      path.resolve(process.cwd(), 'client/package.json'),
      'utf8',
    )) as { dependencies: Record<string, string> };
    const builderPage = readFileSync(
      path.resolve(process.cwd(), 'client/src/pages/agentbuilder.tsx'),
      'utf8',
    );
    const managerSource = readFileSync(
      path.resolve(process.cwd(), 'client/src/components/AgentManager.tsx'),
      'utf8',
    );

    expect(clientPackage.dependencies['monaco-editor']).toBe('0.52.2');
    expect(source).not.toMatch(/^import .*monaco-editor/m);
    expect(source).toContain("import('monaco-editor/esm/vs/editor/editor.api')");
    expect(source).toContain('loadMonacoFeatures');
    expect(source).toContain('findController.js');
    expect(source).toContain('folding.js');
    expect(source).not.toContain('editor.main.js');
    expect(source).toContain('let monacoLoadPromise');
    expect(source).toContain('let activeEditor');
    expect(source).toContain('HEADER_CACHE_LIMIT = 4');
    expect(source).toContain('sourceModel.dispose()');
    expect(source).toContain('entry.model.dispose()');
    expect(source).not.toContain('{header.source}');
    expect(builderPage).toContain("tab === 'Context'");
    expect(builderPage).toContain("tab === 'Script'");
    expect(builderPage).toContain('key="deck-card-editor"');
    expect(builderPage).not.toContain('key={`deck-card:${selectedCard.id}:${tab}`}');
    expect(managerSource).toContain('scriptDraftCacheRef');
    expect(managerSource).toContain('preserveUnsavedScript');
  });
});
