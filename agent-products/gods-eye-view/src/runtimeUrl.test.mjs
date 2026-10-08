import test from 'node:test';
import assert from 'node:assert/strict';

import { configureRuntimeBaseUrl, runtimeUrl } from './runtimeUrl.js';

test('standalone and Node callers keep native relative URLs unchanged', () => {
  assert.equal(runtimeUrl('/api/launches'), '/api/launches');
  assert.equal(runtimeUrl('mic.svg'), 'mic.svg');
});

test("direct mount scopes God's Eye provider and asset URLs under its proxy root", () => {
  const dispose = configureRuntimeBaseUrl('/worldview-gods-eye/');
  try {
    assert.equal(runtimeUrl('/api/launches'), '/worldview-gods-eye/api/launches');
    assert.equal(runtimeUrl('/mic.svg'), '/worldview-gods-eye/mic.svg');
    assert.equal(runtimeUrl('https://example.test/feed'), 'https://example.test/feed');
  } finally {
    dispose();
  }
  assert.equal(runtimeUrl('/api/launches'), '/api/launches');
});
