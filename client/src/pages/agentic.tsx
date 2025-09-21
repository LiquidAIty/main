import React, { useState, useMemo } from "react";
import { ChatInterface, Message } from "../components/chat-interface";
import { KnowledgePanel, Triple, HistoryItem } from "../components/knowledge-panel";
import { TimeSeriesPoint, BandPoint, EventPoint } from "../components/timeseries-chart";
import { solRun, callBossAgent } from "../lib/api";

// Theme colors
const C = {
  bg: "#0B0C0E",
  panel: "#121317",
  border: "#2A2F36",
  text: "#E9EEF5",
  muted: "#9AA3B2",
  primary: "#6EFAFB",   // turquoise
  accent:  "#E2725B",   // terra cotta
  neutral: "#6E7E85",   // gray
};

// Small helpers
const now = new Date();
const tAgo = (d: number) => new Date(now.getTime() - d*24*60*60*1000).toISOString();
const tFwd = (d: number) => new Date(now.getTime() + d*24*60*60*1000).toISOString();
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

interface Project {
  id: string;
  title: string;
  desc: string;
}

export default function Agentic() {
  // Layout
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelWidth, setPanelWidth] = useState(560);
  const [tab, setTab] = useState("Plan");
  const tabs = ["Plan", "Workflow", "Knowledge", "Links", "Report"];

  // Chat state
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", text: "Welcome back. How can I help you today? Select a domain or start chatting." },
  ]);
  const [isLoading, setIsLoading] = useState(false);
  
  // BossAgent state
  const [currentProjectId, setCurrentProjectId] = useState<string>("default");
  const [currentDomain, setCurrentDomain] = useState<string>("general");
  const [planContent, setPlanContent] = useState<string>("");
  const [workflowContent, setWorkflowContent] = useState<string>("");
  const [reportContent, setReportContent] = useState<string>("");
  const [isBossAgentActive, setIsBossAgentActive] = useState(false);
  const [bossAgentThinking, setBossAgentThinking] = useState(false);
  const [lastProcessedMessageIndex, setLastProcessedMessageIndex] = useState(0);

  const prefabChats: Record<string, Message[]> = {
    research: [
      { role: "assistant", text: "Switched to Research domain. I can help with papers, facts, and knowledge graph updates." },
    ],
    marketing: [
      { role: "assistant", text: "Switched to Marketing domain. Let's discuss ICP, messaging, and campaign planning." },
    ],
    trading: [
      { role: "assistant", text: "Switched to Trading domain. I can help with strategy simulation and analysis." },
    ],
    planning: [
      { role: "assistant", text: "Switched to Planning domain. I can help organize projects and create roadmaps." },
    ],
  };

  function chooseMode(mode: string) {
    // Add a message indicating the mode change
    setMessages(prev => [
      ...prev,
      ...(prefabChats[mode] || [{ role: "assistant", text: `Switched to ${mode} domain.` }])
    ]);
    
    // Open the panel
    setPanelOpen(true);
    setTab("Plan");
    
    // Set domain based on mode
    setCurrentDomain(mode);
    setCurrentProjectId(mode);
    
    // Activate BossAgent
    setIsBossAgentActive(true);
    setLastProcessedMessageIndex(messages.length);
    
    // Reset content in tabs
    setPlanContent("");
    setWorkflowContent("");
    setReportContent("");
    
    // Trigger BossAgent analysis after a short delay
    setTimeout(() => {
      processChatWithBossAgent();
    }, 1000);
  }

  // Process chat with BossAgent
  async function processChatWithBossAgent() {
    if (!isBossAgentActive || messages.length <= lastProcessedMessageIndex) {
      return;
    }
    
    // Get all unprocessed messages
    const unprocessedMessages = messages.slice(lastProcessedMessageIndex);
    
    // Extract user messages only
    const userMessages = unprocessedMessages.filter(msg => msg.role === 'user');
    
    if (userMessages.length === 0) {
      return;
    }
    
    // Combine all user messages into a single goal
    const goal = userMessages.map(msg => msg.text).join("\n");
    
    // Set thinking state
    setBossAgentThinking(true);
    
    try {
      // Call BossAgent API
      const response = await callBossAgent({
        projectId: currentProjectId,
        goal,
        domain: currentDomain
      });
      
      if (response.ok) {
        // Update plan content
        if (response.result.departments?.planning) {
          setPlanContent(response.result.departments.planning);
        }
        
        // Update workflow content
        if (response.result.departments?.workflow) {
          setWorkflowContent(response.result.departments.workflow);
        }
        
        // Update report content
        if (response.result.departments?.report) {
          setReportContent(response.result.departments.report);
        }
      } else {
        console.error('Error from BossAgent:', response.result.final);
      }
      
      // Update last processed message index
      setLastProcessedMessageIndex(messages.length);
    } catch (error) {
      console.error('Error processing chat with BossAgent:', error);
    } finally {
      setBossAgentThinking(false);
    }
  }

  // Knowledge demo data + state
  const DEMO_TRIPLES = useMemo(() => ([
    { id: "t1", a: "OpenAI", r: "develops", b: "GPT-4", source: "example", confidence: 0.92, verified: true },
    { id: "t2", a: "Acme Corp", r: "competes_with", b: "Globex", source: "example", confidence: 0.74, verified: true },
    { id: "t3", a: "NVIDIA", r: "produces", b: "H100", source: "example", confidence: 0.88, verified: true },
    { id: "t4", a: "GPT-4", r: "is_part_of", b: "OpenAI Models", source: "example", confidence: 0.90, verified: true },
  ]), []);

  const [kgTriples, setKgTriples] = useState<Triple[]>(DEMO_TRIPLES);
  const [suggestedTriples, setSuggestedTriples] = useState<Triple[]>([
    { id: "s1", a: "OpenAI", r: "partners_with", b: "NVIDIA", source: "chat:msg#101", confidence: 0.66, verified: false },
    { id: "s2", a: "Company A", r: "acquires", b: "Startup B", source: "file:news.pdf", confidence: 0.82, verified: false },
  ]);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  // Demo time-series for the timeline view
  const tsSeries = useMemo(() => [
    { ts: tAgo(14), y: 42, type: 'actual' as const },
    { ts: tAgo(12), y: 48, type: 'actual' as const },
    { ts: tAgo(10), y: 45, type: 'actual' as const },
    { ts: tAgo(8),  y: 53, type: 'actual' as const },
    { ts: tAgo(6),  y: 58, type: 'actual' as const },
    { ts: tAgo(4),  y: 55, type: 'actual' as const },
    { ts: tAgo(2),  y: 60, type: 'actual' as const },
    { ts: tAgo(0),  y: 62, type: 'actual' as const },
    { ts: tFwd(2),  y: 64, type: 'forecast' as const },
    { ts: tFwd(4),  y: 67, type: 'forecast' as const },
    { ts: tFwd(6),  y: 69, type: 'forecast' as const },
  ], []);
  
  const tsBand = useMemo(() => 
    tsSeries.map(p => ({ 
      ts: p.ts, 
      ylo: Math.max(0, (p.y || 0) - 6), 
      yhi: (p.y || 0) + 6 
    })), [tsSeries]);
    
  const tsEvents = useMemo(() => [
    { ts: tAgo(9), entity: 'OpenAI', kind: 'news' as const, severity: 0.6, title: 'New research blog', url: 'https://openai.com' },
    { ts: tAgo(5), entity: 'NVIDIA', kind: 'release' as const, severity: 0.9, title: 'H100 supply update', url: 'https://nvidia.com' },
    { ts: tAgo(1), entity: 'Acme Corp', kind: 'social' as const, severity: 0.3, title: 'Q&A thread trending' },
    { ts: tFwd(3), entity: 'OpenAI', kind: 'release' as const, severity: 0.7, title: 'Scheduled API update' },
  ], []);

  function addTriple(t: Partial<Triple>) {
    if (!t.a || !t.r || !t.b) return;
    const item = { 
      id: crypto.randomUUID(), 
      verified: true, 
      ...t,
      confidence: t.confidence || 0.8
    } as Triple;
    setKgTriples(prev => [...prev, item]);
    setHistory(h => [{ type: 'add', payload: item }, ...h]);
  }
  
  function deleteTriple(id: string) { 
    setKgTriples(prev => prev.filter(t => t.id !== id)); 
  }
  
  function removeBySource(src: string) { 
    if (!src) return; 
    const rem = kgTriples.filter(t => t.source === src); 
    if (rem.length) { 
      setHistory(h => [{ type: 'remove', payload: rem }, ...h]); 
    } 
    setKgTriples(prev => prev.filter(t => t.source !== src)); 
  }
  
  function undo() { 
    const last = history[0]; 
    if (!last) return; 
    const rest = history.slice(1); 
    if (last.type === 'add') { 
      setKgTriples(prev => prev.filter(t => t.id !== (last.payload as Triple).id)); 
    } 
    if (last.type === 'remove') { 
      setKgTriples(prev => [...(last.payload as Triple[]), ...prev]); 
    } 
    setHistory(rest); 
  }

  // Handle sending chat messages using the OpenAI API
  async function handleSendMessage(text: string) {
    if (!text.trim()) return;
    
    // Add user message to chat
    setMessages(prev => [...prev, { role: 'user', text }]);
    
    // Set loading state
    setIsLoading(true);
    
    try {
      // Call the OpenAI API through our backend
      const result = await solRun(text);
      
      // Process the response
      const assistantResponse = result.ok ? result.text : `Error: ${result.text}`;
      
      // Add assistant response to chat
      setMessages(prev => [...prev, { role: 'assistant', text: assistantResponse }]);
      
      // Check for potential knowledge triples in the response
      if (result.ok) {
        // This is a simple example - in a real app, you might use a more sophisticated
        // approach to extract knowledge triples from the response
        const lowerResponse = assistantResponse.toLowerCase();
        if (lowerResponse.includes('openai') && lowerResponse.includes('gpt-5')) {
          setSuggestedTriples(prev => [
            ...prev,
            {
              id: crypto.randomUUID(),
              a: "OpenAI",
              r: "develops",
              b: "GPT-5",
              source: `chat:${Date.now()}`,
              confidence: 0.75,
              verified: false
            }
          ]);
        }
      }
    } catch (error) {
      // Handle errors
      console.error('Error calling API:', error);
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        text: 'Sorry, I encountered an error while processing your request. Please try again.' 
      }]);
    } finally {
      // Clear loading state
      setIsLoading(false);
    }
  }

  return (
    <div className="h-screen w-full flex flex-col overflow-hidden" style={{ background: C.bg, color: C.text }}>
      <style>{`
        .dark-scroll{scrollbar-width:thin;scrollbar-color:#2a2e36 #0E0F12}
        .dark-scroll::-webkit-scrollbar{width:10px;height:10px}
        .dark-scroll::-webkit-scrollbar-track{background:#0E0F12}
        .dark-scroll::-webkit-scrollbar-thumb{background:#2a2e36;border-radius:8px;border:2px solid #0E0F12}
        .dark-scroll::-webkit-scrollbar-thumb:hover{background:#3a3f48}
        .pill:hover{filter:brightness(1.05);box-shadow:0 0 0 1px ${C.primary}33 inset}
        .kg-row{transition:background 150ms ease}
        .kg-row:hover{background:#0E1014}
        .tab-btn{letter-spacing:0.08em;text-transform:uppercase;font-size:11px}
      `}</style>

      {/* Top bar */}
      <div className="flex items-center justify-between px-5" style={{ height: 56, borderBottom: `1px solid ${C.border}` }}>
        <div className="flex items-center gap-3">
          <div 
            style={{ 
              width: 32, 
              height: 32, 
              borderRadius: '50%', 
              background: panelOpen 
                ? `radial-gradient(circle at 50% 50%, ${C.accent} 0%, ${C.primary} 75%)` 
                : `radial-gradient(circle at 50% 50%, ${C.primary} 0%, ${C.accent} 75%)`, 
              boxShadow: '0 0 0 2px #000 inset' 
            }} 
          />
        </div>
        <div className="flex items-center gap-3">
          {!panelOpen ? (
            <button 
              onClick={() => setPanelOpen(true)} 
              className="rounded-md font-medium" 
              style={{ 
                background: C.bg, 
                color: '#FFFFFF', 
                border: `1px solid ${C.border}`, 
                padding: '8px 14px', 
                fontSize: 13 
              }}
            >
              Show Context
            </button>
          ) : (
            <button 
              onClick={() => setPanelOpen(false)} 
              className="rounded-md font-medium" 
              style={{ 
                background: C.primary, 
                color: '#0B0C0E', 
                padding: '8px 14px', 
                fontSize: 13 
              }}
            >
              Hide Context
            </button>
          )}
          <button 
            className="rounded-md font-semibold" 
            style={{ 
              background: C.accent, 
              color: '#111', 
              padding: '8px 16px', 
              fontSize: 13 
            }}
          >
            Publish
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Chat column */}
        <div 
          className="h-full transition-[width] duration-300 ease-out dark-scroll" 
          style={{ 
            width: panelOpen ? `calc(100% - ${panelWidth}px)` : '100%', 
            overflowY: 'auto' 
          }}
        >
          <div className="h-full">
            <ChatInterface 
              messages={messages} 
              onSendMessage={handleSendMessage}
              showModeChips={true}
              onChooseMode={chooseMode}
              isLoading={isLoading}
            />
          </div>
        </div>

        {/* Right context panel */}
        {panelOpen && (
          <aside 
            className="h-full relative" 
            style={{ 
              width: panelWidth, 
              borderLeft: `1px solid ${C.border}`, 
              background: C.panel, 
              overflow: 'hidden', 
              transition: 'width 240ms ease' 
            }}
          >
            <div 
              className="px-4 pt-4 h-full flex flex-col overflow-hidden" 
              style={{ 
                opacity: 1, 
                transform: 'translateX(0)', 
                transition: 'opacity 200ms ease, transform 240ms ease' 
              }}
            >
              {/* Tabs */}
              <div className="flex gap-6 mb-3">
                {tabs.map((t) => (
                  <button 
                    key={t} 
                    onClick={() => setTab(t)} 
                    className="font-medium tab-btn" 
                    style={{ 
                      padding: '6px 4px', 
                      color: tab === t ? C.primary : C.muted, 
                      borderBottom: tab === t ? `2px solid ${C.primary}` : '2px solid transparent' 
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>

              {/* Panel content */}
              <div className="flex-1 overflow-auto px-1 pr-3 pb-6 dark-scroll">
                {tab === 'Knowledge' && (
                  <KnowledgePanel 
                    triples={kgTriples}
                    suggestedTriples={suggestedTriples}
                    onAddTriple={addTriple}
                    onDeleteTriple={deleteTriple}
                    onRemoveBySource={removeBySource}
                    onUndo={undo}
                    history={history}
                    timeSeriesData={{
                      series: tsSeries,
                      band: tsBand,
                      events: tsEvents
                    }}
                  />
                )}

                {tab === 'Plan' && (
                  <div className="p-4">
                    <h2 className="text-lg font-semibold mb-4" style={{ color: C.text }}>Project Plan</h2>
                    {bossAgentThinking ? (
                      <div className="flex items-center gap-3 text-sm" style={{ color: C.muted }}>
                        <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full"></div>
                        BossAgent is analyzing the conversation...
                      </div>
                    ) : planContent ? (
                      <div className="prose prose-invert max-w-none">
                        <pre className="whitespace-pre-wrap text-sm" style={{ color: C.text }}>
                          {planContent}
                        </pre>
                      </div>
                    ) : (
                      <div className="text-sm" style={{ color: C.muted }}>
                        No plan has been generated yet. Start a conversation to have BossAgent create a plan.
                      </div>
                    )}
                  </div>
                )}

                {tab === 'Workflow' && (
                  <div className="p-4">
                    <h2 className="text-lg font-semibold mb-4" style={{ color: C.text }}>Workflow</h2>
                    {workflowContent ? (
                      <div className="prose prose-invert max-w-none">
                        <pre className="whitespace-pre-wrap text-sm" style={{ color: C.text }}>
                          {workflowContent}
                        </pre>
                      </div>
                    ) : (
                      <div className="text-sm" style={{ color: C.muted }}>
                        No workflow has been generated yet. Continue the conversation to have BossAgent create a workflow.
                      </div>
                    )}
                  </div>
                )}

                {tab === 'Report' && (
                  <div className="p-4">
                    <h2 className="text-lg font-semibold mb-4" style={{ color: C.text }}>Report</h2>
                    {reportContent ? (
                      <div className="prose prose-invert max-w-none">
                        <pre className="whitespace-pre-wrap text-sm" style={{ color: C.text }}>
                          {reportContent}
                        </pre>
                      </div>
                    ) : (
                      <div className="text-sm" style={{ color: C.muted }}>
                        No report has been generated yet. Continue the conversation to have BossAgent create a report.
                      </div>
                    )}
                  </div>
                )}

                {tab === 'Links' && (
                  <div className="text-[13px]" style={{ color: C.muted }}>
                    Content for Links can be wired to your backend later. (Left as placeholder to avoid breaking export.)
                  </div>
                )}
              </div>

              {/* Resize handle */}
              <div 
                onMouseDown={(e) => {
                  const startX = e.clientX;
                  const startW = panelWidth;
                  
                  const onMove = (ev: MouseEvent) => {
                    const delta = startX - ev.clientX;
                    const next = clamp(startW + delta, 360, 920);
                    setPanelWidth(next);
                  };
                  
                  const onUp = () => {
                    window.removeEventListener('mousemove', onMove);
                    window.removeEventListener('mouseup', onUp);
                  };
                  
                  window.addEventListener('mousemove', onMove);
                  window.addEventListener('mouseup', onUp);
                }} 
                style={{ 
                  position: 'absolute', 
                  left: -6, 
                  top: 0, 
                  width: 8, 
                  height: '100%', 
                  cursor: 'col-resize' 
                }} 
                aria-label="Resize panel" 
              />
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
