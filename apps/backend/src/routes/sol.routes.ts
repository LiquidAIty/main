import { Router, Request, Response } from "express";
import { runSol } from "../volt/sol.agent";

const router = Router();

// POST /api/sol/run → call Sol agent directly (no Volt dependency)
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
