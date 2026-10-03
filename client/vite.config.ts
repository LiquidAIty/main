import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import postcss from 'postcss';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const worldviewRoot = path.resolve(repoRoot, 'worldsignal/gods-eye-view-main');
const worldviewStylePath = path.resolve(worldviewRoot, 'style.css');
const vendorRequire = createRequire(path.resolve(worldviewRoot, 'package.json'));
const cesiumPluginModule = vendorRequire('vite-plugin-cesium') as {
  default?: (options?: Record<string, unknown>) => Plugin;
} | ((options?: Record<string, unknown>) => Plugin);
const cesiumPlugin = typeof cesiumPluginModule === 'function'
  ? cesiumPluginModule
  : cesiumPluginModule.default!;

const WORLDVIEW_CSS_ID = 'virtual:worldview-native-css';
const WORLDVIEW_CSS_RESOLVED_ID = `\0${WORLDVIEW_CSS_ID}`;
const WORLDVIEW_MOUNT_ID = 'virtual:worldview-native-mount';
const WORLDVIEW_MOUNT_RESOLVED_ID = `\0${WORLDVIEW_MOUNT_ID}`;
const WORLDVIEW_BUNDLED_MOUNT_ID = 'virtual:worldview-native-mount-bundled';
const WORLDVIEW_PUBLIC_MOUNT_URL = 'http://127.0.0.1:4174/src/app/mount.js';
const WORLDVIEW_SELECTOR = '#worldview-native-root';

export function worldviewNativeMountModuleSource(command: 'serve' | 'build'): string {
  const target = command === 'serve'
    ? WORLDVIEW_PUBLIC_MOUNT_URL
    : WORLDVIEW_BUNDLED_MOUNT_ID;
  const ignore = command === 'serve' ? '/* @vite-ignore */ ' : '';
  return `export const importNativeWorldViewMount = () => import(${ignore}${JSON.stringify(target)});`;
}

function worldviewNativeMountPlugin(command: 'serve' | 'build'): Plugin {
  return {
    name: 'worldview-native-mount-module',
    resolveId(id) {
      if (id === WORLDVIEW_MOUNT_ID) return WORLDVIEW_MOUNT_RESOLVED_ID;
      if (id === WORLDVIEW_BUNDLED_MOUNT_ID) {
        return path.resolve(worldviewRoot, 'src/app/mount.js');
      }
      return null;
    },
    load(id) {
      return id === WORLDVIEW_MOUNT_RESOLVED_ID
        ? worldviewNativeMountModuleSource(command)
        : null;
    },
  };
}

