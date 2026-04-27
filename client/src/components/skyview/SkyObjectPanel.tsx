import type React from 'react';
import type { SkyTile } from './types';

type SkyObjectPanelProps = {
  tile: SkyTile;
};

export default function SkyObjectPanel({
  tile,
}: SkyObjectPanelProps): React.ReactElement {
  return (
    <aside className="sky-object-panel" data-testid="sky-object-panel">
      <div className="sky-object-kicker">{tile.panelName}</div>
      <h3>{tile.title}</h3>
      <div className="sky-object-type">{tile.objectType}</div>
      <p>{tile.jwst.summary}</p>

      <dl>
        {tile.jwst.instrument ? (
          <>
            <dt>Instrument</dt>
            <dd>{tile.jwst.instrument}</dd>
          </>
        ) : null}
        {tile.jwst.distanceLabel ? (
          <>
            <dt>Distance</dt>
            <dd>{tile.jwst.distanceLabel}</dd>
          </>
        ) : null}
        {typeof tile.jwst.redshift === 'number' ? (
          <>
            <dt>Redshift</dt>
            <dd>{tile.jwst.redshift}</dd>
          </>
        ) : null}
      </dl>

      <a
        className="sky-source-link"
        href={tile.jwst.sourceUrl}
        target="_blank"
        rel="noreferrer"
      >
        Official Source
      </a>

      <details>
        <summary>AI context summary</summary>
        <p>{tile.aiContextSummary}</p>
      </details>
    </aside>
  );
}
