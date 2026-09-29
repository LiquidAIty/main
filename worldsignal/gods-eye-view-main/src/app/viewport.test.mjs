import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getExposedApplicationViewport,
  getExposedPerspectiveXOffset,
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

test('projection centres the same camera target in the exposed pane', () => {
  const frustum = {
    xOffset: 0,
    offCenterFrustum: { left: -2, right: 2 },
  };
  const full = { sourceWidth: 800, occludedLeft: 0 };
  const covered = { sourceWidth: 800, occludedLeft: 200 };
  assert.equal(getExposedPerspectiveXOffset(frustum, full), 0);
  assert.equal(getExposedPerspectiveXOffset(frustum, covered), -0.5);
  assert.equal(getExposedPerspectiveXOffset(frustum, covered, 0.25), -0.25);
  assert.equal(getExposedPerspectiveXOffset({ xOffset: undefined }, covered), null);
});