function splitSelectors(selectorList: string): string[] {
  const selectors: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = '';
  for (let index = 0; index < selectorList.length; index += 1) {
    const char = selectorList[index];
    if (quote) {
      if (char === quote && selectorList[index - 1] !== '\\') quote = '';
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth = Math.max(0, depth - 1);
    else if (char === ',' && depth === 0) {
      selectors.push(selectorList.slice(start, index));
      start = index + 1;
    }
  }
  selectors.push(selectorList.slice(start));
  return selectors;
}

function scopeWorldviewSelector(rawSelector: string): string {
  const selector = rawSelector.trim();
  if (!selector) return selector;
  if (selector.startsWith(WORLDVIEW_SELECTOR)) return selector;
  if (/^:root(?=$|[.#:\[\s>+~])/.test(selector)) {
    return selector.replace(/^:root/, WORLDVIEW_SELECTOR);
  }
  if (/^html(?=$|[.#:\[\s>+~])/.test(selector)) {
    return selector.replace(/^html/, WORLDVIEW_SELECTOR);
  }
  if (/^body(?=$|[.#:\[\s>+~])/.test(selector)) {
    return selector.replace(/^body/, WORLDVIEW_SELECTOR);
  }
  return `${WORLDVIEW_SELECTOR} ${selector}`;
}

function isInsideKeyframes(rule: { parent?: any }): boolean {
  let parent = rule.parent;
  while (parent) {
    if (parent.type === 'atrule' && /keyframes$/i.test(parent.name || '')) return true;
    parent = parent.parent;
  }
  return false;
}

function worldviewNativeCssPlugin(): Plugin {
  return {
    name: 'worldview-native-scoped-css',
    resolveId(id) {
      return id === WORLDVIEW_CSS_ID ? WORLDVIEW_CSS_RESOLVED_ID : null;
    },
    async load(id) {
      if (id !== WORLDVIEW_CSS_RESOLVED_ID) return null;
      const source = fs.readFileSync(worldviewStylePath, 'utf8')
        .replace(/url\(\s*(['"]?)\/(?!\/)/g, 'url($1/worldview-native/');
      const result = await postcss([{
        postcssPlugin: 'worldview-native-root-scope',
        Rule(rule) {
          if (isInsideKeyframes(rule)) return;
          rule.selector = splitSelectors(rule.selector)
            .map(scopeWorldviewSelector)
            .join(',\n');
        },
        AtRule(atRule) {
          if (atRule.name === 'media'
            && /\((?:min|max)-(?:width|height)\s*:/.test(atRule.params)
            && !/prefers-|pointer|hover|resolution|orientation/.test(atRule.params)) {
            atRule.name = 'container';
            atRule.params = `worldview-native ${atRule.params}`;
          }
        },
        Declaration(decl) {
          decl.value = decl.value
            .replace(/(-?(?:\d+\.?\d*|\.\d+))vmin\b/g, '$1cqmin')
            .replace(/(-?(?:\d+\.?\d*|\.\d+))vmax\b/g, '$1cqmax')
            .replace(/(-?(?:\d+\.?\d*|\.\d+))vw\b/g, '$1cqw')
            .replace(/(-?(?:\d+\.?\d*|\.\d+))vh\b/g, '$1cqh');
        },
      }]).process(source, { from: worldviewStylePath });
      const mountCss = `
${WORLDVIEW_SELECTOR} {
  all: initial;
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  contain: layout paint style;
  isolation: isolate;
  container: worldview-native / size;
  transform: translateZ(0);
  color-scheme: dark;
  font-family: 'JetBrains Mono', monospace;
  background: #000;
}
${WORLDVIEW_SELECTOR}, ${WORLDVIEW_SELECTOR} * { box-sizing: border-box; }
`;
      return `export default ${JSON.stringify(mountCss + result.css)};`;
    },
  };
}

export default defineConfig(({ mode, command }) => {
  const vendorEnv = loadEnv(mode, worldviewRoot, '');
  const applicationProviderEnv = loadEnv(mode, path.resolve(repoRoot, 'apps/backend'), [
    'GOOGLE_MAPS_API_KEY', 'CESIUM_ION_TOKEN',
  ]);
  const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY
    ?? vendorEnv.GOOGLE_MAPS_API_KEY ?? applicationProviderEnv.GOOGLE_MAPS_API_KEY;
  const cesiumIonToken = process.env.CESIUM_ION_TOKEN
    ?? vendorEnv.CESIUM_ION_TOKEN ?? applicationProviderEnv.CESIUM_ION_TOKEN;
  return {
    root: __dirname,
    envDir: path.resolve(__dirname, '..'),
    plugins: [
      react(),
      worldviewNativeCssPlugin(),
      worldviewNativeMountPlugin(command),
      cesiumPlugin({
        rebuildCesium: true,
        cesiumBuildRootPath: path.resolve(worldviewRoot, 'node_modules/cesium/Build'),
        cesiumBuildPath: path.resolve(worldviewRoot, 'node_modules/cesium/Build/Cesium'),
        cesiumBaseUrl: 'cesium',
      }),
    ],
    define: {
      'import.meta.env.GOOGLE_MAPS_API_KEY': JSON.stringify(googleMapsApiKey),
      'import.meta.env.CESIUM_ION_TOKEN': JSON.stringify(cesiumIonToken),
    },
    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        'scheduler',
        // zustand's ESM traditional entry imports the selector shim as a default
        // export. This package is CommonJS, so it must be optimized before the
        // Agent Builder module graph evaluates; otherwise the graph workspace
        // fails before any of its authority-specific surfaces can mount.
        // Zustand imports the package's explicit `.js` export path. Vite keys
        // optimized dependencies by the exact specifier, so keep the extension
        // here as well; the extensionless entry leaves that live import raw.
        'use-sync-external-store/shim/with-selector.js',
        // @react-three/* is a raw-ESM exclude (below); its CJS leaf deps must still be
        // pre-bundled, or the raw drei/fiber default imports fail in dev and the
        // ThinkGraph/KnowGraph/CodeGraph scene blanks. Each is a standalone CJS leaf
        // (no three-stdlib in its graph), so this does NOT re-trigger the sourcemap crash.
        'react-reconciler',
        'react-reconciler/constants',
        'stats.js',
        // @react-three/drei -> react-composer (raw ESM) does `import PropTypes from
        // 'prop-types'`. prop-types is CJS with no named `default`, so without
        // pre-bundling Vite serves it raw and the scene's dynamic import dies with
        // "prop-types/index.js does not provide an export named 'default'", blanking
        // every graph tab. Pre-bundling it adds the esbuild CJS->ESM default interop.
        'prop-types',
        // @react-three/postprocessing (raw ESM) pulls `buffer` and does a NAMED
        // `import { Buffer } from 'buffer'`. The CJS `buffer` polyfill exposes no ESM
        // named `Buffer` unless pre-bundled, so the scene died with
        // "buffer/index.js does not provide an export named 'Buffer'" right after the
        // prop-types leaf. Same CJS-leaf fix.
        'buffer',
      ],
      // Work around corrupted nested sourcemaps in three-stdlib pulled by
      // @react-three/* during esbuild pre-bundling on dev startup.
      exclude: [
        '@react-three/fiber',
        '@react-three/drei',
        '@react-three/postprocessing',
      ],
    },
    resolve: {
      dedupe: [
        'react',
        'react-dom',
        'react-reconciler',
        '@react-three/fiber',
        '@react-three/drei',
        '@react-three/postprocessing',
      ],
      alias: [
        { find: '@/lib/time', replacement: path.resolve(__dirname, '../Hermes/apps/desktop/src/lib/time.ts') },
        // drei@9.110 pins troika-three-text@^0.49.0, whose <Text> defines
        // customDepthMaterial/customDistanceMaterial as getter-ONLY. three@0.183's
        // Object3D constructor assigns `this.customDepthMaterial = undefined`, so
        // `new Text()` throws "Cannot set property customDepthMaterial of #<Text>
        // which has only a getter" and every graph tab shows "Graph scene
        // unavailable". troika 0.52.4 makes those settable. npm keeps re-nesting
        // 0.49.1 under drei (its range can't take 0.52.x and overrides are ignored),
        // so the client declares 0.52.4 directly and resolution is pinned to the
        // workspace-hoisted copy. Vite uses this regardless of nested placement.
        {
          find: 'troika-three-text',
          replacement: path.resolve(__dirname, '../node_modules/troika-three-text'),
        },
        // npm hoisted react/react-dom to the ROOT node_modules (the old
        // client/node_modules copies no longer exist) — same install-proof
        // pinning as troika above, pointed at the hoisted copies. A stale
        // client-local path here crashes dev startup with
        // ENOENT jsx-dev-runtime.js.
        {
          find: 'react/jsx-runtime',
          replacement: path.resolve(__dirname, '../node_modules/react/jsx-runtime.js'),
        },
        {
          find: 'react/jsx-dev-runtime',
          replacement: path.resolve(__dirname, '../node_modules/react/jsx-dev-runtime.js'),
        },
        {
          find: 'react-dom/client',
          replacement: path.resolve(__dirname, '../node_modules/react-dom/client.js'),
        },
      ],
    },
    server: {
      host: '::',
      port: 5173,
      strictPort: false,
      proxy: {
        '/cesium-ion': {
          target: 'https://api.cesium.com',
          changeOrigin: true,
          secure: true,
          rewrite: (p) => p.replace(/^\/cesium-ion/, ''),
        },
        // Direct-mounted WorldView still uses the controlled fork's Vite
        // provider middleware for its native data APIs and static models. It
        // renders in this React document; this prefix is transport, not an
        // iframe/runtime page boundary.
        '/worldview-native': {
          target: 'http://127.0.0.1:4174',
          changeOrigin: true,
          secure: false,
          rewrite: (p) => p.replace(/^\/worldview-native/, ''),
        },
        // WorldSignals (vendored app, own FastAPI backend on :8000). Its client
        // calls `${API_BASE}/api/...`; the embed mount sets API_BASE to this
        // prefix, so its traffic lands here instead of on LiquidAIty's own /api
        // below. Proxying keeps it same-origin — no CORS grant on the vendor
        // backend, and no second origin in the page.
        // Must precede '/api' — Vite matches proxy keys in insertion order.
        '/worldsignals-api': {
          target: 'http://127.0.0.1:8000',
          changeOrigin: true,
          secure: false,
          rewrite: (p) => p.replace(/^\/worldsignals-api/, ''),
        },
        // App backend API
        '/api': {
          target: 'http://127.0.0.1:4000',
          changeOrigin: true,
          secure: false,
        },
      },
    },
    preview: {
      host: '127.0.0.1',
      proxy: {
        '/cesium-ion': {
          target: 'https://api.cesium.com',
          changeOrigin: true,
          secure: true,
          rewrite: (p) => p.replace(/^\/cesium-ion/, ''),
        },
        '/worldview-native': {
          target: 'http://127.0.0.1:4174',
          changeOrigin: true,
          secure: false,
          rewrite: (p) => p.replace(/^\/worldview-native/, ''),
        },
        '/worldsignals-api': {
          target: 'http://127.0.0.1:8000',
          changeOrigin: true,
          secure: false,
          rewrite: (p) => p.replace(/^\/worldsignals-api/, ''),
        },
        '/api': {
          target: 'http://127.0.0.1:4000',
          changeOrigin: true,
          secure: false,
        },
      },
    },
  };
});
