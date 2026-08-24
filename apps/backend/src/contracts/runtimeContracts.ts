/** Transport reference to the exact Python-materialized IDF bytes. */
export type CanonicalInputFile = {
  workspace: string;
  idfPath: string;
  idfSha256: string;
  idfBytes: number;
};
