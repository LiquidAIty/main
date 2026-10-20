// Entity: Opening Inputs
// Relationship: Window-to-wall ratio and sill height create actual OpenStudio SubSurfaces on the selected exterior wall.
import { useEffect, useState } from 'react';
import type { ModelObject } from '../contracts';
import type { Author } from './LayoutInputs';

export default function OpeningInputs({ object, objects, busy, author }: {
  object: ModelObject; objects: Readonly<Record<string, ModelObject>>; busy: boolean; author: Author;
}) {
  const [ratio, setRatio] = useState(String((object.windowToWallRatio || 0) * 100));
  const [sill, setSill] = useState('0.9');
  const [replace, setReplace] = useState(false);
  useEffect(() => {
    setRatio(String((object.windowToWallRatio || 0) * 100)); setReplace(false);
  }, [object.handle, object.windowToWallRatio]);
  const hasOpenings = Object.values(objects).some((item) => item.type === 'SubSurface' && item.surface === object.handle);
  return <form className="building-inputs" onSubmit={(event) => {
    event.preventDefault();
    void author({ operation: 'set_window_ratio', handle: object.handle, type: 'Surface',
      ratio: Number(ratio) / 100, sillHeight: Number(sill), replaceOpenings: replace });
  }}>
    <fieldset disabled={busy} className="building-input-section">
      <label>Window-to-wall ratio (%)<input aria-label="Window-to-wall ratio" type="number" min="1" max="95" step="0.1"
        value={ratio} onChange={(event) => setRatio(event.target.value)} /></label>
      <input aria-label="Window-to-wall ratio slider" type="range" min="1" max="95" step="0.1"
        value={ratio} onChange={(event) => setRatio(event.target.value)} />
      <label>Sill height (m)<input aria-label="Sill height" type="number" min="0" step="0.05"
        value={sill} onChange={(event) => setSill(event.target.value)} /></label>
      {hasOpenings && <label className="building-check"><input type="checkbox" checked={replace}
        onChange={(event) => setReplace(event.target.checked)} />Replace existing openings on this wall</label>}
      <button disabled={hasOpenings && !replace}>Apply</button>
    </fieldset>
  </form>;
}
