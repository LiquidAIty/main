export type MonacoApi = typeof import('monaco-editor/esm/vs/editor/editor.api');
export type MonacoEditor = import('monaco-editor/esm/vs/editor/editor.api').editor.IStandaloneCodeEditor;
export type MonacoModel = import('monaco-editor/esm/vs/editor/editor.api').editor.ITextModel;
export type MonacoViewState = import('monaco-editor/esm/vs/editor/editor.api').editor.ICodeEditorViewState;
export type MonacoDisposable = import('monaco-editor/esm/vs/editor/editor.api').IDisposable;
type MonacoWorkerHost = typeof globalThis & {
  MonacoEnvironment?: { getWorker(_moduleId: string, _label: string): Worker };
};

export type CardScriptHeader = {
  schemaVersion: 'liquidaity.card-script.header.v1';
  version: number;
  hash: string;
  source: string;
  catalogToolCount: number;
  cardId: string;
  definitions: Record<string, {
    line: number;
    kind: string;
    canonicalId?: string;
    selected?: boolean;
    access?: string;
    availability?: string;
  }>;
};

type HeaderModelCacheEntry = {
  model: MonacoModel;
  references: number;
  lastUsed: number;
};

const THEME_NAME = 'card-script-sublime';
const HEADER_CACHE_LIMIT = 4;
const headerModelCache = new Map<string, HeaderModelCacheEntry>();
let headerUseSequence = 0;
let monacoLoadPromise: Promise<MonacoApi> | null = null;
let monacoFeatureLoadPromise: Promise<void> | null = null;

export async function loadMonaco(): Promise<MonacoApi> {
  if (!monacoLoadPromise) {
    monacoLoadPromise = import('monaco-editor/esm/vs/editor/editor.worker?worker').then(async (workerModule) => {
      const workerHost = globalThis as MonacoWorkerHost;
      workerHost.MonacoEnvironment ||= { getWorker: () => new workerModule.default() };
      const [monaco] = await Promise.all([
        import('monaco-editor/esm/vs/editor/editor.api'),
        import('monaco-editor/esm/vs/basic-languages/python/python.contribution.js'),
      ]);
      monaco.editor.defineTheme(THEME_NAME, {
        base: 'vs-dark',
        inherit: true,
        rules: [
          { token: 'comment', foreground: '71878A', fontStyle: 'italic' },
          { token: 'keyword', foreground: 'FF9D45' },
          { token: 'number', foreground: 'F0B86E' },
          { token: 'string', foreground: '77D8CF' },
          { token: 'type.identifier', foreground: '8BE0DA' },
          { token: 'identifier', foreground: 'DCE5E3' },
          { token: 'delimiter', foreground: '8FA4A6' },
        ],
        colors: {
          'editor.background': '#0D1112',
          'editor.foreground': '#DCE5E3',
          'editorLineNumber.foreground': '#425558',
          'editorLineNumber.activeForeground': '#E38A42',
          'editor.lineHighlightBackground': '#162022',
          'editor.lineHighlightBorder': '#00000000',
          'editor.selectionBackground': '#24565A99',
          'editor.inactiveSelectionBackground': '#213E4177',
          'editorCursor.foreground': '#65D9D1',
          'editorWhitespace.foreground': '#253638',
          'editorIndentGuide.background1': '#203033',
          'editorIndentGuide.activeBackground1': '#426467',
          'editorBracketMatch.background': '#E38A4228',
          'editorBracketMatch.border': '#E38A42AA',
          'editorError.foreground': '#FF7D78',
          'editorWarning.foreground': '#F0B86E',
          'editorOverviewRuler.border': '#00000000',
          'editorGutter.background': '#0D1112',
          'minimap.background': '#0B0F10',
          'minimap.selectionHighlight': '#4DBDB588',
          'scrollbar.shadow': '#00000000',
          'scrollbarSlider.background': '#40525555',
          'scrollbarSlider.hoverBackground': '#58717477',
          'scrollbarSlider.activeBackground': '#6B898C88',
          'editorWidget.background': '#141B1D',
          'editorWidget.border': '#33484C',
          'editorSuggestWidget.selectedBackground': '#244A4D',
          'editorSuggestWidget.highlightForeground': '#FFAD62',
          'focusBorder': '#55CFC777',
        },
      });
      return monaco as MonacoApi;
    }).catch((error) => {
      monacoLoadPromise = null;
      throw error;
    });
  }
  return monacoLoadPromise;
}

export async function loadMonacoFeatures(): Promise<void> {
  if (!monacoFeatureLoadPromise) {
    monacoFeatureLoadPromise = Promise.all([
      import('monaco-editor/esm/vs/editor/contrib/find/browser/findController.js'),
      import('monaco-editor/esm/vs/editor/contrib/folding/browser/folding.js'),
      import('monaco-editor/esm/vs/editor/contrib/bracketMatching/browser/bracketMatching.js'),
      import('monaco-editor/esm/vs/editor/contrib/multicursor/browser/multicursor.js'),
      import('monaco-editor/esm/vs/editor/contrib/suggest/browser/suggestController.js'),
      import('monaco-editor/esm/vs/editor/contrib/hover/browser/hoverContribution.js'),
      import('monaco-editor/esm/vs/editor/contrib/parameterHints/browser/parameterHints.js'),
      import('monaco-editor/esm/vs/editor/contrib/gotoSymbol/browser/goToCommands.js'),
      import('monaco-editor/esm/vs/editor/contrib/quickAccess/browser/commandsQuickAccess.js'),
      import('monaco-editor/esm/vs/editor/contrib/quickAccess/browser/gotoLineQuickAccess.js'),
      import('monaco-editor/esm/vs/editor/contrib/quickAccess/browser/gotoSymbolQuickAccess.js'),
    ]).then(() => undefined).catch((error) => {
      monacoFeatureLoadPromise = null;
      throw error;
    });
  }
  return monacoFeatureLoadPromise;
}

