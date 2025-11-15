BEGIN;

-- Give each doc a different (volume, confidence),
-- and refresh scale = confidence * (1 + volume)

UPDATE ag_catalog.rag_embeddings e
SET volume     = x.volume,
    confidence = x.conf,
    scale      = GREATEST(0.0, x.conf) * (1.0 + GREATEST(0.0, x.volume)),
    updated_at = NOW()
FROM (
  VALUES
    -- chunk_id , volume , confidence
    ( (SELECT id FROM ag_catalog.rag_chunks WHERE doc_id='doc_1'),  5.0, 0.8 ),  -- big magnitude
    ( (SELECT id FROM ag_catalog.rag_chunks WHERE doc_id='doc_2'),  0.5, 0.9 ),
    ( (SELECT id FROM ag_catalog.rag_chunks WHERE doc_id='doc_3'),  0.2, 0.7 ),
    ( (SELECT id FROM ag_catalog.rag_chunks WHERE doc_id='doc_4'),  0.0, 0.6 ),
    ( (SELECT id FROM ag_catalog.rag_chunks WHERE doc_id='doc_5'),  2.0, 1.0 )   -- medium magnitude
) AS x(chunk_id, volume, conf)
WHERE e.chunk_id = x.chunk_id;

COMMIT;
