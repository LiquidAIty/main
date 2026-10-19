// Entity: Application Startup
// Relationship: This file exposes the backend liveness endpoint consumed by dependent-service startup before the remaining application services launch.

import { Router } from "express";

const router = Router();

router.get("/", (_req, res) => {
  res.json({ status: "ok" });
});

export default router;
