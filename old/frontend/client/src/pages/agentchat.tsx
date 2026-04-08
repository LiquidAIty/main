import * as React from "react";

/**
 * Agent Ribbon Demo — polished UI with sphere in header.
 * TailwindCSS expected.
 */

type RibbonStep = "Chat" | "Research" | "Automation" | "Knowledge" | "Wiki" | "Links";

type Msg = { id: string; role: "user" | "assistant" | "system"; content: string };

const USE_CASES = [
  { id: "uc-trading", emoji: "📈", title: "Trading Strategy", hint: "Signals, backtests, predictions" },
  { id: "uc-marketing", emoji: "🛍️", title: "E-commerce Marketing", hint: "Viral hooks, posts, ad ideas" },
  { id: "uc-research", emoji: "📊", title: "Research Report", hint: "Sources, summaries, wiki" },
];

function RibbonButton({ step, icon, active, onClick }: { step: RibbonStep; icon: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      aria-label={step}
      onClick={onClick}
      className={[
        "relative grid place-items-center w-12 h-12 rounded-xl border border-neutral-800/80",
        "bg-neutral-900 hover:bg-neutral-800 transition-colors",
        active ? "outline outline-2 outline-indigo-500" : "",
      ].join(" ")}
    >
      {icon}
    </button>
  );
}

