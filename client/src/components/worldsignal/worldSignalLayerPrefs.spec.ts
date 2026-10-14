// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import { layerPrefsKey, readLayerPrefs, writeLayerPrefs } from './worldSignalLayerPrefs';

describe('worldSignalLayerPrefs', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('scopes the key by project and card', () => {
    expect(layerPrefsKey('proj-a', 'card_worldsignals_agent')).toBe(
      'worldsignals.embedded.layers.v1.proj-a.card_worldsignals_agent',
    );
  });

  it('round-trips a saved layer set per project/card', () => {
    writeLayerPrefs('proj-a', 'card-1', { profileVersion: 1, enabledLayerIds: ['flights', 'satellites'] });
    expect(readLayerPrefs('proj-a', 'card-1')).toEqual({
      profileVersion: 1,
      enabledLayerIds: ['flights', 'satellites'],
    });
    // A different project or card never sees it.
    expect(readLayerPrefs('proj-b', 'card-1')).toBeNull();
    expect(readLayerPrefs('proj-a', 'card-2')).toBeNull();
  });

  it('rejects malformed or wrong-shaped payloads instead of throwing', () => {
    window.localStorage.setItem(layerPrefsKey('p', 'c'), 'not json');
    expect(readLayerPrefs('p', 'c')).toBeNull();

    window.localStorage.setItem(layerPrefsKey('p', 'c'), JSON.stringify({ enabledLayerIds: ['x'] }));
    expect(readLayerPrefs('p', 'c')).toBeNull();

    window.localStorage.setItem(
      layerPrefsKey('p', 'c'),
      JSON.stringify({ profileVersion: 1, enabledLayerIds: 'flights' }),
    );
    expect(readLayerPrefs('p', 'c')).toBeNull();
  });

  it('drops non-string ids from an otherwise valid payload', () => {
    window.localStorage.setItem(
      layerPrefsKey('p', 'c'),
      JSON.stringify({ profileVersion: 1, enabledLayerIds: ['flights', 7, null, 'sar'] }),
    );
    expect(readLayerPrefs('p', 'c')).toEqual({ profileVersion: 1, enabledLayerIds: ['flights', 'sar'] });
  });
});
