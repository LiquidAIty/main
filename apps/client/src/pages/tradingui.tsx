import React, { useEffect, useMemo, useRef, useState } from 'react';

// Theme palettes
const DARK = { bg: '#0a0f1a', panel: '#111827', edge: '#1f2937', ink: '#e5e7eb' };
const DIM = { bg: '#0d1422', panel: '#0f1a2b', edge: '#223048', ink: '#e6edf6' };

type Msg = { who: 'User' | 'AI'; text: string };

function TVChart() {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    let script = document.querySelector<HTMLScriptElement>('#tv-script');
    let added = false;
    let cancelled = false;
    const ensure = () =>
      new Promise<void>((res) => {
        if ((window as any).TradingView) return res();
        if (!script) {
          script = document.createElement('script');
          script.id = 'tv-script';
          script.src = 'https://s3.tradingview.com/tv.js';
          script.async = true;
          script.onload = () => res();
          document.head.appendChild(script);
          added = true;
        } else {
          script.addEventListener('load', () => res(), { once: true });
        }
      });

    ensure().then(() => {
      if (cancelled) return;
      const el = ref.current;
      if (!el || !(window as any).TradingView) return;
      const id = 'tv_container_autosize';
      el.id = id;
      try {
        new (window as any).TradingView.widget({
          autosize: true,
          symbol: 'FX:USDJPY',
          interval: '5',
          timezone: 'Etc/UTC',
          theme: 'dark',
          container_id: id,
          hide_top_toolbar: false,
          hide_legend: false,
          allow_symbol_change: true,
        });
      } catch {}
    });

    return () => {
      cancelled = true;
      if (added && script && script.parentNode) script.parentNode.removeChild(script);
    };
  }, []);
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />;
}

const Pill: React.FC<{ color: string; children: React.ReactNode }> = ({ color, children }) => (
  <span className="inline-flex items-center gap-2 rounded-full border px-2 py-1 text-xs md:text-[13px]"
        style={{ borderColor: DARK.edge, background: '#0b1220', color: DARK.ink }}>
    <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
    <span>{children}</span>
  </span>
);

const Chip: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="inline-flex items-center rounded-full border px-2 py-1 text-[11px]"
        style={{ borderColor: DARK.edge, background: '#0b1220', color: DARK.ink }}>{children}</span>
);

const GradientBtn: React.FC<{ variant: 'enter' | 'exit'; children: React.ReactNode; onClick?: () => void }>
  = ({ variant, children, onClick }) => (
  <button onClick={onClick}
    className="w-full select-none rounded-xl px-4 py-3 font-extrabold tracking-wide text-[15px] shadow transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-2"
    style={{ minHeight: 44, background: variant === 'enter' ? 'linear-gradient(90deg,#34d399,#14b8a6)' : 'linear-gradient(90deg,#fb923c,#f43f5e)', color: '#04110d' }}>
    {children}
  </button>
);

