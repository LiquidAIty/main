// Entity: Trading
// Relationship: Displays observed versus target Investment Category allocations and edits the user's saved Trader policy through the existing Card configuration callback, without submitting orders.
import { useEffect, useState } from 'react';
import { sameAllocationPolicy, type AllocationCategory, type AllocationPolicy, type PaperPosition, type PortfolioAllocation } from './tradingState';

const COLORS = ['#dba65b', '#719bc3', '#62b4b0', '#b98cbd', '#5796ae', '#9da86a', '#ba7d74', '#8a91c9', '#677887'];
const cash = (value: number | null) => value == null ? '—' : value.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
const percent = (value: number | null) => value == null ? '—' : `${value.toFixed(1)}%`;

function AllocationPie({ label, values }: { label: string; values: number[] | null }) {
  let start = 0;
  const stops = values?.map((value, index) => {
    const previous = start;
    start += value;
    return `${COLORS[index % COLORS.length]} ${previous}% ${start}%`;
  });
  return <figure style={{ margin: 0, textAlign: 'center' }}>
    <div role="img" aria-label={values ? label : `${label} unavailable`}
      style={{ width: 124, height: 124, borderRadius: '50%', margin: '0 auto 6px',
        background: stops ? `conic-gradient(${stops.join(',')})` : '#28323f' }} />
    <figcaption>{label}{values ? '' : ' · incomplete'}</figcaption>
  </figure>;
}

