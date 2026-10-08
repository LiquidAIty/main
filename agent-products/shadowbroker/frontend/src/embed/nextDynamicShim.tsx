'use client';

// Embed build shim: the WorldSignals app is mounted directly by a host React
// application (see mountWorldSignals.tsx), so there is no Next.js runtime.
// `next/dynamic` exists in the app only to defer browser-only modules past SSR;
// with no SSR the deferral is the whole job, which React.lazy already does.
// vite.embed.config.ts aliases 'next/dynamic' here.

import React from 'react';

// next/dynamic accepts a loader resolving EITHER to a module namespace
// (`() => import('./X')`) or to the component itself
// (`() => Promise.resolve(X)`, as MaplibreViewer.tsx does). React.lazy only
// accepts the former and throws "element type is invalid" on the latter, so
// normalize both into `{ default: Component }`.
type Loader<P> = () => Promise<React.ComponentType<P> | { default: React.ComponentType<P> }>;

function hasDefaultExport<P>(
  resolved: React.ComponentType<P> | { default: React.ComponentType<P> },
): resolved is { default: React.ComponentType<P> } {
  return typeof resolved === 'object' && resolved !== null && 'default' in resolved;
}

export default function dynamic<P extends object>(
  loader: Loader<P>,
  _options?: { ssr?: boolean; loading?: React.ComponentType },
): React.ComponentType<P> {
  const Lazy = React.lazy(async () => {
    const resolved = await loader();
    return hasDefaultExport(resolved) ? resolved : { default: resolved };
  });
  return function DynamicComponent(props: P) {
    return (
      <React.Suspense fallback={null}>
        <Lazy {...(props as any)} />
      </React.Suspense>
    );
  };
}
