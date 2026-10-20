// Entity: Building Inputs
// Relationship: A human field keeps its draft until the model operation succeeds and authoritative values refresh.
import { useEffect, useState } from 'react';

export default function InputField({ label, value, unit, numeric = false, min, max, step = 'any', busy, onCommit }: {
  label: string; value: string | number; unit?: string; numeric?: boolean;
  min?: number; max?: number; step?: number | 'any'; busy: boolean;
  onCommit: (value: string | number) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(String(value));
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (!dirty) setDraft(String(value)); }, [value, dirty]);
  return <form className="building-field" onSubmit={async (event) => {
    event.preventDefault();
    if (draft.trim() && await onCommit(numeric ? Number(draft) : draft)) setDirty(false);
  }}>
    <label><span>{label}{unit ? ` (${unit})` : ''}</span>
      <input aria-label={label} type={numeric ? 'number' : 'text'} value={draft}
        min={min} max={max} step={step} disabled={busy}
        onChange={(event) => { setDraft(event.target.value); setDirty(true); }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { setDraft(String(value)); setDirty(false); }
        }} />
    </label>
    {dirty && <button type="submit" disabled={busy || !draft.trim()}>Apply</button>}
  </form>;
}
