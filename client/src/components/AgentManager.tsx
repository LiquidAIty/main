import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  AgentCardRuntimeOptions,
  AgentCardRuntimeType,
  RuntimeBinding,
} from '../types/agentgraph';

type ModelOption = { key: string; label: string; providerModelId: string };
export type ToolDescriptor = {
  name: string;
  title?: string;
  description?: string;
  capability?: {
    runtimeCompatibility?: string[];
    assignableRuntimeBindings?: string[];
    assignableRuntimeTypes?: string[];
    cardAssignable?: boolean;
  };
};
export type DisplayedToolRow = ToolDescriptor & {
  availability: 'available' | 'stale' | 'incompatible' | 'not_assignable';
};

function isToolAssignable(
  tool: ToolDescriptor,
  runtimeBinding: RuntimeBinding | '' | null,
  runtimeType: AgentCardRuntimeType | null,
): boolean {
  if (tool.capability?.cardAssignable !== true) return false;
  const bindings = tool.capability.assignableRuntimeBindings || [];
  const runtimeTypes = tool.capability.assignableRuntimeTypes || [];
  return (
    (Boolean(runtimeBinding) && bindings.includes(String(runtimeBinding))) ||
    (Boolean(runtimeType) && runtimeTypes.includes(String(runtimeType)))
  );
}

export function buildDisplayedToolRows(
  toolCatalog: ToolDescriptor[],
  savedToolNames: string[],
  runtimeBinding: RuntimeBinding | '' | null,
  runtimeType: AgentCardRuntimeType | null,
): DisplayedToolRow[] {
  const catalogByName = new Map<string, ToolDescriptor[]>();
  for (const tool of toolCatalog) {
    const descriptors = catalogByName.get(tool.name) || [];
    descriptors.push(tool);
    catalogByName.set(tool.name, descriptors);
  }
  const savedNames = Array.from(new Set(savedToolNames));
  const savedNameSet = new Set(savedNames);
  const rows: DisplayedToolRow[] = savedNames.map((name) => {
    const registered = catalogByName.get(name) || [];
    if (!registered.length) return { name, availability: 'stale' };
    const assignable = registered.find((tool) =>
      isToolAssignable(tool, runtimeBinding, runtimeType),
    );
    if (assignable) return { ...assignable, availability: 'available' };
    const display = registered[0];
    if (registered.every((tool) => tool.capability?.cardAssignable !== true)) {
      return { ...display, availability: 'not_assignable' };
    }
    return { ...display, availability: 'incompatible' };
  });

  for (const tool of toolCatalog) {
    if (
      !isToolAssignable(tool, runtimeBinding, runtimeType) ||
      savedNameSet.has(tool.name)
    ) continue;
    rows.push({ ...tool, availability: 'available' });
    savedNameSet.add(tool.name);
  }

  return rows;
}

export function toggleSavedToolAssignment(
  savedToolNames: string[],
  name: string,
  checked: boolean,
): string[] {
  if (checked) return savedToolNames.includes(name) ? savedToolNames : [...savedToolNames, name];
  return savedToolNames.filter((savedName) => savedName !== name);
}
type AgentType =
  | 'agent_builder'
  | 'llm_chat'
  | 'kg_ingest'
  | 'knowgraph'
  | 'neo4j'
  | 'research_agent';

interface AgentManagerProps {
  cardId?: string;
  agentType: AgentType;
  activeTab: string;
  promptPreviewPlanText?: string;
  onGraphRefresh?: () => void;
  onLastRun?: (lastRun: {
    agentType: AgentType;
    request: any;
    responseOrError: any;
    elapsedMs: number;
    provider?: string | null;
    model?: string | null;
    endpoint?: string | null;
    requestId?: string | null;
    finishReason?: string | null;
    usage?: any | null;
  }) => void;
  promptTestInput?: string;
  onChangePromptTestInput?: (value: string) => void;
  onRunCard?: () => void;
  runBusy?: boolean;
  runDisabled?: boolean;
  runResult?: StandaloneCardTestResult | null;
  saveDeckStatusMessage?: string | null;
  openDeckRevision?: string | null;
  cardName?: string;
  cardSubtext?: string;
  onChangeCardName?: (value: string) => void;
  onChangeCardSubtext?: (value: string) => void;
  localConfig?: AgentManagerLocalConfig | null;
  onSaveLocalConfig?: (config: AgentManagerLocalConfig) => void | Promise<void>;
}

