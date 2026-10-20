// Entity: Building Geometry Inputs
// Relationship: Layout fields configure footprint gestures and submit named SDK geometry operations to the current model.
import { useState } from 'react';
import type { AuthoringOperation, DrawingSettings, ModelObject } from '../contracts';
import InputField from './InputField';

export type Author = (operation: AuthoringOperation) => Promise<boolean>;

export default function LayoutInputs({ object, objects, drawing, setDrawing, view, setView, busy, author, onNew, onSave, models, activeModel, onOpen }: {
  object: ModelObject | null; objects: Readonly<Record<string, ModelObject>>;
  drawing: DrawingSettings; setDrawing: (next: DrawingSettings) => void;
  view: 'plan' | '3d'; setView: (view: 'plan' | '3d') => void;
  busy: boolean; author: Author; onNew: () => void; onSave: () => void;
  models: readonly { id: string; label: string; savedAt?: string }[];
  activeModel: string | null; onOpen: (id: string) => void;
}) {
  const [storyName, setStoryName] = useState('Story 1');
  const [elevation, setElevation] = useState('0');
  const [storyHeight, setStoryHeight] = useState('3');
  const stories = Object.values(objects).filter((item) => item.type === 'BuildingStory');
  const zones = Object.values(objects).filter((item) => item.type === 'ThermalZone');
  return <div className="building-inputs">
    {(!object || object.type === 'Building') && <>
    <div className="building-button-row">
      <button onClick={onNew} disabled={busy}>New Building</button>
      <button onClick={onSave} disabled={busy || !object}>Save revision</button>
    </div>
    {models.some((model) => model.savedAt) && <label>Building model<select aria-label="Saved building model"
      disabled={busy} value={activeModel || ''} onChange={(event) => onOpen(event.target.value)}>
      {models.filter((model) => model.savedAt || model.id === activeModel).map((model) =>
        <option key={model.id} value={model.id}>{model.label}</option>)}
    </select></label>}
    </>}
    <label className="building-field">View<select aria-label="View" value={view}
      onChange={(event) => { setDrawing({ ...drawing, mode: 'select' }); setView(event.target.value as 'plan' | '3d'); }}>
      <option value="plan">Plan</option><option value="3d">3D</option>
    </select></label>
    {object?.type === 'Building' && <InputField key={`${object.handle}:north`} label="North axis"
      value={object.northAxis || 0} unit="°" numeric min={-360} max={360} busy={busy}
      onCommit={(value) => author({ operation: 'set_field', handle: object.handle, type: 'Building', field: 'northAxis', value })} />}
    {object?.type === 'Space' && object.height != null && <InputField key={`${object.handle}:height`}
      label="Ceiling height" value={object.height} unit="m" numeric min={0.1} busy={busy}
      onCommit={(height) => author({ operation: 'set_space_height', handle: object.handle, type: 'Space', height })} />}
    {object?.type === 'Building' && <form className="building-input-section" onSubmit={async (event) => {
      event.preventDefault();
      if (await author({ operation: 'create_story', name: storyName, elevation: Number(elevation), height: Number(storyHeight) })) {
        setStoryName(`Story ${stories.length + 2}`);
        setElevation(String(Number(elevation) + Number(storyHeight)));
      }
    }}>
      <label>Building Story<input aria-label="New Building Story name" required value={storyName}
        onChange={(event) => setStoryName(event.target.value)} /></label>
      <label>Elevation (m)<input aria-label="New Building Story elevation" type="number" step="any" required
        value={elevation} onChange={(event) => setElevation(event.target.value)} /></label>
      <label>Floor-to-floor height (m)<input aria-label="New Building Story height" type="number" min="0.1" step="any" required
        value={storyHeight} onChange={(event) => setStoryHeight(event.target.value)} /></label>
      <button disabled={busy}>Add Building Story</button>
    </form>}
    {stories.length > 0 && (object?.type === 'Building' || object?.type === 'BuildingStory') && <fieldset className="building-input-section" disabled={busy}>
      <legend>Draw Space</legend>
      <label>Building Story<select aria-label="Drawing Building Story" value={drawing.story}
        onChange={(event) => setDrawing({ ...drawing, story: event.target.value })}>
        <option value="" disabled>Select…</option>{stories.map((story) => <option key={story.handle} value={story.handle}>{story.name}</option>)}
      </select></label>
      <label>Name<input aria-label="New Space name" value={drawing.name}
        onChange={(event) => setDrawing({ ...drawing, name: event.target.value })} /></label>
      <label>Ceiling height (m)<input aria-label="Drawing ceiling height" type="number" min="0.1" step="any"
        value={drawing.height} onChange={(event) => setDrawing({ ...drawing, height: Number(event.target.value) })} /></label>
      <label>Thermal Zone<select aria-label="Drawing Thermal Zone" value={drawing.thermalZone}
        onChange={(event) => setDrawing({ ...drawing, thermalZone: event.target.value })}>
        <option value="">Create a new Thermal Zone</option>
        {zones.map((zone) => <option key={zone.handle} value={zone.handle}>{zone.name}</option>)}
      </select></label>
      <label>Snap (m)<input aria-label="Drawing snap" type="number" min="0.01" step="0.1"
        value={drawing.snap} onChange={(event) => setDrawing({ ...drawing, snap: Number(event.target.value) })} /></label>
      <div className="building-button-row">
        <button type="button" aria-pressed={drawing.mode === 'rectangle'} disabled={!drawing.story}
          onClick={() => { setDrawing({ ...drawing, mode: 'rectangle' }); setView('plan'); }}>Rectangle</button>
        <button type="button" aria-pressed={drawing.mode === 'polygon'} disabled={!drawing.story}
          onClick={() => { setDrawing({ ...drawing, mode: 'polygon' }); setView('plan'); }}>Polygon</button>
        {drawing.mode !== 'select' && <button type="button" onClick={() => setDrawing({ ...drawing, mode: 'select' })}>Cancel</button>}
      </div>
    </fieldset>}
  </div>;
}
