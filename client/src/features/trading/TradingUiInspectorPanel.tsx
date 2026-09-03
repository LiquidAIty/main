import { useEffect, useMemo, useState, type CSSProperties } from 'react';

import {
  readTradingConfiguration,
  type TradingConfiguration,
  type TradingEngineReadiness,
  type TradingSettings,
} from './tradingState';

const PANEL = '#172020';
const FIELD = '#202c2d';
const EDGE = '#3A4A4F';
const INK = '#E0DED5';
const MUTED = '#80969F';
const CYAN = '#72D7C7';
const RED = '#ff786e';

type InspectorTab = 'risk' | 'lifecycle' | 'charts' | 'integration';
type NumericSetting = {
  [K in keyof TradingSettings]: TradingSettings[K] extends number ? K : never
}[keyof TradingSettings];

type SliderSpec = {
  field: NumericSetting;
  label: string;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  description: string;
};

const RISK_SLIDERS: SliderSpec[] = [
  { field: 'paperBudgetUsd', label: 'Paper budget', min: 0, max: 1_000_000, step: 5_000, suffix: ' USD', description: 'Zero keeps allocation fail-closed.' },
  { field: 'allocationPerJobPercent', label: 'Allocation per Trade Job', min: 0, max: 100, step: 1, suffix: '%', description: 'Maximum budget share assigned to one accepted job.' },
  { field: 'maxConcurrentJobs', label: 'Concurrent Trade Jobs', min: 1, max: 20, step: 1, description: 'Maximum simultaneous deterministic monitoring lifecycles.' },
  { field: 'maxOpenPositions', label: 'Open paper positions', min: 0, max: 20, step: 1, description: 'Zero prevents a plan from opening a position.' },
  { field: 'maxPlanLossPercent', label: 'Maximum plan loss', min: 0, max: 20, step: .25, suffix: '%', description: 'Hard paper-loss ceiling for one accepted plan.' },
  { field: 'maxDailyLossPercent', label: 'Maximum daily loss', min: 0, max: 20, step: .25, suffix: '%', description: 'Portfolio fail-safe threshold for the trading day.' },
  { field: 'maxPortfolioDrawdownPercent', label: 'Maximum drawdown', min: 0, max: 50, step: .25, suffix: '%', description: 'Portfolio drawdown ceiling; zero leaves execution blocked.' },
  { field: 'defaultStopLossPercent', label: 'Default stop loss', min: 0, max: 25, step: .25, suffix: '%', description: 'A default guardrail, never a substitute for submitted plan terms.' },
  { field: 'minimumConfidencePercent', label: 'Minimum ENTER confidence', min: 0, max: 100, step: 1, suffix: '%', description: 'Minimum typed decision confidence before ENTER validation.' },
  { field: 'minimumRiskReward', label: 'Minimum risk / reward', min: 0, max: 10, step: .25, suffix: 'x', description: 'Minimum expected reward relative to submitted plan risk.' },
];

const LIFECYCLE_SLIDERS: SliderSpec[] = [
  { field: 'evaluationCadenceSeconds', label: 'Hermes evaluation cadence', min: 15, max: 3600, step: 15, suffix: ' sec', description: 'Reasoning cadence; the subsystem owns continuous monitoring.' },
  { field: 'heartbeatSeconds', label: 'Subsystem heartbeat', min: 15, max: 3600, step: 15, suffix: ' sec', description: 'Requested deterministic state/event heartbeat.' },
  { field: 'failSafeCooldownMinutes', label: 'Fail-safe cooldown', min: 1, max: 1440, step: 1, suffix: ' min', description: 'Minimum review window after a fail-safe transition.' },
  { field: 'staleDataSeconds', label: 'Stale-data threshold', min: 15, max: 3600, step: 15, suffix: ' sec', description: 'Marks observations stale without fabricating replacements.' },
];

const CHART_SLIDERS: SliderSpec[] = [
  { field: 'chartWindowBars', label: 'Candle window', min: 24, max: 240, step: 12, suffix: ' bars', description: 'Maximum recent candle count requested per Trade Job.' },
  { field: 'compactChartHeightPx', label: 'Compact chart height', min: 80, max: 220, step: 4, suffix: ' px', description: 'Default height for the multi-job candle grid.' },
];

