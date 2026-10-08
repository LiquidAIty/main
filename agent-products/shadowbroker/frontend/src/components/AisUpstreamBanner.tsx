/**
 * AisUpstreamBanner — visible notice that AIS ship data is unavailable
 * because the upstream provider (AISStream) is offline.
 *
 * Renders nothing when AIS is healthy or when AIS isn't configured at all.
 * Mounted at the app shell level so users see it before they wonder why
 * the ocean looks empty.
 */
import { useState } from 'react';
import { useAisUpstreamHealth } from '@/hooks/useAisUpstreamHealth';

export function AisUpstreamBanner() {
  const health = useAisUpstreamHealth();
  const [dismissed, setDismissed] = useState(false);

  if (!health || !health.aisEnabled || health.connected || dismissed) {
    return null;
  }

  // Format the staleness for the operator. ``null`` means we never received
  // anything since startup; otherwise show minutes if > 60s.
  let stalenessLabel = 'never received';
  if (health.lastMsgAgeSeconds != null) {
    const minutes = Math.floor(health.lastMsgAgeSeconds / 60);
    if (minutes >= 1) {
      stalenessLabel = `last update ${minutes} min ago`;
    } else {
      stalenessLabel = `last update ${health.lastMsgAgeSeconds}s ago`;
    }
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-auto fixed top-3 left-1/2 z-[100] -translate-x-1/2 max-w-[640px] rounded-md border border-amber-500/60 bg-amber-900/85 px-4 py-2 text-sm text-amber-50 shadow-lg backdrop-blur"
    >
      <div className="flex items-start gap-3">
        <span aria-hidden className="mt-0.5 text-amber-300">⚠</span>
        <div className="flex-1">
          <div className="font-semibold">Ship data temporarily unavailable</div>
          <div className="text-xs opacity-90">
            AISStream upstream is offline ({stalenessLabel}). The map will
            refill once their service comes back online — nothing is wrong
            with your install.
          </div>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          className="text-amber-200 hover:text-white"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

export default AisUpstreamBanner;
