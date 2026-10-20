// Entity: Building Workspace
// Relationship: This surface displays the active model and its inspector; conversation stays in the host Chat window.
import { useCallback, useEffect, useRef, useState } from 'react';
import RightGlassDrawer from '../../../client/src/components/graph/RightGlassDrawer';
import { GRAPH_THEME, SOLARPUNK_PALETTE } from '../../../client/src/components/graph/graphVisualTokens';
import { modelingRequest, type AuthoringOperation, type DrawingSettings, type WorkspaceState } from './contracts';
import ModelViewport from './ModelViewport';
import ObjectInspector from './ObjectInspector';
import ObjectTree from './ObjectTree';
import './workspace.css';

type Props = {
  projectId: string | null;
  agentBusy: boolean;
};

export default function ModelWorkspace({ projectId, agentBusy }: Props) {
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const operationInFlight = useRef(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [view, setView] = useState<'plan' | '3d'>('plan');
  const [drawing, setDrawing] = useState<DrawingSettings>({
    mode: 'select', name: 'Space 1', story: '', height: 3, thermalZone: '', snap: 0.5,
  });
  const currentProject = useRef(projectId);
  currentProject.current = projectId;
  const refresh = useCallback(async () => {
    if (!projectId) return;
    const next = await modelingRequest<WorkspaceState>(projectId, 'state');
    if (currentProject.current !== projectId) return;
    setState(next);
    setDrawing((current) => {
      const selected = next.selection ? next.projection?.objects[next.selection] : null;
      const story = selected?.type === 'BuildingStory' ? selected.handle : selected?.buildingStory;
      return { ...current, story: story || current.story };
    });
    return next;
  }, [projectId]);
  const run = useCallback(async (operation: () => Promise<unknown>) => {
    if (operationInFlight.current) return false;
    operationInFlight.current = true;
    setBusy(true); setError('');
    try { await operation(); await refresh(); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return false; }
    finally { operationInFlight.current = false; setBusy(false); }
  }, [refresh]);
  useEffect(() => {
    setState(null);
  }, [refresh]);
  useEffect(() => {
    if (!agentBusy) void refresh().catch((cause) => setError(String(cause)));
  }, [agentBusy, refresh]);
  const select = (handle: string) => void run(async () => {
    if (!projectId || !state) return;
    await modelingRequest(projectId, 'select', { revision: state.revision, arguments: { handle } });
    setInspectorOpen(true);
  });
  const author = (arguments_: AuthoringOperation) => run(async () => {
    if (!projectId || !state) return;
    await modelingRequest(projectId, 'author', { revision: state.revision, arguments: arguments_ });
  });
  if (!projectId) return null;
  const objects = Object.values(state?.projection?.objects || {});
  const selected = state?.selection ? state.projection?.objects[state.selection] || null : null;
  const surfaces = state?.projection?.selectableHandles || [];
  return <div className="nrgsim-workspace" style={{
    '--nrgsim-accent': SOLARPUNK_PALETTE.sea,
    '--building-input': GRAPH_THEME.drawer.inputBackground,
    '--building-border': GRAPH_THEME.drawer.inputBorder,
    '--building-button': GRAPH_THEME.drawer.buttonBackground,
    background: GRAPH_THEME.background.agentSurface,
    color: GRAPH_THEME.drawer.inputText,
  } as React.CSSProperties}>
    <div className="nrgsim-body">
      <ObjectTree objects={objects} selection={state?.selection || null} onSelect={select} busy={busy || agentBusy} />
      <main>
        <ModelViewport key={state?.activeModel || 'empty'}
          url={surfaces.length ? `/api/nrgsim/${projectId}/display?revision=${state?.revision}` : null}
          objects={state?.projection?.objects || {}} selection={state?.selection || null}
          drawing={drawing} view={view} busy={busy || agentBusy} onSelect={select}
          onCancel={() => setDrawing((current) => ({ ...current, mode: 'select' }))}
          onDraw={(points) => run(async () => {
            await modelingRequest(projectId, 'author', { revision: state?.revision, arguments: {
              operation: 'draw_space', name: drawing.name, story: drawing.story, height: drawing.height,
              thermalZone: drawing.thermalZone || null, createThermalZone: !drawing.thermalZone, points,
            } });
            setDrawing((current) => ({ ...current, mode: 'select',
              name: `Space ${objects.filter((object) => object.type === 'Space').length + 2}` }));
            setView('3d');
          })} />
      </main>
      <RightGlassDrawer title="" collapsedLabel={null} openAriaLabel="Open inspector" isOpen={inspectorOpen}
        onClose={() => setInspectorOpen(false)} onOpen={() => setInspectorOpen(true)}
        defaultWidth={344} minWidth={300} maxWidth={560} top={48} right={12}
        movable storageKey="nrgsim.inspector.width" dataTestId="nrgsim-inspector-drawer">
        {error && <div role="alert" className="nrgsim-error">{error}</div>}
        <ObjectInspector object={selected} objects={state?.projection?.objects || {}} busy={busy || agentBusy}
          drawing={drawing} setDrawing={setDrawing} view={view} setView={setView} author={author}
          models={state?.models || []} activeModel={state?.activeModel || null}
          onOpen={(modelId) => void run(() => modelingRequest(projectId, 'reopen', {
            revision: state?.revision, arguments: { modelId },
          }))}
          onNew={() => {
            void run(async () => {
              await modelingRequest(projectId, 'new', { revision: state?.revision, arguments: { label: 'New Building' } });
              const created = await modelingRequest<WorkspaceState>(projectId, 'state');
              if (created.projection?.building) await modelingRequest(projectId, 'select', {
                revision: created.revision, arguments: { handle: created.projection.building },
              });
              setDrawing({ mode: 'select', name: 'Space 1', story: '', height: 3, thermalZone: '', snap: 0.5 });
              setView('plan');
            });
          }}
          onSave={() => void run(() => modelingRequest(projectId, 'save', {
            revision: state?.revision, arguments: {
              label: state?.projection?.objects[state.projection.building]?.name || 'Building',
            },
          }))} />
      </RightGlassDrawer>
    </div>
  </div>;
}
