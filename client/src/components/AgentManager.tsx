import React, { useState, useEffect } from 'react';
import {
  listProjectAgents,
  createProjectAgent,
  updateProjectAgent,
  deleteProjectAgent,
  runProjectAgent,
  getAgentTypes,
  type ProjectAgent,
  type AgentRunResult,
} from '../lib/projectAgentsApi';

interface AgentManagerProps {
  projectId: string;
  activeTab: string;
  onGraphRefresh?: () => void;
}

const DEFAULT_MAIN_CHAT_ROLE_TEXT = `You are the user’s primary assistant (“Sol”).

You speak like a sharp, witty collaborator.

You are direct, technical when needed, and you avoid filler.

You always keep the user moving forward with concrete next steps.`;

const DEFAULT_MAIN_CHAT_GOAL_TEXT = `Help the user build and operate their AI agent system.

Use the Knowledge Graph (Apache AGE) as grounded context when relevant.

Prefer verified, project-specific facts over guessing.`;

const DEFAULT_MAIN_CHAT_CONSTRAINTS_TEXT = `Operating rules

If Knowledge Graph context is available, request it and cite it in your reasoning (briefly).

If context is missing, ask for exactly what you need or propose a fast way to obtain it (e.g., ingest a doc or chat segment).

Never claim something is fixed unless you can point to the exact UI behavior or a specific persisted change that confirms it.

When debugging: isolate the failing component, list the smallest test, and propose the smallest patch.

Output style

Short paragraphs.

Bullets for steps.

No motivational fluff.

Default actions

When the user describes a bug: produce a minimal reproduction path, then a minimal fix.

When the user describes a feature: define the MVP behavior first, then add optional enhancements.`;

const DEFAULT_MAIN_CHAT_MEMORY_POLICY_TEXT = `Assume you may receive Knowledge Graph snippets and/or retrieved notes as context.

Prefer Knowledge Graph facts over assumptions.

If Knowledge Graph conflicts, point it out and ask which is correct.`;

