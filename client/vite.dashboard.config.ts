/**
 * Entity: Hermes UI Integration
 * Relationship: Builds the existing LiquidAIty workspace as the lazy-loaded dashboard module and scoped stylesheet required by Hermes web-dashboard plugin discovery.
 */

import tailwindcss from '@tailwindcss/postcss';
import react from '@vitejs/plugin-react';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Plugin as PostcssPlugin } from 'postcss';
import { defineConfig, loadEnv, type Plugin } from 'vite';

import {
  repoRoot,
  splitSelectors,
  worldviewNativeCssPlugin,
  worldviewNativeMountPlugin,
  worldviewRoot,
} from './vite.config';

const DASHBOARD_ROOT = '.liquidaity-dashboard-page';
const DASHBOARD_ASSET_BASE = '/dashboard-plugins/liquidaity/dist/';
const HERMES_REACT_ID = '\0hermes-dashboard-react';

function hermesHostReact(): Plugin {
  return {
    name: 'hermes-dashboard-host-react',
    enforce: 'pre',
    resolveId(id) {
      return id === 'react' ? HERMES_REACT_ID : null;
    },
    load(id) {
      if (id !== HERMES_REACT_ID) return null;
      return `
const React = window.__HERMES_PLUGIN_SDK__?.React;
if (!React) throw new Error('Hermes dashboard React is unavailable.');
export default React;
export const Children = React.Children;
export const Component = React.Component;
export const Fragment = React.Fragment;
export const Profiler = React.Profiler;
export const PureComponent = React.PureComponent;
export const StrictMode = React.StrictMode;
export const Suspense = React.Suspense;
export const cache = React.cache;
export const cloneElement = React.cloneElement;
export const createContext = React.createContext;
export const createElement = React.createElement;
export const createRef = React.createRef;
export const forwardRef = React.forwardRef;
export const isValidElement = React.isValidElement;
export const lazy = React.lazy;
export const memo = React.memo;
export const startTransition = React.startTransition;
export const use = React.use;
export const useActionState = React.useActionState;
export const useCallback = React.useCallback;
export const useContext = React.useContext;
export const useDebugValue = React.useDebugValue;
export const useDeferredValue = React.useDeferredValue;
export const useEffect = React.useEffect;
export const useId = React.useId;
export const useImperativeHandle = React.useImperativeHandle;
export const useInsertionEffect = React.useInsertionEffect;
export const useLayoutEffect = React.useLayoutEffect;
export const useMemo = React.useMemo;
export const useOptimistic = React.useOptimistic;
export const useReducer = React.useReducer;
export const useRef = React.useRef;
export const useState = React.useState;
export const useSyncExternalStore = React.useSyncExternalStore;
export const useTransition = React.useTransition;
export const version = React.version;
`;
    },
  };
}

function dashboardCesiumAssets(): Plugin {
  const source = path.resolve(worldviewRoot, 'node_modules/cesium/Build/Cesium');
  const destination = path.resolve(
    repoRoot,
    'apps/hermes-liquidaity-plugin/dashboard/dist/cesium',
  );
  return {
    name: 'liquidaity-dashboard-cesium-assets',
    async closeBundle() {
      await fs.mkdir(destination, { recursive: true });
      await Promise.all(['Assets', 'ThirdParty', 'Workers', 'Widgets'].map((name) => (
        fs.cp(path.join(source, name), path.join(destination, name), { recursive: true })
      )));
    },
  };
}

function isInsideKeyframes(rule: { parent?: any }): boolean {
  let parent = rule.parent;
  while (parent) {
    if (parent.type === 'atrule' && /keyframes$/i.test(parent.name || '')) return true;
    parent = parent.parent;
  }
  return false;
}

function scopeDashboardSelector(rawSelector: string): string {
  const selector = rawSelector.trim();
  if (!selector || selector.includes(DASHBOARD_ROOT)) return selector;
  if (selector === 'html' || selector === 'body' || selector === '#root' || selector === ':root') {
    return DASHBOARD_ROOT;
  }
  return `${DASHBOARD_ROOT} ${selector}`;
}

function dashboardCssScope(): PostcssPlugin {
  return {
    postcssPlugin: 'liquidaity-dashboard-css-scope',
    Rule(rule) {
      if (isInsideKeyframes(rule)) return;
      rule.selector = splitSelectors(rule.selector).map(scopeDashboardSelector).join(',\n');
    },
  };
}

export default defineConfig(({ mode }) => {
  const vendorEnv = loadEnv(mode, worldviewRoot, '');
  const applicationProviderEnv = loadEnv(mode, path.resolve(repoRoot, 'apps/backend'), [
    'GOOGLE_MAPS_API_KEY', 'CESIUM_ION_TOKEN',
  ]);
  const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY
    ?? vendorEnv.GOOGLE_MAPS_API_KEY ?? applicationProviderEnv.GOOGLE_MAPS_API_KEY;
  const cesiumIonToken = process.env.CESIUM_ION_TOKEN
    ?? vendorEnv.CESIUM_ION_TOKEN ?? applicationProviderEnv.CESIUM_ION_TOKEN;

  return {
    root: path.resolve(repoRoot, 'client'),
    base: DASHBOARD_ASSET_BASE,
    publicDir: path.resolve(repoRoot, 'client/dashboard-plugin-public'),
    plugins: [
      hermesHostReact(),
      react({ jsxRuntime: 'classic' }),
      worldviewNativeCssPlugin(),
      worldviewNativeMountPlugin('build'),
      dashboardCesiumAssets(),
    ],
    css: {
      postcss: { plugins: [tailwindcss(), dashboardCssScope()] },
    },
    define: {
      'import.meta.env.GOOGLE_MAPS_API_KEY': JSON.stringify(googleMapsApiKey),
      'import.meta.env.CESIUM_ION_TOKEN': JSON.stringify(cesiumIonToken),
      CESIUM_BASE_URL: JSON.stringify(`${DASHBOARD_ASSET_BASE}cesium/`),
    },
    resolve: { dedupe: ['react', 'react-dom'] },
    build: {
      outDir: path.resolve(repoRoot, 'apps/hermes-liquidaity-plugin/dashboard/dist'),
      emptyOutDir: true,
      cssCodeSplit: false,
      target: 'es2022',
      rollupOptions: {
        input: path.resolve(repoRoot, 'client/src/hermesDashboardPlugin.tsx'),
        output: {
          entryFileNames: 'app.js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: (asset) => asset.name?.endsWith('.css')
            ? 'style.css'
            : 'assets/[name]-[hash][extname]',
        },
      },
    },
  };
});
