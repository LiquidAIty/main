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

  // Check for tagged format
  if (!template.includes('[ROLE]')) {
    // Legacy format: treat entire template as role
    return {
      role: template,
      goal: '',
      constraints: '',
      ioSchema: '',
      memoryPolicy: ''
    };
  }

  const extract = (tag: string): string => {
    const regex = new RegExp(`\\[${tag}\\]\\s*([\\s\\S]*?)(?=\\[|$)`, 'i');
    const match = template.match(regex);
    return match ? match[1].trim() : '';
  };

  return {
    role: extract('ROLE'),
    goal: extract('GOAL'),
    constraints: extract('CONSTRAINTS'),
    ioSchema: extract('IO_SCHEMA'),
    memoryPolicy: extract('MEMORY_POLICY')
  };
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
  agentType: 'llm_chat' | 'kg_ingest';
  activeTab: string;
  onGraphRefresh?: () => void;
}

export function AgentManager({ projectId, agentType, activeTab }: AgentManagerProps) {
  const [loading, setLoading] = useState(false);
  
  // Model registry from backend (grouped by provider)
  const [modelsByProvider, setModelsByProvider] = useState<Record<string, Array<{key: string; label: string; providerModelId: string}>>>([]);
  
  // Project config form
  const [provider, setProvider] = useState<'openai' | 'openrouter' | ''>('');
  const [modelKey, setModelKey] = useState('');
  const [temperature, setTemperature] = useState<number | ''>('');
  const [maxTokens, setMaxTokens] = useState<number | ''>('');
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

  const [configError, setConfigError] = useState<string | null>(null);

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
    if (projectId && agentType) {
      loadProjectConfig();
    }
  }, [projectId, agentType]);

  const loadProjectConfig = async () => {
    if (!projectId || !agentType) {
      return;
    }
    try {
      setLoading(true);
      setConfigError(null);
      const res = await fetch(`/api/v2/projects/${projectId}/agents/${agentType}/config`);
      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) {
        const error = typeof data?.error === 'string' ? data.error : `HTTP ${res.status}`;
        if (error === 'missing_config') {
          const missing = Array.isArray(data?.missing) && data.missing.length ? data.missing.join(', ') : 'required fields';
          setConfigError(`Configuration incomplete for ${agentType}: missing ${missing}.`);
        } else if (error === 'agent_not_found') {
          setConfigError('Agent record was not found for this project.');
        } else {
          setConfigError(`Failed to load configuration: ${error}`);
        }
        if (error !== 'missing_config') {
          setProvider('');
          setModelKey('');
          setTemperature('');
          setMaxTokens('');
          setPromptParts({ role: '', goal: '', constraints: '', ioSchema: '', memoryPolicy: '' });
          setCreditStats(null);
          setDeckVersion(1);
        }
        return;
      }

      const { provider: fetchedProvider, model_key, temperature: fetchedTemp, max_tokens: fetchedMax, prompt_template } = data.config;
      setProvider(fetchedProvider || '');
      setModelKey(model_key || '');
      setTemperature(typeof fetchedTemp === 'number' ? fetchedTemp : '');
      setMaxTokens(typeof fetchedMax === 'number' ? fetchedMax : '');
      setCreditStats(null);
      setDeckVersion(1);
      const template = prompt_template || '';
      setPromptParts(parsePromptTemplate(template));
      setConfigError(null);
    } catch (err: any) {
      console.error('[AgentManager] Failed to load project config:', err);
      setConfigError(err?.message || 'Failed to load configuration');
      setProvider('');
      setModelKey('');
      setTemperature('');
      setMaxTokens('');
      setPromptParts({ role: '', goal: '', constraints: '', ioSchema: '', memoryPolicy: '' });
    } finally {
      setLoading(false);
    }
  };

  const saveConfig = async () => {
    try {
      setLoading(true);
      
      // Serialize prompt_parts to prompt_template
      const composedTemplate = serializePromptFields(promptParts);
      
      const url = `/api/v2/projects/${projectId}/agents/${agentType}/config`;
      const payload = {
        provider: provider,
        model_key: modelKey,
        temperature,
        max_tokens: maxTokens,
        prompt_template: composedTemplate
      };
      
      console.log('[AgentManager] Saving config:', { url, payload });
      console.log('[SAVE_V2] PUT', { projectId, agentType });
      
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
      
      // Test using the project's configured model
      setTestResult({ ok: true, output: { message: 'Test harness not yet wired to runtime' } });
    } catch (err: any) {
      setTestResult({ ok: false, output: { error: err.message } });
    } finally {
      setTestRunning(false);
    }
  };

  const availableModels = useMemo(() => {
    if (!provider) return [] as Array<{key: string; label: string; providerModelId: string}>;
    return modelsByProvider[provider] || [];
  }, [provider, modelsByProvider]);

  const saveDisabled =
    loading ||
    !provider ||
    !modelKey ||
    typeof temperature !== 'number' ||
    typeof maxTokens !== 'number' ||
    !promptParts.role.trim() ||
    !promptParts.goal.trim() ||
    !promptParts.constraints.trim() ||
    !promptParts.ioSchema.trim() ||
    !promptParts.memoryPolicy.trim();

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
        </div>
      )}

      {/* Tab Content */}
      {activeTab === 'Plan' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h3 style={{ margin: 0, color: '#4FA2AD' }}>Agent Configuration</h3>

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
              <label style={{ display: 'block', marginBottom: '4px', color: '#E0DED5' }}>Max Tokens</label>
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
        </div>
      )}

      {activeTab === 'Dashboard' && (
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

              {testResult.output && (
                <div style={{ marginBottom: '12px' }}>
                  <strong style={{ color: '#E0DED5' }}>Output:</strong>
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
                    {JSON.stringify(testResult.output, null, 2)}
                  </pre>
                </div>
              )}

              {testResult.side_effects && (
                <div style={{ marginBottom: '12px' }}>
                  <strong style={{ color: '#E0DED5' }}>Side Effects:</strong>
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
                    {JSON.stringify(testResult.side_effects, null, 2)}
                  </pre>
                </div>
              )}

              {testResult.errors && testResult.errors.length > 0 && (
                <div>
                  <strong style={{ color: '#D98458' }}>Errors:</strong>
                  <ul style={{ marginTop: '8px', paddingLeft: '20px', color: '#D98458' }}>
                    {testResult.errors.map((e: string, i: number) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

    </div>
  );
}