export function AgentManager({ projectId, activeTab, onGraphRefresh }: AgentManagerProps) {
  const [agents, setAgents] = useState<ProjectAgent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<ProjectAgent | null>(null);
  const [loading, setLoading] = useState(false);
  const [showNewAgentModal, setShowNewAgentModal] = useState(false);
  
  // Model registry from backend
  const [availableModels, setAvailableModels] = useState<Array<{key: string; label: string; provider: string}>>([]);
  
  // New agent form
  const [newAgentName, setNewAgentName] = useState('');
  const [newAgentKind, setNewAgentKind] = useState<'openai_main_chat' | 'openrouter_agent'>('openai_main_chat');
  
  // Agent config form (sectioned prompts)
  const [roleText, setRoleText] = useState('');
  const [goalText, setGoalText] = useState('');
  const [constraintsText, setConstraintsText] = useState('');
  const [ioSchemaText, setIoSchemaText] = useState('');
  const [memoryPolicyText, setMemoryPolicyText] = useState('');
  const [selectedModel, setSelectedModel] = useState('gpt-5.1-chat-latest');
  const [temperature, setTemperature] = useState<number>(0);
  const [maxTokens, setMaxTokens] = useState<number>(2048);
  
  // Test harness
  const [testInput, setTestInput] = useState('');
  const [testRunning, setTestRunning] = useState(false);
  const [testResult, setTestResult] = useState<AgentRunResult | null>(null);

  // Load model registry on mount
  useEffect(() => {
    fetch('/api/projects/models')
      .then(res => res.json())
      .then(data => {
        if (data.ok && Array.isArray(data.models)) {
          setAvailableModels(data.models);
        }
      })
      .catch(err => console.error('[AgentManager] Failed to load models:', err));
  }, []);

  // Load agents when project changes
  useEffect(() => {
    if (projectId) {
      loadAgents();
    }
  }, [projectId]);

  // Load selected agent config into form
  useEffect(() => {
    if (selectedAgent) {
      const isMainChat = selectedAgent.agent_type === 'llm_chat';
      const nextRole = selectedAgent.role_text || (isMainChat ? DEFAULT_MAIN_CHAT_ROLE_TEXT : '');
      const nextGoal = selectedAgent.goal_text || (isMainChat ? DEFAULT_MAIN_CHAT_GOAL_TEXT : '');
      const nextConstraints = selectedAgent.constraints_text || (isMainChat ? DEFAULT_MAIN_CHAT_CONSTRAINTS_TEXT : '');
      const nextIoSchema = selectedAgent.io_schema_text || '';
      const nextMemoryPolicy = selectedAgent.memory_policy_text || (isMainChat ? DEFAULT_MAIN_CHAT_MEMORY_POLICY_TEXT : '');

      setRoleText(nextRole);
      setGoalText(nextGoal);
      setConstraintsText(nextConstraints);
      setIoSchemaText(nextIoSchema);
      setMemoryPolicyText(nextMemoryPolicy);
      setSelectedModel(selectedAgent.model || (selectedAgent.agent_type === 'llm_chat' ? 'gpt-5.1-chat-latest' : 'kimi-k2-thinking'));
      setTemperature(selectedAgent.temperature ?? 0);
      setMaxTokens(selectedAgent.max_tokens ?? 2048);
    }
  }, [selectedAgent]);

  const loadAgents = async () => {
    try {
      setLoading(true);
      const agentList = await listProjectAgents(projectId);
      setAgents(agentList);

      try {
        localStorage.setItem(
          `agent-manager:agents:${projectId}`,
          JSON.stringify(agentList)
        );
      } catch {
        // ignore
      }
    } catch (err: any) {
      console.error('Failed to load agents:', err);

      try {
        const cached = localStorage.getItem(`agent-manager:agents:${projectId}`);
        const parsed = cached ? JSON.parse(cached) : null;
        if (Array.isArray(parsed)) {
          setAgents(parsed as ProjectAgent[]);
        }
      } catch {
        // ignore
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCreateAgent = async () => {
    if (!newAgentName.trim()) {
      alert('Agent name is required');
      return;
    }

    try {
      setLoading(true);

      const isMainChat = newAgentKind === 'openai_main_chat';
      const agentType: 'kg_ingest' | 'kg_read' | 'llm_chat' = isMainChat ? 'llm_chat' : 'kg_ingest';
      const model = isMainChat ? 'gpt-5.1-chat-latest' : 'kimi-k2-thinking';
      const agent = await createProjectAgent(projectId, {
        name: newAgentName,
        agent_type: agentType,
        model,
        temperature: 0,
        max_tokens: 2048,

        role_text: isMainChat ? DEFAULT_MAIN_CHAT_ROLE_TEXT : null,
        goal_text: isMainChat ? DEFAULT_MAIN_CHAT_GOAL_TEXT : null,
        constraints_text: isMainChat ? DEFAULT_MAIN_CHAT_CONSTRAINTS_TEXT : null,
        io_schema_text: null,
        memory_policy_text: isMainChat ? DEFAULT_MAIN_CHAT_MEMORY_POLICY_TEXT : null,
      });

      setAgents([...agents, agent]);
      setSelectedAgent(agent);
      setShowNewAgentModal(false);
      setNewAgentName('');
      setNewAgentKind('openai_main_chat');
    } catch (err: any) {
      const errorMsg = err.message || 'Unknown error creating agent';
      alert(`Failed to create agent: ${errorMsg}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveAgent = async () => {
    if (!selectedAgent) return;

    try {
      setLoading(true);
      const updated = await updateProjectAgent(projectId, selectedAgent.agent_id, {
        role_text: roleText,
        goal_text: goalText,
        constraints_text: constraintsText,
        io_schema_text: ioSchemaText,
        memory_policy_text: memoryPolicyText,
        model: selectedModel,
        temperature,
        max_tokens: maxTokens,
      });

      setAgents(agents.map(a => a.agent_id === updated.agent_id ? updated : a));
      setSelectedAgent(updated);

      try {
        const nextAgents = agents.map(a => a.agent_id === updated.agent_id ? updated : a);
        localStorage.setItem(
          `agent-manager:agents:${projectId}`,
          JSON.stringify(nextAgents)
        );
      } catch {
        // ignore
      }

      alert('Agent saved successfully');
    } catch (err: any) {
      // Keep UI usable even if backend is failing: persist locally so Main Chat can use it.
      const localUpdated: ProjectAgent = {
        ...selectedAgent,
        role_text: roleText,
        goal_text: goalText,
        constraints_text: constraintsText,
        io_schema_text: ioSchemaText,
        memory_policy_text: memoryPolicyText,
        model: selectedModel,
        temperature,
        max_tokens: maxTokens,
      };

      setAgents(agents.map(a => a.agent_id === localUpdated.agent_id ? localUpdated : a));
      setSelectedAgent(localUpdated);

      try {
        const nextAgents = agents.map(a => a.agent_id === localUpdated.agent_id ? localUpdated : a);
        localStorage.setItem(
          `agent-manager:agents:${projectId}`,
          JSON.stringify(nextAgents)
        );
      } catch {
        // ignore
      }

      alert(`Failed to save agent to server (saved locally): ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAgent = async () => {
    if (!selectedAgent) return;
    if (!confirm(`Delete agent "${selectedAgent.name}"?`)) return;

    try {
      setLoading(true);
      await deleteProjectAgent(projectId, selectedAgent.agent_id);
      const newAgents = agents.filter(a => a.agent_id !== selectedAgent.agent_id);
      setAgents(newAgents);
      setSelectedAgent(newAgents[0] || null);
    } catch (err: any) {
      alert(`Failed to delete agent: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleRunTest = async () => {
    if (!selectedAgent || !testInput.trim()) {
      alert('Select an agent and enter test input');
      return;
    }

    try {
      setTestRunning(true);
      setTestResult(null);
      
      const result = await runProjectAgent(projectId, selectedAgent.agent_id, testInput);
      setTestResult(result);
      
      // If kg_ingest succeeded, refresh graph
      if (result.ok && result.agent_type === 'kg_ingest' && onGraphRefresh) {
        setTimeout(onGraphRefresh, 500);
      }
    } catch (err: any) {
      setTestResult({
        ok: false,
        agent_id: selectedAgent.agent_id,
        agent_name: selectedAgent.name,
        agent_type: selectedAgent.agent_type,
        output: { error: err.message },
        errors: [err.message],
      });
    } finally {
      setTestRunning(false);
    }
  };

  return (
    <div style={{ padding: '16px' }}>
      {/* Agent Selector */}
      <div style={{ marginBottom: '20px', display: 'flex', gap: '12px', alignItems: 'center' }}>
        <select
          value={selectedAgent?.agent_id || ''}
          onChange={(e) => {
            const agent = agents.find(a => a.agent_id === e.target.value);
            setSelectedAgent(agent || null);
            setTestResult(null);
          }}
          style={{
            flex: 1,
            padding: '8px',
            background: '#2B2B2B',
            color: '#FFF',
            border: '1px solid #3A3A3A',
            borderRadius: '4px',
          }}
        >
          <option value="">Select an agent...</option>
          {agents.map(a => (
            <option key={a.agent_id} value={a.agent_id}>
              {a.name} ({a.agent_type})
            </option>
          ))}
        </select>
        
        <button
          onClick={() => setShowNewAgentModal(true)}
          style={{
            padding: '8px 16px',
            background: '#4FA2AD',
            color: '#FFF',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          + New Agent
        </button>
        
        {selectedAgent && (
          <button
            onClick={handleDeleteAgent}
            style={{
              padding: '8px 16px',
              background: '#D98458',
              color: '#FFF',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Delete
          </button>
        )}
      </div>

      {/* Tab Content */}
      {selectedAgent && activeTab === 'Plan' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h3 style={{ margin: 0, color: '#4FA2AD' }}>{`Agent Configuration — ${selectedAgent.name}`}</h3>

          <div>
            <label style={{ display: 'block', marginBottom: '4px', color: '#E0DED5' }}>Model</label>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                background: '#2B2B2B',
                color: '#FFF',
                border: '1px solid #3A3A3A',
                borderRadius: '4px',
              }}
            >
              {availableModels
                .filter(m => selectedAgent?.agent_type === 'llm_chat' ? m.provider === 'openai' : m.provider === 'openrouter')
                .map(m => (
                  <option key={m.key} value={m.key}>
                    {m.label} ({m.provider === 'openai' ? 'OpenAI' : 'OpenRouter'})
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
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
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
                onChange={(e) => setMaxTokens(parseInt(e.target.value))}
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
              value={roleText}
              onChange={(e) => setRoleText(e.target.value)}
              placeholder="Define the agent's role and persona..."
              rows={3}
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

          <div>
            <label style={{ display: 'block', marginBottom: '4px', color: '#E0DED5' }}>Goal</label>
            <textarea
              value={goalText}
              onChange={(e) => setGoalText(e.target.value)}
              placeholder="What is this agent trying to achieve?"
              rows={3}
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

          <div>
            <label style={{ display: 'block', marginBottom: '4px', color: '#E0DED5' }}>Constraints</label>
            <textarea
              value={constraintsText}
              onChange={(e) => setConstraintsText(e.target.value)}
              placeholder="Rules and limitations..."
              rows={3}
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

          <div>
            <label style={{ display: 'block', marginBottom: '4px', color: '#E0DED5' }}>Input/Output Schema</label>
            <textarea
              value={ioSchemaText}
              onChange={(e) => setIoSchemaText(e.target.value)}
              placeholder="Expected input format and output structure..."
              rows={3}
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

          <div>
            <label style={{ display: 'block', marginBottom: '4px', color: '#E0DED5' }}>Memory Policy</label>
            <textarea
              value={memoryPolicyText}
              onChange={(e) => setMemoryPolicyText(e.target.value)}
              placeholder="How should this agent use memory/context?"
              rows={3}
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
            onClick={handleSaveAgent}
            disabled={loading}
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

      {selectedAgent && activeTab === 'Dashboard' && (
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
                    {testResult.errors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* New Agent Modal */}
      {showNewAgentModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}>
          <div style={{
            background: '#2B2B2B',
            border: '1px solid #3A3A3A',
            borderRadius: '8px',
            padding: '24px',
            width: '500px',
            maxWidth: '90%',
          }}>
            <h3 style={{ margin: '0 0 20px 0', color: '#4FA2AD' }}>Create New Agent</h3>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '4px', color: '#E0DED5' }}>Agent Name</label>
              <input
                type="text"
                value={newAgentName}
                onChange={(e) => setNewAgentName(e.target.value)}
                placeholder="e.g., Knowledge Builder"
                style={{
                  width: '100%',
                  padding: '8px',
                  background: '#1F1F1F',
                  color: '#FFF',
                  border: '1px solid #3A3A3A',
                  borderRadius: '4px',
                }}
              />
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '4px', color: '#E0DED5' }}>Agent Type</label>
              <select
                value={newAgentKind}
                onChange={(e) => setNewAgentKind(e.target.value as any)}
                style={{
                  width: '100%',
                  padding: '8px',
                  background: '#1F1F1F',
                  color: '#FFF',
                  border: '1px solid #3A3A3A',
                  borderRadius: '4px',
                }}
              >
                <option value="openai_main_chat">OpenAI / Main Chat Agent</option>
                <option value="openrouter_agent">OpenRouter Agent</option>
              </select>
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                onClick={handleCreateAgent}
                disabled={loading || !newAgentName.trim()}
                style={{
                  flex: 1,
                  padding: '10px',
                  background: '#4FA2AD',
                  color: '#FFF',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: loading || !newAgentName.trim() ? 'not-allowed' : 'pointer',
                  fontWeight: 'bold',
                }}
              >
                {loading ? 'Creating...' : 'Create'}
              </button>
              <button
                onClick={() => {
                  setShowNewAgentModal(false);
                  setNewAgentName('');
                  setNewAgentKind('openai_main_chat');
                }}
                style={{
                  flex: 1,
                  padding: '10px',
                  background: '#3A3A3A',
                  color: '#FFF',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
