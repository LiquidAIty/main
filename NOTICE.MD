# NO FALLBACKS NOTICE

1. No fallback renderer is allowed for World view.
2. No demo-data fallback is allowed for World view.
3. No canvas/SVG substitute fallback is allowed for World view.
4. World view must use the main globe path only (current globe or Globe.gl implementation).
5. If the globe runtime fails, surface an explicit error state; do not silently fall back.