export type AgentManagerLocalConfig = {
  runtime_binding?: RuntimeBinding | null;
  runtime_type?: AgentCardRuntimeType | null;
  runtime_options?: AgentCardRuntimeOptions | null;
  parent_graph_id?: string | null;
  provider?: 'openai' | 'openrouter' | 'local_openai_compatible' | '' | null;
  model_key?: string | null;
  reasoning_effort?: 'low' | 'medium' | 'high' | 'xhigh' | null;
  temperature?: number | null;
  max_tokens?: number | null;
  prompt_template?: string | null;
  tools?: unknown[];
};

export type StandaloneCardTestResult = {
  status: string;
  output: string;
  error: string | null;
  toolCallCount?: number | null;
  tools: string[];
  provider?: string | null;
  model?: string | null;
  runtimeType?: string | null;
};

type SaveCardStatus = 'idle' | 'saving' | 'saved' | 'failed';

function parsePromptTemplate(template: string): {
  role: string;
  goal: string;
  constraints: string;
  ioSchema: string;
  memoryPolicy: string;
} {
  if (!template || template.trim() === '') {
    return { role: '', goal: '', constraints: '', ioSchema: '', memoryPolicy: '' };
  }
  const normalizedTemplate = template.replace(/\r\n/g, '\n');

  if (!normalizedTemplate.includes('[ROLE]')) {
    return {
      role: template,
      goal: '',
      constraints: '',
      ioSchema: '',
      memoryPolicy: '',
    };
  }

  const parsed = {
    role: '',
    goal: '',
    constraints: '',
    ioSchema: '',
    memoryPolicy: '',
  };
  const tagRegex = /\[(ROLE|GOAL|CONSTRAINTS|IO_SCHEMA|MEMORY_POLICY)\]/gi;
  const tags: Array<{ key: string; start: number; end: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(normalizedTemplate)) !== null) {
    tags.push({
      key: String(match[1] || '').toUpperCase(),
      start: match.index,
      end: tagRegex.lastIndex,
    });
  }
  for (let index = 0; index < tags.length; index += 1) {
    const current = tags[index];
    const next = tags[index + 1];
    const value = normalizedTemplate
      .slice(current.end, next ? next.start : normalizedTemplate.length)
      .trim();
    if (current.key === 'ROLE') parsed.role = value;
    else if (current.key === 'GOAL') parsed.goal = value;
    else if (current.key === 'CONSTRAINTS') parsed.constraints = value;
    else if (current.key === 'IO_SCHEMA') parsed.ioSchema = value;
    else if (current.key === 'MEMORY_POLICY') parsed.memoryPolicy = value;
  }

  return parsed;
}

function serializePromptFields(fields: {
  role: string;
  goal: string;
  constraints: string;
  ioSchema: string;
  memoryPolicy: string;
}): string {
  return `# LIQUIDAITY_PROMPT_V1
[ROLE]
${fields.role}

[GOAL]
${fields.goal}

[CONSTRAINTS]
${fields.constraints}

[IO_SCHEMA]
${fields.ioSchema}

[MEMORY_POLICY]
${fields.memoryPolicy}`;
}

function parseListText(value: string): string[] {
  const text = String(value || '').trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean);
    }
  } catch {
    // fall back to newline/comma parsing
  }
  return text
    .split(/[\r\n,]+/)
    .map((entry) => entry.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean);
}

