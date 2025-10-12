import { Router } from "express";
import { orchestratorApp } from "../agents/lang/orchestratorGraph";

const router = Router();

router.get("/ui/graph", (_req, res) => {
  const nodes = ["reason", "code", "hitl_wait", "route", "aggregate"];
  const edges: Array<[string, string]> = [
    ["START", "reason"],
    ["reason", "code"],
    ["code", "hitl_wait"],
    ["hitl_wait", "route"],
    ["route", "code"],
    ["route", "aggregate"],
    ["aggregate", "END"],
  ];

  res.json({ nodes, edges, compiled: Boolean(orchestratorApp) });
});

export default router;
