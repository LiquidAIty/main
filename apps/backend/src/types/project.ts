/**
 * Entity: Projects
 * Relationship: Defines the backend's stable summary contract for listing, creating, and authorizing Project records without exposing owner-specific persistence fields.
 */

export interface ProjectSummary {
  id: string;
  name: string;
  code?: string | null;
  status?: string | null;
}