export default function AgentChat() {
  const [activeStep, setActiveStep] = React.useState<RibbonStep>("Chat");
  const [railCollapsed, setRailCollapsed] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [messages, setMessages] = React.useState<Msg[]>([
    { id: crypto.randomUUID(), role: "system", content: "Welcome. Pick a template or start chatting. Shift+Enter = new line, Enter = send." },
  ]);
  const [draft, setDraft] = React.useState("");
  const [isTyping, setIsTyping] = React.useState(false);
  const chatEndRef = React.useRef<HTMLDivElement>(null);

  // Scroll to bottom of chat when messages change
  React.useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Add system message when switching tabs
  React.useEffect(() => {
    const stepMessages: Record<RibbonStep, string> = {
      Chat: "Switched to Chat mode. Using GPT for general assistance.",
      Research: "Switched to Research mode. Using LangGraph with Kimi K2 for in-depth research and analysis.",
      Automation: "Switched to Automation mode. Connect with n8n workflows.",
      Knowledge: "Switched to Knowledge mode. Access vector database and knowledge graph.",
      Wiki: "Switched to Wiki mode. Create and edit AI wiki pages.",
      Links: "Switched to Links mode. Scrape and analyze web content."
    };
    
    if (messages.length > 0 && messages[messages.length - 1].role !== "system") {
      setMessages(prev => [
        ...prev,
        { 
          id: crypto.randomUUID(), 
          role: "system", 
          content: stepMessages[activeStep] 
        }
      ]);
    }
  }, [activeStep]);

  const filteredUseCases = USE_CASES.filter((u) => !query || (u.title + u.hint).toLowerCase().includes(query.toLowerCase()));

  const send = async () => {
    const text = draft.trim();
    if (!text || isTyping) return;
    
    // Add user message
    const userMessage: Msg = { 
      id: crypto.randomUUID(), 
      role: "user", 
      content: text 
    };
    setMessages(prev => [...prev, userMessage]);
    setDraft("");
    setIsTyping(true);
    
    try {
      // Determine which agent mode to use based on active step
      let agentMode: 'orchestrator' | 'specialized' = 'orchestrator';
      let agentType: 'code' | 'marketing' | 'research' | undefined = undefined;
      
      if (activeStep === 'Research') {
        agentMode = 'specialized';
        agentType = 'research';
      }
      
      // Direct API call with exact format expected by backend
      const response = await fetch('/api/sol/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          goal: text,
          agentMode,
          ...(agentType && { agentType })
        })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      const agentResponse = data.text || JSON.stringify(data);
      
      // Add agent response
      const agentMessage: Msg = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: agentResponse
      };
      
      setMessages(prev => [...prev, agentMessage]);
    } catch (error) {
      // Handle errors
      const errorMessage: Msg = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `Error: ${error instanceof Error ? error.message : String(error)}`
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsTyping(false);
    }
  };

  const onKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const loadUseCase = (id: string) => {
    const u = USE_CASES.find((x) => x.id === id);
    if (!u) return;
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "system", content: `Loaded: ${u.title}. I will guide you to customize it.` },
    ]);
    setActiveStep("Chat");
  };

  const StepBadge: React.FC = () => {
    const badges: Record<RibbonStep, string> = {
      Chat: "Planner • GPT",
      Research: "LangGraph • Kimi K2",
      Automation: "Workflows",
      Knowledge: "Vector • Graph",
      Wiki: "AI Wiki",
      Links: "Scraper"
    };
    
    return (
      <div className="text-xs text-neutral-400 px-2 py-0.5 rounded-full border border-neutral-800">
        {badges[activeStep]}
      </div>
    );
  };

  return (
    <div className="h-screen w-screen bg-black text-neutral-200 grid grid-cols-[auto_1fr_auto] grid-rows-[auto_1fr]">
      {/* Top bar with sphere */}
      <header className="col-span-3 flex items-center gap-3 px-3 sm:px-4 py-2 border-b border-neutral-900 bg-neutral-950">
        <div className="h-6 w-6 rounded-full bg-gradient-to-br from-indigo-500 to-blue-500 shadow-md" aria-hidden></div>
        <StepBadge />
        <div className="ml-auto text-xs text-neutral-500">
          {activeStep === 'Research' && 'Using OpenRouter • Kimi K2'}
        </div>
      </header>

      {/* Left rail */}
      <aside className={`flex flex-col gap-2 p-2 border-r border-neutral-900 bg-neutral-950 ${railCollapsed ? "w-14" : "w-56"}`}>
        <button
          className="mb-2 text-xs text-neutral-400 hover:text-white"
          onClick={() => setRailCollapsed(!railCollapsed)}
        >
          {railCollapsed ? ">>" : "<<"}
        </button>
        <div className="flex-1 overflow-y-auto">
          <div className="mb-2 font-semibold text-neutral-400 text-xs">USE CASES</div>
          <div className="flex flex-col gap-1">
            {filteredUseCases.map((u) => (
              <button
                key={u.id}
                onClick={() => loadUseCase(u.id)}
                className="flex items-center gap-2 px-2 py-1 rounded hover:bg-neutral-800 text-left"
              >
                <span>{u.emoji}</span>
                {!railCollapsed && (
                  <div>
                    <div className="text-sm font-medium">{u.title}</div>
                    <div className="text-xs text-neutral-500">{u.hint}</div>
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      </aside>

      {/* Chat main */}
      <main className="p-4 flex flex-col gap-3 overflow-y-auto">
        {messages.map((m) => (
          <div key={m.id} className={`px-3 py-2 rounded-lg max-w-xl ${m.role === "user" ? "bg-indigo-600 text-white ml-auto" : m.role === "assistant" ? "bg-neutral-800 text-neutral-100" : "text-neutral-400 text-sm"}`}>
            {m.content}
          </div>
        ))}
        
        {isTyping && (
          <div className="px-3 py-2 rounded-lg max-w-xl bg-neutral-800 text-neutral-100">
            <div className="flex items-center space-x-1">
              <div className="flex space-x-1">
                <div className="w-2 h-2 bg-neutral-400 rounded-full animate-bounce"></div>
                <div className="w-2 h-2 bg-neutral-400 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
                <div className="w-2 h-2 bg-neutral-400 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
              </div>
              <span className="text-sm text-neutral-400 ml-2">
                {activeStep === 'Research' ? 'LangGraph analyzing...' : 'Agent is thinking...'}
              </span>
            </div>
          </div>
        )}
        
        <div ref={chatEndRef} />
      </main>

      {/* Right ribbon */}
      <aside className="flex flex-col gap-2 p-2 border-l border-neutral-900 bg-neutral-950">
        <RibbonButton step="Chat" icon={<span>💬</span>} active={activeStep === "Chat"} onClick={() => setActiveStep("Chat")} />
        <RibbonButton step="Research" icon={<span>🔎</span>} active={activeStep === "Research"} onClick={() => setActiveStep("Research")} />
        <RibbonButton step="Automation" icon={<span>⚙️</span>} active={activeStep === "Automation"} onClick={() => setActiveStep("Automation")} />
        <RibbonButton step="Knowledge" icon={<span>🧠</span>} active={activeStep === "Knowledge"} onClick={() => setActiveStep("Knowledge")} />
        <RibbonButton step="Wiki" icon={<span>📖</span>} active={activeStep === "Wiki"} onClick={() => setActiveStep("Wiki")} />
        <RibbonButton step="Links" icon={<span>🔗</span>} active={activeStep === "Links"} onClick={() => setActiveStep("Links")} />
      </aside>

      {/* Input area */}
      <footer className="col-span-3 border-t border-neutral-900 bg-neutral-950 p-3">
        <div className="flex gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={activeStep === 'Research' ? "Ask a research question... (Shift+Enter for new line)" : "Write a detailed prompt... (Shift+Enter for new line)"}
            className="flex-1 resize-none rounded-lg bg-neutral-900 border border-neutral-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            rows={2}
            disabled={isTyping}
          />
          <button
            onClick={send}
            disabled={!draft.trim() || isTyping}
            className={`px-4 py-2 rounded-lg text-white font-medium disabled:bg-opacity-50 disabled:cursor-not-allowed ${
              activeStep === 'Research' 
                ? 'bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:bg-blue-800' 
                : 'bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 disabled:bg-indigo-800'
            }`}
          >
            Send
          </button>
        </div>
      </footer>
    </div>
  );
}
