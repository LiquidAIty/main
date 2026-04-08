import path from 'path';

import type {
  RepoGraphEdgeRecord,
  RepoGraphIngestRecord,
  RepoGraphNodeRecord,
  RepoGraphParseResult,
  RepoGraphParsedFile,
} from './types';

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

function repoNodeId(repoPath: string): string {
  return `repo:${normalizeRelativePath(repoPath)}`;
}

function directoryNodeId(relativePath: string): string {
  return `dir:${normalizeRelativePath(relativePath)}`;
}

function fileNodeId(relativePath: string): string {
  return `file:${normalizeRelativePath(relativePath)}`;
}

function symbolNodeId(filePath: string, symbolName: string): string {
  return `symbol:${normalizeRelativePath(filePath)}:${symbolName}`;
}

function routeNodeId(filePath: string, method: string, pathHint: string): string {
  return `route:${normalizeRelativePath(filePath)}:${method}:${pathHint}`;
}

function serviceNodeId(boundary: string): string {
  return `service:${boundary}`;
}

function pushNode(target: RepoGraphNodeRecord[], node: RepoGraphNodeRecord): void {
  if (target.some((existing) => existing.id === node.id)) return;
  target.push(node);
}

function pushEdge(target: RepoGraphEdgeRecord[], edge: RepoGraphEdgeRecord): void {
  if (target.some((existing) => existing.id === edge.id)) return;
  target.push(edge);
}

function buildDirectoryContainment(
  repoPath: string,
  relativePath: string,
  nodes: RepoGraphNodeRecord[],
  edges: RepoGraphEdgeRecord[],
): void {
  const parent = path.posix.dirname(relativePath);
  if (parent === '.' || parent === '') {
    pushEdge(edges, {
      id: `edge:contains:${repoNodeId(repoPath)}:${directoryNodeId(relativePath)}`,
      kind: 'contains',
      from: repoNodeId(repoPath),
      to: directoryNodeId(relativePath),
    });
    return;
  }

  pushNode(nodes, {
    id: directoryNodeId(parent),
    kind: 'directory',
    label: path.posix.basename(parent),
    path: parent,
  });
  pushEdge(edges, {
    id: `edge:contains:${directoryNodeId(parent)}:${directoryNodeId(relativePath)}`,
    kind: 'contains',
    from: directoryNodeId(parent),
    to: directoryNodeId(relativePath),
  });
}

