import express from 'express';

// Neo4j is not used; AGE-backed graph access is exposed via /api/projects/:projectId/kg/query
const router = express.Router();

router.use((_req, res) => {
  res.status(501).json({
    ok: false,
    error: 'Agent KG via Neo4j is disabled. Use /api/projects/:projectId/kg/query (Apache AGE).',
  });
});

export default router;
