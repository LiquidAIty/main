/** Transport reference to the exact Python-materialized runtime input bytes. */
export type CanonicalInputFiles = {
  workspace: string;
  icfPath: string;
  igfPath: string;
  icfSha256: string;
  igfSha256: string;
  icfBytes: number;
  igfBytes: number;
};