function addParsedFileRecords(
  parsedFile: RepoGraphParsedFile,
  nodes: RepoGraphNodeRecord[],
  edges: RepoGraphEdgeRecord[],
): void {
  pushNode(nodes, {
    id: fileNodeId(parsedFile.file.path),
    kind: 'file',
    label: parsedFile.file.name,
    path: parsedFile.file.path,
    metadata: {
      extension: parsedFile.file.extension,
      language: parsedFile.file.language,
      sizeBytes: parsedFile.file.sizeBytes,
    },
  });

  const parentDir = path.posix.dirname(parsedFile.file.path);
  if (parentDir && parentDir !== '.') {
    pushNode(nodes, {
      id: directoryNodeId(parentDir),
      kind: 'directory',
      label: path.posix.basename(parentDir),
      path: parentDir,
    });
    pushEdge(edges, {
      id: `edge:contains:${directoryNodeId(parentDir)}:${fileNodeId(parsedFile.file.path)}`,
      kind: 'contains',
      from: directoryNodeId(parentDir),
      to: fileNodeId(parsedFile.file.path),
    });
  }

  parsedFile.symbols.forEach((symbol) => {
    pushNode(nodes, {
      id: symbolNodeId(symbol.filePath, symbol.name),
      kind: 'symbol',
      label: symbol.name,
      path: symbol.filePath,
      metadata: { kind: symbol.kind },
    });
    pushEdge(edges, {
      id: `edge:defines:${fileNodeId(symbol.filePath)}:${symbolNodeId(symbol.filePath, symbol.name)}`,
      kind: 'defines',
      from: fileNodeId(symbol.filePath),
      to: symbolNodeId(symbol.filePath, symbol.name),
      metadata: { symbolKind: symbol.kind },
    });
  });

  parsedFile.exports.forEach((entry) => {
    pushEdge(edges, {
      id: `edge:exports:${fileNodeId(entry.filePath)}:${symbolNodeId(entry.filePath, entry.name)}`,
      kind: 'exports',
      from: fileNodeId(entry.filePath),
      to: symbolNodeId(entry.filePath, entry.name),
      metadata: { exportKind: entry.kind },
    });
  });

  parsedFile.imports.forEach((entry) => {
    if (!entry.resolvedFilePath) return;
    pushEdge(edges, {
      id: `edge:imports:${fileNodeId(entry.sourceFilePath)}:${fileNodeId(entry.resolvedFilePath)}`,
      kind: 'imports',
      from: fileNodeId(entry.sourceFilePath),
      to: fileNodeId(entry.resolvedFilePath),
      metadata: { specifier: entry.specifier },
    });
  });

  parsedFile.routes.forEach((route) => {
    pushNode(nodes, {
      id: routeNodeId(route.filePath, route.method, route.pathHint),
      kind: 'route',
      label: `${route.method} ${route.pathHint}`,
      path: route.filePath,
      metadata: { symbolName: route.symbolName || null },
    });
    pushEdge(edges, {
      id: `edge:route:${fileNodeId(route.filePath)}:${routeNodeId(route.filePath, route.method, route.pathHint)}`,
      kind: 'declares_route',
      from: fileNodeId(route.filePath),
      to: routeNodeId(route.filePath, route.method, route.pathHint),
    });
  });

  parsedFile.services.forEach((service) => {
    pushNode(nodes, {
      id: serviceNodeId(service.boundary),
      kind: 'service',
      label: service.boundary,
      path: service.filePath,
    });
    pushEdge(edges, {
      id: `edge:service:${fileNodeId(service.filePath)}:${serviceNodeId(service.boundary)}`,
      kind: 'touches_service',
      from: fileNodeId(service.filePath),
      to: serviceNodeId(service.boundary),
    });
  });
}

export function buildRepoGraphIngest(parseResult: RepoGraphParseResult): RepoGraphIngestRecord {
  const nodes: RepoGraphNodeRecord[] = [];
  const edges: RepoGraphEdgeRecord[] = [];

  pushNode(nodes, {
    id: repoNodeId(parseResult.repoPath),
    kind: 'repository',
    label: path.posix.basename(parseResult.repoPath) || parseResult.repoPath,
    path: parseResult.repoPath,
  });

  parseResult.files.forEach((parsedFile) => {
    const directoryPath = path.posix.dirname(parsedFile.file.path);
    if (directoryPath && directoryPath !== '.') {
      const segments = directoryPath.split('/');
      let built = '';
      segments.forEach((segment) => {
        built = built ? `${built}/${segment}` : segment;
        pushNode(nodes, {
          id: directoryNodeId(built),
          kind: 'directory',
          label: segment,
          path: built,
        });
        buildDirectoryContainment(parseResult.repoPath, built, nodes, edges);
      });
    }

    addParsedFileRecords(parsedFile, nodes, edges);
  });

  const driftNotes = parseResult.files.flatMap((parsedFile) => parsedFile.driftSignals);
  const serviceCount = new Set(
    parseResult.files.flatMap((parsedFile) => parsedFile.services.map((service) => service.boundary)),
  ).size;
  const routeCount = parseResult.files.reduce((count, parsedFile) => count + parsedFile.routes.length, 0);

  return {
    repoPath: parseResult.repoPath,
    generatedAt: new Date().toISOString(),
    parsedFiles: parseResult.files,
    knowGraph: {
      nodes,
      edges,
    },
    thinkGraph: {
      notes: driftNotes,
    },
    blackboard: {
      currentGoal: 'Graph the repository and expose the next code-relevant moves.',
      findings: [
        `Parsed ${parseResult.files.length} files into repo graph records.`,
        `Detected ${serviceCount} service boundaries and ${routeCount} route entries.`,
      ],
      openQuestions: driftNotes.slice(0, 4).map((note) => `${note.filePath}: ${note.reason}`),
      nextOptions: [
        'Run structural queries against the repo graph.',
        'Promote objective records into KnowGraph.',
        'Review nearby drift signals before editing.',
      ],
    },
  };
}
