// Graph + less = more: less code that does the same work as more code is more useful.
// Entity names the feature; Relationship explains why this file belongs and what it contributes.
// Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
// Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
// Entity: Application Startup
// Relationship: This file defines the bounded JSON request size applied when the backend mounts its parser and reused by the KnowGraph upload boundary.

export function isDevelopmentEnvironment(): boolean {
  return (process.env.NODE_ENV || 'development').toLowerCase() !== 'production';
}

// One bounded web contract admits the canonical four-image Main envelope in
// every environment; the IDF materializer applies the stricter retained limits.
export function requestJsonBodyLimit(): string {
  return '20mb';
}
