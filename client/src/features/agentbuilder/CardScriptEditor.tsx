import { useEffect, useMemo, useRef, useState } from 'react';

import type { AgentCardRuntimeOptions } from '../../types/agentgraph';
import './CardScriptEditor.css';

type MonacoApi = typeof import('monaco-editor/esm/vs/editor/editor.api');
type MonacoEditor = import('monaco-editor/esm/vs/editor/editor.api').editor.IStandaloneCodeEditor;
type MonacoModel = import('monaco-editor/esm/vs/editor/editor.api').editor.ITextModel;
type MonacoViewState = import('monaco-editor/esm/vs/editor/editor.api').editor.ICodeEditorViewState;
type MonacoDisposable = import('monaco-editor/esm/vs/editor/editor.api').IDisposable;
type MonacoWorkerHost = typeof globalThis & {
  MonacoEnvironment?: { getWorker(_moduleId: string, _label: string): Worker };
};
type CardScript = NonNullable<AgentCardRuntimeOptions['script']>;

type ScriptToolReference = {
  canonicalId: string;
  access: 'read' | 'write';
  availability: 'available' | 'disabled';
  shortDescription?: string;
  contracts: Array<{
    inputSchema: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
  }>;
};

type CardScriptHeader = {
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

const THEME_NAME = 'liquidaity-sublime';
const HEADER_CACHE_LIMIT = 4;
const TOOL_MODE_COMPLETIONS = [
  {
    label: 'OFF', value: 0, detail: 'OFF (0) · unavailable to Script and agent',
    documentation: 'The Card may authorize this tool, but this Scripted Run exposes it to neither Python nor the Hermes agent.',
  },
  {
    label: 'SCRIPT', value: 1, detail: 'SCRIPT (1) · Python only',
    documentation: 'The saved Python Script may call this authorized tool. Its schema is omitted from the Hermes agent request.',
  },
  {
    label: 'AGENT', value: 2, detail: 'AGENT (2) · Hermes agent only',
    documentation: 'Hermes receives the authorized tool normally. The Python Script cannot call it directly.',
  },
  {
    label: 'BOTH', value: 3, detail: 'BOTH (3) · Python and Hermes agent',
    documentation: 'Both the saved Python Script and the Hermes agent may call this authorized tool. Use only when duplicate access is intentional.',
  },
] as const;
const headerModelCache = new Map<string, HeaderModelCacheEntry>();
let headerUseSequence = 0;
let monacoLoadPromise: Promise<MonacoApi> | null = null;
let monacoFeatureLoadPromise: Promise<void> | null = null;
let activeEditor: MonacoEditor | null = null;
let sourceModelSequence = 0;

const SCRIPT_SECTIONS = [
  'Optimized Tool Configuration',
  'Authorized Tool Operations',
  'Typed Result',
] as const;

const STARTER_SCRIPT = `# region Optimized Tool Configuration
CARD_SCRIPT = {
    "mode": "tool_recipe",
    "input": {
        "type": "object",
        "properties": {"query": {"type": "string"}},
        "required": ["query"],
        "additionalProperties": False,
    },
    "output": {
        "type": "object",
        "properties": {"result": {}},
        "required": ["result"],
        "additionalProperties": False,
    },
    "timeout_seconds": 15,
    "max_tool_calls": 6,
    "max_output_bytes": 20000,
}
# endregion

# region Authorized Tool Operations
from hermes_tools import SCRIPT, input, output, tools

# Selected tools default to AGENT. Mark only recipe-owned handles SCRIPT:
# tools.cbm.search_graph = SCRIPT
# endregion

# region Typed Result
# Hermes chooses whether to call this optimized tool. The function cannot
# rewrite the Card prompt, context, memory, lifecycle, or native Team.
output.emit({"result": {"query": input.query}})
# endregion
`;

const SCRIPT_EXAMPLES = [
  {
    id: 'thinkgraph-context',
    label: 'ThinkGraph context',
    description: 'Read bounded Constellation context plus one exact native memory.',
    source: `CARD_SCRIPT = {
    "mode": "tool_recipe",
    "input": {
        "type": "object",
        "properties": {
            "query": {"type": "string"},
            "nativeId": {"type": "string"},
        },
        "required": ["query", "nativeId"],
        "additionalProperties": False,
    },
    "output": {
        "type": "object",
        "properties": {
            "result": {"type": "object"},
        },
        "required": ["result"],
        "additionalProperties": False,
    },
    "timeout_seconds": 15,
    "max_tool_calls": 2,
    "max_output_bytes": 20000,
}

from hermes_tools import SCRIPT, input, output, tools

tools.constellation.context = SCRIPT
tools.constellation.inspect = SCRIPT

bounded_context = tools.call(
    "constellation.context", focus=input.query, budget=1600, maxDepth=2, maxL2=8
)
exact_memory = tools.call(
    "constellation.inspect", nativeId=input.nativeId, budget=1200, maxDepth=1, maxL2=6
)
result = {"context": bounded_context, "exactMemory": exact_memory}
output.emit({"result": result})
`,
  },
  {
    id: 'knowgraph-evidence',
    label: 'KnowGraph evidence',
    description: 'Read bounded native entities, facts, and episode provenance.',
    source: `CARD_SCRIPT = {
    "mode": "tool_recipe",
    "input": {
        "type": "object",
        "properties": {"query": {"type": "string"}},
        "required": ["query"],
        "additionalProperties": False,
    },
    "output": {
        "type": "object",
        "properties": {
            "result": {"type": "object"},
        },
        "required": ["result"],
        "additionalProperties": False,
    },
    "timeout_seconds": 15,
    "max_tool_calls": 3,
    "max_output_bytes": 20000,
}

from hermes_tools import SCRIPT, input, output, tools

tools.graphiti.search_nodes = SCRIPT
tools.graphiti.search_memory_facts = SCRIPT
tools.graphiti.get_episodes = SCRIPT

nodes = tools.call("graphiti.search_nodes", query=input.query, max_nodes=8)
facts = tools.call("graphiti.search_memory_facts", query=input.query, max_facts=12)
episodes = tools.call(
    "graphiti.get_episodes", max_episodes=10, include_body=False,
    body_preview_chars=300, max_response_chars=12000
)
result = {"nodes": nodes, "facts": facts, "episodes": episodes}
output.emit({"result": result})
`,
  },
] as const;

async function loadMonaco(): Promise<MonacoApi> {
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

async function loadMonacoFeatures(): Promise<void> {
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

function editorOptions(): import('monaco-editor/esm/vs/editor/editor.api').editor.IStandaloneEditorConstructionOptions {
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
    ariaLabel: 'Card Python Script',
  };
}

function acquireHeaderModel(monaco: MonacoApi, header: CardScriptHeader): MonacoModel {
  let entry = headerModelCache.get(header.hash);
  if (!entry || entry.model.isDisposed()) {
    const uri = monaco.Uri.parse(`inmemory://liquidaity/card-script/${header.hash}/liquidaity_card.pyi`);
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

function releaseHeaderModel(headerHash: string | null): void {
  if (!headerHash) return;
  const entry = headerModelCache.get(headerHash);
  if (!entry) return;
  entry.references = Math.max(0, entry.references - 1);
  entry.lastUsed = ++headerUseSequence;
  pruneHeaderModelCache();
}

function schemaText(reference: ScriptToolReference): string {
  const contract = reference.contracts[0];
  return JSON.stringify({
    input: contract?.inputSchema || { type: 'object', properties: {} },
    output: contract?.outputSchema || null,
  }, null, 2);
}

function symbolAtPosition(model: MonacoModel, position: { lineNumber: number; column: number }): string | null {
  const line = model.getLineContent(position.lineNumber);
  const offset = position.column - 1;
  for (const match of line.matchAll(/(?:tools|card)(?:\.[A-Za-z_][A-Za-z0-9_]*)+/g)) {
    const start = match.index || 0;
    const end = start + match[0].length;
    if (offset >= start && offset <= end) return match[0];
  }
  const callMatch = /tools\.call\(\s*["']([^"']+)["']/.exec(line);
  if (callMatch) {
    const quotedStart = (callMatch.index || 0) + callMatch[0].indexOf(callMatch[1]);
    if (offset >= quotedStart && offset <= quotedStart + callMatch[1].length) return `tools.${callMatch[1]}`;
  }
  const word = model.getWordAtPosition(position)?.word || '';
  if (TOOL_MODE_COMPLETIONS.some((mode) => mode.label === word)) return word;
  return null;
}

function markerForError(
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
    source: 'LiquidAIty Card Script',
    startLineNumber: line,
    startColumn: column,
    endLineNumber: line,
    endColumn: Math.min(model.getLineMaxColumn(line), column + 1),
  };
}

function shortHash(script: CardScript): string {
  return (script.sourceHash || script.compiledHash || 'unsaved').slice(0, 12);
}

function changedSourceDraft(
  current: CardScript,
  nextSource: string,
  runtimeKind: 'hermes' | 'autogen',
): CardScript {
  return {
    ...current,
    source: nextSource,
    sourceHash: '',
    compiledHash: '',
    compiled: {},
    lastValidation: {
      status: nextSource.trim() ? 'unvalidated' : 'blank',
      executionTested: false,
      errors: [],
      toolHandles: [],
    },
    nativeSupport: {
      available: runtimeKind === 'hermes',
      active: false,
      executor: runtimeKind === 'hermes' ? 'hermes-native-python' : null,
    },
  };
}

export function CardScriptEditor({
  cardId,
  runtimeKind,
  script,
  toolCatalogPolicy,
  selectedTools,
  disabledTools,
  onChange,
}: {
  cardId: string;
  runtimeKind: 'hermes' | 'autogen';
  script: CardScript;
  toolCatalogPolicy: 'selected' | 'all_healthy';
  selectedTools: string[];
  disabledTools: string[];
  onChange(script: CardScript): void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const monacoRef = useRef<MonacoApi | null>(null);
  const editorRef = useRef<MonacoEditor | null>(null);
  const sourceModelRef = useRef<MonacoModel | null>(null);
  const headerModelRef = useRef<MonacoModel | null>(null);
  const headerModelHashRef = useRef<string | null>(null);
  const headerDecorationsRef = useRef<string[]>([]);
  const sourceViewStateRef = useRef<MonacoViewState | null>(null);
  const headerViewStateRef = useRef<MonacoViewState | null>(null);
  const applyingExternalValueRef = useRef(false);
  const activeDocumentRef = useRef<'source' | 'header'>('source');
  const scriptRef = useRef(script);
  const onChangeRef = useRef(onChange);
  const toolsRef = useRef<ScriptToolReference[]>([]);
  const headerRef = useRef<CardScriptHeader | null>(null);
  const [toolReferences, setToolReferences] = useState<ScriptToolReference[]>([]);
  const [header, setHeader] = useState<CardScriptHeader | null>(null);
  const [toolStatus, setToolStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [toolError, setToolError] = useState<string | null>(null);
  const [editorStatus, setEditorStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [editorError, setEditorError] = useState<string | null>(null);
  const [featureStatus, setFeatureStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [activeDocument, setActiveDocumentState] = useState<'source' | 'header'>('source');
  const [cursorPosition, setCursorPosition] = useState({ line: 1, column: 1 });
  const [validationBusy, setValidationBusy] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  scriptRef.current = script;
  onChangeRef.current = onChange;
  toolsRef.current = toolReferences;
  headerRef.current = header;

  const selectionQuery = useMemo(() => {
    const params = new URLSearchParams({
      cardId,
      policy: toolCatalogPolicy,
      selectedIds: selectedTools.join(','),
      disabledIds: disabledTools.join(','),
    });
    return params.toString();
  }, [cardId, toolCatalogPolicy, selectedTools.join('\u0000'), disabledTools.join('\u0000')]);

  const switchDocument = (next: 'source' | 'header') => {
    const editor = editorRef.current;
    const sourceModel = sourceModelRef.current;
    const headerModel = headerModelRef.current;
    if (!editor || !sourceModel || (next === 'header' && !headerModel)) return;
    if (activeDocumentRef.current === 'source') sourceViewStateRef.current = editor.saveViewState();
    else headerViewStateRef.current = editor.saveViewState();
    editor.setModel(next === 'source' ? sourceModel : headerModel!);
    editor.updateOptions({ readOnly: next === 'header', domReadOnly: next === 'header' });
    editor.restoreViewState(next === 'source' ? sourceViewStateRef.current : headerViewStateRef.current);
    editor.focus();
    const position = editor.getPosition();
    if (position) setCursorPosition({ line: position.lineNumber, column: position.column });
    activeDocumentRef.current = next;
    setActiveDocumentState(next);
  };

  useEffect(() => {
    const controller = new AbortController();
    setToolStatus('loading');
    setToolError(null);
    void fetch(`/api/coder/input-data-dictionary/script-tools?${selectionQuery}`, {
      signal: controller.signal,
    }).then(async (response) => {
      const payload = await response.json();
      if (!response.ok || payload?.ok !== true || !Array.isArray(payload.references)
        || payload?.header?.schemaVersion !== 'liquidaity.card-script.header.v1') {
        throw new Error(String(payload?.error || 'card_script_tools_unavailable'));
      }
      setToolReferences(payload.references);
      setHeader(payload.header as CardScriptHeader);
      setToolStatus('ready');
    }).catch((error) => {
      if (controller.signal.aborted) return;
      setToolReferences([]);
      setHeader(null);
      setToolStatus('failed');
      setToolError(error instanceof Error ? error.message : 'card_script_tools_unavailable');
    });
    return () => controller.abort();
  }, [selectionQuery]);

  useEffect(() => {
    if (!hostRef.current) return;
    let cancelled = false;
    let disposeLoadedEditor: (() => void) | null = null;
    setEditorStatus('loading');
    setEditorError(null);
    setFeatureStatus('loading');
    void loadMonaco().then((monaco) => {
      if (cancelled || !hostRef.current) return;
      monacoRef.current = monaco;
      if (activeEditor) activeEditor.dispose();
      const sourceUri = monaco.Uri.parse(
        `inmemory://liquidaity/card-script/source/${encodeURIComponent(cardId)}/${++sourceModelSequence}/card.py`,
      );
      const sourceModel = monaco.editor.createModel(scriptRef.current.source, 'python', sourceUri);
      const editor = monaco.editor.create(hostRef.current, { ...editorOptions(), model: sourceModel });
      activeEditor = editor;
      editorRef.current = editor;
      sourceModelRef.current = sourceModel;

      const disposables: MonacoDisposable[] = [];
      disposables.push(sourceModel.onDidChangeContent(() => {
        if (applyingExternalValueRef.current) return;
        const current = scriptRef.current;
        const nextSource = sourceModel.getValue();
        if (nextSource === current.source) return;
        onChangeRef.current(changedSourceDraft(current, nextSource, runtimeKind));
      }));
      disposables.push(editor.onDidChangeCursorPosition((event) => {
        setCursorPosition({ line: event.position.lineNumber, column: event.position.column });
      }));
      disposables.push(monaco.languages.registerCompletionItemProvider('python', {
        triggerCharacters: ['"', "'", '.', '='],
        provideCompletionItems(currentModel, position) {
          if (currentModel.uri.toString() !== sourceModel.uri.toString()) return { suggestions: [] };
          const line = currentModel.getLineContent(position.lineNumber).slice(0, position.column - 1);
          const modeMatch = line.match(
            /tools\.([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+)\s*=\s*([A-Za-z_]*)$/,
          );
          if (modeMatch) {
            const [, canonicalId, fragment] = modeMatch;
            const authorized = toolsRef.current.some((reference) => reference.canonicalId === canonicalId);
            if (!authorized) return { suggestions: [] };
            const range = {
              startLineNumber: position.lineNumber,
              endLineNumber: position.lineNumber,
              startColumn: Math.max(1, position.column - fragment.length),
              endColumn: position.column,
            };
            return {
              suggestions: TOOL_MODE_COMPLETIONS
                .filter((mode) => !fragment || mode.label.startsWith(fragment.toUpperCase()))
                .map((mode) => ({
                  label: mode.label,
                  kind: monaco.languages.CompletionItemKind.EnumMember,
                  detail: mode.detail,
                  documentation: `${mode.documentation}\n\nThe Card's Tools tab remains the authorization ceiling.`,
                  insertText: mode.label,
                  range,
                  sortText: String(mode.value),
                })),
            };
          }
          const handleMatch = line.match(/tools\.call\(\s*["']([^"']*)$/);
          const fragment = handleMatch?.[1] || '';
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: Math.max(1, position.column - fragment.length),
            endColumn: position.column,
          };
          const toolSuggestions = toolsRef.current
            .filter((reference) => !fragment || reference.canonicalId.includes(fragment))
            .map((reference, index) => ({
              label: reference.canonicalId,
              kind: monaco.languages.CompletionItemKind.Function,
              detail: `${reference.access} · selected Card tool`,
              documentation: {
                value: `**${reference.canonicalId}**\n\n${reference.shortDescription || ''}\n\n\`\`\`json\n${schemaText(reference)}\n\`\`\``,
              },
              insertText: handleMatch ? reference.canonicalId : `tools.call("${reference.canonicalId}", **\${1:{}})`,
              insertTextRules: handleMatch
                ? monaco.languages.CompletionItemInsertTextRule.None
                : monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
              sortText: String(index).padStart(6, '0'),
            }));
          if (handleMatch) return { suggestions: toolSuggestions };
          const headerSuggestions = Object.entries(headerRef.current?.definitions || {}).map(
            ([symbol, definition], index) => ({
              label: symbol,
              kind: definition.kind === 'tool'
                ? monaco.languages.CompletionItemKind.Property
                : monaco.languages.CompletionItemKind.Struct,
              detail: definition.kind === 'tool'
                ? `${definition.selected ? 'selected/runnable' : 'ungranted/read-only'} · ${definition.access || 'read'} · ${definition.canonicalId}`
                : `canonical ${definition.kind}`,
              documentation: definition.kind === 'tool'
                ? `Header visibility is not authority. **${definition.canonicalId}** is ${definition.selected ? 'selected on this Card' : 'not granted on this Card'}.`
                : 'Generated from the canonical IDD for this Card revision.',
              insertText: symbol,
              range,
              sortText: `${definition.selected ? '1' : '9'}-${String(index).padStart(6, '0')}`,
              tags: definition.selected ? undefined : [monaco.languages.CompletionItemTag.Deprecated],
            }),
          );
          return { suggestions: [
            {
              label: 'CARD_SCRIPT contract',
              kind: monaco.languages.CompletionItemKind.Snippet,
              detail: 'LiquidAIty bounded Card Script',
              insertText: STARTER_SCRIPT,
              range,
            },
            {
              label: 'input',
              kind: monaco.languages.CompletionItemKind.Variable,
              detail: 'Immutable host-supplied Script input',
              insertText: 'input',
              range,
            },
            {
              label: 'output.emit',
              kind: monaco.languages.CompletionItemKind.Method,
              detail: 'Emit the one typed Script result',
              insertText: 'output.emit(${1:value})',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
            },
            ...toolSuggestions,
            ...headerSuggestions,
          ] };
        },
      }));
      disposables.push(monaco.languages.registerDefinitionProvider('python', {
        provideDefinition(currentModel, position) {
          if (currentModel.uri.toString() !== sourceModel.uri.toString()) return null;
          const symbol = symbolAtPosition(currentModel, position);
          const target = symbol ? headerRef.current?.definitions[symbol] : null;
          const headerModel = headerModelRef.current;
          if (!target || !headerModel) return null;
          return {
            uri: headerModel.uri,
            range: new monaco.Range(target.line, 1, target.line, headerModel.getLineMaxColumn(target.line)),
          };
        },
      }));
      disposables.push(monaco.languages.registerHoverProvider('python', {
        provideHover(currentModel, position) {
          const symbol = symbolAtPosition(currentModel, position);
          const mode = TOOL_MODE_COMPLETIONS.find((candidate) => candidate.label === symbol);
          if (mode) {
            return {
              contents: [{
                value: `**${mode.detail}**\n\n${mode.documentation}\n\nThe Card's Tools tab remains the authorization ceiling.`,
              }],
            };
          }
          const target = symbol ? headerRef.current?.definitions[symbol] : null;
          if (!symbol || !target) return null;
          const authority = target.kind === 'tool'
            ? (target.selected
              ? 'SELECTED: defaults to AGENT until Script sets OFF/SCRIPT/BOTH.'
              : 'UNGRANTED: visible for authoring but cannot be enabled by Python.')
            : 'Canonical IDD object; omission preserves saved behavior.';
          return { contents: [{ value: `**${symbol}**\n\n${authority}` }] };
        },
      }));
      disposables.push(monaco.languages.registerSignatureHelpProvider('python', {
        signatureHelpTriggerCharacters: ['(', ','],
        provideSignatureHelp(currentModel, position) {
          const beforeCursor = currentModel.getLineContent(position.lineNumber).slice(0, position.column - 1);
          const match = /tools\.call\(\s*["']([^"']+)["']\s*,?/.exec(beforeCursor);
          const reference = toolsRef.current.find((item) => item.canonicalId === match?.[1]);
          if (!reference) return null;
          return {
            value: {
              activeParameter: beforeCursor.trimEnd().endsWith(',') ? 1 : 0,
              activeSignature: 0,
              signatures: [{
                label: `tools.call("${reference.canonicalId}", arguments: dict)`,
                documentation: `${reference.access} · ${reference.shortDescription || 'selected Card tool'}\n\n${schemaText(reference)}`,
                parameters: [
                  { label: `"${reference.canonicalId}"`, documentation: 'Canonical selected tool ID.' },
                  { label: 'arguments: dict', documentation: 'Arguments validated against the live tool schema.' },
                ],
              }],
            },
            dispose: () => undefined,
          };
        },
      }));
      disposables.push(monaco.languages.registerDocumentSymbolProvider('python', {
        provideDocumentSymbols(currentModel) {
          if (currentModel.uri.toString() !== sourceModel.uri.toString()) return [];
          const symbols: import('monaco-editor/esm/vs/editor/editor.api').languages.DocumentSymbol[] = [];
          for (let lineNumber = 1; lineNumber <= currentModel.getLineCount(); lineNumber += 1) {
            const line = currentModel.getLineContent(lineNumber).trim();
            const label = SCRIPT_SECTIONS.find((section) => line === `# region ${section}`);
            if (!label) continue;
            let endLine = lineNumber;
            for (let scan = lineNumber + 1; scan <= currentModel.getLineCount(); scan += 1) {
              if (currentModel.getLineContent(scan).trim() === '# endregion') {
                endLine = scan;
                break;
              }
            }
            symbols.push({
              name: label,
              detail: 'Card Script section',
              kind: monaco.languages.SymbolKind.Namespace,
              tags: [],
              range: new monaco.Range(lineNumber, 1, endLine, currentModel.getLineMaxColumn(endLine)),
              selectionRange: new monaco.Range(lineNumber, 1, lineNumber, currentModel.getLineMaxColumn(lineNumber)),
              children: [],
            });
          }
          return symbols;
        },
      }));

      setEditorStatus('ready');
      void loadMonacoFeatures().then(() => {
        if (!cancelled) setFeatureStatus('ready');
      }).catch(() => {
        if (!cancelled) setFeatureStatus('failed');
      });
      disposeLoadedEditor = () => {
        for (const disposable of disposables) disposable.dispose();
        monaco.editor.setModelMarkers(sourceModel, 'liquidaity-card-script', []);
        if (headerModelRef.current && headerDecorationsRef.current.length) {
          headerDecorationsRef.current = headerModelRef.current.deltaDecorations(headerDecorationsRef.current, []);
        }
        releaseHeaderModel(headerModelHashRef.current);
        headerModelHashRef.current = null;
        headerModelRef.current = null;
        sourceModelRef.current = null;
        editorRef.current = null;
        monacoRef.current = null;
        if (activeEditor === editor) activeEditor = null;
        editor.dispose();
        sourceModel.dispose();
      };
    }).catch((error) => {
      if (cancelled) return;
      setEditorStatus('failed');
      setEditorError(error instanceof Error ? error.message : 'monaco_editor_unavailable');
    });
    return () => {
      cancelled = true;
      disposeLoadedEditor?.();
    };
  }, [cardId, runtimeKind]);

  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;
    if (headerModelRef.current && headerDecorationsRef.current.length) {
      headerDecorationsRef.current = headerModelRef.current.deltaDecorations(headerDecorationsRef.current, []);
    }
    releaseHeaderModel(headerModelHashRef.current);
    headerModelRef.current = null;
    headerModelHashRef.current = null;
    if (!header) {
      if (activeDocumentRef.current === 'header') switchDocument('source');
      return;
    }
    const model = acquireHeaderModel(monaco, header);
    headerModelRef.current = model;
    headerModelHashRef.current = header.hash;
    headerDecorationsRef.current = model.deltaDecorations([], Object.values(header.definitions)
      .filter((definition) => definition.kind === 'tool')
      .map((definition) => ({
        range: new monaco.Range(definition.line, 1, definition.line, model.getLineMaxColumn(definition.line)),
        options: {
          isWholeLine: true,
          className: definition.selected
            ? 'card-script-header-tool-selected'
            : 'card-script-header-tool-ungranted',
        },
      })));
    if (activeDocumentRef.current === 'header' && editorRef.current) {
      editorRef.current.setModel(model);
      editorRef.current.updateOptions({ readOnly: true, domReadOnly: true });
    }
    return () => {
      if (headerModelRef.current === model && headerDecorationsRef.current.length) {
        headerDecorationsRef.current = model.deltaDecorations(headerDecorationsRef.current, []);
      }
      if (headerModelHashRef.current === header.hash) {
        releaseHeaderModel(header.hash);
        headerModelHashRef.current = null;
        headerModelRef.current = null;
      }
    };
  }, [header?.hash, editorStatus]);

  useEffect(() => {
    const monaco = monacoRef.current;
    const model = sourceModelRef.current;
    if (!monaco || !model) return;
    const errors = Array.isArray(script.lastValidation?.errors)
      ? script.lastValidation.errors.map(String)
      : [];
    monaco.editor.setModelMarkers(
      model,
      'liquidaity-card-script',
      errors.map((message) => markerForError(monaco, model, message)),
    );
  }, [script.lastValidation?.errors, editorStatus]);

  useEffect(() => {
    const model = sourceModelRef.current;
    if (!model || model.getValue() === script.source) return;
    const editor = editorRef.current;
    const position = editor?.getModel() === model ? editor.getPosition() : null;
    applyingExternalValueRef.current = true;
    model.setValue(script.source);
    if (position && editor?.getModel() === model) editor.setPosition(position);
    applyingExternalValueRef.current = false;
  }, [script.source, editorStatus]);

  const triggerEditorAction = (action: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    void editor.getAction(action)?.run();
  };

  const validate = async () => {
    if (validationBusy) return;
    setValidationBusy(true);
    setValidationError(null);
    try {
      const response = await fetch('/api/coder/card-script/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runtimeKind, toolCatalogPolicy, selectedTools, disabledTools, script }),
      });
      const payload = await response.json();
      if (!response.ok || payload?.ok !== true || !payload.script) {
        throw new Error(String(payload?.error || 'card_script_validation_failed'));
      }
      onChange(payload.script as CardScript);
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : 'card_script_validation_failed');
    } finally {
      setValidationBusy(false);
    }
  };

  const validation = script.lastValidation || {};
  const validationStatus = String(validation.status || (script.source.trim() ? 'unvalidated' : 'blank'));
  const validationErrors = Array.isArray(validation.errors) ? validation.errors.map(String) : [];
  const diagnosticCount = validationErrors.length + (validationError ? 1 : 0);
  const active = script.enabled && script.nativeSupport?.active === true;
  const ungrantedCount = Math.max(0, (header?.catalogToolCount || 0) - toolReferences.length);

  return (
    <section data-testid="card-script-editor" className="card-script-ide">
      <header className="card-script-ide__header">
        <div className="card-script-ide__identity">
          <strong>Card Python Script</strong>
          <span>One immutable source per saved Card. The generated header is IDE metadata and never enters model context.</span>
        </div>
        <label className="card-script-ide__activation">
          <input
            type="checkbox"
            checked={script.enabled}
            disabled={runtimeKind !== 'hermes'}
            onChange={(event) => onChange({
              ...script,
              enabled: event.target.checked,
              nativeSupport: { ...(script.nativeSupport || {}), active: false },
            })}
            aria-label="Activate Card Script"
          />
          Active next saved Run
        </label>
      </header>

      {runtimeKind !== 'hermes' ? (
        <div role="status" className="card-script-ide__notice">
          This Card is not Hermes-backed. Editing remains available; activation stays off and the Card remains MCP-driven.
        </div>
      ) : null}

      <div className="card-script-ide__frame">
        <div className="card-script-ide__tabs" role="tablist" aria-label="Card Script files">
          <button
            type="button"
            role="tab"
            aria-selected={activeDocument === 'source'}
            className={activeDocument === 'source' ? 'is-active' : ''}
            onClick={() => switchDocument('source')}
          >
            <span className="card-script-ide__file-dot" /> card.py
            {validationStatus === 'unvalidated' ? <span className="card-script-ide__dirty-dot" aria-label="Unvalidated changes" /> : null}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeDocument === 'header'}
            className={activeDocument === 'header' ? 'is-active' : ''}
            onClick={() => switchDocument('header')}
            disabled={!header}
            title="Generated read-only definitions"
          >
            liquidaity_card.pyi <span className="card-script-ide__readonly">read-only</span>
          </button>
          <div className="card-script-ide__grant-key" aria-label="Tool grant legend">
            <span className="is-selected">{toolReferences.length} authorized</span>
            <span className="is-ungranted">{ungrantedCount} ungranted</span>
          </div>
        </div>

        <div className="card-script-ide__commands" aria-label="Editor commands">
          <button type="button" disabled={featureStatus !== 'ready'} onClick={() => triggerEditorAction('actions.find')} title="Find / Replace (Ctrl+F)">Find</button>
          <button type="button" disabled={featureStatus !== 'ready'} onClick={() => triggerEditorAction('editor.action.gotoLine')} title="Go to Line (Ctrl+G)">Line</button>
          <button type="button" disabled={featureStatus !== 'ready'} onClick={() => triggerEditorAction('editor.action.quickOutline')} title="Go to Symbol (Ctrl+Shift+O)">Outline</button>
          <button type="button" disabled={featureStatus !== 'ready'} onClick={() => triggerEditorAction('editor.action.quickCommand')} title="Command Palette (Ctrl+Shift+P)">Commands</button>
        </div>

        <div className="card-script-ide__editor-shell">
          <div ref={hostRef} data-testid="card-script-monaco" className="card-script-ide__monaco" />
          {editorStatus !== 'ready' ? (
            <div className="card-script-ide__editor-state" role={editorStatus === 'failed' ? 'alert' : 'status'}>
              {editorStatus === 'loading' ? 'Loading Python editor…' : editorError || 'Python editor unavailable'}
            </div>
          ) : null}
        </div>

        <footer className="card-script-ide__status" data-testid="card-script-status-line">
          <div>
            <span>Python</span>
            <span className={active ? 'is-active' : ''}>{active ? 'Active' : script.enabled ? 'Fallback' : 'Inactive'}</span>
            <span>{validationStatus}</span>
            <span>v{script.version} · {shortHash(script)}</span>
          </div>
          <div>
            <span className={diagnosticCount ? 'has-diagnostics' : ''}>{diagnosticCount} diagnostics</span>
            <button type="button" disabled={featureStatus !== 'ready'} onClick={() => triggerEditorAction('editor.action.gotoLine')}>
              Ln {cursorPosition.line}, Col {cursorPosition.column}
            </button>
          </div>
        </footer>
      </div>

      <div className="card-script-ide__actions">
        <button type="button" onClick={() => void validate()} disabled={validationBusy || toolStatus !== 'ready'}>
          {validationBusy ? 'Validating…' : 'Validate draft'}
        </button>
        {!script.source.trim() ? (
          <>
            <button type="button" onClick={() => onChange(changedSourceDraft(script, STARTER_SCRIPT, runtimeKind))}>
              Insert bounded starter
            </button>
            {SCRIPT_EXAMPLES.map((example) => (
              <button
                key={example.id}
                type="button"
                title={example.description}
                onClick={() => onChange(changedSourceDraft(script, example.source, runtimeKind))}
              >
                Insert {example.label} example
              </button>
            ))}
          </>
        ) : null}
        <span className={toolStatus === 'failed' ? 'is-error' : ''}>
          {toolStatus === 'loading' ? 'Loading Card tool definitions…'
            : toolStatus === 'failed' ? toolError
              : `${toolReferences.length} executable handles ready`}
        </span>
      </div>

      {validationError ? <div role="alert" className="card-script-ide__diagnostics">{validationError}</div> : null}
      {validationErrors.length ? (
        <div role="alert" data-testid="card-script-validation-errors" className="card-script-ide__diagnostics">
          {validationErrors.join(' · ')}. Saving preserves this source and the next Run visibly falls back to selected MCP tools.
        </div>
      ) : null}
      {script.sourceHash ? (
        <details className="card-script-ide__receipt">
          <summary>Compiled identity and bounds</summary>
          <pre>{JSON.stringify({
            sourceHash: script.sourceHash,
            compiledHash: script.compiledHash,
            paletteFingerprint: script.paletteFingerprint,
            compiled: script.compiled,
            nativeSupport: script.nativeSupport,
          }, null, 2)}</pre>
        </details>
      ) : null}
    </section>
  );
}

export {
  SCRIPT_EXAMPLES,
  STARTER_SCRIPT,
  SCRIPT_SECTIONS,
  TOOL_MODE_COMPLETIONS,
  editorOptions,
  symbolAtPosition,
};
