import { Router } from 'express';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';

const router = Router();

// Minimal "try me" GET to see JSON quickly
router.get('/try', async (_req: ExpressRequest, res: ExpressResponse) => {
  return res.status(200).json({
    ok: true,
    executed: false,
    results: { __final__: 'Use POST /api/sol/run' },
    combined: 'Use POST /api/sol/run',
  });
});

// Required endpoint for the frontend
router.post('/run', async (req: ExpressRequest, res: ExpressResponse) => {
  try {
    const { q = '' } = (req.body ?? {}) as { q?: string };

    // if missing q, still return the expected JSON shape
    if (typeof q !== 'string' || q.trim() === '') {
      return res.status(400).json({
        ok: false,
        executed: false,
        results: { __final__: 'Error: Query parameter q is required' },
        combined: 'Error: Query parameter q is required',
      });
    }

    // TODO: plug into your real LangGraph + tools here.
    // For now return a stub that proves wiring:
    const results = {
      'openai-agent': { note: 'Live backend stub', input: q },
      memory: { note: 'Live backend stub memory' },
    };
    const combined = Object.entries(results)
      .map(([k, v]) => `### ${k}\n${JSON.stringify(v, null, 2)}`)
      .join('\n\n');

    return res.status(200).json({
      ok: true,
      executed: true,
      results: { ...results, __final__: combined },
      combined,
    });
  } catch (e: any) {
    return res.status(500).json({
      ok: false,
      executed: false,
      results: { __final__: e?.message ?? 'Internal error' },
      combined: e?.message ?? 'Internal error',
    });
  }
});

export default router;
