export type WorldViewportMode = 'globe' | 'flat' | 'telescope';

export type TelescopeViewportState = {
  selectedTileId: string;
  scale: number;
  x: number;
  y: number;
  rotationDeg: number;
};

export type SkyObservation = {
  title: string;
  thumbUrl: string;
  displayUrl: string;
  dziUrl?: string;
  fullResUrl?: string;
  sourceUrl: string;
  summary: string;
  telescope?: string;
  instrument?: string;
  distanceLabel?: string;
  redshift?: number;
  creditLabel?: string;
  /** Filter/band identifiers, e.g. ['F090W', 'F200W']. Populated when data is available. */
  filters?: string[];
};

export type SkyTile = {
  id: string;
  panelId: number;
  healpixId: number;
  panelName: string;
  title: string;
  objectType: string;
  raDeg?: number;
  decDeg?: number;
  jwst: SkyObservation;
  aiContextSummary: string;
};