export function editorOptions(): import('monaco-editor/esm/vs/editor/editor.api').editor.IStandaloneEditorConstructionOptions {
  return {
    language: 'python',
    theme: THEME_NAME,
    automaticLayout: true,
    minimap: {
      enabled: true,
      side: 'right',
      size: 'fit',
      showSlider: 'mouseover',
      renderCharacters: false,
      maxColumn: 90,
      scale: 1,
    },
    fontSize: 13,
    lineHeight: 20,
    fontFamily: 'Cascadia Code, JetBrains Mono, Consolas, monospace',
    fontLigatures: false,
    lineNumbers: 'on',
    lineNumbersMinChars: 3,
    glyphMargin: false,
    folding: true,
    foldingStrategy: 'auto',
    showFoldingControls: 'mouseover',
    foldingHighlight: true,
    tabSize: 4,
    insertSpaces: true,
    detectIndentation: false,
    scrollBeyondLastLine: false,
    smoothScrolling: true,
    cursorSmoothCaretAnimation: 'on',
    cursorBlinking: 'smooth',
    cursorStyle: 'line-thin',
    renderLineHighlight: 'line',
    renderLineHighlightOnlyWhenFocus: false,
    renderWhitespace: 'selection',
    bracketPairColorization: { enabled: true, independentColorPoolPerBracketType: true },
    guides: {
      indentation: true,
      highlightActiveIndentation: true,
      bracketPairs: 'active',
      highlightActiveBracketPair: true,
    },
    matchBrackets: 'always',
    multiCursorModifier: 'alt',
    multiCursorPaste: 'spread',
    quickSuggestions: { other: true, comments: false, strings: true },
    suggestOnTriggerCharacters: true,
    snippetSuggestions: 'top',
    wordWrap: 'off',
    stickyScroll: { enabled: false },
    contextmenu: true,
    links: false,
    occurrencesHighlight: 'singleFile',
    selectionHighlight: true,
    overviewRulerLanes: 2,
    overviewRulerBorder: false,
    hideCursorInOverviewRuler: true,
    padding: { top: 10, bottom: 10 },
    scrollbar: {
      verticalScrollbarSize: 8,
      horizontalScrollbarSize: 8,
      useShadows: false,
    },
    ariaLabel: 'Card Python',
  };
}

export function acquireHeaderModel(monaco: MonacoApi, header: CardScriptHeader): MonacoModel {
  let entry = headerModelCache.get(header.hash);
  if (!entry || entry.model.isDisposed()) {
    const uri = monaco.Uri.parse(`inmemory://card-script/${header.hash}/card.pyi`);
    entry = {
      model: monaco.editor.getModel(uri) || monaco.editor.createModel(header.source, 'python', uri),
      references: 0,
      lastUsed: 0,
    };
    headerModelCache.set(header.hash, entry);
  }
  entry.references += 1;
  entry.lastUsed = ++headerUseSequence;
  return entry.model;
}

function pruneHeaderModelCache(): void {
  if (headerModelCache.size <= HEADER_CACHE_LIMIT) return;
  const disposable = [...headerModelCache.entries()]
    .filter(([, entry]) => entry.references === 0)
    .sort((left, right) => left[1].lastUsed - right[1].lastUsed);
  while (headerModelCache.size > HEADER_CACHE_LIMIT && disposable.length) {
    const [key, entry] = disposable.shift()!;
    entry.model.dispose();
    headerModelCache.delete(key);
  }
}

export function releaseHeaderModel(headerHash: string | null): void {
  if (!headerHash) return;
  const entry = headerModelCache.get(headerHash);
  if (!entry) return;
  entry.references = Math.max(0, entry.references - 1);
  entry.lastUsed = ++headerUseSequence;
  pruneHeaderModelCache();
}

export function markerForError(
  monaco: MonacoApi,
  model: MonacoModel,
  message: string,
): import('monaco-editor/esm/vs/editor/editor.api').editor.IMarkerData {
  const position = /:(\d+):(\d+)(?::|$)/.exec(message);
  const line = Math.min(model.getLineCount(), Math.max(1, Number(position?.[1] || 1)));
  const column = Math.min(model.getLineMaxColumn(line), Math.max(1, Number(position?.[2] || 1)));
  return {
    severity: monaco.MarkerSeverity.Error,
    message,
    source: 'Card Python',
    startLineNumber: line,
    startColumn: column,
    endLineNumber: line,
    endColumn: Math.min(model.getLineMaxColumn(line), column + 1),
  };
}
