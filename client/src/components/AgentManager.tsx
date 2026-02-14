import { useState, useEffect, useMemo } from 'react';

// Parse tagged block format from prompt_template
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

  // Tagged format only; otherwise treat DB template as plain role text.
  if (!normalizedTemplate.includes('[ROLE]')) {
    return {
      role: template,
      goal: '',
      constraints: '',
      ioSchema: '',
      memoryPolicy: ''
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
  let m: RegExpExecArray | null;
  while ((m = tagRegex.exec(normalizedTemplate)) !== null) {
    tags.push({
      key: String(m[1] || '').toUpperCase(),
      start: m.index,
      end: tagRegex.lastIndex,
    });
  }
  for (let i = 0; i < tags.length; i++) {
    const current = tags[i];
    const next = tags[i + 1];
    const value = normalizedTemplate.slice(current.end, next ? next.start : normalizedTemplate.length).trim();
    if (current.key === 'ROLE') parsed.role = value;
    else if (current.key === 'GOAL') parsed.goal = value;
    else if (current.key === 'CONSTRAINTS') parsed.constraints = value;
    else if (current.key === 'IO_SCHEMA') parsed.ioSchema = value;
    else if (current.key === 'MEMORY_POLICY') parsed.memoryPolicy = value;
  }

  return parsed;
}

// Serialize fields to tagged block format
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

interface AgentManagerProps {
  projectId: string;
  agentType: 'agent_builder' | 'llm_chat' | 'kg_ingest';
  activeTab: string;
  workspaceProjectId?: string;
  onGraphRefresh?: () => void;
  onLastRun?: (lastRun: {
    agentType: 'agent_builder' | 'llm_chat' | 'kg_ingest';
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
}

const DEFAULT_KG_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    chunks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          chunk_id: { type: 'string' },
          text: { type: 'string' },
          start: { type: 'number' },
          end: { type: 'number' },
        },
        required: ['chunk_id', 'text', 'start', 'end'],
      },
    },
    entities: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          type: { type: 'string' },
          name: { type: 'string' },
          aliases: { type: 'array', items: { type: 'string' } },
          evidence_chunk_ids: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'type', 'name', 'aliases', 'evidence_chunk_ids'],
      },
    },
    relations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          from: { type: 'string' },
          to: { type: 'string' },
          type: { type: 'string' },
          evidence_chunk_ids: { type: 'array', items: { type: 'string' } },
          confidence: { type: 'number' },
        },
        required: ['from', 'to', 'type', 'evidence_chunk_ids', 'confidence'],
      },
    },
  },
  required: ['chunks', 'entities', 'relations'],
};

const DEFAULT_KG_RESPONSE_FORMAT = {
  type: 'json_schema',
  name: 'kg_extract',
  strict: true,
  schema: DEFAULT_KG_RESPONSE_SCHEMA,
};