export default function PortfolioAllocationPanel({ allocation, positions, onSave }: {
  allocation: PortfolioAllocation;
  positions: PaperPosition[];
  onSave?: (policy: AllocationPolicy) => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(allocation.policy);
  const [submitted, setSubmitted] = useState<AllocationPolicy | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  useEffect(() => {
    if (!editing) setDraft(allocation.policy);
    if (submitted && sameAllocationPolicy(submitted, allocation.policy) && allocation.policySaved) setSubmitted(null);
  }, [allocation.policyHash, allocation.policySaved, editing, submitted]);
  const total = draft.categories.reduce((sum, row) => sum + row.targetPercent, 0);
  const valid = Math.abs(total - 100) < 0.000001 && draft.categories.every(row =>
    Number.isFinite(row.targetPercent) && row.minimumPercent >= 0 && row.minimumPercent <= row.targetPercent
    && row.maximumPercent >= row.targetPercent && row.maximumPercent <= 100
    && (row.maximumRiskPercent == null || (Number.isFinite(row.maximumRiskPercent) && row.maximumRiskPercent >= 0 && row.maximumRiskPercent <= 100)))
    && draft.permittedInstrumentTypes.length > 0
    && [draft.minimumLiquidReservePercent, draft.maximumPositionLossPercent, draft.maximumPositionWeightPercent]
      .every(value => value == null || (Number.isFinite(value) && value >= 0 && value <= 100))
    && draft.minimumLiquidReservePercent <= (draft.categories.find(row => row.id === 'cash')?.maximumPercent ?? 0);
  const update = (id: string, field: keyof Omit<AllocationCategory, 'id'>, value: string) =>
    setDraft(current => ({ ...current, preset: 'Custom', categories: current.categories.map(row => row.id === id
      ? { ...row, [field]: field === 'maximumRiskPercent' && value === '' ? null : Number(value) } : row) }));
  const categoryName = (id: string) => allocation.categories.find(row => row.id === id)?.name || id;
  const save = async () => {
    if (!valid || !onSave || saving) return;
    setSaving(true); setSaveError(''); setSubmitted(draft);
    try { await onSave(draft); setEditing(false); }
    catch (error) { setSubmitted(null); setSaveError(error instanceof Error ? error.message : 'Allocation save failed.'); }
    finally { setSaving(false); }
  };
  return <section aria-label="Investment Categories" className="portfolio-allocation">
    <header><strong>Investment Categories</strong>
      {onSave && <button type="button" disabled={saving} aria-expanded={editing} onClick={() => { setDraft(allocation.policy); setSaveError(''); setEditing(!editing); }}>
        {editing ? 'Cancel' : 'Edit allocation'}</button>}
    </header>
    <div className="allocation-pies">
      <AllocationPie label="Target" values={editing && !valid ? null : (editing ? draft : allocation.policy).categories.map(row => row.targetPercent)} />
      <AllocationPie label="Observed" values={allocation.allocationComplete ? allocation.categories.map(row => row.currentPercent!) : null} />
    </div>
    {!allocation.policySaved && <p className="allocation-note">High Options preset · not yet saved. Targets do not authorize investment.</p>}
    {submitted && <p role="status">Allocation change submitted. Waiting for saved policy readback.</p>}
    {saveError && <p role="alert">{saveError}</p>}
    <div className="allocation-table-wrap"><table>
      <thead><tr><th>Investment Category</th><th>Target</th><th>Observed</th>{editing && <><th>Min</th><th>Max</th><th>Risk limit</th></>}</tr></thead>
      <tbody>{draft.categories.map((row, index) => {
        const actual = allocation.categories.find(item => item.id === row.id);
        return <tr key={row.id}>
          <th scope="row"><span aria-hidden="true" style={{ color: COLORS[index] }}>● </span>{categoryName(row.id)}</th>
          <td>{editing ? <input disabled={saving} aria-label={`${categoryName(row.id)} target percent`} type="number" min="0" max="100" step="0.5"
            value={row.targetPercent} onChange={event => update(row.id, 'targetPercent', event.target.value)} /> : percent(row.targetPercent)}</td>
          <td title={cash(actual?.currentValueUsd ?? null)}>{percent(actual?.currentPercent ?? null)}</td>
          {editing && (['minimumPercent', 'maximumPercent', 'maximumRiskPercent'] as const).map(field => <td key={field}>
            <input disabled={saving} aria-label={`${categoryName(row.id)} ${field}`} type="number" min="0" max="100" step="0.5"
              value={row[field] ?? ''} placeholder={field === 'maximumRiskPercent' ? 'Unset' : ''}
              onChange={event => update(row.id, field, event.target.value)} /></td>)}
        </tr>;
      })}</tbody>
    </table></div>
    {editing && <form onSubmit={event => {
      event.preventDefault();
      void save();
    }}>
      <p role={valid ? 'status' : 'alert'}>Targets: {total.toFixed(1)}%{valid ? '' : ' · require 100% and valid limits'}</p>
      <details><summary>Risk limits and holdings</summary><div className="allocation-fields">
        {([['minimumLiquidReservePercent', 'Minimum liquid reserve %'], ['maximumPositionLossPercent', 'Maximum position loss %'],
          ['maximumPositionWeightPercent', 'Maximum position allocation %']] as const).map(([field, label]) => <label key={field}>{label}
          <input disabled={saving} type="number" min="0" max="100" step="0.5" aria-label={label} value={draft[field] ?? ''} placeholder="Unset"
            onChange={event => setDraft(current => ({ ...current, preset: 'Custom', [field]: event.target.value === '' && field !== 'minimumLiquidReservePercent' ? null : Number(event.target.value) }))} /></label>)}
        <fieldset><legend>Permitted instruments</legend>{['equity', 'etf', 'option'].map(instrument => <label key={instrument}>
          <input disabled={saving} type="checkbox" checked={draft.permittedInstrumentTypes.includes(instrument)} onChange={event => setDraft(current => ({
            ...current, preset: 'Custom', permittedInstrumentTypes: event.target.checked
              ? [...current.permittedInstrumentTypes, instrument] : current.permittedInstrumentTypes.filter(item => item !== instrument),
          }))} />{instrument === 'etf' ? 'ETF' : instrument === 'equity' ? 'Equity' : 'Option'}</label>)}</fieldset>
        {positions.map(position => { const id = position.instrumentId || position.symbol;
          return <label key={id}>{position.symbol}<select disabled={saving} aria-label={`${position.symbol} Investment Category`}
            value={draft.positionCategories[id] || ''} onChange={event => setDraft(current => {
              const assigned = { ...current.positionCategories };
              if (event.target.value) assigned[id] = event.target.value; else delete assigned[id];
              return { ...current, preset: 'Custom', positionCategories: assigned };
            })}><option value="">Unassigned</option>{allocation.categories.filter(row => row.id !== 'cash')
              .map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>;
        })}
      </div></details>
      <button type="submit" disabled={!valid || saving}>{saving ? 'Saving…' : 'Apply allocation'}</button>
    </form>}
    <details><summary>Capital and allocation headroom</summary>
      <dl className="trading-plan-terms">{([
        ['Reported cash', allocation.reportedCashUsd], ['Broker buying power', allocation.brokerBuyingPowerUsd],
        ['Settled cash', allocation.settledCashUsd], ['Plan reservations', allocation.reservedCapitalUsd],
        ['Expected exit proceeds', allocation.expectedExitProceedsUsd], ['Liquid reserve', allocation.minimumLiquidReserveUsd],
        ['Unreserved cash ceiling', allocation.availableUnreservedCashUsd],
      ] as const).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{cash(value)}</dd></div>)}</dl>
      <table><thead><tr><th>Allocation Lane</th><th>To target</th><th>To maximum</th></tr></thead><tbody>
        {allocation.categories.map(row => <tr key={row.id}><th>{row.name}</th><td>{cash(row.targetHeadroomUsd)}</td><td>{cash(row.maximumHeadroomUsd)}</td></tr>)}
      </tbody></table>
      {allocation.unassignedPositions.length > 0 && <p>Unassigned holdings: {allocation.unassignedPositions.join(', ')}</p>}
      {allocation.positionsWithMissingValue.length > 0 && <p>Missing market value: {allocation.positionsWithMissingValue.join(', ')}</p>}
      {allocation.shortPositions.length > 0 && <p>Short positions require margin-aware comparison: {allocation.shortPositions.join(', ')}</p>}
      {!allocation.allocationComplete && <p>Observed category totals are not fully reconciled to account equity.</p>}
      {allocation.limitations.map(line => <p key={line} className="allocation-note">{line}</p>)}
    </details>
  </section>;
}
