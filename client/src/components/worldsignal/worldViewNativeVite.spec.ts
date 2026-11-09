// @vitest-environment node

/**
 * Entity: WorldView
 * Relationship: Verifies the WorldView module doorway and actual Cesium dependency initialization under a policy that forbids JavaScript string evaluation.
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { worldviewNativeMountModuleSource, worldviewNativeMountPlugin, worldviewRoot } from '../../../vite.config';

describe('WorldView Vite module doorway', () => {
  it('uses only the public supervised module URL in development', () => {
    const source = worldviewNativeMountModuleSource('serve');
    expect(source).toContain('http://127.0.0.1:4174/src/app/mount.js');
    expect(source).not.toContain('/@fs/');
    expect(source).not.toMatch(/[A-Z]:\//);
  });

  it('uses the bundled module graph in production without a localhost dependency', () => {
    const source = worldviewNativeMountModuleSource('build');
    expect(source).toContain('virtual:worldview-native-mount-bundled');
    expect(source).not.toContain('127.0.0.1');
    expect(source).not.toContain('/@fs/');
  });

  it('loads the installed Cesium Knockout dependency without string code generation', async () => {
    const dependency = path.join(worldviewRoot, 'node_modules/@cesium/widgets/Source/ThirdParty/knockout-3.5.1.js');
    const original = fs.readFileSync(dependency, 'utf8');
    const load = (source: string) => {
      const context = vm.createContext({ setTimeout, clearTimeout }, {
        codeGeneration: { strings: false, wasm: false },
      });
      vm.runInContext('globalThis.window = globalThis;', context);
      // Exercise the actual library body as strict code, just as an ES module is.
      vm.runInContext('"use strict";\n' + source.replace(
        'export default knockout;', 'globalThis.loadedKnockout = knockout;',
      ), context);
      return context.loadedKnockout;
    };
    expect(() => load(original)).toThrow(/Code generation from strings disallowed/);
    const plugin = worldviewNativeMountPlugin('build');
    const transform = plugin.transform as (source: string, id: string) => { code: string } | null;
    const result = transform(original, dependency);
    expect(result).not.toBeNull();
    const knockout = load(result!.code);
    const value = knockout.observable('before');
    value('after');
    expect(value()).toBe('after');
    expect(knockout.version).toBe('3.5.1');
    expect(transform(original, '/unrelated/knockout-3.5.1.js')).toBeNull();
    expect(() => transform('upstream changed', dependency)).toThrow(/global lookup changed/);
  });
});
