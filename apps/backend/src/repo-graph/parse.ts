import { promises as fs } from 'fs';
import path from 'path';

import type {
  RepoGraphDriftSignal,
  RepoGraphExportRecord,
  RepoGraphFileRecord,
  RepoGraphImportRecord,
  RepoGraphParseResult,
  RepoGraphParsedFile,
  RepoGraphRouteRecord,
  RepoGraphScanResult,
  RepoGraphServiceRecord,
  RepoGraphSymbolRecord,
} from './types';

const MAX_PARSE_BYTES = 250_000;

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

function uniqueByKey<T>(items: T[], getKey: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  items.forEach((item) => {
    const key = getKey(item);
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.push(item);
  });
  return result;
}

function resolveRelativeImport(
  sourceFilePath: string,
  specifier: string,
  knownFiles: Set<string>,
): string | null {
  if (!specifier.startsWith('.')) return null;

  const sourceDir = path.posix.dirname(sourceFilePath);
  const baseTarget = path.posix.normalize(path.posix.join(sourceDir, specifier));
  const candidates = [
    baseTarget,
    `${baseTarget}.ts`,
    `${baseTarget}.tsx`,
    `${baseTarget}.js`,
    `${baseTarget}.jsx`,
    `${baseTarget}.json`,
    `${baseTarget}/index.ts`,
    `${baseTarget}/index.tsx`,
    `${baseTarget}/index.js`,
    `${baseTarget}/index.jsx`,
  ].map(normalizeRelativePath);

  return candidates.find((candidate) => knownFiles.has(candidate)) || null;
}

function parseImports(filePath: string, content: string, knownFiles: Set<string>): RepoGraphImportRecord[] {
  const imports: RepoGraphImportRecord[] = [];
  const importPattern =
    /(?:import\s+[\s\S]*?\s+from\s+|export\s+[\s\S]*?\s+from\s+|require\()\s*['"]([^'"]+)['"]/g;

  let match: RegExpExecArray | null;
  while ((match = importPattern.exec(content))) {
    const specifier = String(match[1] || '').trim();
    if (!specifier) continue;
    imports.push({
      sourceFilePath: filePath,
      specifier,
      resolvedFilePath: resolveRelativeImport(filePath, specifier, knownFiles),
      isRelative: specifier.startsWith('.'),
    });
  }

  return uniqueByKey(imports, (entry) => `${entry.sourceFilePath}:${entry.specifier}`);
}

function parseExports(filePath: string, content: string): RepoGraphExportRecord[] {
  const exports: RepoGraphExportRecord[] = [];
  const namedExportPattern =
    /^\s*export\s+(?:async\s+)?(?:function|class|const|let|var|type|interface)\s+([A-Za-z0-9_$]+)/gm;
  const defaultExportPattern = /^\s*export\s+default\b/gm;

  let match: RegExpExecArray | null;
  while ((match = namedExportPattern.exec(content))) {
    const name = String(match[1] || '').trim();
    if (!name) continue;
    exports.push({ filePath, name, kind: 'named' });
  }

  if (defaultExportPattern.test(content)) {
    exports.push({ filePath, name: 'default', kind: 'default' });
  }

  return uniqueByKey(exports, (entry) => `${entry.filePath}:${entry.kind}:${entry.name}`);
}

function parseSymbols(filePath: string, content: string): RepoGraphSymbolRecord[] {
  const symbols: RepoGraphSymbolRecord[] = [];
  const patterns: Array<{ kind: RepoGraphSymbolRecord['kind']; regex: RegExp }> = [
    { kind: 'function', regex: /\bfunction\s+([A-Za-z0-9_$]+)\s*\(/g },
    { kind: 'class', regex: /\bclass\s+([A-Za-z0-9_$]+)\b/g },
    { kind: 'type', regex: /\b(?:type|interface)\s+([A-Za-z0-9_$]+)\b/g },
    { kind: 'const', regex: /\bconst\s+([A-Za-z0-9_$]+)\s*=/g },
  ];

  patterns.forEach(({ kind, regex }) => {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content))) {
      const name = String(match[1] || '').trim();
      if (!name) continue;
      symbols.push({ filePath, name, kind });
    }
  });

  const componentPattern = /\bconst\s+([A-Z][A-Za-z0-9_$]+)\s*=\s*\(/g;
  let componentMatch: RegExpExecArray | null;
  while ((componentMatch = componentPattern.exec(content))) {
    const name = String(componentMatch[1] || '').trim();
    if (!name) continue;
    symbols.push({ filePath, name, kind: 'component' });
  }

  return uniqueByKey(symbols, (entry) => `${entry.filePath}:${entry.kind}:${entry.name}`);
}

