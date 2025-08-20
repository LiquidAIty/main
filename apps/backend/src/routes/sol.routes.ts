import { Router } from 'express';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { processRequest } from '../agents/sol';
import { solRun } from '../agents/orchestrator/sol';
import { routeQuery } from '../agents/orchestrator/sol';
import { listTools } from '../agents/registry';
import { buildAgent0 } from '../agents/orchestrator/agent0.graph';
import { getTool } from '../agents/registry';

const router = Router();

router.post('/execute', async (req: ExpressRequest, res: ExpressResponse) => {
  try {
    await processRequest(req.body, req);
    res.status(202).json({ status: 'accepted' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ status: 'error', message });
  }
});

// GET /sol/tools -> deterministic tool listing (id, name, kind)
router.get('/tools', (_req: ExpressRequest, res: ExpressResponse) => {
  const tools = listTools().map(t => ({ id: t.id, name: t.name, kind: t.kind }));
  res.status(200).json({ tools });
});

// GET /sol/try -> mounted under '/sol' in main.ts as '/sol/try'
router.get('/try', async (req: ExpressRequest, res: ExpressResponse) => {
  try {
    const q = (req.query as any)?.q?.toString() ?? '';
    const use = ((req.query as any)?.use?.toString() ?? 'lc') as 'lc'|'mcp'|'n8n';
    if (!q.trim()) return res.status(400).json({ ok: false, error: 'missing ?q' });
    const r = await solRun({ question: q, use });
    return res.status(200).json({ ok: true, mode: use, answer: r.text, decision: r.decision });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message ?? String(e) });
  }
});

// POST /sol/run -> Agent-0 supervisor fan-out with fallback to routed single tool
router.post('/run', async (req: ExpressRequest, res: ExpressResponse) => {
  try {
    const { q, meta, params } = (req.body ?? {}) as { q?: string; meta?: Record<string, any>; params?: any };
    if (typeof q !== 'string' || !q.trim()) return res.status(400).json({ ok: false, error: 'q required' });

    // Agent-0 supervisor
    const app = buildAgent0();
    // Only provide required input; defaults for depts/results are provided by the annotation
    const state: any = await app.invoke({ q } as any, { configurable: { thread_id: 'agent0' } });

    if (!state?.results || Object.keys(state.results).length === 0) {
      // fallback to single tool run using router
      const routed = await routeQuery({ q, meta });
      const tool = routed.tool?.id ? getTool(routed.tool.id) : undefined;
      if (!tool || typeof tool.run !== 'function') return res.json({ ...routed, executed: false });
      const result = await tool.run(params ?? { prompt: q, meta });
      return res.json({ ...routed, executed: true, result });
    }

    return res.json({ ok: true, executed: true, results: state.results, combined: state.results.__final__ });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message ?? String(e) });
  }
});

// POST /sol/route -> deterministic router using keywords (no LLM/network)
router.post('/route', async (req: ExpressRequest, res: ExpressResponse) => {
  try {
    const { q, meta } = (req.body ?? {}) as { q?: string; meta?: Record<string, any> };
    if (typeof q !== 'string' || !q.trim()) {
      return res.status(400).json({ ok: false, error: 'q required' });
    }
    const out = await routeQuery({ q, meta });
    return res.status(200).json(out);
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message ?? String(e) });
  }
});

export default router;
export { router as solRouter };
