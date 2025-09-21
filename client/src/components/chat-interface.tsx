import React, { useEffect, useRef } from "react";

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

export interface Message {
  role: 'assistant' | 'user';
  text: string;
}

export interface ChatInterfaceProps {
  messages: Message[];
  onSendMessage?: (text: string) => void;
  showModeChips?: boolean;
  onChooseMode?: (mode: string) => void;
  isLoading?: boolean;
}

export function ChatInterface({ 
  messages, 
  onSendMessage, 
  showModeChips = false, 
  onChooseMode,
  isLoading = false
}: ChatInterfaceProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    
    const fit = () => {
      el.style.height = "0px";
      el.style.height = Math.min(220, Math.max(56, el.scrollHeight)) + "px";
    };
    
    el.addEventListener("input", fit);
    fit();
    
    return () => el.removeEventListener("input", fit);
  }, []);

  // Scroll to bottom when messages change or loading state changes
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isLoading]);

  const handleSend = () => {
    if (!taRef.current || !onSendMessage) return;
    const text = taRef.current.value.trim();
    if (!text) return;
    
    onSendMessage(text);
    taRef.current.value = '';
    
    // Reset height
    if (taRef.current) {
      taRef.current.style.height = "56px";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Typing indicator component
  const TypingIndicator = () => (
    <div className="flex" style={{ justifyContent: 'flex-start' }}>
      <div 
        style={{ 
          background: '#17181C',
          color: C.text,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          padding: '14px 18px',
          maxWidth: 720,
          fontSize: 15,
          lineHeight: 1.45,
          display: 'flex',
          alignItems: 'center',
          gap: '4px'
        }}
      >
        <div className="typing-dot" style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: C.primary,
          animation: 'typingAnimation 1.4s infinite ease-in-out',
          animationDelay: '0s'
        }}></div>
        <div className="typing-dot" style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: C.primary,
          animation: 'typingAnimation 1.4s infinite ease-in-out',
          animationDelay: '0.2s'
        }}></div>
        <div className="typing-dot" style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: C.primary,
          animation: 'typingAnimation 1.4s infinite ease-in-out',
          animationDelay: '0.4s'
        }}></div>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      <style>{`
        @keyframes typingAnimation {
          0% { transform: translateY(0px); }
          50% { transform: translateY(-5px); }
          100% { transform: translateY(0px); }
        }
      `}</style>
      
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-5">
        <div className="max-w-[760px] flex flex-col gap-4 mb-6">
          {messages.map((m, i) => (
            <div key={i} className="flex" style={{ justifyContent: m.role === 'assistant' ? 'flex-start' : 'flex-end' }}>
              <div 
                style={{ 
                  background: m.role === 'assistant' ? '#17181C' : C.primary, 
                  color: m.role === 'assistant' ? C.text : '#0B0C0E', 
                  border: m.role === 'assistant' ? `1px solid ${C.border}` : 'none', 
                  borderRadius: 12, 
                  padding: '10px 14px', 
                  maxWidth: 720, 
                  fontSize: 15, 
                  lineHeight: 1.45 
                }}
              >
                {m.text}
              </div>
            </div>
          ))}
          
          {/* Show typing indicator when loading */}
          {isLoading && <TypingIndicator />}
          
          {/* Invisible element to scroll to */}
          <div ref={messagesEndRef} />
        </div>

        {/* Mode chips */}
        {showModeChips && onChooseMode && (
          <div className="max-w-[760px] mt-1 flex flex-wrap gap-10">
            {['Research', 'Marketing', 'Planning', 'Trading'].map(mode => (
              <button 
                key={mode} 
                onClick={() => onChooseMode(mode.toLowerCase())}
                className="pill" 
                style={{ 
                  border: `1px solid ${C.primary}`, 
                  color: C.primary, 
                  background: 'transparent', 
                  padding: '6px 10px', 
                  fontSize: 12, 
                  borderRadius: 999 
                }}
              >
                {mode}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="flex items-end gap-2 px-3 py-3" style={{ borderTop: `1px solid ${C.border}` }}>
        <div className="flex-1">
          <textarea 
            ref={taRef} 
            placeholder="Write a detailed prompt… (Shift+Enter new line)" 
            className="w-full rounded-md focus:outline-none" 
            style={{ 
              background: C.bg, 
              color: C.text, 
              padding: '12px 14px', 
              fontSize: 14, 
              minHeight: 56, 
              maxHeight: 220, 
              resize: 'none', 
              overflow: 'hidden' 
            }}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
          />
        </div>
        <button 
          className="rounded-full flex items-center justify-center"
          style={{ 
            background: isLoading ? C.neutral : C.accent, 
            width: 44, 
            height: 44,
            transition: 'background-color 0.2s ease'
          }} 
          aria-label="Send"
          onClick={handleSend}
          disabled={isLoading}
        >
          {isLoading ? (
            <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full" />
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#111" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
