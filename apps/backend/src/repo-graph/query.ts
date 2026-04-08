import path from 'path';

import type {
  RepoGraphDriftSignal,
  RepoGraphIngestRecord,
  RepoGraphRelevantFileMatch,
} from './types';

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

function isNearbyPath(basePath: string, candidatePath: string): boolean {
  const baseDir = path.posix.dirname(normalizeRelativePath(basePath));
  return candidatePath === basePath || candidatePath.startsWith(`${baseDir}/`) || baseDir.startsWith(path.posix.dirname(candidatePath));
}

export function findImportersOfFile(record: RepoGraphIngestRecord, filePath: string): string[] {
  const normalized = normalizeRelativePath(filePath);
  return record.parsedFiles
    .filter((file) => file.imports.some((entry) => entry.resolvedFilePath === normalized))
    .map((file) => file.file.path)
    .sort();
}

export function findDependentsOfModule(record: RepoGraphIngestRecord, modulePath: string): string[] {
  return findImportersOfFile(record, modulePath);
}

export function findRoutesTouchingService(record: RepoGraphIngestRecord, serviceBoundary: string): string[] {
  const normalizedBoundary = serviceBoundary.trim().toLowerCase();
  return record.parsedFiles
    .filter((file) =>
      file.services.some((service) => service.boundary.toLowerCase() === normalizedBoundary),
    )
    .flatMap((file) => file.routes.map((route) => `${route.method} ${route.pathHint}`))
    .filter(Boolean);
}

export function findLikelyRelevantFiles(
  record: RepoGraphIngestRecord,
  terms: string[],
): RepoGraphRelevantFileMatch[] {
  const normalizedTerms = terms.map((term) => term.trim().toLowerCase()).filter(Boolean);

  return record.parsedFiles
    .map((file) => {
      let score = 0;
      const reasons: string[] = [];

      normalizedTerms.forEach((term) => {
        if (file.file.path.toLowerCase().includes(term)) {
          score += 4;
          reasons.push(`Path matches "${term}".`);
        }
        if (file.symbols.some((symbol) => symbol.name.toLowerCase().includes(term))) {
          score += 3;
          reasons.push(`Symbol matches "${term}".`);
        }
        if (file.services.some((service) => service.boundary.toLowerCase().includes(term))) {
          score += 2;
          reasons.push(`Service boundary matches "${term}".`);
        }
      });

      return {
        filePath: file.file.path,
        score,
        reasons,
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.filePath.localeCompare(right.filePath))
    .slice(0, 12);
}

export function findNearbyDriftCluster(
  record: RepoGraphIngestRecord,
  filePath: string,
): RepoGraphDriftSignal[] {
  const normalized = normalizeRelativePath(filePath);
  return record.thinkGraph.notes.filter((note) => isNearbyPath(normalized, note.filePath));
}
