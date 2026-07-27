import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { resolveInstrument } from '../features/trading/instrument';

// Theme palettes
const DARK = { bg: '#0a0f1a', panel: '#111827', edge: '#1f2937', ink: '#e5e7eb' };
const DIM = { bg: '#0d1422', panel: '#0f1a2b', edge: '#223048', ink: '#e6edf6' };

function TVChart({ symbol = 'NYSE:RDW' }: { symbol?: string }) {
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
          symbol,
          interval: '5',
          timezone: 'Etc/UTC',
          theme: 'dark',
          container_id: id,
          hide_top_toolbar: false,
          hide_legend: false,
          allow_symbol_change: true,
        });
      } catch {
        // External chart loading is optional for this parked future surface.
      }
    });

    return () => {
      cancelled = true;
      if (added && script && script.parentNode) script.parentNode.removeChild(script);
    };
  }, [symbol]);
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />;
}

type AlpacaSnapshot = {
  provider?: string;
  feed?: string | null;
  symbol?: string;
  status?: string;
  observedAt?: string | null;
  latestTradePrice?: number | null;
  latestQuoteBid?: number | null;
  latestQuoteAsk?: number | null;
  freshness?: string | null;
  diagnostics?: string | null;
};

// Live read-only Alpaca paper snapshot panel. Consumes the Python rails /market proxy.
// No orders, no balances — market data only. Refreshes every 30s.
function AlpacaSnapshotPanel({ symbol, edge, panel }: { symbol: string; edge: string; panel: string }) {
  const [snap, setSnap] = useState<AlpacaSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/market/snapshot?symbol=${encodeURIComponent(symbol)}`);
        const json = (await res.json()) as AlpacaSnapshot;
        if (!cancelled) {
          setSnap(json);
          setErr(null);
        }
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || 'fetch failed');
      }
    };
    // Fetch once on explicit symbol selection / page load. No timed polling — continuous
    // WorldSignals come later as an explicit signal policy, not a hidden demo timer.
    void load();
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  const ok = snap?.status === 'available';
  const statusLabel = snap?.status || (err ? 'error' : 'loading…');
  return (
    <div className="rounded-xl border p-3" style={{ borderColor: edge, background: panel }}>
      <div className="mb-2 flex items-center justify-between">
        <div className="font-bold" style={{ color: '#34d399' }}>📈 Market data · Alpaca paper · {symbol}</div>
        <span className="text-[11px]" style={{ color: ok ? '#34d399' : '#fb923c' }}>{statusLabel}</span>
      </div>
      {ok ? (
        <div className="grid grid-cols-2 gap-1 text-sm" style={{ color: '#cbd5e1' }}>
          <div>Last</div>
          <div style={{ textAlign: 'right', color: '#e6edf6', fontWeight: 700 }}>{snap?.latestTradePrice ?? '—'}</div>
          <div>Bid / Ask</div>
          <div style={{ textAlign: 'right' }}>{snap?.latestQuoteBid ?? '—'} / {snap?.latestQuoteAsk ?? '—'}</div>
          <div>Feed</div>
          <div style={{ textAlign: 'right' }}>{snap?.feed ?? '—'}</div>
          <div>As of</div>
          <div style={{ textAlign: 'right', fontSize: 11 }}>{snap?.observedAt ?? '—'}</div>
        </div>
      ) : (
        <div className="text-[12px]" style={{ color: '#94a3b8' }}>
          {snap?.status === 'provider_unconfigured'
            ? 'Alpaca paper credentials not configured.'
            : snap?.diagnostics || err || 'Loading live snapshot…'}
        </div>
      )}
    </div>
  );
}

const Pill: React.FC<{ color: string; children: React.ReactNode }> = ({ color, children }) => (
  <span className="inline-flex items-center gap-2 rounded-full border px-2 py-1 text-xs md:text-[13px]"
        style={{ borderColor: DARK.edge, background: '#0b1220', color: DARK.ink }}>
    <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
    <span>{children}</span>
  </span>
);

export default function TradingUI() {
  const [fullscreen, setFullscreen] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'dim'>('dark');
  const colors = theme === 'dark' ? DARK : DIM;
  const [searchParams] = useSearchParams();
  // Explicit selected instrument from the URL (e.g. /tradingui?symbol=RDW). No default,
  // no inference — an unknown/missing symbol shows an honest "select instrument" state.
  const instrument = resolveInstrument(searchParams.get('symbol'));

  if (!instrument) {
    return (
      <div className="flex h-screen items-center justify-center" style={{ background: colors.bg, color: colors.ink }}>
        <div className="rounded-xl border p-6 text-center" style={{ borderColor: colors.edge, background: colors.panel, maxWidth: 440 }}>
          <div className="mb-2 text-lg font-bold">Select an instrument</div>
          <div className="text-sm" style={{ color: '#94a3b8' }}>
            This market view requires an explicit symbol — there is no default. Open{' '}
            <code style={{ color: '#7dd3fc' }}>/tradingui?symbol=RDW</code>.
          </div>
        </div>
      </div>
    );
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
          {/* Desktop Fullscreen toggle */}
          <button className="hidden md:block absolute right-2 top-2 z-10 rounded-md border px-2 py-1 text-xs hover:brightness-110"
                  style={{ borderColor: colors.edge, background: '#0b1220', color: colors.ink }}
                  onClick={() => setFullscreen((v) => !v)}>
            {fullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          </button>
          {/* Honest source ownership: the chart is TradingView's own data; Alpaca is the
              independent market-data source for LiquidAIty (panel below). */}
          <div className="absolute left-2 top-8 z-10 rounded-md px-2 py-0.5 text-[11px]"
               style={{ background: '#0b1220cc', color: '#94a3b8', border: `1px solid ${colors.edge}` }}>
            Chart · TradingView · {instrument.tradingViewSymbol}
            <span style={{ color: '#64748b' }}> (independent of Alpaca quotes)</span>
          </div>
          <div className="h-full w-full" style={{ minHeight: 0 }}>
            <TVChart symbol={instrument.tradingViewSymbol} />
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

            <AlpacaSnapshotPanel symbol={instrument.symbol} edge={colors.edge} panel={colors.panel} />

            <div className="rounded-xl border p-3" style={{ borderColor: colors.edge, background: colors.panel }}>
              <div className="mb-2 font-bold" style={{ color: '#7dd3fc' }}>Trading agent is staged</div>
              <p className="text-sm leading-relaxed" style={{ color: '#cbd5e1' }}>
                This workspace currently provides read-only TradingView charts and Alpaca market data.
                Agent runs, following, order entry, and broker execution are not connected yet.
              </p>
            </div>
          </div>
        </aside>
        )}
      </main>
    </div>
  );
}
