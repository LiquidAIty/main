import { useEffect, useMemo, useState } from 'react';

import type {
  AgentCardRuntimeOptions,
  AgentCardRuntimeType,
  RuntimeBinding,
} from '../types/agentgraph';

type AgentType =
  | 'agent_builder'
  | 'llm_chat'
  | 'kg_ingest'
  | 'knowgraph'
  | 'neo4j'
  | 'research_agent';

interface AgentManagerProps {
  projectId?: string;
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
  onRunPromptTest?: () => void;
  promptTestBusy?: boolean;
  promptTestDisabled?: boolean;
  localConfig?: AgentManagerLocalConfig | null;
  onSaveLocalConfig?: (config: AgentManagerLocalConfig) => void | Promise<void>;
  runContext?: AgentCardRunContext | null;
  runContextLoading?: boolean;
  runContextError?: string | null;
}

export type AgentCardRunContext = {
  assignment: {
    assignmentId: string;
    instructionId: string;
    instruction: string;
    state: string;
    correlationId: string;
    contextReferences: Array<{
      referenceId: string;
      referenceType: string;
      required: boolean;
    }>;
    result: {
      resultId: string;
      status: string;
      output?: string | null;
      summary?: string | null;
      errorCode?: string | null;
      errorDetail?: string | null;
      toolEvidence?: Array<Record<string, unknown>>;
    } | null;
    runTrace: {
      runtime?: string | null;
      provider?: string | null;
      modelKey?: string | null;
      providerModelId?: string | null;
      outcome?: string | null;
      state?: string | null;
      errorCode?: string | null;
    };
  } | null;
  deliveredContext: {
    projectionId: string;
    graphViews: Array<{
      viewId: string;
      displayLabel?: string;
      receivingRole?: string;
    }>;
    manifest: {
      manifestHash: string;
      records: Array<{
        authority: string;
        kind: 'node' | 'edge';
        nativeId: string;
        nativeRevision?: string | null;
        sourceId?: string | null;
        targetId?: string | null;
        predicate?: string | null;
        required: boolean;
        deliveryOrder: number;
        representation: string;
        representationHash: string;
        characters: number;
      }>;
      unresolvedReferences: Array<{
        referenceId: string;
        referenceType: string;
        required: boolean;
        reason: string;
      }>;
    };
  } | null;
};

export type AgentManagerLocalConfig = {
  runtime_binding?: RuntimeBinding | null;
  runtime_type?: AgentCardRuntimeType | null;
  runtime_options?: AgentCardRuntimeOptions | null;
  parent_graph_id?: string | null;
  provider?: 'openai' | 'openrouter' | 'local_openai_compatible' | '' | null;
  model_key?: string | null;
  temperature?: number | null;
  max_tokens?: number | null;
  prompt_template?: string | null;
  tools?: unknown[];
  knowledge_sources?: unknown[];
  response_format?: any | null;
};

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

