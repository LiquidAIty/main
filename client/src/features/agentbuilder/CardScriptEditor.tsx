import { useEffect, useMemo, useRef, useState } from 'react';

import {
  SCRIPT_EXAMPLES,
  STARTER_SCRIPT,
  changedSourceDraft,
  type CardScript,
  type ScriptToolReference,
} from './cardScriptLanguage';
import {
  acquireHeaderModel,
  editorOptions,
  loadMonaco,
  loadMonacoFeatures,
  markerForError,
  releaseHeaderModel,
  type CardScriptHeader,
  type MonacoApi,
  type MonacoDisposable,
  type MonacoEditor,
  type MonacoModel,
  type MonacoViewState,
} from './cardScriptMonaco';
import { registerCardScriptLanguageProviders } from './cardScriptMonacoProviders';
import './CardScriptEditor.css';

let sourceModelSequence = 0;

function shortHash(script: CardScript): string {
  return (script.sourceHash || script.compiledHash || 'unsaved').slice(0, 12);
}

export function CardScriptEditor({
  cardId,
  script,
  selectedTools,
  onChange,
}: {
  cardId: string;
  script: CardScript;
  selectedTools: string[];
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
      selectedIds: selectedTools.join(','),
    });
    return params.toString();
  }, [cardId, selectedTools.join('\u0000')]);

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
    void fetch(`/api/idd/script-tools?${selectionQuery}`, {
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
      const sourceUri = monaco.Uri.parse(
        `inmemory://card-script/source/${encodeURIComponent(cardId)}/${++sourceModelSequence}/card.py`,
      );
      const sourceModel = monaco.editor.createModel(scriptRef.current.source, 'python', sourceUri);
      const editor = monaco.editor.create(hostRef.current, { ...editorOptions(), model: sourceModel });
      editorRef.current = editor;
      sourceModelRef.current = sourceModel;

      const disposables: MonacoDisposable[] = [];
      disposables.push(sourceModel.onDidChangeContent(() => {
        if (applyingExternalValueRef.current) return;
        const current = scriptRef.current;
        const nextSource = sourceModel.getValue();
        if (nextSource === current.source) return;
        onChangeRef.current(changedSourceDraft(current, nextSource));
      }));
      disposables.push(editor.onDidChangeCursorPosition((event) => {
        setCursorPosition({ line: event.position.lineNumber, column: event.position.column });
      }));
      disposables.push(...registerCardScriptLanguageProviders({
        monaco,
        sourceModel,
        getTools: () => toolsRef.current,
        getHeader: () => headerRef.current,
        getHeaderModel: () => headerModelRef.current,
      }));

      setEditorStatus('ready');
      void loadMonacoFeatures().then(() => {
        if (!cancelled) setFeatureStatus('ready');
      }).catch(() => {
        if (!cancelled) setFeatureStatus('failed');
      });
      disposeLoadedEditor = () => {
        for (const disposable of disposables) disposable.dispose();
        monaco.editor.setModelMarkers(sourceModel, 'card-script', []);
        if (headerModelRef.current && headerDecorationsRef.current.length) {
          headerDecorationsRef.current = headerModelRef.current.deltaDecorations(headerDecorationsRef.current, []);
        }
        releaseHeaderModel(headerModelHashRef.current);
        headerModelHashRef.current = null;
        headerModelRef.current = null;
        sourceModelRef.current = null;
        editorRef.current = null;
        monacoRef.current = null;
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
  }, [cardId]);

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
      'card-script',
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
      const response = await fetch('/api/cards/script/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedTools, script }),
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
  const validationStatus = String(validation.status || (script.source.trim() ? 'invalid' : 'blank'));
  const validationLabel = validationStatus === 'valid'
    ? 'Valid'
    : validationStatus === 'blank'
      ? 'Blank'
      : 'Invalid';
  const validationErrors = Array.isArray(validation.errors) ? validation.errors.map(String) : [];
  const diagnosticCount = validationErrors.length + (validationError ? 1 : 0);
  const ungrantedCount = Math.max(0, (header?.catalogToolCount || 0) - toolReferences.length);

  return (
    <section data-testid="card-script-editor" className="card-script-ide">
      <header className="card-script-ide__header">
        <div className="card-script-ide__identity">
          <strong>Card Python</strong>
        </div>
      </header>

      <div role="status" className="card-script-ide__notice">
        Valid saved code is exposed to Hermes as one compact <code>card_python</code> tool. Blank or invalid code does nothing; selected tools not wrapped by the recipe stay available.
      </div>

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
            {script.source.trim() && !script.sourceHash ? <span className="card-script-ide__dirty-dot" aria-label="Unvalidated changes" /> : null}
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
            card.pyi <span className="card-script-ide__readonly">read-only</span>
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
            <span className={validationStatus === 'valid' ? 'is-active' : ''}>{validationLabel}</span>
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
            <button type="button" onClick={() => onChange(changedSourceDraft(script, STARTER_SCRIPT))}>
              Insert bounded starter
            </button>
            {SCRIPT_EXAMPLES.map((example) => (
              <button
                key={example.id}
                type="button"
                title={example.description}
                onClick={() => onChange(changedSourceDraft(script, example.source))}
              >
                Insert {example.label} example
              </button>
            ))}
          </>
        ) : null}
        <span className={toolStatus === 'failed' ? 'is-error' : ''}>
          {toolStatus === 'loading' ? 'Loading Card tool definitions…'
            : toolStatus === 'failed' ? toolError
              : `${toolReferences.length} authorized handles available for validation`}
        </span>
      </div>

      {validationError ? <div role="alert" className="card-script-ide__diagnostics">{validationError}</div> : null}
      {validationErrors.length ? (
        <div role="alert" data-testid="card-script-validation-errors" className="card-script-ide__diagnostics">
          {validationErrors.join(' · ')}. Saving preserves this source, but invalid code does not run.
        </div>
      ) : null}
    </section>
  );
}
