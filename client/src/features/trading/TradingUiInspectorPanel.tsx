import { useEffect, useMemo, useState, type CSSProperties } from 'react';

import {
  readTradingConfiguration,
  type TradingConfiguration,
  type TradingSettings,
} from './tradingState';

const PANEL = '#172020';
const FIELD = '#202c2d';
const EDGE = '#3A4A4F';
const INK = '#E0DED5';
const MUTED = '#80969F';
const CYAN = '#72D7C7';
const RED = '#ff786e';

type InspectorTab = 'risk' | 'lifecycle' | 'integration';
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
};

const RISK_SLIDERS: SliderSpec[] = [
  { field: 'paperBudgetUsd', label: 'Budget', min: 0, max: 1_000_000, step: 5_000, suffix: ' USD' },
  { field: 'allocationPerJobPercent', label: 'Allocation', min: 0, max: 100, step: 1, suffix: '%' },
  { field: 'maxConcurrentJobs', label: 'Concurrent trades', min: 1, max: 20, step: 1 },
  { field: 'maxOpenPositions', label: 'Positions', min: 0, max: 20, step: 1 },
  { field: 'maxPlanLossPercent', label: 'Maximum plan loss', min: 0, max: 20, step: .25, suffix: '%' },
  { field: 'maxDailyLossPercent', label: 'Maximum daily loss', min: 0, max: 20, step: .25, suffix: '%' },
  { field: 'maxPortfolioDrawdownPercent', label: 'Maximum drawdown', min: 0, max: 50, step: .25, suffix: '%' },
  { field: 'defaultStopLossPercent', label: 'Default stop loss', min: 0, max: 25, step: .25, suffix: '%' },
  { field: 'minimumConfidencePercent', label: 'Minimum ENTER confidence', min: 0, max: 100, step: 1, suffix: '%' },
  { field: 'minimumRiskReward', label: 'Minimum risk / reward', min: 0, max: 10, step: .25, suffix: 'x' },
];

const LIFECYCLE_SLIDERS: SliderSpec[] = [
  { field: 'evaluationCadenceSeconds', label: 'Evaluation interval', min: 15, max: 3600, step: 15, suffix: ' sec' },
  { field: 'heartbeatSeconds', label: 'Heartbeat', min: 15, max: 3600, step: 15, suffix: ' sec' },
  { field: 'failSafeCooldownMinutes', label: 'Fail-safe cooldown', min: 1, max: 1440, step: 1, suffix: ' min' },
  { field: 'staleDataSeconds', label: 'Stale-data threshold', min: 15, max: 3600, step: 15, suffix: ' sec' },
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
  </label>;
}

export default function TradingUiInspectorPanel({ configuration, onSave }: {
  configuration: Record<string, unknown>;
  onSave: (configuration: TradingConfiguration) => void;
}) {
  const normalized = useMemo(() => readTradingConfiguration(configuration), [configuration]);
  const [tab, setTab] = useState<InspectorTab>('risk');
  const [draft, setDraft] = useState<TradingConfiguration>(normalized);
  const [strategyText, setStrategyText] = useState(() => JSON.stringify(normalized.trading.strategyParameters, null, 2));
  const [strategyError, setStrategyError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(normalized);
    if (JSON.stringify(normalized.trading.strategyParameters) !== JSON.stringify(draft.trading.strategyParameters)) {
      setStrategyText(JSON.stringify(normalized.trading.strategyParameters, null, 2));
    }
  }, [normalized]);
  const update = <K extends keyof TradingSettings>(field: K, value: TradingSettings[K]) => {
    const next = { ...draft, trading: { ...draft.trading, [field]: value } };
    setDraft(next);
    onSave(next);
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
    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, color: INK, fontSize: 11 }}>
      Default timeframe
      <select value={draft.trading.defaultTimeframe}
        onChange={event => update('defaultTimeframe', event.target.value as TradingSettings['defaultTimeframe'])}
        style={{ background: PANEL, border: `1px solid ${EDGE}`, borderRadius: 7, color: INK, padding: 7 }}>
        <option value="1Min">1 min</option><option value="5Min">5 min</option><option value="15Min">15 min</option>
        <option value="1Hour">1 hour</option><option value="1Day">1 day</option>
      </select>
    </label>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
      {(['risk', 'lifecycle', 'integration'] as InspectorTab[]).map((entry) =>
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
          onChange={(event) => setStrategyText(event.target.value)} onBlur={save} rows={6}
          style={{ background: PANEL, border: `1px solid ${strategyError ? RED : EDGE}`, borderRadius: 7,
            color: INK, fontFamily: 'monospace', fontSize: 10, marginTop: 7, padding: 8, resize: 'vertical', width: '100%' }} />
        <span style={{ color: strategyError ? RED : MUTED, display: 'block', fontSize: 9.5, marginTop: 5 }}>
          {strategyError}
        </span></label>
    </div> : null}
    {tab === 'integration' ? <div style={{ display: 'grid', gap: 9 }}>
      <label style={cardStyle}><span style={{ color: INK, fontSize: 10.5 }}>Connection</span>
        <input value={draft.trading.brokerConnectionRef} readOnly
          style={{ background: PANEL, border: `1px solid ${EDGE}`, borderRadius: 7, color: MUTED,
            marginTop: 7, padding: 7, width: '100%' }} />
</label>
    </div> : null}

  </div>;
}
