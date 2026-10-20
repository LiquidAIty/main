// Entity: HVAC Inputs
// Relationship: Space assignment and temperature controls edit the existing OpenStudio Thermal Zone, never a parallel HVAC model.
import { useEffect, useState } from 'react';
import type { ModelObject } from '../contracts';
import type { Author } from './LayoutInputs';

export default function HvacInputs({ space, objects, busy, author }: {
  space: ModelObject; objects: Readonly<Record<string, ModelObject>>; busy: boolean; author: Author;
}) {
  const zone = objects[space.thermalZone || ''];
  const loop = objects[zone?.airLoop || ''];
  const zones = Object.values(objects).filter((item) => item.type === 'ThermalZone');
  const [assignment, setAssignment] = useState(space.thermalZone || '');
  const [zoneName, setZoneName] = useState(space.name + ' Thermal Zone');
  const [heating, setHeating] = useState(String(zone?.heating ?? ''));
  const [cooling, setCooling] = useState(String(zone?.cooling ?? ''));
  const [dirty, setDirty] = useState(false);
  const [baseline, setBaseline] = useState('');
  const current = JSON.stringify([zone?.handle, zone?.thermostat, zone?.heating, zone?.cooling, zone?.airLoop]);
  const conflict = dirty && baseline !== current;
  const hasSystem = !!zone?.airLoop || !!zone?.hasEquipment;
  useEffect(() => {
    if (!dirty) { setHeating(String(zone?.heating ?? '')); setCooling(String(zone?.cooling ?? '')); }
  }, [zone?.handle, zone?.heating, zone?.cooling, dirty]);
  const beginEdit = () => { if (!dirty) setBaseline(current); setDirty(true); };
  return <div className="building-inputs">
    <form className="building-input-section" onSubmit={async (event) => {
      event.preventDefault();
      if (!assignment) return;
      await author({ operation: 'assign_thermal_zone', handle: space.handle, type: 'Space',
        ...(assignment === 'new' ? { name: zoneName } : { thermalZone: assignment }) });
    }}>
      <label className="building-property-row"><span>Thermal Zone</span>
        <select aria-label="Thermal Zone" disabled={busy || dirty} value={assignment}
          onChange={(event) => setAssignment(event.target.value)}>
          <option value="" disabled>Unassigned</option>
          {zones.map((item) => <option key={item.handle} value={item.handle}>{item.name}</option>)}
          <option value="new">New Thermal Zone…</option>
        </select>
      </label>
      {assignment === 'new' && <label className="building-property-row"><span>Name</span>
        <input aria-label="New Thermal Zone name" required disabled={busy} value={zoneName}
          onChange={(event) => setZoneName(event.target.value)} />
      </label>}
      {assignment && assignment !== space.thermalZone && <button type="submit" disabled={busy || dirty}>
        {assignment === 'new' ? 'Create and assign' : 'Assign to this Space'}
      </button>}
    </form>
    {zone && <form onSubmit={async (event) => {
      event.preventDefault();
      if (conflict || !heating.trim() || !cooling.trim()) return;
      if (await author({ operation: 'set_hvac', handle: space.handle, type: 'Space',
        system: hasSystem ? 'existing' : '03', heating: Number(heating), cooling: Number(cooling) })) setDirty(false);
    }}>
      <fieldset disabled={busy} className="building-input-section">
        <legend>{hasSystem ? loop?.name || 'Thermal Zone HVAC' : 'Packaged rooftop air conditioner · System 03'}</legend>
        <label className="building-property-row"><span>Constant heating setpoint (°C)</span>
          <input aria-label="Heating setpoint" type="number" min="5" max="40" step="0.5"
            value={heating} required
            onChange={(event) => { beginEdit(); setHeating(event.target.value); }} />
        </label>
        <label className="building-property-row"><span>Constant cooling setpoint (°C)</span>
          <input aria-label="Cooling setpoint" type="number" min="10" max="45" step="0.5"
            value={cooling} required
            onChange={(event) => { beginEdit(); setCooling(event.target.value); }} />
        </label>
        {conflict && <span role="alert">Thermal Zone changed. Reload inputs before applying.</span>}
        <div className="building-button-row">
          <button disabled={conflict || !heating.trim() || !cooling.trim() || (hasSystem && !dirty)}>
            {hasSystem ? 'Apply to Thermal Zone' : 'Add system to Thermal Zone'}
          </button>
          {dirty && <button type="button" onClick={() => setDirty(false)}>{conflict ? 'Reload inputs' : 'Cancel'}</button>}
        </div>
      </fieldset>
    </form>}
  </div>;
}
