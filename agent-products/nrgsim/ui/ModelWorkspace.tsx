// Entity: Building Workspace
// Relationship: This surface joins the existing agent conversation, Pascal projection, contextual inspector, and actual OSM save/reopen workflow.
import { useCallback, useEffect, useRef, useState } from 'react';
import RightGlassDrawer from '../../../client/src/components/graph/RightGlassDrawer';
import { GRAPH_THEME, SOLARPUNK_PALETTE } from '../../../client/src/components/graph/graphVisualTokens';
import { modelingRequest, objectLabel, type ObjectProperties, type WorkspaceState } from './contracts';
import ModelViewport from './ModelViewport';
import ObjectInspector from './ObjectInspector';
import './workspace.css';

type Props = {
  projectId: string | null;
  agents: Array<{ cardId: string; address: string; title: string }>;
  onAgentRequest: (text: string) => Promise<unknown>;
  agentBusy: boolean;
};

export default function ModelWorkspace({ projectId, agents, onAgentRequest, agentBusy }: Props) {
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [properties, setProperties] = useState<ObjectProperties | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [address, setAddress] = useState('');
  const [filter, setFilter] = useState('');
  const [label, setLabel] = useState('Office study');
  const [request, setRequest] = useState('');
  useEffect(() => {
    setAddress((current) => agents.some((agent) => agent.address === current)
      ? current : agents.length === 1 ? agents[0].address : '');
  }, [agents]);
  const currentProject = useRef(projectId);
  currentProject.current = projectId;
  const refresh = useCallback(async () => {
    if (!projectId) return;
    const next = await modelingRequest<WorkspaceState>(projectId, 'state');
    if (currentProject.current !== projectId) return;
    setState(next);
    if (next.selection) {
      const readback = await modelingRequest<ObjectProperties>(projectId, 'properties', { arguments: { handle: next.selection } });
      if (currentProject.current === projectId) setProperties(readback);
    }
  }, [projectId]);
  const run = useCallback(async (operation: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await operation(); await refresh(); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return false; }
    finally { setBusy(false); }
  }, [refresh]);
  useEffect(() => {
    setState(null); setProperties(null);
    void refresh().catch((cause) => setError(String(cause)));
  }, [refresh]);
  useEffect(() => {
    if (!agentBusy) void refresh().catch((cause) => setError(String(cause)));
  }, [agentBusy, refresh]);
  const select = (handle: string) => void run(async () => {
    if (!projectId || !state) return;
    await modelingRequest(projectId, 'select', { revision: state.revision, arguments: { handle } });
    setProperties(null);
    setInspectorOpen(true);
  });
  const askAgent = async (text: string) => {
    if (!address || !projectId) throw new Error('Choose an authorized saved modeling Card first.');
    const current = await modelingRequest<WorkspaceState>(projectId, 'state');
    setState(current);
    const selected = current.selection && current.projection?.objects[current.selection];
    await onAgentRequest(`@${address} ${text}\n\nActive NRGSIM application context: ${JSON.stringify({
      projectId, modelId: current.activeModel, revision: current.revision, selectedObject: selected || null,
    })}\nUse the granted native OpenStudio MCP tools in this Project's active session. Read current values before editing and read them back afterward. Do not edit model files through a shell.`);
  };
  if (!projectId) return <p className="nrgsim-empty">Select a Project to begin building modeling.</p>;
  const objects = Object.values(state?.projection?.objects || {});
  const selected = state?.selection ? state.projection?.objects[state.selection] || null : null;
  const surfaces = state?.projection?.selectableHandles || [];
  return <div className="nrgsim-workspace" style={{
    '--nrgsim-accent': SOLARPUNK_PALETTE.sea,
    color: GRAPH_THEME.drawer.inputText,
  } as React.CSSProperties}>
    <header>
      <div><strong>NRGSIM</strong><small>OpenStudio modeling</small></div>
      <button disabled={busy || agentBusy || !address} onClick={() => void run(async () => {
        await modelingRequest(projectId, 'new', { revision: state?.revision, arguments: { label } });
        await askAgent('Create a simple rectangular office from the new empty model. Use the existing create_baseline_osm SDK recipe with one floor, ordinary ASHRAE system 03 and window-to-wall ratio 0.3. This is an ordinary starter example, not an Appendix G baseline or compliance result. Inspect the Spaces, Thermal Zones, loads and HVAC, and report the actual defaults and assumptions.');
      })}>New Building</button>
      <input aria-label="Model name" value={label} onChange={(event) => setLabel(event.target.value)} />
      <button disabled={busy || !state?.activeModel} onClick={() => void run(() =>
        modelingRequest(projectId, 'save', { revision: state?.revision, arguments: { label } }))}>Save OSM</button>
      <select aria-label="Reopen model" value="" disabled={busy} onChange={(event) => {
        const modelId = event.target.value;
        if (modelId) void run(() => modelingRequest(projectId, 'reopen', { revision: state?.revision, arguments: { modelId } }));
      }}><option value="">Reopen saved model…</option>{state?.models.filter((model) => model.savedAt).map((model) =>
        <option key={model.id} value={model.id}>{model.label}</option>)}</select>
      <button disabled={busy} onClick={() => void run(refresh)}>Refresh</button>
    </header>
    {error && <div role="alert" className="nrgsim-error">{error}</div>}
    <div className="nrgsim-body">
      <aside className="nrgsim-tree">
        <input aria-label="Filter OpenStudio objects" placeholder="Find an object…" value={filter} onChange={(event) => setFilter(event.target.value)} />
        {['Building', 'BuildingStory', 'Space', 'ThermalZone', 'Surface', 'SubSurface', 'SpaceType', 'LightsDefinition', 'Construction', 'Material', 'AirLoopHVAC', 'PlantLoop']
          .map((type) => {
            const matches = objects.filter((object) => (object.category || object.type) === type && object.name.toLowerCase().includes(filter.toLowerCase()));
            if (!matches.length) return null;
            return <details key={type} open={['Building', 'Space', 'ThermalZone'].includes(type)}>
              <summary>{objectLabel[type] || type} <span>{matches.length}</span></summary>
              {matches.map((object) => <button key={object.handle} aria-pressed={object.handle === selected?.handle}
                onClick={() => select(object.handle)} title={object.handle}>{object.name || object.type}</button>)}
            </details>;
          })}
      </aside>
      <main>
        {state?.projection && surfaces.length ? <ModelViewport
          url={`/api/nrgsim/${projectId}/display?revision=${state.revision}`}
          selection={state.selection} handles={surfaces} onSelect={select} /> :
          <div className="nrgsim-empty"><h2>Start with a real building.</h2>
            <p>Choose a saved modeling Card, then New Building. The Card creates actual Spaces, Thermal Zones, surfaces and systems in OpenStudio.</p>
            <p>No template OSM is required. The first recipe uses SDK defaults; these are a starting assumption, not a calibrated building or code-compliance result.</p>
          </div>}
      </main>
      <RightGlassDrawer title="OpenStudio Inspector" isOpen={inspectorOpen}
        onClose={() => setInspectorOpen(false)} onOpen={() => setInspectorOpen(true)}
        defaultWidth={340} minWidth={300} maxWidth={500} top={64} right={12}
        movable storageKey="nrgsim.inspector.width" dataTestId="nrgsim-inspector-drawer">
        <ObjectInspector object={selected} properties={properties} busy={busy}
          onSelect={select} onEdit={async (property, value) => {
            if (!selected || !state) return false;
            return run(() => modelingRequest(projectId, 'edit', { revision: state.revision, arguments: {
              object_type: selected.type, object_handle: selected.handle, property_name: property, value,
            } }));
          }} />
      </RightGlassDrawer>
    </div>
    <footer>
      <select aria-label="Modeling Card" value={address} onChange={(event) => setAddress(event.target.value)}>
        <option value="">Choose saved Card…</option>{agents.map((agent) =>
          <option key={agent.cardId} value={agent.address}>{agent.title}</option>)}
      </select>
      {!agents.length && <span className="nrgsim-muted">No connected saved modeling Card yet. Use Builder to configure its OpenStudio tools and connection.</span>}
      <input aria-label="Modeling request" value={request} placeholder="Ask your modeling Card to inspect or change this building…"
        onChange={(event) => setRequest(event.target.value)} />
      <button disabled={!address || !request || busy || agentBusy} onClick={() => void run(() => askAgent(request))}>Ask agent</button>
      <small>{busy ? 'Working…' : state?.activeModel ? `OSM revision ${state.revision}` : 'No active building'}</small>
      {state?.projection?.summary && <small>{state.projection.summary.spaces} Spaces · {state.projection.summary.thermalZones} Thermal Zones · {state.projection.summary.floorAreaM2.toFixed(1)} m²</small>}
    </footer>
  </div>;
}
