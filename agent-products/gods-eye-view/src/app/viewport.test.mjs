import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getExposedApplicationViewport,
  getSatelliteOverviewViewports,
} from './viewport.js';

const rect = (left, top, width, height) => ({
  left, top, right: left + width, bottom: top + height, width, height,
});

test('visible companion geometry follows Main overlap without changing mount dimensions', () => {
  let clip = rect(100, 20, 800, 600);
  const root = {
    getBoundingClientRect: () => rect(100, 20, 800, 600),
    closest: () => ({ getBoundingClientRect: () => clip }),
  };
  assert.deepEqual(getExposedApplicationViewport(root), {
    ...rect(100, 20, 800, 600), sourceWidth: 800, occludedLeft: 0,
  });

  clip = rect(300, 20, 600, 600);
  assert.deepEqual(getExposedApplicationViewport(root), {
    ...rect(300, 20, 600, 600), sourceWidth: 800, occludedLeft: 200,
  });
});

test('orbital fit uses the actual open Inspector rectangle, including bottom-left placement', () => {
  let panel = rect(700, 20, 300, 600);
  let open = true;
  const root = {
    getBoundingClientRect: () => rect(100, 20, 900, 600),
    closest: () => ({ getBoundingClientRect: () => rect(300, 20, 700, 600) }),
    ownerDocument: {
      querySelector: () => open ? { getBoundingClientRect: () => panel } : null,
    },
  };
  assert.deepEqual(getSatelliteOverviewViewports(root), [
    rect(300, 20, 400, 600),
  ]);

  panel = rect(300, 420, 350, 200);
  assert.deepEqual(getSatelliteOverviewViewports(root), [
    rect(650, 20, 350, 600),
    rect(300, 20, 700, 400),
  ]);

  open = false;
  assert.deepEqual(getSatelliteOverviewViewports(root), [{
    ...rect(300, 20, 700, 600), sourceWidth: 900, occludedLeft: 200,
  }]);
});
