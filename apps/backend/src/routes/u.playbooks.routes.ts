import { Router } from "express";
import { listPlaybooks, runPlaybook } from "../agents/unified/playbooks";

export const unifiedPlaybookRoutes = Router();

unifiedPlaybookRoutes.get("/u-playbooks/list", async (_req, res) => {
  try {
    const playbooks = listPlaybooks();
    res.json({ ok: true, data: playbooks, error: null, meta: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ ok: false, data: null, error: message, meta: null });
  }
});

unifiedPlaybookRoutes.post("/u-playbooks/run", async (req, res) => {
  try {
    const { id, params, corrId } = req.body ?? {};
    if (!id) {
      res.status(400).json({ ok: false, data: null, error: "id required", meta: null });
      return;
    }
    const result = await runPlaybook(String(id), params, corrId ? String(corrId) : undefined);
    res.json({ ok: true, data: result, error: null, meta: { id } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ ok: false, data: null, error: message, meta: null });
  }
});
