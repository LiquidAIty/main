/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: Projects
 * Relationship: This file defines the backend's stable summary contract for listing, creating, and authorizing Project records without exposing owner-specific persistence fields.
 */

export interface ProjectSummary {
  id: string;
  name: string;
  code?: string | null;
  status?: string | null;
}