export default function TradingUI() {
  const [agentMode, setAgentMode] = useState<'run' | 'follow'>('run');
  const [fullscreen, setFullscreen] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'dim'>('dark');
  const colors = theme === 'dark' ? DARK : DIM;

  const [messages, setMessages] = useState<Msg[]>([
    { who: 'User', text: 'Should I take this trade?' },
    { who: 'AI', text: 'Confidence 72%, conditions look favorable.' },
  ]);
  const chatRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { chatRef.current?.scrollTo({ top: 1e9, behavior: 'smooth' }); }, [messages.length]);

  // Signals strip (mock)
  const signals = useMemo(() => (
    [
      ['YLV8', '72%'], ['TLOB', '64%'], ['CRON', '58%'], ['ARMA', '61%'], ['OPTM', '69%'], ['OPTA', '73%']
    ] as [string,string][]
  ), []);

  // No-op hooks
  const onEnterTrade = () => console.log('onEnterTrade');
  const onExitTrade = () => console.log('onExitTrade');
  const onRunAgent = () => { setAgentMode('run'); console.log('onRunAgent'); };
  const onFollowTrader = () => { setAgentMode('follow'); console.log('onFollowTrader'); };

  function sendChat(text: string) {
    if (!text.trim()) return;
    setMessages((m) => [...m, { who: 'User', text }]);
    setTimeout(() => setMessages((m) => [...m, { who: 'AI', text: 'Noted. Confidence checking…' }]), 400);
  }

  return (
    <div className="flex h-screen flex-col" style={{ background: colors.bg, color: colors.ink }}>
      {/* HEADER (scrollable pills) */}
      <header className="flex h-10 items-center gap-2 border-b px-2 backdrop-blur overflow-x-auto"
              style={{ borderColor: colors.edge, background: `${colors.panel}CC` }}>
        <Pill color="#60a5fa">Trade Stats</Pill>
        <Pill color="#34d399">P/L</Pill>
        <Pill color="#fb923c">Win Rate</Pill>
        <div className="ml-auto flex items-center gap-2 text-xs">
          <span>Theme</span>
          <button className="rounded-md border px-2 py-1" style={{ borderColor: colors.edge, background: '#0b1220', color: colors.ink }} onClick={() => setTheme((t) => t === 'dark' ? 'dim' : 'dark')}>
            {theme === 'dark' ? 'Dark' : 'Dim'}
          </button>
        </div>
      </header>

      {/* MAIN */}
      <main className="flex min-h-0 flex-1 flex-col md:flex-row" style={{ padding: 16 }}>
        {/* CHART AREA */}
        <section className={`relative min-h-0 ${fullscreen ? 'w-full' : 'flex-1'} overflow-hidden`}>
          {/* Signals strip */}
          <div className="absolute left-0 right-0 top-0 z-10 flex gap-2 overflow-x-auto px-2 py-1"
               style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.45), rgba(0,0,0,0))' }}>
            {signals.map(([k,v]) => (
              <span key={k} className="rounded-full px-2 py-0.5 text-[11px] shadow"
                    style={{ background: '#182033', color: '#dbeafe', border: `1px solid ${colors.edge}` }}>{k}: {v}</span>
            ))}
          </div>
          {/* Desktop Fullscreen toggle */}
          <button className="hidden md:block absolute right-2 top-2 z-10 rounded-md border px-2 py-1 text-xs hover:brightness-110"
                  style={{ borderColor: colors.edge, background: '#0b1220', color: colors.ink }}
                  onClick={() => setFullscreen((v) => !v)}>
            {fullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          </button>
          <div className="h-full w-full" style={{ minHeight: 0 }}>
            <TVChart />
          </div>
        </section>

        {/* SIDEBAR */}
        {!fullscreen && (
        <aside className="min-h-0 w-full md:w-[320px] md:border-l md:border-t-0 border-t p-2 overflow-y-auto"
               style={{ background: colors.panel, borderColor: colors.edge }}>
          <div className="flex h-full min-h-0 flex-col gap-2">
            {/* Mobile Fullscreen toggle */}
            <button className="md:hidden rounded-md border px-2 py-2 text-sm hover:brightness-110"
                    style={{ borderColor: colors.edge, background: '#0b1220', color: colors.ink }}
                    onClick={() => setFullscreen(true)}>Fullscreen</button>

            <GradientBtn variant="enter" onClick={onEnterTrade}>🚀 ENTER TRADE</GradientBtn>

            <div className="rounded-xl border p-3" style={{ borderColor: colors.edge, background: colors.panel }}>
              <div className="mb-2 flex items-center justify-between">
                <div className="font-bold" style={{ color: '#7dd3fc' }}>🤖 AI Agent</div>
                <div className="flex gap-1">
                  <button className={`transition ${agentMode === 'run' ? '' : 'opacity-80 hover:opacity-100'}`} onClick={onRunAgent}>
                    <Chip>Run my agent</Chip>
                  </button>
                  <button className={`transition ${agentMode === 'follow' ? '' : 'opacity-80 hover:opacity-100'}`} onClick={onFollowTrader}>
                    <Chip>Follow trader</Chip>
                  </button>
                </div>
              </div>
              <ul className="ml-4 list-disc space-y-1" style={{ color: '#cbd5e1' }}>
                <li>Signals & confidence</li>
                <li>Consensus: OPTA ≥ 70%</li>
                <li>Quick link share</li>
              </ul>
            </div>

            {/* CHAT PANEL */}
            <div className="flex min-h-[140px] flex-1 flex-col rounded-xl border" style={{ borderColor: colors.edge, background: colors.panel }}>
              <div ref={chatRef} className="flex-1 overflow-y-auto p-3">
                <div className="grid gap-2 text-sm">
                  {messages.map((m, i) => (
                    <div key={i} className="leading-relaxed">
                      <span className="font-semibold" style={{ color: colors.ink }}>{m.who}: </span>
                      <span style={{ color: '#cbd5e1' }}>{m.text}</span>
                    </div>
                  ))}
                </div>
              </div>
              <form className="flex gap-2 border-t p-2" style={{ borderColor: colors.edge }} onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget as HTMLFormElement);
                const t = String(fd.get('t') || '').trim();
                if (!t) return;
                (e.currentTarget as HTMLFormElement).reset();
                sendChat(t);
              }}>
                <input name="t" placeholder="Type a message…" className="flex-1 rounded-md border px-3" style={{ borderColor: colors.edge, background: '#0b1220', color: colors.ink, minHeight: 44 }} />
                <button className="rounded-md border px-3" style={{ borderColor: colors.edge, background: '#0b1220', color: colors.ink, minHeight: 44 }} type="submit">Send</button>
              </form>
            </div>

            <GradientBtn variant="exit" onClick={onExitTrade}>⛔ EXIT TRADE</GradientBtn>

            {/* BOTTOM NAV */}
            <div className="mt-1 grid grid-cols-3 gap-2 rounded-xl border p-2" style={{ borderColor: colors.edge, background: `${colors.panel}` }}>
              <button className="rounded-full border px-3 py-2 text-sm hover:brightness-110" style={{ borderColor: colors.edge, background: '#0b1220', color: '#86efac', minHeight: 44 }}>📈 Markets</button>
              <button className="rounded-full border px-3 py-2 text-sm hover:brightness-110" style={{ borderColor: colors.edge, background: '#0b1220', color: '#e879f9', minHeight: 44 }}>👥 Traders</button>
              <button className="rounded-full border px-3 py-2 text-sm hover:brightness-110" style={{ borderColor: colors.edge, background: '#0b1220', color: '#fdba74', minHeight: 44 }}>⚙️ Settings</button>
            </div>
          </div>
        </aside>
        )}
      </main>
    </div>
  );
}
