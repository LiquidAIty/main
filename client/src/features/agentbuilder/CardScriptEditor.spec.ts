import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { editorOptions, SCRIPT_SECTIONS, STARTER_SCRIPT } from './CardScriptEditor';

describe('CardScriptEditor Monaco contract', () => {
  it('keeps the executable starter organized around the five Card control sections', () => {
    for (const section of SCRIPT_SECTIONS) {
      expect(STARTER_SCRIPT).toContain(`# region ${section}`);
    }
    expect(STARTER_SCRIPT.match(/# region /g)).toHaveLength(5);
    expect(STARTER_SCRIPT.match(/# endregion/g)).toHaveLength(5);
    expect(STARTER_SCRIPT).toContain('"mode": "outer_controller"');
    expect(STARTER_SCRIPT).toContain('output.emit({');
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
    expect(builderPage).toContain("tab === 'Skills'");
    expect(builderPage).toContain("tab === 'Script'");
    expect(builderPage).toContain('key="deck-card-editor"');
    expect(builderPage).not.toContain('key={`deck-card:${selectedCard.id}:${tab}`}');
    expect(managerSource).toContain('scriptDraftCacheRef');
    expect(managerSource).toContain('preserveUnsavedScript');
  });
});