function parseJsonValue(value: string): any | null {
  const text = String(value || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function buildActiveAgentManagerLocalConfig(input: {
  runtimeBinding: RuntimeBinding | '';
  provider: 'openai' | 'openrouter' | '';
  modelKey: string;
  temperature: number | '';
  maxTokens: number | '';
  promptTemplate: string;
  toolsText: string;
  knowledgeText: string;
  responseFormatText: string;
}): AgentManagerLocalConfig {
  return {
    runtime_binding: input.runtimeBinding || null,
    provider: input.provider,
    model_key: input.modelKey || null,
    temperature: typeof input.temperature === 'number' ? input.temperature : null,
    max_tokens: typeof input.maxTokens === 'number' ? input.maxTokens : null,
    prompt_template: input.promptTemplate,
    tools: parseListText(input.toolsText),
    knowledge_sources: parseListText(input.knowledgeText),
    response_format: parseJsonValue(input.responseFormatText),
  };
}

export function AgentManager({
  activeTab,
  promptTestInput,
  onChangePromptTestInput,
  onRunPromptTest,
  promptTestBusy = false,
  promptTestDisabled = false,
  localConfig,
  onSaveLocalConfig,
  runContext,
  runContextLoading = false,
  runContextError = null,
}: AgentManagerProps) {
  const isLocalConfigMode = Boolean(localConfig && onSaveLocalConfig);
  const [runtimeBinding, setRuntimeBinding] = useState<RuntimeBinding | ''>('');
  const [provider, setProvider] = useState<'openai' | 'openrouter' | ''>('');
  const [modelKey, setModelKey] = useState('');
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
  const [knowledgeText, setKnowledgeText] = useState('');
  const [responseFormatText, setResponseFormatText] = useState('');
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isLocalConfigMode || !localConfig) return;
    setRuntimeBinding(localConfig.runtime_binding || '');
    setProvider(
      localConfig.provider === 'openai' || localConfig.provider === 'openrouter'
        ? localConfig.provider
        : '',
    );
    setModelKey(localConfig.model_key || '');
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
    setKnowledgeText(
      Array.isArray(localConfig.knowledge_sources)
        ? localConfig.knowledge_sources
            .filter((entry): entry is string => typeof entry === 'string')
            .join('\n')
        : '',
    );
    setResponseFormatText(
      localConfig.response_format ? JSON.stringify(localConfig.response_format, null, 2) : '',
    );
    setSaveMessage(null);
  }, [isLocalConfigMode, localConfig]);

  const save = () => {
    if (!onSaveLocalConfig) return;
    const editedConfig = buildActiveAgentManagerLocalConfig({
        runtimeBinding,
        provider,
        modelKey,
        temperature,
        maxTokens,
        promptTemplate: promptPartsTouched ? serializePromptFields(promptParts) : promptText,
        toolsText,
        knowledgeText,
        responseFormatText,
      });
    void onSaveLocalConfig({
      ...localConfig,
      ...editedConfig,
      provider:
        provider ||
        (localConfig?.provider === 'local_openai_compatible'
          ? 'local_openai_compatible'
          : editedConfig.provider),
    });
    setSaveMessage('Saved.');
  };

  const sectionBody = useMemo(() => {
    if (activeTab === 'Prompt') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
              Role
            </label>
            <textarea
              value={promptParts.role}
              onChange={(event) => {
                setPromptParts((current) => ({ ...current, role: event.target.value }));
                setPromptPartsTouched(true);
                setSaveMessage(null);
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
                setSaveMessage(null);
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
                setSaveMessage(null);
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
                setSaveMessage(null);
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
                setSaveMessage(null);
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

          {onChangePromptTestInput && onRunPromptTest && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
              <label style={{ color: '#E0DED5', fontSize: 12, fontWeight: 600 }}>
                Test Input
              </label>
              <textarea
                value={promptTestInput || ''}
                onChange={(event) => onChangePromptTestInput(event.target.value)}
                rows={6}
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
                  onClick={onRunPromptTest}
                  disabled={promptTestDisabled || promptTestBusy || !String(promptTestInput || '').trim()}
                  style={{
                    padding: '10px 12px',
                    background: promptTestBusy ? '#3A3A3A' : '#4FA2AD',
                    color: '#FFF',
                    border: 'none',
                    borderRadius: 8,
                    cursor:
                      promptTestDisabled || promptTestBusy || !String(promptTestInput || '').trim()
                        ? 'not-allowed'
                        : 'pointer',
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  {promptTestBusy ? 'Running...' : 'Run Test'}
                </button>
              </div>
              </div>
          )}
          <div style={{ borderTop: '1px solid #3A3A3A', paddingTop: 12 }}>
            <div style={{ color: '#E0DED5', fontSize: 12, fontWeight: 600 }}>
              Current task / PromptSpec
            </div>
            <pre style={{ whiteSpace: 'pre-wrap', color: '#B9C7CC', fontSize: 11 }}>
              {runContextLoading
                ? 'Loading canonical AgentGraph assignment…'
                : runContextError
                  ? runContextError
                  : runContext?.assignment?.instruction || 'No assignment has been delivered to this card.'}
            </pre>
            <div style={{ color: '#E0DED5', fontSize: 12, fontWeight: 600 }}>
              Graph context delivered after the task
            </div>
            <pre style={{ whiteSpace: 'pre-wrap', color: '#91A9B8', fontSize: 10, maxHeight: 240, overflow: 'auto' }}>
              {runContext?.deliveredContext?.manifest.records.length
                ? runContext.deliveredContext.manifest.records
                    .map((record) => record.representation)
                    .join('\n')
                : 'No graph records delivered.'}
            </pre>
          </div>
        </div>
      );
    }

    if (activeTab === 'Knowledge') {
      const assignment = runContext?.assignment;
      const delivered = runContext?.deliveredContext;
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {runContextLoading ? <div style={{ color: '#91A9B8' }}>Loading canonical AgentGraph context…</div> : null}
          {runContextError ? <div role="alert" style={{ color: '#FFB0A6' }}>{runContextError}</div> : null}
          {!runContextLoading && !runContextError && !assignment ? (
            <div style={{ color: '#91A9B8' }}>This card has no delivered assignment yet.</div>
          ) : null}
          {assignment ? (
            <>
              <section>
                <div style={{ color: '#E0DED5', fontWeight: 600 }}>Assignment</div>
                <div style={{ color: '#91A9B8', fontSize: 11 }}>
                  {assignment.assignmentId} · {assignment.state}
                </div>
                <pre style={{ whiteSpace: 'pre-wrap', color: '#D5E4E8', fontSize: 11 }}>
                  {assignment.instruction}
                </pre>
              </section>
              <section>
                <div style={{ color: '#E0DED5', fontWeight: 600 }}>Delivered knowledge</div>
                <div style={{ color: '#91A9B8', fontSize: 11 }}>
                  {delivered
                    ? `${delivered.graphViews.map((view) => view.viewId).join(', ')} · ${delivered.manifest.records.length} records · manifest ${delivered.manifest.manifestHash.slice(0, 12)}`
                    : 'No GraphView attached.'}
                </div>
                {(delivered?.manifest.records || []).map((record) => (
                  <details key={`${record.authority}:${record.kind}:${record.nativeId}`} style={{ marginTop: 8 }}>
                    <summary style={{ color: '#B9D9DC', cursor: 'pointer', fontSize: 11 }}>
                      {record.deliveryOrder}. {record.authority} {record.kind} · {record.nativeId}
                      {record.required ? ' · required' : ''}
                    </summary>
                    <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: '#91A9B8', fontSize: 10 }}>
                      {record.representation}
                    </pre>
                  </details>
                ))}
                {(delivered?.manifest.unresolvedReferences || []).map((reference) => (
                  <div key={`${reference.referenceType}:${reference.referenceId}`} style={{ color: '#FFB0A6', fontSize: 11 }}>
                    Unavailable: {reference.referenceType}:{reference.referenceId} · {reference.reason}
                  </div>
                ))}
              </section>
              <section>
                <div style={{ color: '#E0DED5', fontWeight: 600 }}>Runtime and result</div>
                <div style={{ color: '#91A9B8', fontSize: 11 }}>
                  {assignment.runTrace.provider || 'provider unavailable'} · {assignment.runTrace.providerModelId || assignment.runTrace.modelKey || 'model unavailable'}
                </div>
                {assignment.result ? (
                  <pre style={{ whiteSpace: 'pre-wrap', color: assignment.result.status === 'failed' ? '#FFB0A6' : '#D5E4E8', fontSize: 11 }}>
                    {assignment.result.output
                      || assignment.result.errorDetail
                      || assignment.result.summary
                      || assignment.result.status}
                  </pre>
                ) : (
                  <div style={{ color: '#91A9B8', fontSize: 11 }}>Pending; no durable result yet.</div>
                )}
              </section>
            </>
          ) : null}
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
                  setProvider(event.target.value as 'openai' | 'openrouter' | '');
                  setSaveMessage(null);
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
                <option value="openai">OpenAI</option>
                <option value="openrouter">OpenRouter</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
                Model
              </label>
              <input
                type="text"
                value={modelKey}
                onChange={(event) => {
                  setModelKey(event.target.value);
                  setSaveMessage(null);
                }}
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

            <div>
              <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
                Temperature
              </label>
              <input
                type="number"
                value={temperature}
                onChange={(event) => {
                  const next = event.target.value;
                  setTemperature(next === '' ? '' : Number(next));
                  setSaveMessage(null);
                }}
                step="0.1"
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

            <div>
              <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
                Max Tokens
              </label>
              <input
                type="number"
                value={maxTokens}
                onChange={(event) => {
                  const next = event.target.value;
                  setMaxTokens(next === '' ? '' : Number(next));
                  setSaveMessage(null);
                }}
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
          </div>
        </div>
      );
    }

    if (activeTab === 'Tools') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ color: '#E0DED5', fontSize: 12, fontWeight: 600 }}>
            Saved executable grants
          </label>
          <textarea
            value={toolsText}
            onChange={(event) => {
              setToolsText(event.target.value);
              setSaveMessage(null);
            }}
            placeholder="One canonical saved tool grant per line."
            rows={10}
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
          <div style={{ color: '#91A9B8', fontSize: 11 }}>
            The runtime resolves exactly these saved grants and fails if a grant is unknown or disabled.
          </div>
          {runContext?.assignment?.result?.toolEvidence?.length ? (
            <pre style={{ whiteSpace: 'pre-wrap', color: '#B9C7CC', fontSize: 10 }}>
              {JSON.stringify(runContext.assignment.result.toolEvidence, null, 2)}
            </pre>
          ) : (
            <div style={{ color: '#91A9B8', fontSize: 11 }}>No tool evidence recorded for the current assignment.</div>
          )}
        </div>
      );
    }

    return null;
  }, [
    activeTab,
    knowledgeText,
    maxTokens,
    modelKey,
    onChangePromptTestInput,
    onRunPromptTest,
    promptParts,
    promptTestDisabled,
    promptTestBusy,
    promptTestInput,
    promptText,
    provider,
    responseFormatText,
    runtimeBinding,
    runContext,
    runContextError,
    runContextLoading,
    temperature,
    toolsText,
  ]);

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

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={save}
          style={{
            padding: '10px 12px',
            background: '#4FA2AD',
            color: '#FFF',
            border: 'none',
            borderRadius: 8,
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          Save Card
        </button>
        {saveMessage && <div style={{ color: '#4FA2AD', fontSize: 12 }}>{saveMessage}</div>}
      </div>
    </div>
  );
}
