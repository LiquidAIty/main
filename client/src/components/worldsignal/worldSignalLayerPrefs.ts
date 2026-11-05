/**
 * Entity: WorldSignals
 * Relationship: Stores and recovers the mounted product’s Project-and-Card-scoped layer profile in best-effort browser storage without becoming server or capability authority.
 */

type WorldSignalLayerPrefs = {
  profileVersion: number;
  enabledLayerIds: string[];
};

const PREFIX = 'worldsignals.embedded.layers.v1';

export function layerPrefsKey(projectId: string, cardId: string): string {
  return `${PREFIX}.${projectId}.${cardId}`;
}

export function readLayerPrefs(
  projectId: string,
  cardId: string,
): WorldSignalLayerPrefs | null {
  try {
    const raw = window.localStorage.getItem(layerPrefsKey(projectId, cardId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const candidate = parsed as { profileVersion?: unknown; enabledLayerIds?: unknown };
    if (typeof candidate.profileVersion !== 'number') return null;
    if (!Array.isArray(candidate.enabledLayerIds)) return null;
    const enabledLayerIds = candidate.enabledLayerIds.filter(
      (id): id is string => typeof id === 'string',
    );
    return { profileVersion: candidate.profileVersion, enabledLayerIds };
  } catch {
    return null;
  }
}

export function writeLayerPrefs(
  projectId: string,
  cardId: string,
  prefs: WorldSignalLayerPrefs,
): void {
  try {
    window.localStorage.setItem(
      layerPrefsKey(projectId, cardId),
      JSON.stringify({
        profileVersion: prefs.profileVersion,
        enabledLayerIds: prefs.enabledLayerIds,
      }),
    );
  } catch {
    // Storage unavailable (private mode/quota) — preferences just don't persist.
  }
}
