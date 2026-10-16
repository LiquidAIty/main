/**
 * Entity: Application Runtime
 * Relationship: Exposes the backend liveness endpoint consumed by dependent-service startup before other application services are launched.
 */

import { Router } from "express";

const router = Router();

router.get("/", (_req, res) => {
  res.json({ status: "ok" });
});

export default router;
