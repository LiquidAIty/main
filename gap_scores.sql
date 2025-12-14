SET search_path=ag_catalog,public;

-- MV: basic "gap score" for Problem nodes based on coverage
CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_gap_scores AS
WITH probs AS (
  SELECT uid FROM public.v_entities WHERE kind = 'Problem'
),
coverage AS (
  SELECT p.uid,
         COALESCE((SELECT count(*) FROM public.v_edges e WHERE e.src = p.uid AND e.rel = 'SOLVED_BY'), 0) AS solutions,
         COALESCE((SELECT count(*) FROM public.v_edges e WHERE e.src = p.uid AND e.rel = 'MENTIONED_IN'), 0) AS mentions,
         COALESCE((SELECT count(*) FROM public.v_edges e WHERE e.src = p.uid AND e.rel = 'PATENTED_AS'), 0) AS patents
  FROM probs p
)
SELECT uid,
       solutions,
       mentions,
       patents,
       (LEAST(1, GREATEST(0, 10 - mentions))
        + CASE WHEN solutions = 0 THEN 5 ELSE 0 END
        + CASE WHEN patents  = 0 THEN 3 ELSE 0 END) AS gap_score
FROM coverage
WITH NO DATA;

-- sort index for fast UI queries
CREATE INDEX IF NOT EXISTS mv_gap_scores_idx ON public.mv_gap_scores (gap_score DESC);
