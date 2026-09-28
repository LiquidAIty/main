import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RealtimeViewport,
  captureViewportImage,
  resolveViewportCaptureSurface,
} from './realtimeViewport.js';

function rect(left, top, width, height) {
  return { left, top, right: left + width, bottom: top + height, width, height };
}

test('direct viewport resolution refuses a canvas outside the mounted WorldView root', () => {
  const canvas = {
    width: 800,
    height: 600,
    getBoundingClientRect: () => rect(0, 0, 800, 600),
  };
  const root = {
    contains: () => false,
    getBoundingClientRect: () => rect(900, 0, 500, 600),
  };
  assert.equal(resolveViewportCaptureSurface({
    viewer: { scene: { canvas } },
    root,
  }), null);
});

test('capture records the mounted pane and Cesium bounds, never browser dimensions', async () => {
  const originalDocument = globalThis.document;
  const rootBounds = rect(112, 64, 720, 540);
  const canvasBounds = rect(112, 64, 720, 540);
  const source = {
    width: 1440,
    height: 1080,
    getBoundingClientRect: () => canvasBounds,
  };
  let postRender = null;
  const viewer = {
    scene: {
      canvas: source,
      postRender: {
        addEventListener(listener) {
          postRender = listener;
          return () => { postRender = null; };
        },
      },
      requestRender() { queueMicrotask(() => postRender?.()); },
    },
  };
  const root = {
    contains: (candidate) => candidate === source,
    getBoundingClientRect: () => rootBounds,
  };
  let diagnostics = null;
  try {
    globalThis.document = {
      hidden: false,
      createElement(tag) {
        assert.equal(tag, 'canvas');
        const element = {
          width: 0,
          height: 0,
          getContext() {
            return {
              canvas: element,
              drawImage() {},
              getImageData: () => ({ data: new Uint8ClampedArray([40, 80, 120, 255]) }),
            };
          },
          toDataURL: () => 'data:image/jpeg;base64,AAAA',
        };
        return element;
      },
    };
    const image = await captureViewportImage({
      viewer,
      root,
      onCapture: (value) => { diagnostics = value; },
    });
    assert.equal(image, 'data:image/jpeg;base64,AAAA');
    assert.deepEqual(diagnostics.rootBounds, rootBounds);
    assert.deepEqual(diagnostics.canvasBounds, canvasBounds);
    assert.equal(
      diagnostics.imagePixels.width / diagnostics.imagePixels.height,
      rootBounds.width / rootBounds.height,
    );
    assert.notEqual(diagnostics.rootBounds.width, 1920, 'whole-page width was not captured');
  } finally {
    globalThis.document = originalDocument;
  }
});

test('visual grounding sends the actual viewport image as high-detail model context', async () => {
  const messages = [];
  const channel = { readyState: 'open' };
  const viewport = new RealtimeViewport({
    readChannel: () => channel,
    capture: async () => 'data:image/jpeg;base64,AAAA',
    operations: {
      sendRealtimeEvent(message, label) {
        messages.push({ message, label });
        return true;
      },
    },
  });
  const sent = await viewport.sendVisualContextIfUseful({
    action: 'get_entity_context',
    scene: { basemap: { viewScale: 'local' } },
    selected: null,
    visible: [],
  });
  assert.equal(sent, true);
  const image = messages[0].message.item.content.find((item) => item.type === 'input_image');
  assert.deepEqual(image, {
    type: 'input_image',
    image_url: 'data:image/jpeg;base64,AAAA',
    detail: 'high',
  });
  assert.equal(messages[0].label, 'client.viewport_context');
});

test('teardown invalidates an in-flight capture before it can reach a remounted session', async () => {
  let finishCapture;
  let sends = 0;
  const channel = { readyState: 'open' };
  const viewport = new RealtimeViewport({
    readChannel: () => channel,
    capture: () => new Promise((resolve) => { finishCapture = resolve; }),
    operations: {
      sendRealtimeEvent() { sends += 1; return true; },
    },
  });
  const pending = viewport.sendVisualContextIfUseful({
    action: 'get_entity_context',
    scene: { basemap: { viewScale: 'local' } },
  });
  viewport.reset();
  finishCapture('data:image/jpeg;base64,AAAA');
  assert.equal(await pending, false);
  assert.equal(sends, 0);
});
