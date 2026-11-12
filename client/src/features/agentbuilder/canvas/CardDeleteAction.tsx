/**
 * Entity: Saved Cards
 * Relationship: Keeps the explicit Project-Card removal choice inside its first panel, while the existing page callback owns deletion and preserves profile history.
 */
import React, { useState } from 'react';

export default function CardDeleteAction({ title, disabled, busy, onConfirm, buttonStyle }: {
  title: string;
  disabled: boolean;
  busy: boolean;
  onConfirm: () => Promise<void>;
  buttonStyle: React.CSSProperties;
}) {
  const [confirming, setConfirming] = useState(false);
  return <div aria-label="Card removal" style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, paddingBottom: 8 }}>
    {confirming ? <>
      <span style={{ fontSize: 12 }}>Delete {title}?</span>
      <button type="button" disabled={busy} style={buttonStyle} onClick={() => setConfirming(false)}>Cancel</button>
      <button type="button" disabled={disabled || busy} style={{ ...buttonStyle, color: '#D9A5A5' }}
        title="Remove this Card and its wires from this Project. Profile and session history are kept."
        onClick={() => { void onConfirm().finally(() => setConfirming(false)); }}>{busy ? 'Deleting…' : 'Delete'}</button>
    </> : <button type="button" disabled={disabled || busy} style={buttonStyle}
      title="Remove this Card and its wires from this Project. Profile and session history are kept."
      onClick={() => setConfirming(true)}>Delete Card</button>}
  </div>;
}
