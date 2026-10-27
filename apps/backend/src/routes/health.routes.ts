// Graph + less = more: less code that does the same work as more code is more useful.
// Entity names the feature; Relationship explains why this file belongs and what it contributes.
// Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
// Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
// Entity: Application Startup
// Relationship: This file exposes the backend liveness endpoint consumed by dependent-service startup before the remaining application services launch.

import { Router } from "express";

const router = Router();

router.get("/", (_req, res) => {
  res.json({ status: "ok" });
});

export default router;
