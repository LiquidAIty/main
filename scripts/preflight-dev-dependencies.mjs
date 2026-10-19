import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_SCOPE = 'root';
const WORLDVIEW_SCOPE = 'worldview';

export const DEVELOPMENT_DEPENDENCY_REQUIREMENTS = Object.freeze([
  { scope: ROOT_SCOPE, kind: 'file', path: 'node_modules/.bin/kill-port.cmd', label: 'root kill-port launcher' },
  { scope: ROOT_SCOPE, kind: 'file', path: 'node_modules/.bin/concurrently.cmd', label: 'root concurrently launcher' },
  { scope: ROOT_SCOPE, kind: 'file', path: 'node_modules/.bin/vite.cmd', label: 'root Vite launcher' },
  { scope: ROOT_SCOPE, kind: 'file', path: 'node_modules/.bin/tsc.cmd', label: 'root TypeScript launcher' },
  { scope: ROOT_SCOPE, kind: 'file', path: 'node_modules/.bin/vitest.cmd', label: 'root Vitest launcher' },
  { scope: ROOT_SCOPE, kind: 'file', path: 'node_modules/.bin/nx.cmd', label: 'root Nx launcher' },
  {
    scope: ROOT_SCOPE,
    kind: 'package',
    path: 'node_modules/kill-port/package.json',
    name: 'kill-port',
    bin: 'kill-port',
    declaredIn: 'package.json',
    declaredSection: 'devDependencies',
  },
  {
    scope: ROOT_SCOPE,
    kind: 'package',
    path: 'node_modules/concurrently/package.json',
    name: 'concurrently',
    bin: 'concurrently',
    declaredIn: 'package.json',
    declaredSection: 'devDependencies',
  },
  {
    scope: ROOT_SCOPE,
    kind: 'package',
    path: 'node_modules/vite/package.json',
    name: 'vite',
    bin: 'vite',
    declaredIn: 'package.json',
    declaredSection: 'devDependencies',
  },
  {
    scope: ROOT_SCOPE,
    kind: 'package',
    path: 'node_modules/typescript/package.json',
    name: 'typescript',
    bin: 'tsc',
    declaredIn: 'package.json',
    declaredSection: 'devDependencies',
  },
  {
    scope: ROOT_SCOPE,
    kind: 'package',
    path: 'node_modules/vitest/package.json',
    name: 'vitest',
    bin: 'vitest',
    declaredIn: 'package.json',
    declaredSection: 'devDependencies',
  },
  {
    scope: ROOT_SCOPE,
    kind: 'package',
    path: 'node_modules/nx/package.json',
    name: 'nx',
    bin: 'nx',
    declaredIn: 'package.json',
    declaredSection: 'devDependencies',
  },
  {
    scope: ROOT_SCOPE,
    kind: 'package',
    path: 'client/node_modules/vite/package.json',
    name: 'vite',
    bin: 'vite',
    declaredIn: 'client/package.json',
    declaredSection: 'devDependencies',
  },
  { scope: ROOT_SCOPE, kind: 'file', path: 'client/node_modules/.bin/vite.cmd', label: 'client Vite launcher' },
  {
    scope: ROOT_SCOPE,
    kind: 'package',
    path: 'node_modules/@prisma/client/package.json',
    name: '@prisma/client',
    declaredIn: 'package.json',
    declaredSection: 'dependencies',
  },
  { scope: ROOT_SCOPE, kind: 'file', path: 'node_modules/.prisma/client/package.json', label: 'generated Prisma manifest' },
  { scope: ROOT_SCOPE, kind: 'file', path: 'node_modules/.prisma/client/index.js', label: 'generated Prisma client' },
  { scope: ROOT_SCOPE, kind: 'file', path: 'node_modules/.prisma/client/query_engine-windows.dll.node', label: 'generated Prisma query engine' },
  {
    scope: WORLDVIEW_SCOPE,
    kind: 'package',
    path: 'agent-products/gods-eye-view/node_modules/vite/package.json',
    name: 'vite',
    bin: 'vite',
    declaredIn: 'agent-products/gods-eye-view/package.json',
    declaredSection: 'devDependencies',
  },
  {
    scope: WORLDVIEW_SCOPE,
    kind: 'file',
    path: 'agent-products/gods-eye-view/node_modules/.bin/vite.cmd',
    label: "God's Eye package-local Vite launcher",
  },
  {
    scope: WORLDVIEW_SCOPE,
    kind: 'package',
    path: 'agent-products/gods-eye-view/node_modules/vite-plugin-cesium/package.json',
    name: 'vite-plugin-cesium',
    declaredIn: 'agent-products/gods-eye-view/package.json',
    declaredSection: 'devDependencies',
  },
]);

