import type { V3Blackboard } from '../v3/types';

export type RepoGraphLanguage =
  | 'typescript'
  | 'tsx'
  | 'javascript'
  | 'jsx'
  | 'json'
  | 'markdown'
  | 'python'
  | 'unknown';

export type RepoGraphNodeKind =
  | 'repository'
  | 'directory'
  | 'file'
  | 'symbol'
  | 'route'
  | 'service';

export type RepoGraphEdgeKind =
  | 'contains'
  | 'imports'
  | 'exports'
  | 'defines'
  | 'declares_route'
  | 'touches_service';

export type RepoGraphScanInput = {
  repoPath: string;
  allowlistRoots?: string[];
  excludeRoots?: string[];
  includeExtensions?: string[];
  excludeDirs?: string[];
  maxFiles?: number;
  dryRun?: boolean;
};

export type RepoGraphDirectoryRecord = {
  path: string;
  name: string;
};

export type RepoGraphFileRecord = {
  path: string;
  name: string;
  extension: string;
  language: RepoGraphLanguage;
  sizeBytes: number;
  lastModifiedAt: string;
  isRouteFile: boolean;
};

export type RepoGraphScanRootStatus = {
  root: string;
  normalizedRoot: string;
  kind: 'file' | 'directory' | 'missing' | 'excluded' | 'outside_repo' | 'unsupported';
  selectedDirectoryCount: number;
  selectedFileCount: number;
  reason?: string;
};

export type RepoGraphScanSummary = {
  dryRun: boolean;
  truncated: boolean;
  directoryCount: number;
  fileCount: number;
  routeFileCount: number;
};

export type RepoGraphScanResult = {
  repoPath: string;
  scannedAt: string;
  allowlistRoots: string[];
  excludeRoots: string[];
  maxFiles: number;
  dryRun: boolean;
  truncated: boolean;
  rootStatuses: RepoGraphScanRootStatus[];
  summary: RepoGraphScanSummary;
  directories: RepoGraphDirectoryRecord[];
  files: RepoGraphFileRecord[];
};

export type RepoGraphImportRecord = {
  sourceFilePath: string;
  specifier: string;
  resolvedFilePath: string | null;
  isRelative: boolean;
};

export type RepoGraphExportRecord = {
  filePath: string;
  name: string;
  kind: 'named' | 'default';
};

export type RepoGraphSymbolRecord = {
  filePath: string;
  name: string;
  kind: 'function' | 'class' | 'type' | 'const' | 'component';
};

export type RepoGraphRouteRecord = {
  filePath: string;
  method: string;
  pathHint: string;
  symbolName?: string | null;
};

export type RepoGraphServiceRecord = {
  filePath: string;
  boundary: string;
};

export type RepoGraphDriftSignal = {
  filePath: string;
  reason: string;
  confidence: 'low' | 'medium' | 'high';
};

export type RepoGraphParsedFile = {
  file: RepoGraphFileRecord;
  imports: RepoGraphImportRecord[];
  exports: RepoGraphExportRecord[];
  symbols: RepoGraphSymbolRecord[];
  routes: RepoGraphRouteRecord[];
  services: RepoGraphServiceRecord[];
  driftSignals: RepoGraphDriftSignal[];
};

export type RepoGraphParseResult = {
  repoPath: string;
  parsedAt: string;
  files: RepoGraphParsedFile[];
};

export type RepoGraphNodeRecord = {
  id: string;
  kind: RepoGraphNodeKind;
  label: string;
  path?: string;
  metadata?: Record<string, unknown>;
};

export type RepoGraphEdgeRecord = {
  id: string;
  kind: RepoGraphEdgeKind;
  from: string;
  to: string;
  metadata?: Record<string, unknown>;
};

export type RepoGraphRelevantFileMatch = {
  filePath: string;
  score: number;
  reasons: string[];
};

export type RepoGraphIngestRecord = {
  repoPath: string;
  generatedAt: string;
  parsedFiles: RepoGraphParsedFile[];
  knowGraph: {
    nodes: RepoGraphNodeRecord[];
    edges: RepoGraphEdgeRecord[];
  };
  thinkGraph: {
    notes: RepoGraphDriftSignal[];
  };
  blackboard: {
    currentGoal: string | null;
    findings: string[];
    openQuestions: string[];
    nextOptions: string[];
  };
};

export type RepoGraphPersistenceEnvelope = {
  knowGraph: RepoGraphIngestRecord['knowGraph'];
  thinkGraph: RepoGraphIngestRecord['thinkGraph'];
  blackboardWrite: V3Blackboard;
  summary: string;
};
