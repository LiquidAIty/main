// Ported from the current upstream Realtime split. Keep these scene-grounding
// predicates separate from the transport/controller so direct and standalone
// mounts make the same image-context decision.
export function shouldSendViewportImage(viewScale) {
  return viewScale === 'local';
}

export function hasStructuredViewIdentity(result) {
  return Boolean(
    result?.selected
    || result?.visible?.length
    || result?.scene?.basemap?.nearbyPlaces?.length
    || result?.scene?.basemap?.knownLandmarks?.length,
  );
}
