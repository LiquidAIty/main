/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: Projects
 * Relationship: This file resolves an exact Project reference within the current user scope and rejects access when that user does not own the Project.
 * Entity: Authentication
 * Relationship: This file derives the authenticated user from each request before returning any owner-scoped Project identity.
 */

import type { Request, Response } from 'express';
import { getOwnedProjectByReference } from '../services/projectStore';

export function authenticatedUserId(req: Request): string | null {
  const userId = String((req as Request & { userId?: string }).userId || '').trim();
  return userId || null;
}

export async function authorizeCardProject(req: Request, projectId: string): Promise<boolean> {
  const userId = authenticatedUserId(req);
  if (!userId) return false;
  const project = await getOwnedProjectByReference(projectId, userId);
  return Boolean(project && project.ownerUserId === userId);
}

export async function requireOwnedProject(
  req: Request,
  res: Response,
  projectId: string,
): Promise<{ ownerUserId: string; projectId: string } | null> {
  const ownerUserId = authenticatedUserId(req);
  if (!ownerUserId) {
    res.status(401).json({ ok: false, error: 'project_owner_session_required' });
    return null;
  }
  const project = await getOwnedProjectByReference(projectId, ownerUserId);
  if (!project) {
    res.status(404).json({ ok: false, error: 'project_not_found' });
    return null;
  }
  return { ownerUserId, projectId: project.id };
}
