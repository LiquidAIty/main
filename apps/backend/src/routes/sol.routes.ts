// LEGACY ROUTE
// /api/sol/run is retained only for older Sol/LangGraph-era clients and pages.
// It is not the current orchestration direction and should not be used as an implementation target.
import { Router, Request, Response } from "express";
import { runSol } from "../volt/sol.agent";

const router = Router();

// POST /api/sol/run → legacy Sol agent call path
router.post("/run", async (req: Request, res: Response) => {
  const raw = req.body?.goal;
  const goal = typeof raw === "string" ? raw.trim() : "";
  if (!goal) return res.status(400).json({ ok: false, error: "goal is required" });

  try {
    const text = await runSol(goal);
    return res.json({ ok: true, text });
  } catch (err: any) {
    console.error("[SOL] run failed", err);
    return res.status(500).json({ ok: false, error: "Sol failed" });
  }
});

export default router;