function parseRoutes(filePath: string, content: string): RepoGraphRouteRecord[] {
  const routes: RepoGraphRouteRecord[] = [];
  const expressPattern = /\b(?:app|router)\.(get|post|put|patch|delete|use)\(\s*['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;

  while ((match = expressPattern.exec(content))) {
    routes.push({
      filePath,
      method: String(match[1] || 'use').toUpperCase(),
      pathHint: String(match[2] || '').trim() || '/',
      symbolName: null,
    });
  }

  if (filePath.endsWith('/route.ts') || filePath.endsWith('/route.tsx') || filePath.endsWith('/route.js')) {
    const nextPattern = /\bexport\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/g;
    while ((match = nextPattern.exec(content))) {
      routes.push({
        filePath,
        method: String(match[1] || 'GET').toUpperCase(),
        pathHint: path.posix.dirname(filePath),
        symbolName: String(match[1] || '').toUpperCase(),
      });
    }
  }

  return uniqueByKey(routes, (entry) => `${entry.filePath}:${entry.method}:${entry.pathHint}`);
}

function inferServices(file: RepoGraphFileRecord, content: string): RepoGraphServiceRecord[] {
  const services: RepoGraphServiceRecord[] = [];
  const filePath = file.path;
  const segments = filePath.split('/');

  if (segments.includes('services')) {
    const index = segments.indexOf('services');
    const boundary = segments[index + 1] || path.posix.basename(filePath, file.extension);
    services.push({ filePath, boundary: boundary.replace(/\.[^.]+$/, '') });
  }

  if (segments.includes('connectors')) {
    const index = segments.indexOf('connectors');
    const boundary = segments[index + 1] || path.posix.basename(filePath, file.extension);
    services.push({ filePath, boundary: boundary.replace(/\.[^.]+$/, '') });
  }

  const runtimeHints = ['tool', 'service', 'adapter'];
  runtimeHints.forEach((hint) => {
    if (file.name.toLowerCase().includes(hint)) {
      services.push({
        filePath,
        boundary: path.posix.basename(filePath, file.extension),
      });
    }
  });

  if (/\bclass\s+[A-Za-z0-9_$]*Service\b/.test(content)) {
    services.push({
      filePath,
      boundary: path.posix.basename(filePath, file.extension),
    });
  }

  return uniqueByKey(services, (entry) => `${entry.filePath}:${entry.boundary}`);
}

function inferDriftSignals(file: RepoGraphFileRecord, content: string): RepoGraphDriftSignal[] {
  const signals: RepoGraphDriftSignal[] = [];
  const addSignal = (reason: string, confidence: RepoGraphDriftSignal['confidence']): void => {
    signals.push({
      filePath: file.path,
      reason,
      confidence,
    });
  };

  if (/\bTODO\b/i.test(content)) addSignal('Contains TODO markers.', 'low');
  if (/\bFIXME\b/i.test(content)) addSignal('Contains FIXME markers.', 'medium');
  if (/\badapter-only\b/i.test(content)) addSignal('Contains adapter-only notes.', 'medium');
  if (/\bstub\b/i.test(content)) addSignal('Contains stub markers.', 'medium');
  if (file.path.includes('/legacy/') || file.path.includes('/old/')) {
    addSignal('Lives in an archived or legacy path.', 'high');
  }

  return uniqueByKey(signals, (entry) => `${entry.filePath}:${entry.reason}`);
}

async function parseFile(
  repoPath: string,
  file: RepoGraphFileRecord,
  knownFiles: Set<string>,
): Promise<RepoGraphParsedFile> {
  const absolutePath = path.join(repoPath, file.path);
  if (file.sizeBytes > MAX_PARSE_BYTES) {
    return {
      file,
      imports: [],
      exports: [],
      symbols: [],
      routes: [],
      services: [],
      driftSignals: [
        {
          filePath: file.path,
          reason: 'Skipped deep parse because the file is larger than the MVP parse limit.',
          confidence: 'low',
        },
      ],
    };
  }

  const content = await fs.readFile(absolutePath, 'utf8');
  return {
    file,
    imports: parseImports(file.path, content, knownFiles),
    exports: parseExports(file.path, content),
    symbols: parseSymbols(file.path, content),
    routes: parseRoutes(file.path, content),
    services: inferServices(file, content),
    driftSignals: inferDriftSignals(file, content),
  };
}

export async function parseRepoGraph(scanResult: RepoGraphScanResult): Promise<RepoGraphParseResult> {
  const knownFiles = new Set(scanResult.files.map((file) => file.path));
  const files = await Promise.all(
    scanResult.files.map((file) => parseFile(scanResult.repoPath, file, knownFiles)),
  );

  return {
    repoPath: scanResult.repoPath,
    parsedAt: new Date().toISOString(),
    files,
  };
}