export function AgentManager({ projectId, agentType, activeTab, workspaceProjectId, onLastRun }: AgentManagerProps) {
  const urlProjectId = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const params = new URLSearchParams(window.location.search);
    return params.get('projectId')?.trim() || '';
  }, []);
  const resolvedProjectId = projectId || urlProjectId;
  const [loading, setLoading] = useState(false);
  
  // Model registry from backend (grouped by provider)
  const [modelsByProvider, setModelsByProvider] = useState<Record<string, Array<{key: string; label: string; providerModelId: string}>>>({});
  
  // Project config form
  const [provider, setProvider] = useState<'openai' | 'openrouter' | ''>('');
  const [modelKey, setModelKey] = useState('');
  const [temperature, setTemperature] = useState<number | ''>('');
  const [topP, setTopP] = useState<number | ''>('');
  const [maxTokens, setMaxTokens] = useState<number | ''>('');
  const [previousResponseIdEnabled, setPreviousResponseIdEnabled] = useState(false);
  const [previousResponseId, setPreviousResponseId] = useState('');
  const [previousResponseTouched, setPreviousResponseTouched] = useState(false);
  const [responseFormatType, setResponseFormatType] = useState<'unset' | 'text' | 'json_schema'>('unset');
  const [responseFormatTouched, setResponseFormatTouched] = useState(false);
  const [responseFormatHasConfig, setResponseFormatHasConfig] = useState(false);
  const [responseFormatName, setResponseFormatName] = useState('');
  const [responseFormatSchema, setResponseFormatSchema] = useState('');
  const [toolsJson, setToolsJson] = useState('');
  const [toolsTouched, setToolsTouched] = useState(false);
  const [toolsHasConfig, setToolsHasConfig] = useState(false);
  const [promptParts, setPromptParts] = useState({
    role: '',
    goal: '',
    constraints: '',
    ioSchema: '',
    memoryPolicy: ''
  });
  
  // Credit and version stats
  const [creditStats, setCreditStats] = useState<any>(null);
  const [deckVersion, setDeckVersion] = useState<number>(1);

  // Test harness
  const [testInput, setTestInput] = useState('');
  const [testRunning, setTestRunning] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [, setLastRun] = useState<{
    agentType: 'agent_builder' | 'llm_chat' | 'kg_ingest';
    request: any;
    responseOrError: any;
    elapsedMs: number;
    provider?: string | null;
    model?: string | null;
    endpoint?: string | null;
    requestId?: string | null;
    finishReason?: string | null;
    usage?: any | null;
  } | null>(null);

  const [configError, setConfigError] = useState<string | null>(null);
  const [configErrorCode, setConfigErrorCode] = useState<string | null>(null);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [versions, setVersions] = useState<any[]>([]);
  const [versionsEnabled, setVersionsEnabled] = useState<boolean>(true);
  const [versionNote, setVersionNote] = useState('');
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  // Load model registry on mount
  useEffect(() => {
    fetch('/api/config/models')
      .then(res => res.json())
      .then(data => {
        console.debug('[AgentManager] Loaded models from /api/config/models:', data);
        
        // Transform response to match expected format
        const transformed: Record<string, Array<{key: string; label: string; providerModelId: string}>> = {
          openai: (data.openai?.options || []).map((m: any) => ({
            key: m.key,
            label: m.label,
            providerModelId: m.id
          })),
          openrouter: (data.openrouter?.options || []).map((m: any) => ({
            key: m.key,
            label: m.label,
            providerModelId: m.id
          }))
        };
        
        console.debug('[AgentManager] OpenAI models:', transformed.openai.length);
        console.debug('[AgentManager] OpenRouter models:', transformed.openrouter.length);
        setModelsByProvider(transformed);
      })
      .catch(err => console.error('[AgentManager] Failed to load models:', err));
  }, []);

  // Load project config when project changes
  useEffect(() => {
    console.log('[AgentManager] useEffect triggered - projectId:', resolvedProjectId, 'agentType:', agentType);
    if (resolvedProjectId && agentType) {
      console.log('[AgentManager] Loading config for projectId:', resolvedProjectId, 'agentType:', agentType);
      loadProjectConfig();
    } else {
      console.log('[AgentManager] Skipping config load - missing projectId or agentType');
    }
  }, [resolvedProjectId, agentType]);

  const loadProjectConfig = async () => {
    if (!resolvedProjectId || !agentType) {
      return;
    }
    try {
      setLoading(true);
      setConfigError(null);
      const res = await fetch(`/api/v2/projects/${resolvedProjectId}/agents/${agentType}/config`);
      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) {
        const error = typeof data?.error === 'string' ? data.error : `HTTP ${res.status}`;
        if (error === 'missing_config') {
          const missing = Array.isArray(data?.missing) && data.missing.length ? data.missing.join(', ') : 'required fields';
          setConfigError(`Configuration incomplete for ${agentType}: missing ${missing}.`);
          setConfigErrorCode('missing_config');
        } else if (error === 'agent_not_found') {
          setConfigError('Agent record was not found for this project.');
          setConfigErrorCode('agent_not_found');
        } else {
          setConfigError(`Failed to load configuration: ${error}`);
          setConfigErrorCode(error);
        }
        if (error !== 'missing_config') {
          setProvider('');
          setModelKey('');
          setTemperature('');
          setTopP('');
          setMaxTokens('');
          setPreviousResponseIdEnabled(false);
          setPreviousResponseId('');
          setPreviousResponseTouched(false);
          setResponseFormatType('unset');
          setResponseFormatName('');
          setResponseFormatSchema('');
          setResponseFormatTouched(false);
          setResponseFormatHasConfig(false);
          setToolsJson('');
          setToolsError(null);
          setToolsTouched(false);
          setToolsHasConfig(false);
          setPromptParts({ role: '', goal: '', constraints: '', ioSchema: '', memoryPolicy: '' });
          setCreditStats(null);
          setDeckVersion(1);
          setVersions([]);
        }
        return;
      }

      const {
        provider: fetchedProvider,
        model_key,
        temperature: fetchedTemp,
        top_p: fetchedTopP,
        max_tokens: fetchedMax,
        max_output_tokens: fetchedMaxOutput,
        previous_response_id: fetchedPreviousResponseId,
        response_format: fetchedResponseFormat,
        tools: fetchedTools,
        prompt_template,
      } = data.config;
      setProvider(fetchedProvider || '');
      setModelKey(model_key || '');
      setTemperature(typeof fetchedTemp === 'number' ? fetchedTemp : '');
      setTopP(typeof fetchedTopP === 'number' ? fetchedTopP : '');
      const resolvedMax = typeof fetchedMaxOutput === 'number' ? fetchedMaxOutput : fetchedMax;
      setMaxTokens(typeof resolvedMax === 'number' ? resolvedMax : '');
      const prevId = typeof fetchedPreviousResponseId === 'string' ? fetchedPreviousResponseId : '';
      setPreviousResponseId(prevId);
      setPreviousResponseIdEnabled(Boolean(prevId));
      setPreviousResponseTouched(false);
      if (fetchedResponseFormat && typeof fetchedResponseFormat === 'object') {
        const type = fetchedResponseFormat.type;
        if (type === 'text') {
          setResponseFormatType('text');
          setResponseFormatName('');
          setResponseFormatSchema('');
        } else if (type === 'json_schema') {
          setResponseFormatType('json_schema');
          setResponseFormatName(fetchedResponseFormat?.name || fetchedResponseFormat?.json_schema?.name || 'structured_output');
          const schema = fetchedResponseFormat?.schema ?? fetchedResponseFormat?.json_schema?.schema ?? {};
          setResponseFormatSchema(JSON.stringify(schema, null, 2));
        } else {
          setResponseFormatType('unset');
          setResponseFormatName('');
          setResponseFormatSchema('');
        }
        setResponseFormatHasConfig(true);
      } else if (agentType === 'kg_ingest') {
        setResponseFormatType('json_schema');
        setResponseFormatName(DEFAULT_KG_RESPONSE_FORMAT.name);
        setResponseFormatSchema(JSON.stringify(DEFAULT_KG_RESPONSE_FORMAT.schema, null, 2));
        setResponseFormatHasConfig(false);
      } else {
        setResponseFormatType('unset');
        setResponseFormatName('');
        setResponseFormatSchema('');
        setResponseFormatHasConfig(false);
      }
      if (Array.isArray(fetchedTools)) {
        setToolsJson(JSON.stringify(fetchedTools, null, 2));
        setToolsHasConfig(true);
      } else {
        setToolsJson(agentType === 'kg_ingest' ? '[]' : '');
        setToolsHasConfig(false);
      }
      setToolsError(null);
      setResponseFormatTouched(false);
      setToolsTouched(false);
      setCreditStats(null);
      setDeckVersion(1);
      const template = prompt_template || '';
      const parsed = parsePromptTemplate(template);
      setPromptParts(parsed);
      if (Array.isArray(data?.missing) && data.missing.length) {
        setConfigError(`Configuration incomplete for ${agentType}: missing ${data.missing.join(', ')}.`);
        setConfigErrorCode('missing_config');
      } else {
        setConfigError(null);
        setConfigErrorCode(null);
      }
      try {
        const versionsRes = await fetch(`/api/v2/projects/${resolvedProjectId}/agents/${agentType}/config/versions?limit=20`);
        const versionsJson = await versionsRes.json().catch(() => null);
        if (versionsRes.ok && versionsJson?.ok) {
          setVersions(Array.isArray(versionsJson.versions) ? versionsJson.versions : []);
          setVersionsEnabled(versionsJson.versions_enabled !== false);
        } else {
          setVersions([]);
          setVersionsEnabled(true);
        }
      } catch {
        setVersions([]);
        setVersionsEnabled(true);
      }
    } catch (err: any) {
      console.error('[AgentManager] Failed to load project config:', err);
      setConfigError(err?.message || 'Failed to load configuration');
      setConfigErrorCode('load_failed');
      setProvider('');
      setModelKey('');
      setTemperature('');
      setTopP('');
      setMaxTokens('');
      setPreviousResponseIdEnabled(false);
      setPreviousResponseId('');
      setPreviousResponseTouched(false);
      setResponseFormatType('unset');
      setResponseFormatName('');
      setResponseFormatSchema('');
      setResponseFormatTouched(false);
      setResponseFormatHasConfig(false);
      setToolsJson('');
      setToolsError(null);
      setToolsTouched(false);
      setToolsHasConfig(false);
      setPromptParts({ role: '', goal: '', constraints: '', ioSchema: '', memoryPolicy: '' });
    } finally {
      setLoading(false);
    }
  };

  const createAgentBuilderConfig = async () => {
    if (!resolvedProjectId) return;
    try {
      setLoading(true);
      setConfigError(null);
      const res = await fetch(`/api/v2/projects/${resolvedProjectId}/agents/agent_builder/config/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        const error = typeof data?.error === 'string' ? data.error : `HTTP ${res.status}`;
        setConfigError(`Create failed: ${error}`);
        return;
      }
      await loadProjectConfig();
    } catch (err: any) {
      setConfigError(err?.message || 'Failed to create config');
    } finally {
      setLoading(false);
    }
  };

  const saveConfig = async () => {
    try {
      setLoading(true);
      setSaveSuccess(null);
      setToolsError(null);
      
      // Serialize prompt_parts to prompt_template
      const composedTemplate = serializePromptFields(promptParts);
      
      let responseFormatPayload: any = undefined;
      if (responseFormatType === 'text') {
        responseFormatPayload = { type: 'text' };
      } else if (responseFormatType === 'json_schema') {
        const name = responseFormatName?.trim() || 'structured_output';
        let schema: any = {};
        try {
          schema = responseFormatSchema?.trim()
            ? JSON.parse(responseFormatSchema)
            : {};
        } catch (err: any) {
          setToolsError(`Response schema is not valid JSON: ${err?.message || 'invalid JSON'}`);
          return;
        }
        responseFormatPayload = {
          type: 'json_schema',
          name,
          strict: true,
          schema,
        };
      } else if (responseFormatType === 'unset') {
        responseFormatPayload = null;
      }

      let toolsPayload: any[] | undefined = undefined;
      if (toolsTouched || toolsHasConfig) {
        const toolsText = toolsJson?.trim() || '';
        if (toolsText) {
          try {
            const parsed = JSON.parse(toolsText);
            if (!Array.isArray(parsed)) {
              setToolsError('Tools must be a JSON array.');
              return;
            }
            toolsPayload = parsed;
          } catch (err: any) {
            setToolsError(`Tools JSON is invalid: ${err?.message || 'invalid JSON'}`);
            return;
          }
        } else {
          toolsPayload = [];
        }
      }

      if (previousResponseIdEnabled && !previousResponseId.trim()) {
        setToolsError('Previous response id is enabled but empty.');
        return;
      }

      const url = `/api/v2/projects/${resolvedProjectId}/agents/${agentType}/config`;
      const payload: any = {
        provider: provider,
        model_key: modelKey,
        max_output_tokens: maxTokens,
        prompt_template: composedTemplate,
        version_note: versionNote || null,
      };
      if (supportsSamplingControls && typeof temperature === 'number') {
        payload.temperature = temperature;
      }
      if (supportsSamplingControls && typeof topP === 'number') {
        payload.top_p = topP;
      }
      if (previousResponseIdEnabled) {
        payload.previous_response_id = previousResponseId.trim();
      } else if (previousResponseTouched) {
        payload.previous_response_id = null;
      }
      if (responseFormatType !== 'unset' || responseFormatTouched || responseFormatHasConfig) {
        payload.response_format = responseFormatPayload;
      }
      if (toolsPayload !== undefined && (toolsTouched || toolsHasConfig)) {
        payload.tools = toolsPayload;
      }
      
      console.log('[AgentManager] Saving config:', { url, payload });
      console.log('[SAVE_V2] PUT', { projectId: resolvedProjectId, agentType });
      
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      console.log('[AgentManager] Save response:', { status: res.status, ok: res.ok });

      const result = await res.json().catch(() => null);
      if (!res.ok || !result?.ok) {
        const error = typeof result?.error === 'string' ? result.error : `HTTP ${res.status}`;
        if (error === 'missing_config' || error === 'invalid_config') {
          const missing = Array.isArray(result?.missing) && result.missing.length ? result.missing.join(', ') : 'required fields';
          setConfigError(`Cannot save: missing ${missing}.`);
        } else if (error === 'agent_not_found') {
          setConfigError('Agent record was not found for this project.');
        } else {
          setConfigError(`Save failed: ${error}`);
        }
        return;
      }
      setConfigError(null);
      setConfigErrorCode(null);
      setVersionNote('');
      setSaveSuccess('Saved');
      // Clear success message after 3 seconds
      setTimeout(() => setSaveSuccess(null), 3000);
      loadProjectConfig();
    } catch (err: any) {
      console.error('[AgentManager] Save error:', err);
      setConfigError(err?.message || 'Failed to save configuration');
    } finally {
      setLoading(false);
    }
  };

  const handleRunTest = async () => {
    if (!testInput.trim()) {
      alert('Enter test input');
      return;
    }

    try {
      setTestRunning(true);
      setTestResult(null);
      const startedAt = performance.now();

      const res = await fetch(`/api/v2/projects/${resolvedProjectId}/agents/${agentType}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: testInput }),
      });
      const data = await res.json().catch(() => null);
      const elapsedMs = Math.round(performance.now() - startedAt);
      const debug = data?.debug || null;
      const runPayload = {
        agentType,
        request: debug?.request ?? null,
        responseOrError: debug?.response ?? debug?.error ?? null,
        elapsedMs,
        provider: debug?.provider ?? null,
        model: debug?.model ?? null,
        endpoint: debug?.endpoint ?? null,
        requestId: debug?.request_id ?? null,
        finishReason: debug?.finish_reason ?? null,
        usage: debug?.usage ?? null,
      };

      if (!res.ok || !data?.ok) {
        const error = typeof data?.error === 'string' ? data.error : `HTTP ${res.status}`;
        setTestResult({ ok: false, error, debug });
        setLastRun(runPayload);
        onLastRun?.(runPayload);
        return;
      }

      setTestResult(data);
      setLastRun(runPayload);
      onLastRun?.(runPayload);
    } catch (err: any) {
      setTestResult({ ok: false, error: err?.message || 'Test failed' });
    } finally {
      setTestRunning(false);
    }
  };

  const availableModels = useMemo(() => {
    if (!provider) return [] as Array<{key: string; label: string; providerModelId: string}>;
    return modelsByProvider[provider] || [];
  }, [provider, modelsByProvider]);
  const supportsSamplingControls = useMemo(() => {
    if (provider !== 'openai') return true;
    const selected = availableModels.find((m) => m.key === modelKey);
    const modelId = String(selected?.providerModelId || modelKey || '').toLowerCase();
    return !/^gpt-5(?:[.-]|$)/.test(modelId);
  }, [provider, availableModels, modelKey]);

  const saveDisabled = loading || !resolvedProjectId || !provider || !modelKey || typeof maxTokens !== 'number';

  return (
    <div style={{ padding: '16px' }}>

      {configError && (
        <div
          style={{
            marginBottom: '16px',
            padding: '12px',
            border: '1px solid #D98458',
            borderRadius: '6px',
            background: '#4B2B2B',
            color: '#FFD7BF',
            fontSize: '13px'
          }}
        >
          {configError}
          {agentType === 'agent_builder' && configErrorCode === 'agent_not_found' && (
            <div style={{ marginTop: '10px' }}>
              <button
                onClick={createAgentBuilderConfig}
                disabled={loading}
                style={{
                  padding: '8px 10px',
                  background: loading ? '#666' : '#4FA2AD',
                  color: '#FFF',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  fontSize: '12px',
                  fontWeight: 'bold',
                }}
              >
                Create Agent Builder Config
              </button>
            </div>
          )}
        </div>
      )}

      {/* Tab Content */}
      {activeTab === 'Plan' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '4px', color: '#E0DED5' }}>Provider</label>
            <select
              value={provider}
              onChange={(e) => {
                const newProvider = e.target.value as 'openai' | 'openrouter' | '';
                setProvider(newProvider);
              }}
              style={{
                width: '100%',
                padding: '8px',
                background: '#2B2B2B',
                color: '#FFF',
                border: '1px solid #3A3A3A',
                borderRadius: '4px',
              }}
            >
              <option value="">Select provider</option>
              <option value="openai">OpenAI</option>
              <option value="openrouter">OpenRouter</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '4px', color: '#E0DED5' }}>Model</label>
            <select
              value={modelKey}
              onChange={(e) => setModelKey(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                background: '#2B2B2B',
                color: '#FFF',
                border: '1px solid #3A3A3A',
                borderRadius: '4px',
              }}
            >
              <option value="">Select model</option>
              {availableModels.map(m => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          {supportsSamplingControls ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '4px', color: '#E0DED5' }}>Temperature</label>
                <input
                  type="number"
                  value={temperature}
                  onChange={(e) => setTemperature(e.target.value === '' ? '' : parseFloat(e.target.value))}
                  min="0"
                  max="2"
                  step="0.1"
                  style={{
                    width: '100%',
                    padding: '8px',
                    background: '#2B2B2B',
                    color: '#FFF',
                    border: '1px solid #3A3A3A',
                    borderRadius: '4px',
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '4px', color: '#E0DED5' }}>Top P</label>
                <input
                  type="number"
                  value={topP}
                  onChange={(e) => setTopP(e.target.value === '' ? '' : parseFloat(e.target.value))}
                  min="0"
                  max="1"
                  step="0.05"
                  style={{
                    width: '100%',
                    padding: '8px',
                    background: '#2B2B2B',
                    color: '#FFF',
                    border: '1px solid #3A3A3A',
                    borderRadius: '4px',
                  }}
                />
              </div>
            </div>
          ) : (
            <div style={{ color: '#A0A0A0', fontSize: '12px' }}>
              Temperature and Top P are hidden for this model.
            </div>
          )}

          <div>
            <label style={{ display: 'block', marginBottom: '4px', color: '#E0DED5' }}>Max Output Tokens</label>
            <input
              type="number"
              value={maxTokens}
              onChange={(e) => setMaxTokens(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
              min="256"
              max="8192"
              step="256"
              style={{
                width: '100%',
                padding: '8px',
                background: '#2B2B2B',
                color: '#FFF',
                border: '1px solid #3A3A3A',
                borderRadius: '4px',
              }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <input
              type="checkbox"
              checked={previousResponseIdEnabled}
              onChange={(e) => {
                setPreviousResponseIdEnabled(e.target.checked);
                setPreviousResponseTouched(true);
              }}
            />
            <label style={{ color: '#E0DED5' }}>Use Previous Response ID</label>
          </div>
          {previousResponseIdEnabled && (
            <div>
              <label style={{ display: 'block', marginBottom: '4px', color: '#E0DED5' }}>Previous Response ID</label>
              <input
                type="text"
                value={previousResponseId}
                onChange={(e) => {
                  setPreviousResponseId(e.target.value);
                  setPreviousResponseTouched(true);
                }}
                placeholder="resp_..."
                style={{
                  width: '100%',
                  padding: '8px',
                  background: '#2B2B2B',
                  color: '#FFF',
                  border: '1px solid #3A3A3A',
                  borderRadius: '4px',
                }}
              />
            </div>
          )}

          <div>
            <label style={{ display: 'block', marginBottom: '4px', color: '#E0DED5' }}>Response Format</label>
            <select
              value={responseFormatType}
              onChange={(e) => {
                setResponseFormatType(e.target.value as 'unset' | 'text' | 'json_schema');
                setResponseFormatTouched(true);
              }}
              style={{
                width: '100%',
                padding: '8px',
                background: '#2B2B2B',
                color: '#FFF',
                border: '1px solid #3A3A3A',
                borderRadius: '4px',
              }}
            >
              <option value="unset">Unset</option>
              <option value="text">Text</option>
              <option value="json_schema">JSON Schema (strict)</option>
            </select>
          </div>

          {responseFormatType === 'json_schema' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '4px', color: '#E0DED5' }}>Schema Name</label>
                <input
                  type="text"
                  value={responseFormatName}
                  onChange={(e) => {
                    setResponseFormatName(e.target.value);
                    setResponseFormatTouched(true);
                  }}
                  placeholder="schema_name"
                  style={{
                    width: '100%',
                    padding: '8px',
                    background: '#2B2B2B',
                    color: '#FFF',
                    border: '1px solid #3A3A3A',
                    borderRadius: '4px',
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '4px', color: '#E0DED5' }}>JSON Schema</label>
                <textarea
                  value={responseFormatSchema}
                  onChange={(e) => {
                    setResponseFormatSchema(e.target.value);
                    setResponseFormatTouched(true);
                  }}
                  placeholder="Paste JSON schema..."
                  rows={8}
                  style={{
                    width: '100%',
                    padding: '8px',
                    background: '#2B2B2B',
                    color: '#FFF',
                    border: '1px solid #3A3A3A',
                    borderRadius: '4px',
                    fontFamily: 'monospace',
                    fontSize: '12px',
                  }}
                />
              </div>
            </div>
          )}

          <div>
            <label style={{ display: 'block', marginBottom: '4px', color: '#E0DED5' }}>Tools (JSON array)</label>
            <textarea
              value={toolsJson}
              onChange={(e) => {
                setToolsJson(e.target.value);
                setToolsTouched(true);
              }}
              placeholder='[{"name":"tool_name","config":{}}]'
              rows={4}
              style={{
                width: '100%',
                padding: '8px',
                background: '#2B2B2B',
                color: '#FFF',
                border: '1px solid #3A3A3A',
                borderRadius: '4px',
                fontFamily: 'monospace',
                fontSize: '12px',
              }}
            />
            {toolsError && (
              <div style={{ color: '#D98458', fontSize: '12px', marginTop: '6px' }}>
                {toolsError}
              </div>
            )}
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '4px', color: '#E0DED5' }}>Version Note (optional)</label>
            <input
              type="text"
              value={versionNote}
              onChange={(e) => setVersionNote(e.target.value)}
              placeholder="What changed?"
              style={{
                width: '100%',
                padding: '8px',
                background: '#2B2B2B',
                color: '#FFF',
                border: '1px solid #3A3A3A',
                borderRadius: '4px',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '4px', color: '#E0DED5' }}>Role</label>
            <textarea
              value={promptParts.role}
              onChange={(e) => setPromptParts({...promptParts, role: e.target.value})}
              placeholder="Who is this agent?"
              rows={4}
              style={{
                width: '100%',
                padding: '8px',
                background: '#2B2B2B',
                color: '#FFF',
                border: '1px solid #3A3A3A',
                borderRadius: '4px',
                fontFamily: 'monospace',
                fontSize: '13px',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '4px', color: '#E0DED5' }}>Goal</label>
            <textarea
              value={promptParts.goal}
              onChange={(e) => setPromptParts({...promptParts, goal: e.target.value})}
              placeholder="What should this agent accomplish?"
              rows={4}
              style={{
                width: '100%',
                padding: '8px',
                background: '#2B2B2B',
                color: '#FFF',
                border: '1px solid #3A3A3A',
                borderRadius: '4px',
                fontFamily: 'monospace',
                fontSize: '13px',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '4px', color: '#E0DED5' }}>Constraints</label>
            <textarea
              value={promptParts.constraints}
              onChange={(e) => setPromptParts({...promptParts, constraints: e.target.value})}
              placeholder="Rules and limitations..."
              rows={4}
              style={{
                width: '100%',
                padding: '8px',
                background: '#2B2B2B',
                color: '#FFF',
                border: '1px solid #3A3A3A',
                borderRadius: '4px',
                fontFamily: 'monospace',
                fontSize: '13px',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '4px', color: '#E0DED5' }}>IO Schema</label>
            <textarea
              value={promptParts.ioSchema}
              onChange={(e) => setPromptParts({...promptParts, ioSchema: e.target.value})}
              placeholder="Input/output format..."
              rows={4}
              style={{
                width: '100%',
                padding: '8px',
                background: '#2B2B2B',
                color: '#FFF',
                border: '1px solid #3A3A3A',
                borderRadius: '4px',
                fontFamily: 'monospace',
                fontSize: '13px',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '4px', color: '#E0DED5' }}>Memory Policy</label>
            <textarea
              value={promptParts.memoryPolicy}
              onChange={(e) => setPromptParts({...promptParts, memoryPolicy: e.target.value})}
              placeholder="How should this agent handle memory?"
              rows={4}
              style={{
                width: '100%',
                padding: '8px',
                background: '#2B2B2B',
                color: '#FFF',
                border: '1px solid #3A3A3A',
                borderRadius: '4px',
                fontFamily: 'monospace',
                resize: 'vertical',
              }}
            />
          </div>

          {/* Credit and Version Stats */}
          <div style={{ 
            marginTop: '24px', 
            padding: '16px', 
            background: '#1E1E1E', 
            border: '1px solid #3A3A3A',
            borderRadius: '4px'
          }}>
            <h4 style={{ margin: '0 0 12px 0', color: '#4FA2AD', fontSize: '14px' }}>Agent Credit & Version</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '13px' }}>
              <div>
                <div style={{ color: '#888', marginBottom: '4px' }}>Deck Version</div>
                <div style={{ color: '#E0DED5', fontFamily: 'monospace' }}>{deckVersion}</div>
              </div>
              <div>
                <div style={{ color: '#888', marginBottom: '4px' }}>Total Runs</div>
                <div style={{ color: '#E0DED5', fontFamily: 'monospace' }}>{creditStats?.runs || 0}</div>
              </div>
              <div>
                <div style={{ color: '#888', marginBottom: '4px' }}>Predicted Prob EMA</div>
                <div style={{ color: '#E0DED5', fontFamily: 'monospace' }}>
                  {creditStats?.predicted_ema != null ? creditStats.predicted_ema.toFixed(3) : 'N/A'}
                </div>
              </div>
              <div>
                <div style={{ color: '#888', marginBottom: '4px' }}>Postrun Prob EMA</div>
                <div style={{ color: '#E0DED5', fontFamily: 'monospace' }}>
                  {creditStats?.postrun_ema != null ? creditStats.postrun_ema.toFixed(3) : 'N/A'}
                </div>
              </div>
              <div>
                <div style={{ color: '#888', marginBottom: '4px' }}>Delta EMA</div>
                <div style={{ 
                  color: creditStats?.delta_ema > 0 ? '#4FA2AD' : creditStats?.delta_ema < 0 ? '#E57373' : '#E0DED5',
                  fontFamily: 'monospace'
                }}>
                  {creditStats?.delta_ema != null ? creditStats.delta_ema.toFixed(3) : 'N/A'}
                </div>
              </div>
              <div>
                <div style={{ color: '#888', marginBottom: '4px' }}>Last Run</div>
                <div style={{ color: '#E0DED5', fontFamily: 'monospace', fontSize: '11px' }}>
                  {creditStats?.last_run_at ? new Date(creditStats.last_run_at).toLocaleString() : 'Never'}
                </div>
              </div>
              <div>
                <div style={{ color: '#888', marginBottom: '4px' }}>Calls Count</div>
                <div style={{ color: '#E0DED5', fontFamily: 'monospace' }}>{creditStats?.runs || 0}</div>
              </div>
              <div>
                <div style={{ color: '#888', marginBottom: '4px' }}>Deck Hash</div>
                <div style={{ color: '#E0DED5', fontFamily: 'monospace', fontSize: '11px' }}>
                  {creditStats?.deck_hash ? creditStats.deck_hash.substring(0, 12) + '...' : 'N/A'}
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              onClick={saveConfig}
              disabled={saveDisabled}
              style={{
                padding: '12px',
                background: loading ? '#666' : '#4FA2AD',
                color: '#FFF',
                border: 'none',
                borderRadius: '4px',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontSize: '16px',
                fontWeight: 'bold',
              }}
            >
              {loading ? 'Saving...' : 'Save Agent'}
            </button>
            {saveSuccess && (
              <div style={{ color: '#4FA2AD', fontSize: '14px', fontWeight: 'bold' }}>
                {saveSuccess}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'Plan' && (
        <div style={{ marginTop: '16px' }}>
          <h4 style={{ margin: '8px 0', color: '#4FA2AD' }}>Versions</h4>
          {versions.length === 0 && (
            <div style={{ color: '#E0DED5', fontSize: '12px', fontStyle: 'italic' }}>
              {versionsEnabled === false ? 'Versions disabled (table missing)' : 'No versions yet.'}
            </div>
          )}
          {versions.map((v: any) => {
            const preview = String(v.prompt_template || '').slice(0, 140);
            const when = v.created_at ? new Date(v.created_at).toLocaleString() : 'unknown';
            return (
              <div
                key={v.id}
                style={{
                  border: '1px solid #3A3A3A',
                  borderRadius: 6,
                  padding: '8px',
                  marginBottom: '8px',
                  background: '#1a1a1a',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div style={{ color: '#E0DED5', fontSize: 11 }}>{when}</div>
                  <button
                    onClick={async () => {
                      try {
                        const res = await fetch(`/api/v2/projects/${resolvedProjectId}/agents/${agentType}/config/restore`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ version_id: v.id }),
                        });
                        const data = await res.json().catch(() => null);
                        if (!res.ok || !data?.ok) {
                          const err = data?.error || `HTTP ${res.status}`;
                          throw new Error(err);
                        }
                        loadProjectConfig();
                      } catch (err: any) {
                        alert(`Restore failed: ${err?.message || 'unknown error'}`);
                      }
                    }}
                    style={{
                      padding: '4px 8px',
                      background: 'transparent',
                      color: '#FFF',
                      border: '1px solid #3A3A3A',
                      borderRadius: 4,
                      fontSize: 11,
                      cursor: 'pointer',
                    }}
                  >
                    Restore
                  </button>
                </div>
                {v.version_note && (
                  <div style={{ color: '#E0DED5', fontSize: 12, marginBottom: 6 }}>
                    {v.version_note}
                  </div>
                )}
                <div style={{ color: '#A0A0A0', fontSize: 11, whiteSpace: 'pre-wrap' }}>
                  {preview}
                  {String(v.prompt_template || '').length > 140 ? '…' : ''}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {activeTab === 'Plan' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h3 style={{ margin: 0, color: '#4FA2AD' }}>Test Agent</h3>
          
          <div>
            <label style={{ display: 'block', marginBottom: '4px', color: '#E0DED5' }}>Test Input</label>
            <textarea
              value={testInput}
              onChange={(e) => setTestInput(e.target.value)}
              placeholder="Enter test input for the agent..."
              rows={6}
              style={{
                width: '100%',
                padding: '8px',
                background: '#2B2B2B',
                color: '#FFF',
                border: '1px solid #3A3A3A',
                borderRadius: '4px',
                fontFamily: 'monospace',
                resize: 'vertical',
              }}
            />
          </div>

          <button
            onClick={handleRunTest}
            disabled={testRunning || !testInput.trim()}
            style={{
              padding: '12px',
              background: testRunning ? '#666' : '#4FA2AD',
              color: '#FFF',
              border: 'none',
              borderRadius: '4px',
              cursor: testRunning || !testInput.trim() ? 'not-allowed' : 'pointer',
              fontSize: '16px',
              fontWeight: 'bold',
            }}
          >
            {testRunning ? 'Running...' : 'Run Test'}
          </button>

          {testResult && (
            <div style={{
              padding: '16px',
              background: testResult.ok ? '#2B4B2B' : '#4B2B2B',
              border: `1px solid ${testResult.ok ? '#4FA2AD' : '#D98458'}`,
              borderRadius: '4px',
            }}>
              <h4 style={{ margin: '0 0 12px 0', color: testResult.ok ? '#4FA2AD' : '#D98458' }}>
                Result: {testResult.ok ? 'Success' : 'Failed'}
              </h4>

              {testResult.outputText !== undefined && (
                <div style={{ marginBottom: '12px' }}>
                  <strong style={{ color: '#E0DED5' }}>Output Text:</strong>
                  <pre style={{
                    marginTop: '8px',
                    padding: '12px',
                    background: '#1F1F1F',
                    border: '1px solid #3A3A3A',
                    borderRadius: '4px',
                    overflow: 'auto',
                    maxHeight: '300px',
                    fontSize: '12px',
                    color: '#E0DED5',
                  }}>
                    {testResult.outputText}
                  </pre>
                </div>
              )}

              {testResult.error && (
                <div style={{ marginBottom: '12px' }}>
                  <strong style={{ color: '#D98458' }}>Error:</strong>
                  <div style={{ marginTop: '6px', color: '#D98458' }}>
                    {testResult.error}
                  </div>
                </div>
              )}

              {testResult.debug?.request && (
                <div style={{ marginBottom: '12px' }}>
                  <strong style={{ color: '#E0DED5' }}>Debug Request:</strong>
                  <pre style={{
                    marginTop: '8px',
                    padding: '12px',
                    background: '#1F1F1F',
                    border: '1px solid #3A3A3A',
                    borderRadius: '4px',
                    overflow: 'auto',
                    maxHeight: '200px',
                    fontSize: '12px',
                    color: '#E0DED5',
                  }}>
                    {JSON.stringify(testResult.debug.request, null, 2)}
                  </pre>
                </div>
              )}

              {(testResult.debug?.response || testResult.debug?.error) && (
                <div style={{ marginBottom: '12px' }}>
                  <strong style={{ color: '#E0DED5' }}>Debug Response/Error:</strong>
                  <pre style={{
                    marginTop: '8px',
                    padding: '12px',
                    background: '#1F1F1F',
                    border: '1px solid #3A3A3A',
                    borderRadius: '4px',
                    overflow: 'auto',
                    maxHeight: '200px',
                    fontSize: '12px',
                    color: '#E0DED5',
                  }}>
                    {JSON.stringify(testResult.debug.response ?? testResult.debug.error, null, 2)}
                  </pre>
                </div>
              )}

              <div>
                <strong style={{ color: '#E0DED5' }}>Full Response:</strong>
                <pre style={{
                  marginTop: '8px',
                  padding: '12px',
                  background: '#1F1F1F',
                  border: '1px solid #3A3A3A',
                  borderRadius: '4px',
                  overflow: 'auto',
                  maxHeight: '300px',
                  fontSize: '12px',
                  color: '#E0DED5',
                }}>
                  {JSON.stringify(testResult, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
