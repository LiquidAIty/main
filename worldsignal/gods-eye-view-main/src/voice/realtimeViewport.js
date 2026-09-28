import {
  shouldSendViewportImage,
  hasStructuredViewIdentity,
} from './realtimeProtocol.js';

// Ported from the current upstream Realtime viewport owner. Direct mount adds
// one hard boundary: the source canvas must belong to the caller-owned
// WorldView root. The LiquidAIty page is never a capture fallback.
export const VIEWPORT_MAX_PIXELS = 1200 * 900;
export const VIEWPORT_MAX_ENCODED_BYTES = 200 * 1024;

function finiteRect(rect) {
  if (!rect) return null;
  const left = Number(rect.left);
  const top = Number(rect.top);
  const width = Number(rect.width);
  const height = Number(rect.height);
  if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    return null;
  }
  return {
    left,
    top,
    right: Number.isFinite(Number(rect.right)) ? Number(rect.right) : left + width,
    bottom: Number.isFinite(Number(rect.bottom)) ? Number(rect.bottom) : top + height,
    width,
    height,
  };
}

function roundedRect(rect) {
  return Object.fromEntries(
    Object.entries(rect).map(([key, value]) => [key, Math.round(value * 100) / 100]),
  );
}

/** Resolve the one legal image source for the active native application. */
export function resolveViewportCaptureSurface({ viewer = null, root = null } = {}) {
  const runtime = globalThis.window?.__godsEyeView || null;
  const resolvedViewer = viewer || runtime?.viewer || null;
  const canvas = resolvedViewer?.scene?.canvas || null;
  if (!canvas || !canvas.width || !canvas.height) return null;

  const resolvedRoot = root
    || runtime?.root
    || resolvedViewer?.container?.closest?.('[data-worldview-mounted="true"]')
    || null;
  if (!resolvedRoot?.contains?.(canvas)) return null;
  const rootBounds = finiteRect(resolvedRoot.getBoundingClientRect?.());
  const canvasBounds = finiteRect(canvas.getBoundingClientRect?.());
  if (!rootBounds || !canvasBounds) return null;

  const tolerance = 2;
  const insideRoot = canvasBounds.left >= rootBounds.left - tolerance
    && canvasBounds.top >= rootBounds.top - tolerance
    && canvasBounds.right <= rootBounds.right + tolerance
    && canvasBounds.bottom <= rootBounds.bottom + tolerance;
  if (!insideRoot) return null;

  return {
    viewer: resolvedViewer,
    root: resolvedRoot,
    canvas,
    rootBounds,
    canvasBounds,
  };
}

export async function captureViewportImage({
  viewer = null,
  root = null,
  onCapture = null,
} = {}) {
  const surface = resolveViewportCaptureSurface({ viewer, root });
  if (!surface) return null;
  const { canvas: source } = surface;
  const fresh = await renderFreshCesiumFrame(surface.viewer);
  if (!fresh) return null;

  const { width, height } = computeDownscale(
    source.width,
    source.height,
    VIEWPORT_MAX_PIXELS,
  );
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  try {
    ctx.drawImage(source, 0, 0, width, height);
    if (isNearlyBlackFrame(ctx, width, height)) {
      console.warn('[WorldView Voice] Skipped black Cesium viewport capture');
      return null;
    }
    const dataUrl = canvas.toDataURL('image/jpeg', 0.74);
    const encodedBytes = estimateDataUrlBytes(dataUrl);
    if (encodedBytes > VIEWPORT_MAX_ENCODED_BYTES) {
      console.warn('[WorldView Voice] Skipped oversized viewport capture', {
        bytes: encodedBytes,
        limit: VIEWPORT_MAX_ENCODED_BYTES,
      });
      return null;
    }
    onCapture?.(Object.freeze({
      rootBounds: roundedRect(surface.rootBounds),
      canvasBounds: roundedRect(surface.canvasBounds),
      sourcePixels: Object.freeze({ width: source.width, height: source.height }),
      imagePixels: Object.freeze({ width, height }),
      encodedBytes,
      capturedAt: new Date().toISOString(),
    }));
    return dataUrl;
  } catch {
    return null;
  }
}

export function computeDownscale(width, height, maxPixels) {
  const w = Math.max(1, Math.floor(width) || 0);
  const h = Math.max(1, Math.floor(height) || 0);
  const budget = Math.max(1, maxPixels || 0);
  if (w * h <= budget) return { width: w, height: h };
  const scale = Math.sqrt(budget / (w * h));
  return {
    width: Math.max(1, Math.floor(w * scale)),
    height: Math.max(1, Math.floor(h * scale)),
  };
}

