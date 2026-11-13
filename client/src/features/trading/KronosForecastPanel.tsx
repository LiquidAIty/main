/**
 * Entity: Trading
 * Relationship: Presents real candles with an overlapping forecast shadow and completed-data boundary, chart-selected history, and on-demand settings and raw data.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CandlestickSeries, ColorType, CrosshairMode, LineSeries, LineStyle, createChart, type CandlestickData, type IChartApi, type ISeriesApi, type UTCTimestamp, type WhitespaceData } from 'lightweight-charts';
import { applicationFetch } from '../../lib/applicationApi';
import { ForecastShadow, type ShadowPoint } from './ForecastShadow';
import { ChartIndicators, windowVwap, type IndicatorOptions } from './ChartIndicators';

export type ForecastBar = { timestamp: string; availableAfter?: string; open: number | null; high: number | null; low: number | null; close: number | null; volume: number | null; amount?: number | null; valid?: boolean };
type SampleRange = { timestamp: string; min: number; max: number; p10: number; median: number; p90: number };
export type Forecast = {
  forecastId?: string; status: string; generatedAt: string; cutoff: string; lastObservedAt?: string;
  modelRef: string; modelRevision: string; horizon: number; aggregation: string;
  parameters: { historyLimit: number; sampleCount: number; seed: number; temperature?: number; topP?: number; topK?: number };
  marketData: { symbol: string; timeframe: string; feed: string; fetchedAt: string };
  history: ForecastBar[]; points: ForecastBar[]; warnings: string[]; diagnostics?: string;
  samplePaths?: { sampleIndex: number; valid: boolean; points: ForecastBar[] }[];
  distribution?: { sampleCount: number; validPathCount: number; invalidPathCount: number; lastObservedClose: number; terminalAbove: number; terminalBelow: number; terminalUnchanged: number; steps: SampleRange[] };
  runtime: { device: string; seconds: number | null };
  observedIndicators?: { lastClose: number; sma20: number | null };
  volatilityComparison?: { status: string; reason?: string; volatilityPercentPerBar?: number[];
    heldOut?: { bars: number; varianceMae: number; constantVarianceMae: number } };
};
type Summary = Pick<Forecast, 'forecastId' | 'generatedAt' | 'marketData' | 'cutoff' | 'modelRef' | 'status'>;
type Comparison = { status: string; actual: ForecastBar[]; diagnostics?: string; metrics: null | {
  matchedBars: number; horizon: number; closeMae: number; lastCloseBaselineMae: number;
  highMae: number; lowMae: number; terminalDirectionCorrect: boolean | null; closeInsidePredictedRange: number;
} };

const NO_ACTUALS: ForecastBar[] = [];
const chartTime = (timestamp: string) => Date.parse(timestamp) / 1000 as UTCTimestamp;
export function forecastObservedHistory(saved: ForecastBar[], current: ForecastBar[], actual: ForecastBar[]): ForecastBar[] {
  const originalEnd = saved.length ? chartTime(saved.at(-1)!.timestamp) : -Infinity;
  const rows = new Map(saved.map(bar => [chartTime(bar.timestamp), bar]));
  // Preserve the original input snapshot; only append real observations after it.
  for (const bar of [...actual, ...current]) {
    const time = chartTime(bar.timestamp);
    if (time > originalEnd) rows.set(time, bar);
  }
  return [...rows.entries()].sort(([a], [b]) => a - b).map(([, bar]) => bar);
}
export function forecastShadowPoints(forecast?: Forecast | null): ShadowPoint[] {
  if (!forecast?.samplePaths?.length || !forecast.history.length) return [];
  const anchor = forecast.history.at(-1)!;
  const paths = forecast.samplePaths.map(path => new Map(path.points.map(point => [chartTime(point.timestamp), point.close])));
  return [{ time: chartTime(anchor.timestamp), values: anchor.close == null ? [] : [anchor.close] }, ...forecast.points.map(point => {
    const time = chartTime(point.timestamp);
    const values = paths.map(path => path.get(time));
    // A missing close makes a visible gap, not a narrower invented sample range.
    return { time, values: values.every(value => typeof value === 'number' && Number.isFinite(value)) ? values as number[] : [] };
  })];
}
export function forecastCandleData(bars: ForecastBar[]): (CandlestickData<UTCTimestamp> | WhitespaceData<UTCTimestamp>)[] {
  return bars.map(bar => {
    const time = chartTime(bar.timestamp);
    return bar.valid === false || [bar.open, bar.high, bar.low, bar.close].some(value => value == null || !Number.isFinite(value))
      ? { time } : { time, open: bar.open!, high: bar.high!, low: bar.low!, close: bar.close! };
  });
}

type ChartWindow = { count: number; end: string } | null;
export function forecastInputWindow(history: ForecastBar[], from: number, to: number, timeline?: number[]): ChartWindow {
  const first = Math.max(0, Math.ceil(from));
  if (timeline) {
    const times = new Set(timeline.slice(first, Math.max(first, Math.floor(to) + 1)));
    const selected = history.filter(bar => times.has(chartTime(bar.timestamp)));
    const end = selected.at(-1)?.availableAfter;
    return end ? { count: selected.length, end } : null;
  }
  const last = Math.min(history.length - 1, Math.floor(to));
  const end = history[last]?.availableAfter;
  return last >= first && end ? { count: last - first + 1, end } : null;
}
export function ForecastCandles({ forecast, history: inputHistory = NO_ACTUALS, actual = NO_ACTUALS, onWindowChange }: {
  forecast?: Forecast | null; history?: ForecastBar[]; actual?: ForecastBar[]; onWindowChange?: (window: ChartWindow) => void;
}) {
  const history = useMemo(() => forecastObservedHistory(forecast?.history || [], inputHistory, actual), [forecast, inputHistory, actual]);
  const points = forecast?.points || NO_ACTUALS;
  const dataEnd = inputHistory.length || actual.length ? history.at(-1)?.timestamp : undefined;
  const windowListener = useRef(onWindowChange);
  windowListener.current = onWindowChange;
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const pathSeries = useRef<ISeriesApi<'Line'>[]>([]);
  const indicatorOverlay = useRef<ChartIndicators | null>(null);
  const vwapSeries = useRef<ISeriesApi<'Line'> | null>(null);
  const [indicators, setIndicators] = useState<IndicatorOptions>({ profile: false, levels: false, patterns: false, vwap: false });
  const [showPaths, setShowPaths] = useState(false);
  const [chartError, setChartError] = useState('');
  const [hover, setHover] = useState('');
  const fitForecast = () => chart.current?.timeScale().setVisibleLogicalRange({
    from: Math.max(0, history.length - (forecast ? 48 : 128)),
    to: history.length + points.filter(point => chartTime(point.timestamp) > chartTime(history.at(-1)!.timestamp)).length + 4,
  });
  useEffect(() => { pathSeries.current.forEach(series => series.applyOptions({ visible: showPaths })); }, [showPaths]);
  useEffect(() => {
    indicatorOverlay.current?.setOptions(indicators);
    vwapSeries.current?.applyOptions({ visible: indicators.vwap });
  }, [indicators]);
  useEffect(() => {
    if (!container.current || !history.length) return;
    setChartError('');
    if (typeof window.matchMedia !== 'function') {
      setChartError('This browser does not provide the display APIs required by Lightweight Charts.');
      return;
    }
    try {
      pathSeries.current = [];
      const api = createChart(container.current, {
        autoSize: true, layout: { background: { type: ColorType.Solid, color: '#0b111a' }, textColor: '#b8c3d0', fontSize: 12, attributionLogo: true },
        grid: { vertLines: { color: '#15202c' }, horzLines: { color: '#15202c' } },
        crosshair: { mode: CrosshairMode.Normal },
        rightPriceScale: { borderColor: '#273442', scaleMargins: { top: .08, bottom: .08 } },
        timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#273442' },
      });
      chart.current = api;
      const observed = api.addSeries(CandlestickSeries, { upColor: '#26a69a', downColor: '#ef5350', borderVisible: false, wickUpColor: '#26a69a', wickDownColor: '#ef5350' });
      observed.setData(forecastCandleData(history));
      const last = history.at(-1)!;
      const origin = forecast?.history.at(-1) || last;
      const anchor = { time: chartTime(origin.timestamp), value: origin.close! };
      const addLine = (data: { time: UTCTimestamp; value: number }[], color: string, width: 1 | 2 = 1, lineStyle = LineStyle.Solid, isPath = false) => {
        const series = api.addSeries(LineSeries, { color, lineWidth: width, lineStyle, visible: !isPath || showPaths, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
        series.setData([anchor, ...data]);
        if (isPath) pathSeries.current.push(series);
        return series;
      };
      for (const path of forecast?.samplePaths || []) {
        if (path.points.every(point => point.close != null && Number.isFinite(point.close))) {
          addLine(path.points.map(point => ({ time: chartTime(point.timestamp), value: point.close! })),
            path.valid ? 'rgba(247,201,130,0.5)' : 'rgba(251,113,133,0.4)', 1, path.valid ? LineStyle.Solid : LineStyle.Dashed, true);
        }
      }
      const predicted = api.addSeries(LineSeries, { color: '#ffb52e', lineWidth: 2, priceLineVisible: false, lastValueVisible: true });
      predicted.setData(points.length ? [anchor, ...points.map(point => point.valid === false || point.close == null || !Number.isFinite(point.close)
        ? { time: chartTime(point.timestamp) } : { time: chartTime(point.timestamp), value: point.close })] : []);
      observed.attachPrimitive(new ForecastShadow(forecastShadowPoints(forecast), dataEnd ? chartTime(dataEnd) : null));
      indicatorOverlay.current = new ChartIndicators(history, indicators);
      observed.attachPrimitive(indicatorOverlay.current);
      vwapSeries.current = api.addSeries(LineSeries, { color: '#719bc3', lineWidth: 1,
        visible: indicators.vwap, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      vwapSeries.current.setData(windowVwap(history));
      const defaultQuote = `O ${last.open?.toFixed(2)}   H ${last.high?.toFixed(2)}   L ${last.low?.toFixed(2)}   C ${last.close?.toFixed(2)}`;
      setHover(defaultQuote);
      api.subscribeCrosshairMove(event => {
        const bar = event.seriesData.get(observed);
        const mean = event.seriesData.get(predicted);
        const labels = bar && 'open' in bar ? [`Actual: O ${bar.open.toFixed(3)} H ${bar.high.toFixed(3)} L ${bar.low.toFixed(3)} C ${bar.close.toFixed(3)}`] : [];
        if (mean && 'value' in mean) labels.push(`Forecast mean: ${mean.value.toFixed(3)}`);
        setHover(labels.length ? labels.join(' · ') : defaultQuote);
      });
      api.timeScale().subscribeVisibleLogicalRangeChange(range => {
        if (!range) return;
        const timeline = [...new Set([...history, ...points].map(bar => chartTime(bar.timestamp)))].sort((a, b) => a - b);
        windowListener.current?.(forecastInputWindow(history, range.from, range.to, timeline));
      });
      fitForecast();
    } catch (error) { pathSeries.current = []; indicatorOverlay.current = null; vwapSeries.current = null; chart.current?.remove(); chart.current = null; setChartError(error instanceof Error ? error.message : 'Chart unavailable'); }
    return () => { pathSeries.current = []; indicatorOverlay.current = null; vwapSeries.current = null; chart.current?.remove(); chart.current = null; };
  }, [forecast, history, actual]);
  return <div className="forecast-price-view">
    <div className="kronos-chart-toolbar"><span>{hover}</span><div>
      <details className="forecast-indicators"><summary>Indicators</summary><div>
        {([
          ['profile', 'Volume profile', 'Visible-range volume is approximated uniformly across each candle’s high–low range, not tick-by-tick volume at price. POC and a contiguous 70% value area.'],
          ['levels', 'Price levels', 'Observed day, prior-day and week highs/lows in New York time. These are reference levels, not guaranteed support or resistance.'],
          ['vwap', 'Window VWAP', 'Loaded-window cumulative volume-weighted typical price (H+L+C)/3; an approximation, not trade-by-trade VWAP.'],
          ['patterns', 'Candle context', 'Engulfing bodies, rolling 20-bar breaks or possible sweeps, and three-candle price gaps. Observed patterns do not guarantee a reversal or prove liquidity activity.'],
        ] as const).map(([key, label, explanation]) => <label key={key} title={explanation}>
          <input type="checkbox" checked={indicators[key]} onChange={event => setIndicators(value => ({ ...value, [key]: event.target.checked }))} />{label}
        </label>)}
      </div></details>
      {!!forecast?.samplePaths?.length && <button type="button" aria-pressed={showPaths} onClick={() => setShowPaths(value => !value)}>Paths</button>}
      <button type="button" onClick={fitForecast}>Fit</button>
    </div></div>
    <div ref={container} className="kronos-candles" role="region" aria-label="Interactive forecast candle chart" aria-description={dataEnd ? `Now line: latest completed market candle ${dataEnd}. Shadow: raw sampled closes, not a confidence interval.` : 'Latest market data unavailable; no Now marker.'} />
    {chartError && <span role="alert" className="forecast-error">{chartError}</span>}
  </div>;
}

export default function KronosForecastPanel({ projectId, deckId, cardId, symbol, timeframe, onOpenForecast }: {
  projectId: string; deckId: string; cardId: string; symbol: string; timeframe: string;
  onOpenForecast?: (market: Forecast['marketData']) => void;
}) {
  const [cutoff, setCutoff] = useState('');
  const [horizon, setHorizon] = useState(5);
  const [samples, setSamples] = useState(16);
  const [temperature, setTemperature] = useState(1);
  const [topP, setTopP] = useState(.9);
  const [topK, setTopK] = useState(0);
  const [seed, setSeed] = useState(443);
  const [includeVolatility, setIncludeVolatility] = useState(false);
  const [history, setHistory] = useState<ForecastBar[]>([]);
  const [historyMarket, setHistoryMarket] = useState('');
  const [chartWindow, setChartWindow] = useState<ChartWindow>(null);
  const [historyError, setHistoryError] = useState('');
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [saved, setSaved] = useState<Summary[]>([]);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [panel, setPanel] = useState<'settings' | 'data' | null>(null);
  const serial = useRef(0);
  const query = new URLSearchParams({ projectId, deckId, cardId }).toString();
  const request = async (url: string, init?: RequestInit) => {
    const response = await applicationFetch(url, { credentials: 'include', ...init });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || body.detail || 'Forecast request failed');
    return body;
  };
  useEffect(() => {
    const controller = new AbortController();
    setForecast(null); setComparison(null); setSaved([]); setError(''); setBusy(false);
    void request('/api/trading/forecasts?' + query, { signal: controller.signal }).then(body => {
      if (!controller.signal.aborted) setSaved(body.forecasts);
    }).catch(e => { if (!controller.signal.aborted) setError(String(e.message)); });
    return () => { controller.abort(); serial.current++; };
  }, [query]);
  useEffect(() => {
    const controller = new AbortController();
    serial.current++;
    setHistory([]); setHistoryMarket(''); setChartWindow(null); setHistoryError('');
    if (forecast && (forecast.marketData.symbol !== symbol || forecast.marketData.timeframe !== timeframe)) { setForecast(null); setComparison(null); }
    if (symbol) void request('/api/trading/forecast/history?' + query + '&' + new URLSearchParams({ symbol, timeframe }), { signal: controller.signal }).then(body => {
      if (!controller.signal.aborted) { setHistory(body.history); setHistoryMarket(`${symbol}:${timeframe}`); if (body.status !== 'available') setHistoryError(body.diagnostics || body.status); }
    }).catch(error => { if (!controller.signal.aborted) setHistoryError(String(error.message)); });
    return () => controller.abort();
  }, [query, symbol, timeframe]);
  const act = async (work: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const generate = () => act(async () => {
    const epoch = serial.current;
    const result = await request('/api/trading/forecast', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, deckId, cardId, symbol, timeframe, end: cutoff ? new Date(cutoff + 'Z').toISOString() : chartWindow!.end,
        model_variant: 'mini', horizon, history_limit: chartWindow!.count, sample_count: samples, seed,
        temperature, top_p: topP, top_k: topK, include_volatility: includeVolatility }),
    });
    if (serial.current !== epoch) return;
    setForecast(result); setComparison(null);
    const list = await request('/api/trading/forecasts?' + query);
    if (serial.current === epoch) setSaved(list.forecasts);
  });
  const open = (id: string) => act(async () => {
    const epoch = serial.current;
    const result = await request('/api/trading/forecasts?' + query + '&forecastId=' + encodeURIComponent(id));
    if (serial.current === epoch) { setForecast(result); setComparison(null); onOpenForecast?.(result.marketData); }
  });
  const compare = () => act(async () => {
    const epoch = serial.current;
    const result = await request('/api/trading/forecasts?' + query + '&forecastId=' + encodeURIComponent(forecast!.forecastId!) + '&compare=true');
    if (serial.current === epoch) setComparison(result);
  });
  return <div className="kronos-panel">
    <form className="forecast-actions" onSubmit={event => {
      event.preventDefault();
      if (!busy && chartWindow && chartWindow.count >= 16 && chartWindow.count <= 400) void generate();
    }}>
      <button className="forecast-run" disabled={busy || !symbol || !chartWindow || chartWindow.count < 16 || chartWindow.count > 400} type="submit">{busy ? 'Running…' : 'Forecast'}</button>
      <span className="forecast-window" title={chartWindow ? `Next forecast: ${chartWindow.count} visible completed candles, ending ${chartWindow.end}` : undefined}>{forecast ? `Input: ${forecast.history.length} · selected: ${chartWindow?.count || 0}` : chartWindow ? chartWindow.count + ' candles' : history.length ? 'Select history' : 'Loading candles…'}</span>
      <select aria-label="Saved forecast" value={forecast?.forecastId || ''} disabled={busy} onChange={event => {
        if (event.target.value) void open(event.target.value);
        else { setForecast(null); setComparison(null); }
      }}>
        <option value="">Current candles</option>
        {saved.map(item => <option key={item.forecastId} value={item.forecastId}>{item.marketData.symbol} · {item.marketData.timeframe} · {item.cutoff.slice(0, 10)}</option>)}
      </select>
      {forecast && <button type="button" className={forecast.status === 'invalid_prediction' ? 'forecast-warning' : ''}
        title={forecast.diagnostics || 'Saved model forecast'} onClick={() => setPanel('data')}>
        {forecast.distribution?.invalidPathCount ? forecast.distribution.invalidPathCount + '/' + forecast.distribution.sampleCount + ' paths flagged' : 'Forecast data'}
      </button>}
      <span className="forecast-action-spacer" />
      <button type="button" aria-expanded={panel === 'settings'} onClick={() => setPanel(value => value === 'settings' ? null : 'settings')}>Settings</button>
      <button type="button" aria-expanded={panel === 'data'} onClick={() => setPanel(value => value === 'data' ? null : 'data')}>Data</button>
    </form>
    {(historyError || error) && <div role="alert" className="forecast-error">{historyError || error}</div>}
    <ForecastCandles forecast={forecast} history={historyMarket === `${forecast?.marketData.symbol || symbol}:${forecast?.marketData.timeframe || timeframe}` ? history : NO_ACTUALS} actual={comparison?.actual} onWindowChange={setChartWindow} />
    <footer className="forecast-attribution"><span>IEX · UTC</span><a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">Lightweight Charts™ · © 2025 TradingView, Inc.</a></footer>
    {panel && <aside className="forecast-detail" aria-label={panel === 'settings' ? 'Forecast settings' : 'Forecast data'}>
      <header><strong>{panel === 'settings' ? 'Settings' : 'Data'}</strong><button type="button" aria-label="Close forecast details" onClick={() => setPanel(null)}>×</button></header>
      {panel === 'settings' ? <div className="forecast-settings">
        <label>Model<select aria-label="Forecast model" defaultValue="mini"><option value="mini">Kronos-mini</option></select></label>
        <label title="Optional conditional-volatility comparison using the same history; requires at least 101 closes and does not predict direction.">
          <input type="checkbox" checked={includeVolatility} onChange={event => setIncludeVolatility(event.target.checked)} />GARCH volatility comparison
        </label>
        <label>Future bars<input aria-label="Forecast horizon" type="number" min={1} max={20} value={horizon} onChange={event => setHorizon(Number(event.target.value))} /></label>
        <label>Generated paths · up to 64<input aria-label="Forecast samples" type="number" min={1} max={64} value={samples} onChange={event => setSamples(Number(event.target.value))} /></label>
        <label>Temperature<input aria-label="Forecast temperature" type="number" min={0.01} step={0.1} value={temperature} onChange={event => setTemperature(Number(event.target.value))} /></label>
        <label>Top-p{topK > 0 ? ' · inactive with top-k' : ''}<input aria-label="Forecast top-p" type="number" min={0.01} max={1} step={0.05} value={topP} disabled={topK > 0} onChange={event => setTopP(Number(event.target.value))} /></label>
        <label>Top-k · 0 uses top-p<input aria-label="Forecast top-k" type="number" min={0} step={1} value={topK} onChange={event => setTopK(Number(event.target.value))} /></label>
        <label>Seed<input aria-label="Forecast seed" type="number" min={0} max={2147483647} step={1} value={seed} onChange={event => setSeed(Number(event.target.value))} /></label>
        <label>Cutoff override · UTC<input aria-label="Forecast cutoff UTC" type="datetime-local" value={cutoff} onChange={event => setCutoff(event.target.value)} /></label>
      </div> : forecast ? <>
        <dl>
          <dt>Instrument</dt><dd>{forecast.marketData.symbol} · {forecast.marketData.timeframe}</dd>
          <dt>Model</dt><dd>{forecast.modelRef}</dd>
          <dt>Input candles</dt><dd>{forecast.history.length}</dd>
          <dt>Future bars / paths</dt><dd>{forecast.horizon} / {forecast.parameters.sampleCount}</dd>
          <dt>Temperature / top-p / top-k</dt><dd>{forecast.parameters.temperature ?? '—'} / {forecast.parameters.topP ?? '—'} / {forecast.parameters.topK ?? 0}{forecast.parameters.topK ? ' · top-p inactive' : ''}</dd>
          <dt>Seed</dt><dd>{forecast.parameters.seed}</dd>
          <dt>Cutoff</dt><dd>{forecast.cutoff}</dd>
          <dt>Saved ID</dt><dd>{forecast.forecastId}</dd>
          <dt>Status</dt><dd>{forecast.status}</dd>
          {!!forecast.samplePaths?.length && <><dt>Shadow</dt><dd>Raw sampled closes, including flagged paths. Not a confidence interval.</dd></>}
        </dl>
        {forecast.volatilityComparison && <details><summary>Conditional volatility · GARCH</summary>
          {forecast.volatilityComparison.status === 'available' ? <dl>
            <dt>Next-bar volatility</dt><dd>{forecast.volatilityComparison.volatilityPercentPerBar?.[0]?.toFixed(3)}% of log return</dd>
            <dt>Held-out bars</dt><dd>{forecast.volatilityComparison.heldOut?.bars}</dd>
            <dt>Variance MAE</dt><dd>{forecast.volatilityComparison.heldOut?.varianceMae.toFixed(4)}</dd>
            <dt>Constant-variance benchmark MAE</dt><dd>{forecast.volatilityComparison.heldOut?.constantVarianceMae.toFixed(4)}</dd>
          </dl> : <p>{forecast.volatilityComparison.reason || forecast.volatilityComparison.status}</p>}
          <p>Volatility, not direction or options implied volatility. Held-out variance error is not future price accuracy.</p>
        </details>}
        {(forecast.marketData.symbol !== symbol || forecast.marketData.timeframe !== timeframe) && <p role="status">Saved: {forecast.marketData.symbol} · {forecast.marketData.timeframe}</p>}
        {forecast.diagnostics && <p role="alert">{forecast.diagnostics}</p>}
        {!forecast.samplePaths?.length && <p data-testid="average-only-notice">Average-only record; individual paths were not retained.</p>}
        {forecast.forecastId && <button disabled={busy} type="button" onClick={() => void compare()}>Compare later actuals</button>}
        {comparison && <div><p>{comparison.status}</p>{comparison.metrics && <dl>
          <dt>Matched bars</dt><dd>{comparison.metrics.matchedBars} / {comparison.metrics.horizon}</dd>
          <dt>Close MAE</dt><dd>{comparison.metrics.closeMae.toFixed(4)}</dd>
          <dt>High MAE</dt><dd>{comparison.metrics.highMae.toFixed(4)}</dd>
          <dt>Low MAE</dt><dd>{comparison.metrics.lowMae.toFixed(4)}</dd>
          <dt title="Predicting the starting close unchanged at every future bar; a comparison only.">No-change benchmark MAE</dt><dd>{comparison.metrics.lastCloseBaselineMae.toFixed(4)}</dd>
          <dt>Terminal direction</dt><dd>{comparison.metrics.terminalDirectionCorrect == null ? 'Unavailable' : comparison.metrics.terminalDirectionCorrect ? 'Correct' : 'Incorrect'}</dd>
        </dl>}</div>}
        <details><summary>Raw data</summary><pre>{JSON.stringify(forecast, null, 2)}</pre></details>
        <details><summary>Source and model warnings</summary><ul>{forecast.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></details>
      </> : <dl><dt>Instrument</dt><dd>{symbol} · {timeframe}</dd><dt>Loaded candles</dt><dd>{history.length}</dd><dt>Selected candles</dt><dd>{chartWindow?.count || 0}</dd><dt>Cutoff</dt><dd>{chartWindow?.end || '—'}</dd></dl>}
    </aside>}
  </div>;
}
