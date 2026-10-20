// Entity: Internal Load Inputs
// Relationship: People, lighting and equipment fields edit a selected Space's actual load definitions and schedules, preserving other Spaces' shared definitions.
import { useEffect, useState } from 'react';
import type { ModelObject } from '../contracts';
import type { Author } from './LayoutInputs';

type Kind = 'People' | 'Lights' | 'ElectricEquipment';
const labels: Record<Kind, { title: string; density: string; unit: string }> = {
  People: { title: 'Occupancy', density: 'People per floor area', unit: 'people/m²' },
  Lights: { title: 'Lighting', density: 'Lighting power density', unit: 'W/m²' },
  ElectricEquipment: { title: 'Equipment', density: 'Equipment power density', unit: 'W/m²' },
};

function LoadForm({ space, load, objects, kind, busy, author }: {
  space: ModelObject; load?: ModelObject; objects: Readonly<Record<string, ModelObject>>;
  kind: Kind; busy: boolean; author: Author;
}) {
  const definition = load?.definition ? objects[load.definition] : undefined;
  const [density, setDensity] = useState(String(definition?.density ?? ''));
  const [schedule, setSchedule] = useState(load?.schedule || '');
  const [activity, setActivity] = useState(String(load?.activityLevel ?? ''));
  const [activityDirty, setActivityDirty] = useState(false);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (dirty) return;
    setDensity(String(definition?.density ?? ''));
    setSchedule(load?.schedule || '');
    setActivity(String(load?.activityLevel ?? ''));
    setActivityDirty(false);
  }, [load?.handle, definition?.density, load?.schedule, load?.activityLevel, dirty]);
  const schedules = Object.values(objects).filter((item) =>
    ['ScheduleRuleset', 'ScheduleConstant', 'ScheduleCompact', 'ScheduleYear', 'ScheduleFile'].includes(item.type));
  return <form onSubmit={async (event) => {
    event.preventDefault();
    if (!density.trim() || !schedule || (kind === 'People' && (activityDirty || !load) && !activity.trim())) return;
    if (await author({ operation: 'set_space_load', handle: space.handle, type: 'Space', kind,
      load: load?.handle || null, density: Number(density), schedule,
      ...(kind === 'People' && (activityDirty || !load) ? { activityLevel: Number(activity) } : {}) })) setDirty(false);
  }}>
    <fieldset disabled={busy} className="building-input-section">
      <legend>{load?.name || labels[kind].title}</legend>
      <label>{labels[kind].density} ({labels[kind].unit})
        <input aria-label={labels[kind].density} type="number" min="0" step="any" required value={density}
          onChange={(event) => { setDensity(event.target.value); setDirty(true); }} />
      </label>
      <label>Schedule<select aria-label={`${labels[kind].title} schedule`} value={schedule}
        onChange={(event) => { setSchedule(event.target.value); setDirty(true); }}>
        <option value="" disabled>Select schedule…</option>
        {load?.schedule && !schedules.some((item) => item.handle === load.schedule)
          && <option value={load.schedule}>Current assigned schedule</option>}
        <option value="always_on">Always on</option>
        {schedules.map((item) => <option key={item.handle} value={item.handle}>{item.name}</option>)}
      </select></label>
      {kind === 'People' && <label>Activity level (W/person)
        <input aria-label="Activity level" type="number" min="0" step="any" value={activity} required={!load || activityDirty}
          onChange={(event) => { setActivity(event.target.value); setActivityDirty(true); setDirty(true); }} />
      </label>}
      <button disabled={!dirty || !density.trim() || !schedule
        || (kind === 'People' && (activityDirty || !load) && !activity.trim())}>Apply to this Space</button>
    </fieldset>
  </form>;
}

export default function LoadInputs({ space, objects, kind, busy, author }: {
  space: ModelObject; objects: Readonly<Record<string, ModelObject>>; kind: Kind; busy: boolean; author: Author;
}) {
  const loads = Object.values(objects).filter((item) => item.type === kind
    && (item.space === space.handle || (space.spaceType && item.spaceType === space.spaceType)));
  return <div className="building-inputs">
    {(loads.length ? loads : [undefined]).map((load) =>
      <LoadForm key={`${space.handle}:${load?.handle || 'new'}:${kind}`} space={space} load={load}
        objects={objects} kind={kind} busy={busy} author={author} />)}
  </div>;
}
