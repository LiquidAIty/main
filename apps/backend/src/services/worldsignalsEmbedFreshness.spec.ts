import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeEmbedBundleFreshness } from './worldsignalsEmbedFreshness';

// WS-7: honest detection that the built embed bundle is stale/missing vs vendor
// source — without rebuilding, and without unrelated files reading as stale.
describe('computeEmbedBundleFreshness', () => {
  let tmp: string;
  let bundle: string;
  let sourceDir: string;

  const setMtime = (file: string, epochSeconds: number) =>
    utimesSync(file, epochSeconds, epochSeconds);

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'ws7-'));
    bundle = path.join(tmp, 'out', 'embed.js');
    sourceDir = path.join(tmp, 'src');
    mkdirSync(path.dirname(bundle), { recursive: true });
    mkdirSync(sourceDir, { recursive: true });
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it('reports missing when the bundle does not exist', () => {
    writeFileSync(path.join(sourceDir, 'a.tsx'), 'x');
    const r = computeEmbedBundleFreshness(bundle, sourceDir);
    expect(r.status).toBe('missing');
    expect(r.message).toContain('build:embed');
  });

  it('reports fresh when the bundle is newer than every source file', () => {
    const src = path.join(sourceDir, 'a.tsx');
    writeFileSync(src, 'x');
    writeFileSync(bundle, 'built');
    setMtime(src, 1000);
    setMtime(bundle, 2000); // built after source
    const r = computeEmbedBundleFreshness(bundle, sourceDir);
    expect(r.status).toBe('fresh');
  });

  it('reports stale when a source file is newer than the bundle', () => {
    const src = path.join(sourceDir, 'a.tsx');
    writeFileSync(bundle, 'built');
    writeFileSync(src, 'x');
    setMtime(bundle, 1000);
    setMtime(src, 2000); // edited after the build
    const r = computeEmbedBundleFreshness(bundle, sourceDir);
    expect(r.status).toBe('stale');
    expect(r.newestSourceFile).toBe(src);
    expect(r.message).toContain('build:embed');
  });

  it('finds the newest file in a nested source tree', () => {
    const nested = path.join(sourceDir, 'embed', 'deep');
    mkdirSync(nested, { recursive: true });
    const src = path.join(nested, 'mount.tsx');
    writeFileSync(bundle, 'built');
    writeFileSync(src, 'x');
    setMtime(bundle, 1000);
    setMtime(src, 3000);
    expect(computeEmbedBundleFreshness(bundle, sourceDir).status).toBe('stale');
  });

  it('does NOT read as stale when only an unrelated (non-source) file changed', () => {
    const src = path.join(sourceDir, 'a.tsx');
    const unrelated = path.join(sourceDir, 'notes.md'); // .md is not a build input
    writeFileSync(src, 'x');
    writeFileSync(bundle, 'built');
    writeFileSync(unrelated, 'readme');
    setMtime(src, 1000);
    setMtime(bundle, 2000);
    setMtime(unrelated, 5000); // newer, but irrelevant to the bundle
    expect(computeEmbedBundleFreshness(bundle, sourceDir).status).toBe('fresh');
  });

  it('is fresh (not stale) when the vendor source tree is absent', () => {
    writeFileSync(bundle, 'built');
    const r = computeEmbedBundleFreshness(bundle, path.join(tmp, 'nonexistent'));
    expect(r.status).toBe('fresh');
    expect(r.newestSourceMtimeMs).toBeNull();
  });
});