const cardStyle: CSSProperties = {
  background: FIELD,
  border: `1px solid ${EDGE}`,
  borderRadius: 10,
  padding: 10,
};

function Slider({ spec, value, onChange }: {
  spec: SliderSpec;
  value: number;
  onChange: (value: number) => void;
}) {
  return <label style={cardStyle}>
    <span style={{ alignItems: 'center', color: INK, display: 'flex', fontSize: 10.5,
      fontWeight: 700, gap: 8, justifyContent: 'space-between' }}>
      <span>{spec.label}</span>
      <output style={{ color: CYAN }}>{value.toLocaleString()}{spec.suffix || ''}</output>
    </span>
    <input aria-label={spec.label} type="range" min={spec.min} max={spec.max}
      step={spec.step} value={value} onChange={(event) => onChange(Number(event.target.value))}
      style={{ accentColor: CYAN, margin: '9px 0 4px', width: '100%' }} />
    <span style={{ color: MUTED, display: 'block', fontSize: 9.5, lineHeight: 1.4 }}>
      {spec.description}
    </span>
  </label>;
}

export default function TradingUiInspectorPanel({ configuration, onSave }: {
  configuration: Record<string, unknown>;
  onSave: (configuration: TradingConfiguration) => void;
}) {
  const normalized = useMemo(() => readTradingConfiguration(configuration), [configuration]);
  const [tab, setTab] = useState<InspectorTab>('risk');
  const [draft, setDraft] = useState<TradingConfiguration>(normalized);
  const [strategyText, setStrategyText] = useState('{}');
  const [strategyError, setStrategyError] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<TradingEngineReadiness | null>(null);

  useEffect(() => {
    setDraft(normalized);
    setStrategyText(JSON.stringify(normalized.trading.strategyParameters, null, 2));
  }, [normalized]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/trading/readiness', { credentials: 'include', signal: controller.signal })
      .then(async (response) => response.ok ? response.json() : null)
      .then((value) => { if (value) setReadiness(value as TradingEngineReadiness); })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const update = <K extends keyof TradingSettings>(field: K, value: TradingSettings[K]) => {
    setDraft((current) => ({
      ...current,
      trading: { ...current.trading, [field]: value },
    }));
  };
  const renderSliders = (sliders: SliderSpec[]) => <div style={{ display: 'grid', gap: 9 }}>
    {sliders.map((spec) => <Slider key={spec.field} spec={spec}
      value={Number(draft.trading[spec.field])}
      onChange={(value) => update(spec.field, value)} />)}
  </div>;
  const save = () => {
    try {
      const parsed = JSON.parse(strategyText) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Strategy parameters must be a JSON object.');
      }
      setStrategyError(null);
      onSave({ ...draft, trading: {
        ...draft.trading,
        strategyParameters: parsed as TradingSettings['strategyParameters'],
      } });
    } catch (error) {
      setStrategyError(error instanceof Error ? error.message : 'Strategy parameters are invalid.');
    }
  };

  return <div data-testid="trading-ui-inspector" style={{ display: 'grid', gap: 12 }}>
    <div style={{ background: PANEL, border: `1px solid ${EDGE}`, borderRadius: 10, padding: 11 }}>
      <strong style={{ color: INK, fontSize: 13 }}>Operational settings</strong>
      <p style={{ color: MUTED, fontSize: 10.5, lineHeight: 1.45, margin: '5px 0 0' }}>
        Durable subsystem limits and display preferences. Agent prompts, tools, skills, model,
        Team, Script, and graph context remain in the Canvas Card editor.
      </p>
    </div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
      {(['risk', 'lifecycle', 'charts', 'integration'] as InspectorTab[]).map((entry) =>
        <button key={entry} type="button" aria-pressed={tab === entry} onClick={() => setTab(entry)}
          style={{ background: tab === entry ? `${CYAN}22` : FIELD, border: `1px solid ${tab === entry ? CYAN : EDGE}`,
            borderRadius: 8, color: tab === entry ? CYAN : MUTED, cursor: 'pointer', fontSize: 10,
            padding: '6px 8px', textTransform: 'capitalize' }}>{entry}</button>)}
    </div>

    {tab === 'risk' ? renderSliders(RISK_SLIDERS) : null}
    {tab === 'lifecycle' ? <div style={{ display: 'grid', gap: 9 }}>
      {renderSliders(LIFECYCLE_SLIDERS)}
      <label style={cardStyle}><span style={{ color: INK, fontSize: 10.5 }}>Market session</span>
        <select value={draft.trading.marketSession}
          onChange={(event) => update('marketSession', event.target.value as TradingSettings['marketSession'])}
          style={{ background: PANEL, border: `1px solid ${EDGE}`, borderRadius: 7, color: INK,
            marginTop: 7, padding: 7, width: '100%' }}>
          <option value="regular">Regular hours</option><option value="extended">Extended hours</option>
        </select></label>
      <label style={cardStyle}><span style={{ color: INK, fontSize: 10.5 }}>Strategy parameters</span>
        <textarea aria-label="Strategy parameters" value={strategyText}
          onChange={(event) => setStrategyText(event.target.value)} rows={6}
          style={{ background: PANEL, border: `1px solid ${strategyError ? RED : EDGE}`, borderRadius: 7,
            color: INK, fontFamily: 'monospace', fontSize: 10, marginTop: 7, padding: 8, resize: 'vertical', width: '100%' }} />
        <span style={{ color: strategyError ? RED : MUTED, display: 'block', fontSize: 9.5, marginTop: 5 }}>
          {strategyError || 'Typed JSON parameters are passed to the deterministic strategy boundary; no code executes here.'}
        </span></label>
    </div> : null}
    {tab === 'charts' ? <div style={{ display: 'grid', gap: 9 }}>
      <label style={cardStyle}><span style={{ color: INK, fontSize: 10.5 }}>Default timeframe</span>
        <select value={draft.trading.defaultTimeframe}
          onChange={(event) => update('defaultTimeframe', event.target.value as TradingSettings['defaultTimeframe'])}
          style={{ background: PANEL, border: `1px solid ${EDGE}`, borderRadius: 7, color: INK,
            marginTop: 7, padding: 7, width: '100%' }}>
          {['1Min', '5Min', '15Min', '1Hour', '1Day'].map((value) => <option key={value}>{value}</option>)}
        </select></label>
      {renderSliders(CHART_SLIDERS)}
    </div> : null}
    {tab === 'integration' ? <div style={{ display: 'grid', gap: 9 }}>
      <div style={cardStyle}><strong style={{ color: CYAN, fontSize: 10.5 }}>Paper only</strong>
        <p style={{ color: MUTED, fontSize: 9.5, lineHeight: 1.45, margin: '5px 0 0' }}>
          Live execution and end-user provider keys are structurally excluded from this configuration.
        </p></div>
      <label style={cardStyle}><span style={{ color: INK, fontSize: 10.5 }}>Broker connection reference</span>
        <input value={draft.trading.brokerConnectionRef} readOnly
          style={{ background: PANEL, border: `1px solid ${EDGE}`, borderRadius: 7, color: MUTED,
            marginTop: 7, padding: 7, width: '100%' }} />
        <span style={{ color: MUTED, display: 'block', fontSize: 9.5, marginTop: 5 }}>
          Reference only; secrets remain in server-owned configuration.
        </span></label>
      <div style={cardStyle}><strong style={{ color: INK, fontSize: 10.5 }}>Adapter readiness</strong>
        <pre style={{ color: MUTED, fontSize: 9, margin: '7px 0 0', overflow: 'auto', whiteSpace: 'pre-wrap' }}>
          {readiness ? JSON.stringify({ status: readiness.status, version: readiness.version,
            lifecycle: readiness.lifecycle, adapter: readiness.adapter }, null, 2) : 'Unavailable'}
        </pre></div>
    </div> : null}

    <button type="button" onClick={save}
      style={{ background: CYAN, border: 0, borderRadius: 9, color: '#071411', cursor: 'pointer',
        fontSize: 11, fontWeight: 800, padding: '9px 11px' }}>Save operational settings</button>
  </div>;
}
