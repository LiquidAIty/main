import test from 'node:test';
import assert from 'node:assert/strict';

import { configureRuntimeBaseUrl, runtimeUrl } from './runtimeUrl.js';

test('standalone and Node callers keep native relative URLs unchanged', () => {
  assert.equal(runtimeUrl('/api/launches'), '/api/launches');
  assert.equal(runtimeUrl('mic.svg'), 'mic.svg');
});

test('direct mount scopes native provider and asset URLs under its proxy root', () => {
  const dispose = configureRuntimeBaseUrl('/worldview-native/');
  try {
    assert.equal(runtimeUrl('/api/launches'), '/worldview-native/api/launches');
    assert.equal(runtimeUrl('/mic.svg'), '/worldview-native/mic.svg');
    assert.equal(runtimeUrl('https://example.test/feed'), 'https://example.test/feed');
  } finally {
    dispose();
  }
  assert.equal(runtimeUrl('/api/launches'), '/api/launches');
});
