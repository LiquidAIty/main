// Entity: Building Inspector
// Relationship: This inspector presents authoritative OpenStudio properties and submits a bounded engineering edit with revision checking.
import { useEffect, useState } from 'react';
import { objectLabel, type ModelObject, type ObjectProperties } from './contracts';

const fields: Record<string, { property: string; label: string; unit: string; min: number; max: number; step: number }> = {
  ThermalZone: { property: 'multiplier', label: 'Multiplier', unit: 'dimensionless', min: 1, max: 100, step: 1 },
  LightsDefinition: { property: 'wattsperSpaceFloorArea', label: 'Watts per Space Floor Area', unit: 'W/m²', min: 0, max: 50, step: 0.1 },
};

export default function ObjectInspector({ object, properties, busy, onEdit, onSelect }: {
  object: ModelObject | null;
  properties: ObjectProperties | null;
  busy: boolean;
  onEdit: (property: string, value: number) => Promise<boolean>;
  onSelect: (handle: string) => void;
}) {
  const [tab, setTab] = useState('Properties');
  const [draft, setDraft] = useState('');
  const [dirty, setDirty] = useState(false);
  const field = object ? fields[object.type] : undefined;
  const authoritative = field ? properties?.properties[field.property]?.value : undefined;
  useEffect(() => { setDirty(false); setDraft(''); }, [object?.handle]);
  useEffect(() => {
    if (!dirty && authoritative !== undefined) setDraft(String(authoritative));
  }, [authoritative, dirty]);
  if (!object) return <p>Select the Building, a Space, a Surface, or another OpenStudio object.</p>;
  return <section data-testid="nrgsim-inspector">
    <h3>{object.name || object.type}</h3>
    <p className="nrgsim-muted">{objectLabel[object.type] || object.type}</p>
    <nav className="nrgsim-tabs">{['Properties', 'Relationships', 'Identity'].map((name) =>
      <button key={name} aria-pressed={tab === name} onClick={() => setTab(name)}>{name}</button>)}</nav>
    {tab === 'Properties' && <>
      {field && typeof authoritative === 'number' && <form onSubmit={async (event) => {
        event.preventDefault();
        if (await onEdit(field.property, Number(draft))) setDirty(false);
      }}>
        <label>{field.label} <span>{field.unit}</span>
          <input aria-label={field.label} type="number" value={draft} min={field.min} max={field.max} step={field.step}
            onChange={(event) => { setDraft(event.target.value); setDirty(true); }} />
        </label>
        <input aria-label={`${field.label} slider`} type="range" value={draft || '0'} min={field.min} max={field.max} step={field.step}
          onChange={(event) => { setDraft(event.target.value); setDirty(true); }} />
        <p>OpenStudio currently: <strong>{String(authoritative)} {field.unit}</strong></p>
        {object.type === 'LightsDefinition' && <p>This is a shared Lights Definition. Changing it affects every Lights object that references it.</p>}
        <button disabled={busy || !dirty || draft === ''} type="submit">Apply to OpenStudio</button>
      </form>}
      {!field && <p className="nrgsim-muted">Assignments and engineering values are inspectable. Editing this object type is outside the first inspector slice.</p>}
      <dl>{Object.entries(object).filter(([key]) => ['floorArea', 'grossArea', 'netArea', 'surfaceType', 'outsideBoundaryCondition'].includes(key))
        .map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{String(value)}{key.endsWith('Area') ? ' m²' : ''}</dd></div>)}</dl>
      <details><summary>OpenStudio property readback</summary>
        <pre>{properties ? JSON.stringify(properties.properties, null, 2) : 'Reading current model…'}</pre>
      </details>
    </>}
    {tab === 'Relationships' && <><dl>{Object.entries(object).filter(([key, value]) =>
      ['space', 'surface', 'thermalZone', 'buildingStory', 'construction'].includes(key) && value
    ).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>
      <button onClick={() => onSelect(String(value))}>Inspect related object</button>
    </dd></div>)}</dl>
      {object.layers && <><p>Construction layers · outside to inside</p><ol>{object.layers.map((handle, index) =>
        <li key={`${handle}-${index}`}><button onClick={() => onSelect(handle)}>Inspect layer {index + 1}</button></li>)}</ol></>}
    </>}
    {tab === 'Identity' && <><p>OpenStudio handle in the active model</p><code>{object.handle}</code></>}
  </section>;
}
