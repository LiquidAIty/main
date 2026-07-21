// Plain data shapes for deck-run continuity state restored from saved deck runs.
// These are neutral data records — no planning semantics, no projection, no task/card
// construction, no mission-node generation, no fallback behavior, and no reference to
// Mag One. (Extracted from the deleted deterministic assistPlanSurface module so the
// deck-reload continuity state keeps a stable, plainly-typed home.)

export type LinkRef = {
  id: string;
  title: string;
  url: string;
  src: string;
  accepted: boolean;
  ts: number;
};
