import React, { useState, useRef, useEffect } from 'react';
import D3KnowledgeGraph from '../components/d3-knowledge-graph';
import { solRun } from '../lib/api';

interface Agent {
  id: string;
  name: string;
  type: 'orchestrator' | 'code' | 'marketing' | 'research';
  persona: string;
  keywords: string[];
  status: 'active' | 'training' | 'testing' | 'inactive';
  performance: { accuracy: number; speed: number; satisfaction: number };
  created: string;
  lastTested?: string;
}

interface Artifact {
  id: string;
  type: 'code' | 'document' | 'workflow' | 'knowledge-graph';
  title: string;
  content: string;
  agentId: string;
  created: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'agent';
  content: string;
  timestamp: string;
  agentName?: string;
}

export default function AgentManager() {
  const [activeTab, setActiveTab] = useState<'chat' | 'agents' | 'canvas' | 'artifacts' | 'n8n' | 'parameters' | 'tools'>('chat');
  const [agents, setAgents] = useState<Agent[]>([
    {
      id: 'gpt5-orchestrator',
      name: 'GPT-5 Orchestrator',
      type: 'orchestrator',
      persona: 'Main AI orchestrator that coordinates specialized agents',
      keywords: ['orchestrate', 'manage', 'plan', 'coordinate'],
      status: 'active',
      performance: { accuracy: 95, speed: 87, satisfaction: 92 },
      created: '2025-01-01'
    },
    {
      id: 'kimi-code',
      name: 'Kimi Code Specialist',
      type: 'code',
      persona: 'Expert coding assistant using Kimi K2',
      keywords: ['code', 'programming', 'debug', 'function'],
      status: 'active',
      performance: { accuracy: 89, speed: 94, satisfaction: 88 },
      created: '2025-01-01'
    }
  ]);
  
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(agents[0]);
  const [canvasNodes, setCanvasNodes] = useState<any[]>([]);
  const [testQuery, setTestQuery] = useState('');
  const [testResults, setTestResults] = useState('');
  const [codeToRun, setCodeToRun] = useState('// Write your code here\nconsole.log("Hello from AI Agent!");');
  const [codeOutput, setCodeOutput] = useState('');
  const [newAgentForm, setNewAgentForm] = useState({
    name: '',
    type: 'code' as Agent['type'],
    persona: '',
    keywords: ''
  });

  // Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      role: 'agent',
      content: 'Hello! I\'m your AI Agent Manager. How can I help you today?',
      timestamp: new Date().toISOString(),
      agentName: 'GPT-5 Orchestrator'
    }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [mcpTools, setMcpTools] = useState<any[]>([]);
  const [selectedTool, setSelectedTool] = useState<string>('');
  const [agentParameters, setAgentParameters] = useState({
    temperature: 0.7,
    maxTokens: 2000,
    model: 'gpt-4',
    systemPrompt: '',
    tools: [],
    dataConnections: [],
    mathModels: []
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Scroll to bottom of chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Canvas drawing for agent workflow visualization
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw agent workflow
    agents.forEach((agent, index) => {
      const x = 100 + (index * 200);
      const y = 150;
      
      // Agent node
      ctx.fillStyle = agent.status === 'active' ? '#10b981' : '#6b7280';
      ctx.fillRect(x, y, 150, 80);
      
      // Agent text
      ctx.fillStyle = 'white';
      ctx.font = '12px Arial';
      ctx.fillText(agent.name, x + 10, y + 20);
      ctx.fillText(`Type: ${agent.type}`, x + 10, y + 40);
      ctx.fillText(`Status: ${agent.status}`, x + 10, y + 60);
      
      // Connection lines
      if (index > 0) {
        ctx.strokeStyle = '#374151';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x - 50, y + 40);
        ctx.lineTo(x, y + 40);
        ctx.stroke();
      }
    });
  }, [agents]);

  // Load available MCP tools
  useEffect(() => {
    fetch('/api/mcp/available-tools')
      .then(res => res.json())
      .then(data => setMcpTools(data.tools || []))
      .catch(err => console.error('Failed to load MCP tools:', err));
  }, []);

  const sendChatMessage = async () => {
    if (!chatInput.trim() || !selectedAgent) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: chatInput,
      timestamp: new Date().toISOString()
    };

    setChatMessages(prev => [...prev, userMessage]);
    setChatInput('');
    setIsTyping(true);

    try {
      const result = await solRun(chatInput);
      const agentResponse = result.ok ? result.text : `❗ ${result.text}`;
      
      const agentMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'agent',
        content: agentResponse,
        timestamp: new Date().toISOString(),
        agentName: selectedAgent.name
      };

      setChatMessages(prev => [...prev, agentMessage]);
    } catch (error) {
      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'agent',
        content: `❗ Network error: ${error}`,
        timestamp: new Date().toISOString(),
        agentName: selectedAgent.name
      };
      setChatMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  };

  const createAgent = () => {
    if (!newAgentForm.name.trim()) return;
    
    const newAgent: Agent = {
      id: `agent-${Date.now()}`,
      name: newAgentForm.name,
      type: newAgentForm.type,
      persona: newAgentForm.persona,
      keywords: newAgentForm.keywords.split(',').map(k => k.trim()),
      status: 'training',
      performance: { accuracy: 0, speed: 0, satisfaction: 0 },
      created: new Date().toISOString().split('T')[0]
    };
    
    setAgents([...agents, newAgent]);
    setNewAgentForm({ name: '', type: 'code', persona: '', keywords: '' });
  };

  const testAgent = async (agent: Agent) => {
    if (!testQuery.trim()) return;
    
    setTestResults('Testing agent...');
    
    try {
      const response = await fetch('/sol/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goal: testQuery,
          agentMode: agent.type === 'orchestrator' ? 'orchestrator' : 'specialized',
          agentType: agent.type === 'orchestrator' ? 'code' : agent.type // Ensure valid types: code, marketing, research
        })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = await response.json();
      setTestResults(result.results?.__final__ || result.text || 'No response');
      
      // Update agent performance (mock)
      const updatedAgents = agents.map(a => 
        a.id === agent.id 
          ? { ...a, lastTested: new Date().toISOString(), performance: Math.floor(Math.random() * 40) + 60 }
          : a
      );
      setAgents(updatedAgents);
      
    } catch (error) {
      console.error('Error testing agent:', error);
      setTestResults(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const runCode = () => {
    try {
      // Simple code execution simulation
      const result = eval(codeToRun);
      setCodeOutput(String(result));
    } catch (error) {
      setCodeOutput(`Error: ${error}`);
    }
  };

  const installMCPTool = async (toolId: string) => {
    try {
      const response = await fetch('/api/mcp/install-tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolId })
      });
      const result = await response.json();
      if (result.ok) {
        console.log(`✅ Installed MCP tool: ${toolId}`);
        // Refresh tools list
        const toolsResponse = await fetch('/api/mcp/installed-tools');
        const toolsData = await toolsResponse.json();
        setMcpTools(toolsData.tools || []);
      }
    } catch (error) {
      console.error('Failed to install MCP tool:', error);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">🤖 AI Agent Manager</h1>
          <div className="flex space-x-4">
            {['chat', 'agents', 'canvas', 'artifacts', 'n8n', 'parameters', 'tools'].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab as any)}
                className={`px-4 py-2 rounded-lg font-medium ${
                  activeTab === tab
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {tab === 'chat' ? '💬 Chat' : tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="flex h-screen">
        {/* Main Content */}
        <main className="flex-1 p-6">
          {activeTab === 'chat' && (
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 h-full">
              {/* Chat Interface */}
              <div className="lg:col-span-3 bg-white rounded-lg shadow flex flex-col">
                <div className="p-4 border-b">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xl font-semibold">Agent Chat</h2>
                    <div className="flex items-center space-x-2">
                      <span className="text-sm text-gray-600">Active Agent:</span>
                      <select
                        value={selectedAgent?.id || ''}
                        onChange={(e) => setSelectedAgent(agents.find(a => a.id === e.target.value) || null)}
                        className="border rounded px-2 py-1 text-sm"
                      >
                        {agents.map(agent => (
                          <option key={agent.id} value={agent.id}>
                            {agent.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                {/* Chat Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {chatMessages.map((message) => (
                    <div
                      key={message.id}
                      className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                          message.role === 'user'
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 text-gray-900'
                        }`}
                      >
                        {message.role === 'agent' && message.agentName && (
                          <div className="text-xs text-gray-600 mb-1 font-medium">
                            {message.agentName}
                          </div>
                        )}
                        <div className="whitespace-pre-wrap">{message.content}</div>
                        <div className={`text-xs mt-1 ${
                          message.role === 'user' ? 'text-blue-200' : 'text-gray-500'
                        }`}>
                          {new Date(message.timestamp).toLocaleTimeString()}
                        </div>
                      </div>
                    </div>
                  ))}
                  
                  {isTyping && (
                    <div className="flex justify-start">
                      <div className="bg-gray-100 text-gray-900 px-4 py-2 rounded-lg">
                        <div className="flex items-center space-x-1">
                          <div className="flex space-x-1">
                            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
                            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
                          </div>
                          <span className="text-sm text-gray-600 ml-2">Agent is typing...</span>
                        </div>
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>

                {/* Chat Input */}
                <div className="p-4 border-t">
                  <div className="flex space-x-2">
                    <textarea
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyPress={handleKeyPress}
                      placeholder="Type your message here... (Press Enter to send, Shift+Enter for new line)"
                      className="flex-1 border rounded-lg px-3 py-2 resize-none"
                      rows={2}
                      disabled={isTyping}
                    />
                    <button
                      onClick={sendChatMessage}
                      disabled={!chatInput.trim() || isTyping}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                    >
                      Send
                    </button>
                  </div>
                </div>
              </div>

              {/* Agent Status Panel */}
              <div className="space-y-4">
                <div className="bg-white rounded-lg shadow p-4">
                  <h3 className="font-semibold mb-3">Active Agents</h3>
                  <div className="space-y-2">
                    {agents.map((agent) => (
                      <div
                        key={agent.id}
                        className={`p-2 rounded border cursor-pointer ${
                          selectedAgent?.id === agent.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                        }`}
                        onClick={() => setSelectedAgent(agent)}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">{agent.name}</span>
                          <div className={`w-2 h-2 rounded-full ${
                            agent.status === 'active' ? 'bg-green-400' : 'bg-gray-400'
                          }`}></div>
                        </div>
                        <div className="text-xs text-gray-600">{agent.type}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-white rounded-lg shadow p-4">
                  <h3 className="font-semibold mb-3">Quick Actions</h3>
                  <div className="space-y-2">
                    <button
                      onClick={() => setChatMessages([{
                        id: Date.now().toString(),
                        role: 'agent',
                        content: 'Chat cleared! How can I help you?',
                        timestamp: new Date().toISOString(),
                        agentName: selectedAgent?.name
                      }])}
                      className="w-full px-3 py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 text-sm"
                    >
                      Clear Chat
                    </button>
                    <button
                      onClick={() => setActiveTab('parameters')}
                      className="w-full px-3 py-2 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 text-sm"
                    >
                      Agent Settings
                    </button>
                    <button
                      onClick={() => setActiveTab('tools')}
                      className="w-full px-3 py-2 bg-green-100 text-green-700 rounded hover:bg-green-200 text-sm"
                    >
                      MCP Tools
                    </button>
                    <button
                      onClick={() => window.location.href = '/boss-agent'}
                      className="w-full px-3 py-2 bg-purple-100 text-purple-700 rounded hover:bg-purple-200 text-sm"
                    >
                      🎯 Boss Agent
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'agents' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Agent List */}
              <div className="bg-white rounded-lg shadow">
                <div className="p-6 border-b">
                  <h2 className="text-xl font-semibold">Your Agents</h2>
                </div>
                <div className="divide-y">
                  {agents.map((agent) => (
                    <div 
                      key={agent.id} 
                      className={`p-4 cursor-pointer hover:bg-gray-50 ${
                        selectedAgent?.id === agent.id ? 'bg-blue-50 border-l-4 border-blue-600' : ''
                      }`}
                      onClick={() => setSelectedAgent(agent)}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="font-medium">{agent.name}</h3>
                          <p className="text-sm text-gray-600">{agent.type} • {agent.status}</p>
                        </div>
                        <div className={`w-3 h-3 rounded-full ${
                          agent.status === 'active' ? 'bg-green-400' : 
                          agent.status === 'training' ? 'bg-yellow-400' : 'bg-gray-400'
                        }`}></div>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">{agent.persona}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Create New Agent */}
              <div className="bg-white rounded-lg shadow">
                <div className="p-6 border-b">
                  <h2 className="text-xl font-semibold">Create New Agent</h2>
                </div>
                <div className="p-6 space-y-4">
                  <input
                    type="text"
                    placeholder="Agent Name"
                    value={newAgentForm.name}
                    onChange={(e) => setNewAgentForm({...newAgentForm, name: e.target.value})}
                    className="w-full border rounded px-3 py-2"
                  />
                  <select
                    value={newAgentForm.type}
                    onChange={(e) => setNewAgentForm({...newAgentForm, type: e.target.value as Agent['type']})}
                    className="w-full border rounded px-3 py-2"
                  >
                    <option value="code">🔧 Code Specialist</option>
                    <option value="marketing">📈 Marketing Expert</option>
                    <option value="research">🔍 Research Analyst</option>
                    <option value="orchestrator">🧠 Orchestrator</option>
                  </select>
                  <textarea
                    placeholder="Agent Persona & Instructions"
                    value={newAgentForm.persona}
                    onChange={(e) => setNewAgentForm({...newAgentForm, persona: e.target.value})}
                    className="w-full border rounded px-3 py-2"
                    rows={3}
                  />
                  <input
                    type="text"
                    placeholder="Keywords (comma-separated)"
                    value={newAgentForm.keywords}
                    onChange={(e) => setNewAgentForm({...newAgentForm, keywords: e.target.value})}
                    className="w-full border rounded px-3 py-2"
                  />
                  <button
                    onClick={createAgent}
                    className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700"
                  >
                    🚀 Create Agent
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'canvas' && (
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-xl font-semibold mb-4">Agent Workflow Canvas</h2>
              <div className="border rounded-lg p-4">
                <canvas
                  ref={canvasRef}
                  width={800}
                  height={400}
                  className="border rounded"
                  style={{ maxWidth: '100%' }}
                />
              </div>
              <div className="mt-4 flex space-x-4">
                <button className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
                  Add Node
                </button>
                <button className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700">
                  Connect Agents
                </button>
                <button className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700">
                  Save Workflow
                </button>
              </div>
            </div>
          )}

          {activeTab === 'artifacts' && (
            <div className="bg-white rounded-lg shadow">
              <div className="p-6 border-b">
                <h2 className="text-xl font-semibold">Generated Artifacts</h2>
              </div>
              <div className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {artifacts.length === 0 ? (
                    <div className="col-span-full text-center text-gray-500 py-8">
                      No artifacts generated yet. Create and test agents to generate artifacts.
                    </div>
                  ) : (
                    artifacts.map((artifact) => (
                      <div key={artifact.id} className="border rounded-lg p-4">
                        <h3 className="font-medium">{artifact.title}</h3>
                        <p className="text-sm text-gray-600">{artifact.type}</p>
                        <p className="text-xs text-gray-500 mt-2">{artifact.created}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'n8n' && (
            <div className="bg-white rounded-lg shadow">
              <div className="p-6 border-b">
                <h2 className="text-xl font-semibold">n8n Workflow Integration</h2>
              </div>
              <div className="p-6">
                <div className="border-2 border-dashed border-gray-300 rounded-lg h-96 flex items-center justify-center">
                  <div className="text-center">
                    <div className="text-4xl mb-4">🔗</div>
                    <h3 className="text-lg font-medium text-gray-900 mb-2">n8n Workflow Viewer</h3>
                    <p className="text-gray-600 mb-4">Connect to your n8n instance to view and manage workflows</p>
                    <button className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
                      Connect to n8n
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'parameters' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Agent Parameters */}
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-xl font-semibold mb-4">🔧 Agent Parameters</h2>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Model</label>
                    <select
                      value={agentParameters.model}
                      onChange={(e) => setAgentParameters({...agentParameters, model: e.target.value})}
                      className="w-full border rounded px-3 py-2"
                    >
                      <option value="gpt-4">GPT-4</option>
                      <option value="gpt-4-turbo">GPT-4 Turbo</option>
                      <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
                    </select>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium mb-2">Temperature: {agentParameters.temperature}</label>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.1"
                      value={agentParameters.temperature}
                      onChange={(e) => setAgentParameters({...agentParameters, temperature: parseFloat(e.target.value)})}
                      className="w-full"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2">Max Tokens</label>
                    <input
                      type="number"
                      value={agentParameters.maxTokens}
                      onChange={(e) => setAgentParameters({...agentParameters, maxTokens: parseInt(e.target.value)})}
                      className="w-full border rounded px-3 py-2"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2">System Prompt</label>
                    <textarea
                      value={agentParameters.systemPrompt}
                      onChange={(e) => setAgentParameters({...agentParameters, systemPrompt: e.target.value})}
                      className="w-full border rounded px-3 py-2"
                      rows={4}
                      placeholder="Enter system prompt for the agent..."
                    />
                  </div>
                </div>
              </div>

              {/* Knowledge Graph Visualization */}
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-xl font-semibold mb-4">🧠 Knowledge Graph</h2>
                <D3KnowledgeGraph
                  nodes={[]}
                  width={400}
                  height={300}
                  onNodeClick={(node) => console.log('Selected node:', node)}
                />
              </div>
            </div>
          )}

          {activeTab === 'tools' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Available MCP Tools */}
              <div className="bg-white rounded-lg shadow">
                <div className="p-6 border-b">
                  <h2 className="text-xl font-semibold">🔌 Available MCP Tools</h2>
                </div>
                <div className="divide-y max-h-96 overflow-y-auto">
                  {mcpTools.map((tool) => (
                    <div key={tool.id} className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="font-medium">{tool.name}</h3>
                          <p className="text-sm text-gray-600">{tool.description}</p>
                          <div className="flex space-x-2 mt-2">
                            {tool.capabilities?.map((cap: string) => (
                              <span key={cap} className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded">
                                {cap}
                              </span>
                            ))}
                          </div>
                        </div>
                        <button
                          onClick={() => installMCPTool(tool.id)}
                          className="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700"
                        >
                          Install
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Data Collection Setup */}
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-xl font-semibold mb-4">📊 Data Collection</h2>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">YouTube URLs</label>
                    <textarea
                      className="w-full border rounded px-3 py-2"
                      rows={3}
                      placeholder="Enter YouTube URLs (one per line)"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium mb-2">News Search Queries</label>
                    <input
                      type="text"
                      className="w-full border rounded px-3 py-2"
                      placeholder="AI, technology, market trends"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2">Google Sheets ID</label>
                    <input
                      type="text"
                      className="w-full border rounded px-3 py-2"
                      placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"
                    />
                  </div>

                  <button className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700">
                    🚀 Start Data Collection
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
