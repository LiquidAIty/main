// Standalone (Next.js) mode: all API calls use relative paths (e.g. /api/flights).
// The catch-all route handler at src/app/api/[...path]/route.ts proxies them
// to BACKEND_URL at runtime (set in docker-compose or .env.local for dev).
// This means:
//   - No build-time baking of the backend URL into the client bundle
//   - BACKEND_URL=http://backend:8000 works via Docker internal networking
//   - Only port 3000 needs to be exposed externally
//
// Embedded mode: a host application mounts this app directly (see
// src/embed/mountWorldSignals.tsx) and there is no Next.js proxy in front of it.
// The host calls setApiBase() with its own prefix before rendering, and every
// `${API_BASE}/api/...` call site follows without change. ESM live bindings make
// the reassignment visible to importers; call sites read it inside functions.
export let API_BASE = '';

export function setApiBase(base: string): void {
  API_BASE = base.replace(/\/$/, '');
}

// Prefix for this app's own static files (the contents of public/). Empty in
// standalone mode, where they are served from the origin root. When embedded the
// host serves them from wherever the built bundle lives, so the mount sets it.
export let ASSET_BASE = '';

export function setAssetBase(base: string): void {
  ASSET_BASE = base.replace(/\/$/, '');
}

// True when the app is mounted inside a host (LiquidAIty) rather than running as
// its own standalone page. The host owns onboarding, identity and setup, so the
// app must not pop its own onboarding/setup shells in this mode — WorldSignals
// should just open as a native surface. Keys, when wanted, are configured
// server-side, not through a first-run modal that greets every user.
export let IS_EMBEDDED = false;

export function setEmbedded(embedded: boolean): void {
  IS_EMBEDDED = embedded;
}
