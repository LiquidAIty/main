import {
  SCRIPT_SECTIONS,
  STARTER_SCRIPT,
  TOOL_MODE_COMPLETIONS,
  schemaText,
  symbolAtPosition,
  type ScriptToolReference,
} from './cardScriptLanguage';
import type {
  CardScriptHeader,
  MonacoApi,
  MonacoDisposable,
  MonacoModel,
} from './cardScriptMonaco';

type CardScriptLanguageProviderInputs = {
  monaco: MonacoApi;
  sourceModel: MonacoModel;
  getTools: () => ScriptToolReference[];
  getHeader: () => CardScriptHeader | null;
  getHeaderModel: () => MonacoModel | null;
};

/** Register the Card Python language providers for one source model. */
export function registerCardScriptLanguageProviders({
  monaco,
  sourceModel,
  getTools,
  getHeader,
  getHeaderModel,
}: CardScriptLanguageProviderInputs): MonacoDisposable[] {
  const disposables: MonacoDisposable[] = [];
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
        const authorized = getTools().some((reference) => reference.canonicalId === canonicalId);
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
      const toolSuggestions = getTools()
        .filter((reference) => !fragment || reference.canonicalId.includes(fragment))
        .map((reference, index) => ({
          label: reference.canonicalId,
          kind: monaco.languages.CompletionItemKind.Function,
          detail: `${reference.access} · selected Card tool`,
          documentation: {
            value: `**${reference.canonicalId}**\n\n${reference.description || ''}\n\n\`\`\`json\n${schemaText(reference)}\n\`\`\``,
          },
          insertText: handleMatch
            ? reference.canonicalId
            : `tools.call("${reference.canonicalId}", **\${1:{}})`,
          insertTextRules: handleMatch
            ? monaco.languages.CompletionItemInsertTextRule.None
            : monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
          sortText: String(index).padStart(6, '0'),
        }));
      if (handleMatch) return { suggestions: toolSuggestions };
      const headerSuggestions = Object.entries(getHeader()?.definitions || {}).map(
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
          tags: definition.selected
            ? undefined
            : [monaco.languages.CompletionItemTag.Deprecated],
        }),
      );
      return { suggestions: [
        {
          label: 'CARD_SCRIPT contract',
          kind: monaco.languages.CompletionItemKind.Snippet,
          detail: 'Bounded Card Script',
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
      const target = symbol ? getHeader()?.definitions[symbol] : null;
      const headerModel = getHeaderModel();
      if (!target || !headerModel) return null;
      return {
        uri: headerModel.uri,
        range: new monaco.Range(
          target.line,
          1,
          target.line,
          headerModel.getLineMaxColumn(target.line),
        ),
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
      const target = symbol ? getHeader()?.definitions[symbol] : null;
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
      const beforeCursor = currentModel.getLineContent(position.lineNumber)
        .slice(0, position.column - 1);
      const match = /tools\.call\(\s*["']([^"']+)["']\s*,?/.exec(beforeCursor);
      const reference = getTools().find((item) => item.canonicalId === match?.[1]);
      if (!reference) return null;
      return {
        value: {
          activeParameter: beforeCursor.trimEnd().endsWith(',') ? 1 : 0,
          activeSignature: 0,
          signatures: [{
            label: `tools.call("${reference.canonicalId}", arguments: dict)`,
            documentation: `${reference.access} · ${reference.description || 'selected Card tool'}\n\n${schemaText(reference)}`,
            parameters: [
              {
                label: `"${reference.canonicalId}"`,
                documentation: 'Canonical selected tool ID.',
              },
              {
                label: 'arguments: dict',
                documentation: 'Arguments validated against the live tool schema.',
              },
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
          range: new monaco.Range(
            lineNumber,
            1,
            endLine,
            currentModel.getLineMaxColumn(endLine),
          ),
          selectionRange: new monaco.Range(
            lineNumber,
            1,
            lineNumber,
            currentModel.getLineMaxColumn(lineNumber),
          ),
          children: [],
        });
      }
      return symbols;
    },
  }));
  return disposables;
}
