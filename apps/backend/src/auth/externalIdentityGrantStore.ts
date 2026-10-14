import { pool } from '../db/pool';

export type ExternalIdentityProjectGrant = {
  grantId: string;
  userId: string;
  projectId: string;
  projectName: string;
};

/** Resolve one exact OAuth principal to its LiquidAIty user and bootstrap
 * Project. Each requesting route separately verifies ownership of the exact
 * Project named by the active Card session. */
export async function resolveExternalIdentityProjectGrant(
  issuer: string,
  subject: string,
): Promise<ExternalIdentityProjectGrant | null> {
  const normalizedIssuer = String(issuer || '').trim().replace(/\/+$/, '');
  const normalizedSubject = String(subject || '').trim();
  if (!normalizedIssuer || !normalizedSubject) return null;

  const result = await pool.query(
    `SELECT g.grant_id, g.user_id, g.project_id, p.name AS project_name
       FROM ag_catalog.external_identity_main_grant g
       JOIN ag_catalog.projects p
         ON p.id = g.project_id
        AND p.owner_user_id = g.user_id
       JOIN public."User" u
         ON u.id = g.user_id
      WHERE g.issuer = $1
        AND g.subject = $2
      LIMIT 1`,
    [normalizedIssuer, normalizedSubject],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    grantId: String(row.grant_id),
    userId: String(row.user_id),
    projectId: String(row.project_id),
    projectName: String(row.project_name),
  };
}
