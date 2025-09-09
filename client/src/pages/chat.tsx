import React, { useState, useRef, useEffect } from 'react';

// Minimal, dark, no external deps beyond Tailwind.
// Talks ONLY to your existing backend:
//  - POST /api/sol/run  { goal, context?: { background?: string; urls?: string[] } }
//  - GET  /api/sol/why  (returns last-run trace)
// No fake panels. Everything shown is real data from the server.

export default function Chat() {
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'agent'; text: string }>>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Auto-scroll to latest message
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  async function send() {
    const goal = input.trim();
    if (!goal || sending) return;

    setSending(true);
    setMessages((m) => [...m, { role: 'user', text: goal }]);
    setInput('');

    try {
      const res = await fetch('/api/sol/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal }),
        credentials: 'include'
      });

      if (res.status === 401) {
        setMessages((m) => [...m, { role: 'agent', text: 'Authentication failed. Please log in again.' }]);
        setSending(false);
        return;
      }

      const raw = await res.json().catch(() => null);
      const replyText =
        typeof raw === 'string'
          ? raw
          : (raw && typeof (raw as any).text === 'string')
          ? (raw as any).text
          : (raw as any)?.choices?.[0]?.message?.content ?? JSON.stringify(raw ?? { error: `HTTP ${res.status}` });

      setMessages((m) => [...m, { role: 'agent', text: String(replyText ?? '').trim() }]);
    } catch (e: any) {
      setMessages((m) => [...m, { role: 'agent', text: `Error: ${String(e?.message || e)}` }]);
    } finally {
      setSending(false);
    }
  }

  function clearChat() {
    setMessages([]);
  }

  return (
    <div className='h-screen w-screen bg-[#0b1120] text-slate-200 flex flex-col'>
      {/* TOP BAR */}
      <header className='h-14 border-b border-slate-800 flex items-center justify-between px-4'>
        <div className='font-semibold tracking-wide'>LiquidAIty · LangGraph Chat</div>
        <button
          onClick={clearChat}
          className='px-3 h-9 rounded-lg bg-slate-800 hover:bg-slate-700'
          title='Clear chat'
        >
          Clear
        </button>
      </header>

      {/* MESSAGE LIST */}
      <div ref={listRef} className='flex-1 overflow-auto px-4 py-4 space-y-3'>
        {messages.length === 0 && (
          <div className='text-sm text-slate-400'>
            Type a goal and press <kbd className='px-1 py-0.5 bg-slate-800 rounded'>Enter</kbd> or click Send.
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              'max-w-3xl rounded-2xl px-4 py-3 ' +
              (m.role === 'user' ? 'bg-slate-800 ml-auto' : 'bg-[#0f172a] mr-auto border border-slate-800')
            }
          >
            <div className='text-xs uppercase tracking-wide mb-1 opacity-60'>
              {m.role === 'user' ? 'You' : 'Agent'}
            </div>
            <div className='whitespace-pre-wrap leading-relaxed'>{m.text}</div>
          </div>
        ))}
      </div>

      {/* INPUT BAR */}
      <footer className='border-t border-slate-800 p-3'>
        <div className='max-w-4xl mx-auto flex gap-2'>
          <input
            className='flex-1 bg-slate-900 border border-slate-800 rounded-2xl px-4 h-12 outline-none'
            placeholder='Goal: Plan a 3‑phase evaluation…'
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            disabled={sending}
          />
          <button
            onClick={send}
            disabled={sending}
            className='h-12 px-5 rounded-2xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50'
          >
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </footer>
    </div>
  );
}