export function estimateDataUrlBytes(dataUrl) {
  if (typeof dataUrl !== 'string') return 0;
  const commaIndex = dataUrl.indexOf(',');
  const base64 = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

export async function renderFreshCesiumFrame(viewer) {
  const scene = viewer?.scene;
  if (!scene) return false;
  if (typeof document !== 'undefined' && document.hidden) return false;
  try {
    const rendered = new Promise((resolve) => {
      let settled = false;
      let remove = () => {};
      let timeout = null;
      const settle = (value) => {
        if (settled) return;
        settled = true;
        remove();
        if (timeout !== null) clearTimeout(timeout);
        resolve(value);
      };
      remove = scene.postRender.addEventListener(() => settle(true));
      timeout = setTimeout(() => settle(false), 400);
    });
    scene.requestRender?.();
    const fresh = await rendered;
    if (typeof document !== 'undefined' && document.hidden) return false;
    return fresh;
  } catch {
    return false;
  }
}

export function isNearlyBlackFrame(ctx, width, height) {
  const sampleWidth = Math.min(48, width);
  const sampleHeight = Math.min(32, height);
  if (!sampleWidth || !sampleHeight) return true;
  const sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = sampleWidth;
  sampleCanvas.height = sampleHeight;
  const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
  if (!sampleCtx) return false;
  sampleCtx.drawImage(ctx.canvas, 0, 0, sampleWidth, sampleHeight);
  const pixels = sampleCtx.getImageData(0, 0, sampleWidth, sampleHeight).data;
  let visiblePixels = 0;
  let luminanceTotal = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3];
    if (alpha < 8) continue;
    visiblePixels += 1;
    luminanceTotal += pixels[index] * 0.2126
      + pixels[index + 1] * 0.7152
      + pixels[index + 2] * 0.0722;
  }
  return visiblePixels === 0 || luminanceTotal / visiblePixels < 2;
}

export function isBenignViewportDeleteError(payload, pendingDeleteIds = null) {
  if (!payload || payload.type !== 'error') return false;
  const echoedId = payload.event_id;
  if (echoedId && pendingDeleteIds?.has(echoedId)) return true;
  return payload.error?.code === 'item_not_found';
}

/** Own the one retained image and invalidate capture across session teardown. */
export class RealtimeViewport {
  constructor({ readChannel, operations, capture = captureViewportImage }) {
    Object.assign(this, { readChannel, capture }, operations);
    this.generation = 0;
    this.pendingViewportDeletes = new Set();
    this.lastViewportItemId = null;
  }

  get dc() {
    return this.readChannel();
  }

  async sendVisualContextIfUseful(result) {
    if (
      result?.action !== 'get_entity_context'
      || !this.dc
      || this.dc.readyState !== 'open'
    ) return false;
    const viewScale = result.scene?.basemap?.viewScale;
    if (!shouldSendViewportImage(viewScale) || hasStructuredViewIdentity(result)) return false;
    const generation = this.generation;
    const channel = this.dc;
    const imageUrl = await this.capture();
    if (
      !imageUrl
      || generation !== this.generation
      || this.dc !== channel
      || channel.readyState !== 'open'
    ) return false;

    if (this.lastViewportItemId) {
      const deleteEventId = `evt_del_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      this.pendingViewportDeletes.add(deleteEventId);
      if (this.pendingViewportDeletes.size > 8) {
        this.pendingViewportDeletes.delete(this.pendingViewportDeletes.values().next().value);
      }
      this.sendRealtimeEvent({
        event_id: deleteEventId,
        type: 'conversation.item.delete',
        item_id: this.lastViewportItemId,
      }, 'client.conversation.item.delete.old_viewport');
    }

    const newItemId = `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const sent = this.sendRealtimeEvent({
      type: 'conversation.item.create',
      item: {
        id: newItemId,
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: 'Current WorldView viewport screenshot. Read any clearly visible street, building, and place labels in the image and combine them with the structured nearbyPlaces, streetLabels, and scene context. Do not invent labels that are not legible.',
          },
          { type: 'input_image', image_url: imageUrl, detail: 'high' },
        ],
      },
    }, 'client.viewport_context');
    this.lastViewportItemId = sent ? newItemId : null;
    return sent;
  }

  reset() {
    this.generation += 1;
    this.lastViewportItemId = null;
    this.pendingViewportDeletes.clear();
  }

  consumeDeleteError(payload) {
    if (!isBenignViewportDeleteError(payload, this.pendingViewportDeletes)) return false;
    if (payload.event_id) this.pendingViewportDeletes.delete(payload.event_id);
    return true;
  }
}
