// Entity: Construction Inputs
// Relationship: This renders exact SDK layer inputs and submits only changed values as a surface-local copy operation.
import { useState } from 'react';
import type { ConstructionEditor, MaterialInput, ModelObject } from '../contracts';
import type { Author } from './LayoutInputs';

type Draft = { source: ConstructionEditor; values: Record<number, Record<string, string>> };
const labels: Readonly<Record<string, string>> = {
  thickness: 'Thickness', conductivity: 'Conductivity', density: 'Density',
  specificHeat: 'Specific heat', thermalResistance: 'Thermal resistance', roughness: 'Roughness',
  thermalAbsorptance: 'Thermal absorptance', solarAbsorptance: 'Solar absorptance',
  visibleAbsorptance: 'Visible absorptance',
};

function MaterialField({ field, input, draft, disabled, onChange }: {
  field: string; input: MaterialInput; draft?: string; disabled: boolean; onChange: (value: string) => void;
}) {
  const label = labels[field];
  return <label className="building-property-row">
    <span>{label}{input.unit ? ' (' + input.unit + ')' : ''}</span>
    {input.choices ? <select aria-label={label} disabled={disabled} value={draft ?? String(input.value ?? '')}
      onChange={(event) => onChange(event.target.value)}>
      {input.choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
    </select> : <input aria-label={label} type="number" step="any" required disabled={disabled}
      min={input.minimumInclusive ? input.minimum : undefined} max={input.maximum ?? undefined}
      value={draft ?? String(input.value ?? '')} onChange={(event) => onChange(event.target.value)} />}
  </label>;
}

export default function ConstructionInputs({ object, objects, busy, author }: {
  object: ModelObject; objects: Readonly<Record<string, ModelObject>>; busy: boolean; author: Author;
}) {
  const isDefaultScope = object.type === 'Building' || object.type === 'Space';
  const [role, setRole] = useState('Exterior:Wall');
  const [boundaryGroup, surfaceRole] = role.split(':');
  const assigned = isDefaultScope ? object.constructionDefaults?.[role] : object.construction;
  // Drafts are scoped to exact Surface identities, never whichever object is selected later.
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [selectedLayers, setSelectedLayers] = useState<Record<string, number>>({});
  const draft = drafts[object.handle];
  const current = object.constructionEditor;
  const source = draft?.source ?? current;
  const layer = source?.layers[selectedLayers[object.handle] ?? 0];
  const changedUpstream = !!draft && JSON.stringify(current) !== JSON.stringify(draft.source);
  const pairedSurface = object.type === 'Surface'
    && (!!object.adjacentSurface || object.outsideBoundaryCondition === 'Surface');
  const invalidDraft = !!draft && Object.entries(draft.values).some(([index, values]) =>
    Object.entries(values).some(([field, raw]) => {
      const input = draft.source.layers[Number(index)].properties[field];
      if (input.choices) return !input.choices.includes(raw);
      const value = Number(raw);
      return !raw.trim() || !Number.isFinite(value)
        || (input.minimum != null && (input.minimumInclusive ? value < input.minimum : value <= input.minimum))
        || (input.maximum != null && value > input.maximum);
    }));
  const usesGlazing = object.type === 'SubSurface' && !['Door', 'OverheadDoor'].includes(object.surfaceType || '');
  const choices = Object.values(objects).filter((item) => item.type === 'Construction'
    && (item.handle === assigned || (usesGlazing ? item.isFenestration : item.isOpaque)));
  const clearDraft = () => setDrafts((all) => {
    const next = { ...all }; delete next[object.handle]; return next;
  });
  const change = (field: string, value: string) => {
    if (!current || !layer) return;
    setDrafts((all) => {
      const previous = all[object.handle] ?? { source: current, values: {} };
      return { ...all, [object.handle]: { ...previous, values: { ...previous.values,
        [layer.index]: { ...previous.values[layer.index], [field]: value } } } };
    });
  };
  return <div className="building-inputs">
    {isDefaultScope && <label className="building-property-row"><span>Surface category</span>
      <select aria-label="Construction surface category" value={role} disabled={busy}
        onChange={(event) => setRole(event.target.value)}>
        <option value="Exterior:Wall">Exterior walls</option><option value="Interior:Wall">Interior walls</option>
        <option value="Ground:Wall">Below-grade walls</option><option value="Exterior:RoofCeiling">Roofs</option>
        <option value="Interior:RoofCeiling">Internal ceilings</option><option value="Ground:Floor">Ground floors</option>
        <option value="Exterior:Floor">External floors</option><option value="Interior:Floor">Internal floors</option>
      </select>
    </label>}
    <label className="building-property-row"><span>Construction</span>
      <select aria-label="Construction" disabled={busy || !!draft || pairedSurface}
        value={!isDefaultScope && object.isConstructionDefaulted ? '' : assigned || ''}
        onChange={(event) => void author({
          operation: isDefaultScope ? 'assign_default_construction' : 'assign_construction',
          handle: object.handle, type: object.type, construction: event.target.value || null,
          ...(isDefaultScope ? { boundaryGroup, surfaceRole } : {}),
        })}>
        <option value="" disabled={isDefaultScope}>
          {object.isConstructionDefaulted && assigned ? 'Inherited — ' + (objects[assigned]?.name || '')
            : isDefaultScope ? 'Unassigned' : 'Use inherited construction'}
        </option>
        {choices.map((item) => <option key={item.handle} value={item.handle}>{item.name}</option>)}
      </select>
    </label>
    {source && <form onSubmit={async (event) => {
      event.preventDefault();
      if (!draft || changedUpstream || invalidDraft || !source.editable) return;
      const edits = Object.entries(draft.values).flatMap(([index, values]) => {
        const material = draft.source.layers[Number(index)];
        const properties = Object.fromEntries(Object.entries(values).flatMap(([field, raw]) => {
          const input = material.properties[field];
          const value = input.choices ? raw : Number(raw);
          return value === input.value ? [] : [[field, value]];
        }));
        return Object.keys(properties).length ? [{ index: Number(index), material_handle: material.handle,
          name: material.name.slice(0, 150) + ' local', properties }] : [];
      });
      if (!edits.length) { clearDraft(); return; }
      if (await author({ operation: 'set_construction_layers', handle: object.handle, type: 'Surface',
        expectedConstruction: draft.source.construction.handle, edits,
        name: draft.source.construction.name.slice(0, 150) + ' local' })) clearDraft();
    }}>
      <fieldset className="building-input-section" disabled={busy}>
        <legend>Layers · outside to inside</legend>
        <ol className="building-layer-list" aria-label="Construction layers">
          {source.layers.map((material) => <li key={material.index + ':' + material.handle}>
            <button type="button" aria-pressed={layer?.index === material.index}
              onClick={() => setSelectedLayers((all) => ({ ...all, [object.handle]: material.index }))}>
              <span className="building-layer-number">{material.index + 1}</span><span>{material.name}</span>
            </button>
          </li>)}
        </ol>
        {layer && <div className="building-layer-fields">
          {Object.entries(layer.properties).filter(([field]) => !field.endsWith('Absorptance')).map(([field, input]) =>
            <MaterialField key={layer.index + ':' + field} field={field} input={input}
              draft={draft?.values[layer.index]?.[field]} disabled={!source.editable || !layer.editable || changedUpstream}
              onChange={(value) => change(field, value)} />)}
          {Object.keys(layer.properties).some((field) => field.endsWith('Absorptance')) && <details>
            <summary>Absorptance</summary>
            {Object.entries(layer.properties).filter(([field]) => field.endsWith('Absorptance')).map(([field, input]) =>
              <MaterialField key={layer.index + ':' + field} field={field} input={input}
                draft={draft?.values[layer.index]?.[field]} disabled={!source.editable || !layer.editable || changedUpstream}
                onChange={(value) => change(field, value)} />)}
          </details>}
        </div>}
        {changedUpstream && <span role="alert">Construction changed. Reload inputs before applying.</span>}
        {draft && <div className="building-button-row">
          <button type="submit" disabled={changedUpstream || invalidDraft || !source.editable}>Apply to this Surface</button>
          <button type="button" onClick={clearDraft}>{changedUpstream ? 'Reload inputs' : 'Cancel'}</button>
        </div>}
      </fieldset>
    </form>}
  </div>;
}
