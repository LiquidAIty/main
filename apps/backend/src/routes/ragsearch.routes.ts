import { Router } from "express";
import { Pool } from "pg";

const router = Router();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });

router.post("/search", async (req, res) => {
  try {
    const { embedding, k = 5, w_rec = 0.1, w_sig = 0.1 } = req.body || {};
    if (!Array.isArray(embedding) || embedding.length === 0)
      return res.status(400).json({ error: "embedding (number[]) required" });

    const kk = Math.max(1, Math.min(50, Number(k) || 5));
    const wRec = Math.max(0, Number(w_rec) || 0);
    const wSig = Math.max(0, Number(w_sig) || 0);
    const wCos = Math.max(0, 1 - (wRec + wSig));

    const sql = `
      SELECT chunk_id, doc_id, src, chunk, model, score, cos_dist, l2_dist, scale, days_old, created_at
      FROM api.rag_topk_weighted($1::vector, $2::int, $3::real, $4::real, $5::real)
      ORDER BY score DESC LIMIT $2
    `;
    const params = [JSON.stringify(embedding), kk, wCos, wRec, wSig];
    const { rows } = await pool.query(sql, params);
    return res.json({ ok: true, k: kk, weights: { w_cos: wCos, w_rec: wRec, w_sig: wSig }, rows });
  } catch (e: any) {
    return res.status(500).json({ error: "internal_error", detail: String(e?.message || e) });
  }
});

export default router;
