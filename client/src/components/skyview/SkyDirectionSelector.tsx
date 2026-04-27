import type React from 'react';
import { useState } from 'react';
import type { SkyTile } from './types';

type SkyDirectionSelectorProps = {
  tiles: SkyTile[];
  onSelectTile: (tile: SkyTile) => void;
};

export default function SkyDirectionSelector({
  tiles,
  onSelectTile,
}: SkyDirectionSelectorProps): React.ReactElement {
  const [failedThumbIds, setFailedThumbIds] = useState<Set<string>>(
    () => new Set(),
  );

  return (
    <div className="skyview-grid" data-testid="skyview-panel-grid">
      {tiles.map((tile) => (
        <button
          key={tile.id}
          type="button"
          className="skyview-tile"
          data-testid={`skyview-tile-${tile.id}`}
          onClick={() => onSelectTile(tile)}
        >
          <div className="skyview-tile-media">
            {tile.jwst.thumbUrl && !failedThumbIds.has(tile.id) ? (
              <img
                src={tile.jwst.thumbUrl}
                alt={`${tile.title} JWST thumbnail`}
                draggable={false}
                loading="lazy"
                onError={() =>
                  setFailedThumbIds((current) => {
                    const next = new Set(current);
                    next.add(tile.id);
                    return next;
                  })
                }
              />
            ) : (
              <div className="skyview-placeholder" aria-hidden="true">
                JWST
              </div>
            )}
          </div>
          <div className="skyview-tile-body">
            <div className="skyview-tile-topline">
              <span>{tile.panelName}</span>
              <span className="skyview-source-badge">JWST</span>
            </div>
            <div className="skyview-tile-title">{tile.title}</div>
            <div className="skyview-tile-type">{tile.objectType}</div>
          </div>
        </button>
      ))}
    </div>
  );
}