export function buildActiveAgentManagerLocalConfig(input: {
  runtimeBinding: RuntimeBinding | '';
  provider: 'openai' | 'openrouter' | '';
  modelKey: string;
  reasoningEffort: 'low' | 'medium' | 'high' | 'xhigh' | '';
  temperature: number | '';
  maxTokens: number | '';
  promptTemplate: string;
  toolsText: string;
}): AgentManagerLocalConfig {
  return {
    runtime_binding: input.runtimeBinding || null,
    provider: input.provider,
    model_key: input.modelKey || null,
    reasoning_effort: input.reasoningEffort || null,
    temperature: typeof input.temperature === 'number' ? input.temperature : null,
    max_tokens: typeof input.maxTokens === 'number' ? input.maxTokens : null,
    prompt_template: input.promptTemplate,
    tools: parseListText(input.toolsText),
  };
}

export function AgentManager({
  cardId = '',
  activeTab,
  promptTestInput,
  onChangePromptTestInput,
  onRunCard,
  runBusy = false,
  runDisabled = false,
  runResult = null,
  saveDeckStatusMessage = null,
  openDeckRevision = null,
  cardName = '',
  cardSubtext = '',
  onChangeCardName,
  onChangeCardSubtext,
  localConfig,
  onSaveLocalConfig,
}: AgentManagerProps) {
  const isLocalConfigMode = Boolean(localConfig && onSaveLocalConfig);
  const [saveCardStatus, setSaveCardStatus] = useState<SaveCardStatus>('idle');
  const [saveCardErrorMessage, setSaveCardErrorMessage] = useState<string | null>(null);
  const saveCardResetTimerRef = useRef<number | null>(null);
  const saveCardStatusRef = useRef<SaveCardStatus>('idle');
  saveCardStatusRef.current = saveCardStatus;
  const [runtimeBinding, setRuntimeBinding] = useState<RuntimeBinding | ''>('');
  const [cardNameDraft, setCardNameDraft] = useState(cardName);
  const [cardSubtextDraft, setCardSubtextDraft] = useState(cardSubtext);
  const [provider, setProvider] = useState<'openai' | 'openrouter' | ''>('');
  const [modelKey, setModelKey] = useState('');
  const [reasoningEffort, setReasoningEffort] = useState<
    'low' | 'medium' | 'high' | 'xhigh' | ''
  >('');
  const [modelsByProvider, setModelsByProvider] = useState<Record<string, ModelOption[]>>({});
  const [toolCatalog, setToolCatalog] = useState<ToolDescriptor[]>([]);
  const [temperature, setTemperature] = useState<number | ''>('');
  const [maxTokens, setMaxTokens] = useState<number | ''>('');
  const [promptText, setPromptText] = useState('');
  const [promptParts, setPromptParts] = useState({
    role: '',
    goal: '',
    constraints: '',
    ioSchema: '',
    memoryPolicy: '',
  });
  const [promptPartsTouched, setPromptPartsTouched] = useState(false);
  const [toolsText, setToolsText] = useState('');
  const draftDirtyRef = useRef(false);

  useEffect(() => {
    setCardNameDraft(cardName);
    setCardSubtextDraft(cardSubtext);
  }, [cardId, cardName, cardSubtext]);

  useEffect(() => {
    let active = true;
    void fetch('/api/config/models')
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(String(payload?.error || `Model registry unavailable (HTTP ${response.status})`));
        const toOptions = (value: unknown): ModelOption[] => {
          if (!Array.isArray(value)) return [];
          return value.flatMap((entry) => {
            if (!entry || typeof entry !== 'object') return [];
            const item = entry as Record<string, unknown>;
            const key = String(item.key || '').trim();
            const label = String(item.label || key).trim();
            const providerModelId = String(item.id || key).trim();
            return key ? [{ key, label, providerModelId }] : [];
          });
        };
        if (active) {
          setModelsByProvider({
            openai: toOptions(payload?.openai?.options),
            openrouter: toOptions(payload?.openrouter?.options),
          });
        }
      })
      .catch(() => {
        if (active) setModelsByProvider({});
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void fetch('/api/coder/tool-library')
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok || !payload?.ok || !Array.isArray(payload.tools)) {
          throw new Error('Tool catalog unavailable');
        }
        if (active) setToolCatalog(payload.tools as ToolDescriptor[]);
      })
      .catch(() => {
        if (active) setToolCatalog([]);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!isLocalConfigMode || !localConfig) return;
    draftDirtyRef.current = false;
    saveRevisionAtStartRef.current = null;
    if (saveCardResetTimerRef.current != null) {
      window.clearTimeout(saveCardResetTimerRef.current);
      saveCardResetTimerRef.current = null;
    }
    setSaveCardStatus('idle');
    setSaveCardErrorMessage(null);
    setRuntimeBinding(localConfig.runtime_binding || '');
    setProvider(
      localConfig.provider === 'openai' || localConfig.provider === 'openrouter'
        ? localConfig.provider
        : '',
    );
    setModelKey(localConfig.model_key || '');
    setReasoningEffort(localConfig.reasoning_effort || '');
    setTemperature(typeof localConfig.temperature === 'number' ? localConfig.temperature : '');
    setMaxTokens(typeof localConfig.max_tokens === 'number' ? localConfig.max_tokens : '');
    setPromptText(localConfig.prompt_template || '');
    setPromptParts(parsePromptTemplate(localConfig.prompt_template || ''));
    setPromptPartsTouched(false);
    setToolsText(
      Array.isArray(localConfig.tools)
        ? localConfig.tools
            .filter((entry): entry is string => typeof entry === 'string')
            .join('\n')
        : '',
    );
  }, [isLocalConfigMode, localConfig]);

  const markDraftDirty = () => {
    draftDirtyRef.current = true;
  };

  const runSaveConfig = useCallback(async () => {
    if (!isLocalConfigMode || !localConfig || !onSaveLocalConfig) return;
    if (saveCardStatus === 'saving') return;
    const editedConfig = buildActiveAgentManagerLocalConfig({
      runtimeBinding,
      provider,
      modelKey,
      reasoningEffort,
      temperature,
      maxTokens,
      promptTemplate: promptPartsTouched ? serializePromptFields(promptParts) : promptText,
      toolsText,
    });
    const payload = {
      ...localConfig,
      ...editedConfig,
      provider:
        provider ||
        (localConfig.provider === 'local_openai_compatible'
          ? 'local_openai_compatible'
          : editedConfig.provider),
    };
    if (saveCardResetTimerRef.current != null) {
      window.clearTimeout(saveCardResetTimerRef.current);
      saveCardResetTimerRef.current = null;
    }
    setSaveCardStatus('saving');
    setSaveCardErrorMessage(null);
    try {
      await Promise.resolve(onSaveLocalConfig(payload));
      // Persistence readback is confirmed downstream by the deck save (CAS +
      // expectedRevision). Watch openDeckRevision / saveDeckStatusMessage; if a
      // failure/conflict surfaces, flip to failed; a revision advance means the
      // server confirmed the write. A short fallback covers the no-op save where
      // the fingerprint is unchanged and no new revision is minted.
    } catch (error) {
      setSaveCardStatus('failed');
      setSaveCardErrorMessage(
        error instanceof Error && error.message ? error.message : 'Save failed.',
      );
    }
  }, [
    isLocalConfigMode,
    localConfig,
    onSaveLocalConfig,
    saveCardStatus,
    runtimeBinding,
    provider,
    modelKey,
    reasoningEffort,
    temperature,
    maxTokens,
    promptPartsTouched,
    promptParts,
    promptText,
    toolsText,
  ]);

  const saveRevisionAtStartRef = useRef<string | null>(null);
  useEffect(() => {
    if (saveCardStatus !== 'saving') return;
    if (saveRevisionAtStartRef.current === null) {
      saveRevisionAtStartRef.current = openDeckRevision ?? null;
    }
    const failedSurface =
      saveDeckStatusMessage &&
      /(could not save|deck_conflict|failed)/i.test(saveDeckStatusMessage)
        ? saveDeckStatusMessage
        : null;
    if (failedSurface) {
      setSaveCardStatus('failed');
      setSaveCardErrorMessage(failedSurface);
      return;
    }
    if (openDeckRevision && openDeckRevision !== saveRevisionAtStartRef.current) {
      setSaveCardStatus('saved');
      if (saveCardResetTimerRef.current != null) {
        window.clearTimeout(saveCardResetTimerRef.current);
      }
      saveCardResetTimerRef.current = window.setTimeout(() => {
        setSaveCardStatus('idle');
        saveCardResetTimerRef.current = null;
      }, 1500);
    }
  }, [saveCardStatus, openDeckRevision, saveDeckStatusMessage]);

  // No-op / same-fingerprint saves won't mint a new revision; if no failure
  // surfaced and the canonical config save resolved, settle on saved.
  useEffect(() => {
    if (saveCardStatus !== 'saving') return;
    const timer = window.setTimeout(() => {
      if (saveCardStatusRef.current !== 'saving') return;
      if (
        saveDeckStatusMessage &&
        /(could not save|deck_conflict|failed)/i.test(saveDeckStatusMessage)
      ) {
        setSaveCardStatus('failed');
        setSaveCardErrorMessage(saveDeckStatusMessage);
        return;
      }
      setSaveCardStatus('saved');
      saveCardResetTimerRef.current = window.setTimeout(() => {
        setSaveCardStatus('idle');
        saveCardResetTimerRef.current = null;
      }, 1500);
    }, 1200);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveCardStatus, saveDeckStatusMessage]);

  useEffect(() => {
    if (!isLocalConfigMode || !localConfig || !onSaveLocalConfig || !draftDirtyRef.current) {
      return;
    }
    draftDirtyRef.current = false;
    const editedConfig = buildActiveAgentManagerLocalConfig({
      runtimeBinding,
      provider,
      modelKey,
      reasoningEffort,
      temperature,
      maxTokens,
      promptTemplate: promptPartsTouched ? serializePromptFields(promptParts) : promptText,
      toolsText,
    });
    void onSaveLocalConfig({
      ...localConfig,
      ...editedConfig,
      provider:
        provider ||
        (localConfig.provider === 'local_openai_compatible'
          ? 'local_openai_compatible'
          : editedConfig.provider),
    });
  }, [
    isLocalConfigMode,
    localConfig,
    onSaveLocalConfig,
    runtimeBinding,
    provider,
    modelKey,
    reasoningEffort,
    temperature,
    maxTokens,
    promptText,
    promptParts,
    promptPartsTouched,
    toolsText,
  ]);

  const availableModels = provider ? modelsByProvider[provider] || [] : [];
  const savedToolNames = parseListText(toolsText);
  const displayedToolRows = buildDisplayedToolRows(
    toolCatalog,
    savedToolNames,
    runtimeBinding,
    localConfig?.runtime_type || null,
  );
  const toggleTool = (name: string, checked: boolean) => {
    setToolsText(toggleSavedToolAssignment(savedToolNames, name, checked).join('\n'));
    markDraftDirty();
  };

  const sectionBody = (() => {
    if (activeTab === 'Prompt') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {onChangeCardName || onChangeCardSubtext ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {onChangeCardName ? (
                <div>
                  <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
                    Name
                  </label>
                  <input
                    type="text"
                    value={cardNameDraft}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setCardNameDraft(nextValue);
                      onChangeCardName(nextValue);
                    }}
                    placeholder="Enter agent name"
                    style={{
                      width: '100%',
                      padding: 8,
                      background: '#2B2B2B',
                      color: '#FFF',
                      border: '1px solid #3A3A3A',
                      borderRadius: 8,
                    }}
                  />
                </div>
              ) : null}
              {onChangeCardSubtext ? (
                <div>
                  <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
                    Description
                  </label>
                  <input
                    type="text"
                    value={cardSubtextDraft}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setCardSubtextDraft(nextValue);
                      onChangeCardSubtext(nextValue);
                    }}
                    placeholder="Enter agent description"
                    style={{
                      width: '100%',
                      padding: 8,
                      background: '#2B2B2B',
                      color: '#FFF',
                      border: '1px solid #3A3A3A',
                      borderRadius: 8,
                    }}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
          <div>
            <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
              Role
            </label>
            <textarea
              value={promptParts.role}
              onChange={(event) => {
                      setPromptParts((current) => ({ ...current, role: event.target.value }));
                      setPromptPartsTouched(true);
                markDraftDirty();
              }}
              rows={5}
              style={{
                width: '100%',
                padding: 10,
                background: '#2B2B2B',
                color: '#FFF',
                border: '1px solid #3A3A3A',
                borderRadius: 8,
                fontFamily: 'monospace',
                fontSize: 13,
                resize: 'vertical',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
              Goal
            </label>
            <textarea
              value={promptParts.goal}
              onChange={(event) => {
                setPromptParts((current) => ({ ...current, goal: event.target.value }));
                setPromptPartsTouched(true);
                markDraftDirty();
              }}
              rows={5}
              style={{
                width: '100%',
                padding: 10,
                background: '#2B2B2B',
                color: '#FFF',
                border: '1px solid #3A3A3A',
                borderRadius: 8,
                fontFamily: 'monospace',
                fontSize: 13,
                resize: 'vertical',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
              Constraints
            </label>
            <textarea
              value={promptParts.constraints}
              onChange={(event) => {
                setPromptParts((current) => ({ ...current, constraints: event.target.value }));
                setPromptPartsTouched(true);
                markDraftDirty();
              }}
              rows={5}
              style={{
                width: '100%',
                padding: 10,
                background: '#2B2B2B',
                color: '#FFF',
                border: '1px solid #3A3A3A',
                borderRadius: 8,
                fontFamily: 'monospace',
                fontSize: 13,
                resize: 'vertical',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
              IO Schema
            </label>
            <textarea
              value={promptParts.ioSchema}
              onChange={(event) => {
                setPromptParts((current) => ({ ...current, ioSchema: event.target.value }));
                setPromptPartsTouched(true);
                markDraftDirty();
              }}
              rows={5}
              style={{
                width: '100%',
                padding: 10,
                background: '#2B2B2B',
                color: '#FFF',
                border: '1px solid #3A3A3A',
                borderRadius: 8,
                fontFamily: 'monospace',
                fontSize: 13,
                resize: 'vertical',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
              Memory Policy
            </label>
            <textarea
              value={promptParts.memoryPolicy}
              onChange={(event) => {
                setPromptParts((current) => ({ ...current, memoryPolicy: event.target.value }));
                setPromptPartsTouched(true);
                markDraftDirty();
              }}
              rows={5}
              style={{
                width: '100%',
                padding: 10,
                background: '#2B2B2B',
                color: '#FFF',
                border: '1px solid #3A3A3A',
                borderRadius: 8,
                fontFamily: 'monospace',
                fontSize: 13,
                resize: 'vertical',
              }}
            />
          </div>

        </div>
      );
    }

    if (activeTab === 'Runtime') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
                Provider
              </label>
              <select
                value={provider}
                onChange={(event) => {
                  const nextProvider = event.target.value as 'openai' | 'openrouter' | '';
                  setProvider(nextProvider);
                  const nextModels = nextProvider ? modelsByProvider[nextProvider] || [] : [];
                  setModelKey((current) =>
                    nextModels.some((model) => model.key === current)
                      ? current
                      : nextModels[0]?.key || '',
                  );
                  markDraftDirty();
                }}
                style={{
                  width: '100%',
                  padding: 8,
                  background: '#2B2B2B',
                  color: '#FFF',
                  border: '1px solid #3A3A3A',
                  borderRadius: 8,
                }}
              >
                <option value="">Unset</option>
                <option value="openai">OpenAI Account</option>
                <option value="openrouter">OpenRouter</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
                Model
              </label>
              <select
                value={modelKey}
                onChange={(event) => {
                  setModelKey(event.target.value);
                  markDraftDirty();
                }}
                style={{
                  width: '100%',
                  padding: 8,
                  background: '#2B2B2B',
                  color: '#FFF',
                  border: '1px solid #3A3A3A',
                  borderRadius: 8,
                }}
              >
                <option value="">Select model</option>
                {availableModels.map((model) => (
                  <option key={model.key} value={model.key}>
                    {model.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
                Reasoning
              </label>
              <select
                value={reasoningEffort}
                onChange={(event) => {
                  setReasoningEffort(
                    event.target.value as 'low' | 'medium' | 'high' | 'xhigh' | '',
                  );
                  markDraftDirty();
                }}
                style={{
                  width: '100%',
                  padding: 8,
                  background: '#2B2B2B',
                  color: '#FFF',
                  border: '1px solid #3A3A3A',
                  borderRadius: 8,
                }}
              >
                <option value="">Model default</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="xhigh">Extra high</option>
              </select>
            </div>

          </div>
        </div>
      );
    }

    if (activeTab === 'Tools') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ color: '#E0DED5', fontSize: 12, fontWeight: 600 }}>
            Tools for this card
          </div>
          {displayedToolRows.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {displayedToolRows.map((tool) => (
                <label
                  key={tool.name}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '18px 1fr',
                    gap: 8,
                    alignItems: 'start',
                    padding: '7px 8px',
                    border: '1px solid #3A4A4F',
                    borderRadius: 6,
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={savedToolNames.includes(tool.name)}
                    onChange={(event) => {
                      if (!event.target.checked || tool.availability === 'available') {
                        toggleTool(tool.name, event.target.checked);
                      }
                    }}
                    aria-label={`Include ${tool.title || tool.name}`}
                  />
                  <span>
                    <span style={{ display: 'block', color: '#D5E4E8', fontSize: 11 }}>
                      {tool.title || tool.name}
                    </span>
                    <span style={{ display: 'block', color: '#80969F', fontSize: 10 }}>
                      {tool.name}
                      {tool.description ? ` · ${tool.description}` : ''}
                      {tool.availability === 'stale' ? ' · Missing from current catalogs' : ''}
                      {tool.availability === 'incompatible' ? ' · Incompatible with this card runtime' : ''}
                      {tool.availability === 'not_assignable' ? ' · Not card-assignable' : ''}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <div style={{ color: '#91A9B8', fontSize: 11 }}>
              {runtimeBinding || localConfig?.runtime_type
                ? 'No tools are available for this card yet.'
                : 'This card has no scoped graph tool set.'}
            </div>
          )}
        </div>
      );
    }

    return null;
  })();

  if (!isLocalConfigMode || !localConfig || !onSaveLocalConfig) {
    return (
      <div
        style={{
          padding: '12px 14px',
          borderRadius: 8,
          border: '1px solid #3A3A3A',
          background: '#1F1F1F',
          color: '#E0DED5',
          fontSize: 12,
        }}
      >
        Legacy Agent Manager has been disconnected from the active Builder runtime.
      </div>
    );
  }

  if (!sectionBody) {
    return null;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {sectionBody}

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          padding: '10px 12px',
          borderRadius: 8,
          border: '1px solid #3A4A4F',
          background: '#222625',
        }}
      >
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => void runSaveConfig()}
            disabled={saveCardStatus === 'saving' || !onSaveLocalConfig}
            aria-busy={saveCardStatus === 'saving'}
            data-testid="agent-manager-save"
            style={{
              padding: '8px 14px',
              background:
                saveCardStatus === 'saving'
                  ? '#3A3A3A'
                  : saveCardStatus === 'saved'
                    ? '#1D3A2F'
                    : saveCardStatus === 'failed'
                      ? '#4A2525'
                      : '#4FA2AD',
              color: '#FFF',
              border: '1px solid #3A4A4F',
              borderRadius: 8,
              cursor: saveCardStatus === 'saving' ? 'progress' : 'pointer',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {saveCardStatus === 'saving' ? 'Saving…' : saveCardStatus === 'saved' ? 'Saved' : 'Save'}
          </button>
          {saveCardStatus === 'failed' && saveCardErrorMessage ? (
            <span role="alert" data-testid="agent-manager-save-error" style={{ color: '#FFA2A2', fontSize: 11.5 }}>
              {saveCardErrorMessage}
            </span>
          ) : null}
          {saveDeckStatusMessage ? (
            <span style={{ color: '#80969F', fontSize: 11 }}>{saveDeckStatusMessage}</span>
          ) : null}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ color: '#E0DED5', fontSize: 12, fontWeight: 600 }}>Run input</label>
          <textarea
            aria-label="Run input"
            value={promptTestInput || ''}
            onChange={(event) => onChangePromptTestInput?.(event.target.value)}
            rows={5}
            style={{
              width: '100%',
              padding: 10,
              background: '#2B2B2B',
              color: '#FFF',
              border: '1px solid #3A3A3A',
              borderRadius: 8,
              fontFamily: 'monospace',
              fontSize: 12,
              resize: 'vertical',
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onRunCard}
              disabled={runDisabled || runBusy || !String(promptTestInput || '').trim()}
              aria-busy={runBusy}
              data-testid="agent-manager-run"
              style={{
                padding: '8px 14px',
                background: runBusy ? '#3A3A3A' : '#4FA2AD',
                color: '#FFF',
                border: '1px solid #3A4A4F',
                borderRadius: 8,
                cursor:
                  runDisabled || runBusy || !String(promptTestInput || '').trim()
                    ? 'not-allowed'
                    : 'pointer',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {runBusy ? 'Running…' : 'Run'}
            </button>
          </div>
        </div>

        {runResult ? (
          <div
            data-testid="agent-manager-run-result"
            style={{ display: 'grid', gap: 6, fontSize: 11.5 }}
          >
            <div style={{ color: '#D5E4E8' }}>
              Status: {runResult.status || 'completed'}
              {runResult.provider || runResult.model || runResult.runtimeType
                ? ` · ${[runResult.provider, runResult.model, runResult.runtimeType]
                    .filter(Boolean)
                    .join(' · ')}`
                : ''}
            </div>
            {runResult.tools.length > 0 ? (
              <div style={{ color: '#80969F' }}>
                Tools granted: {runResult.tools.join(', ')}
              </div>
            ) : null}
            {runResult.toolCallCount !== undefined && runResult.toolCallCount !== null ? (
              <div style={{ color: '#80969F' }}>Tool calls: {runResult.toolCallCount}</div>
            ) : null}
            {runResult.output ? (
              <pre
                style={{
                  margin: 0,
                  padding: 8,
                  background: '#1B1B1B',
                  color: '#D9E4E8',
                  borderRadius: 6,
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'anywhere',
                  maxHeight: 240,
                  overflowY: 'auto',
                }}
              >
                {runResult.output}
              </pre>
            ) : null}
            {runResult.error ? (
              <div role="alert" style={{ color: '#FFA2A2' }}>
                {runResult.error}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
