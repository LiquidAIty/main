// Entity: Building Modeling
// Relationship: Connects the recovered Three.js viewport and the shared inspector to real Project-owned OSM edits, saved cases and SQL comparisons.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { OpenStudioBlockScene } from './EnergyFacadeSurface';
import type { OpenStudioGeometry, OpenStudioSelection } from '../../features/energy/openStudioGeometry';
import { GRAPH_THEME, graphDrawerButtonStyle } from '../../../../../../client/src/components/graph/graphVisualTokens';
import ResultComparison, { caseName, type Comparison } from './ResultComparison';
import ModelInputs, { type InputControl, type InputValues } from './ModelInputs';

type Channel = { id: string; name: string; key: string; units: string; frequency: string };
type Case = {
  id: string; name: string; revision: string; geometry: OpenStudioGeometry;
  walls: { handle: string; name: string; ratio: number; editable: boolean }[];
  resultsCurrent: boolean;
  controls: InputControl[];
  requestedOutputs: { name: string; key: string; frequency: string }[];
  availableOutputs: { name: string; units: string; sourceRunId: string }[];
  history: { runId: string; revision: string }[];
  weather: { file: string; dates: string[]; sha256: string } | null;
  rooftop?: { heatingFuel: string; coolingFuel: string; airLoop: string } | null;
  run: { status: string; runId: string; revision: string; channels: Channel[]; nativeEnd: string } | null;
};
type State = { configured: boolean; cases: Case[] };
export async function modelingRequest(projectId: string, payload: Record<string, unknown>) {
  const response = await fetch(`/api/nrgsim/projects/${encodeURIComponent(projectId)}`, {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || result.detail || 'Modeling request failed');
  return result;
}

export default function NrgsimWorkspace({ projectId, inspectorContainer, completedRunId = '' }: { projectId: string; inspectorContainer: HTMLElement | null; completedRunId?: string }) {
  const [state, setState] = useState<State | null>(null);
  const [caseId, setCaseId] = useState('baseline');
  const [performanceId, setPerformanceId] = useState('case1');
  const [baselineId, setBaselineId] = useState('baseline');
  const [selection, setSelection] = useState<OpenStudioSelection | null>(null);
  const [scopeHandle, setScopeHandle] = useState('');
  const [wallHandle, setWallHandle] = useState('');
  const [ratio, setRatio] = useState(40);
  const [tab, setTab] = useState('geometry');
  const [draft, setDraft] = useState<InputValues>({});
  const [caseLabel, setCaseLabel] = useState('');
  const [caseLayout, setCaseLayout] = useState('copy');
  const [heatingFuel, setHeatingFuel] = useState('NaturalGas');
  const [economizer, setEconomizer] = useState(true);
  const [runIds, setRunIds] = useState<Record<string, string>>({});
  const [selectedRuns, setSelectedRuns] = useState<Record<string, NonNullable<Case['run']>>>({});
  const [snapshot, setSnapshot] = useState<Case | null>(null);
  const [outputName, setOutputName] = useState('');
  const [outputFrequency, setOutputFrequency] = useState('Hourly');
  const host = useRef<HTMLDivElement>(null);
  const [inspectorSpace, setInspectorSpace] = useState(0);
  const [sunDate, setSunDate] = useState('');
  const [sunPoints, setSunPoints] = useState<{hour: number; x: number; y: number; z: number; aboveHorizon: boolean}[]>([]);
  const [sunHour, setSunHour] = useState(12);
  const [view, setView] = useState<'model' | 'split' | 'results'>('model');
  const [chartMode, setChartMode] = useState<'profile' | 'heatmap' | 'timeseries' | 'daily' | 'monthly'>('profile');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [channelId, setChannelId] = useState('');
  const [selectedCases, setSelectedCases] = useState<string[]>(['baseline', 'case1']);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [start, setStart] = useState(''), [end, setEnd] = useState('');
  const current = state?.cases.find(item => item.id === caseId);
  const active = snapshot || current;
  const wall = active?.walls.find(item => item.handle === wallHandle);
  const completed = state?.cases.filter(item => item.run?.status === 'success') || [];
  const comparable = selectedCases.length === 2 && selectedCases.every(id => completed.some(item => item.id === id));
  const comparisonRuns = selectedCases.map(id => runIds[id]
    ? (selectedRuns[id]?.runId === runIds[id] ? selectedRuns[id] : completed.find(item => item.id === id)?.run?.runId === runIds[id] ? completed.find(item => item.id === id)?.run : null)
    : completed.find(item => item.id === id)?.run);
  const available = (comparisonRuns[0]?.channels || []).filter(channel => comparisonRuns.every(run => run?.channels.some(item => item.id === channel.id)));
  const glazingDirty = !!wall && Math.abs(ratio - wall.ratio * 100) > 1e-6;
  const dirty = Object.keys(draft).length > 0 || glazingDirty;
  const live = useRef({ dirty, busy, caseId });
  const refreshedRun = useRef(completedRunId);
  live.current = { dirty, busy, caseId };
  const readOnly = !!snapshot || caseId === 'baseline' || caseId === baselineId || !!busy;
  const outputReadOnly = readOnly;
  const scopeControls = (active?.controls || []).filter(control => control.scopes.includes(scopeHandle));
  const canAddRooftop = caseId.startsWith('case_') && active?.geometry.spaces?.length === 1 && !active.rooftop;
  const tabs = ['site', 'geometry', 'construction', 'openings', 'activity', 'lighting', 'hvac', 'simulation', 'results']
    .filter(name => name === 'results' || name === 'site' || (name === 'hvac' && canAddRooftop) || (name === 'openings' && wall?.editable) || scopeControls.some(control => control.tab === name));
  useEffect(() => { if (active?.weather && !active.weather.dates.includes(sunDate)) setSunDate(active.weather.dates[0]); }, [active?.revision]);
  useEffect(() => { setCaseLayout('copy'); }, [caseId]);
  useEffect(() => {
    if (!sunDate || !active?.weather) return;
    let valid = true; setSunPoints([]);
    modelingRequest(projectId, { operation: 'weather_day', caseId, date: sunDate, ...(snapshot?.run ? { runId: snapshot.run.runId } : {}) })
      .then(result => { if (valid) setSunPoints(result.points); }).catch(reason => { if (valid) setError(String(reason.message)); });
    return () => { valid = false; };
  }, [projectId, caseId, sunDate, active?.revision]);
  useEffect(() => {
    const drawer = inspectorContainer?.closest<HTMLElement>('[data-testid="workspace-inspector-drawer"]');
    if (!drawer || !host.current) return;
    const measure = () => {
      const panel = drawer.getBoundingClientRect(), area = host.current!.getBoundingClientRect();
      setInspectorSpace(drawer.dataset.open === 'true' && drawer.dataset.layout === 'docked'
        ? Math.min(area.width * .55, Math.max(0, area.right - panel.left + 12)) : 0);
    };
    const resize = new ResizeObserver(measure); resize.observe(drawer); resize.observe(host.current);
    const changes = new MutationObserver(measure); changes.observe(drawer, { attributes: true });
    measure(); return () => { resize.disconnect(); changes.disconnect(); };
  }, [inspectorContainer]);
  useEffect(() => {
    let current = true;
    modelingRequest(projectId, { operation: 'state' }).then(result => { if (current) setState(result); })
      .catch(reason => { if (current) setError(String(reason.message)); });
    return () => { current = false; };
  }, [projectId]);
  useEffect(() => {
    if (!completedRunId || refreshedRun.current === completedRunId || busy) return;
    refreshedRun.current = completedRunId;
    let valid = true;
    const requestedCase = caseId, previousRevision = current?.revision;
    modelingRequest(projectId, { operation: 'state' }).then(result => {
      if (!valid || live.current.caseId !== requestedCase) return;
      const next = result.cases.find((item: Case) => item.id === requestedCase);
      if (live.current.dirty || live.current.busy) {
        if (next && previousRevision && next.revision !== previousRevision) setError('The saved model changed. Your pending edits are retained; reconcile or discard them before saving.');
        return;
      }
      setState(result);
    }).catch(reason => { if (valid) setError(String(reason.message)); });
    return () => { valid = false; };
  }, [projectId, completedRunId, busy, caseId, current?.revision]);
  useEffect(() => {
    const refresh = () => {
      if (busy || dirty || document.visibilityState !== 'visible') return;
      const requestedCase = caseId;
      modelingRequest(projectId, { operation: 'state' }).then(result => {
        if (live.current.dirty || live.current.busy || live.current.caseId !== requestedCase) return;
        setState(result);
      }).catch(reason => setError(String(reason.message)));
    };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [projectId, busy, dirty, caseId]);
  useEffect(() => {
    if (!active) return;
    const handle = active.geometry.objects.some(item => item.handle === scopeHandle) || active.geometry.spaces?.some(item => item.handle === scopeHandle)
      || active.geometry.stories?.some(item => item.handle === scopeHandle)
      ? scopeHandle : active.geometry.modelId;
    const face = active.geometry.objects.find(item => item.handle === handle);
    const next = active.walls.find(item => item.handle === (face?.objectType === 'SubSurface' ? face.parentHandle : handle));
    setWallHandle(next?.handle || ''); setScopeHandle(handle);
    setRatio((next?.ratio || 0) * 100); setSelection(null);
    setDraft({});
  }, [caseId, active?.revision]);
  useEffect(() => { if (!tabs.includes(tab)) setTab(scopeControls[0]?.tab || 'geometry'); }, [scopeHandle, active?.revision]);
  useEffect(() => {
    if (!available.some(item=>item.id===channelId)) setChannelId((available.find(item => item.name === 'Zone Ideal Loads Supply Air Total Cooling Energy' && item.key === 'Building total')
      || available.find(item => item.name === 'Zone Ideal Loads Supply Air Total Cooling Energy') || available[0])?.id || '');
  }, [available, channelId]);
  async function act(payload: Record<string, unknown>, nextCase?: string) {
    if (busy) return;
    setComparison(null); setView('model'); setChartMode('profile');
    setBusy(payload.operation === 'run' ? `Running ${caseName(caseId)}…` : payload.operation === 'state' ? 'Reading model…' : 'Saving…'); setError('');
    try {
      const result = await modelingRequest(projectId, payload);
      setState(result);
      setDraft({});
      if (payload.operation === 'run') setRunIds(previous => { const next = { ...previous }; delete next[caseId]; return next; });
      if (nextCase) {
        const selected = result.cases.find((item: Case) => item.id === nextCase);
        const runId = runIds[nextCase] || (nextCase === baselineId ? selected?.run?.runId : undefined);
        const nextSnapshot = selected && runId
          ? { ...selected, ...await modelingRequest(projectId, { operation:'inspect_run', caseId:nextCase, runId }) } : null;
        setSnapshot(nextSnapshot);
        if (nextSnapshot?.run) setSelectedRuns(previous=>({...previous,[nextCase]:nextSnapshot.run}));
        setCaseId(nextCase);
        if (runId) setRunIds(previous => ({ ...previous, [nextCase]:runId }));
        if (nextCase !== baselineId) { setPerformanceId(nextCase); setSelectedCases([baselineId, nextCase]); }
      }
      if (payload.operation === 'create_case' && result.createdCaseId) {
        setSnapshot(null); setCaseId(result.createdCaseId); setPerformanceId(result.createdCaseId);
        setSelectedCases([baselineId, result.createdCaseId]); setCaseLabel(''); setCaseLayout('copy');
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(''); }
  }
  function select(value: OpenStudioSelection) {
    if (value.revision !== active?.revision) return;
    if (glazingDirty) { setError('Apply or discard the glazing edit before changing selection.'); return; }
    setSelection(value);
    setScopeHandle(value.handle);
    const handle = value.objectType === 'SubSurface' ? value.parentHandle : value.handle;
    const selectedWall = active.walls.find(item => item.handle === handle);
    setWallHandle(selectedWall?.handle || '');
    if (selectedWall) setRatio(selectedWall.ratio * 100);
  }
  function chooseGeometry(handle: string) {
    if (!active) return;
    if (glazingDirty) { setError('Apply or discard the glazing edit before changing selection.'); return; }
    const face = active.geometry.objects.find(item => item.handle === handle);
    if (face) select({ ...face, modelId: active.geometry.modelId, revision: active.revision });
    else { setScopeHandle(handle); setSelection(null); setWallHandle(''); }
  }
  async function chooseRun(runId: string) {
    if (busy || dirty) return;
    setComparison(null); setView('model'); setChartMode('profile');
    setBusy('Reading saved run…'); setError('');
    try {
      if (runId) {
        const frozen={ ...current!, ...await modelingRequest(projectId, { operation: 'inspect_run', caseId, runId }) };
        setSnapshot(frozen); setSelectedRuns(previous=>({...previous,[caseId]:frozen.run}));
      }
      else { setState(await modelingRequest(projectId, { operation: 'state' })); setSnapshot(null); }
      setRunIds(previous => { const next = { ...previous }; if (runId) next[caseId] = runId; else delete next[caseId]; return next; });
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(''); }
  }
  function saveStudyOutputs(outputs: Case['requestedOutputs']) {
    if (!current || outputReadOnly) return;
    return act({ operation: 'outputs', caseId, revision: current.revision, outputs });
  }
  async function chooseBaseline(id: string) {
    const base=completed.find(item=>item.id===id);
    if (!base?.run || id===performanceId || busy || dirty) return;
    setBusy('Reading baseline…'); setError('');
    try {
      const frozen={...base,...await modelingRequest(projectId,{operation:'inspect_run',caseId:id,runId:base.run.runId})};
      setSelectedRuns(previous=>({...previous,[id]:frozen.run}));
      if (caseId===baselineId) { setCaseId(id); setSnapshot(frozen); }
      setBaselineId(id); setSelectedCases([id,performanceId]);
      setRunIds(previous=>({...previous,[id]:base.run!.runId}));
      setComparison(null); setView('model');
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(''); }
  }
  async function showComparison(fullPeriod = false) {
    const cases = selectedCases.filter(id => completed.some(item => item.id === id));
    if (cases.length !== 2 || busy || dirty) return;
    setBusy('Reading results…'); setError('');
    try {
      const result: Comparison = await modelingRequest(projectId, { operation: 'compare', cases, baselineCaseId:baselineId, runIds, channel: channelId, start: fullPeriod ? null : start || null, end: fullPeriod ? null : end || null });
      setComparison(result);
      setRunIds(previous=>({...previous,...Object.fromEntries(result.cases.map(item=>[item.caseId,item.runId]))}));
      setSelectedRuns(previous=>({...previous,...Object.fromEntries(result.cases.flatMap(item=>{
        const run=comparisonRuns.find(candidate=>candidate?.runId===item.runId);
        return run ? [[item.caseId,run]] : [];
      }))}));
      if (!result.hourly) setChartMode('timeseries');
      else if (!result.energy && (chartMode === 'daily' || chartMode === 'monthly')) setChartMode('profile');
      const selectedRun = result.cases.find(item => item.caseId === caseId) || result.cases.find(item => item.caseId === baselineId);
      const displayedCase = state?.cases.find(item => item.id === selectedRun?.caseId);
      if (selectedRun && displayedCase) {
        setCaseId(displayedCase.id);
        if (selectedRun.revision === displayedCase.revision && selectedRun.runId === displayedCase.run?.runId) setSnapshot(displayedCase);
        else setSnapshot({ ...displayedCase, ...await modelingRequest(projectId, { operation: 'inspect_run', caseId: displayedCase.id, runId: selectedRun.runId }) });
      }
      if (fullPeriod) { setStart(''); setEnd(''); setChartMode('timeseries'); }
      setView('split');
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(''); }
  }
  const button = graphDrawerButtonStyle({ minHeight: 30, padding: '5px 9px', fontSize: 12 });
  const input = graphDrawerButtonStyle({ width: '100%', minHeight: 30, fontSize: 12, textAlign: 'left' });
  const controls = <div style={{ display: 'grid', gap: 12, color: GRAPH_THEME.surface.text, fontSize: 12 }}>
    <div style={{ display: 'flex', gap: 4 }}>
      {[baselineId, performanceId].map(id => <button key={id} style={{ ...button, flex: 1, borderColor: caseId === id ? GRAPH_THEME.accent.primary : undefined }} disabled={!!busy || dirty || !state?.cases.some(item => item.id === id)}
        onClick={() => {
          if (state?.cases.some(item => item.id === id)) void act({ operation: 'state' }, id);
        }}>{id === baselineId ? 'Baseline' : 'Performance'}</button>)}
    </div>
    {active && tab === 'hvac' && canAddRooftop ? <fieldset style={{ border: 0, padding: 0, display: 'grid', gap: 8 }}><legend>Packaged single-zone DX</legend>
      <label>Heating<select aria-label="Packaged heating fuel" style={input} disabled={readOnly || dirty} value={heatingFuel} onChange={event => setHeatingFuel(event.target.value)}>
        <option value="NaturalGas">Gas furnace</option><option value="Electricity">Electric resistance</option>
      </select></label>
      <label><input type="checkbox" checked={economizer} disabled={readOnly || dirty} onChange={event => setEconomizer(event.target.checked)} /> Air-side economizer</label>
      <button style={button} disabled={readOnly || dirty} onClick={() => void act({ operation: 'packaged_rooftop', caseId, revision: active.revision,
        zoneHandle: active.geometry.spaces![0].thermalZoneHandle, heatingFuel, economizer })}>Replace Ideal Loads in this copy</button>
    </fieldset> : null}
    {state?.cases.some(item => item.id !== baselineId) ? <select aria-label="Performance case" value={performanceId} style={input} disabled={!!busy || dirty}
      onChange={event => { if (event.target.value) void act({ operation: 'state' }, event.target.value); }}>
      {state.cases.filter(item => item.id !== baselineId).map(item => <option key={item.id} value={item.id}>{item.id.startsWith('case_') ? item.name : caseName(item.id)}</option>)}
    </select> : null}
    {active ? <select aria-label="Model revision" style={input} value={snapshot?.run?.runId || ''} disabled={!!busy || dirty} onChange={event => void chooseRun(event.target.value)}>
      <option value="">Current inputs{current?.resultsCurrent ? ' · match latest run' : ' · not yet simulated'}</option>
      {(current?.history || []).map(run => <option key={run.runId} value={run.runId}>Completed · {run.runId}</option>)}
    </select> : null}
    {snapshot && caseId !== 'baseline' && caseId !== baselineId ? <button style={button} disabled={!!busy || dirty} onClick={() => void chooseRun('')}>Edit current model</button> : null}
    {active && (caseId === 'baseline' || caseId === baselineId) ? <button style={button} disabled={!!busy || dirty || active.revision !== current?.revision} onClick={() => void act({
      operation: 'create_case', sourceCaseId: caseId, revision: current!.revision, name: current!.name + ' — editable copy', layout: 'copy',
    })}>Create editable copy</button> : null}
    <div role="tablist" style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {tabs.map(item => <button key={item} role="tab" aria-selected={tab === item} onClick={() => setTab(item)} style={{ ...button, borderColor: tab === item ? GRAPH_THEME.accent.primary : undefined }}>{item === 'hvac' ? 'HVAC' : item[0].toUpperCase() + item.slice(1)}</button>)}
    </div>
    {active && tab === 'geometry' && !snapshot ? <details><summary>New case</summary><div style={{ display: 'grid', gap: 6, paddingTop: 6 }}>
      <input aria-label="New case name" placeholder="Case name" style={input} value={caseLabel} disabled={!!busy} onChange={event => setCaseLabel(event.target.value)} />
      <select aria-label="New case geometry" style={input} value={caseLayout} disabled={!!busy} onChange={event => setCaseLayout(event.target.value)}>
        <option value="copy">Copy current model</option>
        {active.geometry.spaces?.length === 1 && !active.rooftop ? <option value="core_perimeter">Core + perimeter floor</option> : null}
        {active.geometry.stories?.length === 1 ? <option value="upper_floor">Add aligned upper floor</option> : null}
      </select>
      <button style={button} disabled={!!busy || dirty || !caseLabel.trim()} onClick={() => void act({ operation: 'create_case', sourceCaseId: caseId, revision: active.revision, name: caseLabel, layout: caseLayout })}>Create case</button>
    </div></details> : null}
    {active && tab === 'geometry' && active.geometry.spaces?.find(space => space.handle === scopeHandle) ? <div style={{ fontSize: 11, opacity: .8 }}>
      {active.geometry.spaces.find(space => space.handle === scopeHandle)!.conditioning?.map(type => type === 'ZoneHVAC_IdealLoadsAirSystem' ? 'Ideal Loads' : type).join(', ') || 'Unconditioned'}
    </div> : null}
    {active && tab !== 'results' ? <ModelInputs controls={scopeControls.filter(control => control.tab === tab)} values={draft} disabled={readOnly}
      onChange={(id, value) => setDraft(previous => { const next = { ...previous }; if (value === active.controls.find(control => control.id === id)?.value) delete next[id]; else next[id] = value; return next; })} /> : null}
    {!active ? <button style={button} disabled={!!busy || !state?.configured} onClick={() => void act({ operation: 'initialize' })}>Open saved model</button> : tab === 'site' ? <>
      {active.weather ? <fieldset style={{ border: 0, padding: 0, display: 'grid', gap: 8 }}><legend style={{ fontSize: 11, overflowWrap: 'anywhere' }}>{active.weather.file}</legend>
        <label>Date<input aria-label="Weather date" type="date" style={input} min={active.weather.dates[0]} max={active.weather.dates.at(-1)} value={sunDate} onChange={event => { if (active.weather?.dates.includes(event.target.value)) setSunDate(event.target.value); }} /></label>
        <label>Local standard time · {sunHour}:00<input aria-label="Weather hour" type="range" min={1} max={24} step={1} value={sunHour} onChange={event => setSunHour(Number(event.target.value))} style={{ width: '100%', accentColor: GRAPH_THEME.accent.primary }} /></label>
      </fieldset> : null}
    </> : tab === 'geometry' || tab === 'openings' ? <>
      {wall?.editable ? <label>Glazing ratio (%)
        <input aria-label="Glazing ratio slider" type="range" min={1} max={95} step={1} value={ratio} onChange={event => setRatio(Number(event.target.value))} disabled={readOnly} style={{ width: '100%', accentColor: GRAPH_THEME.accent.primary }} />
        <input aria-label="Glazing ratio percent" type="number" min={1} max={95} step={1} value={Number(ratio.toFixed(4))} onChange={event => setRatio(Number(event.target.value))} disabled={readOnly} style={input} />
      </label> : null}
      {caseId !== 'baseline' && wall?.editable ? <button style={button} disabled={readOnly || Object.keys(draft).length > 0 || !Number.isFinite(ratio) || ratio <= 0 || ratio >= 100 || Math.abs(ratio - wall.ratio * 100) < 1e-6}
        onClick={() => void act({ operation: 'glazing', caseId, revision: active.revision, surfaceHandle: wall.handle, ratio: ratio / 100 })}>Apply</button> : null}
    </> : tab === 'simulation' ? <>
      <label>Study outputs<select aria-label="Requested output" style={input} value={outputName} disabled={outputReadOnly} onChange={event => setOutputName(event.target.value)}>
        <option value="">Select from EnergyPlus dictionary…</option>
        {active.availableOutputs.map(item => <option key={item.name} value={item.name}>{item.name} [{item.units}]</option>)}
      </select></label>
      <select aria-label="Output frequency" style={input} value={outputFrequency} disabled={outputReadOnly} onChange={event => setOutputFrequency(event.target.value)}><option>Hourly</option><option>Timestep</option></select>
      <button style={button} disabled={outputReadOnly || !outputName || dirty} onClick={() => void saveStudyOutputs([...active.requestedOutputs.filter(item => item.name !== outputName), { name: outputName, key: '*', frequency: outputFrequency }])}>Add to this case</button>
      {active.requestedOutputs.map(item => <div key={`${item.name}:${item.frequency}`} style={{ display: 'flex', gap: 6, alignItems: 'center' }}><span style={{ flex: 1 }}>{item.name} · {item.frequency}</span>
        <button aria-label={`Remove ${item.name} from this case`} style={button} disabled={outputReadOnly || dirty || active.requestedOutputs.length < 2} onClick={() => void saveStudyOutputs(active.requestedOutputs.filter(value => value !== item))}>×</button></div>)}
    </> : tab === 'results' ? <>
      <label>Baseline case<select aria-label="Comparison baseline case" style={input} value={baselineId} disabled={!!busy || dirty}
        onChange={event => void chooseBaseline(event.target.value)}>
        {completed.filter(item=>item.id!==performanceId).map(item=><option key={item.id} value={item.id}>{item.id.startsWith('case_')?item.name:caseName(item.id)}</option>)}
      </select></label>
      <label>Output<select aria-label="Output channel" style={input} value={channelId} onChange={event => setChannelId(event.target.value)}>
        {available.map(item => <option key={item.id} value={item.id}>{item.name} · {item.key} [{item.units}] · {item.frequency}</option>)}
      </select></label>
      <label>Compare baseline with<select aria-label="Comparison performance case" style={input} disabled={!!busy || dirty}
        value={selectedCases[1] || ''} onChange={event => { if (event.target.value) void act({ operation: 'state' }, event.target.value); }}>
        {!completed.some(item => item.id === selectedCases[1]) ? <option value="">Select a completed case…</option> : null}
        {completed.filter(item => item.id !== baselineId).map(item => <option key={item.id} value={item.id}>{item.id.startsWith('case_') ? item.name : caseName(item.id)}{item.resultsCurrent ? '' : ' — earlier saved version'}</option>)}
      </select></label>
      <label>From<input type="datetime-local" style={input} value={start} onChange={event => setStart(event.target.value)} /></label>
      <label>To<input type="datetime-local" style={input} value={end} onChange={event => setEnd(event.target.value)} /></label>
      <button style={button} disabled={!!busy || dirty || !channelId || !comparable} onClick={() => void showComparison()}>Compare</button>
      <button style={button} disabled={!!busy || dirty || !channelId || !comparable} onClick={() => void showComparison(true)}>{available.find(item => item.id === channelId)?.frequency === 'Hourly' ? 'Full-period hourly comparison' : 'Full-period time series'}</button>
      {active?.run ? <a style={{ ...button, textAlign: 'center', textDecoration: 'none' }} target="_blank" rel="noopener noreferrer"
        href={`/api/nrgsim/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(active.run.runId)}/report?caseId=${encodeURIComponent(caseId)}`}>Open EnergyPlus report</a> : null}
      <label>Chart<select aria-label="Comparison chart" style={input} value={chartMode} onChange={event => setChartMode(event.target.value as typeof chartMode)}>
        {!comparison || comparison.hourly ? <><option value="profile">Daily profile</option><option value="heatmap">Day × hour heat map</option></> : null}<option value="timeseries">Time series</option>
        {comparison?.energy ? <><option value="monthly">Monthly energy · stacked</option><option value="daily">Daily energy · stacked</option></> : null}
      </select></label>
      <label>View<select aria-label="Results placement" style={input} value={view} disabled={!comparison} onChange={event => setView(event.target.value as typeof view)}>
        <option value="model">Building</option><option value="split">Building + results below</option><option value="results">Results</option>
      </select></label>
    </> : null}
    {dirty ? <div style={{ display: 'flex', gap: 6 }}>{Object.keys(draft).length ? <button style={button} disabled={readOnly || glazingDirty} onClick={() => void act({ operation: 'edit_inputs', caseId, revision: active!.revision, edits: Object.entries(draft).map(([id, value]) => ({ id, value })) })}>Save changes</button> : null}
      <button style={button} disabled={!!busy} onClick={() => { setDraft({}); setRatio((wall?.ratio || 0) * 100); void act({ operation: 'state' }); }}>Discard and reload</button></div> : null}
    {active ? <button style={button} disabled={!!busy || !!snapshot || dirty || (!!wall && Math.abs(ratio - wall.ratio * 100) > 1e-6)}
      title={wall && Math.abs(ratio - wall.ratio * 100) > 1e-6 ? 'Apply the edited input before running' : undefined}
      onClick={() => void act({ operation: 'run', caseId, revision: active.revision })}>{busy.startsWith('Running') ? 'Running…' : 'Run simulation'}</button> : null}
    {busy && !busy.startsWith('Running') ? <div role="status">{busy}</div> : null}
    {error ? <div role="alert" style={{ color: '#F2A64A', overflowWrap: 'anywhere' }}>{error}</div> : null}
  </div>;
  return <div ref={host} style={{ height: '100%', display: 'flex', flexDirection: 'column', background: GRAPH_THEME.surface.base, paddingRight: inspectorSpace }}>
    {inspectorContainer ? createPortal(controls, inspectorContainer) : null}
    {view !== 'results' && active ? <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
      <GeometryTree geometry={active.geometry} selected={scopeHandle} onSelect={chooseGeometry} />
      <div style={{ width: '100%', height: '100%', minWidth: 0 }}><OpenStudioBlockScene geometry={active.geometry} selectedHandle={selection?.handle || scopeHandle || null} onSelect={select}
        sun={sunPoints.find(point => point.hour === sunHour)} onSunSelect={() => setTab('site')} /></div>
    </div> : null}
    {view !== 'model' && comparison ? <div style={{ flex: 2, minHeight: 0, borderTop: `1px solid ${GRAPH_THEME.surface.border}` }}><ResultComparison data={comparison} mode={chartMode} /></div> : null}
  </div>;
}

function GeometryTree({ geometry, selected, onSelect }: { geometry: OpenStudioGeometry; selected: string; onSelect: (handle: string) => void }) {
  const [engaged, setEngaged] = useState(false);
  const node = (handle: string, label: string) => <button type="button" title={label} onClick={() => onSelect(handle)}
    aria-pressed={selected === handle} style={{ display: 'inline-block', maxWidth: 'calc(100% - 18px)', verticalAlign: 'middle', minHeight: 25, padding: '2px 5px',
      background: selected === handle ? GRAPH_THEME.accent.primarySoft : 'transparent', color: GRAPH_THEME.surface.text,
      border: 0, textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer', fontSize: 12 }}>{label}</button>;
  const renderSpace = (space: NonNullable<OpenStudioGeometry['spaces']>[number]) => <details key={space.handle} style={{ paddingLeft: 10 }}>
        <summary style={{ whiteSpace: 'nowrap' }}>{node(space.handle, space.name)}</summary>
        {geometry.objects.filter(face => face.objectType === 'Surface' && face.spaceHandle === space.handle).map(face => {
          const openings = geometry.objects.filter(item => item.objectType === 'SubSurface' && item.parentHandle === face.handle);
          return openings.length ? <details key={face.handle} style={{ paddingLeft: 10 }}>
            <summary style={{ whiteSpace: 'nowrap' }}>{node(face.handle, `${face.name} · ${face.surfaceType}`)}</summary>
            {openings.map(opening => <div key={opening.handle} style={{ paddingLeft: 15 }}>{node(opening.handle, opening.name)}
              {geometry.objects.filter(item => item.objectType === 'ShadingSurface' && item.parentHandle === opening.handle).map(shade => <div key={shade.handle} style={{ paddingLeft: 10 }}>{node(shade.handle, shade.name)}</div>)}
            </div>)}
          </details> : <div key={face.handle} style={{ paddingLeft: 15 }}>{node(face.handle, `${face.name} · ${face.surfaceType}`)}</div>;
        })}
      </details>;
  return <nav aria-label="Building geometry" onPointerEnter={() => setEngaged(true)} onPointerLeave={() => setEngaged(false)}
    onFocus={() => setEngaged(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setEngaged(false); }}
    style={{ position: 'absolute', zIndex: 2, left: 12, top: 12, width: 230, maxWidth: '65%', maxHeight: 'calc(100% - 24px)',
      overflow: 'auto', background: 'transparent', opacity: engaged ? 1 : .65, transition: 'opacity 150ms',
      color: GRAPH_THEME.surface.text, textShadow: '0 1px 3px #000', pointerEvents: 'none' }}>
    <details open style={{ pointerEvents: 'auto' }}><summary style={{ whiteSpace: 'nowrap' }}>{node(geometry.modelId, geometry.name || 'Building')}</summary>
      {(geometry.stories || []).map(story => <details open key={story.handle} style={{ paddingLeft: 10 }}>
        <summary>{node(story.handle, story.name)}</summary>
        {(geometry.spaces || []).filter(space => space.storyHandle === story.handle).map(renderSpace)}
      </details>)}
      {(geometry.spaces || []).filter(space => !space.storyHandle).map(renderSpace)}
    </details>
  </nav>;
}
