import { useState, useEffect, useMemo } from 'react';
import { getProjectAssistAssignments, setProjectAssistAssignments } from '../lib/projectAgentsApi';

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
  assistProjectId?: string;
}

export function AgentManager({ projectId, agentType, activeTab, assistProjectId }: AgentManagerProps) {
  const urlProjectId = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const params = new URLSearchParams(window.location.search);
    return params.get('projectId')?.trim() || '';
  }, []);
  const urlAssistProjectId = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const params = new URLSearchParams(window.location.search);
    return params.get('assistProjectId')?.trim() || '';
  }, []);
  const resolvedProjectId = projectId || urlProjectId;
  const resolvedAssistProjectId = assistProjectId || urlAssistProjectId;
  const isAgentBuilder = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return window.location.pathname.includes('agentbuilder');
  }, []);
  const [loading, setLoading] = useState(false);
  
  // Model registry from backend (grouped by provider)
  const [modelsByProvider, setModelsByProvider] = useState<Record<string, Array<{key: string; label: string; providerModelId: string}>>>({});
  
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
  const [versions, setVersions] = useState<any[]>([]);
  const [versionsEnabled, setVersionsEnabled] = useState<boolean>(true);
  const [versionNote, setVersionNote] = useState('');
  const [agentId, setAgentId] = useState<string>('');
  const [assistAssignments, setAssistAssignments] = useState<{
    assist_main_agent_id: string | null;
    assist_kg_ingest_agent_id: string | null;
  } | null>(null);
  const [assistAssignError, setAssistAssignError] = useState<string | null>(null);
  const [assistAssignLoading, setAssistAssignLoading] = useState(false);
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
          setVersions([]);
        }
        return;
      }

      const { agent_id, provider: fetchedProvider, model_key, temperature: fetchedTemp, max_tokens: fetchedMax, prompt_template } = data.config;
      setAgentId(typeof agent_id === 'string' ? agent_id : '');
      setProvider(fetchedProvider || '');
      setModelKey(model_key || '');
      setTemperature(typeof fetchedTemp === 'number' ? fetchedTemp : '');
      setMaxTokens(typeof fetchedMax === 'number' ? fetchedMax : '');
      setCreditStats(null);
      setDeckVersion(1);
      const template = prompt_template || '';
      setPromptParts(parsePromptTemplate(template));
      if (Array.isArray(data?.missing) && data.missing.length) {
        setConfigError(`Configuration incomplete for ${agentType}: missing ${data.missing.join(', ')}.`);
      } else {
        setConfigError(null);
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
      setProvider('');
      setModelKey('');
      setTemperature('');
      setMaxTokens('');
      setPromptParts({ role: '', goal: '', constraints: '', ioSchema: '', memoryPolicy: '' });
      setAgentId('');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    console.log('[AgentManager] assistProjectId effect - assistProjectId:', resolvedAssistProjectId);
    if (!resolvedAssistProjectId) {
      console.log('[AgentManager] Clearing assignments - no assistProjectId');
      setAssistAssignments(null);
      return;
    }
    let canceled = false;
    (async () => {
      try {
        console.log('[AgentManager] Fetching assignments for assistProjectId:', resolvedAssistProjectId);
        const assignments = await getProjectAssistAssignments(resolvedAssistProjectId);
        console.log('[AgentManager] Assignments loaded:', assignments);
        if (!canceled) {
          setAssistAssignments(assignments);
        }
      } catch (err: any) {
        console.error('[AgentManager] Failed to load assignments:', err);
        if (!canceled) {
          setAssistAssignments(null);
        }
      }
    })();
    return () => {
      canceled = true;
    };
  }, [resolvedAssistProjectId]);

  const saveConfig = async () => {
    try {
      setLoading(true);
      setSaveSuccess(null);
      
      // Serialize prompt_parts to prompt_template
      const composedTemplate = serializePromptFields(promptParts);
      
      const url = `/api/v2/projects/${resolvedProjectId}/agents/${agentType}/config`;
      const payload: any = {
        provider: provider,
        model_key: modelKey,
        max_tokens: maxTokens,
        prompt_template: composedTemplate,
        version_note: versionNote || null,
      };
      if (modelKey && modelKey.startsWith('gpt-5')) {
        if (typeof temperature === 'number') {
          payload.temperature = temperature;
        }
      } else {
        payload.temperature = temperature;
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
    (!modelKey.startsWith('gpt-5') && typeof temperature !== 'number') ||
    (modelKey.startsWith('gpt-5') && typeof temperature !== 'number' && temperature !== '') ||
    typeof maxTokens !== 'number' ||
    !promptParts.role.trim() ||
    !promptParts.goal.trim() ||
    !promptParts.constraints.trim() ||
    !promptParts.ioSchema.trim() ||
    !promptParts.memoryPolicy.trim();
  const assignLabel = agentType === 'llm_chat' ? 'Assist Chat' : 'Assist KG Ingest';
  const assignedId =
    assistAssignments &&
    (agentType === 'llm_chat'
      ? assistAssignments.assist_main_agent_id
      : assistAssignments.assist_kg_ingest_agent_id);
  const isAssigned = Boolean(assignedId && resolvedProjectId && assignedId === resolvedProjectId);

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
          {isAgentBuilder && resolvedAssistProjectId && (
            <div
              style={{
                padding: '10px 12px',
                border: '1px solid #3A3A3A',
                borderRadius: '6px',
                background: '#1A1A1A',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <div style={{ color: '#E0DED5', fontSize: 12 }}>
                Assignments
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <button
                  onClick={async () => {
                    if (!resolvedAssistProjectId || !resolvedProjectId) return;
                    setAssistAssignLoading(true);
                    setAssistAssignError(null);
                    try {
                      // Build payload conditionally to avoid sending undefined fields
                      const payload: any = {};
                      if (agentType === 'llm_chat') {
                        payload.assist_main_agent_id = resolvedProjectId;
                      } else {
                        payload.assist_kg_ingest_agent_id = resolvedProjectId;
                      }
                      console.log('[UI_ASSIGN] assistProjectId=%s payload=%o', resolvedAssistProjectId, payload);
                      const next = await setProjectAssistAssignments(resolvedAssistProjectId, payload);
                      // Immediately re-fetch assignments to ensure UI is in sync
                      const refreshed = await getProjectAssistAssignments(resolvedAssistProjectId);
                      setAssistAssignments(refreshed);
                      console.log('[UI_ASSIGN] Refreshed assignments:', refreshed);
                    } catch (err: any) {
                      setAssistAssignError(err?.message || 'Failed to update assignment');
                    } finally {
                      setAssistAssignLoading(false);
                    }
                  }}
                  disabled={assistAssignLoading || !resolvedProjectId || isAssigned}
                  style={{
                    padding: '6px 10px',
                    background: isAssigned ? '#1f403f' : '#2B2B2B',
                    color: '#FFF',
                    border: '1px solid #3A3A3A',
                    borderRadius: 4,
                    fontSize: 12,
                    cursor: assistAssignLoading || isAssigned ? 'not-allowed' : 'pointer',
                  }}
                >
                  {isAssigned ? `Assigned to ${assignLabel}` : `Use for ${assignLabel}`}
                </button>
                {!resolvedProjectId && (
                  <div style={{ color: '#D98458', fontSize: 12 }}>
                    Select an agent project to assign.
                  </div>
                )}
              </div>
              {assistAssignError && (
                <div style={{ color: '#D98458', fontSize: 12 }}>
                  {assistAssignError}
                </div>
              )}
            </div>
          )}
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
