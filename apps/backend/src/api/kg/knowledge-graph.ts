import express from 'express';

// Neo4j implementation removed; defer to AGE-backed endpoints under /api/projects/:projectId/kg/*
const router = express.Router();

router.use((_req, res) => {
  res.status(501).json({
    ok: false,
    error: 'Knowledge graph via Neo4j is disabled. Use /api/projects/:projectId/kg/query (Apache AGE).',
  });
});

export default router;
