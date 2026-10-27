import { useEffect, useRef, useState } from 'react';

// Graph + less = more: less code that does the same work as more code is more useful.
// Entity names the feature; Relationship explains why this file belongs and what it contributes.
// Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
// Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
// Entity: Card Scripts
// Relationship: Presents one real editable card.py source file. Python owns validation and execution.

import type { AgentCardRuntimeOptions } from '../../types/agentgraph';
import './CardScriptEditor.css';

type MonacoApi = typeof import('monaco-editor/editor/editor.api');
type MonacoEditor = import('monaco-editor/editor/editor.api').editor.IStandaloneCodeEditor;
type MonacoModel = import('monaco-editor/editor/editor.api').editor.ITextModel;
type CardScript = NonNullable<AgentCardRuntimeOptions['script']>;
type MonacoWorkerHost = typeof globalThis & {
  MonacoEnvironment?: { getWorker(_moduleId: string, _label: string): Worker };
};

const THEME_NAME = 'liquidaity-sublime';
let monacoLoadPromise: Promise<MonacoApi> | null = null;
let featureLoadPromise: Promise<void> | null = null;
let activeEditor: MonacoEditor | null = null;
let modelSequence = 0;

async function loadMonaco(): Promise<MonacoApi> {
  if (!monacoLoadPromise) {
    monacoLoadPromise = import('monaco-editor/editor/editor.worker?worker').then(async (workerModule) => {
      const workerHost = globalThis as MonacoWorkerHost;
      workerHost.MonacoEnvironment ||= { getWorker: () => new workerModule.default() };
      const [monaco] = await Promise.all([
        import('monaco-editor/editor/editor.api'),
        import('monaco-editor/languages/definitions/python/register.js'),
      ]);
      monaco.editor.defineTheme(THEME_NAME, {
        base: 'vs-dark',
        inherit: true,
        rules: [
          { token: 'comment', foreground: '71878A', fontStyle: 'italic' },
          { token: 'keyword', foreground: 'FF9D45' },
          { token: 'number', foreground: 'F0B86E' },
          { token: 'string', foreground: '77D8CF' },
          { token: 'identifier', foreground: 'DCE5E3' },
        ],
        colors: {
          'editor.background': '#0D1112',
          'editor.foreground': '#DCE5E3',
          'editorLineNumber.foreground': '#425558',
          'editorLineNumber.activeForeground': '#E38A42',
          'editor.lineHighlightBackground': '#162022',
          'editor.selectionBackground': '#24565A99',
          'editorCursor.foreground': '#65D9D1',
          'editorGutter.background': '#0D1112',
          'minimap.background': '#0B0F10',
          'scrollbar.shadow': '#00000000',
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

async function loadEditorFeatures(): Promise<void> {
  if (!featureLoadPromise) {
    featureLoadPromise = Promise.all([
      import('monaco-editor/editor/contrib/find/browser/findController.js'),
      import('monaco-editor/editor/contrib/folding/browser/folding.js'),
      import('monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching.js'),
      import('monaco-editor/editor/contrib/gotoSymbol/browser/goToCommands.js'),
      import('monaco-editor/editor/contrib/quickAccess/browser/commandsQuickAccess.js'),
      import('monaco-editor/editor/contrib/quickAccess/browser/gotoLineQuickAccess.js'),
      import('monaco-editor/editor/contrib/quickAccess/browser/gotoSymbolQuickAccess.js'),
    ]).then(() => undefined).catch((error) => {
      featureLoadPromise = null;
      throw error;
    });
  }
  return featureLoadPromise;
}

function editorOptions(): import('monaco-editor/editor/editor.api').editor.IStandaloneEditorConstructionOptions {
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
    },
    fontSize: 13,
    lineHeight: 20,
    fontFamily: 'Cascadia Code, JetBrains Mono, Consolas, monospace',
    lineNumbers: 'on',
    folding: true,
    smoothScrolling: true,
    matchBrackets: 'always',
    multiCursorModifier: 'alt',
    wordWrap: 'off',
    scrollBeyondLastLine: false,
    renderLineHighlight: 'line',
    guides: {
      indentation: true,
      highlightActiveIndentation: true,
      bracketPairs: 'active',
      highlightActiveBracketPair: true,
    },
    padding: { top: 10, bottom: 10 },
    ariaLabel: 'Card Python Script',
  };
}

function scriptWithSource(current: CardScript, source: string): CardScript {
  return {
    ...current,
    enabled: Boolean(source.trim()),
    source,
    sourceHash: '',
    compiledHash: '',
    paletteFingerprint: '',
    compiled: {},
    lastValidation: {},
  };
}

export function CardScriptEditor({
  cardId,
  script,
  onChange,
}: {
  cardId: string;
  projectId: string;
  deckId: string;
  runtimeKind: 'hermes';
  script: CardScript;
  selectedTools: string[];
  onChange(script: CardScript): void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<MonacoEditor | null>(null);
  const modelRef = useRef<MonacoModel | null>(null);
  const scriptRef = useRef(script);
  const onChangeRef = useRef(onChange);
  const applyingExternalSourceRef = useRef(false);
  const [opened, setOpened] = useState(Boolean(script.source.trim()));
  const [editorStatus, setEditorStatus] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [editorError, setEditorError] = useState<string | null>(null);
  const [featuresReady, setFeaturesReady] = useState(false);

  scriptRef.current = script;
  onChangeRef.current = onChange;

  useEffect(() => {
    if (script.source.trim()) setOpened(true);
  }, [cardId, script.source]);

  useEffect(() => {
    if (!opened || !hostRef.current) return undefined;
    let cancelled = false;
    let disposeEditor: (() => void) | null = null;
    setEditorStatus('loading');
    setEditorError(null);
    setFeaturesReady(false);
    void Promise.all([loadMonaco(), loadEditorFeatures()]).then(([monaco]) => {
      if (cancelled || !hostRef.current) return;
      if (activeEditor) activeEditor.dispose();
      const uri = monaco.Uri.parse(
        `inmemory://card-script/${encodeURIComponent(cardId)}/${++modelSequence}/card.py`,
      );
      const model = monaco.editor.createModel(scriptRef.current.source, 'python', uri);
      const editor = monaco.editor.create(hostRef.current, { ...editorOptions(), model });
      activeEditor = editor;
      editorRef.current = editor;
      modelRef.current = model;
      const subscription = model.onDidChangeContent(() => {
        if (applyingExternalSourceRef.current) return;
        const source = model.getValue();
        if (source === scriptRef.current.source) return;
        onChangeRef.current(scriptWithSource(scriptRef.current, source));
      });
      setEditorStatus('ready');
      setFeaturesReady(true);
      disposeEditor = () => {
        subscription.dispose();
        if (activeEditor === editor) activeEditor = null;
        editorRef.current = null;
        modelRef.current = null;
        editor.dispose();
        model.dispose();
      };
    }).catch((error) => {
      if (cancelled) return;
      setEditorStatus('failed');
      setEditorError(error instanceof Error ? error.message : 'python_editor_unavailable');
    });
    return () => {
      cancelled = true;
      disposeEditor?.();
    };
  }, [cardId, opened]);

  useEffect(() => {
    const model = modelRef.current;
    if (!model || model.getValue() === script.source) return;
    applyingExternalSourceRef.current = true;
    model.setValue(script.source);
    applyingExternalSourceRef.current = false;
  }, [script.source]);

  const runEditorAction = (action: string) => {
    editorRef.current?.focus();
    void editorRef.current?.getAction(action)?.run();
  };

  if (!opened && !script.source.trim()) {
    return (
      <section data-testid="card-script-editor" className="card-script-ide">
        <button type="button" onClick={() => setOpened(true)}>Add Python script</button>
      </section>
    );
  }

  return (
    <section data-testid="card-script-editor" className="card-script-ide">
      <header className="card-script-ide__header">
        <div className="card-script-ide__identity"><strong>Card Python Script</strong></div>
      </header>
      <div className="card-script-ide__frame">
        <div className="card-script-ide__tabs" role="tablist" aria-label="Card Script files">
          <button type="button" role="tab" aria-selected className="is-active">
            <span className="card-script-ide__file-dot" /> card.py
          </button>
        </div>
        <div className="card-script-ide__commands" aria-label="Editor commands">
          <button type="button" disabled={!featuresReady} onClick={() => runEditorAction('actions.find')}>Find</button>
          <button type="button" disabled={!featuresReady} onClick={() => runEditorAction('editor.action.gotoLine')}>Line</button>
          <button type="button" disabled={!featuresReady} onClick={() => runEditorAction('editor.action.quickOutline')}>Outline</button>
          <button type="button" disabled={!featuresReady} onClick={() => runEditorAction('editor.action.quickCommand')}>Commands</button>
        </div>
        <div className="card-script-ide__editor-shell">
          <div ref={hostRef} data-testid="card-script-monaco" className="card-script-ide__monaco" />
          {editorStatus !== 'ready' ? (
            <div className="card-script-ide__editor-state" role={editorStatus === 'failed' ? 'alert' : 'status'}>
              {editorStatus === 'loading' ? 'Loading Python editor…' : editorError || ''}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export { editorOptions, scriptWithSource };