function packageBin(manifest, name) {
  if (typeof manifest.bin === 'string') return manifest.bin;
  if (manifest.bin && typeof manifest.bin === 'object') return manifest.bin[name];
  return undefined;
}

export async function checkDevelopmentDependencies(repoRoot) {
  const issues = [];
  const issueKeys = new Set();
  const manifestCache = new Map();

  const addIssue = (scope, relativePath, detail) => {
    const key = `${scope}:${relativePath}:${detail}`;
    if (issueKeys.has(key)) return;
    issueKeys.add(key);
    issues.push({ scope, path: relativePath, detail });
  };

  const readManifest = async (scope, relativePath) => {
    if (manifestCache.has(relativePath)) return manifestCache.get(relativePath);
    try {
      const parsed = JSON.parse(await readFile(path.join(repoRoot, relativePath), 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('manifest_not_object');
      }
      manifestCache.set(relativePath, parsed);
      return parsed;
    } catch {
      manifestCache.set(relativePath, null);
      addIssue(scope, relativePath, 'missing or invalid package manifest');
      return null;
    }
  };

  for (const requirement of DEVELOPMENT_DEPENDENCY_REQUIREMENTS) {
    const absolutePath = path.join(repoRoot, requirement.path);
    if (requirement.kind === 'file') {
      try {
        await access(absolutePath);
      } catch {
        addIssue(requirement.scope, requirement.path, `${requirement.label} is missing`);
      }
      continue;
    }

    const manifest = await readManifest(requirement.scope, requirement.path);
    if (!manifest) continue;
    if (manifest.name !== requirement.name || typeof manifest.version !== 'string' || !manifest.version.trim()) {
      addIssue(requirement.scope, requirement.path, `expected package ${requirement.name}`);
    }

    const declaration = await readManifest(requirement.scope, requirement.declaredIn);
    const declaredVersion = declaration?.[requirement.declaredSection]?.[requirement.name];
    if (typeof declaredVersion !== 'string' || !declaredVersion.trim()) {
      addIssue(
        requirement.scope,
        requirement.declaredIn,
        `${requirement.name} is not declared in ${requirement.declaredSection}`,
      );
    }

    if (requirement.bin) {
      const binTarget = packageBin(manifest, requirement.bin);
      if (typeof binTarget !== 'string' || !binTarget.trim()) {
        addIssue(requirement.scope, requirement.path, `package bin ${requirement.bin} is missing`);
      } else {
        const packageRoot = path.dirname(absolutePath);
        try {
          await access(path.resolve(packageRoot, binTarget));
        } catch {
          addIssue(requirement.scope, requirement.path, `package bin target ${binTarget} is missing`);
        }
      }
    }
  }

  return issues;
}

export function formatDependencyPreflightFailure(issues) {
  const lines = ['Development dependency preflight failed before service shutdown.'];
  for (const issue of issues) lines.push(`- ${issue.path}: ${issue.detail}`);

  if (issues.some((issue) => issue.scope === ROOT_SCOPE)) {
    lines.push(
      '',
      'Root recovery (after all LiquidAIty development services are stopped):',
      '  npm ci',
      '  npm run prisma:generate',
    );
  }
  if (issues.some((issue) => issue.scope === WORLDVIEW_SCOPE)) {
    lines.push(
      '',
      "God's Eye package recovery:",
      '  npm ci --prefix agent-products/gods-eye-view --ignore-scripts',
    );
  }
  lines.push('', 'No recovery command was run.');
  return lines.join('\n');
}

const modulePath = fileURLToPath(import.meta.url);
const isDirectInvocation = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(modulePath);

if (isDirectInvocation) {
  const repoRoot = path.resolve(path.dirname(modulePath), '..');
  const issues = await checkDevelopmentDependencies(repoRoot);
  if (issues.length > 0) {
    console.error(formatDependencyPreflightFailure(issues));
    process.exitCode = 1;
  } else {
    console.log('Development dependency preflight passed.');
  }
}
