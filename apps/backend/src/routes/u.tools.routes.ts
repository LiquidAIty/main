import { Router } from "express";
import { uListTools, uRunTool } from "../agents/unified/registry.unified";

export const unifiedToolsRoutes = Router();

unifiedToolsRoutes.get("/u-tools/list", async (_req, res) => {
  try {
    const tools = await uListTools();
    res.json({ ok: true, data: tools, error: null, meta: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ ok: false, data: null, error: message, meta: null });
  }
});

unifiedToolsRoutes.post("/u-tools/run", async (req, res) => {
  try {
    const { name, input } = req.body ?? {};
    if (!name) {
      res.status(400).json({ ok: false, data: null, error: "name required", meta: null });
      return;
    }
    const result = await uRunTool(String(name), input);
    res.json({ ok: true, data: result, error: null, meta: { name } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ ok: false, data: null, error: message, meta: null });
  }
});
