/**
 * Entity: Hermes UI Integration
 * Relationship: Registers the LiquidAIty page with the official Hermes dashboard plugin registry and reuses the host React instance.
 */

(function () {
  'use strict';

  const sdk = window.__HERMES_PLUGIN_SDK__;
  const registry = window.__HERMES_PLUGINS__;
  if (!sdk?.React || !registry) {
    throw new Error('LiquidAIty requires the Hermes web-dashboard plugin host.');
  }

  const React = sdk.React;
  const LazyPage = React.lazy(() => import('/dashboard-plugins/liquidaity/dist/app.js'));

  function LiquidAItyPage() {
    return React.createElement(
      React.Suspense,
      { fallback: React.createElement('div', { role: 'status' }, 'Loading LiquidAIty…') },
      React.createElement(LazyPage),
    );
  }

  registry.register('liquidaity', LiquidAItyPage);
})();
